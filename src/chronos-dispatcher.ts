/**
 * Chronos AI Dispatcher — 智能任务调度官
 * =========================================
 *
 * 职责:
 *   1. 监听 task:announced → AI 分析任务类型/优先级/能力需求
 *   2. 查询可用 Worker → 能力匹配 → 智能分配
 *   3. 任务队列管理 → 优先级排序 → 负载均衡
 *   4. 定期巡检 → 清理孤儿任务 → 重试失败任务
 *
 * 工作流:
 *   任务创建 → Hub 广播 task:announced
 *   → Chronos 收到 → AgentLoop 分析:
 *       "这是什么任务？什么类型？需要什么能力？优先级？"
 *   → Chronos 查看 Worker 池: 谁空闲？谁匹配？
 *   → Chronos 发送 task:assign 给 Hub → Hub 派发到指定 Worker
 */

import { WebSocket } from "ws"
import { AgentLoop, type AgentTool } from "./adapters/ai-sdk.js"
import { logger } from "./utils/logger.js"
import { HubCosts } from "./adapters/hub-costs.js"
import { circuitBreaker } from "./adapters/circuit-breaker.js"
import { checkAndAlert, DAILY_BUDGET_USD, QUEUE_DEPTH_WARN } from "./adapters/hub-alerts.js"

// ═══════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════

const HUB_URL = process.env.HUB_URL || "ws://127.0.0.1:9321"
const AGENT_ID = "chronos-dispatcher"
const AGENT_NAME = "Chronos·调度官"
const INTERVAL_MS = parseInt(process.env.CHRONOS_INTERVAL || "60000", 10)

const log = logger("Chronos")
const agent = new AgentLoop()
const costTracker = new HubCosts(".hub/llm-costs.jsonl")

let ws: WebSocket
let heartbeatTimer: ReturnType<typeof setInterval>

// ═══════════════════════════════════════════════════════════
// Worker Pool State (maintained from Hub broadcasts)
// ═══════════════════════════════════════════════════════════

interface WorkerInfo {
  agentId: string
  name: string
  status: "idle" | "working"
  capabilities: string[]
  lastSeen: number
}

const workerPool = new Map<string, WorkerInfo>()

// ═══════════════════════════════════════════════════════════
// Task Queue
// ═══════════════════════════════════════════════════════════

interface QueuedTask {
  taskId: string
  title: string
  type: "code" | "quant" | "research" | "guard" | "general"
  priority: "high" | "normal" | "low"
  requiredCaps: string[]
  createdAt: number
  retryCount: number
  maxRetries: number
}

const taskQueue: QueuedTask[] = []
const retryTracker = new Map<string, number>()  // 持久化重试计数，跨队列生命周期
const MAX_RETRIES = 3

// ═══════════════════════════════════════════════════════════
// AI Task Analysis
// ═══════════════════════════════════════════════════════════

function buildAnalysisPrompt(taskId: string, title: string) {
  return `分析这个新任务，返回 JSON:\n\n{\n  \"type\": \"code|quant|research|guard|general\",\n  \"priority\": \"high|normal|low\",\n  \"requiredCaps\": [\"okx_public\",\"run_command\",\"memory_search\"...],\n  \"reasoning\": \"一句话说明\"\n}\n\n任务ID: ${taskId}\n标题: ${title}\n\n规则:\n- code: 代码修改、bug修复、重构、审计\n- quant: 量化分析、回测、VBT信号、行情\n- research: 知识整理、搜索、研究\n- guard: 面板检查、健康巡检、系统维护\n- general: 无法归类\n\n优先级:\n- high: 紧急修复、用户直接创建的\n- normal: 定时任务、例行检查\n- low: 清理归档、重复任务\n\n只需返回 JSON，不要其他文字。`
}

