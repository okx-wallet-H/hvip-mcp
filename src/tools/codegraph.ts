/**
 * 代码知识图谱 — node:sqlite 零依赖引擎
 *
 * 读取 .codegraph/codegraph.db（CodeGraph 标准格式），
 * 用 Node 内置 node:sqlite (22.5+) 直接查询。
 * 代码图谱由 Claude Code 自动维护，hvip 只读取。
 *
 * Schema:
 *   nodes(id, kind, name, file_path, start_line, signature, is_exported, ...)
 *   edges(source, target, kind, line, ...)  — kind: calls/contains/references/imports
 *   files(path, language, node_count, indexed_at, ...)
 *   nodes_fts — FTS5 全文索引 (name, qualified_name, docstring, signature)
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError , registerTool} from "./shared.js"
import * as path from "node:path"
import * as fs from "node:fs"

// ── SQLite 绑定 ──────────────────────────────────────────────────────────────

let DatabaseSync: any = null
let _sqliteAvailable: boolean | null = null

function isSqliteAvailable(): boolean {
  if (_sqliteAvailable !== null) return _sqliteAvailable
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync: new (p: string, o?: any) => any }
    DatabaseSync = sqlite.DatabaseSync
    _sqliteAvailable = true
    return true
  } catch {
    _sqliteAvailable = false
    return false
  }
}

function getDBPath(): string {
  return path.resolve(".codegraph", "codegraph.db")
}

function openDB(): any | null {
  if (!isSqliteAvailable()) return null
  const dbPath = getDBPath()
  if (!fs.existsSync(dbPath)) return null
  try {
    return new DatabaseSync(dbPath, { readonly: true })
  } catch {
    return null
  }
}

// ── 查询辅助 ─────────────────────────────────────────────────────────────────

function safeGet<T>(db: any, sql: string, ...params: any[]): T | null {
  try {
    const stmt = db.prepare(sql)
    return stmt.get(...(params.length ? params : [])) as T
  } catch { return null }
}

function safeAll<T>(db: any, sql: string, limit: number, ...params: any[]): T[] {
  try {
    const stmt = db.prepare(sql)
    const all = stmt.all(...(params.length ? params : [])) as T[]
    return (Array.isArray(all) ? all : []).slice(0, limit)
  } catch { return [] }
}

/** 通过名称查找节点（精确 + LIKE 回退） */
function findNodes(db: any, name: string, limit = 5): any[] {
  // 先精确匹配
  const exact = safeAll<any>(db,
    "SELECT * FROM nodes WHERE name = ? LIMIT ?", limit, name, limit
  )
  if (exact.length > 0) return exact
  // LIKE 回退
  return safeAll<any>(db,
    "SELECT * FROM nodes WHERE name LIKE ? LIMIT ?", limit, `%${name}%`, limit
  )
}

/** 获取调用者列表 */
function getCallers(db: any, nodeId: string, limit = 50): any[] {
  return safeAll<any>(db, `
    SELECT n.name, n.kind, n.file_path, n.start_line, e.line, e.kind as edge_kind
    FROM edges e
    JOIN nodes n ON e.source = n.id
    WHERE e.target = ? AND e.kind = 'calls'
    ORDER BY n.file_path, n.start_line
    LIMIT ?
  `, limit, nodeId, limit)
}

/** 获取被调用者列表 */
function getCallees(db: any, nodeId: string, limit = 50): any[] {
  return safeAll<any>(db, `
    SELECT n.name, n.kind, n.file_path, n.start_line, e.line, e.kind as edge_kind
    FROM edges e
    JOIN nodes n ON e.target = n.id
    WHERE e.source = ? AND e.kind = 'calls'
    ORDER BY n.file_path, n.start_line
    LIMIT ?
  `, limit, nodeId, limit)
}

