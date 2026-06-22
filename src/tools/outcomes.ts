import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { getAuth, getHRailsClient, toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerOutcomesTools(server: McpServer): void {
  registerTool(
    server,
    "outcomes_list_events",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      pageSize:       z.number().int().min(1).max(100).optional().describe("每页数量，默认20"),
      search:         z.string().optional().describe("关键词搜索事件标题"),
      includeMarkets: z.boolean().optional().describe("是否附带每个事件的市场列表"),
    },
    async ({ pageSize, search, includeMarkets }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const params: { pageSize?: number; search?: string; includeMarkets?: boolean } = {}
        if (pageSize !== undefined) params.pageSize = pageSize
        if (search !== undefined) params.search = search
        if (includeMarkets !== undefined) params.includeMarkets = includeMarkets
        const data = await client.listEvents(params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_get_event",
    "READ",
    "[D:Prediction] 预测市场数据",
    { eventId: z.string().describe("事件ID") },
    async ({ eventId }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const data = await client.getEvent(eventId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_get_market",
    "READ",
    "[D:Prediction] 预测市场数据",
    { marketId: z.string().describe("市场ID") },
    async ({ marketId }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const data = await client.getMarket(marketId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_get_ticker",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      marketId: z.string().describe("市场ID"),
      outcome:  z.enum(["YES","NO"]).describe("结果方向"),
    },
    async ({ marketId, outcome }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const data = await client.getTicker(marketId, outcome)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_get_orderbook",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      marketId: z.string().describe("市场ID"),
      outcome:  z.enum(["YES","NO"]).describe("结果方向"),
      size:     z.number().int().min(1).max(50).optional().describe("深度档位，默认20"),
    },
    async ({ marketId, outcome, size }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const data = await client.getOrderbook(marketId, outcome, size)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_get_candles",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      marketId: z.string().describe("市场ID"),
      outcome:  z.enum(["YES","NO"]).describe("结果方向"),
      bar:      z.enum(["1m","5m","15m","1H","4H","1D"]).optional().describe("K线周期，默认1H"),
      limit:    z.number().int().min(1).max(200).optional().describe("返回条数，默认48"),
    },
    async ({ marketId, outcome, bar, limit }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const data = await client.getCandles(marketId, outcome, bar, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_check_arbitrage",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      marketId: z.string().describe("市场ID，必填"),
    },
    async ({ marketId }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const [yesData, noData] = await Promise.all([
          client.getTicker(marketId, "YES"),
          client.getTicker(marketId, "NO"),
        ])
        const yd = yesData as any
        const nd = noData as any
        const yesAsk = parseFloat(yd?.bestAsk ?? yd?.ask ?? "0")
        const noAsk  = parseFloat(nd?.bestAsk ?? nd?.ask ?? "0")
        const yesBid = parseFloat(yd?.bestBid ?? yd?.bid ?? "0")
        const noBid  = parseFloat(nd?.bestBid ?? nd?.bid ?? "0")
        const askSum = yesAsk + noAsk
        const bidSum = yesBid + noBid
        const hasArbitrage = askSum > 0 && askSum < 1.0
        return toResult({
          marketId,
          yesAsk,
          noAsk,
          askSum: askSum.toFixed(6),
          hasArbitrage,
          arbitrageReturn: hasArbitrage ? ((1 - askSum) / askSum * 100).toFixed(4) + "%" : "无",
          tip: hasArbitrage
            ? `同时买入 YES@${yesAsk} + NO@${noAsk}，成本=${askSum.toFixed(6)}，到期价值=1.0，无风险收益=${(1 - askSum).toFixed(6)} (${((1 - askSum) / askSum * 100).toFixed(2)}%)`
            : "当前无套利机会（YES买价+NO买价 ≥ 1.0）",
          bidSum: bidSum.toFixed(6),
          spread: (askSum - bidSum).toFixed(6),
        })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "outcomes_list_markets",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      pageSize: z.number().int().min(1).max(100).optional().describe("每页数量"),
    },
    async ({ pageSize }) => {
      const client = getHRailsClient()
      if (!client) return toError(new Error("未配置 HRAILS_API_KEY"))
      try {
        const params = pageSize !== undefined ? { pageSize } : undefined
        const data = await client.listMarkets(params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 预测市场事件合约（v0.2.26 新缺口） ────────────────────────────────────

  registerTool(
    server,
    "okx_get_event_series",
    "READ",
    "[D:Prediction] 预测市场数据",
    {},
    async () => {
      try {
        const data = await publicApi.getEventSeries()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_event_markets",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      seriesId: z.string().describe("事件系列ID。必填"),
    },
    async ({ seriesId }) => {
      try {
        const data = await publicApi.getEventMarkets(seriesId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_event_events",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      seriesId: z.string().describe("事件系列ID。必填"),
    },
    async ({ seriesId }) => {
      try {
        const data = await publicApi.getEventEvents(seriesId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── T-001: OKX Predictions 公共查询（5 端点） ────────────────────────────

  registerTool(
    server,
    "okx_predictions_list_events",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      limit:    z.number().int().min(1).max(100).optional().describe("返回数量"),
      sort:     z.string().optional().describe("排序字段"),
      category: z.string().optional().describe("分类筛选"),
      status:   z.string().optional().describe("状态筛选"),
    },
    async ({ limit, sort, category, status }) => {
      try {
        const params: Record<string, unknown> = {}
        if (limit !== undefined) params.limit = limit
        if (sort)     params.sort = sort
        if (category) params.category = category
        if (status)   params.status = status
        const data = await publicApi.getPredictionsEvents(params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_predictions_search_events",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      keyword: z.string().describe("搜索关键词，必填"),
    },
    async ({ keyword }) => {
      try {
        const data = await publicApi.searchPredictionsEvents(keyword)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_predictions_get_event",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      eventId: z.string().describe("事件ID，必填"),
    },
    async ({ eventId }) => {
      try {
        const data = await publicApi.getPredictionsEvent(eventId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_predictions_get_event_markets",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      eventId: z.string().describe("事件ID，必填"),
    },
    async ({ eventId }) => {
      try {
        const data = await publicApi.getPredictionsEventMarkets(eventId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_predictions_get_market",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      marketId: z.string().describe("市场ID，必填"),
    },
    async ({ marketId }) => {
      try {
        const data = await publicApi.getPredictionsMarket(marketId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── T-002: Outcomes 市场数据（3 端点，复用 ticker/candles + 新 pm-books） ──

  registerTool(
    server,
    "okx_predictions_ticker",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      instId: z.string().describe("YES/NO 资产的 instId（yesAssetId），必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getTicker(instId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_predictions_candles",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      instId: z.string().describe("YES/NO 资产 instId"),
      bar:    z.string().optional().describe("K线周期，默认1H"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数"),
    },
    async ({ instId, bar, limit }) => {
      try {
        const data = await publicApi.getCandles(instId, bar, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_predictions_orderbook",
    "READ",
    "[D:Prediction] 预测市场数据",
    {
      instId: z.string().describe("YES/NO 资产 instId"),
      sz:     z.number().int().min(1).max(400).optional().describe("深度档位，默认400"),
    },
    async ({ instId, sz }) => {
      try {
        const data = await publicApi.getPredictionsOrderbook(instId, sz)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ══ T-005: 事件合约交易 ═══════════════════════════════════════════════

  registerTool(server,
    "okx_event_place_order",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { instId: z.string().describe("合约ID"), side: z.enum(["buy","sell"]).describe("买卖方向"),
      outcome: z.enum(["yes","no"]).describe("结果方向"), sz: z.string().describe("数量"),
      px: z.string().optional().describe("限价"), ordType: z.enum(["market","limit","post_only"]).optional().describe("订单类型") },
    async ({ instId, side, outcome, sz, px, ordType }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body = { instId, side, sz, outcome, instType: "EVENTS" } as Record<string, unknown>
        if (px) body.px = px
        if (ordType) body.ordType = ordType
        if (ordType !== "post_only") body.speedBump = "1"
        const d = await privateApi.placeOrder(auth, body)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_event_cancel_order",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { instId: z.string().describe("合约ID"), ordId: z.string().describe("订单ID") },
    async ({ instId, ordId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.cancelOrder(auth, instId, ordId)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_event_amend_order",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { instId: z.string().describe("合约ID"), ordId: z.string().describe("订单ID"),
      newSz: z.string().optional().describe("新数量"), newPx: z.string().optional().describe("新价格") },
    async ({ instId, ordId, newSz, newPx }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body = { instId, ordId } as Record<string, unknown>
        if (newSz) body.newSz = newSz
        if (newPx) body.newPx = newPx
        const d = await privateApi.amendOrder(auth, body)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_event_fills",
    "READ",
    "[D:Prediction] 预测市场数据",
    { instId: z.string().optional().describe("合约ID"), limit: z.number().int().min(1).max(100).optional().describe("返回条数") },
    async ({ instId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.getFills(auth, "EVENTS", instId, limit)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_event_instruments",
    "READ",
    "[D:Prediction] 预测市场数据",
    { seriesId: z.string().optional().describe("事件系列ID") },
    async ({ seriesId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await publicApi.getInstruments("EVENTS", seriesId)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  // ══ T-003: Outcomes 订单管理 ═══════════════════════════════════════════

  registerTool(server,
    "okx_predictions_place_order",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { marketId: z.string().describe("市场ID（必填）"),
      side: z.enum(["buy","sell"]).describe("买卖方向"),
      outcome: z.enum(["yes","no"]).describe("结果方向"),
      size: z.string().describe("合约张数"),
      price: z.string().optional().describe("限价，不填则市价") },
    async ({ marketId, side, outcome, size, price }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { marketId, side, outcome, size }
        if (price) body.price = price
        const d = await privateApi.predictionsPlaceOrder(auth, body)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_cancel_order",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { orderId: z.string().optional().describe("订单ID") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = {}
        if (orderId) body.orderId = orderId
        const d = await privateApi.predictionsCancelOrder(auth, body)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_cancel_all",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { assetIds: z.string().optional().describe("资产ID列表，逗号分隔") },
    async ({ assetIds }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = {}
        if (assetIds) body.assetIds = assetIds
        const d = await privateApi.predictionsCancelAll(auth, body)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_heartbeat",
    "READ",
    "[D:Prediction] 预测市场数据",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsHeartbeat(auth)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_get_order",
    "READ",
    "[D:Prediction] 预测市场数据",
    { orderId: z.string().describe("订单ID（必填）") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsGetOrder(auth, orderId)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_order_list",
    "READ",
    "[D:Prediction] 预测市场数据",
    { marketId: z.string().optional().describe("市场ID"),
      status: z.string().optional().describe("订单状态"),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数") },
    async ({ marketId, status, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsOrderList(auth, marketId, status, limit)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  // ══ T-004: Outcomes 持仓 & 账户 ═════════════════════════════════════

  registerTool(server,
    "okx_predictions_positions",
    "READ",
    "[D:Prediction] 预测市场数据",
    { marketId: z.string().optional().describe("市场ID"),
      status: z.string().optional().describe("持仓状态") },
    async ({ marketId, status }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsPositions(auth, marketId, status)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_split",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { amount: z.string().describe("拆分数量（必填）") },
    async ({ amount }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsSplit(auth, { amount })
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_merge",
    "WRITE",
    "[D:Prediction] 预测市场数据",
    { amount: z.string().describe("合并数量（必填）") },
    async ({ amount }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsMerge(auth, { amount })
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_redeem",
    "FUND_TRANSFER",
    "[D:Prediction] 预测市场数据",
    { assetId: z.string().optional().describe("资产ID") },
    async ({ assetId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = {}
        if (assetId) body.assetId = assetId
        const d = await privateApi.predictionsRedeem(auth, body)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_balance",
    "READ",
    "[D:Prediction] 预测市场数据",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsBalance(auth)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  registerTool(server,
    "okx_predictions_trades",
    "READ",
    "[D:Prediction] 预测市场数据",
    { marketId: z.string().optional().describe("市场ID"),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数") },
    async ({ marketId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsTrades(auth, marketId, limit)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })
}
