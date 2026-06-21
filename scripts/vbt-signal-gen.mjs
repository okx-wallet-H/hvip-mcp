/**
 * VBT Signal Generator v2 — 多指标共振 + 多样评级
 * Usage: node scripts/vbt-signal-gen.mjs [SYMBOL] [TIMEFRAME]
 *
 * 指标: SuperTrend(7,3) + RSI(14) + MACD(12,26,9) + BB(20,2) + EMA(9/21)
 * 评级: S(4+确认0警告) > A(3+确认) > B(2+确认) > C(1确认)
 */

const SYMBOL = process.argv[2] || "BTC/USDT"
const TIMEFRAME = process.argv[3] || "4h"
const BAR_MAP = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1D" }
const bar = BAR_MAP[TIMEFRAME] || "4H"
const limit = TIMEFRAME === "1d" ? 120 : TIMEFRAME === "4h" ? 200 : 250

async function main() {
  try {
    // 1. Fetch candles from OKX
    const url = `https://www.okx.com/api/v5/market/candles?instId=${SYMBOL.replace("/", "-")}&bar=${bar}&limit=${limit}`
    const res = await fetch(url)
    const json = await res.json()
    if (!json.data || json.data.length < 80) {
      emitNeutral("API 数据不足 (需要至少 80 根K线)")
      return
    }

    const candles = json.data.map(c => ({
      ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), vol: parseFloat(c[5])
    })).reverse()

    const closes = candles.map(c => c.close)
    const highs = candles.map(c => c.high)
    const lows = candles.map(c => c.low)
    const currentPrice = closes[closes.length - 1]

    // 2. Calculate all indicators
    const rsi = calcRSI(closes, 14)
    const atr = calcATR(highs, lows, closes, 7)
    const st = calcSuperTrend(highs, lows, closes, atr, 7, 3)
    const macd = calcMACD(closes, 12, 26, 9)
    const bb = calcBollinger(closes, 20, 2)
    const emaShort = calcEMA(closes, 9)
    const emaLong = calcEMA(closes, 21)

    // 3. Multi-indicator signal
    const currentRSI = rsi[rsi.length - 1]
    const stDir = st[st.length - 1].direction
    const prevStDir = st[st.length - 2].direction
    const stFlip = stDir !== prevStDir

    // MACD
    const macdCurr = macd.macd[macd.macd.length - 1]
    const macdSig = macd.signal[macd.signal.length - 1]
    const macdHist = macdCurr - macdSig
    const prevMacdHist = macd.macd[macd.macd.length - 2] - macd.signal[macd.signal.length - 2]
    const macdBullish = macdHist > 0
    const macdCrossUp = prevMacdHist <= 0 && macdHist > 0
    const macdCrossDown = prevMacdHist >= 0 && macdHist < 0

    // Bollinger
    const bbCurr = bb[bb.length - 1]
    const bbWidth = (bbCurr.upper - bbCurr.lower) / bbCurr.mid
    const priceInBb = currentPrice > 0 ? (currentPrice - bbCurr.lower) / (bbCurr.upper - bbCurr.lower) : 0.5

    // EMA cross
    const emaS = emaShort[emaShort.length - 1], emaL = emaLong[emaLong.length - 1]
    const prevEmaS = emaShort[emaShort.length - 2], prevEmaL = emaLong[emaLong.length - 2]
    const emaGoldCross = prevEmaS <= prevEmaL && emaS > emaL
    const emaDeadCross = prevEmaS >= prevEmaL && emaS < emaL

    // Volume trend
    const recentVol = candles.slice(-10).reduce((s, c) => s + c.vol, 0) / 10
    const olderVol = candles.slice(-30, -10).reduce((s, c) => s + c.vol, 0) / 20
    const volIncreasing = recentVol > olderVol * 1.2

    // ═══ Signal Logic ═══
    let signal = "NEUTRAL", confidence = 50, confirmations = 0, warnings = 0
    const reasons = []

    if (stDir === 1) {
      signal = "LONG", confidence = 65, confirmations = 1
      reasons.push("ST看多")
      if (currentRSI > 50 && currentRSI < 70) { confidence += 8; confirmations++; reasons.push("RSI健康多头") }
      if (currentRSI > 70) { confidence -= 5; warnings++; reasons.push("RSI超买") }
      if (currentRSI < 50) { confidence -= 3; warnings++; reasons.push("RSI弱") }
      if (macdBullish) { confidence += 10; confirmations++; reasons.push("MACD多头") }
      if (macdCrossUp) { confidence += 5; reasons.push("MACD金叉") }
      if (priceInBb < 0.3) { confidence += 6; confirmations++; reasons.push("布林下轨支撑") }
      if (priceInBb > 0.8) { confidence -= 4; warnings++; reasons.push("布林上轨压力") }
      if (emaGoldCross) { confidence += 8; confirmations++; reasons.push("EMA金叉") }
      if (emaS > emaL) { confidence += 4; confirmations++; reasons.push("EMA多头排列") }
      if (stFlip && prevStDir === -1) { confidence += 5; reasons.push("ST翻多") }
      if (volIncreasing) { confidence += 3; reasons.push("放量") }
    } else if (stDir === -1) {
      signal = "SHORT", confidence = 65, confirmations = 1
      reasons.push("ST看空")
      if (currentRSI < 50 && currentRSI > 30) { confidence += 8; confirmations++; reasons.push("RSI健康空头") }
      if (currentRSI < 30) { confidence -= 5; warnings++; reasons.push("RSI超卖") }
      if (currentRSI > 50) { confidence -= 3; warnings++; reasons.push("RSI强") }
      if (!macdBullish) { confidence += 10; confirmations++; reasons.push("MACD空头") }
      if (macdCrossDown) { confidence += 5; reasons.push("MACD死叉") }
      if (priceInBb > 0.7) { confidence += 6; confirmations++; reasons.push("布林上轨压力") }
      if (priceInBb < 0.2) { confidence -= 4; warnings++; reasons.push("布林下轨支撑") }
      if (emaDeadCross) { confidence += 8; confirmations++; reasons.push("EMA死叉") }
      if (emaS < emaL) { confidence += 4; confirmations++; reasons.push("EMA空头排列") }
      if (stFlip && prevStDir === 1) { confidence += 5; reasons.push("ST翻空") }
      if (volIncreasing) { confidence += 3; reasons.push("放量") }
    }

    confidence = Math.min(95, Math.max(10, confidence))

    // Grade
    let grade = "C"
    if (confirmations >= 4 && warnings === 0) grade = "S"
    else if (confirmations >= 3 && warnings <= 1) grade = "A"
    else if (confirmations >= 2 && warnings <= 2) grade = "B"

    // Backtest stats
    const bt = simpleBacktest(closes, st, 20)
    const sharpe = bt.sharpe.toFixed(2)
    const mdd = bt.maxDD.toFixed(1)
    const winRate = bt.winRate.toFixed(1)
    const totalTrades = bt.trades || 0

    // Last 5 signals
    const last5 = []
    for (let i = Math.max(0, st.length - 5); i < st.length; i++) {
      last5.push(st[i]?.direction === 1 ? "LONG" : st[i]?.direction === -1 ? "SHORT" : "NEUTRAL")
    }

    const indicatorName = `SuperTrend(7,3)+RSI(14)+MACD(12,26,9)+BB(20,2)+EMA(9/21) ${TIMEFRAME}`
    const conclusion = `${signal === "LONG" ? "做多" : signal === "SHORT" ? "做空" : "观望"} | ${SYMBOL} ${TIMEFRAME} | 确认${confirmations} 警告${warnings} | RSI${currentRSI.toFixed(1)} MACD${macdBullish?'+':'-'} BB${(priceInBb*100).toFixed(0)}% | 评级${grade} | ${reasons.join("; ")}`

    console.log("CURRENT_SIGNAL: " + signal)
    console.log("CURRENT_PRICE: " + currentPrice.toFixed(1))
    console.log("SYMBOL: " + SYMBOL)
    console.log("INDICATOR: " + indicatorName)
    console.log("SHARPE: " + sharpe)
    console.log("MAX_DD: " + mdd)
    console.log("WIN_RATE: " + winRate)
    console.log("TOTAL_TRADES: " + totalTrades)
    console.log("CONFIDENCE: " + confidence)
    console.log("GRADE: " + grade)
    console.log("CONCLUSION: " + conclusion)
    console.log("LAST_5_SIGNALS: [" + last5.join(", ") + "]")

  } catch (e) {
    emitNeutral("计算异常: " + e.message)
  }
}