async function analyzeTask(taskId: string, title: string): Promise<QueuedTask | null> {
  try {
    const result = await agent.run(buildAnalysisPrompt(taskId, title), {}, {
      model: "claude-haiku-4-5",
      maxTokens: 300,
      maxSteps: 1,
      temperature: 0,
    })
    // Extract JSON from response
    const json = result.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null
    const analysis = JSON.parse(json)
    // Record cost with actual model used (not hardcoded)
    costTracker.record({
      agentId: AGENT_ID, taskId,
      model: result.model || "claude-haiku-4-5",
      provider: result.provider || "unknown",
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
      purpose: "analysis",
    })
    return {
      taskId, title,
      type: analysis.type || "general",
      priority: analysis.priority || "normal",
      requiredCaps: analysis.requiredCaps || [],
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: MAX_RETRIES,
    }
  } catch {
    // AI analysis failed → use heuristics
    const t = title.toLowerCase()
    let type: QueuedTask["type"] = "general"
    if (/vbt|回测|signal|信号|quant|量化|行情|ticker|candle/i.test(t)) type = "quant"
    else if (/fix|bug|修复|审计|audit|代码|code|重构|refactor/i.test(t)) type = "code"
    else if (/整理|curation|知识|研究|research/i.test(t)) type = "research"
    else if (/guard|守护|检查|巡检|面板|dashboard/i.test(t)) type = "guard"

    return { taskId, title, type, priority: "normal", requiredCaps: [], createdAt: Date.now(), retryCount: 0, maxRetries: MAX_RETRIES }
  }
}

// ═══════════════════════════════════════════════════════════
// Worker Matching
// ═══════════════════════════════════════════════════════════

