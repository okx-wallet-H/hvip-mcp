import crypto from "node:crypto"

const BASE = "https://www.okx.com"

function sign(ts: string, method: string, path: string, body: string, secret: string): string {
  const msg = ts + method + path + body
  return crypto.createHmac("sha256", secret).update(msg).digest("base64")
}

function timestamp(): string {
  return new Date().toISOString().replace(/(\.\d{3})\d*Z/, "$1Z")
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.append(k, String(v))
  }
  return p.size ? "?" + p.toString() : ""
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  options: {
    params?: Record<string, string | number | boolean | undefined>
    body?: unknown
    auth?: { apiKey: string; secret: string; passphrase: string; isDemo?: boolean }
  } = {}
): Promise<T> {
  const query = options.params ? buildQuery(options.params) : ""
  const fullPath = path + query
  const bodyStr = options.body ? JSON.stringify(options.body) : ""

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  }

  if (options.auth) {
    const ts = timestamp()
    headers["OK-ACCESS-KEY"] = options.auth.apiKey
    headers["OK-ACCESS-SIGN"] = sign(ts, method, fullPath, bodyStr, options.auth.secret)
    headers["OK-ACCESS-TIMESTAMP"] = ts
    headers["OK-ACCESS-PASSPHRASE"] = options.auth.passphrase
    if (options.auth.isDemo) headers["x-simulated-trading"] = "1"
  }

  const res = await fetch(BASE + fullPath, {
    method,
    headers,
    ...(bodyStr ? { body: bodyStr } : {}),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const json = await res.json() as { code: string; msg?: string; data?: T }
  if (json.code !== "0") throw new Error(`OKX ${json.code}: ${json.msg ?? "unknown error"}`)

  return (json.data ?? json) as T
}

// ── 公共接口 ─────────────────────────────────────────────────────────────────

export const publicApi = {
  getInstruments: (instType: string, instId?: string) =>
    request<unknown[]>("GET", "/api/v5/public/instruments", { params: { instType, instId } }),

  getTicker: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/market/ticker", { params: { instId } }),

  getTickers: (instType: string) =>
    request<unknown[]>("GET", "/api/v5/market/tickers", { params: { instType } }),

  getOrderbook: (instId: string, sz?: number) =>
    request<unknown[]>("GET", "/api/v5/market/books", { params: { instId, sz } }),

  getCandles: (instId: string, bar?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/market/candles", { params: { instId, bar, limit } }),

  getTrades: (instId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/market/trades", { params: { instId, limit } }),

  getFundingRate: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/public/funding-rate", { params: { instId } }),

  getMarkPrice: (instType: string, instId?: string) =>
    request<unknown[]>("GET", "/api/v5/public/mark-price", { params: { instType, instId } }),

  getIndexPrice: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/market/index-tickers", { params: { instId } }),

  getBooksFull: (instId: string, sz?: number) =>
    request<unknown[]>("GET", "/api/v5/market/books-full", { params: { instId, sz } }),

  getIndexTickers: (quoteCcy?: string, instId?: string) =>
    request<unknown[]>("GET", "/api/v5/market/index-tickers", { params: { quoteCcy, instId } }),

  getIndexCandles: (instId: string, bar?: string, after?: string, before?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/market/index-candles", { params: { instId, bar, after, before, limit } }),

  getOpenInterest: (instType: string, instId?: string) =>
    request<unknown[]>("GET", "/api/v5/public/open-interest", { params: { instType, instId } }),

  getSystemTime: () =>
    request<unknown[]>("GET", "/api/v5/public/time"),

  // ── 交易大数据（公共，无需鉴权） ─────────────────────────────────────────────

  getLongShortRatio: (ccy: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/contracts/long-short-account-ratio", { params: { ccy, begin, end } }),

  getTakerVolume: (ccy: string, instType: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/taker-volume", { params: { ccy, instType, begin, end } }),

  getOpenInterestVolume: (ccy: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/contracts/open-interest-volume", { params: { ccy, begin, end } }),

  getOpenInterestHistory: (instId: string, period?: string, limit?: string) =>
    request<unknown[][]>("GET", "/api/v5/rubik/stat/contracts/open-interest-history", { params: { instId, period, limit } }),

  getLendingRateHistory: (ccy: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/margin/loan-ratio", { params: { ccy } }),

  getHistoryCandles: (instId: string, bar?: string, after?: string, before?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/market/history-candles", { params: { instId, bar, after, before, limit } }),

  getHistoryTrades: (instId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/market/history-trades", { params: { instId, limit } }),

  getSystemStatus: () =>
    request<unknown[]>("GET", "/api/v5/system/status"),

  getPriceLimitBatch: (instType: string, uly?: string, instId?: string) =>
    request<unknown[]>("GET", "/api/v5/public/price-limit", { params: { instType, uly, instId } }),

  getPositionTiers: (instType: string, tdMode: string, instFamily?: string, uly?: string) =>
    request<unknown[]>("GET", "/api/v5/public/position-tiers", { params: { instType, tdMode, instFamily, uly } }),

  getOptSummary: (uly: string, expTime?: string) =>
    request<unknown[]>("GET", "/api/v5/public/opt-summary", { params: { uly, expTime } }),

  getInsuranceFund: (instType: string, uly?: string) =>
    request<unknown[]>("GET", "/api/v5/public/insurance-fund", { params: { instType, uly } }),

  convertContractCoin: (instId: string, sz: string, unit: string, opType: string) =>
    request<unknown[]>("GET", "/api/v5/public/convert-contract-coin", { params: { instId, sz, unit, opType } }),

  getSupportCoin: () =>
    request<unknown>("GET", "/api/v5/rubik/stat/trading-data/support-coin"),

  getTopTraderLongShortRatio: (instId: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader", { params: { instId, begin, end } }),

  getOptionPutCallRatio: (ccy: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/option/open-interest-volume-ratio", { params: { ccy, begin, end } }),

  getLendingRateSummary: (ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/finance/savings/lending-rate-summary", { params: { ccy } }),

  // ── 跟单（公共，需带单员uniqueCode） ─────────────────────────────────────────
  getLeadTraderPositions: (uniqueCode: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-current-subpositions", { params: { uniqueCode, instType } }),

  getLeadTraderHistory: (uniqueCode: string, instType?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-subpositions-history", { params: { uniqueCode, instType, limit } }),

  getLeadTraderStats: (uniqueCode: string, instType: string, lastDays: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-stats", { params: { uniqueCode, instType, lastDays } }),

  // ── 网格交易机器人（公共） ────────────────────────────────────────────────────
  getGridAiParam: (instId: string, algoOrdType: string, direction?: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/grid/ai-param", { params: { instId, algoOrdType, direction } }),

  // ── 大宗交易行情（公共） ─────────────────────────────────────────────────────
  getBlockTickers: (instType: string) =>
    request<unknown[]>("GET", "/api/v5/market/block-tickers", { params: { instType } }),

  // ── 价差交易（公共） ──────────────────────────────────────────────────────────
  getSpreads: (sprdId?: string, baseCcy?: string, instId?: string, state?: string) =>
    request<unknown[]>("GET", "/api/v5/sprd/spreads", { params: { sprdId, baseCcy, instId, state } }),

  getSpreadTicker: (sprdId: string) =>
    request<unknown[]>("GET", "/api/v5/sprd/ticker", { params: { sprdId } }),

  getSpreadOrderbook: (sprdId: string, sz?: number) =>
    request<unknown[]>("GET", "/api/v5/sprd/books", { params: { sprdId, sz } }),

  getSpreadTrades: (sprdId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/sprd/trades", { params: { sprdId, limit } }),

  getSpreadCandles: (sprdId: string, bar?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/sprd/candles", { params: { sprdId, bar, limit } }),

  // ── 公告（公共） ──────────────────────────────────────────────────────────────
  getAnnouncements: (annType?: string, lang?: string) =>
    request<unknown>("GET", "/api/v5/support/announcements", { params: { annType, lang } }),

  getAnnouncementTypes: () =>
    request<unknown[]>("GET", "/api/v5/support/announcement-types"),

  getUnderlying: (instType?: string) =>
    request<unknown[]>("GET", "/api/v5/public/underlying", { params: { instType } }),

  getTakerFlow: (ccy: string, instType?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/taker-flow", { params: { ccy, instType, begin, end } }),

  getTopTradersContractLSRatio: (ccy?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/top-traders-contract-ls-ratio", { params: { ccy, begin, end } }),

  getContractsTakerVolume: (ccy?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/contracts-taker-volume", { params: { ccy, begin, end } }),

  getContractsLongShortRatio: (ccy?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/long-short-ratio", { params: { ccy, begin, end } }),

  // ── 公共数据（第三批新增） ──────────────────────────────────────────────────
  getPlatform24Volume: () =>
    request<unknown[]>("GET", "/api/v5/market/platform-24-volume"),

  getCallAuctionDetails: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/market/call-auction-details", { params: { instId } }),

  getOptionInstrumentFamilyTrades: (instFamily: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/market/option/instrument-family-trades", { params: { instFamily, limit } }),

  getOptionTrades: (instFamily?: string, instId?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/public/option-trades", { params: { instFamily, instId, limit } }),

  getExchangeRate: () =>
    request<unknown[]>("GET", "/api/v5/market/exchange-rate"),

  getIndexComponents: (index: string) =>
    request<unknown>("GET", "/api/v5/market/index-components", { params: { index } }),

  getEstimatedPrice: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/public/estimated-price", { params: { instId } }),

  getDiscountRateInterestFreeQuota: () =>
    request<unknown[]>("GET", "/api/v5/public/discount-rate-interest-free-quota"),

  getOptionOiExpiry: (ccy: string) =>
    request<unknown[][]>("GET", "/api/v5/rubik/stat/option/open-interest-volume-expiry", { params: { ccy } }),

  getOptionOiStrike: (ccy: string, expTime: string) =>
    request<unknown[][]>("GET", "/api/v5/rubik/stat/option/open-interest-volume-strike", { params: { ccy, expTime } }),

  getOptionOpenInterestVolume: (ccy: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/option/open-interest-volume", { params: { ccy } }),

}
// ── 私有接口（需鉴权） ────────────────────────────────────────────────────────

export type Auth = { apiKey: string; secret: string; passphrase: string; isDemo?: boolean }

export const privateApi = {
  getBalance: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/account/balance", { params: { ccy }, auth }),

  getPositions: (auth: Auth, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/account/positions", { params: { instType }, auth }),

  getOrder: (auth: Auth, instId: string, ordId: string) =>
    request<unknown[]>("GET", "/api/v5/trade/order", { params: { instId, ordId }, auth }),

  getOrdersHistory: (auth: Auth, instType: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/trade/orders-history", { params: { instType, limit }, auth }),

  placeOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/order", { body, auth }),

  cancelOrder: (auth: Auth, instId: string, ordId: string) =>
    request<unknown[]>("POST", "/api/v5/trade/cancel-order", { body: { instId, ordId }, auth }),

  amendOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/amend-order", { body, auth }),

  getBalance_funding: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/asset/balances", { params: { ccy }, auth }),

  transfer: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/asset/transfer", { body, auth }),

  withdrawal: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/asset/withdrawal", { body, auth }),

  // ── 策略交易 ────────────────────────────────────────────────────────────────

  getAccountBills: (auth: Auth, instType?: string, ccy?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/account/bills", { params: { instType, ccy, limit }, auth }),

  getAccountConfig: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/config", { auth }),

  getLeverageInfo: (auth: Auth, instId: string, mgnMode: string) =>
    request<unknown[]>("GET", "/api/v5/account/leverage-info", { params: { instId, mgnMode }, auth }),

  getMaxSize: (auth: Auth, instId: string, tdMode: string, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/account/max-size", { params: { instId, tdMode, ccy }, auth }),

  getFeeRates: (auth: Auth, instType?: string, instId?: string, uly?: string) =>
    request<unknown[]>("GET", "/api/v5/account/trade-fee", { params: { instType, instId, uly }, auth }),

  getPositionsHistory: (auth: Auth, instType?: string, instId?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/account/positions-history", { params: { instType, instId, limit }, auth }),

  setLeverage: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-leverage", { body, auth }),

  batchOrders: (auth: Auth, body: Record<string, unknown>[]) =>
    request<unknown[]>("POST", "/api/v5/trade/batch-orders", { body, auth }),

  cancelBatchOrders: (auth: Auth, body: Record<string, unknown>[]) =>
    request<unknown[]>("POST", "/api/v5/trade/cancel-batch-orders", { body, auth }),

  closePosition: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/close-position", { body, auth }),

  amendBatchOrders: (auth: Auth, body: Record<string, unknown>[]) =>
    request<unknown[]>("POST", "/api/v5/trade/amend-batch-orders", { body, auth }),

  getFillsHistory: (auth: Auth, instType?: string, instId?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/trade/fills-history", { params: { instType, instId, limit }, auth }),

  massCancel: (auth: Auth, instType: string, instFamily?: string) =>
    request<unknown[]>("POST", "/api/v5/trade/mass-cancel", { body: { instType, instFamily }, auth }),

  getMaxLoan: (auth: Auth, instId: string, mgnMode: string) =>
    request<unknown[]>("GET", "/api/v5/account/max-loan", { params: { instId, mgnMode }, auth }),

  getInterestAccrued: (auth: Auth, instId?: string, ccy?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/account/interest-accrued", { params: { instId, ccy, limit }, auth }),

  getMarginBalance: (auth: Auth, instId: string, mgnMode: string) =>
    request<unknown[]>("GET", "/api/v5/account/margin-balance", { params: { instId, mgnMode }, auth }),

  getOrdersPending: (auth: Auth, instType?: string, instId?: string, ordType?: string) =>
    request<unknown[]>("GET", "/api/v5/trade/orders-pending", { params: { instType, instId, ordType }, auth }),

  getFills: (auth: Auth, instType?: string, instId?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/trade/fills", { params: { instType, instId, limit }, auth }),

  getOrdersHistoryArchive: (auth: Auth, instType: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/trade/orders-history-archive", { params: { instType, limit }, auth }),

  getCurrencies: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/asset/currencies", { params: { ccy }, auth }),

  getDepositAddress: (auth: Auth, ccy: string) =>
    request<unknown[]>("GET", "/api/v5/asset/deposit-address", { params: { ccy }, auth }),

  getDepositHistory: (auth: Auth, ccy?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/asset/deposit-history", { params: { ccy, limit }, auth }),

  getWithdrawalHistory: (auth: Auth, ccy?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/asset/withdrawal-history", { params: { ccy, limit }, auth }),

  getEthStakingBalance: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/eth/balance", { auth }),

  getEthStakingHistory: (auth: Auth, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/eth/purchase-redeem-history", { params: { limit }, auth }),

  getSolStakingBalance: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/sol/balance", { auth }),

  // ── 质押操作（第七批新增） ─────────────────────────────────────────────────
  getStakingOrders: (auth: Auth, productId?: string, state?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/orders", { params: { productId, state, limit }, auth }),

  purchaseEthStaking: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/staking-defi/eth/purchase", { body, auth }),

  redeemEthStaking: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/staking-defi/eth/redeem", { body, auth }),

  getSolStakingHistory: (auth: Auth, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/sol/history", { params: { limit }, auth }),

  // ── 跟单（私有） ─────────────────────────────────────────────────────────────
  getMyLeadPositions: (auth: Auth, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/current-subpositions", { params: { instType }, auth }),

  getMyLeadHistory: (auth: Auth, instType?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/copytrading/subpositions-history", { params: { instType, limit }, auth }),

  getCopyInstruments: (auth: Auth, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/instruments", { params: { instType }, auth }),

  getProfitSharingTotal: (auth: Auth, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/total-profit-sharing", { params: { instType }, auth }),

  getProfitSharingDetails: (auth: Auth, instType?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/copytrading/profit-sharing-details", { params: { instType, limit }, auth }),

  // ── 网格交易机器人（私有） ────────────────────────────────────────────────────
  getGridOrdersPending: (auth: Auth, algoOrdType: string, instId?: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/grid/orders-algo-pending", { params: { algoOrdType, instId, instType }, auth }),

  getGridOrdersHistory: (auth: Auth, algoOrdType: string, instId?: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/grid/orders-algo-history", { params: { algoOrdType, instId, instType }, auth }),

  getGridSubOrders: (auth: Auth, algoId: string, algoOrdType: string, type: string, groupId?: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/grid/sub-orders", { params: { algoId, algoOrdType, type, groupId }, auth }),

  // ── 定投机器人（私有） ────────────────────────────────────────────────────────
  getRecurringOrdersPending: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/recurring/orders-algo-pending", { auth }),

  getRecurringOrdersHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/recurring/orders-algo-history", { auth }),

  getAlgoOrders: (auth: Auth, ordType: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/trade/orders-algo-pending", { params: { ordType, instType }, auth }),

  getAlgoOrdersHistory: (auth: Auth, ordType: string, state: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/trade/orders-algo-history", { params: { ordType, state, instType }, auth }),

  placeAlgoOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/order-algo", { body, auth }),

  cancelAlgoOrder: (auth: Auth, body: Record<string, unknown>[]) =>
    request<unknown[]>("POST", "/api/v5/trade/cancel-algos", { body, auth }),

  amendAlgoOrder: (auth: Auth, body: Record<string, unknown>[]) =>
    request<unknown[]>("POST", "/api/v5/trade/amend-algos", { body, auth }),

  getOrdersAlgoPending: (auth: Auth, algoId?: string, instType?: string, instId?: string, ordType?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/trade/orders-algo-pending", { params: { algoId, instType, instId, ordType, limit }, auth }),

  // ── 子账户 ──────────────────────────────────────────────────────────────────

  listSubAccounts: (auth: Auth, enable?: boolean) =>
    request<unknown[]>("GET", "/api/v5/users/subaccount/list", { params: { enable }, auth }),

  getSubAccountBalance: (auth: Auth, subAcct: string) =>
    request<unknown[]>("GET", "/api/v5/account/subaccount/balances", { params: { subAcct }, auth }),

  transferSubAccount: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/asset/subaccount/transfer", { body, auth }),

  // ── 金融产品 ─────────────────────────────────────────────────────────────────

  getSavingsBalance: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/finance/savings/balance", { params: { ccy }, auth }),

  getSavingsLendingHistory: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/finance/savings/lending-history", { params: { ccy }, auth }),

  getStakingOffers: (auth: Auth, productId?: string) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/offers", { params: { productId }, auth }),

  getEarnOffers: (ccy?: string, productId?: string) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/eth/balance", { params: { ccy, productId } }),

  // ── 信号交易（私有） ──────────────────────────────────────────────────────────

  getSignalBotsPending: (auth: Auth, algoId?: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/orders-algo-pending", { params: { algoOrdType: "contract", algoId, instType }, auth }),

  getSignalBotsHistory: (auth: Auth, algoId?: string, instType?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/orders-algo-history", { params: { algoOrdType: "contract", algoId, instType, limit }, auth }),

  getSignalPositions: (auth: Auth, algoId: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/positions", { params: { algoId }, auth }),

  getSignalPositionsHistory: (auth: Auth, algoId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/positions-history", { params: { algoOrdType: "contract", algoId, limit }, auth }),

  getSignalSubOrders: (auth: Auth, algoId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/sub-orders", { params: { algoOrdType: "contract", algoId, limit }, auth }),

  getSignalEventHistory: (auth: Auth, algoId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/event-histories", { params: { algoId, limit }, auth }),

  // ── 交易扩展 ──────────────────────────────────────────────────────────────────

  cancelAllAfter: (auth: Auth, body: { timeOut: string }) =>
    request<unknown[]>("POST", "/api/v5/trade/cancel-all-after", { body, auth }),

  orderPrecheck: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/order-precheck", { body, auth }),

  getAccountRateLimit: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/trade/account-rate-limit", { auth }),

  easyConvert: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/easy-convert", { body, auth }),

  getEasyConvertHistory: (auth: Auth, after?: string, before?: string, limit?: string) =>
    request<unknown[]>("GET", "/api/v5/trade/easy-convert-history", { params: { after, before, limit }, auth }),

  // ── 公开数据（从public移入，实需鉴权） ─────────────────────────────────
  getEconomicCalendar: (auth: Auth, begin?: string, end?: string, limit?: string) =>
    request<unknown[]>("GET", "/api/v5/public/economic-calendar", { params: { begin, end, limit }, auth }),

  // ── 子账户（第六批新增） ──────────────────────────────────────────────────
  getSubAccountApiKey: (auth: Auth, subAcct: string) =>
    request<unknown[]>("GET", "/api/v5/users/subaccount/apikey", { params: { subAcct }, auth }),

  createSubAccountApiKey: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/users/subaccount/apikey", { body, auth }),

  modifySubAccountApiKey: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/users/subaccount/modify-apikey", { body, auth }),

  deleteSubAccountApiKey: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/users/subaccount/delete-apikey", { body, auth }),

  getSubAccountBills: (auth: Auth, subAcct: string, after?: string, before?: string, limit?: string) =>
    request<unknown[]>("GET", "/api/v5/asset/subaccount/bills", { params: { subAcct, after, before, limit }, auth }),

  // ── 账户+资金（第四批新增） ──────────────────────────────────────────────────
  setPositionMode: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-position-mode", { body, auth }),

  getAssetValuation: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/asset/asset-valuation", { params: { ccy }, auth }),

  getConvertCurrencies: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/asset/convert/currencies", { auth }),

  convertTrade: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/asset/convert/trade", { body, auth }),

  getSubAccountFundingBalance: (auth: Auth, subAcct: string) =>
    request<unknown[]>("GET", "/api/v5/asset/subaccount/balances", { params: { subAcct }, auth }),

  setSubAccountTransferOut: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/users/subaccount/set-transfer-out", { body, auth }),

  // ── 资金账户补完（第九批新增） ──────────────────────────────────────────
  getInterestRate: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/account/interest-rate", { params: { ccy }, auth }),

  getMaxWithdrawal: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/account/max-withdrawal", { params: { ccy }, auth }),

  getAccountGreeks: (auth: Auth, instType?: string, instFamily?: string, uly?: string, instId?: string) =>
    request<unknown[]>("GET", "/api/v5/account/greeks", { params: { instType, instFamily, uly, instId }, auth }),

  setAccountLevel: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-account-level", { body, auth }),

  // ── 跟单操作（第十批新增） ──────────────────────────────────────────────
  setCopySettings: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/copy-settings", { body, auth }),

  closeSubposition: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/close-subposition", { body, auth }),

  getCopySettings: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/copytrading/copy-settings", { auth }),

  updateCopySettings: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/set-copy-settings", { body, auth }),

  // ── 定投操作（第十一批新增） ────────────────────────────────────────────
  createRecurringPlan: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/recurring/order-algo", { body, auth }),

  stopRecurringPlan: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/recurring/stop-order-algo", { body, auth }),

  getRecurringSubOrders: (auth: Auth, algoId: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/recurring/sub-orders", { params: { algoId, limit }, auth }),

  // ── 大宗交易（第十二批新增） ────────────────────────────────────────────
  createRfq: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/create-rfq", { body, auth }),

  executeRfqQuote: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/execute-quote", { body, auth }),

  getRfqs: (auth: Auth, state?: string) =>
    request<unknown[]>("GET", "/api/v5/rfq/rfqs", { params: { state }, auth }),

  getRfqQuotes: (auth: Auth, rfqId: string) =>
    request<unknown[]>("GET", "/api/v5/rfq/quotes", { params: { rfqId }, auth }),

  // ── 交易收尾（第十三批新增） ──────────────────────────────────────────
  getMmpConfig: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/mmp-config", { auth }),

  setMmpConfig: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/mmp-config", { body, auth }),

  getOrderAlgo: (auth: Auth, algoId?: string) =>
    request<unknown[]>("GET", "/api/v5/trade/order-algo", { params: { algoId }, auth }),

  // ── 网格操作（第十四批新增） ──────────────────────────────────────────
  createGridAlgo: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/grid/order-algo", { body, auth }),

  stopGridAlgo: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/grid/stop-order-algo", { body, auth }),

  closeGridPosition: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/grid/close-position", { body, auth }),

  getGridPositions: (auth: Auth, algoId: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/grid/positions", { params: { algoId }, auth }),

  // ── 信号操作（第十五批新增 — 路径经 curl 修正） ─────────────────────────────────
  createSignal: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/signal/create-signal", { body, auth }),

  stopSignal: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/tradingBot/signal/stop-order-algo", { body, auth }),

  getSignalOrdersDetail: (auth: Auth, algoId: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/orders-algo-details", { params: { algoId, algoOrdType: "contract" }, auth }),

  getSignalSubscriptions: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/signal/signals", { auth }),

  // ── 价差操作（第十六批新增） ──────────────────────────────────────────
  placeSpreadOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/sprd/order", { body, auth }),

  cancelSpreadOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/sprd/cancel-order", { body, auth }),

  getSpreadOrdersPending: (auth: Auth, sprdId?: string) =>
    request<unknown[]>("GET", "/api/v5/sprd/orders-pending", { params: { sprdId }, auth }),

  // ── 资金收尾（第十七批新增） ──────────────────────────────────────────
  getDepositLightning: (auth: Auth, ccy: string) =>
    request<unknown[]>("GET", "/api/v5/asset/deposit-lightning", { params: { ccy }, auth }),

  withdrawalLightning: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/asset/withdrawal-lightning", { body, auth }),

  getTransferState: (auth: Auth, transferId: string) =>
    request<unknown[]>("GET", "/api/v5/asset/transfer-state", { params: { transferId }, auth }),

  // ── 第二批价差操作 ────────────────────────────────────────────────────────
  amendSpreadOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/sprd/amend-order", { body, auth }),

  getSpreadOrdersHistory: (auth: Auth, sprdId?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/sprd/orders-history", { params: { sprdId, limit }, auth }),

  getSpreadFills: (auth: Auth, sprdId?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/sprd/fills", { params: { sprdId, limit }, auth }),

  // ── 第三批交易收尾 ─────────────────────────────────────────────────────────
  resetMmp: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/mmp-reset", { body, auth }),

  // ── NEW: sprd affiliate ──
  getOrderByClientId: (auth: Auth, instId: string, clOrdId: string) =>
    request<unknown[]>("GET", "/api/v5/trade/order", { params: { instId, clOrdId }, auth }),
  // ── 价差收尾（第一批新缺口） ──────────────────────────────────────────
  getSpreadOrdersHistoryArchive: (auth: Auth, sprdId?: string) =>
    request<unknown[]>("GET", "/api/v5/sprd/orders-history-archive", { params: { sprdId }, auth }),

  getSpreadPublicTrades: (sprdId: string) =>
    request<unknown[]>("GET", "/api/v5/sprd/public-trades", { params: { sprdId } }),

  getSpreadTradeFills: (auth: Auth, sprdId?: string) =>
    request<unknown[]>("GET", "/api/v5/sprd/trades", { params: { sprdId }, auth }),

  // ── 子账户+推广（第三批新缺口） ──────────────────────────────────────
  createSubAccount: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/users/subaccount/create-subaccount", { body, auth }),

  getEntrustSubAccountList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/users/entrust-subaccount-list", { auth }),

  getAffiliateInviteeList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/affiliate/invitee/list", { auth }),

  getAffiliateInviteeDetail: (auth: Auth, uid?: string) =>
    request<unknown[]>("GET", "/api/v5/affiliate/invitee/detail", { params: { uid }, auth }),

  getAffiliateLinkList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/affiliate/link/list", { auth }),

  getAffiliatePerformance: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/affiliate/performance/summary", { auth }),

  getAffiliateCoInviterList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/affiliate/co-inviter/list", { auth }),

  getAffiliateSubAffiliateList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/affiliate/sub-affiliate/list", { auth }),
  // ── 新增批：market ────────────────────────────────────────────────────
  getBlockTicker: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/market/block-ticker", { params: { instId } }),

  getHistoryIndexCandles: (instId: string, bar?: string, after?: string, before?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/market/history-index-candles", { params: { instId, bar, after, before, limit } }),

  getHistoryMarkPriceCandles: (instId: string, bar?: string, after?: string, before?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/market/history-mark-price-candles", { params: { instId, bar, after, before, limit } }),

  getMarkPriceCandles: (instId: string, bar?: string, after?: string, before?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/market/mark-price-candles", { params: { instId, bar, after, before, limit } }),

  getSpreadHistoryCandles: (sprdId: string, bar?: string, after?: string, before?: string, limit?: number) =>
    request<unknown[][]>("GET", "/api/v5/sprd/history-candles", { params: { sprdId, bar, after, before, limit } }),

  // ── 新增批：trade ─────────────────────────────────────────────────────
  getOneClickRepayCurrencyList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/trade/one-click-repay-currency-list", { auth }),

  oneClickRepay: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/trade/one-click-repay", { body, auth }),

  getOneClickRepayHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/trade/one-click-repay-history", { auth }),

  // ── 新增批：asset ─────────────────────────────────────────────────────
  getNonTradableAssets: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/asset/non-tradable-assets", { auth }),

  getExchangeList: () =>
    request<unknown[]>("GET", "/api/v5/asset/exchange-list"),

  getDepositWithdrawStatus: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/asset/deposit-withdraw-status", { auth }),

  getMonthlyStatement: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/asset/monthly-statement", { auth }),

  getAssetBillsHistory: (auth: Auth, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/asset/bills-history", { params: { limit }, auth }),

  getConvertCurrencyPair: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/asset/convert/currency-pair", { auth }),

  getConvertEstimateQuote: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/asset/convert/estimate-quote", { body, auth }),

  // ── 新增批：public ────────────────────────────────────────────────────
  getPublicBlockTrades: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/public/block-trades", { params: { instId } }),

  getDeliveryExerciseHistory: (instType: string, uly?: string, instFamily?: string) =>
    request<unknown[]>("GET", "/api/v5/public/delivery-exercise-history", { params: { instType, uly, instFamily } }),

  getFundingRateHistory: (instId: string, before?: string, after?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/public/funding-rate-history", { params: { instId, before, after, limit } }),

  getInterestRateLoanQuota: () =>
    request<unknown[]>("GET", "/api/v5/public/interest-rate-loan-quota"),

  getPremiumHistory: (instId: string, period?: string) =>
    request<unknown[]>("GET", "/api/v5/public/premium-history", { params: { instId, period } }),
  getInstrumentTickBands: (instType: string) =>
    request<unknown[]>("GET", "/api/v5/public/instrument-tick-bands", { params: { instType } }),

  getSettlementHistory: (instType: string, instFamily?: string, uly?: string) =>
    request<unknown[]>("GET", "/api/v5/public/settlement-history", { params: { instType, instFamily, uly } }),

  getEventSeries: () =>
    request<unknown[]>("GET", "/api/v5/public/event-contract/series"),

  getEventMarkets: (seriesId: string) =>
    request<unknown[]>("GET", "/api/v5/public/event-contract/markets", { params: { seriesId } }),

  getEventEvents: (seriesId: string) =>
    request<unknown[]>("GET", "/api/v5/public/event-contract/events", { params: { seriesId } }),

  // ── 预测市场 Outcomes（T-001） ──────────────────────────────────────
  getPredictionsEvents: (params?: Record<string, string | number | boolean | undefined>) =>
    request<unknown[]>("GET", "/api/v5/predictions/events", { params }),

  searchPredictionsEvents: (keyword: string) =>
    request<unknown[]>("GET", "/api/v5/predictions/events/search", { params: { keyword } }),

  getPredictionsEvent: (eventId: string) =>
    request<unknown[]>("GET", `/api/v5/predictions/events/${eventId}`),

  getPredictionsEventMarkets: (eventId: string) =>
    request<unknown[]>("GET", `/api/v5/predictions/events/${eventId}/markets`),

  getPredictionsMarket: (marketId: string) =>
    request<unknown[]>("GET", `/api/v5/predictions/markets/${marketId}`),

  // ── 预测市场订单簿（T-002） ──────────────────────────────────────
  getPredictionsOrderbook: (instId: string, sz?: number) =>
    request<unknown[]>("GET", "/api/v5/market/pm-books", { params: { instId, sz } }),


  // ── 新增批：fiat ──────────────────────────────────────────────────────
  getFiatBuySellPair: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/fiat/buy-sell/currency-pair", { auth }),

  getFiatDeposit: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/fiat/deposit", { auth }),

  getFiatDepositOrderHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/fiat/deposit-order-history", { auth }),

  getFiatDepositPaymentMethods: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/fiat/deposit-payment-methods", { auth }),

  // ── rubik 大数据（v0.2.26 第四批） ────────────────────────────────────
  getTakerVolumeContract: (ccy: string, instId: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/taker-volume-contract", { params: { ccy, instId } }),

  getOptionTakerBlockVolume: (ccy: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/option/taker-block-volume", { params: { ccy } }),

  getTopTraderPositionRatio: (instId: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader", { params: { instId } }),

  applyMonthlyStatement: (auth: Auth) =>
    request<unknown[]>("POST", "/api/v5/asset/monthly-statement", { auth }),

  // ── RFQ 收尾（第八批新增） ────────────────────────────────────────────
  getRfqCounterparties: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/rfq/counterparties", { auth }),

  cancelRfq: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/cancel-rfq", { body, auth }),

  cancelBatchRfqs: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/cancel-batch-rfqs", { body, auth }),

  cancelAllRfqs: (auth: Auth) =>
    request<unknown[]>("POST", "/api/v5/rfq/cancel-all-rfqs", { auth }),

  createRfqQuote: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/create-quote", { body, auth }),

  cancelRfqQuote: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/cancel-quote", { body, auth }),

  cancelBatchQuotes: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/rfq/cancel-batch-quotes", { body, auth }),

  cancelAllQuotes: (auth: Auth) =>
    request<unknown[]>("POST", "/api/v5/rfq/cancel-all-quotes", { auth }),

  getRfqTrades: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/rfq/trades", { auth }),

  // ── Copytrading 收尾（第九批新增） ────────────────────────────────────
  getPublicLeadTraders: () =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-lead-traders"),

  getPublicCopyConfig: () =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-config"),

  getPublicLeadTraderPnl: (uniqueCode: string, lastDays: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-pnl", { params: { uniqueCode, lastDays } }),

  getPublicLeadTraderStats: (uniqueCode: string, instType: string, lastDays: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-stats", { params: { uniqueCode, instType, lastDays } }),

  getCopyTraders: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/copytrading/copy-traders", { auth }),

  firstCopySettings: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/first-copy-settings", { body, auth }),

  getUnrealizedProfitSharing: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/copytrading/unrealized-profit-sharing-details", { auth }),

  getTotalUnrealizedProfitSharing: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/copytrading/total-unrealized-profit-sharing", { auth }),

  amendProfitSharingRatio: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/amend-profit-sharing-ratio", { body, auth }),

  amendCopySettings: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/amend-copy-settings", { body, auth }),

  // ── 第一批快收尾 ──────────────────────────────────────────────────────
  resetRfqMmp: (auth: Auth) =>
    request<unknown[]>("POST", "/api/v5/rfq/mmp-reset", { auth }),

  stopCopyTrading: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/copytrading/stop-copy-trading", { body, auth }),

  getPublicPreferenceCurrency: (uniqueCode: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-preference-currency", { params: { uniqueCode } }),


  getPublicLeadPositions: (uniqueCode: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-current-subpositions", { params: { uniqueCode, instType } }),

  // ── 第二批 account ────────────────────────────────────────────────────
  getAccountPositionRisk: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/account-position-risk", { auth }),

  getInterestLimits: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/interest-limits", { auth }),

  getTradeFee: (auth: Auth, instType?: string, instId?: string, uly?: string) =>
    request<unknown[]>("GET", "/api/v5/account/trade-fee", { params: { instType, instId, uly }, auth }),

  getAccountSubtypes: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/subtypes", { auth }),

  getSubAccountTradingBalance: (auth: Auth, subAcct: string) =>
    request<unknown[]>("GET", "/api/v5/account/subaccount/balances", { params: { subAcct }, auth }),

  presetAccountSwitch: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/account-level-switch-preset", { body, auth }),

  activateOption: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/activate-option", { body, auth }),

  positionBuilder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/position-builder", { body, auth }),

  setAutoEarn: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-auto-earn", { body, auth }),

  setFeeType: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-fee-type", { body, auth }),

  setSettleCurrency: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-settle-currency", { body, auth }),

  getPositionBuilderGraph: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/position-builder-graph", { auth }),

  precheckDeltaNeutral: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/precheck-set-delta-neutral", { body, auth }),

  // ── 第三批 finance ────────────────────────────────────────────────────
  adjustFlexibleLoanCollateral: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/flexible-loan/adjust-collateral", { body, auth }),

  purchaseSavings: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/savings/purchase-redempt", { body, auth }),

  getSfpDcdProducts: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/sfp/dcd/products", { auth }),

  redeemSfpDcd: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/sfp/dcd/redeem", { body, auth }),

  getStakingActiveOrders: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/staking-defi/orders-active", { auth }),

  cancelRedeemEthStaking: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/staking-defi/eth/cancel-redeem", { body, auth }),

  purchaseSolStaking: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/staking-defi/sol/purchase", { body, auth }),

  redeemSolStaking: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/staking-defi/sol/redeem", { body, auth }),

  // ── 最终批 ────────────────────────────────────────────────────────────
  getRiskState: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/risk-state", { auth }),

  borrowRepay: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/borrow-repay", { body, auth }),

  getBorrowRepayHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/borrow-repay-history", { auth }),

  getFlexibleLoanCollateralAssets: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/flexible-loan/collateral-assets", { auth }),

  getFlexibleLoanInfo: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/flexible-loan/loan-info", { auth }),

  getFlexibleLoanHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/flexible-loan/loan-history", { auth }),

  getStableRewardsProductInfo: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/stable-rewards/product-info", { auth }),

  getStableRewardsQuote: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/stable-rewards/quote", { body, auth }),

  getEasyConvertCurrencyList: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/trade/easy-convert-currency-list", { auth }),


  // ── v0.2.31 最后批 ────────────────────────────────────────────────────
  getLendingRateHistoryDetail: () =>
    request<unknown[]>("GET", "/api/v5/finance/savings/lending-rate-history"),

  setLendingRate: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/finance/savings/set-lending-rate", { body, auth }),

  getStableRewardsApyHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/stable-rewards/apy-history", { auth }),

  getStableRewardsHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/stable-rewards/subscribe-redeem-history", { auth }),

  getSfpOrderHistory: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/finance/sfp/dcd/order-history", { auth }),

  getAccountBillsArchive: (auth: Auth) =>
    request<unknown[]>("GET", "/api/v5/account/bills-archive", { auth }),

  setAutoLoan: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-auto-loan", { body, auth }),

  // ── 最终收尾 ──────────────────────────────────────────────
  getAssetBalances: (auth: Auth, ccy?: string) =>
    request<unknown[]>("GET", "/api/v5/asset/balances", { params: { ccy }, auth }),

  setTradingConfig: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/set-trading-config", { body, auth }),

  movePositions: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/account/move-positions", { body, auth }),
}