function emitNeutral(reason) {
  console.log("CURRENT_SIGNAL: NEUTRAL"); console.log("SYMBOL: " + SYMBOL)
  console.log("INDICATOR: SuperTrend(7,3)+RSI(14)+MACD+BB+EMA " + TIMEFRAME)
  console.log("CURRENT_PRICE: --"); console.log("SHARPE: 0"); console.log("MAX_DD: 0")
  console.log("WIN_RATE: 0"); console.log("TOTAL_TRADES: 0"); console.log("CONFIDENCE: 0")
  console.log("GRADE: C"); console.log("CONCLUSION: " + reason); console.log("LAST_5_SIGNALS: []")
}

// ═══════════ Indicators ═══════════

function calcRSI(closes, period) {
  const rsi = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { rsi.push(50); continue }
    let gain = 0, loss = 0
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1]
      if (diff > 0) gain += diff; else loss -= diff
    }
    const avgGain = gain / period, avgLoss = loss / period
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return rsi
}

function calcATR(highs, lows, closes, period) {
  const tr = [0]
  for (let i = 1; i < closes.length; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])))
  const atr = new Array(closes.length).fill(0)
  let sum = tr.slice(1, period + 1).reduce((a, b) => a + b, 0)
  atr[period] = sum / period
  for (let i = period + 1; i < closes.length; i++) atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period
  return atr
}

