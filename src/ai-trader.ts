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

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { AgentLoop } from "./adapters/ai-sdk.js"
import { logger } from "./utils/logger.js"
import { executeOpen, executeClose, syncPositions, getMode, getRiskStatus, type BridgeMode } from "./ai-trader-bridge.js"
import { PaperExchange } from "./adapters/paper-exchange.js"

// ═══════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════

const STATE_FILE = join(process.cwd(), ".hub", "trader-state.json")
const TRADE_LOG = join(process.cwd(), ".hub", "trade-history.jsonl")
const INTERVAL_MS = parseInt(process.env.TRADER_INTERVAL || "3600000", 10)
const log = logger("AI-Trader")
const agent = new AgentLoop()

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

function logTradeHistory(state: any) {
  try {
    if (!existsSync(".hub")) mkdirSync(".hub", { recursive: true })
    const now = new Date().toISOString()
    for (const [id, t] of Object.entries(state.traders as Record<string, any>)) {
      const entry = {
        ts: now,
        traderId: id,
        name: t.name,
        round: state.round,
        capital: t.capital,
        equity: t.equity || t.capital,
        totalPnl: t.totalPnl,
        totalPnlPct: t.totalPnlPct,
        unrealizedPnl: t.unrealizedPnl || 0,
        usedMargin: t.usedMargin || 0,
        tradeCount: t.tradeCount,
        winCount: t.winCount,
        positions: (t.openPositions || []).map((p: any) => ({
          symbol: p.symbol,
          direction: p.direction,
          leverage: p.leverage,
          entry: p.entryPrice,
          mark: p.currentPrice,
          margin: p.margin,
          upnl: p.unrealizedPnl,
          upnlPct: p.unrealizedPnlPct,
        })),
      }
      appendFileSync(TRADE_LOG, JSON.stringify(entry) + "\n", "utf-8")
    }
  } catch {}
}

/**
 * 将交易摘要写入记忆库，供 Dashboard 记忆面板复盘
 */
