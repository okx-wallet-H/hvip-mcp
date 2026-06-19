/**
 * Worker Scaler — 弹性伸缩 (P5-1)
 * =================================
 * 根据队列深度和 Worker 负载自动扩缩 Worker 池。
 *
 * 规则:
 *   - 队列积压 >5 且空闲 Worker = 0 → 拉新 Worker (max 5)
 *   - Worker 空闲 >10min 且总数 >2 → 回收
 *
 * 通过 Hub API 管理 Worker:
 *   - POST /api/workers/scale?action=up    → 启动新 Worker
 *   - POST /api/workers/scale?action=down  → 停止 Worker
 *
 * PM2:
 *   pm2 start dist/worker-scaler.js --name worker-scaler
 */

import { logger } from "./utils/logger.js"

const HUB_API = process.env.HUB_API || "http://127.0.0.1:3000"
const SCALE_INTERVAL_MS = parseInt(process.env.SCALE_INTERVAL || "30000", 10)
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || "5", 10)
const MIN_WORKERS = parseInt(process.env.MIN_WORKERS || "2", 10)
const SCALE_UP_QUEUE = parseInt(process.env.SCALE_UP_QUEUE || "3", 10)
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT || "600000", 10)  // 10min

const log = logger("Scaler")

// Track worker idle times
const workerIdleSince = new Map<string, number>()

async function getHubStatus(): Promise<any> {
  try {
    const resp = await fetch(`${HUB_API}/api/status`)
    return await resp.json()
  } catch (e: any) {
    log.warn(`Hub 状态获取失败: ${e.message}`)
    return null
  }
}

async function scaleUp(): Promise<boolean> {
  try {
    const resp = await fetch(`${HUB_API}/api/workers/scale?action=up`, { method: "POST" })
    if (resp.ok) {
      log.info("✅ 扩容: 新 Worker 已启动")
      return true
    }
    log.warn(`扩容失败: HTTP ${resp.status}`)
    return false
  } catch (e: any) {
    log.warn(`扩容请求失败: ${e.message}`)
    return false
  }
}

async function scaleDown(workerId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${HUB_API}/api/workers/scale?action=down&worker=${encodeURIComponent(workerId)}`, { method: "POST" })
    if (resp.ok) {
      log.info(`✅ 缩容: Worker ${workerId} 已回收`)
      return true
    }
    return false
  } catch {
    return false
  }
}

async function tick() {
  const status = await getHubStatus()
  if (!status) return

  const agents = status.agents || []
  const tasks = status.tasks || []

  // Count workers
  const workers = agents.filter((a: any) =>
    a.agentId && (a.agentId.includes("worker") || a.agentId.includes("Worker"))
  )
  const totalWorkers = workers.length
  const idleWorkers = workers.filter((w: any) => w.status === "idle")
  const busyWorkers = workers.filter((w: any) => w.status === "working")

  // Track idle times
  const now = Date.now()
  for (const w of idleWorkers) {
    if (!workerIdleSince.has(w.agentId)) {
      workerIdleSince.set(w.agentId, now)
    }
  }
  // Clear idle tracking for busy workers
  for (const w of busyWorkers) {
    workerIdleSince.delete(w.agentId)
  }
  // Clean up disconnected workers
  for (const [id] of workerIdleSince) {
    if (!workers.find((w: any) => w.agentId === id)) {
      workerIdleSince.delete(id)
    }
  }

  // Queue depth: unassigned tasks
  const queueDepth = tasks.filter((t: any) => t.status === "unassigned").length

  log.debug(`Workers: ${totalWorkers} (${idleWorkers.length} idle, ${busyWorkers.length} busy) | Queue: ${queueDepth}`)

  // Scale up: queue growing, no idle workers
  if (queueDepth >= SCALE_UP_QUEUE && idleWorkers.length === 0 && totalWorkers < MAX_WORKERS) {
    log.info(`📈 队列积压 ${queueDepth}，扩容中...`)
    await scaleUp()
  }

  // Scale down: workers idle too long
  if (totalWorkers > MIN_WORKERS) {
    for (const w of idleWorkers) {
      const idleStart = workerIdleSince.get(w.agentId)
      if (idleStart && (now - idleStart) > IDLE_TIMEOUT_MS) {
        log.info(`📉 Worker ${w.agentId} 空闲 ${Math.round((now - idleStart) / 60000)}min，缩容中...`)
        await scaleDown(w.agentId)
        workerIdleSince.delete(w.agentId)
        break  // One at a time to avoid over-shrinking
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════

log.info(`Worker Scaler 启动 — min=${MIN_WORKERS} max=${MAX_WORKERS} interval=${SCALE_INTERVAL_MS}ms`)
tick()
setInterval(tick, SCALE_INTERVAL_MS)

process.on("SIGINT", () => { log.info("关闭"); process.exit(0) })
process.on("SIGTERM", () => { log.info("关闭"); process.exit(0) })
