import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { getAuth, getHRailsClient, toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerOutcomesTools(server: McpServer): void {
  registerTool(
    server,
    "predict_market_events",
    "READ",
    "[D:Prediction] 预测事件列表：浏览所有可预测事件 | pageSize默认20，search关键词搜索，includeMarkets关联市场 | 单事件详情用predict_market_event → 市场列表用predict_market_list",
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
    "predict_market_event",
    "READ",
    "[D:Prediction] 单个事件详情：获取预测事件完整信息 | eventId必填 | 事件列表用predict_market_events → 市场详情用predict_market_detail",
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
    "predict_market_detail",
    "READ",
    "[D:Prediction] 市场详情查询：获取预测市场完整信息 | marketId必填 | 市场ticker用predict_market_ticker → 买卖用predict_place",
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
    "predict_market_ticker",
    "READ",
    "[D:Prediction] 预测市场ticker：YES/NO结果方向的实时价格 | marketId必填，outcome选YES或NO | 买卖盘口用predict_market_orderbook → 套利用predict_market_arbitrage",
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
    "predict_market_orderbook",
    "READ",
    "[D:Prediction] 预测市场订单簿：YES/NO方向买卖盘口深度 | marketId必填，outcome选YES/NO，size档位可选 | K线用predict_market_candles → 套利用predict_market_arbitrage",
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
    "predict_market_candles",
    "READ",
    "[D:Prediction] 预测市场K线：YES/NO方向的OHLCV数据 | marketId必填，outcome选YES/NO，bar周期可选 | ticker用predict_market_ticker → 订单簿用predict_market_orderbook",
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
    "predict_market_arbitrage",
    "READ",
    "[D:Prediction] 预测市场套利检测：计算YES+NO双向买入的无风险套利 | marketId必填 | 订单簿用predict_market_orderbook → 交易用predict_place",
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
    "predict_market_list",
    "READ",
    "[D:Prediction] 市场列表：浏览所有预测市场 | pageSize每页数量可选 | 事件关联用predict_market_events → 详情用predict_market_detail",
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
    "predict_event_series",
    "READ",
    "[D:Prediction] 事件系列列表：获取所有事件系列（体育/政治/经济等） | 无需参数 | 系列下事件用predict_event_list → 市场用predict_event_market_list",
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
    "predict_event_market_list",
    "READ",
    "[D:Prediction] 系列下市场列表：获取事件系列关联的所有预测市场 | seriesId必填 | 系列下事件用predict_event_list → 事件系列列表用predict_event_series",
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
    "predict_event_list",
    "READ",
    "[D:Prediction] 系列下事件列表：获取事件系列关联的所有事件 | seriesId必填 | 系列下市场用predict_event_market_list → 系列列表用predict_event_series",
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
    "predict_events",
    "READ",
    "[D:Prediction] 事件查询：按条件筛选预测事件列表 | limit/sort/category/status多维度筛选 | 关键词搜索用predict_events_search → 单事件用predict_event",
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
    "predict_events_search",
    "READ",
    "[D:Prediction] 事件搜索：按关键词搜索预测事件 | keyword必填 | 带筛选的事件列表用predict_events → 单事件用predict_event",
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
    "predict_event",
    "READ",
    "[D:Prediction] 事件详情：获取单个预测事件完整信息 | eventId必填 | 事件市场用predict_event_markets → 搜索用predict_events_search",
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
    "predict_event_markets",
    "READ",
    "[D:Prediction] 事件关联市场：获取事件下的所有预测市场 | eventId必填 | 市场详情用predict_market → 事件详情用predict_event",
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
    "predict_market",
    "READ",
    "[D:Prediction] 市场详情：获取单个预测市场完整信息 | marketId必填 | 市场ticker用predict_ticker → 订单簿用predict_orderbook",
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
    "predict_ticker",
    "READ",
    "[D:Prediction] Outcomes实时行情：YES/NO资产的ticker数据 | instId即yesAssetId必填 | K线用predict_candles → 订单簿用predict_orderbook",
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
    "predict_candles",
    "READ",
    "[D:Prediction] Outcomes K线数据：YES/NO资产OHLCV | instId必填，bar周期可选，limit最大300 | ticker用predict_ticker → 订单簿用predict_orderbook",
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
    "predict_orderbook",
    "READ",
    "[D:Prediction] Outcomes订单簿：YES/NO资产买卖盘口深度 | instId必填，sz档位最大400 | ticker用predict_ticker → K线用predict_candles",
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
    "predict_event_place",
    "WRITE",
    "[D:Prediction] 事件合约下单：买入/卖出事件合约 | instId/side/outcome/sz必填，px/ordType可选 | 撤单用predict_event_cancel → 改单用predict_event_amend",
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
    "predict_event_cancel",
    "WRITE",
    "[D:Prediction] 事件合约撤单：撤销未成交的事件合约订单 | instId和ordId必填 | 下单用predict_event_place → 改单用predict_event_amend",
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
    "predict_event_amend",
    "WRITE",
    "[D:Prediction] 事件合约改单：修改未成交订单的数量或价格 | instId/ordId必填，newSz/newPx至少填一个 | 下单用predict_event_place → 撤单用predict_event_cancel",
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
    "predict_event_fills",
    "READ",
    "[D:Prediction] 事件合约成交记录：查询历史成交明细 | instId可选筛选，limit返回条数 | 订单用predict_event_place → 持仓用predict_positions",
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
    "predict_event_instruments",
    "READ",
    "[D:Prediction] 事件合约产品列表：查询可交易的事件合约 | seriesId可选筛选 | 下单用predict_event_place → 成交用predict_event_fills",
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
    "predict_place",
    "WRITE",
    "[D:Prediction] 预测市场下单：买入/卖出YES/NO结果合约 | marketId/side/outcome/size必填，price限价可选 | 撤单用predict_cancel → 批量撤用predict_cancel_all",
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
    "predict_cancel",
    "WRITE",
    "[D:Prediction] 预测市场撤单：撤销单个未成交订单 | orderId必填 | 批量撤单用predict_cancel_all → 下单用predict_place",
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
    "predict_cancel_all",
    "WRITE",
    "[D:Prediction] 预测市场批量撤单：按资产批量撤销订单 | assetIds逗号分隔可选，不填则全撤 | 单笔撤单用predict_cancel → 下单用predict_place",
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
    "predict_heartbeat",
    "READ",
    "[D:Prediction] 预测市场心跳：保持WebSocket会话活跃 | 无需参数 | 下单前确保心跳正常 → 查询用predict_orders",
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
    "predict_order",
    "READ",
    "[D:Prediction] 订单详情查询：按ID获取订单完整信息 | orderId必填 | 订单列表用predict_orders → 成交用predict_trades",
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
    "predict_orders",
    "READ",
    "[D:Prediction] 订单列表查询：按市场或状态筛选订单 | marketId/status/limit可选筛选 | 单订单详情用predict_order → 持仓用predict_positions",
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
    "predict_positions",
    "READ",
    "[D:Prediction] 预测市场持仓：查看当前持有的预测合约 | marketId/status可选筛选 | 账户余额用predict_balance → 成交用predict_trades",
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
    "predict_split",
    "WRITE",
    "[D:Prediction] 预测合约拆分：将1张完整合约拆分为YES+NO各1张 | amount必填 | 合并用predict_merge → 持仓用predict_positions",
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
    "predict_merge",
    "WRITE",
    "[D:Prediction] 预测合约合并：将YES+NO各1张合并为1张完整合约 | amount必填 | 拆分用predict_split → 赎回用predict_redeem",
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
    "predict_redeem",
    "FUND_TRANSFER",
    "[D:Prediction] 预测合约赎回：到期后赎回资金 | assetId可选，不填则全部赎回 | 持仓用predict_positions → 余额用predict_balance",
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
    "predict_balance",
    "READ",
    "[D:Prediction] 预测账户余额：查询预测市场账户资金 | 无需参数 | 持仓用predict_positions → 成交用predict_trades",
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
    "predict_trades",
    "READ",
    "[D:Prediction] 预测市场成交历史：查询历史成交记录 | marketId可选筛选，limit返回条数 | 订单用predict_orders → 持仓用predict_positions",
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
