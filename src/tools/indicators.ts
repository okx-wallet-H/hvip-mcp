import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { toResult, toError } from "./shared.js"

// ════════════════════════════════════════════════════════════════════════════
// 技术指标本地计算引擎
//
// 基于 okx_get_candles 返回的 OHLCV 数据本地计算，不依赖任何外部 API。
// 每项指标返回原始值 + 中文信号解读，Agent 可直接转述给用户。
// ════════════════════════════════════════════════════════════════════════════

// ── 数据结构 ───────────────────────────────────────────────────────────────

interface Candle {
  ts: number; o: number; h: number; l: number; c: number; vol: number
}

interface IndicatorResult {
  indicator: string
  params: string
  values: number[]          // 最新值在前
  signal: "bullish" | "bearish" | "neutral"
  message: string           // 中文解读
}

// ── 蜡烛数据获取 ───────────────────────────────────────────────────────────

async function fetchCandles(instId: string, bar: string, minBars: number): Promise<Candle[]> {
  const limit = Math.min(300, Math.max(minBars + 50, 100))
  const raw = await publicApi.getCandles(instId, bar, limit) as any[]
  if (!raw || raw.length === 0) return []

  return raw.map((r: any) => ({
    ts: parseInt(r[0]),
    o: parseFloat(r[1]),
    h: parseFloat(r[2]),
    l: parseFloat(r[3]),
    c: parseFloat(r[4]),
    vol: parseFloat(r[5]),
  })).reverse() // OKX 返回时间倒序 → 正序
}

// ── 指标计算 ───────────────────────────────────────────────────────────────

function calcSMA(data: number[], period: number): number[] {
  const result: number[] = []
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) sum += data[i - j]
    result.push(sum / period)
  }
  return result
}

function calcEMA(data: number[], period: number): number[] {
  const result: number[] = []
  const k = 2 / (period + 1)
  let ema = data[0]
  result.push(ema)
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result.slice(period - 1)
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = []
  const gains: number[] = [], losses: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? -diff : 0)
  }
  for (let i = period; i < gains.length; i++) {
    const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period
    const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return rsi
}

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const offset = emaFast.length - emaSlow.length
  const macd: number[] = []
  for (let i = 0; i < emaSlow.length; i++) macd.push(emaFast[i + offset] - emaSlow[i])
  const sigLine = calcEMA(macd, signal)
  const histOffset = macd.length - sigLine.length
  const histogram: number[] = []
  for (let i = 0; i < sigLine.length; i++) histogram.push(macd[i + histOffset] - sigLine[i])
  return { macd: macd.slice(-sigLine.length), signal: sigLine, histogram }
}

function calcBollinger(closes: number[], period = 20, mult = 2): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[]; pctB: number[] } {
  const sma = calcSMA(closes, period)
  const upper: number[] = [], lower: number[] = [], bandwidth: number[] = [], pctB: number[] = []
  for (let i = 0; i < sma.length; i++) {
    const idx = i + period - 1
    let sumSq = 0
    for (let j = 0; j < period; j++) sumSq += (closes[idx - j] - sma[i]) ** 2
    const std = Math.sqrt(sumSq / period)
    const up = sma[i] + mult * std
    const lo = sma[i] - mult * std
    upper.push(up)
    lower.push(lo)
    bandwidth.push(((up - lo) / sma[i]) * 100)
    pctB.push((closes[idx] - lo) / (up - lo))
  }
  return { upper, middle: sma, lower, bandwidth, pctB }
}

function calcATR(candles: Candle[], period = 14): number[] {
  const tr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h, l = candles[i].l, pc = candles[i - 1].c
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }
  return calcSMA(tr, period) // Wilder's ATR uses EMA, SMA is close enough
}

function calcStoch(candles: Candle[], kPeriod = 14, dPeriod = 3): { k: number[]; d: number[] } {
  const k: number[] = []
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highest = -Infinity, lowest = Infinity
    for (let j = 0; j < kPeriod; j++) {
      highest = Math.max(highest, candles[i - j].h)
      lowest = Math.min(lowest, candles[i - j].l)
    }
    k.push(((candles[i].c - lowest) / (highest - lowest)) * 100)
  }
  const d = calcSMA(k, dPeriod)
  return { k: k.slice(dPeriod - 1), d }
}

function calcMFI(candles: Candle[], period = 14): number[] {
  const mfi: number[] = []
  for (let i = period; i < candles.length; i++) {
    let posFlow = 0, negFlow = 0
    for (let j = 0; j < period; j++) {
      const idx = i - j
      const tp = (candles[idx].h + candles[idx].l + candles[idx].c) / 3
      const prevTp = (candles[idx - 1].h + candles[idx - 1].l + candles[idx - 1].c) / 3
      const rmf = tp * candles[idx].vol
      if (tp > prevTp) posFlow += rmf
      else negFlow += rmf
    }
    mfi.push(negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow))
  }
  return mfi
}

