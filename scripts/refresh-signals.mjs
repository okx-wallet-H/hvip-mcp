/**
 * 定时信号刷新 — 批量生成 BTC/ETH/SOL 信号，注入 Hub
 * ============================================================
 * Usage: node scripts/refresh-signals.mjs
 *
 * 流程:
 *   1. 对 BTC/USDT, ETH/USDT, SOL/USDT 分别运行 vbt-signal-gen.mjs
 *   2. 解析输出 → 生成标准信号 JSON
 *   3. 写入 .hub/signals.json → Hub 的 /api/signals 立即可见
 *   4. AI Trader 下一轮自动读取新信号
 *
 * 调度: 由 Hub 的定时任务触发 (sched-quant)
 */

import { execSync } from "node:child_process"
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const REPO = process.cwd()
const SIGNAL_GEN = join(REPO, "scripts", "vbt-signal-gen.mjs")
const SIGNALS_FILE = join(REPO, ".hub", "signals.json")

const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
const TIMEFRAMES = ["4h"]  // 可以扩展: ["1h", "4h", "1d"]

function parseSignal(output) {
  const map = {}
  for (const line of output.split("\n")) {
    const idx = line.indexOf(": ")
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 2).trim()
    map[key] = val
  }
  return map
}

function generateSignalId(symbol, tf) {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const inst = symbol.replace("/", "")
  return `SIG-${inst}-${tf}-${date}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
}

function main() {
  console.log(`[refresh-signals] ${new Date().toISOString().slice(0, 19)} 开始刷新...`)

  const allSignals = []

  for (const symbol of SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      try {
        const cmd = `node "${SIGNAL_GEN}" ${symbol} ${tf}`
        console.log(`[refresh-signals] 执行: ${cmd}`)
        const out = execSync(cmd, { encoding: "utf-8", timeout: 30000, windowsHide: true, maxBuffer: 500_000 })
        const parsed = parseSignal(out)

        if (parsed.CURRENT_SIGNAL === "NEUTRAL" && parsed.CONFIDENCE === "0") {
          console.log(`[refresh-signals] ${symbol} ${tf}: 跳过 (数据不足/中性)`)
          continue
        }

        const price = parseFloat(parsed.CURRENT_PRICE) || 0
        const confidence = parseInt(parsed.CONFIDENCE) || 50
        const sharpe = parseFloat(parsed.SHARPE) || 0
        const winRate = parseFloat(parsed.WIN_RATE) || 0
        const maxDD = parseFloat(parsed.MAX_DD) || 0

        // Calculate quality grade
        let grade = "C"
        if (sharpe > 1.0 && confidence > 60) grade = "B"
        if (sharpe > 1.5 && confidence > 70) grade = "A"
        if (sharpe > 2.0 && confidence > 80) grade = "S"

        const signal = {
          id: generateSignalId(symbol, tf),
          symbol,
          timeframe: tf,
          direction: parsed.CURRENT_SIGNAL || "NEUTRAL",
          confidence,
          price,
          grade,
          reason: parsed.CONCLUSION || parsed.INDICATOR || "",
          indicator: parsed.INDICATOR || "SuperTrend(7,3)+RSI(14)",
          quality_score: Math.min(100, Math.round(confidence * (1 + sharpe * 0.2))),
          multi_tf: false,
          ensemble: {
            avgSharpe: sharpe,
            avgWinRate: winRate,
            avgTrades: parseInt(parsed.TOTAL_TRADES) || 0,
            avgReturn: parseFloat(parsed.AVG_RETURN) || 0,
            maxDrawdown: maxDD,
          },
          risk: {
            sl_price: price * 0.98,
            tp_price: price * 1.04,
          },
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
        }

        allSignals.push(signal)
        console.log(`[refresh-signals] ${symbol} ${tf}: ${signal.direction} conf=${confidence}% grade=${grade}`)

      } catch (e) {
        console.error(`[refresh-signals] ${symbol} ${tf} 失败: ${e.message}`)
      }
    }
  }

  // Merge with existing signals (keep non-expired ones from previous runs)
  let existing = []
  try {
    if (existsSync(SIGNALS_FILE)) {
      const raw = JSON.parse(readFileSync(SIGNALS_FILE, "utf-8"))
      existing = (raw.signals || raw).filter(s => {
        const exp = new Date(s.expires_at).getTime()
        return exp > Date.now() && !allSignals.find(ns => ns.symbol === s.symbol && ns.timeframe === s.timeframe)
      })
    }
  } catch {}

  const merged = [...allSignals, ...existing]

  // Write
  if (!existsSync(join(REPO, ".hub"))) mkdirSync(join(REPO, ".hub"), { recursive: true })
  writeFileSync(SIGNALS_FILE, JSON.stringify({ signals: merged, lastUpdate: new Date().toISOString() }, null, 2))
  console.log(`[refresh-signals] ✅ 写入 ${allSignals.length} 新信号 (总计 ${merged.length} 条活跃)`)
}

main()
