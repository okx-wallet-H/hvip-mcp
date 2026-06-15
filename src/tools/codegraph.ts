import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError } from "./shared.js"
import * as path from "node:path"
import * as fs from "node:fs"

// ════════════════════════════════════════════════════════════════════════════
// 代码知识图谱 — 基于 .codegraph/codegraph.db 的零依赖查询
//
// 读取 CodeGraph (colbymchenry/codegraph) 生成的 SQLite 数据库，
// 为 Agent 提供代码结构查询能力：调用链追踪、符号搜索、依赖探索。
// 用 Node 内置 node:sqlite (22.5+)，无需任何外部依赖。
// ════════════════════════════════════════════════════════════════════════════

// ── SQLite 绑定 ──────────────────────────────────────────────────────────────

let DatabaseSync: any = null

function getDB(): { db: any; error?: string } | null {
  if (DatabaseSync === null) {
    try {
      // Node 22.5+ 内置
      const sqlite = require("node:sqlite") as { DatabaseSync: new (path: string, opts?: any) => any }
      DatabaseSync = sqlite.DatabaseSync
    } catch {
      return null
    }
  }

  const dbPath = path.resolve(".codegraph", "codegraph.db")
  if (!fs.existsSync(dbPath)) {
    return null
  }

  try {
    const db = new DatabaseSync(dbPath, { readonly: true })
    // 快速连通性测试
    db.prepare("SELECT 1").get()
    return { db }
  } catch (e) {
    return null
  }
}

// ── 工具注册 ─────────────────────────────────────────────────────────────────