function calcWR(candles: Candle[], period = 14): number[] {
  const wr: number[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let highest = -Infinity, lowest = Infinity
    for (let j = 0; j < period; j++) {
      highest = Math.max(highest, candles[i - j].h)
      lowest = Math.min(lowest, candles[i - j].l)
    }
    wr.push(((highest - candles[i].c) / (highest - lowest)) * -100)
  }
  return wr
}

function calcCCI(candles: Candle[], period = 20): number[] {
  const tp = candles.map(c => (c.h + c.l + c.c) / 3)
  const sma = calcSMA(tp, period)
  const cci: number[] = []
  for (let i = 0; i < sma.length; i++) {
    const idx = i + period - 1
    let sumDev = 0
    for (let j = 0; j < period; j++) sumDev += Math.abs(tp[idx - j] - sma[i])
    const mad = sumDev / period
    cci.push(mad === 0 ? 0 : (tp[idx] - sma[i]) / (0.015 * mad))
  }
  return cci
}

function calcOBV(candles: Candle[]): number[] {
  const obv: number[] = [candles[0].vol]
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].c > candles[i - 1].c) obv.push(obv[i - 1] + candles[i].vol)
    else if (candles[i].c < candles[i - 1].c) obv.push(obv[i - 1] - candles[i].vol)
    else obv.push(obv[i - 1])
  }
  return obv
}

function calcVWAP(candles: Candle[]): number[] {
  const vwap: number[] = []
  let cumPV = 0, cumV = 0
  for (const c of candles) {
    const tp = (c.h + c.l + c.c) / 3
    cumPV += tp * c.vol
    cumV += c.vol
    vwap.push(cumV === 0 ? c.c : cumPV / cumV)
  }
  return vwap
}

function calcADX(candles: Candle[], period = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const tr: number[] = [], plusDM: number[] = [], minusDM: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].h - candles[i - 1].h
    const down = candles[i - 1].l - candles[i].l
    tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)))
    plusDM.push(up > down && up > 0 ? up : 0)
    minusDM.push(down > up && down > 0 ? down : 0)
  }
  const atrSm = calcEMASmooth(tr, period)
  const plusDISM = calcEMASmooth(plusDM, period)
  const minusDISM = calcEMASmooth(minusDM, period)
  const adx: number[] = [], pDI: number[] = [], mDI: number[] = []
  for (let i = 0; i < atrSm.length; i++) {
    pDI.push(atrSm[i] === 0 ? 0 : (plusDISM[i] / atrSm[i]) * 100)
    mDI.push(atrSm[i] === 0 ? 0 : (minusDISM[i] / atrSm[i]) * 100)
  }
  const dx: number[] = []
  for (let i = 0; i < pDI.length; i++) {
    const sum = pDI[i] + mDI[i]
    dx.push(sum === 0 ? 0 : (Math.abs(pDI[i] - mDI[i]) / sum) * 100)
  }
  const adxRaw = calcEMASmooth(dx, period)
  // 对齐
  const offset2 = pDI.length - adxRaw.length
  for (let i = 0; i < adxRaw.length; i++) {
    adx.push(adxRaw[i])
  }
  return { adx, plusDI: pDI.slice(offset2), minusDI: mDI.slice(offset2) }
}

function calcEMASmooth(data: number[], period: number): number[] {
  if (data.length === 0) return []
  const result: number[] = [data[0]]
  const k = 2 / (period + 1)
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k))
  return result.slice(period - 1)
}

function calcSupertrend(candles: Candle[], period = 10, mult = 3): { trend: number[]; direction: number[] } {
  const atr = calcATR(candles, period)
  const upper: number[] = [], lower: number[] = [], trend: number[] = []
  const direction: number[] = []
  for (let i = 0; i < atr.length; i++) {
    const idx = i + period - 1
    const mid = (candles[idx].h + candles[idx].l) / 2
    const up = mid - mult * atr[i]
    const lo = mid + mult * atr[i] // reversed: lower band uses + ATR for supertrend
    if (i === 0) {
      upper.push(up)
      lower.push(lo)
      direction.push(candles[idx].c > lo ? 1 : -1)
      trend.push(candles[idx].c > lo ? lo : up)
    } else {
      const prevLo = lower[i - 1], prevUp = upper[i - 1]
      const newUp = mid - mult * atr[i]
      const newLo = mid + mult * atr[i]
      upper.push(candles[idx - 1].c > prevLo ? Math.max(newUp, upper[i - 1]) : newUp)
      lower.push(candles[idx - 1].c < prevUp ? Math.min(newLo, lower[i - 1]) : newLo)
      if (direction[i - 1] === 1) {
        direction.push(candles[idx].c > lower[i] ? 1 : -1)
      } else {
        direction.push(candles[idx].c < upper[i] ? -1 : 1)
      }
      trend.push(direction[i] === 1 ? lower[i] : upper[i])
    }
  }
  return { trend, direction }
}

