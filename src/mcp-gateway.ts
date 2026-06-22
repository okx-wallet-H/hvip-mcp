/**
 * MCP Gateway — 商户 API 网关
 *
 * 鉴权 + 限流 + 用量日志 → 转发到本地 MCP Server
 *
 * 商户通过 Cloudflare Tunnel → mcp.hwallet.vip → 此网关
 *
 * Usage:
 *   node dist/mcp-gateway.js --port 9320 --mcp http://127.0.0.1:9222/mcp
 */

import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { logger } from "./utils/logger.js"
import { isSqliteAvailable, openDB, ensureDir } from "./adapters/shared-sqlite.js"
import crypto from "node:crypto"

const log = logger("Gateway")

// ═══════════════════════════════════════════════════════════
// CLI args
// ═══════════════════════════════════════════════════════════

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

const PORT   = parseInt(flag("port")  || process.env.GATEWAY_PORT  || "9320", 10)
const MCP_URL = flag("mcp")           || process.env.MCP_URL       || "http://127.0.0.1:9222/mcp"
const HOST    = flag("host")          || process.env.GATEWAY_HOST  || "127.0.0.1"

// ═══════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════

const DB_PATH = flag("db") || process.env.GATEWAY_DB || ".hub/gateway.db"

let db: any = null
if (isSqliteAvailable()) {
  ensureDir(DB_PATH)
  db = openDB(DB_PATH, { create: true })
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      api_key    TEXT NOT NULL UNIQUE,
      rate_limit INTEGER DEFAULT 60,
      enabled    INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS usage_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      tool_name   TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'ok',
      error_msg   TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_merchant ON usage_log(merchant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_log(tool_name);
  `)
  log.info(`Gateway DB: ${DB_PATH}`)
}

function dbRun(sql: string, ...params: any[]) {
  if (!db) return
  try { return db.prepare(sql).run(...params) } catch (e: any) { log.error(`DB: ${e.message}`) }
}
function dbGet(sql: string, ...params: any[]): any {
  if (!db) return null
  try { return db.prepare(sql).get(...params) } catch { return null }
}
function dbAll(sql: string, ...params: any[]): any[] {
  if (!db) return []
  try { return db.prepare(sql).all(...params) } catch { return [] }
}

// Seed default merchant if none exist
if (db) {
  const count = (db.prepare("SELECT COUNT(*) as c FROM merchants").get() as any)?.c || 0
  if (count === 0) {
    const seedKey = process.env.GATEWAY_SEED_KEY || "mcp-" + crypto.randomBytes(16).toString("hex")
    dbRun("INSERT INTO merchants (name, api_key, rate_limit) VALUES (?, ?, ?)", "default", seedKey, 120)
    log.info(`🔑 种子商户: default → ${seedKey.slice(0, 12)}... (${120} req/min)`)
  }
}

// ═══════════════════════════════════════════════════════════
// Rate Limiter — token bucket
// ═══════════════════════════════════════════════════════════

interface Bucket {
  tokens: number
  lastRefill: number
  limit: number  // tokens per minute
}

const buckets = new Map<string, Bucket>()

function getBucket(merchantId: number, key: string, rateLimit: number): Bucket {
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: rateLimit, lastRefill: Date.now(), limit: rateLimit }
    buckets.set(key, b)
  }
  // Refill
  const now = Date.now()
  const elapsed = (now - b.lastRefill) / 1000
  b.tokens = Math.min(b.limit, b.tokens + elapsed * (b.limit / 60))
  b.lastRefill = now
  return b
}

// Cleanup stale buckets every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > 600_000) buckets.delete(k)
  }
}, 600_000)

// ═══════════════════════════════════════════════════════════
// HTTP Helpers
// ═══════════════════════════════════════════════════════════

function json(res: ServerResponse, code: number, data: any) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  })
  res.end(JSON.stringify(data))
}

function jsonError(res: ServerResponse, code: number, error: string, category = "AUTH") {
  json(res, code, { jsonrpc: "2.0", error: { code: -32000, message: error, data: { category } }, id: null })
}

// ═══════════════════════════════════════════════════════════
// MCP Forward
// ═══════════════════════════════════════════════════════════

async function forwardMCP(body: string, merchantId: number, merchantName: string): Promise<{ status: number; body: string; contentType: string }> {
  try {
    const resp = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await resp.text()
    const ct = resp.headers.get("content-type") || "application/json"
    return { status: resp.status, body: text, contentType: ct }
  } catch (e: any) {
    log.error(`MCP 转发失败: ${e.message}`)
    return { status: 502, body: JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "MCP 服务不可用" }, id: null }), contentType: "application/json" }
  }
}

// ═══════════════════════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════════════════════

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "OPTIONS") { json(res, 204, {}); return }

  const apiKey = (req.headers["x-api-key"] as string) || ""

  // GET /health
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok", name: "MCP Gateway", mcp: MCP_URL, db: !!db })
    return
  }

  // ── Admin: merchants CRUD ──
  // GET /api/gateway/merchants
  if (req.method === "GET" && req.url === "/api/gateway/merchants") {
    if (!apiKey) { jsonError(res, 401, "缺少 X-API-Key"); return }
    const admin = dbGet("SELECT * FROM merchants WHERE api_key = ? AND enabled = 1", apiKey)
    if (!admin) { jsonError(res, 403, "无效 API Key"); return }
    const merchants = dbAll("SELECT id, name, rate_limit, enabled, created_at FROM merchants ORDER BY id")
    json(res, 200, { merchants })
    return
  }

  // POST /api/gateway/merchants
  if (req.method === "POST" && req.url === "/api/gateway/merchants") {
    if (!apiKey) { jsonError(res, 401, "缺少 X-API-Key"); return }
    const admin = dbGet("SELECT * FROM merchants WHERE api_key = ? AND enabled = 1", apiKey)
    if (!admin) { jsonError(res, 403, "无效 API Key"); return }
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      try {
        const { name, rateLimit } = JSON.parse(Buffer.concat(chunks).toString())
        if (!name) { json(res, 400, { error: "缺少 name" }); return }
        const key = "mcp-" + crypto.randomBytes(16).toString("hex")
        dbRun("INSERT INTO merchants (name, api_key, rate_limit) VALUES (?, ?, ?)", name, key, rateLimit || 60)
        json(res, 201, { ok: true, name, apiKey: key, rateLimit: rateLimit || 60 })
      } catch { json(res, 400, { error: "JSON 解析失败" }) }
    })
    return
  }

  // DELETE /api/gateway/merchants/:id
  if (req.method === "DELETE" && req.url?.startsWith("/api/gateway/merchants/")) {
    if (!apiKey) { jsonError(res, 401, "缺少 X-API-Key"); return }
    const admin = dbGet("SELECT * FROM merchants WHERE api_key = ? AND enabled = 1", apiKey)
    if (!admin) { jsonError(res, 403, "无效 API Key"); return }
    const id = parseInt(req.url.split("/").pop() || "0")
    dbRun("UPDATE merchants SET enabled = 0 WHERE id = ?", id)
    json(res, 200, { ok: true })
    return
  }

  // GET /api/gateway/usage — 用量统计
  if (req.method === "GET" && req.url?.startsWith("/api/gateway/usage")) {
    if (!apiKey) { jsonError(res, 401, "缺少 X-API-Key"); return }
    const merchant = dbGet("SELECT * FROM merchants WHERE api_key = ? AND enabled = 1", apiKey)
    if (!merchant) { jsonError(res, 403, "无效 API Key"); return }

    const url = new URL(req.url!, `http://${HOST}:${PORT}`)
    const days = parseInt(url.searchParams.get("days") || "7")

    const usage = dbAll(
      `SELECT tool_name, COUNT(*) as calls, AVG(duration_ms) as avg_ms,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors
       FROM usage_log
       WHERE merchant_id = ? AND created_at > datetime('now', '-' || ? || ' days')
       GROUP BY tool_name ORDER BY calls DESC LIMIT 50`,
      merchant.id, days
    )
    const total = dbGet(
      `SELECT COUNT(*) as total FROM usage_log
       WHERE merchant_id = ? AND created_at > datetime('now', '-' || ? || ' days')`,
      merchant.id, days
    )
    json(res, 200, { merchant: merchant.name, days, totalCalls: total?.total || 0, usage })
    return
  }

  // ── MCP Proxy ──
  // POST /mcp — JSON-RPC
  if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
    // Auth
    if (!apiKey) { jsonError(res, 401, "缺少 X-API-Key 请求头"); return }
    const merchant = dbGet("SELECT * FROM merchants WHERE api_key = ? AND enabled = 1", apiKey)
    if (!merchant) { jsonError(res, 403, "无效或已停用的 API Key"); return }

    // Rate limit
    const bucket = getBucket(merchant.id, apiKey, merchant.rate_limit)
    if (bucket.tokens < 1) {
      jsonError(res, 429, `限流 (${merchant.rate_limit} req/min)，请稍后重试`, "RATE_LIMIT")
      return
    }
    bucket.tokens--

    // Parse & log
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString()
      let toolName = "unknown"
      try {
        const rpc = JSON.parse(body)
        toolName = rpc.params?.name || rpc.method || "unknown"
      } catch {}

      const start = Date.now()
      const result = await forwardMCP(body, merchant.id, merchant.name)
      const dur = Date.now() - start

      // Log
      const status = result.status < 500 ? "ok" : "error"
      dbRun("INSERT INTO usage_log (merchant_id, tool_name, duration_ms, status) VALUES (?, ?, ?, ?)", merchant.id, toolName, dur, status)

      res.writeHead(result.status, {
        "Content-Type": result.contentType,
        "Access-Control-Allow-Origin": "*",
        "X-Gateway-Elapsed": String(dur),
        "X-RateLimit-Remaining": String(Math.floor(bucket.tokens)),
      })
      res.end(result.body)
    })
    return
  }

  // 404
  json(res, 404, { error: "Not Found" })
})

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log.error(`端口 ${PORT} 被占用`)
  } else {
    log.error(`Server 错误: ${err.message}`)
  }
})

server.listen(PORT, HOST, () => {
  log.info(`🔐 MCP Gateway → http://${HOST}:${PORT}`)
  log.info(`📡 MCP Backend → ${MCP_URL}`)
})

// ═══════════════════════════════════════════════════════════
// Graceful shutdown
// ═══════════════════════════════════════════════════════════

process.on("SIGINT", () => { if (db) db.close(); process.exit(0) })
process.on("SIGTERM", () => { if (db) db.close(); process.exit(0) })
process.on("uncaughtException", (err: Error) => { log.error(`💥 未捕获异常: ${err.message}\n${err.stack}`); setTimeout(() => process.exit(1), 1000) })
process.on("unhandledRejection", (reason: unknown) => { log.error(`💥 未处理 Promise 拒绝: ${reason instanceof Error ? reason.message : String(reason)}`) })
