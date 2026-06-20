/**
 * Paper Exchange — 本地模拟盘引擎
 * =====================================
 *
 * 完全本地运行的合约交易所模拟器，模拟 OKX 永续合约行为：
 *   - 虚拟 USDT 账户
 *   - 市价单即时成交（使用 OKX 真实行情价）
 *   - 全仓/逐仓保证金
 *   - 维持保证金率 + 强平
 *   - Taker/Maker 手续费
 *   - 资金费率 (0.01%/8h)
 *   - 未实现/已实现盈亏追踪
 *
 * 用法:
 *   const exchange = new PaperExchange(10000)  // 10000 USDT 初始本金
 *   exchange.updatePrice("BTC/USDT", 65000)
 *   const result = exchange.openPosition("BTC/USDT", "LONG", 5000, 10)
 *   exchange.closePosition("BTC/USDT")
 *
 * API 风格对齐 OKX:
 *   openPosition  → 返回 orderId
 *   closePosition → 返回成交详情
 *   getPositions  → 当前持仓列表
 *   getAccount    → 账户概览
 */

import { logger } from "../utils/logger.js"

const log = logger("PaperExchange")

// ═══════════════════════════════════════════════════════════════
// Constants (mirrors OKX swap)
// ═══════════════════════════════════════════════════════════════

const TAKER_FEE = 0.0005          // 0.05%
const MAKER_FEE = 0.0002          // 0.02% (limit orders, unused for now)
const FUNDING_RATE = 0.0001       // 0.01% per 8h
const FUNDING_INTERVAL_MS = 8 * 3600_000
const MAINTENANCE_MARGIN_RATIO = 0.005  // 0.5% for BTC/ETH (varies by symbol)

