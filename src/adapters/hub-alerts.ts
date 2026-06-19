/**
 * 外部告警 — Webhook 通知系统
 *
 * 触发场景: 进程下线 / 熔断器开路 / 成本超额 / 队列积压
 * 支持: Discord / Slack / 通用 Webhook
 * 防抖: 同类告警 5 分钟内不重复发送
 */

import { logger } from "../utils/logger.js"

const log = logger("Alert")

// ═══════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════

const WEBHOOK_URL = process.env.HUB_ALERT_WEBHOOK || ""
const DAILY_BUDGET_USD = parseFloat(process.env.HUB_DAILY_BUDGET || "5.00")
const QUEUE_DEPTH_WARN = parseInt(process.env.HUB_QUEUE_WARN || "10", 10)
const DEBOUNCE_MS = 5 * 60 * 1000  // 5 分钟防抖

interface AlertRecord {
  type: string
  key: string       // 去重键: type:detail
  firedAt: number
}

const firedAlerts = new Map<string, number>()

function shouldFire(key: string): boolean {
  const last = firedAlerts.get(key)
  if (last && Date.now() - last < DEBOUNCE_MS) return false
  firedAlerts.set(key, Date.now())
  // 清理老旧记录
  if (firedAlerts.size > 100) {
    const cutoff = Date.now() - 3600_000
    for (const [k, t] of firedAlerts) { if (t < cutoff) firedAlerts.delete(k) }
  }
  return true
}

// ═══════════════════════════════════════════════════════════
// 发送
// ═══════════════════════════════════════════════════════════

async function postWebhook(payload: Record<string, unknown>): Promise<boolean> {
  if (!WEBHOOK_URL) return false
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return true
  } catch { return false }
}

function buildDiscordPayload(title: string, description: string, color: number, fields?: Array<{ name: string; value: string }>) {
  return {
    embeds: [{
      title,
      description,
      color,
      fields: fields || [],
      timestamp: new Date().toISOString(),
      footer: { text: "hvip-hub · AI Agent 集群" },
    }],
  }
}

// ═══════════════════════════════════════════════════════════
// 告警类型
// ═══════════════════════════════════════════════════════════

/** 进程下线 */
async function alertProcessDown(processName: string, details?: string): Promise<boolean> {
  if (!shouldFire(`process:${processName}`)) return false
  const p = buildDiscordPayload(
    `🔴 进程下线: ${processName}`,
    details || `${processName} 已停止响应`,
    0xFF0000,
    [{ name: "进程", value: processName }, { name: "时间", value: new Date().toLocaleString() }],
  )
  return postWebhook(p)
}

/** 熔断器开路 */
async function alertCircuitOpen(circuitName: string): Promise<boolean> {
  if (!shouldFire(`circuit:${circuitName}`)) return false
  const p = buildDiscordPayload(
    `⚠️ 熔断器开路: ${circuitName}`,
    `${circuitName} 连续失败 3 次，已熔断 60 秒`,
    0xFFA500,
    [{ name: "熔断器", value: circuitName }, { name: "建议", value: "检查外部服务是否可用" }],
  )
  return postWebhook(p)
}

/** 成本超额 */
async function alertBudgetExceeded(dailyCost: number, budget: number): Promise<boolean> {
  if (!shouldFire("budget:daily")) return false
  const p = buildDiscordPayload(
    `💰 成本超额: $${dailyCost.toFixed(2)} / $${budget.toFixed(2)}`,
    `今日 LLM 费用已超过预算 ${((dailyCost / budget) * 100).toFixed(0)}%`,
    0xFFFF00,
    [
      { name: "今日费用", value: `$${dailyCost.toFixed(2)}` },
      { name: "日预算", value: `$${budget.toFixed(2)}` },
    ],
  )
  return postWebhook(p)
}

/** 队列积压 */
async function alertQueueOverflow(queueDepth: number, threshold: number): Promise<boolean> {
  if (!shouldFire(`queue:${Math.floor(Date.now() / 300000)}`)) return false
  const p = buildDiscordPayload(
    `📊 队列积压: ${queueDepth} 个任务`,
    `任务队列超过警戒线 (${threshold})，Worker 可能不足`,
    0x3498DB,
    [
      { name: "队列深度", value: String(queueDepth) },
      { name: "警戒线", value: String(threshold) },
    ],
  )
  return postWebhook(p)
}

/** 通用告警 */
async function alertGeneral(title: string, description: string, severity: "high" | "medium" | "low" = "medium"): Promise<boolean> {
  const colors = { high: 0xFF0000, medium: 0xFFA500, low: 0x3498DB }
  if (!shouldFire(`general:${title}`)) return false
  return postWebhook(buildDiscordPayload(title, description, colors[severity]))
}

// ═══════════════════════════════════════════════════════════
// 统一接口
// ═══════════════════════════════════════════════════════════

export interface AlertContext {
  processHealth?: { missing: string[] }
  circuits?: { openCount: number; names: string[] }
  costs?: { todayCost: number; budget: number }
  queue?: { depth: number; threshold: number }
}

export async function checkAndAlert(ctx: AlertContext): Promise<string[]> {
  const sent: string[] = []

  // 进程健康
  if (ctx.processHealth?.missing?.length) {
    for (const name of ctx.processHealth.missing) {
      if (await alertProcessDown(name)) sent.push(`process:${name}`)
    }
  }

  // 熔断器
  if (ctx.circuits?.openCount && ctx.circuits.openCount > 0) {
    for (const name of ctx.circuits.names) {
      if (await alertCircuitOpen(name)) sent.push(`circuit:${name}`)
    }
  }

  // 成本
  if (ctx.costs && ctx.costs.todayCost > ctx.costs.budget) {
    if (await alertBudgetExceeded(ctx.costs.todayCost, ctx.costs.budget)) sent.push("budget")
  }

  // 队列
  if (ctx.queue && ctx.queue.depth > ctx.queue.threshold) {
    if (await alertQueueOverflow(ctx.queue.depth, ctx.queue.threshold)) sent.push("queue")
  }

  if (sent.length > 0) {
    log.info(`已发送 ${sent.length} 条告警: ${sent.join(", ")}`)
  }
  return sent
}

export { DAILY_BUDGET_USD, QUEUE_DEPTH_WARN }