function calcSuperTrend(highs, lows, closes, atr, period, multiplier) {
  const st = new Array(closes.length).fill(null)
  for (let i = period; i < closes.length; i++) {
    const hl2 = (highs[i] + lows[i]) / 2, ub = hl2 + multiplier * atr[i], lb = hl2 - multiplier * atr[i]
    let dir = 1
    if (i > period && st[i-1]) {
      const prev = st[i-1]
      if (closes[i] > prev.upperBand) dir = 1
      else if (closes[i] < prev.lowerBand) dir = -1
      else dir = prev.direction
    }
    st[i] = { upperBand: ub, lowerBand: lb, direction: dir, value: dir === 1 ? lb : ub }
  }
  return st
}

function calcEMA(closes, period) {
  const ema = [], k = 2 / (period + 1)
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { ema.push(closes[i]); continue }
    if (i === period) { let sum = 0; for (let j = 0; j < period; j++) sum += closes[j]; ema.push(sum / period) }
    else ema.push(closes[i] * k + ema[i-1] * (1 - k))
  }
  return ema
}

function calcMACD(closes, fast, slow, sigPeriod) {
  const emaFast = calcEMA(closes, fast), emaSlow = calcEMA(closes, slow)
  const macd = [], signal = []
  for (let i = 0; i < closes.length; i++) {
    macd.push(emaFast[i] - emaSlow[i])
    if (i < sigPeriod) signal.push(macd[i])
    else signal.push(macd[i] * (2 / (sigPeriod + 1)) + signal[i-1] * (1 - 2 / (sigPeriod + 1)))
  }
  return { macd, signal }
}

function calcBollinger(closes, period, stdDev) {
  const bb = []
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1)
    const avg = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period
    const std = Math.sqrt(variance)
    bb.push({ mid: avg, upper: avg + stdDev * std, lower: avg - stdDev * std })
  }
  return bb
}

function simpleBacktest(closes, st, warmup) {
  let wins = 0, trades = 0, pos = 0, entry = 0
  const returns = []; let peak = 1, maxDD = 0
  for (let i = warmup + 1; i < closes.length; i++) {
    const dir = st[i]?.direction || 0, prevDir = st[i-1]?.direction || 0
    if (prevDir !== 1 && dir === 1 && pos <= 0) {
      if (pos < 0) { trades++; if (entry > closes[i]) wins++; returns.push((entry - closes[i]) / entry) }
      pos = 1; entry = closes[i]
    } else if (prevDir !== -1 && dir === -1 && pos >= 0) {
      if (pos > 0) { trades++; if (closes[i] > entry) wins++; returns.push((closes[i] - entry) / entry) }
      pos = -1; entry = closes[i]
    }
  }
  if (pos !== 0) {
    trades++
    const last = closes[closes.length - 1]
    if (pos > 0) { if (last > entry) wins++; returns.push((last - entry) / entry) }
    else { if (entry > last) wins++; returns.push((entry - last) / entry) }
  }
  let cumRet = 1
  for (const r of returns) { cumRet *= 1 + r; if (cumRet > peak) peak = cumRet; const dd = (peak - cumRet) / peak; if (dd > maxDD) maxDD = dd }
  const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / (returns.length - 1)) : 0.01
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252 * 6) : 0
  return { sharpe: Math.max(-3, Math.min(5, sharpe)), maxDD: Math.round(maxDD * 1000) / 10, winRate: trades > 0 ? Math.round(wins / trades * 1000) / 10 : 0, trades }
}

main()
