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

  getLeadTraderPositions: (uniqueCode: string, instType?: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-current-subpositions", { params: { uniqueCode, instType } }),

  getLeadTraderHistory: (uniqueCode: string, instType?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-subpositions-history", { params: { uniqueCode, instType, limit } }),

  getLeadTraderStats: (uniqueCode: string, instType: string, lastDays: string) =>
    request<unknown[]>("GET", "/api/v5/copytrading/public-stats", { params: { uniqueCode, instType, lastDays } }),

  getGridAiParam: (instId: string, algoOrdType: string, direction?: string) =>
    request<unknown[]>("GET", "/api/v5/tradingBot/grid/ai-param", { params: { instId, algoOrdType, direction } }),

  getBlockTickers: (instType: string) =>
    request<unknown[]>("GET", "/api/v5/market/block-tickers", { params: { instType } }),

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

  getAnnouncements: (annType?: string, lang?: string) =>
    request<unknown>("GET", "/api/v5/support/announcements", { params: { annType, lang } }),

  getAnnouncementTypes: () =>
    request<unknown[]>("GET", "/api/v5/support/announcement-types"),

  getUnderlying: (instType?: string) =>
    request<unknown[]>("GET", "/api/v5/public/underlying", { params: { instType } }),

  getTakerFlow: (ccy: string, instType?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/taker-flow", { params: { ccy, instType, begin, end } }),

  getContractsTakerVolume: (ccy?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/contracts-taker-volume", { params: { ccy, begin, end } }),

  getContractsLongShortRatio: (ccy?: string, begin?: string, end?: string) =>
    request<unknown[]>("GET", "/api/v5/rubik/stat/long-short-ratio", { params: { ccy, begin, end } }),

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

  getEventSeries: () =>
    request<unknown[]>("GET", "/api/v5/public/event-contract/series"),

  getEventMarkets: (seriesId: string) =>
    request<unknown[]>("GET", "/api/v5/public/event-contract/markets", { params: { seriesId } }),

  getEventEvents: (seriesId: string) =>
    request<unknown[]>("GET", "/api/v5/public/event-contract/events", { params: { seriesId } }),
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

  // ── T-003: Outcomes 订单管理（EIP-712 签名） ─────────────────────────

  predictionsPlaceOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/predictions/orders", { body, auth }),

  predictionsCancelOrder: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/predictions/orders/cancel", { body, auth }),

  predictionsCancelAll: (auth: Auth, body: Record<string, unknown>) =>
    request<unknown[]>("POST", "/api/v5/predictions/orders/cancel-all", { body, auth }),

  predictionsHeartbeat: (auth: Auth) =>
    request<unknown[]>("POST", "/api/v5/predictions/heartbeat", { auth }),

  predictionsGetOrder: (auth: Auth, orderId: string) =>
    request<unknown[]>("GET", `/api/v5/predictions/orders/${orderId}`, { auth }),

  predictionsOrderList: (auth: Auth, marketId?: string, status?: string, limit?: number) =>
    request<unknown[]>("GET", "/api/v5/predictions/orders", { params: { marketId, status, limit }, auth }),
}
