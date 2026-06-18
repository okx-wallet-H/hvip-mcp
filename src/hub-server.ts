/**
 * Agent Hub 独立服务器
 *
 * 不依赖 MCP server，可 7×24 守护运行。
 * 持久化 tasks + messages 到 SQLite，重启不丢状态。
 * 内置 HTTP 仪表盘 — 浏览器打开即可监控所有 Agent 活动。
 *
 * Usage:
 *   node dist/hub-server.js
 *   node dist/hub-server.js --port 9321 --host 0.0.0.0 --web-port 3000
 *
 * PM2:
 *   pm2 start dist/hub-server.js --name hvip-hub
 */

import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { spawn } from "node:child_process"
import { URL } from "node:url"
import { agentHub } from "./adapters/agent-hub.js"
import { HubDB } from "./adapters/hub-persistence.js"
import { HubMemory } from "./adapters/hub-memory.js"
import { HubRegistry } from "./adapters/hub-registry.js"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { TASK_TEMPLATES } from "./adapters/hub-templates.js"

const VERSION = "0.4.3"

// ── 仪表盘 HTML — 从文件读取 ──
function getDashboardHtml(host, port){const paths=[join(__dirname,"web","dashboard.html"),join(__dirname,"..","src","web","dashboard.html")];for(const p of paths){if(existsSync(p))return readFileSync(p,"utf-8").replace("HUB_HOST",host).replace("WS_PORT = 0","WS_PORT = "+port)}return "<html><body><h2>dashboard.html not found</h2></body></html>"}
const taskMeta=new Map()

// ── CLI 参数 ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

const wsPort   = parseInt(flag("port")     || process.env.HUB_PORT      || "9321", 10)
const host     = flag("host")              || process.env.HUB_HOST      || "127.0.0.1"
const webPort  = parseInt(flag("web-port") || process.env.HUB_WEB_PORT  || "3000", 10)
const dbPath   = flag("db")               || process.env.HUB_DB_PATH   || ".hub/hub.db"

const token = process.env.HUB_AUTH_TOKEN || ""  // PSK 鉴权令牌
const workers: ReturnType<typeof spawn>[] = []

// taskId 白名单校验 — 防止路径遍历注入
function validateTaskId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && !id.includes("..") && id.length <= 64
}

// ── Worker 启动器（复用） ──
function spawnWorker(taskId: string): { ok: boolean; error?: string; workerPid?: number } {
  const hubUrl = `ws://127.0.0.1:${wsPort}`
  const repoPath = process.cwd()
  const meta = taskMeta.get(taskId); let promptB64 = ""
  if (meta) {
    const tpl = TASK_TEMPLATES.find(t => t.id === meta.templateId)
    if (tpl) { const p = tpl.buildPrompt(meta.params); promptB64 = Buffer.from(p, "utf-8").toString("base64") }
  }
  const workerArgs = ["dist/hub-worker.js", "--task", taskId, "--hub", hubUrl, "--repo", repoPath, "--web-port", String(webPort)]
  if (promptB64) workerArgs.push("--prompt-b64", promptB64)

  try {
    const worker = spawn("node", workerArgs, { cwd: repoPath, stdio: "pipe", detached: true })
    worker.stdout?.on("data", (d: Buffer) => process.stderr.write(`[Worker-${taskId}] ${d}`))
    worker.stderr?.on("data", (d: Buffer) => process.stderr.write(`[Worker-${taskId}] ${d}`))
    worker.on("error", (e: Error) => process.stderr.write(`[Hub] Worker 启动失败: ${e.message}\n`))
    worker.on("close", (code: number | null) => {
      process.stderr.write(`[Hub] Worker-${taskId} 退出 (${code})\n`)
      const idx = workers.indexOf(worker); if (idx >= 0) workers.splice(idx, 1)
    })
    workers.push(worker)
    process.stderr.write(`[Hub] 活跃 Worker: ${workers.length}\n`)
    return { ok: true, workerPid: worker.pid }
  } catch (e: any) {
    process.stderr.write(`[Hub] Worker 启动异常: ${e.message}\n`)
    return { ok: false, error: e.message }
  }
}

