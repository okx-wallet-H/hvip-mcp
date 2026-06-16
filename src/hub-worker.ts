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
import { spawn } from "node:child_process"

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

const HUB_URL    = flag("hub")  || process.env.HUB_URL  || "ws://127.0.0.1:9321"
const TASK_ID    = flag("task") || process.env.TASK_ID   || ""
const REPO_PATH  = flag("repo") || process.env.REPO_PATH || process.cwd()

const AGENT_ID = `worker-${TASK_ID}-${Date.now()}`
const AGENT_NAME = `Worker·${TASK_ID}`

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket 客户端
// ═══════════════════════════════════════════════════════════════════════════

let ws: WebSocket
let taskReceived = false

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
  })

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      handleMessage(msg)
    } catch {}
  })

  ws.on("close", () => {
    if (!taskReceived) {
      process.stderr.write("[Worker] 连接断开，5s 后重连...\n")
      setTimeout(connect, 5000)
    }
  })

  ws.on("error", () => {})
}

function handleMessage(msg: any): void {
  switch (msg.type) {
    case "agent:registered":
      process.stderr.write(`[Worker] 注册成功。可用任务: [${(msg.pendingTasks || []).join(", ")}]\n`)
      break

    case "task:dispatch":
      if (msg.taskId === TASK_ID && !taskReceived) {
        taskReceived = true
        doTask(msg.taskId, msg.title || TASK_ID, msg.url || "")
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
// 执行任务
// ═══════════════════════════════════════════════════════════════════════════

function doTask(taskId: string, title: string, url: string): void {
  process.stderr.write(`[Worker] 🚀 开始执行 ${taskId}: ${title}\n`)

  // 认领
  ws.send(JSON.stringify({ type: "task:claim", taskId, agentId: AGENT_ID }))

  // 构建 Claude Code 任务提示词
  const prompt = buildPrompt(taskId, title, url)

  // 启动 Claude Code 干活
  process.stderr.write(`[Worker] 启动 Claude Code...\n`)
  const child = spawn("claude", ["-p", prompt], {
    cwd: REPO_PATH,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  })

  let output = ""
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    process.stderr.write(text)
  })
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk.toString()))

  child.on("close", (code: number | null) => {
    if (code === 0) {
      // 尝试从输出中提取分支名
      const branchMatch = output.match(/push.*?(task\/\S+|feat\/\S+|fix\/\S+)/i)
      const branch = branchMatch ? branchMatch[1] : `worker/${AGENT_ID}`

      process.stderr.write(`[Worker] ✅ Claude Code 完成 (exit ${code})\n`)
      ws.send(JSON.stringify({
        type: "task:done",
        taskId,
        agentId: AGENT_ID,
        branch,
        result: `${title} — Claude Code 自动完成`,
      }))
    } else {
      process.stderr.write(`[Worker] ❌ Claude Code 失败 (exit ${code})\n`)
      ws.send(JSON.stringify({
        type: "room:message",
        roomId: "#review",
        text: `❌ ${taskId} 执行失败 (exit ${code})。输出:\n${output.slice(-1000)}`,
      }))
    }

    // 保活 30 秒等审核反馈
    setTimeout(() => {
      ws.close()
      process.exit(code === 0 ? 0 : 1)
    }, 30000)
  })

  child.on("error", (err: Error) => {
    process.stderr.write(`[Worker] Claude Code 启动失败: ${err.message}\n`)
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

function buildPrompt(taskId: string, title: string, url: string): string {
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
    ws.close()
    process.exit(1)
  }
}, 300_000)