function calcCMF(candles: Candle[], period = 20): number[] {
  const cmf: number[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let mfVol = 0, totalVol = 0
    for (let j = 0; j < period; j++) {
      const c = candles[i - j]
      const mf = ((c.c - c.l) - (c.h - c.c)) / (c.h - c.l || 1)
      mfVol += mf * c.vol
      totalVol += c.vol
    }
    cmf.push(totalVol === 0 ? 0 : mfVol / totalVol)
  }
  return cmf
}

function calcKeltner(candles: Candle[], period = 20, mult = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const tp = candles.map(c => (c.h + c.l + c.c) / 3)
  const middle = calcEMA(tp, period)
  const atr = calcATR(candles, period)
  const minLen = Math.min(middle.length, atr.length)
  const upper: number[] = [], lower: number[] = []
  for (let i = 0; i < minLen; i++) {
    upper.push(middle[middle.length - minLen + i] + mult * atr[atr.length - minLen + i])
    lower.push(middle[middle.length - minLen + i] - mult * atr[atr.length - minLen + i])
  }
  return { upper, middle: middle.slice(-minLen), lower }
}

// ── 蜡烛形态检测 ───────────────────────────────────────────────────────────

function detectDoji(candle: Candle): boolean {
  const body = Math.abs(candle.c - candle.o)
  const range = candle.h - candle.l
  return range > 0 && body / range < 0.1
}

function detectHammer(candle: Candle): boolean {
  const body = Math.abs(candle.c - candle.o)
  const upperWick = candle.h - Math.max(candle.o, candle.c)
  const lowerWick = Math.min(candle.o, candle.c) - candle.l
  return body > 0 && lowerWick > body * 2 && upperWick < body * 0.5
}

function detectEngulfing(prev: Candle, curr: Candle): "bullish" | "bearish" | null {
  const prevBody = Math.abs(prev.c - prev.o)
  const currBody = Math.abs(curr.c - curr.o)
  if (currBody < prevBody * 1.2) return null
  if (curr.c > curr.o && prev.c < prev.o) return "bullish"
  if (curr.c < curr.o && prev.c > prev.o) return "bearish"
  return null
}

// ── Agent 信号解读（纯规则引擎） ────────────────────────────────────────────

function rsiSignal(rsi: number): { signal: string; message: string } {
  if (rsi > 70) return { signal: "bearish", message: `RSI 超买 (${rsi.toFixed(1)} > 70)，近期有回调风险，不宜追多` }
  if (rsi < 30) return { signal: "bullish", message: `RSI 超卖 (${rsi.toFixed(1)} < 30)，可能出现技术性反弹，不宜追空` }
  if (rsi > 60) return { signal: "bullish", message: `RSI 偏强 (${rsi.toFixed(1)})，多头动能持续` }
  if (rsi < 40) return { signal: "bearish", message: `RSI 偏弱 (${rsi.toFixed(1)})，空头动能持续` }
  return { signal: "neutral", message: `RSI 中性 (${rsi.toFixed(1)})，无明显超买超卖信号` }
}

function macdSignal(hist: number, prevHist: number): { signal: string; message: string } {
  if (hist > 0 && prevHist <= 0) return { signal: "bullish", message: "MACD 金叉，多头信号启动" }
  if (hist < 0 && prevHist >= 0) return { signal: "bearish", message: "MACD 死叉，空头信号启动" }
  if (hist > 0) return { signal: "bullish", message: `MACD 柱 ${hist.toFixed(4)}，多头区域运行` }
  return { signal: "bearish", message: `MACD 柱 ${hist.toFixed(4)}，空头区域运行` }
}

function stochSignal(k: number, d: number): { signal: string; message: string } {
  if (k > 80 && d > 80) return { signal: "bearish", message: `KD 超买 (K:${k.toFixed(1)}, D:${d.toFixed(1)})，关注死叉` }
  if (k < 20 && d < 20) return { signal: "bullish", message: `KD 超卖 (K:${k.toFixed(1)}, D:${d.toFixed(1)})，关注金叉` }
  return { signal: "neutral", message: `KD 中性区域 (K:${k.toFixed(1)}, D:${d.toFixed(1)})` }
}

