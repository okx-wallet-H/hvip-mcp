import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError } from "./shared.js"

// ════════════════════════════════════════════════════════════════════════════
// 代码知识图谱 — CodeGraph 引擎内核集成
//
// 通过 CodeGraph.open()（读模式）打开 .codegraph DB，
// 复用 CodeGraph 官方的遍历器、搜索器、上下文构建器。
// 代码图谱本身由 Claude Code 自动维护，hvip 只消费不写入。
// ════════════════════════════════════════════════════════════════════════════

let _cg: any = null
let _cgInitError: string | null = null
let _cgInitDone = false

async function getCodeGraph(): Promise<any | null> {
  if (_cgInitDone) return _cg

  try {
    const mod = await import("@colbymchenry/codegraph")
    const CodeGraph = mod.CodeGraph || mod.default?.CodeGraph

    // open() 只读模式，不冲突 Claude Code 的 daemon
    _cg = await CodeGraph.open(".")
    _cgInitDone = true
    return _cg
  } catch (e: any) {
    _cgInitError = e.message || String(e)
    _cgInitDone = true
    return null
  }
}

export function registerCodeGraphTools(server: McpServer): void {

  // ══════════════════════════════════════════════════════════════════════
  // codegraph_status — 图谱状态
  // ══════════════════════════════════════════════════════════════════════
  server.tool(
    "codegraph_status",
    "CAT:[代码智能] | ## 功能：检查代码知识图谱状态——节点数、边数、覆盖文件、被调用最多的函数\n## 场景：Agent 首次连接时确认图谱是否就绪，或用户问「hvip 代码结构能查吗」时确认\n## 关键词：代码图谱, codegraph, 知识图谱, 索引状态, 调用排行\n## 参数：无\n## 鉴权：PUBLIC — 本地读数据库\n## 风险：READ — 只读\n## 返回量：微小 ~800B\n## 关联：本工具确认状态 → codegraph_query 追踪调用链/搜索符号",
    {},
    async () => {
      try {
        const cg = await getCodeGraph()

        if (!cg) {
          return toResult({
            status: "unavailable",
            reason: _cgInitError || "CodeGraph 引擎加载失败",
            how_to_setup: "npm i @colbymchenry/codegraph && codegraph index",
            alternatives: "图谱不可用时，仍可用本工具返回的节点数和边数了解代码规模",
            tsIso: new Date().toISOString(),
            _summary: "代码图谱未就绪。请运行 codegraph index 生成数据库。",
          })
        }

        const stats = await cg.getStats()

        // Top 5 被调用函数（通过 graph 遍历）
        let topCalled: any[] = []
        try {
          const allExported = await cg.getNodesByKind("function")
            .then((nodes: any[]) => nodes.filter((n: any) => n.isExported))
            .catch(() => [])
          // 采样前 50 个函数查调用数
          const sample = allExported.slice(0, 50)
          const withCounts = await Promise.all(
            sample.map(async (n: any) => {
              try {
                const callers = await cg.getCallers(n.id, 1)
                return { name: n.name, file: n.filePath, callers: callers?.length || 0 }
              } catch { return { name: n.name, file: n.filePath, callers: 0 } }
            })
          )
          topCalled = withCounts.sort((a, b) => b.callers - a.callers).slice(0, 5)
        } catch { /* non-critical */ }

        const status = {
          status: "ready",
          stats: {
            nodes: stats.nodeCount,
            edges: stats.edgeCount,
            files: stats.fileCount,
            byKind: stats.nodesByKind,
            byLanguage: stats.filesByLanguage,
            dbSize: stats.dbSizeBytes ? `${(stats.dbSizeBytes / 1024 / 1024).toFixed(1)} MB` : "unknown",
          },
          topCalled,
          queryHint: "用 codegraph_query 查调用链。例: codegraph_query({ mode: 'callers', symbol: 'toResult' })",
          tsIso: new Date().toISOString(),
          _summary: `代码知识图谱就绪。${stats.nodeCount} 个节点，${stats.edgeCount} 条关系，覆盖 ${stats.fileCount} 个文件。${topCalled.length ? `被调最多: ${topCalled.slice(0, 3).map((f: any) => f.name).join("、")}` : ""}`,
        }

        return toResult(status)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // codegraph_query — 图谱查询
  // ══════════════════════════════════════════════════════════════════════
  server.tool(
    "codegraph_query",
    "CAT:[代码智能] | ## 功能：查询代码知识图谱——追踪调用链、搜索符号、探索模块依赖、按文件列出符号\n## 场景：Agent 回答「toResult 被哪些工具调用」「registerMarketTools 的上下游」「代码里哪里处理了 WebSocket」时调用\n## 关键词：codegraph, 调用链, callers, callees, 依赖, 代码搜索, 符号查询, 上下游, 影响分析\n## 参数：\n##   - mode: 查询模式。callers=谁调用它, callees=它调用谁, search=全文搜索, file=按文件列出\n##   - symbol: 符号名/节点ID (callers/callees/file 模式)\n##   - query: 搜索词 (search 模式)\n##   - limit: 返回数，默认 15\n## 鉴权：PUBLIC — 本地读数据库\n## 风险：READ — 只读\n## 返回量：微小 ~2KB\n## 关联：codegraph_status 看状态 → 本工具查询 → Agent 定位源码",
    {
      mode:   z.enum(["callers","callees","search","file"]).describe("callers=谁调用它, callees=它调用谁, search=全文搜索, file=按文件列出符号"),
      symbol: z.string().optional().describe("符号名（如 toResult）或文件名（如 agent-utils.ts）"),
      query:  z.string().optional().describe("搜索词（search 模式），如 'websocket 连接'"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回数，默认 15"),
    },
    async ({ mode, symbol, query, limit }) => {
      try {
        const cg = await getCodeGraph()
        if (!cg) return toError("代码图谱不可用。请先调 codegraph_status 检查状态。")

        const n = limit || 15

        // ── search — 全文搜索符号 ──
        if (mode === "search") {
          const q = query || symbol || ""
          if (!q) return toError("search 模式需要 query 或 symbol 参数")

          const results = await cg.searchNodes(q, { limit: n })

          if (!results?.length) {
            return toResult({
              mode: "search", query: q, found: false,
              hint: `未找到与 "${q}" 相关的符号。试试函数名（如 registerTools）或文件名。`,
              tsIso: new Date().toISOString(),
            })
          }

          const items = await Promise.all(results.slice(0, n).map(async (r: any) => {
            const node = r.node || r
            let callerCount = 0, calleeCount = 0
            try { callerCount = (await cg.getCallers(node.id, 1))?.length || 0 } catch {}
            try { calleeCount = (await cg.getCallees(node.id, 1))?.length || 0 } catch {}
            return {
              id: node.id, name: node.name, kind: node.kind,
              file: node.filePath, line: node.startLine,
              signature: node.signature?.slice(0, 120),
              stats: { callers: callerCount, callees: calleeCount },
            }
          }))

          return toResult({
            mode: "search", query: q, total: results.length, results: items,
            _summary: `搜索 "${q}" 找到 ${results.length} 个符号。${items.slice(0, 3).map(i => `${i.name}(${i.kind})`).join(" | ")}`,
            hint: `找到具体符号后，用 codegraph_query({ mode: 'callers', symbol: '<id>' }) 追踪调用链。`,
            tsIso: new Date().toISOString(),
          })
        }

        // ── callers — 谁调用它 ──
        if (mode === "callers") {
          if (!symbol) return toError("callers 模式需要 symbol 参数")

          const nodes = await cg.getNodesByName(symbol)
          if (!nodes?.length) {
            return toResult({ mode: "callers", symbol, found: false, tsIso: new Date().toISOString() })
          }

          const results = await Promise.all(nodes.slice(0, 5).map(async (node: any) => {
            const callers = await cg.getCallers(node.id, 1)
            return {
              target: { id: node.id, name: node.name, kind: node.kind, file: node.filePath, line: node.startLine },
              callers: (callers || []).slice(0, n).map((c: any) => ({
                name: c.name, kind: c.kind, file: c.filePath, line: c.line, relation: c.edgeKind,
              })),
              total: callers?.length || 0,
            }
          }))

          const total = results.reduce((s, r) => s + r.total, 0)
          return toResult({
            mode: "callers", symbol, matched: nodes.length, results,
            _summary: `"${symbol}" 匹配 ${nodes.length} 个符号，共 ${total} 个调用者。`,
            tsIso: new Date().toISOString(),
          })
        }

        // ── callees — 它调用谁 ──
        if (mode === "callees") {
          if (!symbol) return toError("callees 模式需要 symbol 参数")

          const nodes = await cg.getNodesByName(symbol)
          if (!nodes?.length) {
            return toResult({ mode: "callees", symbol, found: false, tsIso: new Date().toISOString() })
          }

          const results = await Promise.all(nodes.slice(0, 5).map(async (node: any) => {
            const callees = await cg.getCallees(node.id, 1)
            return {
              source: { id: node.id, name: node.name, kind: node.kind, file: node.filePath, line: node.startLine },
              callees: (callees || []).slice(0, n).map((c: any) => ({
                name: c.name, kind: c.kind, file: c.filePath, line: c.line, relation: c.edgeKind,
              })),
              total: callees?.length || 0,
            }
          }))

          const total = results.reduce((s, r) => s + r.total, 0)
          return toResult({
            mode: "callees", symbol, matched: nodes.length, results,
            _summary: `"${symbol}" 匹配 ${nodes.length} 个符号，共调用 ${total} 个下游。`,
            tsIso: new Date().toISOString(),
          })
        }

        // ── file — 按文件列出符号 ──
        if (mode === "file") {
          if (!symbol) return toError("file 模式需要 symbol 参数（文件名）")

          const files = await cg.getFiles({ pattern: symbol })
          const fileInfo = files?.[0]
          const symbols = fileInfo
            ? await cg.getNodesInFile(fileInfo.path)
            : []

          return toResult({
            mode: "file", file: symbol,
            fileInfo: fileInfo ? { path: fileInfo.path, language: fileInfo.language, size: fileInfo.size } : null,
            symbols: (symbols || []).slice(0, n).map((s: any) => ({
              name: s.name, kind: s.kind, line: s.startLine,
              signature: s.signature?.slice(0, 120),
              exported: s.isExported,
            })),
            _summary: `文件 "${symbol}" 包含 ${symbols?.length || 0} 个符号。`,
            tsIso: new Date().toISOString(),
          })
        }

        return toError(`未知模式: ${mode}`)
      } catch (e) { return toError(e) }
    }
  )
}
