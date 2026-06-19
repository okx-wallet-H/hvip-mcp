/**
 * AI Trader Bridge — 连接 AI 决策和 OKX 交易执行
 * =====================================================
 *
 * 三种模式:
 *   simulate — 纯本地模拟（默认，零风险）
 *   demo     — OKX 模拟交易（x-simulated-trading header）
 *   live     — OKX 实盘交易
 *
 * 风控:
 *   - 单笔限额 TRADER_MAX_ORDER_USD（默认 $100）
 *   - 日亏损熔断 TRADER_DAILY_LOSS_LIMIT（默认 $500）
 *   - live 模式需显式确认（AI_TRADER_MODE=live + 日志警告）
 */

import { privateApi, type Auth } from "./adapters/okx.js"
import { getAuth } from "./tools/shared.js"
import { logger } from "./utils/logger.js"

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

export type BridgeMode = "simulate" | "demo" | "live"

const MODE: BridgeMode = (process.env.AI_TRADER_MODE || "simulate") as BridgeMode
const MAX_ORDER_USD = parseFloat(process.env.TRADER_MAX_ORDER_USD || "100")
const DAILY_LOSS_LIMIT = parseFloat(process.env.TRADER_DAILY_LOSS_LIMIT || "500")
const SWAP_SUFFIX = "-SWAP"  // OKX perpetual swap suffix

const log = logger("TraderBridge")

// ═══════════════════════════════════════════════════════════════
// Daily loss tracking
// ═══════════════════════════════════════════════════════════════

let todayLoss = 0
let todayDate = new Date().toISOString().slice(0, 10)

function resetDailyIfNew() {
  const d = new Date().toISOString().slice(0, 10)
  if (d !== todayDate) { todayLoss = 0; todayDate = d }
}

function addDailyLoss(amount: number) {
  resetDailyIfNew()
  todayLoss += amount
}

function isDailyLossExceeded(): boolean {
  resetDailyIfNew()
  return todayLoss >= DAILY_LOSS_LIMIT
}

// ═══════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════

function getBridgeAuth(): Auth | null {
  const auth = getAuth()
  if (!auth) return null
  if (MODE === "demo") {
    return { ...auth, isDemo: true }
  }
  return auth
}

// ═══════════════════════════════════════════════════════════════
// Symbol conversion: BTC/USDT → BTC-USDT-SWAP
// ═══════════════════════════════════════════════════════════════

function toInstId(symbol: string): string {
  const s = symbol.replace("/", "-")
  return s.includes("-SWAP") ? s : s + SWAP_SUFFIX
}

// ═══════════════════════════════════════════════════════════════
// Contract size calculation
// ═══════════════════════════════════════════════════════════════