function startHttpServer(): void {
  const httpServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    // ── Auth guard: PSK token 校验（/health 例外） ──
    if (token && _req.url !== "/health") {
      const provided = _req.headers["authorization"]?.replace(/^Bearer\s+/i, "") || ""
      if (provided !== token) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized" }))
        return
      }
    }

    // CORS
    res.setHeader("Access-Control-Allow-Origin", `http://${host}:${webPort}`)
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

    if (_req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    // GET / — 仪表盘
    if (_req.method === "GET" && (_req.url === "/" || _req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(getDashboardHtml(host,wsPort))
      return
    }

    // GET /api/status — JSON 快照
    if (_req.method === "GET" && _req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(agentHub.status()))
      return
    }

    // ── POST /api/tasks — 创建任务 ──
    if (_req.method === "POST" && _req.url === "/api/tasks") {
      const chunks: Buffer[] = []
      _req.on("data", (c: Buffer) => chunks.push(c))
      _req.on("end", () => {
        try {
          const { taskId, title, template, params } = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
          if (!taskId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "缺少 taskId" })); return }
          if (!validateTaskId(taskId)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "taskId 格式无效，仅允许字母数字下划线连字符" })); return }
          // 注册到 Hub 内存 + 持久化
          agentHub.registerTask(taskId, title || taskId)
          db?.saveTask({ taskId, status: "unassigned", title: title || taskId })
          if (template && params) taskMeta.set(taskId, { templateId: template, params })
          // 有模板 → 自动拉起 Worker
          let spawned = false; let workerPid = 0
          if (template) { const result = spawnWorker(taskId); spawned = result.ok; workerPid = result.workerPid || 0 }
          process.stderr.write(`[Hub] 新任务: ${taskId} "${title}"${spawned ? ' 🤖 已拉起' : ''}\n`)
          res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ ok: true, taskId, title, spawned, workerPid }))
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ error: "JSON 解析失败" }))
        }
      })
      return
    }

    // ── POST /api/tasks/<id>/spawn — 拉起 Worker ──
    if (_req.method === "POST" && _req.url?.startsWith("/api/tasks/") && _req.url.endsWith("/spawn")) {
      const rawId = _req.url.slice("/api/tasks/".length, -"/spawn".length)
      const taskId = decodeURIComponent(rawId)
      if (!taskId || !validateTaskId(taskId)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "taskId 缺失或格式无效" })); return }

      const result = spawnWorker(taskId)
      res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: result.ok, taskId, workerPid: result.workerPid }))
      return
    }

    // ── Memory API ──
    if (_req.method === "POST" && _req.url === "/api/memory") {
      const chunks: Buffer[] = []
      _req.on("data", (c: Buffer) => chunks.push(c))
      _req.on("end", () => {
        try {
          const { type, text, agentId, tags, confidence, parentId } = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
          if (!text || !agentId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "text + agentId required" })); return }
          const entry = memory.store({ type, agentId, text, tags, confidence, parentId })
          res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify(entry))
        } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "JSON parse error" })) }
      })
      return
    }
    if (_req.method === "GET" && _req.url === "/api/memory/stats") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(memory.stats()))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/memory/search")) {
      const url = new URL(_req.url, `http://${host}:${webPort}`)
      const q = url.searchParams.get("q") || ""
      const entries = memory.search(q, 30)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entries))
      return
    }
    if (_req.method === "GET" && _req.url === "/api/memory") {
      const entries = memory.recent(30)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entries))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/memory/by-id/")) {
      const id = _req.url.slice("/api/memory/by-id/".length)
      const entry = memory.get(id)
      if (!entry) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "not found" })); return }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entry))
      return
    }

    // DELETE /api/memory/:id — 删除记忆
    if (_req.method === "DELETE" && _req.url?.startsWith("/api/memory/")) {
      const id = _req.url.slice("/api/memory/".length)
      if (!id) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "missing id" })); return }
      const ok = memory.delete(id)
      res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok }))
      return
    }

    // GET /api/memory/for-task?q= — Agent 执行前检索知识库
    if (_req.method === "GET" && _req.url?.startsWith("/api/memory/for-task")) {
      const u = new URL(_req.url, "http://" + host + ":" + String(webPort))
      const q = u.searchParams.get("q") || ""
      const entries = memory.search(q, 5)
      let ctx = ""
      if (entries.length > 0) {
        ctx = entries.map(function(e, i) { return "### [" + e.type + "] " + e.text.substring(0, 500) }).join("\n\n---\n\n")
        ctx = "\n\n## Knowledge Base (from shared memory)\n\n" + ctx
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ entries: entries, context: ctx, hit: entries.length }))
      return
    }

        // ── Registry API (MCP商店) ──
    if (_req.method === "GET" && _req.url === "/api/store") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(registry.byCategory()))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/store/search")) {
      const qs = (_req.url || "").split("?")[1] || ""; const params = new Map<string,string>()
      qs.split("&").forEach(p => { const [k,v] = p.split("="); if(k) params.set(decodeURIComponent(k), decodeURIComponent(v||"")) })
      const q = params.get("q") || ""; const cat = params.get("cat") || ""
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(registry.search(q, cat || undefined, 30)))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/store/")) {
      const id = _req.url.slice("/api/store/".length)
      const p = registry.get(id);
      if (!p) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "not found" })); return }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(p)); return
    }
    if (_req.method === "POST" && _req.url === "/api/store") {
      const chunks: Buffer[] = []; _req.on("data",(c:Buffer)=>chunks.push(c)); _req.on("end",()=>{
        try { const b = JSON.parse(Buffer.concat(chunks).toString("utf-8")); const p = registry.add(b); res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(p)) }
        catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "parse error" })) }
      }); return
    }

    // GET /api/templates
    if (_req.method === "GET" && _req.url === "/api/templates") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(TASK_TEMPLATES.map(t=>({id:t.id,name:t.name,description:t.description,prefix:t.prefix,fields:t.fields}))))
      return
    }

    // GET /api/health
    if (_req.method === "GET" && _req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ status: "ok", name: "hvip-hub", version: VERSION, wsPort, webPort, db: dbPath, registry: registry.all().length + " plugins" }))
      return
    }

    // ── API: 定时任务状态 ──
    if (_req.method === "GET" && _req.url === "/api/schedules") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(schedules.map(s => ({ id: s.id, name: s.name, interval: s.interval, nextRun: s.lastRun + (s.count === 0 ? 30000 : s.interval), count: s.count, failCount: s.failCount }))))
      return
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ error: "Not Found" }))
  })

  httpServer.listen(webPort, host, () => {
    process.stderr.write(`[Hub] 🌐 仪表盘 → http://${host}:${webPort}\n`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 定时任务调度器
// ═══════════════════════════════════════════════════════════════════════════

interface ScheduledJob {
  id: string; name: string; interval: number; template: string; params: Record<string, string>
  lastRun: number; count: number; failCount: number; timer: ReturnType<typeof setTimeout> | null
}

const schedules: ScheduledJob[] = [
  {
    id: "sched-analyst", name: "行情分析师",
    interval: 4 * 3600_000,
    template: "role-analyst",
    params: { symbols: "BTC/USDT, ETH/USDT, SOL/USDT", timeframes: "4h, 1d", focus: "趋势方向+支撑阻力+资金费率" },
    lastRun: 0, count: 0, failCount: 0, timer: null,
  },
  {
    id: "sched-quant", name: "量化研究员",
    interval: 8 * 3600_000,
    template: "role-quant",
    params: { strategy: "RSI(14) vs SuperTrend(10,3) vs MACD — VBT PRO 回测对比优化", symbols: "BTC/USDT, ETH/USDT", timeframe: "4h" },
    lastRun: 0, count: 0, failCount: 0, timer: null,
  },
  {
    id: "sched-curator", name: "知识策展人",
    interval: 12 * 3600_000,
    template: "role-curator",
    params: { topic: "全面整理", action: "去重合并+标记低置信度+补充缺失" },
    lastRun: 0, count: 0, failCount: 0, timer: null,
  },
  {
    id: "sched-engineer", name: "资深工程师",
    interval: 24 * 3600_000,
    template: "role-engineer",
    params: { scope: "全面审查 src/ 错误处理/类型安全/性能", priority: "P0" },
    lastRun: 0, count: 0, failCount: 0, timer: null,
  },
]

function runScheduledJob(job: ScheduledJob): void {
  const taskId = `${job.id}-${Date.now().toString(36)}`
  const title = `[定时] ${job.name} #${job.count + 1}`
  process.stderr.write(`[Scheduler] ⏰ ${job.name} → ${taskId}\n`)
  agentHub.registerTask(taskId, title)
  db?.saveTask({ taskId, status: "unassigned", title })
  taskMeta.set(taskId, { templateId: job.template, params: job.params })
  const result = spawnWorker(taskId)
  if (result.ok) { job.count++; job.failCount = 0 }
  else { job.failCount++; process.stderr.write(`[Scheduler] ❌ ${job.name}: ${result.error}\n`) }
  job.lastRun = Date.now()
  scheduleNext(job)
}

function scheduleNext(job: ScheduledJob): void {
  const delay = job.count === 0 ? 30000 : job.interval
  job.timer = setTimeout(() => runScheduledJob(job), delay)
}

function startScheduler(): void {
  for (const job of schedules) scheduleNext(job)
  process.stderr.write(`[Scheduler] 📅 ${schedules.length} 个定时任务 (首次30s后触发)\n`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════════════════

const banner = [
  `╔══════════════════════════════════════════════════╗`,
  `║  🤖 Agent Hub v${VERSION}  独立服务器              ║`,
  `║  📡 WebSocket → ws://${host}:${String(wsPort).padEnd(35)}║`,
  `║  🌐 仪表盘   → http://${host}:${String(webPort).padEnd(34)}║`,
  `║  💾 ${dbPath.padEnd(42)}║`,
  `╚══════════════════════════════════════════════════╝`,
].join("\n")

process.stderr.write(banner + "\n")

// 持久化
const db = new HubDB(dbPath)
if (db.open()) {
  agentHub.setDB(db)
  const stats = db.stats()
  process.stderr.write(`[Hub] DB 状态: ${stats.taskCount} tasks, ${stats.messageCount} messages\n`)
}

// 记忆系统
const memoryPath = flag("memory-db") || process.env.HUB_MEMORY_DB || ".hub/memory.db"
const memory = new HubMemory(memoryPath)
const memOk = memory.open()
if (memOk) {
  const ms = memory.stats()
  process.stderr.write(`[Hub] 🧠 记忆: ${ms.total} 条 (doc:${ms.byType.doc||0} directive:${ms.byType.directive||0} memory:${ms.byType.memory||0} skill:${ms.byType.skill||0})\n`)
}

// 插件商店
const registryPath = flag("registry-db") || process.env.HUB_REGISTRY_DB || ".hub/registry.db"
const registry = new HubRegistry(registryPath)
registry.open()

// 启动 HTTP 仪表盘
startHttpServer()

// 启动定时任务
startScheduler()

// 启动 WebSocket Hub
agentHub.start(wsPort, host, VERSION, token)

// ── 优雅退出 ──────────────────────────────────────────────────────────────

function shutdown() {
  process.stderr.write("\n[Hub] 正在关闭...\n")
  for (const w of workers) { try { w.kill() } catch {} }
  agentHub.close()
  db.close()
  memory.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// ── 保活 ──────────────────────────────────────────────────────────────────

const keepAlive = setInterval(() => {}, 60_000)
process.on("exit", () => clearInterval(keepAlive))
