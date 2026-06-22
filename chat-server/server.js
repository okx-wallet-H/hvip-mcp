/**
 * hvip AI 交易助手 — 独立聊天服务器
 *
 * 用法:
 *   cd chat-server && npm install && npm start
 *   node server.js --port 3100 --mcp http://127.0.0.1:9222/mcp
 */

// ── 加载 .env ──
const fs = require("fs"), path = require("path")
const envPath = path.join(__dirname, ".env")
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split(/\r?\n/).forEach(line => {
    const i = line.indexOf("#"); if (i >= 0) line = line.substring(0, i)
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim() || undefined
  })
}
// Also load parent .env if exists
const parentEnv = path.join(__dirname, "..", ".env")
if (fs.existsSync(parentEnv)) {
  fs.readFileSync(parentEnv, "utf-8").split(/\r?\n/).forEach(line => {
    const i = line.indexOf("#"); if (i >= 0) line = line.substring(0, i)
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim() || undefined
  })
}

const crypto = require("crypto")
const http = require("http")
const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk")

// ── CLI args ──
const PORT = parseInt(process.env.CHAT_PORT || process.argv[process.argv.indexOf("--port")+1] || "3100")
const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:9222/mcp"

// ═══════════════════════════════════════════════════════════
// Encryption
// ═══════════════════════════════════════════════════════════
const PBKDF2 = { iter: 100000, keylen: 32, digest: "sha256" }

function hashPin(pin, salt) {
  const s = salt || crypto.randomBytes(32)
  return { hash: crypto.pbkdf2Sync(pin, s, PBKDF2.iter, PBKDF2.keylen, PBKDF2.digest).toString("base64"), salt: s.toString("base64") }
}
function verifyPin(pin, hash, salt) {
  return crypto.timingSafeEqual(Buffer.from(hashPin(pin, Buffer.from(salt, "base64")).hash, "base64"), Buffer.from(hash, "base64"))
}
function deriveKey(pin, salt) { return crypto.pbkdf2Sync(pin, salt, PBKDF2.iter, PBKDF2.keylen, PBKDF2.digest) }
function encrypt(text, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 })
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: enc.toString("base64") }
}
function decrypt(iv, tag, data, key) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"), { authTagLength: 16 })
  d.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8")
}

// ═══════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════
let db = null
try { db = new (require("node:sqlite").DatabaseSync)(path.join(__dirname, "chat.db"), { create: true }) } catch (e) { console.error("SQLite不可用:", e.message); process.exit(1) }