function saveToMemory(state: any) {
  try {
    const memPath = join(process.cwd(), ".hub", "memory.db")
    if (!existsSync(memPath)) return  // Hub 未启动，跳过

    const db = new DatabaseSync(memPath)
    const now = new Date().toISOString()
    const round = state.round

    for (const [id, t] of Object.entries(state.traders as Record<string, any>)) {
      // Only save if there's activity (positions or PnL changes)
      const hasActivity = t.tradeCount > 0 || (t.openPositions || []).length > 0
      if (!hasActivity) continue

      const posSummary = (t.openPositions || []).map((p: any) =>
        `${p.direction} ${p.symbol} ${p.leverage}x | 入场$${p.entryPrice?.toFixed(1)} | 未实现$${p.unrealizedPnl?.toFixed(1)} (${p.unrealizedPnlPct?.toFixed(1)}%)`
      ).join("\n")

      const text = [
        `## ${t.name} · Round ${round}`,
        ``,
        `| 指标 | 值 |`,
        `|------|-----|`,
        `| 余额 | $${t.capital?.toFixed(0)} |`,
        `| 权益 | $${(t.equity || t.capital)?.toFixed(0)} |`,
        `| 总盈亏 | ${t.totalPnl >= 0 ? "+" : ""}$${t.totalPnl?.toFixed(0)} (${t.totalPnlPct >= 0 ? "+" : ""}${t.totalPnlPct?.toFixed(1)}%) |`,
        `| 未实现 | $${t.unrealizedPnl?.toFixed(1)} |`,
        `| 保证金 | $${t.usedMargin?.toFixed(0)} |`,
        `| 交易数 | ${t.tradeCount} | 胜率 ${t.tradeCount > 0 ? Math.round(t.winCount / t.tradeCount * 100) : 0}% |`,
        ``,
        posSummary || "无持仓",
      ].join("\n")

      const memId = `trade-${id}-r${round}`

      // Upsert: replace if exists
      db.prepare("DELETE FROM memory WHERE id = ?").run(memId)
      db.prepare(`
        INSERT INTO memory (id, type, agentId, text, tags, confidence, readCount, parentId, createdAt, updatedAt)
        VALUES (?, 'strategy', ?, ?, ?, ?, 0, NULL, ?, ?)
      `).run(memId, `ai-trader-${id}`, text, `trade,round-${round},trader-${id}`, t.totalPnlPct != null ? Math.min(1, Math.abs(t.totalPnlPct) / 100) : 0.5, now, now)
    }

    // Clean up old trade memories (keep last 100)
    const oldIds = db.prepare("SELECT id FROM memory WHERE id LIKE 'trade-%' ORDER BY createdAt DESC LIMIT -1 OFFSET 100").all() as Array<{ id: string }>
    for (const row of oldIds) db.prepare("DELETE FROM memory WHERE id = ?").run(row.id)

    db.close()
  } catch { /* memory DB not critical */ }
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

  // Initialize traders & paper exchanges
  if (!state.exchanges) state.exchanges = {}
  for (const t of TRADERS) {
    if (!state.traders[t.id]) {
      state.traders[t.id] = {
        id: t.id, name: t.name, emoji: t.emoji,
        capital: t.initialCapital, totalPnl: 0, totalPnlPct: 0,
        openPositions: [], closedPositions: [],
        tradeCount: 0, winCount: 0,
      }
    }
    // Restore or init paper exchange from saved state
    if (mode === "simulate" && !state.exchanges[t.id]) {
      const saved = state._exchangeData?.[t.id]
      const exch = new PaperExchange(t.initialCapital)
      if (saved) {
        exch.balance = saved.balance
        exch.totalPnl = saved.totalPnl
        exch.totalFees = saved.totalFees
        exch.totalFunding = saved.totalFunding
        exch.tradeCount = saved.tradeCount
        exch.winCount = saved.winCount
      }
      state.exchanges[t.id] = exch
    }
  }

  // Each trader makes AI decisions
  for (const t of TRADERS) {
    const trader = state.traders[t.id]
    const paperEx = state.exchanges?.[t.id] as PaperExchange | undefined

    // Update paper exchange with latest prices
    if (paperEx) {
      for (const s of signals) paperEx.updatePrice(s.symbol, s.price)
      // Sync trader state from paper exchange
      const acc = paperEx.getAccount()
      trader.capital = acc.balance
      trader.totalPnl = acc.totalPnl
      trader.totalPnlPct = acc.totalPnl / t.initialCapital * 100
      trader.tradeCount = acc.tradeCount
      trader.winCount = acc.winCount
      trader.openPositions = paperEx.getPositions().map(p => ({
        symbol: p.symbol, direction: p.direction, leverage: p.leverage,
        entryPrice: p.entryPrice, openedAt: new Date(p.openedAt).toISOString(),
        margin: p.margin, liquidationPrice: p.liquidationPrice,
      }))
    }

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
      const entryPrice = sig?.price || 0
      if (!entryPrice) continue

      const symbol = (pos.symbol || sig?.symbol || "BTC/USDT") as string
      const direction = pos.direction as "LONG" | "SHORT"
      const leverage = Math.min(100, Math.max(1, pos.leverage || 5))
      const capital = Math.floor(trader.capital * 0.5)  // max 50% of current balance

      if (mode === "simulate" && paperEx) {
        // Paper Exchange: full simulation with margin/liquidation/fees
        paperEx.updatePrice(symbol, entryPrice)
        const result = paperEx.openPosition(symbol, direction, capital, leverage)
        if (result.ok) {
          log.info(`  ${t.emoji} 开仓[Paper]: ${direction} ${symbol} ${leverage}x @ $${entryPrice.toFixed(1)} → ${result.orderId}`)
        } else {
          log.warn(`  ${t.emoji} 开仓被拒: ${result.error}`)
        }
      } else {
        // Demo/Live: bridge to OKX
        const order = {
          traderId: t.id, signalId: pos.signalId || sig?.id || "",
          symbol, direction, leverage, entryPrice, capital,
          reasoning: pos.reasoning || "",
        }
        const openResult = await executeOpen(order)
        if (openResult.ok) {
          log.info(`  ${t.emoji} → OKX[${openResult.mode}]: ${openResult.orderId}`)
        } else {
          log.warn(`  ${t.emoji} → OKX 开仓被拒: ${openResult.error}`)
        }
        trader.tradeCount++
      }
    }

    // Process close actions
    const closeActions = (decision.actions || []).filter((a: any) => a.type === "close")
    for (const action of closeActions) {
      const symbol = action.symbol as string
      if (!symbol) continue

      if (mode === "simulate" && paperEx) {
        const result = paperEx.closePosition(symbol)
        if (result.ok) {
          log.info(`  ${t.emoji} 平仓[Paper]: ${symbol} PnL=$${result.realizedPnl?.toFixed(2)}`)
        } else {
          log.warn(`  ${t.emoji} 平仓被拒: ${result.error}`)
        }
      } else {
        const pos = trader.openPositions.find((p: any) => p.symbol === symbol && !p.closed)
        if (pos) {
          const closeResult = await executeClose({ traderId: t.id, symbol: pos.symbol, direction: pos.direction, realizedPnl: 0 })
          if (closeResult.ok) log.info(`  ${t.emoji} → OKX[${closeResult.mode}] 平仓: ${closeResult.orderId}`)
        }
      }
    }
  }

  state.round++
  state.lastUpdate = new Date().toISOString()

  // Serialize exchange data for persistence (PaperExchange objects can't be JSON'd)
  if (state.exchanges) {
    for (const [id, ex] of Object.entries(state.exchanges)) {
      if (ex instanceof PaperExchange) {
        const exch = ex as PaperExchange
        const acc = exch.getAccount()
        state.traders[id].capital = acc.balance
        state.traders[id].totalPnl = acc.totalPnl
        state.traders[id].totalPnlPct = acc.totalPnl / exch.initialBalance * 100
        state.traders[id].tradeCount = acc.tradeCount
        state.traders[id].winCount = acc.winCount
        state.traders[id].equity = acc.equity
        state.traders[id].usedMargin = acc.usedMargin
        state.traders[id].unrealizedPnl = acc.unrealizedPnl
        state.traders[id].totalFees = acc.totalFees
        state.traders[id].totalFunding = acc.totalFunding

        // Full position details for dashboard
        state.traders[id].openPositions = exch.getPositions().map(p => {
          const price = exch.getPrice(p.symbol)
          const dirMult = p.direction === "LONG" ? 1 : -1
          const unrealizedPnlPct = price > 0 ? (price - p.entryPrice) / p.entryPrice * dirMult * 100 * p.leverage : 0
          const unrealizedPnl = price > 0 ? p.margin * unrealizedPnlPct / 100 : 0
          return {
            symbol: p.symbol,
            direction: p.direction,
            leverage: p.leverage,
            entryPrice: p.entryPrice,
            currentPrice: price || undefined,
            margin: p.margin,
            liquidationPrice: p.liquidationPrice,
            unrealizedPnl,
            unrealizedPnlPct,
            fundingPaid: p.fundingPaid,
            fees: p.fees,
            openedAt: new Date(p.openedAt).toISOString(),
          }
        })

        // Save minimal exchange state for restore
        state._exchangeData = state._exchangeData || {}
        state._exchangeData[id] = {
          balance: acc.balance, totalPnl: acc.totalPnl,
          totalFees: acc.totalFees, totalFunding: acc.totalFunding,
          tradeCount: acc.tradeCount, winCount: acc.winCount,
        }
      }
    }
    delete state.exchanges
  }

  // Log trade history for optimization
  logTradeHistory(state)

  // Save trade summaries to memory DB for dashboard review
  saveToMemory(state)

  saveState(state)

  // Leaderboard
  const rankings = Object.values(state.traders as Record<string, any>)
    .sort((a: any, b: any) => b.totalPnlPct - a.totalPnlPct)
  log.info(`\n  ═══ AI Trader Leaderboard (Round ${state.round}) ═══`)
  for (const r of rankings) {
    const icon = r.totalPnlPct >= 0 ? "📈" : "📉"
    const extra = r.openPositions?.length ? ` 持仓${r.openPositions.length}` : ""
    log.info(`  ${icon} ${r.emoji} ${r.name.padEnd(12)} $${r.capital.toFixed(0)} | PnL: ${r.totalPnl >= 0 ? "+" : ""}$${r.totalPnl.toFixed(0)} (${r.totalPnlPct >= 0 ? "+" : ""}${r.totalPnlPct.toFixed(1)}%) | ${r.winCount}/${r.tradeCount}${extra}`)
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