function findBestWorker(task: QueuedTask): WorkerInfo | null {
  const idle = [...workerPool.values()].filter(w => w.status === "idle")
  if (idle.length === 0) return null

  // Score each worker
  const scored = idle.map(w => {
    let score = 0
    // V2 workers are preferred (have profile tags like code/quant/general)
    const isV2 = w.capabilities.some(c => ["code","quant","research","general","dispatcher"].includes(c))
    if (isV2) score += 100  // Strong preference for V2 workers

    // Capability match
    for (const cap of task.requiredCaps) {
      if (w.capabilities.includes(cap)) score += 10
    }
    // Type specialization
    if (task.type === "quant" && w.capabilities.includes("quant")) score += 30
    if (task.type === "code" && w.capabilities.includes("code")) score += 30
    if (task.type === "research" && w.capabilities.includes("research")) score += 20
    return { worker: w, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0].worker
}

// ═══════════════════════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════════════════════

function dispatchToWorker(taskId: string, worker: WorkerInfo) {
  send({
    type: "task:assign",
    taskId,
    agentId: worker.agentId,
    assignedBy: AGENT_ID,
  })
  // 乐观更新：立即标记忙碌，防止并发 processQueue 重复派发给同一 Worker
  worker.status = "working"
  log.info(`📋 派发 ${taskId} → ${worker.name} (${worker.agentId.slice(0, 12)})`)
}

let processingQueue = false

function processQueue() {
  if (processingQueue) return  // 防并发重入
  processingQueue = true
  try {
    if (taskQueue.length === 0) return

    // Sort: high priority first, then by creation time
    taskQueue.sort((a, b) => {
      const priOrder = { high: 0, normal: 1, low: 2 }
      return priOrder[a.priority] - priOrder[b.priority] || a.createdAt - b.createdAt
    })

    const remaining: QueuedTask[] = []
    for (const task of taskQueue) {
      const worker = findBestWorker(task)
      if (worker) {
        dispatchToWorker(task.taskId, worker)
      } else {
        remaining.push(task)
      }
    }
    taskQueue.length = 0
    taskQueue.push(...remaining)

    if (remaining.length > 0) {
      log.info(`⏳ 队列中 ${remaining.length} 个任务等待空闲 Worker`)
    }

    // 清理过期的重试计数
    if (taskQueue.length === 0 && retryTracker.size > 20) {
      retryTracker.clear()
    }
  } finally {
    processingQueue = false
  }
}

async function syncWorkerPool() {
  try {
    const resp = await circuitBreaker.wrap("hub-api", () => fetch("http://127.0.0.1:3000/api/status"))
    const data = await resp.json() as { agents: Array<{ agentId: string; name: string; status: string; capabilities: string[] }> }
    // 全量刷新：先清空再重建，自动清理已下线 Worker
    workerPool.clear()
    for (const a of data.agents || []) {
      if (a.agentId === AGENT_ID || a.agentId.startsWith("dashboard") || a.agentId.startsWith("term-")) continue
      // 跳过一次性 Worker（hub-worker.js spawn 的，只执行一个任务就退出）
      const caps = Array.isArray(a.capabilities) ? a.capabilities : []
      const hasProfile = caps.some((c: string) => ["code","quant","research","general","dispatcher","scheduler"].includes(c))
      if (!hasProfile && caps.length > 0) continue
      workerPool.set(a.agentId, {
        agentId: a.agentId,
        name: a.name || a.agentId,
        status: a.status === "working" ? "working" : "idle",
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
        lastSeen: Date.now(),
      })
    }
    log.info(`同步 Worker池: ${workerPool.size} 个 Agent`)
    processQueue()
  } catch (e) {
    log.warn(`同步 Worker池失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ═══════════════════════════════════════════════════════════
// Stuck Tasks Cleanup — 主动释放卡住超过10分钟的任务
// ═══════════════════════════════════════════════════════════

const STUCK_TIMEOUT_MS = 10 * 60 * 1000 // 10分钟
// 对于 Agent 在线但卡住的，给予更长的等待时间
const STUCK_WORKING_TIMEOUT_MS = 30 * 60 * 1000 // 30分钟

async function cleanupStuckTasks(): Promise<number> {
  try {
    const resp = await fetch("http://127.0.0.1:3000/api/status")
    const data = await resp.json() as any
    const tasks = data.tasks || []
    const now = Date.now()

    // 找出卡住任务：
    // 1. assigned 状态、无 result、且认领时间超过10分钟（Agent 已离线）
    // 2. assigned 状态、无 result、且认领时间超过30分钟（即使 Agent 在线也强制释放）
    const stuckTasks = tasks.filter((t: any) => {
      if (t.status !== "assigned") return false
      if (t.result) return false  // 有结果不算卡住
      if (!t.claimedAt) return true  // 没有认领时间也算卡住
      const elapsed = now - new Date(t.claimedAt).getTime()
      return elapsed > STUCK_TIMEOUT_MS
    })

    if (stuckTasks.length === 0) return 0

    // 检查这些任务的 Agent 是否还在线
    const onlineAgents = new Set((data.agents || []).map((a: any) => a.agentId))

    const released: Array<{ taskId: string; elapsed: string; agentOnline: boolean }> = []

    for (const task of stuckTasks) {
      const elapsed = task.claimedAt
        ? Math.round((now - new Date(task.claimedAt).getTime()) / 1000 / 60) + "分钟"
        : "未知时长"
      const agentOnline = task.assignedTo ? onlineAgents.has(task.assignedTo) : false

      // 策略：
      // - Agent 离线 → 立即释放（原有逻辑）
      // - Agent 在线但超过30分钟 → 强制释放（新增逻辑，解决 Worker 卡死不退出）
      if (!agentOnline) {
        released.push({ taskId: task.taskId, elapsed, agentOnline: false })
      } else {
        const elapsedMs = now - new Date(task.claimedAt).getTime()
        if (elapsedMs > STUCK_WORKING_TIMEOUT_MS) {
          released.push({ taskId: task.taskId, elapsed, agentOnline: true })
        }
      }
    }

    if (released.length === 0) return 0

    log.warn(`🔓 发现 ${released.length} 个卡住任务，正在释放...`)

    for (const r of released) {
      log.warn(`  → 释放 ${r.taskId} (已卡住 ${r.elapsed}, Agent在线: ${r.agentOnline})`)
      // 通过 WS 发送 unassign 指令给 Hub
      send({
        type: "task:unassign",
        taskId: r.taskId,
        reason: `卡住超过${r.agentOnline ? '30' : '10'}分钟 (${r.elapsed})`,
      })
      // 如果 Agent 在线但卡住，额外发送一条让 Hub 断开该 Agent 的通知
      if (r.agentOnline) {
        send({
          type: "agent:offline",
          agentId: task.assignedTo,
          reason: "Chronos 强制回收 — Agent 在线但任务卡住超过30分钟",
        })
      }
    }

    // 给 Hub 一点时间处理释放，然后重新处理队列
    setTimeout(processQueue, 1000)
    // 额外延迟后同步 Worker 池（清理断开的 Agent）
    setTimeout(syncWorkerPool, 3000)
    return released.length
  } catch (e) {
    log.warn(`清理卡住任务失败: ${e instanceof Error ? e.message : String(e)}`)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════
// WebSocket Protocol
// ═══════════════════════════════════════════════════════════

function send(msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function connect() {
  ws = new WebSocket(HUB_URL)

  ws.on("open", () => {
    log.info(`连接 Hub，注册为 ${AGENT_NAME}`)
    send({
      type: "agent:hello",
      agentId: AGENT_ID,
      name: AGENT_NAME,
      version: "2.0.0",
      capabilities: ["dispatcher", "scheduler", "general"],
    })
    // Sync existing agents: fetch from Hub API
    setTimeout(syncWorkerPool, 2000)
  })

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      await handleMessage(msg)
    } catch { /* ignore malformed */ }
  })

  ws.on("close", () => {
    log.warn("断开，5s 后重连...")
    clearInterval(heartbeatTimer)
    setTimeout(connect, 5000)
  })

  ws.on("error", (e: Error) => { log.error(`WS: ${e.message}`) })

  heartbeatTimer = setInterval(() => send({ type: "agent:status" }), 30000)
}

async function handleMessage(msg: Record<string, unknown>) {
  switch (msg.type) {
    case "agent:registered":
      log.info(`注册成功 — 开始监听任务`)
      break

    case "agent:update":
    case "agent:hello": {
      // Track worker pool — Hub broadcasts agent:update on register/claim/done
      const agentId = msg.agentId as string
      if (agentId && agentId !== AGENT_ID && !agentId.startsWith("dashboard") && !agentId.startsWith("term-")) {
        const existing = workerPool.get(agentId)
        const caps = (Array.isArray(msg.capabilities) && (msg.capabilities as any[]).length > 0)
          ? (msg.capabilities as string[])
          : existing?.capabilities || []
        workerPool.set(agentId, {
          agentId,
          name: (msg.name as string) || existing?.name || agentId,
          status: (msg.status === "working" || msg.status === "idle") ? msg.status : (existing?.status || "idle"),
          capabilities: caps,
          lastSeen: Date.now(),
        })
      }
      break
    }

    case "agent:status": {
      const agentId = msg.agentId || msg.from as string
      if (agentId && workerPool.has(agentId)) {
        workerPool.get(agentId)!.lastSeen = Date.now()
      }
      break
    }

    case "agent:offline": {
      const agentId = msg.agentId as string
      if (agentId) workerPool.delete(agentId)
      break
    }

    case "task:released": {
      // Task released back to pool (Worker rejection, patrol cleanup, execution failure)
      const taskId = msg.taskId as string
      const reason = (msg.reason as string) || "未知"
      // 跨队列生命周期的持久化重试计数
      const retryCount = (retryTracker.get(taskId) || 0) + 1
      retryTracker.set(taskId, retryCount)
      if (retryCount > MAX_RETRIES) {
        log.warn(`❌ ${taskId} 已达最大重试次数 (${MAX_RETRIES})，标记为失败 — ${reason}`)
        retryTracker.delete(taskId)
        send({ type: "task:done", taskId, agentId: AGENT_ID, result: `[Chronos] 自动重试 ${MAX_RETRIES} 次后放弃 — ${reason}` })
        break
      }
      log.info(`🔄 重试 ${taskId} (#${retryCount}/${MAX_RETRIES}) — ${reason}`)
      // 从现有队列条目或分析结果中保留任务信息
      const existing = taskQueue.find(t => t.taskId === taskId)
      taskQueue.push({
        taskId,
        title: existing?.title || taskId,
        type: existing?.type || "general",
        priority: existing?.priority || "normal",
        requiredCaps: existing?.requiredCaps || [],
        createdAt: Date.now(),
        retryCount,
        maxRetries: MAX_RETRIES,
      })
      setTimeout(processQueue, 500)
      break
    }

    case "task:announced": {
      const taskId = msg.taskId as string
      const title = (msg.title as string) || taskId

      log.info(`📨 新任务: ${taskId}`)

      // AI analysis
      const analyzed = await analyzeTask(taskId, title)
      if (analyzed) {
        taskQueue.push(analyzed)
        log.info(`  → 类型: ${analyzed.type} | 优先级: ${analyzed.priority} | 能力: [${analyzed.requiredCaps.join(",")}]`)
        // Try to dispatch immediately
        processQueue()
      }
      break
    }

    case "task:completed":
    case "task:done": {
      // Worker freed up → process queue
      const agentId = (msg.agentId || msg.from) as string
      if (agentId && workerPool.has(agentId)) {
        workerPool.get(agentId)!.status = "idle"
      }

      const taskId = msg.taskId as string
      const result = (msg.result as string) || ""
      // 任务成功完成 → 清理重试计数
      retryTracker.delete(taskId)

      // Multi-agent collaboration: assign review for code/analysis tasks
      if (taskId && result && !taskId.startsWith("PATROL-") && !taskId.startsWith("REVIEW-")) {
        const analyzed = await analyzeTask(taskId, (msg.title as string) || taskId)
        if (analyzed && (analyzed.type === "code" || analyzed.type === "quant")) {
          // Assign a DIFFERENT worker to review
          const reviewers = [...workerPool.values()].filter(w =>
            w.status === "idle" && w.agentId !== agentId &&
            (w.capabilities.includes("code") || w.capabilities.includes("general"))
          )
          if (reviewers.length > 0) {
            const reviewer = reviewers[0]
            const reviewId = `REVIEW-${taskId}`
            log.info(`🔍 协同审查: ${taskId} → ${reviewer.name}`)
            try {
              await fetch("http://127.0.0.1:3000/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  taskId: reviewId,
                  title: `审查: ${taskId}`,
                  template: "",
                  params: {},
                }),
              })
              // Dispatch to reviewer
              send({
                type: "task:assign",
                taskId: reviewId,
                agentId: reviewer.agentId,
                assignedBy: AGENT_ID,
              })
            } catch {}
          }
        }
      }

      setTimeout(processQueue, 500)
      break
    }

    case "task:claim": {
      // Worker claimed → mark as working
      const agentId = msg.agentId as string
      if (agentId && workerPool.has(agentId)) {
        workerPool.get(agentId)!.status = "working"
      }
      break
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Active Patrol — AI 主动巡检 + 自动修复
// ═══════════════════════════════════════════════════════════

async function activePatrol() {
  log.info("🔍 开始主动巡检...")

  // Step 1: 先清理卡住任务（不再只是报告，而是主动修复）
  const freedCount = await cleanupStuckTasks()
  if (freedCount > 0) {
    log.info(`✅ 巡检修复: 释放了 ${freedCount} 个卡住任务`)
  }

  // Gather system state
  let systemInfo = ""
  try {
    const resp = await fetch("http://127.0.0.1:3000/api/status")
    const data = await resp.json() as any
    const total = data.tasks?.length || 0
    const stuck = (data.tasks || []).filter((t: any) => t.status === "assigned" && !t.result).length
    const workers = data.agents?.filter((a: any) => !a.agentId?.startsWith("dashboard") && !a.agentId?.startsWith("term-")).length || 0
    systemInfo = `系统状态: ${total}个任务, ${stuck}个卡住, ${workers}个Agent在线, Worker池${workerPool.size}个`
  } catch { systemInfo = "无法获取系统状态" }

  // Fetch market overview + dynamic scheduling
  let marketInfo = ""
  let volatilityHigh = false
  try {
    const resp = await circuitBreaker.wrap("okx-api", () => fetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT"))
    const data = await resp.json() as any
    if (data.data?.[0]) {
      const t = data.data[0]
      const change24h = parseFloat(t.open24h) ? Math.abs((t.last - t.open24h) / t.open24h * 100) : 0
      marketInfo = `BTC $${parseFloat(t.last).toFixed(0)} 24h ${change24h.toFixed(1)}% 量${(parseFloat(t.vol24h) / 1e6).toFixed(0)}M`
      // High volatility threshold: >3% in 24h
      if (change24h > 3) volatilityHigh = true
    }
  } catch { marketInfo = "无法获取行情" }

  // Dynamic scheduling: high volatility → create urgent analysis task
  if (volatilityHigh) {
    log.info(`⚠️ 高波动检测: BTC 24h变动 >3%，触发紧急分析`)
    // Check if there's already a recent market analysis task
    const hasRecent = taskQueue.some(t => t.type === "quant" && t.priority === "high")
    if (!hasRecent) {
      const taskId = `VOL-${Date.now().toString(36)}`
      try {
        await fetch("http://127.0.0.1:3000/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            title: `[高波动警报] BTC 24h变动 >3%，紧急行情分析`,
            template: "",
            params: {},
          }),
        })
        log.info(`🚨 已创建高波动分析任务: ${taskId}`)
      } catch {}
    }
  }

  const idle = [...workerPool.values()].filter(w => w.status === "idle").length
  const busy = [...workerPool.values()].filter(w => w.status === "working").length

  const patrolPrompt = `你是 Chronos，AI 调度官。执行系统巡检。

${systemInfo}
${marketInfo}
Worker池: ${idle}空闲 ${busy}忙碌
任务队列: ${taskQueue.length}个

检查:
1. Worker是否都健康？有没有死的？
2. 市场有没有异常波动（涨跌>5%）需要加频分析？
3. 系统是否有异常需要告警？

返回JSON:
{
  "issues": [
    { "severity": "high|medium|low", "title": "问题", "action": "建议", "shouldCreateTask": true|false }
  ],
  "summary": "一句话总结"
}

如果没有问题，issues可以是空数组。只需返回JSON。`

  try {
    const result = await agent.run(patrolPrompt, {}, {
      model: "claude-haiku-4-5",
      maxTokens: 500,
      maxSteps: 1,
      temperature: 0,
    })
    const json = result.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return
    const report = JSON.parse(json)
    // Record cost with actual model
    costTracker.record({
      agentId: AGENT_ID,
      model: result.model || "claude-haiku-4-5",
      provider: result.provider || "unknown",
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
      purpose: "patrol",
    })

    if (report.summary) log.info(`📋 巡检: ${report.summary}`)

    // 外部告警检查
    try {
      const alertCtx = {
        processHealth: { missing: [] },  // PM2 健康由 Hub 端点暴露
        circuits: {
          openCount: circuitBreaker.status().filter(c => c.state === "OPEN").length,
          names: circuitBreaker.status().filter(c => c.state === "OPEN").map(c => c.name),
        },
        costs: {
          todayCost: 0,  // 从 /api/costs 获取
          budget: DAILY_BUDGET_USD,
        },
        queue: {
          depth: taskQueue.length,
          threshold: QUEUE_DEPTH_WARN,
        },
      }
      // 尝试获取成本数据
      try {
        const costsResp = await fetch("http://127.0.0.1:3000/api/costs")
        const costsData = await costsResp.json() as any
        alertCtx.costs.todayCost = costsData.today?.cost || 0
      } catch {}
      // 尝试获取 PM2 健康
      try {
        const pm2Resp = await fetch("http://127.0.0.1:3000/api/health/pm2")
        const pm2Data = await pm2Resp.json() as any
        if (pm2Data.missing?.length) alertCtx.processHealth.missing = pm2Data.missing
      } catch {}
      await checkAndAlert(alertCtx)
    } catch {}

    // 自愈闭环：发现问题 → 自动创建修复任务 → AI修复 → 验证 → 关闭
    for (const issue of report.issues || []) {
      if (issue.shouldCreateTask) {
        const taskId = `HEAL-${Date.now().toString(36)}`
        log.info(`🔧 创建自愈任务: [${issue.severity}] ${issue.title}`)
        try {
          await fetch("http://127.0.0.1:3000/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskId,
              title: `[自愈·${issue.severity}] ${issue.title}`,
              template: "self-heal",
              params: {
                trigger: `Chronos巡检发现: ${issue.title}`,
                context: `${issue.action}\n系统状态: ${systemInfo}\n市场: ${marketInfo}`,
              },
            }),
          })
        } catch {}
      }
    }
  } catch (e) {
    log.warn(`巡检分析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ═══════════════════════════════════════════════════════════
// Periodic Health Check + Patrol
// ═══════════════════════════════════════════════════════════

const PATROL_INTERVAL = parseInt(process.env.CHRONOS_PATROL_INTERVAL || "300000", 10) // 5 min default

setInterval(() => {
  // 定期从 API 全量同步 Worker 池（自动清理下线 Worker + 发现新 Worker）
  syncWorkerPool()
}, INTERVAL_MS)

// 额外卡住任务清理：每60秒检查一次，快速释放
setInterval(async () => {
  const count = await cleanupStuckTasks()
  if (count > 0) {
    log.info(`⏰ 定时清理: 释放了 ${count} 个卡住任务`)
  }
}, 60000)

// Patrol runs on a separate (shorter) interval
setInterval(activePatrol, PATROL_INTERVAL)
setTimeout(activePatrol, 10000)  // First patrol after 10s

// ═══════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════

log.info(`Chronos AI 调度官启动`)
connect()

process.on("SIGINT", () => { clearInterval(heartbeatTimer); ws.close(); process.exit(0) })
process.on("SIGTERM", () => { clearInterval(heartbeatTimer); ws.close(); process.exit(0) })