function calcContractSize(usdAmount: number, price: number, leverage: number): number {
  // OKX swap contracts: 1 contract = 0.01 BTC, 0.1 ETH, 10 SOL
  // We approximate: sz = (usdAmount * leverage) / price, then round
  const raw = (usdAmount * leverage) / price
  // BTC: 0.01 granularity, ETH: 0.1, SOL: 10, default: 1
  return Math.max(1, Math.round(raw))
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

export function getMode(): BridgeMode { return MODE }

export function getRiskStatus(): { mode: BridgeMode; maxOrderUsd: number; dailyLossLimit: number; todayLoss: number; remainingBudget: number } {
  return {
    mode: MODE,
    maxOrderUsd: MAX_ORDER_USD,
    dailyLossLimit: DAILY_LOSS_LIMIT,
    todayLoss,
    remainingBudget: Math.max(0, DAILY_LOSS_LIMIT - todayLoss),
  }
}

/**
 * Execute an open position order.
 * In simulate mode, returns a fake order ID.
 * In demo/live mode, calls OKX placeOrder + setLeverage.
 */
export async function executeOpen(order: {
  traderId: string
  symbol: string
  direction: string
  leverage: number
  entryPrice: number
  capital: number
  reasoning: string
}): Promise<{ ok: boolean; orderId?: string; error?: string; mode: BridgeMode }> {

  if (MODE === "simulate") {
    const fakeId = `SIM-${order.traderId}-${Date.now()}`
    log.info(`[模拟] ${order.traderId} 开仓 ${order.direction} ${order.symbol} ${order.leverage}x @ $${order.entryPrice.toFixed(1)} → ${fakeId}`)
    return { ok: true, orderId: fakeId, mode: "simulate" }
  }

  // ── Risk checks ──
  if (order.capital > MAX_ORDER_USD) {
    return { ok: false, error: `单笔金额 $${order.capital.toFixed(0)} 超过限额 $${MAX_ORDER_USD}`, mode: MODE }
  }
  if (isDailyLossExceeded()) {
    return { ok: false, error: `日亏损 $${todayLoss.toFixed(0)} 已达熔断线 $${DAILY_LOSS_LIMIT}`, mode: MODE }
  }

  const auth = getBridgeAuth()
  if (!auth) {
    return { ok: false, error: "OKX API Key 未配置", mode: MODE }
  }

  const instId = toInstId(order.symbol)
  const side = order.direction === "LONG" ? "buy" : "sell"
  const posSide = order.direction === "LONG" ? "long" : "short"
  const sz = calcContractSize(order.capital, order.entryPrice, order.leverage)

  try {
    // Set leverage first
    await privateApi.setLeverage(auth, {
      instId,
      lever: String(order.leverage),
      mgnMode: "cross",
    })

    // Place market order
    const result = await privateApi.placeOrder(auth, {
      instId,
      tdMode: "cross",
      side,
      posSide,
      ordType: "market",
      sz: String(sz),
    }) as { ordId?: string; code?: string; msg?: string }[]

    const ordId = result?.[0]?.ordId || `OKX-${order.traderId}-${Date.now()}`
    log.info(`[${MODE.toUpperCase()}] ${order.traderId} 开仓 ${side} ${instId} ${order.leverage}x sz=${sz} → ${ordId}`)
    return { ok: true, orderId: ordId, mode: MODE }

  } catch (e: any) {
    const msg = e?.message || String(e)
    log.error(`[${MODE}] 开仓失败: ${msg}`)
    return { ok: false, error: msg, mode: MODE }
  }
}

/**
 * Execute a close position order.
 * In simulate mode, returns success.
 * In demo/live mode, calls OKX closePosition.
 */
export async function executeClose(position: {
  traderId: string
  symbol: string
  direction: string
  realizedPnl?: number
}): Promise<{ ok: boolean; orderId?: string; error?: string; mode: BridgeMode }> {

  if (MODE === "simulate") {
    log.info(`[模拟] ${position.traderId} 平仓 ${position.direction} ${position.symbol}`)
    return { ok: true, orderId: `SIM-CLOSE-${Date.now()}`, mode: "simulate" }
  }

  const auth = getBridgeAuth()
  if (!auth) {
    return { ok: false, error: "OKX API Key 未配置", mode: MODE }
  }

  // Track realized loss for daily circuit breaker
  if (position.realizedPnl !== undefined && position.realizedPnl < 0) {
    addDailyLoss(Math.abs(position.realizedPnl))
  }

  const instId = toInstId(position.symbol)
  const posSide = position.direction === "LONG" ? "long" : "short"

  try {
    const result = await privateApi.closePosition(auth, {
      instId,
      posSide,
      mgnMode: "cross",
    }) as { ordId?: string }[]

    const ordId = result?.[0]?.ordId || `OKX-CLOSE-${Date.now()}`
    log.info(`[${MODE.toUpperCase()}] ${position.traderId} 平仓 ${posSide} ${instId} → ${ordId}`)
    return { ok: true, orderId: ordId, mode: MODE }

  } catch (e: any) {
    const msg = e?.message || String(e)
    log.error(`[${MODE}] 平仓失败: ${msg}`)
    return { ok: false, error: msg, mode: MODE }
  }
}

/**
 * Sync positions from OKX to local state.
 * In simulate mode, returns empty (no sync needed).
 */
export async function syncPositions(): Promise<{
  mode: BridgeMode
  positions: Array<{ instId: string; posSide: string; pos: string; avgPx: string; upl: string }>
}> {
  if (MODE === "simulate") {
    return { mode: "simulate", positions: [] }
  }

  const auth = getBridgeAuth()
  if (!auth) {
    log.warn("无法同步持仓: OKX API Key 未配置")
    return { mode: MODE, positions: [] }
  }

  try {
    const result = await privateApi.getPositions(auth, "SWAP") as any[]
    const positions = (result || []).filter((p: any) => p.pos !== "0").map((p: any) => ({
      instId: p.instId,
      posSide: p.posSide,
      pos: p.pos,
      avgPx: p.avgPx,
      upl: p.upl,
    }))
    return { mode: MODE, positions }
  } catch (e: any) {
    log.warn(`同步持仓失败: ${e?.message || String(e)}`)
    return { mode: MODE, positions: [] }
  }
}

// ═══════════════════════════════════════════════════════════════
// Startup log
// ═══════════════════════════════════════════════════════════════

if (MODE === "live") {
  log.warn("⚠️  ═══ 实盘模式 AI_TRADER_MODE=live ═══")
  log.warn("⚠️  AI 将直接下单到 OKX 真实账户！")
  log.warn(`⚠️  风控: 单笔≤$${MAX_ORDER_USD} 日亏损≤$${DAILY_LOSS_LIMIT}`)
} else if (MODE === "demo") {
  log.info("🔶 OKX 模拟交易模式（x-simulated-trading）")
  log.info(`🔶 风控: 单笔≤$${MAX_ORDER_USD} 日亏损≤$${DAILY_LOSS_LIMIT}`)
} else {
  log.info("🟢 纯本地模拟，不连接 OKX")
}
