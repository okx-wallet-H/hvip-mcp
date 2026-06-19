/**
 * signal-tracker.mjs — Signal Performance Tracking & Feedback Loop
 * ================================================================
 *
 * Monitors expired signals, verifies outcomes against actual market data,
 * updates signal records with TP/SL/EXPIRED status, and computes
 * rolling accuracy stats for feedback into signal generation.
 *
 * This closes the loop: Signal → Wait → Verify → Feed back → Better signals
 *
 * Usage:
 *   node scripts/signal-tracker.mjs                # One-shot verification
 *   node scripts/signal-tracker.mjs --watch         # Continuous monitoring (every 5min)
 *   node scripts/signal-tracker.mjs --stats         # Print performance stats
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const SIGNALS_PATH = join(process.cwd(), ".hub", "signals.json")
const TRACKER_STATE = join(process.cwd(), ".hub", "tracker-state.json")
const VBT_DB = join(process.cwd(), ".hub", "vbt-backtest.db")

// ═══════════════════════════════════════════════════════════
// Market Data: Fetch current price from OKX
// ═══════════════════════════════════════════════════════════

async function fetchPrice(symbol) {
  try {
    const instId = symbol.replace("/", "-")
    const resp = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`)
    const data = await resp.json()
    if (data.data?.[0]) return parseFloat(data.data[0].last)
  } catch {}
  return null
}

// ═══════════════════════════════════════════════════════════
// Verify a single signal
// ═══════════════════════════════════════════════════════════

async function verifySignal(signal) {
  const currentPrice = await fetchPrice(signal.symbol)
  if (!currentPrice) return null

  const entryPrice = signal.price
  const direction = signal.direction

  // Calculate PnL
  let pnlPct = 0
  if (direction === "LONG") {
    pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100
  } else if (direction === "SHORT") {
    pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100
  }

  // Determine outcome
  let outcome, outcomeLabel
  if (signal.risk) {
    const sl = signal.risk.sl_price
    const tp = signal.risk.tp_price
    // Check if TP/SL were hit (approximate — can't know intra-bar)
    if (direction === "LONG") {
      if (currentPrice >= tp) { outcome = "TP"; outcomeLabel = "✅ TP" }
      else if (currentPrice <= sl) { outcome = "SL"; outcomeLabel = "❌ SL" }
      else { outcome = "EXPIRED"; outcomeLabel = "⏰ EXPIRED" }
    } else {
      if (currentPrice <= tp) { outcome = "TP"; outcomeLabel = "✅ TP" }
      else if (currentPrice >= sl) { outcome = "SL"; outcomeLabel = "❌ SL" }
      else { outcome = "EXPIRED"; outcomeLabel = "⏰ EXPIRED" }
    }
  } else {
    // No risk params — use simple directional check
    if (direction === "LONG" && pnlPct > 0) { outcome = "TP"; outcomeLabel = "✅ TP" }
    else if (direction === "SHORT" && pnlPct > 0) { outcome = "TP"; outcomeLabel = "✅ TP" }
    else if (pnlPct === 0) { outcome = "EXPIRED"; outcomeLabel = "⏰ EXPIRED" }
    else { outcome = "SL"; outcomeLabel = "❌ SL" }
  }

  return {
    signalId: signal.id,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.direction,
    grade: signal.grade,
    entryPrice,
    exitPrice: currentPrice,
    pnlPct: Math.round(pnlPct * 100) / 100,
    outcome,
    outcomeLabel,
    predictedAt: signal.createdAt,
    verifiedAt: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════
// Run verification
// ═══════════════════════════════════════════════════════════

async function verifyExpired() {
  if (!existsSync(SIGNALS_PATH)) {
    console.log("[Tracker] ⚠️ No signals.json found")
    return { verified: [], stats: null }
  }

  const state = JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"))
  const now = Date.now()
  const signals = state.signals || []

  // Find expired but unverified signals
  const expired = signals.filter(s => {
    if (s.results) return false  // Already verified
    const exp = new Date(s.expiresAt).getTime()
    return exp <= now
  })

  if (!expired.length) {
    console.log("[Tracker] ✓ No expired signals to verify")
    return { verified: [], stats: null }
  }

  console.log(`[Tracker] Verifying ${expired.length} expired signals...`)

  const verified = []
  for (const s of expired) {
    const result = await verifySignal(s)
    if (result) {
      s.results = {
        outcome: result.outcome,
        pnlPct: result.pnlPct,
        exitPrice: result.exitPrice,
        verifiedAt: result.verifiedAt,
      }
      verified.push(result)
      console.log(`  ${result.outcomeLabel} ${result.signalId} ${s.symbol} ${s.direction} | PnL: ${result.pnlPct >= 0 ? "+" : ""}${result.pnlPct}% | grade=${s.grade}`)
    }
  }

  // Save updated state
  state.signals = signals
  state.lastVerified = new Date().toISOString()
  writeFileSync(SIGNALS_PATH, JSON.stringify(state, null, 2))

  // Compute stats
  const stats = computeStats(verified)
  console.log(`\n[Tracker] ✅ Verified ${verified.length} signals`)
  if (stats) {
    console.log(`  Accuracy: ${stats.accuracy}% | Avg PnL: ${stats.avgPnl}%`)
    console.log(`  By Grade: A=${stats.byGrade.A?.accuracy || "N/A"} B=${stats.byGrade.B?.accuracy || "N/A"} C=${stats.byGrade.C?.accuracy || "N/A"}`)
  }

  return { verified, stats }
}

// ═══════════════════════════════════════════════════════════
// Compute performance stats
// ═══════════════════════════════════════════════════════════

function computeStats(verified) {
  if (!verified.length) return null

  const total = verified.length
  const tp = verified.filter(v => v.outcome === "TP").length
  const sl = verified.filter(v => v.outcome === "SL").length
  const expired = verified.filter(v => v.outcome === "EXPIRED").length
  const totalPnl = verified.reduce((sum, v) => sum + v.pnlPct, 0)

  const byGrade = {}
  for (const g of ["A", "B", "C"]) {
    const subset = verified.filter(v => v.grade === g)
    if (subset.length) {
      const gradeTp = subset.filter(v => v.outcome === "TP").length
      byGrade[g] = {
        count: subset.length,
        accuracy: Math.round((gradeTp / subset.length) * 100),
        avgPnl: Math.round(subset.reduce((s, v) => s + v.pnlPct, 0) / subset.length * 100) / 100,
      }
    }
  }

  return {
    total,
    tp,
    sl,
    expired,
    accuracy: Math.round((tp / (tp + sl || 1)) * 100),
    avgPnl: Math.round(totalPnl / total * 100) / 100,
    byGrade,
  }
}

// ═══════════════════════════════════════════════════════════
// Update VBT database
// ═══════════════════════════════════════════════════════════

async function syncToVbtDb(verified) {
  if (!existsSync(VBT_DB)) return

  try {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(VBT_DB)

    const updateSignal = db.prepare(`
      UPDATE signals SET outcome = ?, outcome_price = ?, outcome_pnl = ?, outcome_at = ?, verified = 1
      WHERE id = ?
    `)

    const insertPerf = db.prepare(`
      INSERT OR REPLACE INTO performance
      (signal_id, symbol, timeframe, direction, grade, predicted_at, entry_price, exit_price, outcome, pnl_pct, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const updateDaily = db.prepare(`
      INSERT INTO daily_stats (date, symbol, timeframe, total, wins, losses, expired, accuracy, avg_pnl)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(date, symbol, timeframe) DO UPDATE SET
        total = total + 1,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        expired = expired + excluded.expired,
        accuracy = ROUND(CAST(wins + excluded.wins AS REAL) / (wins + excluded.wins + losses + excluded.losses) * 100, 1),
        avg_pnl = ROUND((avg_pnl * (total - 1) + excluded.avg_pnl) / total, 2)
    `)

    for (const v of verified) {
      updateSignal.run(v.outcome, v.exitPrice, v.pnlPct, v.verifiedAt, v.signalId)
      insertPerf.run(
        v.signalId, v.symbol, v.timeframe, v.direction, v.grade,
        v.predictedAt, v.entryPrice, v.exitPrice,
        v.outcome, v.pnlPct, v.verifiedAt,
      )
      const date = v.predictedAt.slice(0, 10)
      updateDaily.run(
        date, v.symbol, v.timeframe,
        v.outcome === "TP" ? 1 : 0,
        v.outcome === "SL" ? 1 : 0,
        v.outcome === "EXPIRED" ? 1 : 0,
        v.pnlPct, v.pnlPct,
      )
    }

    db.close()
    console.log(`[Tracker] Synced ${verified.length} results to VBT DB`)
  } catch (e) {
    console.log(`[Tracker] DB sync skipped: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════
// Print stats (from signals.json)
// ═══════════════════════════════════════════════════════════

function printStats() {
  if (!existsSync(SIGNALS_PATH)) {
    console.log("[Tracker] No signals.json found")
    return
  }

  const state = JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"))
  const signals = state.signals || []
  const verified = signals.filter(s => s.results?.outcome)
  const pending = signals.filter(s => !s.results)

  console.log("\n═══ Signal Performance Report ═══\n")
  console.log(`Total signals:  ${signals.length}`)
  console.log(`Verified:       ${verified.length}`)
  console.log(`Pending:        ${pending.length}`)
  console.log(`Last verified:  ${state.lastVerified || "never"}`)

  if (verified.length) {
    const stats = computeStats(verified.map(s => ({
      outcome: s.results.outcome,
      pnlPct: s.results.pnlPct,
      grade: s.grade,
    })))
    if (stats) {
      console.log(`\nAccuracy: ${stats.accuracy}% (${stats.tp} TP / ${stats.sl} SL / ${stats.expired} EXPIRED)`)
      console.log(`Avg PnL:  ${stats.avgPnl >= 0 ? "+" : ""}${stats.avgPnl}%`)
      console.log("\nBy Grade:")
      for (const [g, s] of Object.entries(stats.byGrade)) {
        console.log(`  Grade ${g}: ${s.count} signals, ${s.accuracy}% accuracy, avg PnL ${s.avgPnl}%`)
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

const arg = process.argv[2]

async function main() {
  if (arg === "--stats") {
    printStats()
  } else if (arg === "--watch") {
    console.log("[Tracker] Starting continuous monitoring (every 5 min)...")
    const run = async () => {
      const { verified } = await verifyExpired()
      if (verified.length) await syncToVbtDb(verified)
    }
    await run()
    setInterval(() => run().catch(e => console.error("[Tracker] Error:", e.message)), 300000)
  } else {
    // One-shot
    const { verified } = await verifyExpired()
    if (verified.length) await syncToVbtDb(verified)
    printStats()
  }
}

main().catch(e => {
  console.error("[Tracker] Fatal error:", e.message)
  process.exit(1)
})