db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, pin_salt TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, enc_data TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, key_salt TEXT NOT NULL, is_demo INTEGER DEFAULT 0, key_hint TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT DEFAULT '新对话', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_calls TEXT, token_in INTEGER DEFAULT 0, token_out INTEGER DEFAULT 0, model TEXT, created_at TEXT DEFAULT (datetime('now')));
`)
  try { db.exec("ALTER TABLE messages ADD COLUMN tool_calls TEXT DEFAULT NULL") } catch (e) {}

function dbRun(sql, ...params) { try { return db.prepare(sql).run(...params) } catch (e) { console.error("DB:", e.message) } }
function dbGet(sql, ...params) { try { return db.prepare(sql).get(...params) } catch (e) { return null } }
function dbAll(sql, ...params) { try { return db.prepare(sql).all(...params) } catch (e) { return [] } }

// ═══════════════════════════════════════════════════════════
// Auth Store (内存，30分钟过期)
// ═══════════════════════════════════════════════════════════
const authStore = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of authStore) { if (now - v.at > 30*60*1000) authStore.delete(k) }
}, 60000)

// ═══════════════════════════════════════════════════════════
// Chat LLM
// ═══════════════════════════════════════════════════════════
const LLM_KEY = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY || ""
const LLM_URL = process.env.DEEPSEEK_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic"
const LLM_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6"
const llmClient = LLM_KEY ? new Anthropic({ apiKey: LLM_KEY, baseURL: LLM_URL }) : null
console.log(llmClient ? `LLM: ${LLM_MODEL} @ ${LLM_URL}` : "WARN: LLM未配置")

const TOOLS = [
  { name: "okx_get_ticker", description: "查任意币种实时价格：最新价/24h高低/成交量。", input_schema: { type: "object", properties: { instId: { type: "string", description: "如BTC-USDT" } }, required: ["instId"] } },
  { name: "okx_quick_market", description: "单产品综合行情：价格+深度+资金费率。", input_schema: { type: "object", properties: { instId: { type: "string" } }, required: ["instId"] } },
  { name: "okx_get_funding_rate", description: "永续合约当前资金费率。", input_schema: { type: "object", properties: { instId: { type: "string" } }, required: ["instId"] } },
  { name: "okx_get_candles", description: "K线(OHLCV)数据。", input_schema: { type: "object", properties: { instId: { type: "string" }, bar: { type: "string", description: "1m/5m/15m/1H/4H/1D" }, limit: { type: "number" } }, required: ["instId"] } },
  { name: "okx_indicator", description: "技术指标：RSI/MACD/布林带/EMA/超级趋势。", input_schema: { type: "object", properties: { instId: { type: "string" }, indicator: { type: "string", enum: ["rsi","macd","bb","ema","supertrend","pattern"] }, bar: { type: "string" } }, required: ["instId","indicator"] } },
  { name: "agent_market_sentiment", description: "市场情绪仪表盘(0-100)综合打分。", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "agent_market_scan", description: "市场异动扫描：涨跌/成交量/费率异常。", input_schema: { type: "object", properties: { sortBy: { type: "string", enum: ["change","vol","fundingRate"] }, topN: { type: "number" } }, required: [] } },
  { name: "okx_get_orderbook", description: "订单簿深度：买一卖一+档位。", input_schema: { type: "object", properties: { instId: { type: "string" }, sz: { type: "number" } }, required: ["instId"] } },
  { name: "okx_get_instruments", description: "可用交易对列表。", input_schema: { type: "object", properties: { instType: { type: "string", enum: ["SPOT","SWAP","FUTURES","OPTION"] } }, required: ["instType"] } },
  { name: "okx_account_overview", description: "账户全景：总权益+余额+持仓。(需Key)", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "okx_get_balance", description: "账户余额：各币种可用/冻结。(需Key)", input_schema: { type: "object", properties: { ccy: { type: "string" } }, required: [] } },
  { name: "okx_get_positions", description: "当前持仓：数量/开仓价/盈亏。(需Key)", input_schema: { type: "object", properties: { instId: { type: "string" } }, required: [] } },
  { name: "okx_place_order", description: "下单：市价/限价。(需Key)", input_schema: { type: "object", properties: { instId: { type: "string" }, tdMode: { type: "string", enum: ["isolated","cross","cash"] }, side: { type: "string", enum: ["buy","sell"] }, ordType: { type: "string", enum: ["market","limit"] }, sz: { type: "string" }, posSide: { type: "string", enum: ["long","short"] } }, required: ["instId","tdMode","side","ordType","sz"] } },
  { name: "okx_get_order", description: "查询订单状态。(需Key)", input_schema: { type: "object", properties: { instId: { type: "string" }, ordId: { type: "string" } }, required: ["instId"] } },
  { name: "okx_cancel_order", description: "撤销未成交订单。(需Key)", input_schema: { type: "object", properties: { instId: { type: "string" }, ordId: { type: "string" } }, required: ["instId","ordId"] } },
  { name: "agent_quick_trade", description: "一键智能交易。(需Key)", input_schema: { type: "object", properties: { instId: { type: "string" }, side: { type: "string", enum: ["buy","sell"] }, sz: { type: "string" }, posSide: { type: "string", enum: ["long","short"] }, tdMode: { type: "string", enum: ["isolated","cross"] } }, required: ["instId","side","sz"] } },
  { name: "agent_risk_overview", description: "风险仪表盘。(需Key)", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "agent_funding_overview", description: "资金总览。(需Key)", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "agent_catalog", description: "全局工具导航。", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "okx_get_mark_price", description: "标记价格（合约强平参考）。", input_schema: { type: "object", properties: { instId: { type: "string" } }, required: ["instId"] } },
]

const SYSTEM_PROMPT = `你是 hvip AI 交易助手。用户问什么答什么，没提币种别查行情，没要分析别写报告。
规则：1.查数据必须调工具，严禁编造数字。2.回答简洁，中文。3.下单前确认用户意图。`

async function callMCPTool(name, args, auth) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" }
  if (auth?.apiKey) {
    headers["X-OKX-Api-Key"] = auth.apiKey
    headers["X-OKX-Secret"] = auth.secret
    headers["X-OKX-Passphrase"] = auth.passphrase
    if (auth.isDemo) headers["X-OKX-Demo"] = "true"
  }
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name, arguments: args }, id: Date.now() }) })
  const text = await res.text()
  let parsed = null
  for (const line of text.split("\n").reverse()) {
    if (line.startsWith("data: ")) { try { parsed = JSON.parse(line.slice(6)); break } catch (e) {} }
  }
  if (!parsed) { try { parsed = JSON.parse(text) } catch (e) {} }
  if (!parsed) return { error: "数据服务暂不可用" }
  if (parsed.error) return { error: parsed.error.message || "工具错误" }
  let result = parsed.result?.content?.[0]?.text || parsed.result
  if (typeof result === "string") { try { result = JSON.parse(result) } catch (e) {} }
  return result
}

async function* streamChat(messages, userAuth) {
  if (!llmClient) { yield { type: "error", message: "AI服务未配置" }; return }
  const anthroMsgs = []
  for (const m of messages) {
    if (m.role === "user") anthroMsgs.push({ role: "user", content: m.content || "" })
    else if (m.role === "assistant") {
      const c = []; if (m.content) c.push({ type: "text", text: m.content })
      let tools = m.tool_calls
      if (typeof tools === "string") { try { tools = JSON.parse(tools) } catch (e) { tools = null } }
      const toolResults = []
      if (tools) for (const tc of tools) {
        if (!tc) continue
        let inp = tc.input || {}
        if (typeof inp === "string") { try { inp = JSON.parse(inp) } catch (e) { inp = {} } }
        c.push({ type: "tool_use", id: tc.id, name: tc.name, input: inp })
        if (tc.result) {
          const rs = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)
          toolResults.push({ tool_use_id: tc.id, content: rs })
        }
      }
      anthroMsgs.push({ role: "assistant", content: c.length ? c : m.content || "" })
      if (toolResults.length) anthroMsgs.push({ role: "user", content: toolResults.map(r => ({ type: "tool_result", tool_use_id: r.tool_use_id, content: r.content })) })
    } else if (m.role === "tool" && m.tool_call_id) {
      anthroMsgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content || "" }] })
    }
  }

  let totalIn = 0, totalOut = 0, finalText = ""
  for (let step = 0; step < 5; step++) {
    let toolUses = []
    const textChunks = []
    try {
      const stream = await llmClient.messages.create({ model: LLM_MODEL, max_tokens: 4096, temperature: 0.3, system: SYSTEM_PROMPT, messages: anthroMsgs, tools: TOOLS, stream: true })
      for await (const ev of stream) {
        if (ev.type === "message_start") totalIn += ev.message.usage.input_tokens
        else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") toolUses.push(ev.content_block)
        else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) { textChunks.push(ev.delta.text); yield { type: "text", delta: ev.delta.text } }
        else if (ev.type === "message_delta") totalOut += ev.usage.output_tokens
      }
    } catch (e) { yield { type: "error", message: e.message }; return }
    finalText += textChunks.join("")
    if (!toolUses.length) { yield { type: "done", text: finalText, tokens: { input: totalIn, output: totalOut }, model: LLM_MODEL }; return }

    // Re-fetch for full tool blocks
    const complete = await llmClient.messages.create({ model: LLM_MODEL, max_tokens: 4096, temperature: 0.3, system: SYSTEM_PROMPT, messages: anthroMsgs, tools: TOOLS, stream: false })
    totalIn += complete.usage.input_tokens; totalOut += complete.usage.output_tokens
    const fullTools = complete.content.filter(b => b.type === "tool_use")
    const asstContent = complete.content.map(b => {
      if (b.type === "text") return { type: "text", text: b.text }
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input }
      return { type: "text", text: "" }
    })
    anthroMsgs.push({ role: "assistant", content: asstContent })

    const toolResults = []
    for (const tu of fullTools) {
      yield { type: "tool_start", toolId: tu.id, toolName: tu.name, toolInput: tu.input }
      const start = Date.now()
      try {
        const result = await callMCPTool(tu.name, tu.input, userAuth)
        const dur = Date.now() - start
        const rs = typeof result === "string" ? result : JSON.stringify(result)
        yield { type: "tool_end", toolId: tu.id, toolName: tu.name, toolResult: result, toolDuration: dur }
        toolResults.push({ tool_use_id: tu.id, content: rs })
      } catch (e) {
        yield { type: "tool_end", toolId: tu.id, toolName: tu.name, toolError: e.message, toolDuration: Date.now() - start }
        toolResults.push({ tool_use_id: tu.id, content: JSON.stringify({ error: e.message }) })
      }
    }
    anthroMsgs.push({ role: "user", content: toolResults.map(r => ({ type: "tool_result", tool_use_id: r.tool_use_id, content: r.content })) })
  }
  yield { type: "done", text: finalText, tokens: { input: totalIn, output: totalOut }, model: LLM_MODEL }
}

// ═══════════════════════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════════════════════
function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" })
  res.end(JSON.stringify(data))
}

function validateSession(token) {
  if (!token) return null
  const mem = authStore.get(token)
  if (mem && Date.now() - mem.at < 30 * 60 * 1000) {
    const dbCheck = dbGet("SELECT user_id, username FROM sessions WHERE id = ?", token)
    if (dbCheck) return { userId: mem.userId, username: mem.username }
  }
  const row = dbGet("SELECT s.user_id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?", token)
  if (!row) return null
  if (new Date(row.expires_at) < new Date()) { dbRun("DELETE FROM sessions WHERE id = ?", token); return null }
  return { userId: row.user_id, username: row.username }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { json(res, 204, {}); return }

  // GET / — chat UI
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const chatHtml = path.join(__dirname, "chat-app", "index.html")
    if (fs.existsSync(chatHtml)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(fs.readFileSync(chatHtml, "utf-8")); return }
    json(res, 404, { error: "找不到 chat-app/index.html" }); return
  }

  // GET /health
  if (req.method === "GET" && req.url === "/health") { json(res, 200, { status: "ok", name: "hvip-chat", llm: !!llmClient }); return }

  // POST /api/v2/auth/register
  if (req.method === "POST" && req.url === "/api/v2/auth/register") {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      try { const { username, pin } = JSON.parse(body)
        if (!username || !pin || username.length < 3 || pin.length < 4) { json(res, 400, { ok: false, error: "用户名3-20字符，PIN至少4位" }); return }
        const { hash, salt } = hashPin(pin)
        try { dbRun("INSERT INTO users (username, pin_hash, pin_salt) VALUES (?, ?, ?)", username, hash, salt)
          const u = dbGet("SELECT id FROM users WHERE username = ?", username)
          json(res, 201, { ok: true, userId: u?.id }) } catch (e) { json(res, 409, { ok: false, error: e.message.includes("UNIQUE") ? "用户名已存在" : e.message }) }
      } catch (e) { json(res, 400, { ok: false, error: "JSON解析失败" }) }
    }); return
  }

  // POST /api/v2/auth/unlock
  if (req.method === "POST" && req.url === "/api/v2/auth/unlock") {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      try { const { username, pin } = JSON.parse(body)
        const u = dbGet("SELECT id, pin_hash, pin_salt FROM users WHERE username = ?", username)
        if (!u) { json(res, 401, { ok: false, error: "用户不存在" }); return }
        if (!verifyPin(pin, u.pin_hash, u.pin_salt)) { json(res, 401, { ok: false, error: "PIN错误" }); return }
        // Decrypt keys
        const k = dbGet("SELECT enc_data, iv, tag, key_salt, key_hint FROM api_keys WHERE user_id = ?", u.id)
        let hasKeys = false, keyHint = null, cred = null
        if (k) {
          try {
            const key = deriveKey(pin, Buffer.from(k.key_salt, "base64"))
            const packed = decrypt(k.iv, k.tag, k.enc_data, key)
            const parts = packed.split("::")
            cred = { apiKey: parts[0], secret: parts[1], passphrase: parts[2], isDemo: parts[3] === "1" }
            hasKeys = true; keyHint = k.key_hint
          } catch (e) { /* decrypt failed */ }
        }
        const token = crypto.randomBytes(32).toString("hex")
        const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
        dbRun("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", token, u.id, expires)
        authStore.set(token, { userId: u.id, username, cred: cred || { apiKey: "", secret: "", passphrase: "", isDemo: false }, at: Date.now() })
        json(res, 200, { ok: true, sessionToken: token, username, hasKeys, keyHint: keyHint || null })
      } catch (e) { json(res, 400, { ok: false, error: "JSON解析失败" }) }
    }); return
  }

  // POST /api/v2/auth/lock
  if (req.method === "POST" && req.url === "/api/v2/auth/lock") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    authStore.delete(token); dbRun("DELETE FROM sessions WHERE id = ?", token)
    json(res, 200, { ok: true }); return
  }

  // GET /api/v2/auth/status
  if (req.method === "GET" && req.url === "/api/v2/auth/status") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { authenticated: false, error: "会话无效" }); return }
    const k = dbGet("SELECT key_hint FROM api_keys WHERE user_id = ?", s.userId)
    json(res, 200, { authenticated: true, username: s.username, hasKeys: !!k, keyHint: k?.key_hint || null }); return
  }

  // PUT /api/v2/auth/keys
  if (req.method === "PUT" && req.url === "/api/v2/auth/keys") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { ok: false, error: "会话无效" }); return }
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      try { const { apiKey, secret, passphrase, isDemo, pin } = JSON.parse(body)
        if (!apiKey || !secret || !passphrase || !pin) { json(res, 400, { ok: false, error: "缺少参数" }); return }
        // Verify PIN
        const u = dbGet("SELECT pin_hash, pin_salt FROM users WHERE id = ?", s.userId)
        if (!verifyPin(pin, u.pin_hash, u.pin_salt)) { json(res, 400, { ok: false, error: "PIN错误" }); return }
        const keySalt = crypto.randomBytes(32)
        const key = deriveKey(pin, keySalt)
        const packed = [apiKey, secret, passphrase, isDemo ? "1" : "0"].join("::")
        const { iv, tag, data } = encrypt(packed, key)
        dbRun("INSERT OR REPLACE INTO api_keys (user_id, enc_data, iv, tag, key_salt, is_demo, key_hint) VALUES (?, ?, ?, ?, ?, ?, ?)", s.userId, data, iv, tag, keySalt.toString("base64"), isDemo ? 1 : 0, apiKey.slice(0, 4) + "****")
        // Update authStore
        const mem = authStore.get(token)
        if (mem) mem.cred = { apiKey, secret, passphrase, isDemo: !!isDemo }
        json(res, 200, { ok: true })
      } catch (e) { json(res, 400, { ok: false, error: "JSON解析失败" }) }
    }); return
  }

  // GET /api/v2/auth/keys
  if (req.method === "GET" && req.url === "/api/v2/auth/keys") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { ok: false, error: "会话无效" }); return }
    const k = dbGet("SELECT key_hint FROM api_keys WHERE user_id = ?", s.userId)
    json(res, 200, { hasKeys: !!k, keyHint: k?.key_hint || null }); return
  }

  // POST /api/v2/chat/stream
  if (req.method === "POST" && req.url === "/api/v2/chat/stream") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { error: "会话无效" }); return }
    const mem = authStore.get(token)
    const userAuth = (mem?.cred?.apiKey) ? mem.cred : undefined

    let body = ""; req.on("data", c => body += c); req.on("end", async () => {
      try {
        const { messages, conversationId } = JSON.parse(body)
        if (!Array.isArray(messages)) { json(res, 400, { error: "缺少messages" }); return }
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" })
        try {
          for await (const ev of streamChat(messages, userAuth)) {
            res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
            if ((ev.type === "done" || ev.type === "error") && conversationId) {
              try { dbRun("INSERT INTO messages (conversation_id, role, content, token_in, token_out, model) VALUES (?, ?, ?, ?, ?, ?)", conversationId, "assistant", ev.text || ev.message || "", ev.tokens?.input || 0, ev.tokens?.output || 0, ev.model || null) } catch (e) {}
            }
          }
        } catch (e) { res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`) }
        res.end()
      } catch (e) { json(res, 400, { error: "JSON解析失败" }) }
    }); return
  }

  // POST /api/v2/chat/sessions
  if (req.method === "POST" && req.url === "/api/v2/chat/sessions") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { ok: false, error: "会话无效" }); return }
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      try { const { title } = JSON.parse(body)
        const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)
        dbRun("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)", id, s.userId, title || "新对话")
        json(res, 201, { ok: true, id })
      } catch (e) { json(res, 400, { ok: false, error: "JSON解析失败" }) }
    }); return
  }

  // GET /api/v2/chat/sessions
  if (req.method === "GET" && req.url === "/api/v2/chat/sessions") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, []); return }
    const convs = dbAll("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50", s.userId)
    json(res, 200, convs); return
  }

  // GET /api/v2/chat/history
  if (req.method === "GET" && req.url?.startsWith("/api/v2/chat/history") && !req.url.includes("/save")) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, []); return }
    const url = new URL(req.url, "http://localhost")
    const cid = url.searchParams.get("conversationId")
    if (!cid) { json(res, 400, { error: "缺少conversationId" }); return }
    const msgs = dbAll("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 100", cid)
    json(res, 200, msgs); return
  }

  // POST /api/v2/chat/history/save
  if (req.method === "POST" && req.url === "/api/v2/chat/history/save") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { ok: false }); return }
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      try { const { conversationId, role, content, toolCalls } = JSON.parse(body)
        dbRun("INSERT INTO messages (conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?)", conversationId, role, content || "", toolCalls || null)
        json(res, 201, { ok: true })
      } catch (e) { json(res, 400, { ok: false }) }
    }); return
  }

  // DELETE /api/v2/chat/history
  if (req.method === "DELETE" && req.url?.startsWith("/api/v2/chat/history")) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    const s = validateSession(token)
    if (!s) { json(res, 401, { ok: false }); return }
    const url = new URL(req.url, "http://localhost")
    const cid = url.searchParams.get("conversationId")
    if (!cid) { json(res, 400, { error: "缺少conversationId" }); return }
    dbRun("DELETE FROM messages WHERE conversation_id = ?", cid)
    dbRun("DELETE FROM conversations WHERE id = ?", cid)
    json(res, 200, { ok: true }); return
  }

  json(res, 404, { error: "Not Found" })
})

server.listen(PORT, () => {
  console.log(`hvip-chat 启动: http://0.0.0.0:${PORT}`)
  console.log(`MCP: ${MCP_URL}`)
})

process.on("SIGINT", () => { db?.close(); process.exit(0) })
process.on("SIGTERM", () => { db?.close(); process.exit(0) })
