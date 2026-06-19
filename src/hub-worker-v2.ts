/**
 * Hub Worker v2 — AI SDK 执行引擎
 * ===================================
 * 基于 Anthropic SDK (DeepSeek 端点) 的常驻 Worker 进程。
 *
 * 生命周期:
 *   PM2 启动 → 连 Hub → 注册 → 空闲等待 → 收到 task:dispatch
 *   → AgentLoop 执行 → 流式推送进度 → 完成任务 → 回到空闲
 *
 * 与 v1 的区别:
 *   v1: hub spawn CLI 进程 → pipe stdout
 *   v2: 常驻进程 → Anthropic SDK → streaming + tool loop
 */

import { WebSocket } from "ws"
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, resolve } from "node:path"
import { AgentLoop, type AgentTool } from "./adapters/ai-sdk.js"
import { logger } from "./utils/logger.js"
import { circuitBreaker } from "./adapters/circuit-breaker.js"

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

const HUB_URL = process.env.HUB_URL || "ws://127.0.0.1:9321"
const REPO_PATH = resolve(process.env.REPO_PATH || process.cwd())
const WORKER_ID = `worker-${process.pid}-${Date.now()}`
const WORKER_NAME = process.env.WORKER_NAME || `Worker·${WORKER_ID.slice(0, 12)}`
const MAX_TOKENS = parseInt(process.env.WORKER_MAX_TOKENS || "8000", 10)
const MAX_STEPS = parseInt(process.env.WORKER_MAX_STEPS || "15", 10)

const log = logger(`Worker-${WORKER_ID.slice(0, 8)}`)
const agent = new AgentLoop()

let ws: WebSocket
let currentTaskId: string | null = null
let heartbeatTimer: ReturnType<typeof setInterval>

// ═══════════════════════════════════════════════════════════════
// Tool Set — Worker's capabilities exposed to AI
// ═══════════════════════════════════════════════════════════════