// Per-symbol contract specs
const CONTRACT_SPECS: Record<string, { ctVal: number; minSz: number; tickSz: number; mmr: number }> = {
  "BTC/USDT": { ctVal: 0.01, minSz: 1, tickSz: 0.1, mmr: 0.005 },
  "ETH/USDT": { ctVal: 0.1,  minSz: 1, tickSz: 0.01, mmr: 0.01 },
  "SOL/USDT": { ctVal: 10,   minSz: 1, tickSz: 0.001, mmr: 0.015 },
  default:    { ctVal: 1,    minSz: 1, tickSz: 0.01, mmr: 0.01 },
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface PaperPosition {
  symbol: string
  direction: "LONG" | "SHORT"
  quantity: number       // contracts
  entryPrice: number
  leverage: number
  margin: number         // USDT locked
  liquidationPrice: number
  openedAt: number       // timestamp ms
  tpPrice?: number
  slPrice?: number
  fundingPaid: number    // total funding paid so far
  fees: number           // total fees paid
}

export interface PaperAccount {
  balance: number        // free USDT
  equity: number         // balance + unrealizedPnl
  usedMargin: number     // total margin across positions
  freeMargin: number     // equity - usedMargin
  totalPnl: number       // realized PnL
  unrealizedPnl: number
  totalFees: number
  totalFunding: number
  tradeCount: number
  winCount: number
}

export interface PaperOrderResult {
  ok: boolean
  orderId?: string
  error?: string
  fillPrice?: number
  fee?: number
}

export interface PaperCloseResult extends PaperOrderResult {
  realizedPnl?: number
  realizedPnlPct?: number
  fundingPaid?: number
  totalFees?: number
}

// ═══════════════════════════════════════════════════════════════
// Engine
// ═══════════════════════════════════════════════════════════════

export class PaperExchange {
  balance: number
  private positions = new Map<string, PaperPosition>()  // keyed by symbol
  totalPnl = 0
  totalFees = 0
  totalFunding = 0
  tradeCount = 0
  winCount = 0
  private prices = new Map<string, number>()
  private lastFundingTime = Date.now()
  private orderSeq = 0
  readonly initialBalance: number

  constructor(initialBalance = 10000) {
    this.balance = initialBalance
    this.initialBalance = initialBalance
  }

  // ── Price Feed ───────────────────────────────────────────────

  /** 更新标的市价（从 OKX ticker 获取） */
  updatePrice(symbol: string, price: number) {
    this.prices.set(symbol, price)
    // 自动检查强平
    this.checkLiquidations()
    // 每8h自动结算资金费率
    this.settleFunding()
  }

  getPrice(symbol: string): number {
    return this.prices.get(symbol) || 0
  }

  // ── Open Position ────────────────────────────────────────────

  /**
   * 开仓（市价单）
   * @param symbol   BTC/USDT, ETH/USDT, SOL/USDT
   * @param direction LONG | SHORT
   * @param usdAmount 投入本金 (USDT)
   * @param leverage  杠杆倍数 (1-100)
   */
  openPosition(symbol: string, direction: "LONG" | "SHORT", usdAmount: number, leverage: number): PaperOrderResult {
    // Already have a position on this symbol?
    if (this.positions.has(symbol)) {
      return { ok: false, error: `${symbol} 已有持仓，请先平仓` }
    }

    const price = this.getPrice(symbol)
    if (!price || price <= 0) {
      return { ok: false, error: `${symbol} 无行情数据` }
    }

    // Validate
    if (usdAmount > this.balance) {
      return { ok: false, error: `余额不足 (需要 $${usdAmount.toFixed(0)}，可用 $${this.balance.toFixed(0)})` }
    }
    if (leverage < 1 || leverage > 100) {
      return { ok: false, error: `杠杆 ${leverage}x 无效 (1-100)` }
    }

    const spec = CONTRACT_SPECS[symbol] || CONTRACT_SPECS.default
    const posValue = usdAmount * leverage
    const fee = posValue * TAKER_FEE

    // Check if we can afford the fee too
    if (usdAmount + fee > this.balance + 0.01) {
      return { ok: false, error: `余额不足以支付手续费 (需 $${(usdAmount + fee).toFixed(0)})` }
    }

    // Calculate contracts
    const ctVal = spec.ctVal  // USD per contract
    const contracts = Math.max(spec.minSz, Math.floor(posValue / (price * ctVal)))

    // Actual fill price (slip by 0.02%)
    const fillPrice = direction === "LONG" ? price * 1.0002 : price * 0.9998

    // Margin = position value / leverage = usdAmount
    const margin = usdAmount

    // Liquidation price
    const mmr = spec.mmr
    const liqPrice = direction === "LONG"
      ? fillPrice * (1 - (1 / leverage) + mmr)
      : fillPrice * (1 + (1 / leverage) - mmr)

    // Deduct from balance
    this.balance -= (usdAmount + fee)

    const pos: PaperPosition = {
      symbol,
      direction,
      quantity: contracts,
      entryPrice: fillPrice,
      leverage,
      margin,
      liquidationPrice: liqPrice,
      openedAt: Date.now(),
      fundingPaid: 0,
      fees: fee,
    }

    this.positions.set(symbol, pos)
    this.totalFees += fee
    this.tradeCount++
    this.orderSeq++

    log.info(`[Paper] 开仓: ${direction} ${symbol} ${leverage}x $${usdAmount} @ $${fillPrice.toFixed(1)} 手续费$${fee.toFixed(2)} 强平$${liqPrice.toFixed(1)}`)

    return { ok: true, orderId: `paper-${this.orderSeq}`, fillPrice, fee }
  }

  // ── Close Position ───────────────────────────────────────────

  closePosition(symbol: string): PaperCloseResult {
    const pos = this.positions.get(symbol)
    if (!pos) {
      return { ok: false, error: `${symbol} 无持仓` }
    }

    const price = this.getPrice(symbol)
    if (!price) {
      return { ok: false, error: `${symbol} 无行情数据` }
    }

    const spec = CONTRACT_SPECS[symbol] || CONTRACT_SPECS.default
    const posValue = pos.margin * pos.leverage
    const exitFee = posValue * TAKER_FEE
    const exitSlip = pos.direction === "LONG" ? price * 0.9998 : price * 1.0002

    // Funding since last settlement
    const heldMs = Date.now() - pos.openedAt
    const fundingPeriods = Math.floor(heldMs / FUNDING_INTERVAL_MS)
    const fundingCost = posValue * FUNDING_RATE * fundingPeriods

    // PnL
    const dirMult = pos.direction === "LONG" ? 1 : -1
    const pnlPct = (exitSlip - pos.entryPrice) / pos.entryPrice * dirMult * 100 * pos.leverage
    const grossPnl = pos.margin * pnlPct / 100
    const realizedPnl = grossPnl - exitFee - fundingCost

    const totalFees = pos.fees + exitFee
    const totalCost = totalFees + fundingCost

    // Update account
    this.balance += pos.margin + realizedPnl  // return margin + pnl
    this.totalPnl += realizedPnl
    this.totalFees += exitFee
    this.totalFunding += fundingCost
    if (realizedPnl > 0) this.winCount++

    this.positions.delete(symbol)
    this.orderSeq++

    log.info(`[Paper] 平仓: ${pos.direction} ${symbol} PnL=$${realizedPnl.toFixed(2)} (${pnlPct.toFixed(1)}%) 费用$${totalCost.toFixed(2)} 持仓${Math.floor(heldMs/3600000)}h`)

    return {
      ok: true, orderId: `paper-${this.orderSeq}`, fillPrice: exitSlip,
      realizedPnl, realizedPnlPct: pnlPct, fee: exitFee,
      fundingPaid: fundingCost, totalFees,
    }
  }

  // ── Account ──────────────────────────────────────────────────

  getAccount(): PaperAccount {
    let usedMargin = 0
    let unrealizedPnl = 0
    for (const pos of this.positions.values()) {
      usedMargin += pos.margin
      const price = this.getPrice(pos.symbol)
      if (price) {
        const dirMult = pos.direction === "LONG" ? 1 : -1
        const pnlPct = (price - pos.entryPrice) / pos.entryPrice * dirMult * 100 * pos.leverage
        unrealizedPnl += pos.margin * pnlPct / 100
      }
    }
    const equity = this.balance + usedMargin + unrealizedPnl
    const truePnl = equity - this.initialBalance  // 含手续费+资金费的真实累计盈亏
    return {
      balance: this.balance,
      equity,
      usedMargin,
      freeMargin: equity - usedMargin,
      totalPnl: truePnl,
      unrealizedPnl,
      totalFees: this.totalFees,
      totalFunding: this.totalFunding,
      tradeCount: this.tradeCount,
      winCount: this.winCount,
    }
  }

  getPositions(): PaperPosition[] {
    return [...this.positions.values()]
  }

  getPosition(symbol: string): PaperPosition | undefined {
    return this.positions.get(symbol)
  }

  // ── Internal ─────────────────────────────────────────────────

  private checkLiquidations() {
    for (const [symbol, pos] of this.positions) {
      const price = this.getPrice(symbol)
      if (!price) continue

      const liq = pos.direction === "LONG"
        ? price <= pos.liquidationPrice
        : price >= pos.liquidationPrice

      if (liq) {
        log.warn(`[Paper] ⚡ 强平! ${pos.direction} ${symbol} 当前$${price.toFixed(1)} 强平价$${pos.liquidationPrice.toFixed(1)}`)
        // Liquidation: lose entire margin
        this.balance += 0  // margin is lost
        this.totalPnl -= pos.margin
        this.positions.delete(symbol)
        this.tradeCount++
      }
    }
  }

  private settleFunding() {
    const now = Date.now()
    const periods = Math.floor((now - this.lastFundingTime) / FUNDING_INTERVAL_MS)
    if (periods <= 0) return
    this.lastFundingTime = now

    for (const [, pos] of this.positions) {
      const posValue = pos.margin * pos.leverage
      const cost = posValue * FUNDING_RATE * periods
      pos.fundingPaid += cost
      this.totalFunding += cost
      // Funding reduces unrealized PnL but doesn't affect balance until close
    }
  }

  // ── Summary ──────────────────────────────────────────────────

  summary(): string {
    const acc = this.getAccount()
    const posList = this.getPositions().map(p => `${p.direction} ${p.symbol} ${p.leverage}x @ $${p.entryPrice.toFixed(1)}`)
    return `Equity $${acc.equity.toFixed(0)} | PnL $${acc.totalPnl.toFixed(0)} | 持仓 ${posList.length} | 胜率 ${acc.tradeCount>0?Math.round(acc.winCount/acc.tradeCount*100):0}%`
  }
}
