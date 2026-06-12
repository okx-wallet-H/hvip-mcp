/**
 * 逐接口实测脚本
 * 运行: npm run verify
 * 结果写入 docs/status.json，供 docs/index.html 展示
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { publicApi, privateApi, type Auth } from "../src/adapters/okx.js"
import { createHRailsClient } from "../src/adapters/hrails.js"

const GREEN = "\x1b[32m✅\x1b[0m"
const RED   = "\x1b[31m❌\x1b[0m"
const YELLOW = "\x1b[33m⏭\x1b[0m"
const DIM   = "\x1b[2m"
const RESET = "\x1b[0m"

interface TestResult {
  id:         string
  category:   string
  status:     "pass" | "fail" | "skip"
  error:      string | null
  preview:    string
  durationMs: number
}

const results: TestResult[] = []

async function test(id: string, category: string, fn: () => Promise<unknown>) {
  const start = Date.now()
  try {
    const data = await fn()
    const preview = JSON.stringify(data).slice(0, 100)
    const ms = Date.now() - start
    console.log(`${GREEN} ${id} ${DIM}(${ms}ms)${RESET}`)
    console.log(`${DIM}   ${preview}${RESET}`)
    results.push({ id, category, status: "pass", error: null, preview, durationMs: ms })
  } catch (e) {
    const ms = Date.now() - start
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`${RED} ${id} ${DIM}(${ms}ms)${RESET}`)
    console.log(`${DIM}   ${msg}${RESET}`)
    results.push({ id, category, status: "fail", error: msg, preview: "", durationMs: ms })
  }
}

function skip(id: string, category: string, reason: string) {
  console.log(`${YELLOW} ${id} ${DIM}— ${reason}${RESET}`)
  results.push({ id, category, status: "skip", error: reason, preview: "", durationMs: 0 })
}

function getAuth(): Auth | null {
  const { OKX_API_KEY: apiKey, OKX_SECRET_KEY: secret, OKX_PASSPHRASE: passphrase } = process.env
  if (!apiKey || !secret || !passphrase) return null
  return { apiKey, secret, passphrase, isDemo: process.env["OKX_IS_DEMO"] === "true" }
}

// ── OKX 公共行情 ──────────────────────────────────────────────────────────────

const CAT_MARKET     = "OKX 公共行情"
const CAT_PUBLIC     = "OKX 公共数据"
const CAT_STATS      = "OKX 交易大数据"
const CAT_ACCOUNT    = "OKX 交易账户"
const CAT_TRADING    = "OKX 撮合交易"
const CAT_ALGO       = "OKX 策略交易"
const CAT_FUNDING    = "OKX 资金账户"
const CAT_SUBACCOUNT = "OKX 子账户"
const CAT_FINANCE    = "OKX 金融产品"
const CAT_HRAILS     = "H Rails 预测市场"
const CAT_STATUS     = "OKX 系统状态"

console.log("\n── OKX 公共行情 ────────────────────────────────")
await test("okx_get_ticker",        CAT_MARKET, () => publicApi.getTicker("BTC-USDT"))
await test("okx_get_tickers",       CAT_MARKET, () => publicApi.getTickers("SPOT"))
await test("okx_get_orderbook",     CAT_MARKET, () => publicApi.getOrderbook("BTC-USDT", 5))
await test("okx_get_candles",       CAT_MARKET, () => publicApi.getCandles("BTC-USDT", "1H", 3))
await test("okx_get_trades",              CAT_MARKET, () => publicApi.getTrades("BTC-USDT", 5))
await test("okx_get_history_candles",     CAT_MARKET, () => publicApi.getHistoryCandles("BTC-USDT", "1H", undefined, undefined, 3))
await test("okx_get_history_trades",      CAT_MARKET, () => publicApi.getHistoryTrades("BTC-USDT", 5))

console.log("\n── OKX 系统状态 ────────────────────────────────")
await test("okx_get_system_status", CAT_STATUS, () => publicApi.getSystemStatus())

console.log("\n── OKX 公共数据 ────────────────────────────────")
await test("okx_get_system_time",   CAT_PUBLIC, () => publicApi.getSystemTime())
await test("okx_get_instruments",   CAT_PUBLIC, () => publicApi.getInstruments("SPOT", "BTC-USDT"))
await test("okx_get_funding_rate",  CAT_PUBLIC, () => publicApi.getFundingRate("BTC-USDT-SWAP"))
await test("okx_get_mark_price",    CAT_PUBLIC, () => publicApi.getMarkPrice("SWAP", "BTC-USDT-SWAP"))
await test("okx_get_index_price",   CAT_PUBLIC, () => publicApi.getIndexPrice("BTC-USDT"))
await test("okx_get_open_interest", CAT_PUBLIC, () => publicApi.getOpenInterest("SWAP", "BTC-USDT-SWAP"))

// ── OKX 私有接口 ──────────────────────────────────────────────────────────────

console.log("\n── OKX 交易大数据 ───────────────────────────────")
await test("okx_get_long_short_ratio",    CAT_STATS, () => publicApi.getLongShortRatio("BTC"))
await test("okx_get_taker_volume",        CAT_STATS, () => publicApi.getTakerVolume("BTC", "CONTRACTS"))
await test("okx_get_open_interest_volume",CAT_STATS, () => publicApi.getOpenInterestVolume("BTC"))
await test("okx_get_margin_lending_ratio",CAT_STATS, () => publicApi.getLendingRateHistory("BTC"))

console.log("\n── OKX 交易账户 ────────────────────────────────")
const auth = getAuth()
if (auth) {
  await test("okx_get_balance",        CAT_ACCOUNT, () => privateApi.getBalance(auth, "USDT"))
  await test("okx_get_positions",      CAT_ACCOUNT, () => privateApi.getPositions(auth))
  await test("okx_get_order_history",  CAT_ACCOUNT, () => privateApi.getOrdersHistory(auth, "SPOT", 5))
  await test("okx_get_account_bills",  CAT_ACCOUNT, () => privateApi.getAccountBills(auth, undefined, undefined, 5))
  await test("okx_get_account_config", CAT_ACCOUNT, () => privateApi.getAccountConfig(auth))
  await test("okx_get_leverage_info",  CAT_ACCOUNT, () => privateApi.getLeverageInfo(auth, "BTC-USDT-SWAP", "cross"))
} else {
  skip("okx_get_balance",        CAT_ACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_get_positions",      CAT_ACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_get_order_history",  CAT_ACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_get_account_bills",  CAT_ACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_get_account_config", CAT_ACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_get_leverage_info",  CAT_ACCOUNT, "未配置 OKX_API_KEY")
}

console.log("\n── OKX 撮合交易 ────────────────────────────────")
if (auth) {
  await test("okx_get_orders_pending",          CAT_TRADING, () => privateApi.getOrdersPending(auth))
  await test("okx_get_fills",                   CAT_TRADING, () => privateApi.getFills(auth, "SPOT", undefined, 5))
  await test("okx_get_orders_history_archive",  CAT_TRADING, () => privateApi.getOrdersHistoryArchive(auth, "SPOT", 5))
  skip("okx_place_order",  CAT_TRADING, "写操作，需人工确认后测试")
  skip("okx_cancel_order", CAT_TRADING, "写操作，需人工确认后测试")
  skip("okx_amend_order",  CAT_TRADING, "写操作，需人工确认后测试")
} else {
  skip("okx_get_orders_pending",         CAT_TRADING, "未配置 OKX_API_KEY")
  skip("okx_get_fills",                  CAT_TRADING, "未配置 OKX_API_KEY")
  skip("okx_get_orders_history_archive", CAT_TRADING, "未配置 OKX_API_KEY")
  skip("okx_place_order",  CAT_TRADING, "未配置 OKX_API_KEY")
  skip("okx_cancel_order", CAT_TRADING, "未配置 OKX_API_KEY")
  skip("okx_amend_order",  CAT_TRADING, "未配置 OKX_API_KEY")
}

console.log("\n── OKX 资金账户 ────────────────────────────────")
if (auth) {
  await test("okx_get_funding_balance",  CAT_FUNDING, () => privateApi.getBalance_funding(auth, "USDT"))
  await test("okx_get_currencies",       CAT_FUNDING, () => privateApi.getCurrencies(auth, "USDT"))
  await test("okx_get_deposit_address",  CAT_FUNDING, () => privateApi.getDepositAddress(auth, "USDT"))
  await test("okx_get_deposit_history",  CAT_FUNDING, () => privateApi.getDepositHistory(auth, undefined, 5))
  await test("okx_get_withdrawal_history", CAT_FUNDING, () => privateApi.getWithdrawalHistory(auth, undefined, 5))
  skip("okx_transfer", CAT_FUNDING, "写操作，需人工确认后测试")
} else {
  skip("okx_get_funding_balance",    CAT_FUNDING, "未配置 OKX_API_KEY")
  skip("okx_get_currencies",         CAT_FUNDING, "未配置 OKX_API_KEY")
  skip("okx_get_deposit_address",    CAT_FUNDING, "未配置 OKX_API_KEY")
  skip("okx_get_deposit_history",    CAT_FUNDING, "未配置 OKX_API_KEY")
  skip("okx_get_withdrawal_history", CAT_FUNDING, "未配置 OKX_API_KEY")
  skip("okx_transfer",               CAT_FUNDING, "未配置 OKX_API_KEY")
}

console.log("\n── OKX 策略交易 ────────────────────────────────")
if (auth) {
  await test("okx_get_algo_orders",         CAT_ALGO, () => privateApi.getAlgoOrders(auth, "conditional"))
  await test("okx_get_algo_orders_history", CAT_ALGO, () => privateApi.getAlgoOrdersHistory(auth, "conditional", "effective"))
  skip("okx_place_algo_order",  CAT_ALGO, "写操作，需人工确认后测试")
  skip("okx_cancel_algo_order", CAT_ALGO, "写操作，需人工确认后测试")
} else {
  skip("okx_get_algo_orders",         CAT_ALGO, "未配置 OKX_API_KEY")
  skip("okx_get_algo_orders_history", CAT_ALGO, "未配置 OKX_API_KEY")
  skip("okx_place_algo_order",        CAT_ALGO, "未配置 OKX_API_KEY")
  skip("okx_cancel_algo_order",       CAT_ALGO, "未配置 OKX_API_KEY")
}

console.log("\n── OKX 子账户 ──────────────────────────────────")
if (auth) {
  await test("okx_list_subaccounts",       CAT_SUBACCOUNT, () => privateApi.listSubAccounts(auth))
  skip("okx_get_subaccount_balance", CAT_SUBACCOUNT, "需要有效子账户名称，跳过避免参数错误")
  skip("okx_transfer_subaccount",    CAT_SUBACCOUNT, "写操作，需人工确认后测试")
} else {
  skip("okx_list_subaccounts",       CAT_SUBACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_get_subaccount_balance", CAT_SUBACCOUNT, "未配置 OKX_API_KEY")
  skip("okx_transfer_subaccount",    CAT_SUBACCOUNT, "未配置 OKX_API_KEY")
}

console.log("\n── OKX 金融产品 ────────────────────────────────")
if (auth) {
  await test("okx_get_savings_balance", CAT_FINANCE, () => privateApi.getSavingsBalance(auth))
  await test("okx_get_savings_history", CAT_FINANCE, () => privateApi.getSavingsLendingHistory(auth))
  await test("okx_get_staking_offers",  CAT_FINANCE, () => privateApi.getStakingOffers(auth))
} else {
  skip("okx_get_savings_balance", CAT_FINANCE, "未配置 OKX_API_KEY")
  skip("okx_get_savings_history", CAT_FINANCE, "未配置 OKX_API_KEY")
  skip("okx_get_staking_offers",  CAT_FINANCE, "未配置 OKX_API_KEY")
}

// ── H Rails 预测市场 ──────────────────────────────────────────────────────────

console.log("\n── H Rails 预测市场 ─────────────────────────────")
const hrailsKey = process.env["HRAILS_API_KEY"]
if (hrailsKey) {
  const hr = createHRailsClient(hrailsKey, process.env["HRAILS_BASE_URL"])
  await test("hrails_health",      CAT_HRAILS, () => hr.health())
  await test("hrails_list_events", CAT_HRAILS, () => hr.listEvents({ pageSize: 3 }))

  try {
    const res = await hr.listEvents({ pageSize: 1, includeMarkets: true }) as {
      items?: Array<{ eventId: string; markets?: Array<{ marketId: string }> }>
    }
    const event    = res.items?.[0]
    const eventId  = event?.eventId
    const marketId = event?.markets?.[0]?.marketId

    if (eventId)  await test("hrails_get_event",      CAT_HRAILS, () => hr.getEvent(eventId))
    if (marketId) {
      await test("hrails_get_market",     CAT_HRAILS, () => hr.getMarket(marketId))
      await test("hrails_get_ticker_YES", CAT_HRAILS, () => hr.getTicker(marketId, "YES"))
      await test("hrails_get_ticker_NO",  CAT_HRAILS, () => hr.getTicker(marketId, "NO"))
      await test("hrails_get_orderbook",  CAT_HRAILS, () => hr.getOrderbook(marketId, "YES", 5))
      await test("hrails_get_candles",    CAT_HRAILS, () => hr.getCandles(marketId, "YES", "1H", 3))
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    results.push({ id: "hrails_cascade", category: CAT_HRAILS, status: "fail", error: msg, preview: "", durationMs: 0 })
  }
} else {
  ["hrails_health","hrails_list_events","hrails_get_event","hrails_get_market",
   "hrails_get_ticker_YES","hrails_get_ticker_NO","hrails_get_orderbook","hrails_get_candles"]
    .forEach(id => skip(id, CAT_HRAILS, "未配置 HRAILS_API_KEY"))
}

// ── 写入 status.json ──────────────────────────────────────────────────────────

const passed = results.filter(r => r.status === "pass").length
const failed = results.filter(r => r.status === "fail").length
const skipped = results.filter(r => r.status === "skip").length

const statusJson = {
  lastRun: new Date().toISOString(),
  summary: { passed, failed, skipped, total: results.length },
  results,
}

const docsDir = path.resolve(import.meta.dirname ?? ".", "../docs")
fs.mkdirSync(docsDir, { recursive: true })
fs.writeFileSync(path.join(docsDir, "status.json"), JSON.stringify(statusJson, null, 2))
fs.writeFileSync(path.join(docsDir, "status-data.js"), `window.__STATUS__ = ${JSON.stringify(statusJson, null, 2)};`)

// ── 汇总 ──────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`)
console.log(`✅ 通过 ${passed}  ❌ 失败 ${failed}  ⏭ 跳过 ${skipped}`)
console.log(`📄 结果已写入 docs/status.json`)

if (failed > 0) process.exit(1)
