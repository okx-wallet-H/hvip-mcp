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

const VERSION = "0.3.0"

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

const workers: ReturnType<typeof spawn>[] = []

function startHttpServer(): void {
  const httpServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", `http://${host}:${webPort}`)
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

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
          // 注册到 Hub 内存 + 持久化
          agentHub.registerTask(taskId, title || taskId)
          db?.saveTask({ taskId, status: "unassigned", title: title || taskId })
          if (template && params) taskMeta.set(taskId, { templateId: template, params })
          process.stderr.write(`[Hub] 新任务: ${taskId} "${title}"\n`)
          res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ ok: true, taskId, title }))
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
      if (!taskId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "缺少 taskId" })); return }

      const hubUrl = `ws://127.0.0.1:${wsPort}`
      const repoPath = process.cwd()

      const meta=taskMeta.get(taskId);let promptB64="";if(meta){const tpl=TASK_TEMPLATES.find(t=>t.id===meta.templateId);if(tpl){const p=tpl.buildPrompt(meta.params);promptB64=Buffer.from(p,"utf-8").toString("base64")}}process.stderr.write(`[Hub] 🤖 拉起 Worker: ${taskId}\n`);const workerArgs=["dist/hub-worker.js","--task",taskId,"--hub",hubUrl,"--repo",repoPath];if(promptB64)workerArgs.push("--prompt-b64",promptB64);const worker=spawn("node",workerArgs, {
        cwd: repoPath,
        stdio: "pipe",
        detached: true,
      })
      worker.stdout?.on("data", (d: Buffer) => process.stderr.write(`[Worker-${taskId}] ${d}`))
      worker.stderr?.on("data", (d: Buffer) => process.stderr.write(`[Worker-${taskId}] ${d}`))
      worker.on("error", (e: Error) => process.stderr.write(`[Hub] Worker 启动失败: ${e.message}\n`))
      worker.on("close", (code: number | null) => {
        process.stderr.write(`[Hub] Worker-${taskId} 退出 (${code})\n`)
        const idx = workers.indexOf(worker); if (idx >= 0) workers.splice(idx, 1)
      })
      workers.push(worker)
      process.stderr.write(`[Hub] 活跃 Worker: ${workers.length}\n`)
      // 不 await — detached 让 Worker 独立运行

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: true, taskId, hubUrl, workerPid: worker.pid }))
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

    // 404
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ error: "Not Found" }))
  })

  httpServer.listen(webPort, host, () => {
    process.stderr.write(`[Hub] 🌐 仪表盘 → http://${host}:${webPort}\n`)
  })
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

// 启动 WebSocket Hub
agentHub.start(wsPort, host, VERSION)

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

export {}