export function registerCodeGraphTools(server: McpServer): void {

  // ══════════════════════════════════════════════════════════════════════
  // codegraph_status — 知识图谱健康检查
  // ══════════════════════════════════════════════════════════════════════
  server.tool(
    "codegraph_status",
    "CAT:[代码智能] | ## 功能：检查代码知识图谱状态——节点数、边数、覆盖文件、最后索引时间\n## 场景：Agent 首次连接时调用，了解代码图谱是否就绪；或用户问「代码结构能查吗」时确认状态\n## 关键词：代码图谱, codegraph, 知识图谱, 代码结构, 索引状态\n## 参数：无\n## 鉴权：PUBLIC — 本地只读，不查外部 API\n## 风险：READ — 只读本地文件\n## 返回量：微小 ~500B\n## 关联：本工具确认状态 → codegraph_query 查询 → 获取调用链/依赖/结构",
    {},
    async () => {
      try {
        const conn = getDB()

        if (!conn) {
          // DB 不存在或 node:sqlite 不可用
          const nodeVersion = process.versions.node
          const nodeMajor = parseInt(nodeVersion.split(".")[0])
          const needsUpgrade = nodeMajor < 22 || (nodeMajor === 22 && parseInt(nodeVersion.split(".")[1]) < 5)

          return toResult({
            status: "unavailable",
            reason: needsUpgrade
              ? `Node.js ${nodeVersion} 不支持内置 sqlite，需要 Node >= 22.5.0`
              : "代码知识图谱数据库未找到",
            how_to_setup: [
              "1. npm i -g @colbymchenry/codegraph",
              "2. cd 到项目根目录",
              "3. codegraph index    # 生成 .codegraph/codegraph.db",
              "4. 重启 MCP Server",
            ].join("\n"),
            nodeVersion,
            tsIso: new Date().toISOString(),
            _summary: needsUpgrade
              ? `代码图谱不可用：Node ${nodeVersion} 需 >= 22.5.0`
              : "代码图谱未初始化。请运行 codegraph index 生成数据库。",
          })
        }

        const { db } = conn

        const nodeCount = db.prepare("SELECT count(*) as n FROM nodes").get().n
        const edgeCount = db.prepare("SELECT count(*) as n FROM edges").get().n
        const fileCount = db.prepare("SELECT count(*) as n FROM files").get().n

        // 按语言分布
        const langRows = db.prepare(
          "SELECT language, count(*) as n FROM files GROUP BY language ORDER BY n DESC"
        ).all()

        // 按节点类型分布
        const kindRows = db.prepare(
          "SELECT kind, count(*) as n FROM nodes GROUP BY kind ORDER BY n DESC LIMIT 10"
        ).all()

        // 最后索引时间
        const lastIndexed = db.prepare(
          "SELECT max(indexed_at) as ts FROM files"
        ).get().ts

        // Top 入度（被调用最多）节点
        const topCalled = db.prepare(`
          SELECT n.name, n.kind, n.file_path, count(e.id) as caller_count
          FROM edges e
          JOIN nodes n ON e.target = n.id
          WHERE e.kind = 'calls'
          GROUP BY e.target
          ORDER BY caller_count DESC
          LIMIT 10
        `).all()

        const status = {
          status: "ready",
          database: {
            path: ".codegraph/codegraph.db",
            nodeCount,
            edgeCount,
            fileCount,
            languages: langRows.reduce((acc: any, r: any) => ({ ...acc, [r.language]: r.n }), {}),
          },
          nodesByKind: kindRows.reduce((acc: any, r: any) => ({ ...acc, [r.kind]: r.n }), {}),
          lastIndexed: lastIndexed ? new Date(lastIndexed).toISOString() : "unknown",
          topCalledFunctions: topCalled.map((r: any) => ({
            name: r.name,
            kind: r.kind,
            file: r.file_path,
            callers: r.caller_count,
          })).slice(0, 5),
          queryHint: "用 codegraph_query 查询具体符号的调用链或探索代码结构。例如: codegraph_query({ mode: 'callers', symbol: 'toResult' })",
          tsIso: new Date().toISOString(),
          _summary: `代码知识图谱就绪。${nodeCount} 个节点，${edgeCount} 条关系，覆盖 ${fileCount} 个文件。被调用最多的函数: ${topCalled.slice(0, 3).map((r: any) => r.name).join("、") || "无"}。`,
        }

        return toResult(status)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // codegraph_query — 知识图谱查询
  // ══════════════════════════════════════════════════════════════════════
  server.tool(
    "codegraph_query",
    "CAT:[代码智能] | ## 功能：查询代码知识图谱——追踪函数调用链（谁调了谁/被谁调）、搜索符号、探索模块依赖\n## 场景：Agent 回答「toResult 被哪些工具调用」「registerMarketTools 的调用链」「index.ts 依赖哪些模块」时调用\n## 关键词：codegraph, 调用链, callers, callees, 依赖, 代码搜索, 符号查询, 上下游\n## 参数：\n##   - mode: 查询模式。callers=谁调用它, callees=它调用谁, explore=自然语言搜索, files=按文件查询\n##   - symbol: 符号名（mode=callers/callees 时必填）或文件名（mode=files）\n##   - question: 自然语言搜索（mode=explore 时使用）\n##   - limit: 返回条数，默认 15\n## 鉴权：PUBLIC — 本地数据库\n## 风险：READ — 只读\n## 返回量：微小 ~2KB\n## 关联：codegraph_status 看状态 → 本工具查询 → 定位源码 → Agent 用 Read 查看细节",
    {
      mode:     z.enum(["callers","callees","explore","files"]).describe("查询模式。callers=谁调用它, callees=它调用谁, explore=自然语言搜索, files=按文件查节点"),
      symbol:   z.string().optional().describe("符号名（如 toResult, registerMarketTools）或文件名（如 agent-utils.ts）"),
      question: z.string().optional().describe("自然语言搜索（mode=explore 时使用），如 'HTTP 请求签名' 'WebSocket 连接'"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认 15"),
    },
    async ({ mode, symbol, question, limit }) => {
      try {
        const conn = getDB()
        if (!conn) {
          return toError("代码知识图谱不可用。请先调 codegraph_status 检查状态。")
        }
        const { db } = conn
        const n = limit || 15

        // ── callers — 谁调用它 ──
        if (mode === "callers") {
          if (!symbol) return toError("callers 模式需要 symbol 参数，Agent 请提供函数名")
          // 精确 + 模糊匹配
          const nodes = db.prepare(
            "SELECT id, name, kind, file_path, start_line, signature, qualified_name FROM nodes WHERE name = ? OR name LIKE ? LIMIT 5"
          ).all(symbol, `%${symbol}%`)

          if (nodes.length === 0) {
            return toResult({
              mode: "callers",
              symbol,
              found: false,
              hint: `未找到符号 "${symbol}"。试试 codegraph_query({ mode: 'explore', question: '${symbol}' }) 全文搜索`,
              tsIso: new Date().toISOString(),
            })
          }

          const results: any[] = []
          for (const node of nodes) {
            const callers = db.prepare(`
              SELECT n.name as caller_name, n.kind, n.file_path, e.line, e.kind as edge_kind
              FROM edges e
              JOIN nodes n ON e.source = n.id
              WHERE e.target = ?
              ORDER BY n.name
              LIMIT ?
            `).all(node.id, n)

            results.push({
              target: { name: node.name, kind: node.kind, file: node.file_path, line: node.start_line },
              callers: callers.map((c: any) => ({
                name: c.caller_name,
                kind: c.kind,
                file: c.file_path,
                atLine: c.line,
                relation: c.edge_kind,
              })),
              totalCallers: callers.length,
            })
          }

          const total = results.reduce((s, r) => s + r.totalCallers, 0)
          return toResult({
            mode: "callers",
            symbol,
            matched: nodes.length,
            results,
            _summary: `"${symbol}" 匹配 ${nodes.length} 个符号，共 ${total} 个调用者。${results.slice(0, 3).map((r: any) => `${r.target.name}: ${r.callers.slice(0, 3).map((c: any) => c.name).join("、")}`).join(" | ")}`,
            tsIso: new Date().toISOString(),
          })
        }

        // ── callees — 它调用谁 ──
        if (mode === "callees") {
          if (!symbol) return toError("callees 模式需要 symbol 参数")
          const nodes = db.prepare(
            "SELECT id, name, kind, file_path, start_line FROM nodes WHERE name = ? OR name LIKE ? LIMIT 5"
          ).all(symbol, `%${symbol}%`)

          if (nodes.length === 0) {
            return toResult({
              mode: "callees", symbol, found: false,
              hint: `未找到 "${symbol}"，试试 mode='explore' 全文搜索`,
              tsIso: new Date().toISOString(),
            })
          }

          const results: any[] = []
          for (const node of nodes) {
            const callees = db.prepare(`
              SELECT n.name as callee_name, n.kind, n.file_path, e.line
              FROM edges e
              JOIN nodes n ON e.target = n.id
              WHERE e.source = ?
              ORDER BY e.kind, n.name
              LIMIT ?
            `).all(node.id, n)

            // 按边类型分组
            const byKind: Record<string, any[]> = {}
            for (const c of callees) {
              (byKind[c.kind] || (byKind[c.kind] = [])).push(c)
            }

            results.push({
              source: { name: node.name, kind: node.kind, file: node.file_path, line: node.start_line },
              callees: Object.entries(byKind).map(([kind, items]) => ({
                relation: kind,
                count: items.length,
                top: items.slice(0, 10).map((c: any) => ({ name: c.callee_name, kind: c.kind, file: c.file_path, atLine: c.line })),
              })),
              totalCallees: callees.length,
            })
          }

          const total = results.reduce((s, r) => s + r.totalCallees, 0)
          return toResult({
            mode: "callees", symbol, matched: nodes.length, results,
            _summary: `"${symbol}" 匹配 ${nodes.length} 个符号，共调用 ${total} 个下游。`,
            tsIso: new Date().toISOString(),
          })
        }

        // ── explore — 自然语言全文搜索 ──
        if (mode === "explore") {
          const q = question || symbol || ""
          if (!q) return toError("explore 模式需要 question 或 symbol 参数")
          // FTS5 全文搜索
          let rows = db.prepare(`
            SELECT n.id, n.name, n.kind, n.file_path, n.start_line, n.signature, n.docstring, n.qualified_name
            FROM nodes_fts f
            JOIN nodes n ON f.id = n.id
            WHERE nodes_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(q, n)

          // FTS5 可能对某些词不匹配，回退到 LIKE
          if (rows.length === 0) {
            rows = db.prepare(`
              SELECT id, name, kind, file_path, start_line, signature, docstring, qualified_name
              FROM nodes
              WHERE name LIKE ? OR qualified_name LIKE ? OR docstring LIKE ?
              ORDER BY name
              LIMIT ?
            `).all(`%${q}%`, `%${q}%`, `%${q}%`, n)
          }

          if (rows.length === 0) {
            return toResult({
              mode: "explore", question: q, found: false,
              hint: `未找到与 "${q}" 相关的符号。试试更短的关键词或直接搜函数名。`,
              tsIso: new Date().toISOString(),
            })
          }

          // 对前 5 个结果附加调用关系
          const top = rows.slice(0, 5)
          const enriched = top.map((r: any) => {
            const callers = db.prepare(
              "SELECT count(*) as n FROM edges WHERE target = ? AND kind = 'calls'"
            ).get(r.id).n
            const callees = db.prepare(
              "SELECT count(*) as n FROM edges WHERE source = ? AND kind = 'calls'"
            ).get(r.id).n
            return {
              name: r.name,
              kind: r.kind,
              file: r.file_path,
              line: r.start_line,
              signature: r.signature,
              docstring: r.docstring?.slice(0, 120),
              stats: { callers: callers, callees: callees },
            }
          })

          return toResult({
            mode: "explore",
            question: q,
            found: true,
            total: rows.length,
            results: enriched,
            _summary: `搜索 "${q}" 找到 ${rows.length} 个符号。${enriched.slice(0, 3).map((r: any) => `${r.name}(${r.kind}) in ${r.file}`).join(" | ")}`,
            hint: `找到具体符号后用 codegraph_query({ mode: 'callers', symbol: '<name>' }) 看完整调用链。`,
            tsIso: new Date().toISOString(),
          })
        }

        // ── files — 按文件查节点 ──
        if (mode === "files") {
          const file = symbol || ""
          if (!file) return toError("files 模式需要 symbol 参数（文件名）")

          const fileInfo = db.prepare(
            "SELECT * FROM files WHERE path LIKE ? LIMIT 1"
          ).get(`%${file}%`)

          const nodes = db.prepare(`
            SELECT name, kind, start_line, signature, is_exported
            FROM nodes
            WHERE file_path LIKE ?
            ORDER BY start_line
            LIMIT ?
          `).all(`%${file}%`, n)

          return toResult({
            mode: "files",
            file,
            fileInfo: fileInfo ? {
              path: fileInfo.path,
              language: fileInfo.language,
              size: fileInfo.size,
              nodeCount: fileInfo.node_count,
              indexedAt: fileInfo.indexed_at ? new Date(fileInfo.indexed_at).toISOString() : undefined,
            } : null,
            symbols: nodes.map((r: any) => ({
              name: r.name,
              kind: r.kind,
              line: r.start_line,
              signature: r.signature,
              exported: r.is_exported === 1,
            })),
            _summary: `文件 "${file}" 包含 ${nodes.length} 个符号。${nodes.filter((r: any) => r.is_exported).length} 个导出。`,
            tsIso: new Date().toISOString(),
          })
        }

        return toError(`未知模式: ${mode}`)
      } catch (e) { return toError(e) }
    }
  )
}
