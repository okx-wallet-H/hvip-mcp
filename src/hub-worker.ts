/**
 * Agent Hub Worker — Hub 自动拉起的 AI Agent
 *
 * 连上 Hub → 注册 → 领任务 → spawn Claude Code → 汇报完成。
 * Hub 通过 POST /api/tasks/:id/spawn 拉起本进程。
 *
 * Usage:
 *   node dist/hub-worker.js --hub ws://127.0.0.1:9321 --task WS-01 --repo /path/to/repo
 */

import { WebSocket } from "ws"
import { spawn, execSync } from "node:child_process"
import { logger } from "./utils/logger.js"

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

const HUB_URL    = flag("hub")  || process.env.HUB_URL  || "ws://127.0.0.1:9321"
const TASK_ID    = flag("task") || process.env.TASK_ID   || ""
const REPO_PATH  = flag("repo") || process.env.REPO_PATH || process.cwd()
const PROMPT_B64 = flag("prompt-b64") || ""  // Hub v2: pre-built prompt from template
const WEB_PORT   = flag("web-port") || process.env.HUB_WEB_PORT || "3000"

const AGENT_ID = `worker-${TASK_ID}-${Date.now()}`
const AGENT_NAME = `Worker·${TASK_ID}`
const CLAUDE_CLI = process.env.CLAUDE_CLI || "claude"
const WORKER_TIMEOUT_MS = parseInt(process.env.HUB_WORKER_TIMEOUT || "600000", 10) // 10 分钟默认
const log = logger(`Worker-${TASK_ID}`)

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket 客户端
// ═══════════════════════════════════════════════════════════════════════════

let ws: WebSocket
let taskReceived = false
let heartbeatTimer: ReturnType<typeof setInterval>
let taskDoneSent = false  // 防止重复发送 task:done
let taskTitle = ""

function connect(): void {
  ws = new WebSocket(HUB_URL)

  ws.on("open", () => {
    process.stderr.write(`[Worker] 已连接 Hub，注册为 ${AGENT_ID}\n`)
    ws.send(JSON.stringify({
      type: "agent:hello",
      agentId: AGENT_ID,
      name: AGENT_NAME,
      version: "0.3.0",
      capabilities: [TASK_ID],
    }))
    // 发送心跳防止 Hub 超时踢下线（长任务 >120s 需要）
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "agent:status" }))
      }
    }, 30_000)
  })

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      handleMessage(msg)
    } catch { process.stderr.write(`[Worker] ⚠️ 畸形消息: ${raw.toString().slice(0, 80)}\n`) }
  })

  ws.on("close", () => {
    clearInterval(heartbeatTimer)
    if (!taskReceived) {
      process.stderr.write("[Worker] 连接断开，5s 后重连...\n")
      setTimeout(connect, 5000)
    }
  })

  ws.on("error", (e: Error) => { process.stderr.write(`[Worker] WS 错误: ${e.message}\n`) })
}

function sendTaskDone(taskId: string, result: string): void {
  if (taskDoneSent) return
  taskDoneSent = true
  try {
    ws.send(JSON.stringify({
      type: "task:done",
      taskId,
      agentId: AGENT_ID,
      result,
    }))
  } catch {}
}

