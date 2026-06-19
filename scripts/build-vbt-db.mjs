/**
 * build-vbt-db.mjs — VBT Backtest Database Builder
 * ================================================
 * Creates and initializes the SQLite database for VBT signal performance tracking.
 * Uses Node.js built-in `node:sqlite` (DatabaseSync) — no extra dependencies.
 *
 * Schema:
 *   signals      — Signal records with full metadata
 *   performance  — Per-signal outcome tracking (TP/SL/expired)
 *   strategies   — Strategy family performance aggregation
 *   daily_stats  — Daily aggregated stats for trend analysis
 *
 * Usage:
 *   node scripts/build-vbt-db.mjs              # Create/rebuild DB
 *   node scripts/build-vbt-db.mjs --migrate     # Migrate existing .hub/signals.json
 *   node scripts/build-vbt-db.mjs --stats       # Print DB stats
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

const DB_PATH = join(process.cwd(), ".hub", "vbt-backtest.db")
const SIGNALS_PATH = join(process.cwd(), ".hub", "signals.json")

// ═══════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════

const SCHEMA = `
CREATE TABLE IF NOT EXISTS signals (
  id            TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  direction     TEXT NOT NULL,
  confidence    INTEGER DEFAULT 0,
  price         REAL DEFAULT 0,
  grade         TEXT DEFAULT 'C',
  quality_score INTEGER DEFAULT 0,
  qualified_cnt INTEGER DEFAULT 0,
  cautioned_cnt INTEGER DEFAULT 0,
  tested_cnt    INTEGER DEFAULT 0,
  reason        TEXT DEFAULT '',
  multi_tf      TEXT DEFAULT 'neutral',
  avg_sharpe    REAL DEFAULT 0,
  avg_win_rate  REAL DEFAULT 0,
  avg_trades    INTEGER DEFAULT 0,
  top_strategy  TEXT DEFAULT '',
  risk_sl       REAL,
  risk_tp       REAL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  outcome       TEXT,
  outcome_price REAL,
  outcome_pnl   REAL,
  outcome_at    TEXT,
  replaced_by   TEXT,
  verified      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS performance (
  signal_id     TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  direction     TEXT NOT NULL,
  grade         TEXT,
  predicted_at  TEXT NOT NULL,
  entry_price   REAL,
  exit_price    REAL,
  outcome       TEXT NOT NULL,
  pnl_pct       REAL DEFAULT 0,
  bars_to_outcome INTEGER,
  verified_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategies (
  name          TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  total_signals INTEGER DEFAULT 0,
  wins          INTEGER DEFAULT 0,
  losses        INTEGER DEFAULT 0,
  avg_return    REAL DEFAULT 0,
  sharpe        REAL DEFAULT 0,
  max_dd        REAL DEFAULT 0,
  last_used_at  TEXT,
  PRIMARY KEY (name, symbol, timeframe)
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date          TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  total         INTEGER DEFAULT 0,
  wins          INTEGER DEFAULT 0,
  losses        INTEGER DEFAULT 0,
  expired       INTEGER DEFAULT 0,
  accuracy      REAL DEFAULT 0,
  avg_pnl       REAL DEFAULT 0,
  PRIMARY KEY (date, symbol, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_signals_outcome ON signals(outcome);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_perf_symbol ON performance(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_perf_outcome ON performance(outcome);
CREATE INDEX IF NOT EXISTS idx_strat_name ON strategies(name);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_stats(date);
`

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function open() {
  if (!existsSync(".hub")) mkdirSync(".hub", { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec("PRAGMA journal_mode = WAL")
  return db
}

// ═══════════════════════════════════════════════════════════
// Build
// ═══════════════════════════════════════════════════════════

function build() {
  const db = open()
  console.log(`[VBT-DB] Creating schema...`)
  db.exec(SCHEMA)

  // Seed strategy names from known VBT families
  const strategies = [
    "SuperTrend", "MACD", "RSI", "Bollinger", "EMA_Cross",
    "Donchian", "Keltner", "ParabolicSAR",
  ]
  const pairs = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
  const tfs = ["4h", "1h", "1d"]

  const insertStrat = db.prepare(
    `INSERT OR IGNORE INTO strategies (name, symbol, timeframe) VALUES (?, ?, ?)`
  )
  for (const s of strategies) {
    for (const p of pairs) {
      for (const tf of tfs) {
        insertStrat.run(s, p, tf)
      }
    }
  }

  const count = db.prepare("SELECT COUNT(*) as cnt FROM strategies").get()
  console.log(`[VBT-DB] ✅ Created: ${DB_PATH}`)
  console.log(`[VBT-DB]    signals table ready`)
  console.log(`[VBT-DB]    performance table ready`)
  console.log(`[VBT-DB]    strategies table ready (${count.cnt} entries)`)
  console.log(`[VBT-DB]    daily_stats table ready`)

  db.close()
}

// ═══════════════════════════════════════════════════════════
// Migrate from .hub/signals.json
// ═══════════════════════════════════════════════════════════

function migrate() {
  if (!existsSync(DB_PATH)) {
    console.log("[VBT-DB] DB not found, building first...")
    build()
  }

  if (!existsSync(SIGNALS_PATH)) {
    console.log("[VBT-DB] No signals.json to migrate")
    return
  }

  const signals = JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"))
  const db = open()

  const insert = db.prepare(`
    INSERT OR REPLACE INTO signals
    (id, symbol, timeframe, direction, confidence, price, grade, quality_score,
     qualified_cnt, cautioned_cnt, tested_cnt, reason, multi_tf,
     avg_sharpe, avg_win_rate, avg_trades, top_strategy,
     risk_sl, risk_tp, created_at, expires_at, outcome, outcome_at, replaced_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const s of signals.signals || []) {
    const risk = s.risk || {}
    const ensemble = s.ensemble || {}
    const mtf = s.multiTf || {}
    const result = s.results || {}

    insert.run(
      s.id,
      s.symbol || "?",
      s.timeframe || "?",
      s.direction || "NEUTRAL",
      s.confidence || 0,
      s.price || 0,
      s.grade || "C",
      s.qualityScore || 0,
      s.qualifiedCount || 0,
      s.cautionedCount || 0,
      s.testedCount || 0,
      s.reason || "",
      mtf.agreement || "neutral",
      ensemble.avgSharpe || 0,
      ensemble.avgWinRate || 0,
      ensemble.avgTrades || 0,
      s.topStrategy || "",
      risk.sl_price || null,
      risk.tp_price || null,
      s.createdAt || new Date().toISOString(),
      s.expiresAt || new Date().toISOString(),
      result.replacedBy ? "REPLACED" : null,
      result.replacedAt || null,
      result.replacedBy || null,
    )
    count++
  }

  console.log(`[VBT-DB] ✅ Migrated ${count} signals from signals.json`)
  db.close()
}

// ═══════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════

function stats() {
  if (!existsSync(DB_PATH)) {
    console.log("[VBT-DB] ❌ DB not found. Run: node scripts/build-vbt-db.mjs")
    return
  }

  const db = open()

  console.log("\n═══ VBT Database Stats ═══\n")

  const total = db.prepare("SELECT COUNT(*) as cnt FROM signals").get()
  console.log(`Total Signals: ${total.cnt}`)

  const byGrade = db.prepare("SELECT grade, COUNT(*) as cnt FROM signals GROUP BY grade ORDER BY grade").all()
  console.log("By Grade:", byGrade.map(r => `${r.grade}:${r.cnt}`).join(" ") || "none")

  const byOutcome = db.prepare("SELECT outcome, COUNT(*) as cnt FROM signals WHERE outcome IS NOT NULL GROUP BY outcome").all()
  console.log("By Outcome:", byOutcome.map(r => `${r.outcome}:${r.cnt}`).join(" ") || "none yet")

  const bySymbol = db.prepare("SELECT symbol, timeframe, COUNT(*) as cnt FROM signals GROUP BY symbol, timeframe ORDER BY cnt DESC").all()
  console.log("By Symbol/TF:", bySymbol.map(r => `${r.symbol}@${r.timeframe}:${r.cnt}`).join(" ") || "none")

  const recent = db.prepare("SELECT id, symbol, direction, grade, confidence, outcome FROM signals ORDER BY created_at DESC LIMIT 10").all()
  if (recent.length) {
    console.log("\nRecent 10 signals:")
    for (const r of recent) {
      const outcomeStr = r.outcome ? ` → ${r.outcome}` : " (pending)"
      console.log(`  ${r.id} ${r.symbol} ${r.direction} grade=${r.grade} conf=${r.confidence}%${outcomeStr}`)
    }
  }

  const strats = db.prepare("SELECT name, symbol, total_signals, wins, losses FROM strategies WHERE total_signals > 0 ORDER BY total_signals DESC LIMIT 10").all()
  if (strats.length) {
    console.log("\nTop Strategies:")
    for (const s of strats) {
      const wr = s.total_signals > 0 ? (s.wins / s.total_signals * 100).toFixed(0) : "0"
      console.log(`  ${s.name} ${s.symbol}: ${s.wins}/${s.total_signals} (${wr}% WR)`)
    }
  }

  db.close()
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

const arg = process.argv[2]
if (arg === "--migrate") migrate()
else if (arg === "--stats") stats()
else build()
