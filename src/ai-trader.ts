/**
 * AI Trader Engine — 基于 AgentLoop 的智能交易员
 * =================================================
 *
 * 替代 trader-sim.mjs 中的硬编码决策逻辑。
 * 每个交易员 AI 用完整的 AgentLoop + 实时数据做决策。
 *
 * 决策流程:
 *   1. 从信号广场读最新信号
 *   2. 每个交易员: AgentLoop 分析信号 + 市场数据 + 历史绩效
 *   3. AI 返回 JSON: { action, direction, leverage, tp, sl, reasoning }
 *   4. 执行模拟交易 → 更新绩效
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { AgentLoop } from "./adapters/ai-sdk.js"
import { logger } from "./utils/logger.js"
import { executeOpen, executeClose, syncPositions, getMode, getRiskStatus, type BridgeMode } from "./ai-trader-bridge.js"

// ═══════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════

const STATE_FILE = join(process.cwd(), ".hub", "trader-state.json")
const INTERVAL_MS = parseInt(process.env.TRADER_INTERVAL || "3600000", 10)
const log = logger("AI-Trader")
const agent = new AgentLoop()

// ═══════════════════════════════════════════════════════════
// Realistic Trading Costs (simulate mode only)
// ═══════════════════════════════════════════════════════════

const SLIPPAGE = 0.0002         // 0.02% — 入场/出场各扣
const TAKER_FEE = 0.0005        // 0.05% — taker手续费，每笔
const FUNDING_RATE = 0.0001     // 0.01% — 每8h资金费率（多头付空头 or 空头付多头）
const FUNDING_INTERVAL_MS = 8 * 3600_000

function applyCosts(entryPrice: number, exitPrice: number, direction: string, capital: number, leverage: number, heldMs: number) {
  // Entry: slippage + fee
  const entrySlip = entryPrice * (direction === "LONG" ? (1 + SLIPPAGE) : (1 - SLIPPAGE))
  const entryFee = capital * TAKER_FEE
  // Exit: slippage + fee
  const exitSlip = exitPrice * (direction === "LONG" ? (1 - SLIPPAGE) : (1 + SLIPPAGE))
  const exitFee = capital * TAKER_FEE
  // Funding: every 8h
  const fundingPeriods = Math.floor(heldMs / FUNDING_INTERVAL_MS)
  const fundingCost = capital * leverage * FUNDING_RATE * fundingPeriods
  // Direction-independent: only price diff matters after costs
  return { entrySlip, exitSlip, entryFee, exitFee, fundingCost, totalCost: entryFee + exitFee + fundingCost }
}

// ═══════════════════════════════════════════════════════════
// AI Trader Personalities
// ═══════════════════════════════════════════════════════════

interface TraderProfile {
  id: string; name: string; emoji: string
  systemPrompt: string
  initialCapital: number
}

const TRADERS: TraderProfile[] = [
  {
    id: "ares", name: "Ares", emoji: "⚔️",
    systemPrompt: `你是 Ares (战神)，激进的合约交易员。
性格: 追涨杀跌，高杠杆猛攻，不怕亏损。
杠杆偏好: 10x-50x。止盈: 8-12%。止损: 3-5%。
策略: 趋势跟随。信号确认就重仓，错了快速止损。
决策风格: 果断，不犹豫。看好就满仓干。
返回格式: JSON`,
    initialCapital: 10000,
  },
  {
    id: "athena", name: "Athena", emoji: "🦉",
    systemPrompt: `你是 Athena (智慧女神)，策略均衡的交易员。
性格: 多指标确认后才出手，中等杠杆，严格风控。
杠杆偏好: 3x-10x。止盈: 3-5%。止损: 1.5-2.5%。
策略: 动量策略。等回调入场，不追高。
决策风格: 谨慎理性，需要多维度确认。
返回格式: JSON`,
    initialCapital: 10000,
  },
  {
    id: "hades", name: "Hades", emoji: "💀",
    systemPrompt: `你是 Hades (冥王)，逆向收割者。
性格: 众人恐惧时贪婪。市场情绪极端时反向操作。
杠杆偏好: 5x-20x。止盈: 8-15%。止损: 4-6%。
策略: 逆向交易。信号是LONG你偏要做空，信号是SHORT你偏要做多。
但要真有依据——不是乱反，是觉得市场过度反应了才反。
决策风格: 冷静，独立思考，不从众。
返回格式: JSON`,
    initialCapital: 10000,
  },
  {
    id: "apollo", name: "Apollo", emoji: "☀️",
    systemPrompt: `你是 Apollo (太阳神)，趋势确认交易员。
性格: 等待回调入场，严格止损。不做第一个吃螃蟹的人。
杠杆偏好: 3x-8x。止盈: 4-6%。止损: 2-3%。
策略: 趋势确认+回调入场。信号出来不急着跟，等价格回调到支撑/阻力附近再进。
决策风格: 耐心，纪律严明。宁可不做，不可做错。
返回格式: JSON`,
    initialCapital: 10000,
  },
]

// ═══════════════════════════════════════════════════════════
// AI Decision Making
// ═══════════════════════════════════════════════════════════

function buildDecisionPrompt(
  trader: TraderProfile,
  signals: Array<{ id: string; symbol: string; direction: string; confidence: number; price: number; grade: string; risk: { sl_price: number; tp_price: number } | null; ensemble: { avgSharpe: number; avgWinRate: number; avgTrades: number } }>,
  traderState: { capital: number; totalPnl: number; totalPnlPct: number; tradeCount: number; winCount: number; openPositions: Array<{ symbol: string; direction: string; entryPrice: number }> }
) {
  const sigList = signals.map(s =>
    `  ${s.id}: ${s.symbol} ${s.direction} conf=${s.confidence}% grade=${s.grade} price=$${s.price} Sharpe=${s.ensemble.avgSharpe.toFixed(2)} WinRate=${s.ensemble.avgWinRate.toFixed(0)}% SL=$${s.risk?.sl_price.toFixed(1)} TP=$${s.risk?.tp_price.toFixed(1)}`
  ).join("\n")

  const posList = traderState.openPositions.length > 0
    ? traderState.openPositions.map(p => `  ${p.direction} ${p.symbol} @ $${p.entryPrice}`).join("\n")
    : "  无持仓"

  return `当前信号广场:
${sigList || "  无信号"}

你的账户:
  本金: $${traderState.capital.toFixed(0)}
  总盈亏: ${traderState.totalPnl >= 0 ? "+" : ""}$${traderState.totalPnl.toFixed(0)} (${traderState.totalPnlPct >= 0 ? "+" : ""}${traderState.totalPnlPct.toFixed(1)}%)
  历史交易: ${traderState.tradeCount}笔 胜率${traderState.tradeCount > 0 ? Math.round(traderState.winCount / traderState.tradeCount * 100) : 0}%
  当前持仓: ${posList}

请做出交易决策。若有持仓先判断是否平仓，再看是否开新仓。

返回纯JSON，不要其他文字:
{
  "actions": [
    { "type": "close"|"open", "signalId": "SIG-xxx", "reasoning": "一句话理由" }
  ],
  "newPositions": [
    { "signalId": "SIG-xxx", "symbol": "BTC/USDT", "direction": "LONG"|"SHORT"|"SKIP", "leverage": 5, "tpPct": 4.0, "slPct": 2.0, "reasoning": "理由" }
  ]
}

规则:
- 已持仓的同币种不要重复开
- 最多同时持有2个仓位
- 置信度<40%的信号可以SKIP
- 杠杆不要超出你的风险偏好
- 如果觉得没有好机会，actions和newPositions可以是空数组`
}

async function traderDecide(trader: TraderProfile, signals: any[], state: any): Promise<any> {
  try {
    const result = await agent.run(
      buildDecisionPrompt(trader, signals, state),
      {},
      {
        model: "claude-sonnet-4-6",
        maxTokens: 800,
        maxSteps: 1,
        temperature: 0.4,
        system: trader.systemPrompt,
      }
    )
    const json = result.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null
    return JSON.parse(json)
  } catch (e) {
    log.warn(`${trader.emoji} ${trader.name} 决策失败: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ═══════════════════════════════════════════════════════════
// State Management
// ═══════════════════════════════════════════════════════════

function loadState(): any {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
  } catch {}
  return { traders: {}, history: [], round: 0 }
}

function saveState(state: any) {
  if (!existsSync(".hub")) mkdirSync(".hub", { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ═══════════════════════════════════════════════════════════
// Main Loop
// ═══════════════════════════════════════════════════════════

async function run() {
  const mode = getMode()
  log.info(`AI Trader Engine 启动 — 模式: ${mode}`)

  // Sync real positions from OKX (demo/live only)
  if (mode !== "simulate") {
    const sync = await syncPositions()
    if (sync.positions.length > 0) {
      log.info(`OKX 持仓同步: ${sync.positions.length} 个仓位`)
      for (const p of sync.positions) {
        log.info(`  ${p.posSide} ${p.instId} ${p.pos}张 @ $${p.avgPx} UPL=${p.upl}`)
      }
    }
  }

  // Fetch signals
  let signals: any[] = []
  try {
    const resp = await fetch("http://127.0.0.1:3000/api/signals")
    const data = await resp.json() as any
    signals = (data.signals || []).filter((s: any) => s.direction !== "NEUTRAL")
    log.info(`从信号广场获取 ${signals.length} 个有效信号`)
  } catch {
    log.warn("无法获取信号，跳过本轮")
    return
  }

  if (!signals.length) return

  // Update prices from real-time data (optional: fetch from OKX)
  for (const s of signals) {
    try {
      const instId = (s.symbol || "BTC/USDT").replace("/", "-")
      const resp = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`)
      const data = await resp.json() as any
      if (data.data?.[0]) {
        s.price = parseFloat(data.data[0].last)
      }
    } catch {}
  }

  const state = loadState()

  // Initialize traders if needed
  for (const t of TRADERS) {
    if (!state.traders[t.id]) {
      state.traders[t.id] = {
        id: t.id, name: t.name, emoji: t.emoji,
        capital: t.initialCapital, totalPnl: 0, totalPnlPct: 0,
        openPositions: [], closedPositions: [],
        tradeCount: 0, winCount: 0,
      }
    }
  }

  // Each trader makes AI decisions
  for (const t of TRADERS) {
    const trader = state.traders[t.id]

    // Skip if capital too low
    if (trader.capital < 500) continue

    const decision = await traderDecide(t, signals, trader)
    if (!decision) continue

    log.info(`${t.emoji} ${t.name} 决策: ${JSON.stringify(decision).slice(0, 200)}`)

    // Process new positions
    const newPositions = decision.newPositions || []
    for (const pos of newPositions) {
      if (pos.direction === "SKIP") continue

      const sig = signals.find((s: any) => s.id === pos.signalId || s.symbol === pos.symbol)
      const entryPrice = sig?.price || pos.entryPrice || 0
      if (!entryPrice) continue

      const tpPrice = pos.direction === "LONG"
        ? entryPrice * (1 + (pos.tpPct || 4) / 100)
        : entryPrice * (1 - (pos.tpPct || 4) / 100)
      const slPrice = pos.direction === "LONG"
        ? entryPrice * (1 - (pos.slPct || 2) / 100)
        : entryPrice * (1 + (pos.slPct || 2) / 100)

      // Realistic entry: apply slippage + deduct fee
      const slippageEntry = pos.direction === "LONG"
        ? entryPrice * (1 + SLIPPAGE)
        : entryPrice * (1 - SLIPPAGE)
      const entryFee = trader.capital * TAKER_FEE

      const order = {
        traderId: t.id,
        signalId: pos.signalId || sig?.id || "",
        symbol: pos.symbol || sig?.symbol || "BTC/USDT",
        direction: pos.direction,
        leverage: Math.min(100, Math.max(1, pos.leverage || 5)),
        entryPrice: slippageEntry,  // 实际成交价含滑点
        tpPrice: pos.direction === "LONG" ? slippageEntry * (1 + (pos.tpPct || 4) / 100) : slippageEntry * (1 - (pos.tpPct || 4) / 100),
        slPrice: pos.direction === "LONG" ? slippageEntry * (1 - (pos.slPct || 2) / 100) : slippageEntry * (1 + (pos.slPct || 2) / 100),
        tpPct: pos.tpPct || 4,
        slPct: pos.slPct || 2,
        capital: trader.capital - entryFee,
        openedAt: new Date().toISOString(),
        reasoning: pos.reasoning || "",
        entryFee,  // 记录实际成本
      }
      trader.capital -= entryFee  // 手续费扣本金
      trader.openPositions.push(order)
      trader.tradeCount++
      log.info(`  ${t.emoji} 开仓: ${order.direction} ${order.symbol} ${order.leverage}x @ $${slippageEntry.toFixed(1)} (滑点${(SLIPPAGE*100).toFixed(2)}% + 手续费$${entryFee.toFixed(1)})`)

      // Bridge to OKX (demo/live) or simulate
      const openResult = await executeOpen(order)
      if (openResult.ok) {
        order.okxOrderId = openResult.orderId
        log.info(`  ${t.emoji} → OKX[${openResult.mode}]: ${openResult.orderId}`)
      } else {
        log.warn(`  ${t.emoji} → OKX 开仓被拒: ${openResult.error}`)
      }
    }

    // Process close actions
    const closeActions = (decision.actions || []).filter((a: any) => a.type === "close")
    for (const action of closeActions) {
      const posIdx = trader.openPositions.findIndex((p: any) =>
        p.symbol === action.symbol || p.signalId === action.signalId
      )
      if (posIdx >= 0) {
        const pos = trader.openPositions[posIdx]
        const sig = signals.find((s: any) => s.id === pos.signalId || s.symbol === pos.symbol)
        const rawExitPrice = sig?.price || pos.entryPrice
        // Realistic exit: slippage + fee + funding
        const exitSlip = pos.direction === "LONG"
          ? rawExitPrice * (1 - SLIPPAGE)
          : rawExitPrice * (1 + SLIPPAGE)
        const exitFee = pos.capital * TAKER_FEE
        const heldMs = Date.now() - new Date(pos.openedAt).getTime()
        const fundingPeriods = Math.floor(heldMs / FUNDING_INTERVAL_MS)
        const fundingCost = pos.capital * pos.leverage * FUNDING_RATE * fundingPeriods
        const totalCost = (pos.entryFee || 0) + exitFee + fundingCost

        const dirMult = pos.direction === "LONG" ? 1 : -1
        const grossPnlPct = (exitSlip - pos.entryPrice) / pos.entryPrice * dirMult * 100 * pos.leverage
        const grossPnl = pos.capital * grossPnlPct / 100
        const realizedPnl = grossPnl - exitFee - fundingCost
        const realizedPnlPct = realizedPnl / (pos.capital + totalCost) * 100

        pos.closed = true
        pos.closedAt = new Date().toISOString()
        pos.realizedPnl = realizedPnl
        pos.realizedPnlPct = realizedPnlPct
        pos.exitPrice = exitSlip
        pos.result = realizedPnl > 0 ? "TP" : "SL"
        pos.totalCost = totalCost
        pos.heldMs = heldMs
        pos.fundingCost = fundingCost

        trader.closedPositions.push(pos)
        trader.openPositions.splice(posIdx, 1)
        trader.capital += realizedPnl
        trader.totalPnl += realizedPnl
        trader.totalPnlPct = (trader.totalPnl / t.initialCapital) * 100
        if (realizedPnl > 0) trader.winCount++
        log.info(`  ${t.emoji} 平仓: ${pos.direction} ${pos.symbol} PnL=${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)} (${realizedPnlPct >= 0 ? "+" : ""}${realizedPnlPct.toFixed(1)}%) 成本$${totalCost.toFixed(1)}`)

        // Bridge to OKX (demo/live) or simulate
        const closeResult = await executeClose({ traderId: t.id, symbol: pos.symbol, direction: pos.direction, realizedPnl })
        if (closeResult.ok) {
          log.info(`  ${t.emoji} → OKX[${closeResult.mode}] 平仓: ${closeResult.orderId}`)
        } else {
          log.warn(`  ${t.emoji} → OKX 平仓被拒: ${closeResult.error}`)
        }
      }
    }

    // Update open positions
    for (const pos of trader.openPositions) {
      if (pos.closed) continue
      const sig = signals.find((s: any) => s.id === pos.signalId || s.symbol === pos.symbol)
      if (sig?.price) {
        const dirMult = pos.direction === "LONG" ? 1 : -1
        pos.currentPrice = sig.price
        pos.unrealizedPnlPct = (sig.price - pos.entryPrice) / pos.entryPrice * dirMult * 100 * pos.leverage
        pos.unrealizedPnl = pos.capital * pos.unrealizedPnlPct / 100

        // Check TP/SL
        const hitTP = pos.direction === "LONG" ? sig.price >= pos.tpPrice : sig.price <= pos.tpPrice
        const hitSL = pos.direction === "LONG" ? sig.price <= pos.slPrice : sig.price >= pos.slPrice
        if (hitTP || hitSL) {
          // Auto-close: same exit costs as manual close
          const exitSlipPrice = pos.direction === "LONG" ? sig.price * (1 - SLIPPAGE) : sig.price * (1 + SLIPPAGE)
          const exitFee = pos.capital * TAKER_FEE
          const heldMs = Date.now() - new Date(pos.openedAt).getTime()
          const fundingPeriods = Math.floor(heldMs / FUNDING_INTERVAL_MS)
          const fundingCost = pos.capital * pos.leverage * FUNDING_RATE * fundingPeriods
          const totalCost = (pos.entryFee || 0) + exitFee + fundingCost

          const grossPnlPct = hitTP ? pos.tpPct * pos.leverage : -pos.slPct * pos.leverage
          const grossPnl = pos.capital * grossPnlPct / 100
          const realizedPnl = grossPnl - exitFee - fundingCost

          pos.closed = true
          pos.closedAt = new Date().toISOString()
          pos.realizedPnlPct = realizedPnl / (pos.capital + totalCost) * 100
          pos.realizedPnl = realizedPnl
          pos.result = hitTP ? "TP" : "SL"
          pos.exitPrice = exitSlipPrice
          pos.totalCost = totalCost
          pos.heldMs = heldMs

          trader.closedPositions.push(pos)
          trader.openPositions = trader.openPositions.filter((p: any) => p !== pos)
          trader.capital += realizedPnl
          trader.totalPnl += realizedPnl
          trader.totalPnlPct = (trader.totalPnl / t.initialCapital) * 100
          if (realizedPnl > 0) trader.winCount++
          log.info(`  ${t.emoji} ${pos.result}! ${pos.symbol} PnL=${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)} 成本$${totalCost.toFixed(1)} (${heldMs >= 3600000 ? Math.floor(heldMs/3600000)+'h' : Math.floor(heldMs/60000)+'m'})`)
        }
      }
    }

    // Clean up old closed positions
    if (trader.closedPositions.length > 50) {
      trader.closedPositions = trader.closedPositions.slice(-50)
    }
  }

  state.round++
  state.lastUpdate = new Date().toISOString()
  saveState(state)

  // Leaderboard
  const rankings = Object.values(state.traders as Record<string, any>)
    .sort((a: any, b: any) => b.totalPnlPct - a.totalPnlPct)
  log.info(`\n  ═══ AI Trader Leaderboard (Round ${state.round}) ═══`)
  for (const r of rankings) {
    const icon = r.totalPnlPct >= 0 ? "📈" : "📉"
    log.info(`  ${icon} ${r.emoji} ${r.name.padEnd(12)} $${r.capital.toFixed(0)} | PnL: ${r.totalPnl >= 0 ? "+" : ""}$${r.totalPnl.toFixed(0)} (${r.totalPnlPct >= 0 ? "+" : ""}${r.totalPnlPct.toFixed(1)}%) | ${r.winCount}/${r.tradeCount}`)
  }

  // Risk status
  const risk = getRiskStatus()
  log.info(`\n  🛡️  风控: ${risk.mode} | 单笔≤$${risk.maxOrderUsd} | 日亏损 $${risk.todayLoss.toFixed(0)} / $${risk.dailyLossLimit} | 剩余 $${risk.remainingBudget.toFixed(0)}`)


}

// ═══════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════

log.info(`AI Trader Engine — ${TRADERS.length} traders, interval ${INTERVAL_MS / 60000}min`)
run()
setInterval(run, INTERVAL_MS)

process.on("SIGINT", () => { log.info("关闭"); process.exit(0) })
process.on("SIGTERM", () => { log.info("关闭"); process.exit(0) })