function handleMessage(msg: any): void {
  switch (msg.type) {
    case "agent:registered":
      process.stderr.write(`[Worker] 注册成功。可用任务: [${(msg.pendingTasks || []).join(", ")}]\n`)
      if (!taskReceived) {
        taskReceived = true
        doTask(TASK_ID, `Hub任务: ${TASK_ID}`, "", PROMPT_B64)
      }
      break

    case "task:dispatch":
      if (msg.taskId === TASK_ID && !taskReceived) {
        taskReceived = true
        doTask(msg.taskId, msg.title || TASK_ID, msg.url || "", PROMPT_B64)
      }
      break

    case "task:assigned":
      process.stderr.write(`[Worker] 已认领 ${msg.taskId}\n`)
      break

    case "task:review":
      process.stderr.write(`[Worker] ${msg.taskId} 审核: ${msg.verdict}\n${msg.feedback || ""}\n`)
      break

    case "agent:pong":
      // 心跳正常
      break
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 任务类型识别
// ═══════════════════════════════════════════════════════════════════════════

type TaskMode = "code" | "market" | "research"

function detectTaskType(title: string): TaskMode {
  const market = /\b(BTC|ETH|SOL|行情|价格|多少钱|涨跌|K线|走势|大盘|资金费率|深度|多空|持仓|市值|什么价|报价|币价|ticker|mark price|funding)\b/i
  const research = /\b(搜索|查找|GitHub|插件|工具|框架|分析|比较|列出|整理|TOP|分类|研究|调研|MCP|开源|项目|平台|最新|代理|Agent|协作|编排|Orchestration|Dashboard|面板|设计模式|黑科技|能力|增强|Best|awesome)\b/i
  if (market.test(title)) return "market"
  if (research.test(title)) return "research"
  return "code"
}

// ═══════════════════════════════════════════════════════════════════════════
// 执行任务
// ═══════════════════════════════════════════════════════════════════════════

function doTask(taskId: string, title: string, url: string, promptB64?: string): void {
  taskTitle = title
  log.info(`🚀 开始执行: ${title}`)

  // 认领
  ws.send(JSON.stringify({ type: "task:claim", taskId, agentId: AGENT_ID }))

  // Hub v2: 如果有预构建的 prompt，直接用
  let prompt: string
  let mode = "code"
  if (promptB64) {
    prompt = Buffer.from(promptB64, "base64").toString("utf-8")
    mode = "template"
    process.stderr.write(`[Worker] 模式: template (预构建 prompt, ${prompt.length} chars)\n`)
  } else {
    mode = detectTaskType(title)
    process.stderr.write(`[Worker] 模式: ${mode}\n`)
    prompt = mode === "market" ? buildMarketPrompt(title)
      : mode === "research" ? buildResearchPrompt(title)
      : buildCodePrompt(taskId, title, url)
  }

  // 🔍 检索知识库
  try {
    const memUrl = `http://127.0.0.1:${WEB_PORT}/api/memory/for-task?q=${encodeURIComponent(title)}`
    const kbRaw = execSync(`curl -s "${memUrl}"`, { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })
    if (kbRaw && kbRaw.length > 0) {
      const kb = JSON.parse(kbRaw.toString())
      if (kb.hit > 0) {
        prompt = prompt + "\n" + kb.context
        process.stderr.write(`[Worker] 📚 注入 ${kb.hit} 条相关知识\n`)
      }
    }
  } catch {}

  // 立刻推送启动状态
  ws.send(JSON.stringify({
    type: "room:message",
    roomId: "#lobby",
    text: `🚀 ${title}\n\nWorker 已启动，Claude Code 正在初始化...`,
  }))

  // 启动 Claude Code 干活
  process.stderr.write(`[Worker] 启动 Claude Code...\n`)
  const child = spawn(CLAUDE_CLI, ["-p", prompt], {
    cwd: REPO_PATH,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
    windowsHide: true,
  })
  child.stdin.end()  // 关键: 关闭 stdin 让 Claude Code 知道没有更多输入

  let output = ""
  let pushCount = 0
  // 每 5 秒无条件推送一次进度到仪表盘
  const progressTimer = setInterval(() => {
    pushCount++
    const text = output.slice(-800) || "(Claude Code 正在初始化——可能需要 10-30 秒读取代码、搜索网站...)"
    ws.send(JSON.stringify({
      type: "room:message",
      roomId: "#lobby",
      text: `🔄 ${title} [#${pushCount}]\n\n${text}`,
    }))
  }, 5000)

  // 超时保护 — 防止 Claude Code 卡死
  const timeoutTimer = setTimeout(() => {
    process.stderr.write(`[Worker] ⏰ 超时 (${WORKER_TIMEOUT_MS/1000}s)，强制终止\n`)
    // 先发 task:done 确保 Hub 知道任务已结束（即使 child.close 不触发）
    sendTaskDone(taskId, `❌ (超时 ${WORKER_TIMEOUT_MS/1000}s) ${title}\n${output.slice(-3000)}`)
    ws.send(JSON.stringify({
      type: "room:message",
      roomId: "#review",
      text: `❌ ${taskId} 超时 ${WORKER_TIMEOUT_MS/1000}s，已终止。输出:\n${output.slice(-1000)}`,
    }))
    try { child.kill("SIGKILL") } catch {}
  }, WORKER_TIMEOUT_MS)

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    process.stderr.write(text)
  })
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk.toString()))

  child.on("close", (code: number | null) => {
    clearInterval(progressTimer); clearTimeout(timeoutTimer)
    if (code === 0) {
      log.info(`✅ Claude Code 完成 (exit ${code})`)

      if (mode === "market" || mode === "research" || mode === "template") {
        // 行情类任务: 结果发到 #lobby，任务标记 done，写入记忆
        ws.send(JSON.stringify({
          type: "room:message",
          roomId: "#lobby",
          text: `📊 ${title}\n\n${output.slice(-3000)}`,
        }))
        sendTaskDone(taskId, output.slice(-5000) || `${title} — 无输出`)
        // 自动保存到共享记忆（失败不阻断）
        try { tagAndSave(title, output) } catch {}
      } else {
        // 写代码任务: 原有逻辑
        const branchMatch = output.match(/push.*?(task\/\S+|feat\/\S+|fix\/\S+)/i)
        const branch = branchMatch ? branchMatch[1] : `worker/${AGENT_ID}`
        sendTaskDone(taskId, `${title} —\n\n${output.slice(-5000)}`)
      }
    } else {
      log.error(`❌ Claude Code 失败 (exit ${code})`)
      ws.send(JSON.stringify({
        type: "room:message",
        roomId: "#review",
        text: `❌ ${taskId} 执行失败 (exit ${code})。输出:\n${output.slice(-1000)}`,
      }))
      // 失败也要通知 Hub 任务结束，避免调度器永久阻塞
      sendTaskDone(taskId, `❌ (失败 exit ${code}) ${title}\n${output.slice(-3000)}`)
    }

    // 保活 30 秒等审核反馈
    setTimeout(() => {
      clearInterval(heartbeatTimer)
      ws.close()
      process.exit(code === 0 ? 0 : 1)
    }, 30000)
  })

  child.on("error", (err: Error) => {
    clearInterval(progressTimer); clearTimeout(timeoutTimer); clearInterval(heartbeatTimer)
    process.stderr.write(`[Worker] Claude Code 启动失败: ${err.message}\n`)
    sendTaskDone(taskId, `❌ (启动失败) ${title}: ${err.message}`)
    ws.send(JSON.stringify({
      type: "room:message",
      roomId: "#review",
      text: `❌ ${taskId} 无法启动 Claude Code: ${err.message}。请确认 claude CLI 已安装。`,
    }))
    ws.close()
    process.exit(1)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 提示词构建
// ═══════════════════════════════════════════════════════════════════════════

/** 从任务标题提取标签 + 提取核心结论写入记忆 */
function tagAndSave(title: string, output: string): void {
  const tags: string[] = []
  if (/\bBTC\b/i.test(title)) tags.push("BTC")
  if (/\bETH\b/i.test(title)) tags.push("ETH")
  if (/行情|价格|涨跌|走势|K线/i.test(title)) tags.push("行情")
  if (/资金费率/i.test(title)) tags.push("资金费率")
  if (tags.length === 0) tags.push("分析")

  // 提取「总结」或最后一段作为记忆正文
  const summaryMatch = output.match(/总结[：:]\s*(.+)/i)
  const text = summaryMatch ? summaryMatch[1] : output.slice(-500).replace(/\n/g, " ")

  // 通过 Hub REST API 写入记忆
  const http = require("node:http") as typeof import("node:http")
  const hubHost = new URL(HUB_URL).hostname
  const hubPort = new URL(HUB_URL.replace("ws://", "http://")).port || "3000"
  const body = JSON.stringify({ type: "memory", agentId: AGENT_ID, text, tags, confidence: 0.8 })
  const req = http.request({ hostname: hubHost, port: parseInt(hubPort), method: "POST", path: "/api/memory", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
    process.stderr.write(`[Worker] 记忆已保存 (${res.statusCode})\n`)
  })
  req.on("error", () => {})
  req.write(body)
  req.end()
}

function buildCodePrompt(taskId: string, title: string, url: string): string {
  return [
    `你是一个 AI 开发 Agent，正在为 hvip-mcp 项目工作。`,
    ``,
    `## 任务`,
    `- 编号: ${taskId}`,
    `- 标题: ${title}`,
    `- 说明: ${url ? `详见 ${url}` : "按照 AGENT_CONNECT.md 流程实现"}`,
    ``,
    `## 工作流程`,
    `1. 阅读 CLAUDE.md、AGENT_CONNECT.md、CONTRIBUTING.md 了解项目规范`,
    `2. 如果 ${url}，先 fetch 任务文档阅读具体需求`,
    `3. 阅读 tasks/README.md 确认任务不在已完成列表中`,
    `4. git checkout master && git pull origin master（先拉最新）`,
    `5. git checkout -b task/${taskId}（新建分支）`,
    `6. 按照任务文档 + CLAUDE.md 规范编写代码`,
    `7. npm run build（必须通过！）`,
    `8. git add 改动的文件 && git commit -m "Skill: ${taskId} — ${title}"`,
    `9. git push origin task/${taskId}`,
    ``,
    `## 代码规范（来自 CLAUDE.md）`,
    `- 描述格式: 8 字段模板（功能/场景/关键词/参数/鉴权/风险/返回量/关联）`,
    `- 错误格式: toResult() / toError()`,
    `- 时间戳: 必须加 tsIso`,
    `- 枚举: 用 INST_TYPE_* 常量`,
    `- 每个 registerTool 调用第一个参数是权限级别 (READ/WRITE)`,
    ``,
    `## 重要`,
    `- 禁止修改 package.json 的 version 字段`,
    `- 禁止修改 dist/index.js（自动构建产物）`,
    `- 完成后输出 "TASK_COMPLETE: <分支名>"`,
  ].join("\n")
}

function buildResearchPrompt(title: string): string {
  return [
    `你的任务: ${title}`,
    ``,
    `## 指令`,
    `1. 使用 WebSearch 和 WebFetch 工具广泛搜索 GitHub`,
    `2. 找到相关项目后，进入每个仓库页面阅读 README、架构、特性`,
    `3. 整理成结构化报告——每个项目包含: 名称、仓库地址、核心特性、技术栈、优势、不足`,
    `4. 使用表格和分类让结果一目了然`,
    `5. 最后给出一个总结: 哪些最值得参考、哪些可以集成到我们的项目`,
    `6. 不要写代码、不要改文件、不要 git 操作`,
    `7. 搜索时优先找 stars 多、最近更新的项目`,
  ].join("\n")
}

function buildMarketPrompt(title: string): string {
  return [
    `你的任务: ${title}`,
    ``,
    `## 指令`,
    `1. 使用 hvip MCP 工具（如 okx_get_ticker, okx_get_tickers, okx_get_candles, okx_get_funding_rate, okx_get_orderbook 等）查询所需数据`,
    `2. 把结果整理成清晰的中文回复（价格、涨跌幅、成交量、关键支撑阻力位等）`,
    `3. 不要写代码、不要改文件、不要 git 操作`,
    `4. 完成后用简洁的一段话总结核心结论`,
  ].join("\n")
}

// ═══════════════════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════════════════

if (!TASK_ID) {
  process.stderr.write("Usage: node dist/hub-worker.js --task T-007 --hub ws://127.0.0.1:9321 --repo /path/to/repo\n")
  process.exit(1)
}

process.stderr.write(`[Worker] ${AGENT_NAME} 启动\n`)
process.stderr.write(`[Worker] Hub: ${HUB_URL} | Task: ${TASK_ID} | Repo: ${REPO_PATH}\n`)

connect()

// 如果 5 分钟还没收到任务，退出
setTimeout(() => {
  if (!taskReceived) {
    process.stderr.write("[Worker] 超时未收到任务，退出\n")
    clearInterval(heartbeatTimer)
    ws.close()
    process.exit(1)
  }
}, 300_000)