/** 2-hop 影响分析：修改此节点会影响谁？ */
function getImpact(db: any, nodeId: string, maxDepth = 2, limit = 50): { direct: any[]; indirect: any[] } {
  const direct = getCallers(db, nodeId, limit)
  // 对前 10 个直接调用者，查它们的调用者
  const indirectMap = new Map<string, any>()
  for (const d of direct.slice(0, 10)) {
    const node = safeGet<any>(db,
      "SELECT id, name, kind, file_path FROM nodes WHERE name = ? AND file_path = ? LIMIT 1",
      d.name, d.file_path
    )
    if (node) {
      const indirect = safeAll<any>(db, `
        SELECT n.name, n.kind, n.file_path, n.start_line
        FROM edges e JOIN nodes n ON e.source = n.id
        WHERE e.target = ? AND e.kind = 'calls'
        LIMIT 5
      `, 5, node.id)
      for (const idr of indirect) {
        const key = `${idr.name}@${idr.file_path}`
        if (!indirectMap.has(key)) indirectMap.set(key, idr)
      }
    }
  }
  return { direct, indirect: [...indirectMap.values()].slice(0, limit) }
}

// ── 工具注册 ─────────────────────────────────────────────────────────────────

export function registerCodeGraphTools(server: McpServer): void {

  registerTool(
    server,
    "codegraph_status",
    "READ",
    "[D:CodeIntel] | ## 功能：检查代码知识图谱状态——节点数、边数、覆盖文件、被调最多的函数\n## 场景：Agent 首次连接时确认图谱就绪\n## 关键词：代码图谱, codegraph, 知识图谱, 索引状态, 调用排行\n## 参数：无\n## 鉴权：PUBLIC — 本地读 DB\n## 风险：READ — 只读\n## 返回量：微小 ~1KB\n## 关联：确认状态 → codegraph_query 追踪调用链",
    {},
    async () => {
      try {
        if (!isSqliteAvailable()) {
          const nodeVersion = process.versions.node
          return toResult({
            status: "unavailable",
            reason: `Node.js ${nodeVersion} 不支持内置 sqlite，需要 Node >= 22.5.0`,
            nodeVersion,
            tsIso: new Date().toISOString(),
            _summary: `代码图谱不可用：需 Node >= 22.5.0，当前 ${nodeVersion}`,
          })
        }

        const dbPath = getDBPath()
        if (!fs.existsSync(dbPath)) {
          return toResult({
            status: "no_db",
            reason: `.codegraph/codegraph.db 不存在`,
            how_to_setup: [
              "1. npm i -g @colbymchenry/codegraph",
              "2. cd 到项目根目录运行 codegraph index",
              "3. 重启 MCP Server",
              "（Claude Code 用户：图谱由 CodeGraph 功能自动生成）",
            ].join("\n"),
            tsIso: new Date().toISOString(),
            _summary: "代码图谱未生成。运行 codegraph index 后可用。",
          })
        }

        const db = openDB()
        if (!db) {
          return toResult({
            status: "error",
            reason: "无法打开代码图谱数据库（可能被锁定）",
            dbPath,
            tsIso: new Date().toISOString(),
            _summary: "代码图谱数据库打开失败，请重试。",
          })
        }

        try {
          // 基本统计
          const nodeCount = safeGet<any>(db, "SELECT count(*) as n FROM nodes")?.n || 0
          const edgeCount = safeGet<any>(db, "SELECT count(*) as n FROM edges")?.n || 0
          const fileCount = safeGet<any>(db, "SELECT count(*) as n FROM files")?.n || 0

          // 按语言
          const byLang = safeAll<any>(db,
            "SELECT language, count(*) as n FROM files GROUP BY language ORDER BY n DESC", 20
          )

          // 按节点类型
          const byKind = safeAll<any>(db,
            "SELECT kind, count(*) as n FROM nodes GROUP BY kind ORDER BY n DESC", 20
          )

          // Top 5 被调用函数
          let topCalled: any[] = []
          try {
            topCalled = safeAll<any>(db, `
              SELECT n.name, n.kind, n.file_path, count(e.id) as caller_count
              FROM edges e
              JOIN nodes n ON e.target = n.id
              WHERE e.kind = 'calls'
              GROUP BY e.target
              ORDER BY caller_count DESC
              LIMIT 5
            `, 5) || []
          } catch { /* FTS5 may fail on old DBs */ }

          // 最后索引时间
          const lastIndexed = safeGet<any>(db,
            "SELECT max(indexed_at) as ts FROM files"
          )?.ts

          db.close()

          const status = {
            status: "ready",
            dbPath,
            database: { nodeCount, edgeCount, fileCount },
            languages: byLang.reduce((acc: any, r: any) => ({ ...acc, [r.language]: r.n }), {}),
            nodesByKind: byKind.reduce((acc: any, r: any) => ({ ...acc, [r.kind]: r.n }), {}),
            lastIndexed: lastIndexed ? new Date(lastIndexed).toISOString() : "unknown",
            topCalledFunctions: topCalled.map((r: any) => ({
              name: r.name, kind: r.kind, file: r.file_path, callers: r.caller_count,
            })),
            queryHint: "codegraph_query { mode: 'callers', symbol: 'toResult' }",
            tsIso: new Date().toISOString(),
            _summary: `代码图谱就绪。${nodeCount} 个节点，${edgeCount} 条关系，${fileCount} 个文件。${topCalled.length ? `被调最多: ${topCalled.slice(0, 3).map((f: any) => f.name).join("、")}` : ""}`,
          }

          return toResult(status)
        } catch (e) {
          try { db.close() } catch {}
          throw e
        }
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "codegraph_query",
    "READ",
    "[D:CodeIntel] | ## 功能：查询代码知识图谱——追踪调用链（callers/callees）、搜索符号、按文件列符号、影响分析\n## 场景：Agent 回答「toResult 被哪些工具调用」「改 shared.ts 影响哪些模块」「WebSocket 在哪些文件里」时调用\n## 关键词：codegraph, 调用链, callers, callees, 搜索, 影响分析, 依赖\n## 参数：\n##   - mode: 查询模式。callers / callees / search / file / impact\n##   - symbol: 符号名或文件名\n##   - limit: 返回数，默认 15\n## 鉴权：PUBLIC — 本地读 DB\n## 风险：READ — 只读\n## 返回量：微小 ~2KB\n## 关联：codegraph_status → codegraph_query",
    {
      mode:   z.enum(["callers","callees","search","file","impact"]).describe("callers=谁调用它, callees=它调用谁, search=搜符号, file=按文件, impact=2跳影响分析"),
      symbol: z.string().optional().describe("符号名（如 toResult）或文件名（如 agent-utils.ts）或搜索词"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回数，默认 15"),
    },
    async ({ mode, symbol, limit }) => {
      try {
        const db = openDB()
        if (!db) return toError("代码图谱不可用。请调 codegraph_status 检查状态。")

        const n = limit || 15

        try {
          // ── search ──────────────────────────────────────────────────────
          if (mode === "search") {
            if (!symbol) return toError("search 模式需要 symbol 参数")
            const q = symbol

            // FTS5 全文搜索
            let rows = safeAll<any>(db, `
              SELECT n.id, n.name, n.kind, n.file_path, n.start_line, n.signature,
                     n.docstring, n.qualified_name
              FROM nodes_fts f
              JOIN nodes n ON f.id = n.id
              WHERE nodes_fts MATCH ?
              ORDER BY rank
              LIMIT ?
            `, n, q, n)

            // LIKE 回退
            if (!rows || rows.length === 0) {
              rows = safeAll<any>(db, `
                SELECT id, name, kind, file_path, start_line, signature, docstring, qualified_name
                FROM nodes
                WHERE name LIKE ? OR qualified_name LIKE ?
                ORDER BY name
                LIMIT ?
              `, n, `%${q}%`, `%${q}%`, n)
            }

            if (!rows || rows.length === 0) {
              return toResult({
                mode: "search", query: q, found: false,
                hint: `未找到 "${q}"。试试函数名（如 registerTools）或文件名片段。`,
                tsIso: new Date().toISOString(),
              })
            }

            const items = rows.slice(0, n).map((r: any) => ({
              name: r.name, kind: r.kind, file: r.file_path, line: r.start_line,
              signature: r.signature?.slice(0, 120),
              docstring: r.docstring?.slice(0, 100),
            }))

            return toResult({
              mode: "search", query: q, total: rows.length, results: items,
              _summary: `搜索 "${q}" 找到 ${rows.length} 个符号。${items.slice(0, 3).map(i => `${i.name}(${i.kind})`).join(" | ")}`,
              hint: `找到后: codegraph_query({ mode: 'callers', symbol: '<name>' })`,
              tsIso: new Date().toISOString(),
            })
          }

          // ── callers ─────────────────────────────────────────────────────
          if (mode === "callers") {
            if (!symbol) return toError("callers 模式需要 symbol")
            const nodes = findNodes(db, symbol, 3)
            if (!nodes.length) {
              return toResult({ mode: "callers", symbol, found: false, tsIso: new Date().toISOString() })
            }

            const results = nodes.map((node: any) => {
              const callers = getCallers(db, node.id, n)
              return {
                target: { id: node.id, name: node.name, kind: node.kind, file: node.file_path, line: node.start_line },
                callers: callers.map((c: any) => ({
                  name: c.name, kind: c.kind, file: c.file_path, line: c.start_line,
                })),
                total: callers.length,
              }
            })

            const total = results.reduce((s, r) => s + r.total, 0)
            return toResult({
              mode: "callers", symbol, matched: nodes.length, results,
              _summary: `"${symbol}" 匹配 ${nodes.length} 个符号，共 ${total} 个调用者。`,
              tsIso: new Date().toISOString(),
            })
          }

          // ── callees ─────────────────────────────────────────────────────
          if (mode === "callees") {
            if (!symbol) return toError("callees 模式需要 symbol")
            const nodes = findNodes(db, symbol, 3)
            if (!nodes.length) {
              return toResult({ mode: "callees", symbol, found: false, tsIso: new Date().toISOString() })
            }

            const results = nodes.map((node: any) => {
              const callees = getCallees(db, node.id, n)
              return {
                source: { id: node.id, name: node.name, kind: node.kind, file: node.file_path, line: node.start_line },
                callees: callees.map((c: any) => ({
                  name: c.name, kind: c.kind, file: c.file_path, line: c.start_line,
                })),
                total: callees.length,
              }
            })

            const total = results.reduce((s, r) => s + r.total, 0)
            return toResult({
              mode: "callees", symbol, matched: nodes.length, results,
              _summary: `"${symbol}" 匹配 ${nodes.length} 个符号，共调用 ${total} 个下游。`,
              tsIso: new Date().toISOString(),
            })
          }

          // ── file ─────────────────────────────────────────────────────────
          if (mode === "file") {
            if (!symbol) return toError("file 模式需要 symbol（文件名）")
            const file = safeGet<any>(db,
              "SELECT * FROM files WHERE path LIKE ? LIMIT 1",
              `%${symbol}%`
            )

            const nodes = safeAll<any>(db, `
              SELECT name, kind, start_line, signature, is_exported
              FROM nodes WHERE file_path LIKE ?
              ORDER BY start_line LIMIT ?
            `, n, `%${symbol}%`, n)

            return toResult({
              mode: "file", file: symbol,
              fileInfo: file ? { path: file.path, language: file.language, size: file.size, nodeCount: file.node_count } : null,
              symbols: nodes.map((r: any) => ({
                name: r.name, kind: r.kind, line: r.start_line,
                signature: r.signature?.slice(0, 120), exported: r.is_exported === 1,
              })),
              _summary: `文件 "${symbol}" 包含 ${nodes.length} 个符号。`,
              tsIso: new Date().toISOString(),
            })
          }

          // ── impact ──────────────────────────────────────────────────────
          if (mode === "impact") {
            if (!symbol) return toError("impact 模式需要 symbol")
            const nodes = findNodes(db, symbol, 1)
            if (!nodes.length) {
              return toResult({ mode: "impact", symbol, found: false, tsIso: new Date().toISOString() })
            }
            const node = nodes[0]
            const { direct, indirect } = getImpact(db, node.id, 2, n)

            return toResult({
              mode: "impact",
              symbol,
              node: { id: node.id, name: node.name, kind: node.kind, file: node.file_path, line: node.start_line },
              directlyAffected: direct.map((c: any) => ({
                name: c.name, kind: c.kind, file: c.file_path, line: c.start_line,
              })),
              indirectlyAffected: indirect.map((c: any) => ({
                name: c.name, kind: c.kind, file: c.file_path, line: c.start_line,
              })),
              _summary: `修改 "${symbol}" 直接影响 ${direct.length} 个调用者，间接影响 ${indirect.length} 个下游。`,
              tsIso: new Date().toISOString(),
            })
          }

          return toError(`未知模式: ${mode}`)
        } finally {
          try { db.close() } catch {}
        }
      } catch (e) { return toError(e) }
    }
  )
}