const TOOLS: Record<string, AgentTool> = {
  read_file: {
    name: "read_file",
    description: "读取仓库中的文件内容。传入相对于仓库根目录的路径。",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "文件路径，如 src/hub-server.ts" } },
      required: ["path"],
    },
    async execute(input) {
      const p = (input.path as string || "").replace(/\\/g, "/")
      if (p.includes("..")) return { error: "路径遍历不允许" }
      const full = join(REPO_PATH, p)
      if (!existsSync(full)) return { error: `文件不存在: ${p}` }
      try {
        const stat = statSync(full)
        if (!stat.isFile()) return { error: `不是文件: ${p}` }
        if (stat.size > 500_000) return { error: "文件过大" }
        const content = readFileSync(full, "utf-8")
        return { path: p, content: content.slice(0, 30000), truncated: content.length > 30000 }
      } catch (e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
    },
  },
  write_file: {
    name: "write_file",
    description: "写入文件到仓库。小心使用，会覆盖已有文件。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "要写入的内容" },
      },
      required: ["path", "content"],
    },
    async execute(input) {
      const p = (input.path as string || "").replace(/\\/g, "/")
      if (p.includes("..")) return { error: "路径遍历不允许" }
      const full = join(REPO_PATH, p)
      try {
        writeFileSync(full, input.content as string, "utf-8")
        return { ok: true, path: p }
      } catch (e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
    },
  },
  run_command: {
    name: "run_command",
    description: "执行安全的 shell 命令。允许: npm run build, npm test, git status, git diff, ls, cat, node -e, python scripts/",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string", description: "要执行的命令" } },
      required: ["command"],
    },
    async execute(input) {
      const cmd = (input.command as string || "").trim()
      // Whitelist
      const allowed = [
        /^npm run (build|test|lint)$/,
        /^npm test/,
        /^git (status|diff|log|branch|add|commit|push|pull)/,
        /^ls(\s|$)/,
        /^cat\s/,
        /^node -[eE]\s/,
        /^python scripts\//,
      ]
      if (!allowed.some(r => r.test(cmd))) {
        return { error: `命令不在白名单中: ${cmd.slice(0, 60)}` }
      }
      try {
        const out = execSync(cmd, { cwd: REPO_PATH, encoding: "utf-8", timeout: 60000, maxBuffer: 100_000 })
        return { command: cmd, output: out.slice(-5000), exitCode: 0 }
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        return { command: cmd, output: (err.stdout || "").slice(-2000) + "\n" + (err.stderr || "").slice(-2000), exitCode: 1, error: err.message?.slice(0, 200) }
      }
    },
  },
  okx_public: {
    name: "okx_public",
    description: "调用 OKX 公共 API 获取行情数据。支持: ticker, candles, funding-rate。",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "ticker / candles / funding-rate" },
        instId: { type: "string", description: "交易对，如 BTC-USDT" },
        bar: { type: "string", description: "K线周期，如 4H、1H、1D" },
      },
      required: ["endpoint", "instId"],
    },
    async execute(input) {
      const ep = input.endpoint as string
      const inst = (input.instId as string).replace("/", "-")
      const bar = (input.bar as string) || "4H"
      try {
        let url: string
        if (ep === "ticker") url = `https://www.okx.com/api/v5/market/ticker?instId=${inst}`
        else if (ep === "candles") url = `https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=50`
        else if (ep === "funding-rate") url = `https://www.okx.com/api/v5/public/funding-rate?instId=${inst}`
        else return { error: `unknown endpoint: ${ep}` }

        const resp = await circuitBreaker.wrap("okx-api", () => fetch(url).then(r => r.json()))
        if (resp.code !== "0") return { error: resp.msg }
        return { endpoint: ep, instId: inst, data: resp.data?.slice(0, 10) }
      } catch (e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
    },
  },
  memory_search: {
    name: "memory_search",
    description: "搜索知识库/记忆库，获取相关上下文。",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "搜索关键词" } },
      required: ["query"],
    },
    async execute(input) {
      try {
        const q = encodeURIComponent(input.query as string)
        const resp = await fetch(`http://127.0.0.1:3000/api/memory/search?q=${q}`).then(r => r.json()).catch(() => [])
        return { results: (Array.isArray(resp) ? resp : []).slice(0, 5).map((e: { id: string; text: string; type: string }) => ({ id: e.id, text: e.text?.slice(0, 300), type: e.type })) }
      } catch { return { results: [] } }
    },
  },
  db_query: {
    name: "db_query",
    description: "查询项目数据库（通过 Hub API，只读）。可查任务历史、记忆条目等。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "查询类型: tasks / memory / stats" },
        filter: { type: "string", description: "过滤条件: taskId / keyword / status" },
        limit: { type: "number", description: "返回条数，默认 20，最大 100" },
      },
      required: ["type"],
    },
    async execute(input) {
      try {
        const type = input.type as string
        const filter = (input.filter as string) || ""
        const limit = Math.min(input.limit as number || 20, 100)
        let url = ""
        if (type === "tasks") url = `http://127.0.0.1:3000/api/status`  // 获取全部任务状态
        else if (type === "memory") url = `http://127.0.0.1:3000/api/memory/search?q=${encodeURIComponent(filter)}`
        else if (type === "stats") url = `http://127.0.0.1:3000/api/memory/stats`
        else return { error: `未知查询类型: ${type}` }
        const resp = await fetch(url).then(r => r.json()).catch(() => null)
        if (!resp) return { error: "查询失败" }
        // 精简输出
        if (type === "tasks") {
          const tasks = (resp.tasks || []).slice(0, limit)
          return { type, tasks: tasks.map((t: any) => ({ taskId: t.taskId, title: t.title, status: t.status, assignedTo: t.assignedTo })), count: tasks.length }
        }
        return { type, data: resp, count: Array.isArray(resp) ? resp.length : (resp.total || 0) }
      } catch (e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
    },
  },
  git_history: {
    name: "git_history",
    description: "查看 Git 提交历史或文件变更。只读。",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "文件路径（可选），如 src/hub-server.ts" },
        limit: { type: "number", description: "最大条目数，默认 20" },
        author: { type: "string", description: "按作者筛选（可选）" },
      },
      required: [],
    },
    async execute(input) {
      try {
        const file = (input.file as string || "").replace(/[&|;`$]/g, "")
        const limit = Math.min(input.limit as number || 20, 50)
        let cmd = `git log --oneline --no-decorate -${limit}`
        if (file) {
          // Use -- separator to prevent path injection
          cmd += ` -- ${file}`
        }
        if (input.author) {
          // Sanitize author: only allow alphanumeric, spaces, hyphens, dots, underscores, @
          const author = String(input.author).replace(/[^a-zA-Z0-9\s._@-]/g, "")
          if (author) cmd += ` --author=${author}`
        }
        const out = execSync(cmd, { cwd: REPO_PATH, encoding: "utf-8", timeout: 5000, maxBuffer: 50_000, windowsHide: true })
        return { commits: out.trim().split("\n").filter(Boolean), count: out.trim().split("\n").filter(Boolean).length }
      } catch (e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
    },
  },
  web_fetch: {
    name: "web_fetch",
    description: "获取网页内容（只读）。用于查阅文档、API 参考等。限制 5 秒超时、100KB 响应。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要获取的 URL（仅 HTTPS）" },
      },
      required: ["url"],
    },
    async execute(input) {
      const url = (input.url as string || "").trim()
      if (!url.startsWith("https://")) return { error: "仅允许 HTTPS URL" }
      if (url.length > 500) return { error: "URL 过长" }
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)
        const resp = await circuitBreaker.wrap("web-fetch", () => fetch(url, { signal: controller.signal }))
        clearTimeout(timer)
        const text = await resp.text()
        // 简单提取文本（去掉 HTML 标签用于 AI 阅读）
        const plain = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim()
          .slice(0, 50_000)
        return { url, content: plain, length: plain.length, status: resp.status }
      } catch (e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
    },
  },
}

// ═══════════════════════════════════════════════════════════════
// WebSocket Protocol
// ═══════════════════════════════════════════════════════════════

function send(msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function connect() {
  ws = new WebSocket(HUB_URL)

  ws.on("open", () => {
    log.info(`已连接 Hub，注册为 ${WORKER_NAME}`)
    // 能力标签: 工具列表 + 专长标记
    const caps = [...Object.keys(TOOLS)]
    const profile = process.env.WORKER_PROFILE || "general"
    if (profile === "quant") caps.push("quant")
    else if (profile === "code") caps.push("code")
    else if (profile === "research") caps.push("research")
    else caps.push("general")

    send({
      type: "agent:hello",
      agentId: WORKER_ID,
      name: WORKER_NAME,
      version: "2.0.0",
      capabilities: caps,
    })
  })

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      await handleMessage(msg)
    } catch { log.warn(`畸形消息: ${raw.toString().slice(0, 80)}`) }
  })

  ws.on("close", () => {
    log.warn("连接断开，5s 后重连...")
    clearInterval(heartbeatTimer)
    setTimeout(connect, 5000)
  })

  ws.on("error", (e: Error) => { log.error(`WS 错误: ${e.message}`) })

  // Heartbeat
  heartbeatTimer = setInterval(() => {
    send({ type: "agent:status" })
  }, 30000)
}

async function handleMessage(msg: Record<string, unknown>) {
  switch (msg.type) {
    case "agent:registered":
      log.info(`注册成功，等待任务指派...`)
      break

    case "task:dispatch": {
      const taskId = msg.taskId as string
      const title = (msg.title as string) || taskId
      const promptB64 = msg.promptB64 as string || ""
      const prompt = promptB64 ? Buffer.from(promptB64, "base64").toString("utf-8") : (msg.prompt as string || title)

      if (currentTaskId) {
        log.warn(`已在执行 ${currentTaskId}，拒绝 ${taskId}`)
        // 通知 Hub/Chronos 释放任务，让其他 Worker 接管
        send({ type: "task:reject", taskId, agentId: WORKER_ID, reason: `Worker busy: executing ${currentTaskId}` })
        return
      }

      currentTaskId = taskId
      log.info(`📋 接收任务: ${taskId} "${title}"`)

      // Claim the task
      send({ type: "task:claim", taskId, agentId: WORKER_ID })

      try {
        // Execute with AgentLoop
        const result = await agent.run(prompt, TOOLS, {
          model: "claude-sonnet-4-6",
          maxTokens: MAX_TOKENS,
          maxSteps: MAX_STEPS,
          temperature: 0.3,
          system: `你是 Agent Hub 的 AI 工程师。你在一个 Git 仓库中工作: ${REPO_PATH}。\n\n你可以使用以下工具完成用户的任务:\n- read_file: 读取文件\n- write_file: 写入文件\n- run_command: 执行安全的命令 (npm build, git, ls, cat, python scripts/)\n- okx_public: 查询 OKX 行情\n- memory_search: 搜索知识库\n\n操作原则:\n1. 先理解再动手 — 先 read_file 查看现有代码\n2. 最小改动 — 只改必要的部分\n3. 改完后用 run_command 验证\n4. 完成后总结你做了什么`,
          onText: (delta) => {
            send({ type: "task:progress", taskId, delta })
          },
          onToolCall: (name, input) => {
            send({ type: "task:tool", taskId, tool: name, args: input })
          },
        })

        // Report completion
        send({
          type: "task:done",
          taskId,
          agentId: WORKER_ID,
          result: result.text,
          usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
          steps: result.steps,
        })
        log.info(`✅ 完成: ${taskId} (${result.inputTokens}+${result.outputTokens} tokens, ${result.steps} steps)`)
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e)
        log.error(`❌ 执行失败: ${taskId} — ${errMsg}`)
        send({
          type: "task:done",
          taskId,
          agentId: WORKER_ID,
          result: `执行失败: ${errMsg}`,
          error: errMsg,
        })
      } finally {
        currentTaskId = null
      }
      break
    }

    case "agent:pong":
      break
  }
}

// ═══════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════

log.info(`Worker v2 启动 — ${WORKER_NAME}`)
log.info(`Hub: ${HUB_URL} | Repo: ${REPO_PATH}`)
log.info(`工具: ${Object.keys(TOOLS).join(", ")}`)
connect()

process.on("SIGINT", () => { log.info("收到 SIGINT，退出"); clearInterval(heartbeatTimer); ws.close(); process.exit(0) })
process.on("SIGTERM", () => { log.info("收到 SIGTERM，退出"); clearInterval(heartbeatTimer); ws.close(); process.exit(0) })