function adxSignal(adx: number, plusDI: number, minusDI: number): { signal: string; message: string } {
  if (adx > 40) {
    if (plusDI > minusDI) return { signal: "bullish", message: `ADX 强势趋势 (${adx.toFixed(1)})，+DI 主导，多头趋势强劲` }
    return { signal: "bearish", message: `ADX 强势趋势 (${adx.toFixed(1)})，-DI 主导，空头趋势强劲` }
  }
  if (adx > 25) {
    if (plusDI > minusDI) return { signal: "bullish", message: `ADX 趋势确立 (${adx.toFixed(1)})，方向偏多` }
    return { signal: "bearish", message: `ADX 趋势确立 (${adx.toFixed(1)})，方向偏空` }
  }
  return { signal: "neutral", message: `ADX 低波动 (${adx.toFixed(1)} < 25)，震荡行情，趋势策略需谨慎` }
}

// ════════════════════════════════════════════════════════════════════════════
// 注册 MCP 工具
// ════════════════════════════════════════════════════════════════════════════

export function registerIndicatorTools(server: McpServer): void {

  server.tool(
    "okx_indicator",
    "CAT:[行情] | ## 功能：计算指定产品的单个技术指标，返回原始值 + 中文Agent信号解读（超买/超卖/金叉/死叉/趋势方向）\n## 场景：Agent 回答「RSI 多少」「MACD 金叉了吗」「布林带什么位置」等指标问题时调用，一次拿到计算结果和操作建议\n## 关键词：技术指标, indicator, RSI, MACD, 布林带, KDJ, ADX, 超买, 超卖, 金叉, 死叉, 均线\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - indicator: 指标名 (sma/ema/rsi/macd/bb/atr/stoch/wr/cci/obv/vwap/adx/mfi/cmf/supertrend/keltner/pattern)\n##   - period: 周期参数，默认值因指标而异（RSI=14，MACD=12/26/9 等）\n##   - bar: K线粒度，默认 1H。支持 1m/5m/15m/30m/1H/2H/4H/6H/12H/1D\n## 鉴权：PUBLIC — 公开接口（基于 okx_get_candles）\n## 风险：READ — 只计算不交易\n## 返回量：微小 ~1KB\n## 关联：本工具计算指标 → okx_quick_market 看盘口 → agent_quick_trade 下单",
    {
      instId:    z.string().describe("产品ID，如 BTC-USDT、ETH-USDT-SWAP"),
      indicator: z.enum(["sma","ema","rsi","macd","bb","atr","stoch","wr","cci","obv","vwap","adx","mfi","cmf","supertrend","keltner","pattern"]).describe("指标名"),
      period:    z.number().int().min(2).max(200).optional().describe("周期（默认值因指标而异，如 RSI 默认14）"),
      bar:       z.enum(["1m","5m","15m","30m","1H","2H","4H","6H","12H","1D"]).optional().describe("K线粒度，默认1H"),
    },
    async ({ instId, indicator, period, bar }) => {
      try {
        const b = bar || "1H"
        const p = period || ({ sma: 20, ema: 20, rsi: 14, macd: 12, bb: 20, atr: 14, stoch: 14, wr: 14, cci: 20, obv: 0, vwap: 0, adx: 14, mfi: 14, cmf: 20, supertrend: 10, keltner: 20, pattern: 0 }[indicator] || 14)
        const minBars = indicator === "pattern" ? 5 : p * 3 + 50
        const candles = await fetchCandles(instId, b, minBars)
        if (candles.length < p + 2) {
          return toResult({
            instId, indicator, bar: b,
            error: `数据不足：仅获取 ${candles.length} 根K线，需要至少 ${p + 2} 根`,
            tsIso: new Date().toISOString(),
          })
        }

        const closes = candles.map(c => c.c)
        const latest = candles[candles.length - 1]
        let result: any = { instId, indicator, bar: b, period: p, tsIso: new Date().toISOString() }

        switch (indicator) {
          case "sma": {
            const sma = calcSMA(closes, p)
            const v = sma[sma.length - 1]
            const prev = sma[sma.length - 2]
            result.value = v.toFixed(4)
            result.signal = latest.c > v ? "bullish" : "bearish"
            result.message = `SMA(${p}) = ${v.toFixed(2)}。价格${latest.c > v ? "高于" : "低于"}均线，${latest.c > v ? "多头排列" : "空头排列"}${latest.c > v !== (prev > 0) ? "（刚刚穿越，可能是变盘信号）" : ""}`
            break
          }
          case "ema": {
            const ema = calcEMA(closes, p)
            const v = ema[ema.length - 1]
            const prev = ema[ema.length - 2]
            result.value = v.toFixed(4)
            result.signal = latest.c > v ? "bullish" : "bearish"
            result.message = `EMA(${p}) = ${v.toFixed(2)}。价格${latest.c > v ? "高于" : "低于"}指数均线，${latest.c > v ? "短期趋势偏多" : "短期趋势偏空"}`
            break
          }
          case "rsi": {
            const rsi = calcRSI(closes, p)
            const v = rsi[rsi.length - 1]
            result.value = v.toFixed(2)
            const sig = rsiSignal(v)
            result.signal = sig.signal
            result.message = sig.message
            break
          }
          case "macd": {
            const { macd, signal: sigLine, histogram } = calcMACD(closes, 12, 26, 9)
            const m = macd[macd.length - 1], s = sigLine[sigLine.length - 1], h = histogram[histogram.length - 1]
            const prevH = histogram[histogram.length - 2] || 0
            result.value = { macd: m.toFixed(4), signal: s.toFixed(4), histogram: h.toFixed(4) }
            const sig = macdSignal(h, prevH)
            result.signal = sig.signal
            result.message = `MACD(12,26,9): DIF=${m.toFixed(4)}, DEA=${s.toFixed(4)}, 柱=${h.toFixed(4)}。${sig.message}`
            break
          }
          case "bb": {
            const bb = calcBollinger(closes, p, 2)
            const up = bb.upper[bb.upper.length - 1], mid = bb.middle[bb.middle.length - 1]
            const lo = bb.lower[bb.lower.length - 1], pct = bb.pctB[bb.pctB.length - 1]
            result.value = { upper: up.toFixed(2), middle: mid.toFixed(2), lower: lo.toFixed(2), pctB: pct.toFixed(3), bandwidth: bb.bandwidth[bb.bandwidth.length - 1].toFixed(2) + "%" }
            if (pct > 1) result = { ...result, signal: "bearish", message: `布林带(${p},2): 价格 ${latest.c.toFixed(2)} 突破上轨 ${up.toFixed(2)}，超买状态，可能回调` }
            else if (pct < 0) result = { ...result, signal: "bullish", message: `布林带(${p},2): 价格 ${latest.c.toFixed(2)} 跌破下轨 ${lo.toFixed(2)}，超卖状态，可能反弹` }
            else if (pct > 0.8) result = { ...result, signal: "bullish", message: `布林带(${p},2): 价格 ${latest.c.toFixed(2)} 偏上轨 ${up.toFixed(2)}，强势区域` }
            else if (pct < 0.2) result = { ...result, signal: "bearish", message: `布林带(${p},2): 价格 ${latest.c.toFixed(2)} 偏下轨 ${lo.toFixed(2)}，弱势区域` }
            else result = { ...result, signal: "neutral", message: `布林带(${p},2): 价格 ${latest.c.toFixed(2)} 在中轨 ${mid.toFixed(2)} 附近，震荡整理` }
            break
          }
          case "atr": {
            const atr = calcATR(candles, p)
            const v = atr[atr.length - 1]
            const pctOfPrice = (v / latest.c) * 100
            result.value = v.toFixed(4)
            result.message = `ATR(${p}) = ${v.toFixed(4)}（为当前价格的 ${pctOfPrice.toFixed(2)}%）。波动率${pctOfPrice > 3 ? "较高" : pctOfPrice > 1 ? "正常" : "较低"}，止损建议设置在 ${(latest.c - v * 1.5).toFixed(2)} ~ ${(latest.c - v * 2).toFixed(2)}`
            result.signal = "neutral"
            break
          }
          case "stoch": {
            const st = calcStoch(candles, p, 3)
            const k = st.k[st.k.length - 1], d = st.d[st.d.length - 1]
            result.value = { k: k.toFixed(2), d: d.toFixed(2) }
            const sig = stochSignal(k, d)
            result.signal = sig.signal
            result.message = sig.message
            break
          }
          case "wr": {
            const wr = calcWR(candles, p)
            const v = wr[wr.length - 1]
            result.value = v.toFixed(2)
            if (v > -20) result = { ...result, signal: "bearish", message: `W%R(${p}) = ${v.toFixed(1)}，超买区（>-20），短期回调风险` }
            else if (v < -80) result = { ...result, signal: "bullish", message: `W%R(${p}) = ${v.toFixed(1)}，超卖区（<-80），短期反弹机会` }
            else result = { ...result, signal: "neutral", message: `W%R(${p}) = ${v.toFixed(1)}，中性区域` }
            break
          }
          case "cci": {
            const cci = calcCCI(candles, p)
            const v = cci[cci.length - 1]
            result.value = v.toFixed(2)
            if (v > 200) result = { ...result, signal: "bearish", message: `CCI(${p}) = ${v.toFixed(1)}，极度超买（>200），强回调信号` }
            else if (v > 100) result = { ...result, signal: "bullish", message: `CCI(${p}) = ${v.toFixed(1)}，超买区域（>100），趋势偏强但注意回调` }
            else if (v < -200) result = { ...result, signal: "bullish", message: `CCI(${p}) = ${v.toFixed(1)}，极度超卖（<-200），强反弹信号` }
            else if (v < -100) result = { ...result, signal: "bearish", message: `CCI(${p}) = ${v.toFixed(1)}，超卖区域（<-100），趋势偏弱但注意反弹` }
            else result = { ...result, signal: "neutral", message: `CCI(${p}) = ${v.toFixed(1)}，正常范围（-100~100），无明显极端信号` }
            break
          }
          case "obv": {
            const obv = calcOBV(candles)
            const v = obv[obv.length - 1]
            const prevV = obv[obv.length - 2]
            const trend = v > obv[obv.length - Math.min(20, obv.length)] ? "上升" : "下降"
            result.value = v.toFixed(0)
            result.signal = trend === "上升" ? "bullish" : "bearish"
            result.message = `OBV 当前 ${v.toFixed(0)}（${v > prevV ? "+" : ""}${(v - prevV).toFixed(0)}），近期趋势${trend}。${trend === "上升" ? "量价配合，上涨有资金支撑" : "成交量不配合，上涨动力不足"}`
            break
          }
          case "vwap": {
            const vwap = calcVWAP(candles)
            const v = vwap[vwap.length - 1]
            result.value = v.toFixed(4)
            result.signal = latest.c > v ? "bullish" : "bearish"
            result.message = `VWAP = ${v.toFixed(2)}。价格${latest.c > v ? "高于" : "低于"}成交量加权均价，${latest.c > v ? "买方主导" : "卖方主导"}`
            break
          }
          case "adx": {
            const { adx, plusDI, minusDI } = calcADX(candles, p)
            const a = adx[adx.length - 1], pDI = plusDI[plusDI.length - 1], mDI = minusDI[minusDI.length - 1]
            result.value = { adx: a.toFixed(2), plusDI: pDI.toFixed(2), minusDI: mDI.toFixed(2) }
            const sig = adxSignal(a, pDI, mDI)
            result.signal = sig.signal
            result.message = sig.message
            break
          }
          case "mfi": {
            const mfi = calcMFI(candles, p)
            const v = mfi[mfi.length - 1]
            result.value = v.toFixed(2)
            if (v > 80) result = { ...result, signal: "bearish", message: `MFI(${p}) = ${v.toFixed(1)}，资金严重超买（>80），可能见顶` }
            else if (v < 20) result = { ...result, signal: "bullish", message: `MFI(${p}) = ${v.toFixed(1)}，资金严重超卖（<20），可能见底` }
            else if (v > 60) result = { ...result, signal: "bullish", message: `MFI(${p}) = ${v.toFixed(1)}，资金持续流入` }
            else if (v < 40) result = { ...result, signal: "bearish", message: `MFI(${p}) = ${v.toFixed(1)}，资金持续流出` }
            else result = { ...result, signal: "neutral", message: `MFI(${p}) = ${v.toFixed(1)}，资金面中性` }
            break
          }
          case "cmf": {
            const cmf = calcCMF(candles, p)
            const v = cmf[cmf.length - 1]
            result.value = v.toFixed(4)
            if (v > 0.1) result = { ...result, signal: "bullish", message: `CMF(${p}) = ${v.toFixed(3)}，显著净流入（>0.1），买方主导` }
            else if (v < -0.1) result = { ...result, signal: "bearish", message: `CMF(${p}) = ${v.toFixed(3)}，显著净流出（<-0.1），卖方主导` }
            else if (v > 0) result = { ...result, signal: "bullish", message: `CMF(${p}) = ${v.toFixed(3)}，轻微净流入` }
            else result = { ...result, signal: "bearish", message: `CMF(${p}) = ${v.toFixed(3)}，轻微净流出` }
            break
          }
          case "supertrend": {
            const st = calcSupertrend(candles, p, 3)
            const trend = st.trend[st.trend.length - 1]
            const dir = st.direction[st.direction.length - 1]
            result.value = { trend: trend.toFixed(2), direction: dir }
            result.signal = dir === 1 ? "bullish" : "bearish"
            result.message = `Supertrend(${p},3): ${dir === 1 ? "🟢 多头" : "🔴 空头"}，止损线 ${trend.toFixed(2)}。${dir === 1 ? "趋势偏多，不建议做空" : "趋势偏空，不建议做多"}`
            break
          }
          case "keltner": {
            const kc = calcKeltner(candles, p, 2)
            const up = kc.upper[kc.upper.length - 1], mid = kc.middle[kc.middle.length - 1]
            const lo = kc.lower[kc.lower.length - 1]
            result.value = { upper: up.toFixed(2), middle: mid.toFixed(2), lower: lo.toFixed(2) }
            if (latest.c > up) result = { ...result, signal: "bullish", message: `肯特纳(${p},2): 价格突破上轨 ${up.toFixed(2)}，强势突破信号` }
            else if (latest.c < lo) result = { ...result, signal: "bearish", message: `肯特纳(${p},2): 价格跌破下轨 ${lo.toFixed(2)}，弱势跌破信号` }
            else result = { ...result, signal: "neutral", message: `肯特纳(${p},2): 价格在通道内 [${lo.toFixed(2)}, ${up.toFixed(2)}]，震荡运行` }
            break
          }
          case "pattern": {
            const patterns: string[] = []
            const last = candles[candles.length - 1], prev = candles[candles.length - 2]
            if (detectDoji(last)) patterns.push("十字星 (Doji) — 多空均衡，变盘前兆")
            if (detectHammer(last)) patterns.push("锤子线 (Hammer) — 底部反转信号，看涨")
            const eng = detectEngulfing(prev, last)
            if (eng === "bullish") patterns.push("看涨吞没 (Bullish Engulfing) — 强底部反转信号")
            if (eng === "bearish") patterns.push("看跌吞没 (Bearish Engulfing) — 强顶部反转信号")
            if (candles.length >= 5) {
              const last5 = candles.slice(-5)
              if (last5.every(c => c.c < c.o) && last.c > last.o) patterns.push("晨星 (Morning Star) — 底部三线反转，看涨")
              if (last5.every(c => c.c > c.o) && last.c < last.o) patterns.push("黄昏星 (Evening Star) — 顶部三线反转，看跌")
            }
            result.value = patterns
            result.signal = patterns.length > 0 ? (patterns[0].includes("Bullish") || patterns[0].includes("Hammer") || patterns[0].includes("Morning") ? "bullish" : "bearish") : "neutral"
            result.message = patterns.length > 0 ? patterns.join("；") : "最近两根K线未检测到经典反转形态"
            break
          }
        }

        result._summary = `[${instId} ${b}] ${indicator.toUpperCase()}: ${result.message}`

        return toResult(result)
      } catch (e) { return toError(e) }
    }
  )

  // ── okx_indicator_batch — 多指标批量计算 ────────────────────────────────

  server.tool(
    "okx_indicator_batch",
    "CAT:[行情] | ## 功能：批量计算多个技术指标，一次性返回全部指标值和综合交易信号总结\n## 场景：Agent 需要综合分析多个指标（如同时看RSI+MACD+布林带）时调用，一次拿到所有结果和综合判断\n## 关键词：批量指标, indicator batch, 多指标, 综合信号, 技术分析, 指标组合\n## 参数：\n##   - instId: 产品ID\n##   - indicators: 指标名列表，用逗号分隔。如 RSI,MACD,BB,ATR\n##   - bar: K线粒度，默认 1H\n## 鉴权：PUBLIC\n## 风险：READ\n## 返回量：微小 ~3KB\n## 关联：本工具批量 → 单指标深入用 okx_indicator → agent_quick_trade 下单",
    {
      instId:     z.string().describe("产品ID，如 BTC-USDT"),
      indicators: z.string().describe("指标名列表，逗号分隔。可选: sma,ema,rsi,macd,bb,atr,stoch,wr,cci,obv,vwap,adx,mfi,cmf,supertrend,keltner,pattern"),
      bar:        z.enum(["1m","5m","15m","30m","1H","2H","4H","6H","12H","1D"]).optional().describe("K线粒度，默认1H"),
    },
    async ({ instId, indicators, bar }) => {
      try {
        const b = bar || "1H"
        const list = indicators.split(",").map(s => s.trim().toLowerCase()).filter(s => s.length > 0)
        if (list.length === 0) return toError("indicators 参数不能为空，Agent 请指定至少一个指标名")
        if (list.length > 10) return toError("最多同时计算 10 个指标，Agent 请减少数量")

        const candles = await fetchCandles(instId, b, 300)
        if (candles.length < 20) {
          return toResult({
            instId, bar: b,
            error: `数据不足：仅获取 ${candles.length} 根K线`,
            tsIso: new Date().toISOString(),
          })
        }

        const closes = candles.map(c => c.c)
        let bullCount = 0, bearCount = 0
        const results: any[] = []

        for (const ind of list) {
          const p = ({ sma: 20, ema: 20, rsi: 14, macd: 12, bb: 20, atr: 14, stoch: 14, wr: 14, cci: 20, obv: 0, vwap: 0, adx: 14, mfi: 14, cmf: 20, supertrend: 10, keltner: 20, pattern: 0 }[ind] || 14)
          let item: any = { indicator: ind }
          try {
            switch (ind) {
              case "rsi": { const v = calcRSI(closes, p); item.value = v[v.length - 1].toFixed(2); const sig = rsiSignal(v[v.length - 1]); item.signal = sig.signal; item.message = sig.message; break }
              case "macd": { const m = calcMACD(closes, 12, 26, 9); const h = m.histogram[m.histogram.length - 1]; item.value = `${h.toFixed(4)}`; const prevH = m.histogram[m.histogram.length - 2] || 0; const sig = macdSignal(h, prevH); item.signal = sig.signal; item.message = sig.message; break }
              case "bb": { const bb = calcBollinger(closes, p, 2); const pct = bb.pctB[bb.pctB.length - 1]; item.value = `pctB:${pct.toFixed(2)}`; if (pct > 1) { item.signal = "bearish"; item.message = "突破上轨" } else if (pct < 0) { item.signal = "bullish"; item.message = "跌破下轨" } else { item.signal = "neutral"; item.message = "通道内" }; break }
              case "atr": { const a = calcATR(candles, p); item.value = a[a.length - 1].toFixed(4); item.signal = "neutral"; item.message = `波动率: ${((a[a.length - 1] / candles[candles.length - 1].c) * 100).toFixed(2)}%`; break }
              case "stoch": { const s = calcStoch(candles, p, 3); item.value = `K:${s.k[s.k.length - 1].toFixed(1)},D:${s.d[s.d.length - 1].toFixed(1)}`; const sig = stochSignal(s.k[s.k.length - 1], s.d[s.d.length - 1]); item.signal = sig.signal; item.message = sig.message; break }
              case "wr": { const w = calcWR(candles, p); item.value = w[w.length - 1].toFixed(1); item.signal = w[w.length - 1] > -20 ? "bearish" : w[w.length - 1] < -80 ? "bullish" : "neutral"; item.message = `W%R=${item.value}`; break }
              case "cci": { const c = calcCCI(candles, p); item.value = c[c.length - 1].toFixed(1); item.signal = Math.abs(c[c.length - 1]) > 100 ? (c[c.length - 1] > 0 ? "bearish" : "bullish") : "neutral"; item.message = `CCI=${item.value}`; break }
              case "obv": { const o = calcOBV(candles); item.value = o[o.length - 1].toFixed(0); item.signal = o[o.length - 1] > o[o.length - 20] ? "bullish" : "bearish"; item.message = "量价分析"; break }
              case "vwap": { const vw = calcVWAP(candles); item.value = vw[vw.length - 1].toFixed(2); item.signal = candles[candles.length - 1].c > vw[vw.length - 1] ? "bullish" : "bearish"; item.message = "成交量加权均价"; break }
              case "adx": { const ax = calcADX(candles, p); const a = ax.adx[ax.adx.length - 1] ?? 0; const pd = ax.plusDI[ax.plusDI.length - 1] ?? 0; const md = ax.minusDI[ax.minusDI.length - 1] ?? 0; item.value = `${a.toFixed(1)}`; const sig = adxSignal(a, pd, md); item.signal = sig.signal; item.message = sig.message; break }
              case "mfi": { const mf = calcMFI(candles, p); const v = mf[mf.length - 1] ?? 50; item.value = v.toFixed(1); item.signal = v > 80 ? "bearish" : v < 20 ? "bullish" : "neutral"; item.message = `MFI=${item.value}`; break }
              case "cmf": { const cm = calcCMF(candles, p); const v = cm[cm.length - 1] ?? 0; item.value = v.toFixed(3); item.signal = v > 0 ? "bullish" : "bearish"; item.message = `CMF=${item.value}`; break }
              case "supertrend": { const st = calcSupertrend(candles, p, 3); const trend = st.trend[st.trend.length - 1] ?? 0; const dir = st.direction[st.direction.length - 1] ?? 0; item.value = trend.toFixed(2); item.signal = dir === 1 ? "bullish" : "bearish"; item.message = `${item.signal === "bullish" ? "多头" : "空头"}`; break }
              default: { item.value = "N/A"; item.signal = "neutral"; item.message = `指标 ${ind} 暂不支持批量计算，请用 okx_indicator 单独查询`; break }
            }
          } catch { item.value = "error"; item.signal = "neutral"; item.message = "计算失败" }
          if (item.signal === "bullish") bullCount++
          else if (item.signal === "bearish") bearCount++
          results.push(item)
        }

        const consensus = bullCount > bearCount + 2 ? "bullish" : bearCount > bullCount + 2 ? "bearish" : "neutral"
        const consensusMsg = consensus === "bullish"
          ? `🟢 综合偏多（${bullCount}个看涨 vs ${bearCount}个看跌），多个指标确认多头信号`
          : consensus === "bearish"
            ? `🔴 综合偏空（${bearCount}个看跌 vs ${bullCount}个看涨），多个指标确认空头信号`
            : `🟡 信号分歧（${bullCount}多 ${bearCount}空），方向不明确，建议观望`

        return toResult({
          instId, bar: b,
          indicators: results,
          consensus: { signal: consensus, bullCount, bearCount, neutralCount: results.length - bullCount - bearCount, message: consensusMsg },
          _summary: `[${instId} ${b}] 共 ${results.length} 个指标。${consensusMsg}`,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )
}
