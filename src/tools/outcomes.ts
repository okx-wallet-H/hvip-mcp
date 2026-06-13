import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { getAuth, getHRailsClient, toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerOutcomesTools(server: McpServer): void {
  server.tool(
    "outcomes_list_events",
    "## 功能：列出OKX预测市场所有事件（世界杯、选举等）\n## 场景：用于浏览可交易的预测市场、按关键词搜索事件、了解各事件成交量和活跃度\n## 关键词：预测市场, 事件列表, outcomes, 世界杯, 选举, 概率交易\n## 参数：\n##   - pageSize: 每页数量，默认20\n##   - search: 关键词搜索事件标题\n##   - includeMarkets: 是否附带每个事件的市场列表\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB\n## 关联：本工具浏览事件 → outcomes_get_event 查看单个事件详情 → outcomes_get_market 查看市场",
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

  server.tool(
    "outcomes_get_event",
    "## 功能：获取单个预测市场事件的完整信息\n## 场景：用于查看事件的所有关联市场列表、各市场当前概率、判断哪些市场值得交易\n## 关键词：事件详情, event, 预测事件, 关联市场, 概率\n## 参数：\n##   - eventId: 事件ID\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：outcomes_list_events 获取事件列表 → 本工具查看详情 → outcomes_get_market 查看具体市场",
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

  server.tool(
    "outcomes_get_market",
    "## 功能：获取单个预测市场详情\n## 场景：用于查看具体预测问题的描述、当前概率、成交量、结束时间、判断是否值得参与\n## 关键词：预测市场, market, 概率, 成交量, 预测问题\n## 参数：\n##   - marketId: 市场ID\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：outcomes_get_event 查看事件 → 本工具查看具体市场 → outcomes_get_ticker 看报价 → outcomes_check_arbitrage 找套利",
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

  server.tool(
    "outcomes_get_ticker",
    "## 功能：获取预测市场单边（YES或NO）的实时报价\n## 场景：用于查看YES/NO当前最优买卖价、YES价格代表该结果发生的概率、判断买卖时机\n## 关键词：预测报价, ticker, YES, NO, 概率价格, 买卖价\n## 参数：\n##   - marketId: 市场ID\n##   - outcome: 结果方向。YES=看涨, NO=看跌\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：outcomes_get_market 查看市场 → 本工具看报价 → outcomes_get_orderbook 看深度 → outcomes_check_arbitrage 找套利",
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

  server.tool(
    "outcomes_get_orderbook",
    "## 功能：获取预测市场订单簿深度\n## 场景：用于分析YES/NO挂单分布、判断流动性、YES_ask + NO_ask < 1.0 时存在无风险套利机会\n## 关键词：预测深度, orderbook, 挂单, 套利, YES+NO, 双边\n## 参数：\n##   - marketId: 市场ID\n##   - outcome: 结果方向\n##   - size: 深度档位，默认20，最大50\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB\n## 关联：outcomes_get_ticker 看报价 → 本工具看深度 → outcomes_check_arbitrage 检测套利",
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

  server.tool(
    "outcomes_get_candles",
    "## 功能：获取预测市场K线数据\n## 场景：用于分析概率走势、研究交易量变化规律、判断趋势方向\n## 关键词：预测K线, candles, 概率走势, 成交量, 趋势分析\n## 参数：\n##   - marketId: 市场ID\n##   - outcome: 结果方向\n##   - bar: K线周期。1m/5m/15m=分钟, 1H=1小时, 4H=4小时, 1D=日线。默认1H\n##   - limit: 返回条数，默认48，最大200\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：48条 ~3KB — 微小\n## 关联：outcomes_get_ticker 看当前概率 → 本工具看历史走势 → 判断概率趋势",
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

  server.tool(
    "outcomes_check_arbitrage",
    "## 功能：检测预测市场无风险套利机会（YES+NO买价之和 < 1.0）\n## 场景：用于自动扫描套利窗口、低风险套利决策参考\n## 关键词：套利, 预测市场套利, arbitrage, 无风险套利, YES+NO, 双边套利\n## 参数：\n##   - marketId: 市场ID，必填\n## 鉴权：⚠️ 需要 HRAILS API Key\n## 风险：READ — 只读检测，Agent 可自动调用\n## 返回量：微小 ~300B\n## 关联：先调 outcomes_get_market 获取市场 → 本工具检测套利 → 手动下单",
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

  server.tool(
    "outcomes_list_markets",
    "## 功能：列出所有预测市场\n## 场景：用于浏览全部可用市场、发现交易机会\n## 关键词：预测市场, markets, 市场列表\n## 参数：\n##   - pageSize: 每页数量，默认20\n## 鉴权：需要 HRAILS_API_KEY\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB\n## 关联：outcomes_list_events → 本工具 → outcomes_get_market 看详情",
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

  server.tool(
    "okx_get_event_series",
    "## 功能：获取预测市场事件合约系列列表\n## 场景：用于浏览可交易的事件合约系列（如SOL价格区间预测）\n## 关键词：事件合约, event series, 预测市场, 事件系列, 事件类型\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看事件系列 → okx_get_event_markets 查看具体市场 → 选择交易",
    {},
    async () => {
      try {
        const data = await publicApi.getEventSeries()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_event_markets",
    "## 功能：获取预测市场指定系列下的所有市场\n## 场景：用于查看某事件系列下的所有可交易合约品种\n## 关键词：事件市场, event markets, 预测市场, 合约市场\n## 参数：\n##   - seriesId: 事件系列ID。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_event_series 查系列 → 本工具查看市场 → 评估交易机会",
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

  server.tool(
    "okx_get_event_events",
    "## 功能：获取预测市场指定系列下的事件列表\n## 场景：用于查看事件合约的到期日、状态和有关信息\n## 关键词：事件列表, event events, 预测事件, 事件状态\n## 参数：\n##   - seriesId: 事件系列ID。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_event_series 查系列 → 本工具查看事件 → 选择到期日",
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

  server.tool(
    "okx_predictions_list_events",
    "## 功能：获取 OKX 预测市场事件列表\n## 场景：用于浏览可选事件、发现热门预测主题\n## 关键词：预测市场, predictions, events, 事件列表\n## 参数：\n##   - limit: 返回数量，默认20\n##   - sort: 排序字段\n##   - category: 分类筛选\n##   - status: 状态筛选\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~3KB\n## 关联：本工具 → okx_predictions_get_event 看详情 → okx_predictions_get_event_markets 看市场",
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

  server.tool(
    "okx_predictions_search_events",
    "## 功能：全文关键词搜索预测市场事件\n## 场景：快速找到特定主题的预测事件（如某选举、比赛）\n## 关键词：预测市场, predictions, 搜索事件, 关键词搜索\n## 参数：\n##   - keyword: 搜索关键词，必填\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~3KB\n## 关联：okx_predictions_list_events 列表 → 本工具搜索 → okx_predictions_get_event 详情",
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

  server.tool(
    "okx_predictions_get_event",
    "## 功能：获取单个预测市场事件详情\n## 场景：查看事件描述、状态、关联市场概览\n## 关键词：预测事件, event 详情, predictions\n## 参数：\n##   - eventId: 事件ID，必填\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~2KB\n## 关联：列表/搜索 → 本工具 → okx_predictions_get_event_markets 看市场",
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

  server.tool(
    "okx_predictions_get_event_markets",
    "## 功能：获取事件下所有交易市场\n## 场景：查看某事件包含的多个预测市场（胜/负/比分等）\n## 关键词：事件市场, 预测市场列表, predictions markets\n## 参数：\n##   - eventId: 事件ID，必填\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB\n## 关联：okx_predictions_get_event → 本工具 → okx_predictions_get_market 单个市场",
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

  server.tool(
    "okx_predictions_get_market",
    "## 功能：获取单个预测市场详情\n## 场景：查看具体市场赔率、成交量、结算信息\n## 关键词：预测市场, market 详情, predictions\n## 参数：\n##   - marketId: 市场ID，必填\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~2KB\n## 关联：okx_predictions_get_event_markets → 本工具 → 行情查询",
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

  server.tool(
    "okx_predictions_ticker",
    "## 功能：获取预测市场 YES/NO 资产行情报价\n## 场景：实时价格、买卖价、成交量，用于判断市场温度\n## 关键词：预测行情, ticker, predictions, 报价\n## 参数：\n##   - instId: YES 或 NO 的 instId（yesAssetId）\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~1KB\n## 关联：okx_predictions_get_market → 本工具 → okx_predictions_orderbook 深度",
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

  server.tool(
    "okx_predictions_candles",
    "## 功能：获取预测市场 K 线\n## 场景：分析概率走势、量能变化\n## 关键词：预测K线, candles, predictions, 趋势\n## 参数：\n##   - instId: YES/NO instId\n##   - bar: K线周期，默认1H\n##   - limit: 返回条数，默认100\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：中等\n## 关联：ticker → 本工具 → 分析",
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

  server.tool(
    "okx_predictions_orderbook",
    "## 功能：获取预测市场深度（pm-books，最多400档）\n## 场景：分析买卖盘、流动性、可能的套利空间\n## 关键词：预测深度, orderbook, pm-books, 挂单\n## 参数：\n##   - instId: YES/NO instId\n##   - sz: 深度档位，默认400\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：中等 ~10KB+\n## 关联：ticker → 本工具 深度分析",
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

  server.tool("okx_event_place_order",
    "## 功能：下事件合约订单\n## 场景：用于对事件合约（instType=EVENTS）下单\n## 关键词：事件合约, event, place order, 下单\n## 参数：\n##   - instId: 合约ID\n##   - side: buy/sell\n##   - outcome: yes/no（必填）\n##   - sz: 数量\n##   - px: 限价（可选）\n##   - ordType: market/limit/post_only（可选）\n## 鉴权：需要 API Key（交易权限）\n## 风险：WRITE — 下单操作，需用户确认\n## 返回量：微小 ~500B\n## 关联：本工具 → okx_event_cancel_order 撤单",
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

  server.tool("okx_event_cancel_order",
    "## 功能：撤销事件合约订单\n## 场景：用于取消已下但未成交的事件合约订单\n## 关键词：事件合约, cancel, 撤单\n## 参数：\n##   - instId: 合约ID\n##   - ordId: 订单ID\n## 鉴权：需要 API Key（交易权限）\n## 风险：WRITE — 撤单操作，需用户确认\n## 返回量：微小 ~300B\n## 关联：okx_event_place_order → 本工具",
    { instId: z.string().describe("合约ID"), ordId: z.string().describe("订单ID") },
    async ({ instId, ordId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.cancelOrder(auth, instId, ordId)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  server.tool("okx_event_amend_order",
    "## 功能：修改事件合约订单\n## 场景：用于修改已下但未成交的事件合约订单\n## 关键词：事件合约, amend, 改单\n## 参数：\n##   - instId: 合约ID\n##   - ordId: 订单ID\n##   - newSz: 新数量（可选）\n##   - newPx: 新价格（可选）\n## 鉴权：需要 API Key（交易权限）\n## 风险：WRITE — 改单操作，需用户确认\n## 返回量：微小 ~300B\n## 关联：okx_event_place_order → 本工具",
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

  server.tool("okx_event_fills",
    "## 功能：查询事件合约成交记录\n## 场景：用于查看事件合约的历史成交明细\n## 关键词：事件合约, fills, 成交记录\n## 参数：\n##   - instId: 合约ID（可选）\n##   - limit: 返回条数（可选）\n## 鉴权：需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_event_place_order → 本工具",
    { instId: z.string().optional().describe("合约ID"), limit: z.number().int().min(1).max(100).optional().describe("返回条数") },
    async ({ instId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.getFills(auth, "EVENTS", instId, limit)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  server.tool("okx_event_instruments",
    "## 功能：查询可交易的事件合约列表\n## 场景：用于浏览所有可用的事件合约品种\n## 关键词：事件合约, instruments, 合约列表\n## 参数：\n##   - seriesId: 事件系列ID（可选）\n## 鉴权：需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具 → okx_event_place_order 下单",
    { seriesId: z.string().optional().describe("事件系列ID") },
    async ({ seriesId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await publicApi.getInstruments("EVENTS", seriesId)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  // ══ T-003: Outcomes 订单管理（EIP-712）════════════════════════════════

  server.tool("okx_predictions_place_order",
    "## 功能：下 Outcomes 预测市场订单\n## 场景：用于对预测市场（YES/NO）下买单或卖单\n## 关键词：预测订单, place order, outcomes, 下单\n## 参数：\n##   - marketId: 市场ID（必填）\n##   - side: buy=买入, sell=卖出（必填）\n##   - outcome: yes=看涨, no=看跌（必填）\n##   - size: 合约张数（必填）\n##   - price: 限价，不填则市价\n## 鉴权：需要 API Key（交易权限+EIP-712）\n## 风险：WRITE — 下单操作，需用户确认\n## 返回量：微小 ~500B\n## 关联：本工具 → okx_predictions_cancel_order 撤单",
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

  server.tool("okx_predictions_cancel_order",
    "## 功能：撤销 Outcomes 预测市场订单\n## 场景：用于取消已下但未成交的预测市场订单\n## 关键词：预测订单, cancel order, 撤单\n## 参数：\n##   - orderId: 订单ID（可选）\n## 鉴权：需要 API Key（交易权限+EIP-712）\n## 风险：WRITE — 撤单操作，需用户确认\n## 返回量：微小 ~300B\n## 关联：okx_predictions_place_order 下单 → 本工具",
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

  server.tool("okx_predictions_cancel_all",
    "## 功能：撤销所有 Outcomes 订单\n## 场景：用于清空当前市场所有挂单\n## 关键词：预测订单, cancel all, 全部撤单\n## 参数：\n##   - assetIds: 资产ID列表，逗号分隔（可选）\n## 鉴权：需要 API Key（交易权限+EIP-712）\n## 风险：WRITE — 批量撤单，需用户确认\n## 返回量：微小 ~300B\n## 关联：本工具 → okx_predictions_order_list 查订单",
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

  server.tool("okx_predictions_heartbeat",
    "## 功能：Outcomes 心跳保活\n## 场景：定时发送心跳防止系统因超时自动撤单\n## 关键词：心跳, heartbeat, keep-alive\n## 参数：无\n## 鉴权：需要 API Key（EIP-712）\n## 风险：WRITE — 发送心跳，Agent 可自动调用\n## 返回量：微小 ~200B\n## 关联：下单前/后 → 本工具保持连接",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsHeartbeat(auth)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  server.tool("okx_predictions_get_order",
    "## 功能：查询单个 Outcomes 订单详情\n## 场景：用于查看订单状态、成交数量、价格\n## 关键词：订单详情, order detail, 查询\n## 参数：\n##   - orderId: 订单ID（必填）\n## 鉴权：需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：okx_predictions_order_list → 本工具",
    { orderId: z.string().describe("订单ID（必填）") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = await privateApi.predictionsGetOrder(auth, orderId)
        return toResult({ ...(Array.isArray(d) ? { data: d } : d), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    })

  server.tool("okx_predictions_order_list",
    "## 功能：查询 Outcomes 订单列表\n## 场景：用于查看历史订单、按市场或状态筛选\n## 关键词：订单列表, order list, 历史订单\n## 参数：\n##   - marketId: 市场ID（可选）\n##   - status: 订单状态（可选）\n##   - limit: 返回条数（可选）\n## 鉴权：需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具 → okx_predictions_get_order 看详情",
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
}
