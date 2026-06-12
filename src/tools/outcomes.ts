import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { getHRailsClient, toResult, toError } from "./shared.js"

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

  // ── T-003 Outcomes 订单 (EIP-712) ───────────────────────────────────────
  server.tool(
    "okx_predictions_place_order",
    "## 功能：Outcomes 预测市场下单（需要 EIP-712 签名）\n## 场景：下 YES/NO 仓位\n## 关键词：预测下单, predictions order, EIP712\n## 参数：\n##   - marketId: 市场ID\n##   - side: buy/sell\n##   - size: 数量\n##   - outcome: yes/no\n##   - price: 限价时必填\n## 鉴权：需要 OKX Key + AGENT_PRIVATE_KEY (EVM)\n## 风险：真实下单，有资金风险\n## 返回量：订单结果\n## 关联：先 outcomes_get_market → 本工具下单 → okx_predictions_get_order 查状态",
    {
      marketId: z.string().describe("市场ID"),
      side: z.enum(["buy", "sell"]).describe("buy/sell"),
      size: z.string().describe("数量"),
      outcome: z.enum(["yes", "no"]).describe("yes/no"),
      price: z.string().optional().describe("限价价格"),
    },
    async ({ marketId, side, size, outcome, price }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      const privateKey = process.env.AGENT_PRIVATE_KEY
      if (!privateKey) return toError(new Error("未配置 AGENT_PRIVATE_KEY"))
      try {
        const body: any = { marketId, side, size, outcome }
        if (price) body.price = price
        const data = await privateApi.createPredictionsOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_cancel_order",
    "## 功能：撤销 Outcomes 订单\n## 场景：撤单\n## 关键词：预测撤单\n## 参数：\n##   - orderId: 订单ID\n## 鉴权：需要 Key\n## 风险：撤单\n## 返回量：结果\n## 关联：place → 本工具撤单",
    { orderId: z.string().describe("订单ID") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.cancelPredictionsOrder(auth, { orderId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_cancel_all",
    "## 功能：撤销全部 Outcomes 订单\n## 场景：清仓\n## 关键词：预测全撤\n## 参数：\n##   - assetIds: 可选\n## 鉴权：需要 Key\n## 风险：全撤\n## 返回量：结果\n## 关联：批量撤单",
    { assetIds: z.string().optional().describe("可选资产ID列表") },
    async ({ assetIds }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body = assetIds ? { assetIds } : {}
        const data = await privateApi.cancelAllPredictionsOrders(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_heartbeat",
    "## 功能：Outcomes 心跳保活\n## 场景：防止断线撤单\n## 关键词：预测心跳\n## 参数：无\n## 鉴权：需要 Key\n## 风险：无\n## 返回量：结果\n## 关联：下单后定时调用",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.predictionsHeartbeat(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_get_order",
    "## 功能：查询 Outcomes 订单详情\n## 场景：查单\n## 关键词：预测订单详情\n## 参数：\n##   - orderId\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：订单信息\n## 关联：place → 本工具",
    { orderId: z.string().describe("订单ID") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.getPredictionsOrder(auth, orderId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_order_list",
    "## 功能：查询 Outcomes 订单列表\n## 场景：查历史单\n## 关键词：预测订单列表\n## 参数：\n##   - marketId?, status?, limit?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：列表\n## 关联：place → 本工具",
    {
      marketId: z.string().optional().describe("可选市场ID"),
      status: z.string().optional().describe("可选状态"),
      limit: z.number().optional().describe("可选数量"),
    },
    async ({ marketId, status, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (marketId) params.marketId = marketId
        if (status) params.status = status
        if (limit) params.limit = limit
        const data = await privateApi.getPredictionsOrders(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── T-004 Outcomes 持仓 & 账户 ─────────────────────────────────────────
  server.tool(
    "okx_predictions_positions",
    "## 功能：查询 Outcomes 持仓\n## 场景：查仓位\n## 关键词：预测持仓\n## 参数：\n##   - marketId?, status?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：持仓列表\n## 关联：place → 本工具",
    {
      marketId: z.string().optional().describe("可选"),
      status: z.string().optional().describe("可选"),
    },
    async ({ marketId, status }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (marketId) params.marketId = marketId
        if (status) params.status = status
        const data = await privateApi.getPredictionsPositions(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_split",
    "## 功能：xp 拆分为 YES+NO\n## 场景：持仓转换\n## 关键词：预测 split\n## 参数：\n##   - amount\n## 鉴权：需要 Key + EIP712\n## 风险：资金操作\n## 返回量：结果\n## 关联：positions → 本工具",
    { amount: z.string().describe("金额") },
    async ({ amount }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.splitPredictionsPosition(auth, { amount })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_merge",
    "## 功能：YES+NO 合并为 xp\n## 场景：持仓转换\n## 关键词：预测 merge\n## 参数：\n##   - amount\n## 鉴权：需要 Key + EIP712\n## 风险：资金操作\n## 返回量：结果\n## 关联：split 逆操作",
    { amount: z.string().describe("金额") },
    async ({ amount }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.mergePredictionsPosition(auth, { amount })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_redeem",
    "## 功能：事件结算后赎回赢家代币\n## 场景：结算赎回\n## 关键词：预测 redeem\n## 参数：\n##   - assetId?\n## 鉴权：需要 Key + EIP712\n## 风险：资金操作\n## 返回量：结果\n## 关联：事件结束后调用",
    { assetId: z.string().optional().describe("可选资产ID") },
    async ({ assetId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body = assetId ? { assetId } : {}
        const data = await privateApi.redeemPredictions(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_balance",
    "## 功能：查询 xp 余额\n## 场景：查预测账户余额\n## 关键词：预测余额\n## 参数：无\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：余额\n## 关联：positions 相关",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.getPredictionsBalance(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_trades",
    "## 功能：查询 Outcomes 成交记录\n## 场景：查 fills\n## 关键词：预测成交\n## 参数：\n##   - marketId?, limit?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：成交列表\n## 关联：order 相关",
    {
      marketId: z.string().optional().describe("可选"),
      limit: z.number().optional().describe("可选"),
    },
    async ({ marketId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (marketId) params.marketId = marketId
        if (limit) params.limit = limit
        const data = await privateApi.getPredictionsTrades(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── T-005 Event Contracts (EVENTS instType) ────────────────────────────
  server.tool(
    "okx_event_place_order",
    "## 功能：事件合约下单\n## 场景：主站 EVENTS 合约交易\n## 关键词：event contract, EVENTS, outcome\n## 参数：\n##   - instId, side, sz, outcome, px?, ordType?\n## 鉴权：需要 Key\n## 风险：真实交易\n## 返回量：订单结果\n## 关联：okx_event_instruments → 本工具 (必须 outcome+speedBump)",
    {
      instId: z.string().describe("合约ID"),
      side: z.enum(["buy", "sell"]).describe("buy/sell"),
      sz: z.string().describe("数量"),
      outcome: z.enum(["yes", "no"]).describe("必填 yes/no"),
      px: z.string().optional().describe("价格"),
      ordType: z.string().optional().describe("订单类型"),
    },
    async ({ instId, side, sz, outcome, px, ordType }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body: any = { instId, side, sz, outcome, speedBump: "1" }
        if (px) body.px = px
        if (ordType) body.ordType = ordType
        const data = await privateApi.placeOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_cancel_order",
    "## 功能：事件合约撤单\n## 场景：撤 EVENTS 单\n## 关键词：event cancel\n## 参数：\n##   - instId?, ordId?\n## 鉴权：需要 Key\n## 风险：撤单\n## 返回量：结果\n## 关联：place → cancel",
    {
      instId: z.string().optional().describe("可选"),
      ordId: z.string().optional().describe("可选"),
    },
    async ({ instId, ordId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body: any = {}
        if (instId) body.instId = instId
        if (ordId) body.ordId = ordId
        const data = await privateApi.cancelOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_amend_order",
    "## 功能：事件合约改单\n## 场景：改 EVENTS 单\n## 关键词：event amend\n## 参数：\n##   - instId?, ordId?, newSz?, newPx?\n## 鉴权：需要 Key\n## 风险：改单\n## 返回量：结果\n## 关联：place → amend",
    {
      instId: z.string().optional().describe("可选"),
      ordId: z.string().optional().describe("可选"),
      newSz: z.string().optional().describe("新数量"),
      newPx: z.string().optional().describe("新价格"),
    },
    async ({ instId, ordId, newSz, newPx }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body: any = {}
        if (instId) body.instId = instId
        if (ordId) body.ordId = ordId
        if (newSz) body.newSz = newSz
        if (newPx) body.newPx = newPx
        const data = await privateApi.amendOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_fills",
    "## 功能：事件合约成交记录\n## 场景：查 fills\n## 关键词：event fills\n## 参数：\n##   - instId?, limit?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：fills\n## 关联：place → fills",
    {
      instId: z.string().optional().describe("可选"),
      limit: z.number().optional().describe("可选"),
    },
    async ({ instId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (instId) params.instId = instId
        if (limit) params.limit = limit
        const data = await privateApi.getFills(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_instruments",
    "## 功能：查询可交易事件合约\n## 场景：发现 EVENTS 品种\n## 关键词：event instruments\n## 参数：\n##   - seriesId?\n## 鉴权：PUBLIC\n## 风险：只读\n## 返回量：合约列表\n## 关联：本工具 → place event order",
    {
      seriesId: z.string().optional().describe("可选系列ID"),
    },
    async ({ seriesId }) => {
      try {
        const params: any = { instType: "EVENTS" }
        if (seriesId) params.seriesId = seriesId
        const data = await publicApi.getInstruments("EVENTS", seriesId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}

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

  // ── T-003 Outcomes 订单 (EIP-712) ───────────────────────────────────────
  server.tool(
    "okx_predictions_place_order",
    "## 功能：Outcomes 预测市场下单（需要 EIP-712 签名）\n## 场景：下 YES/NO 仓位\n## 关键词：预测下单, predictions order, EIP712\n## 参数：\n##   - marketId: 市场ID\n##   - side: buy/sell\n##   - size: 数量\n##   - outcome: yes/no\n##   - price: 限价时必填\n## 鉴权：需要 OKX Key + AGENT_PRIVATE_KEY (EVM)\n## 风险：真实下单，有资金风险\n## 返回量：订单结果\n## 关联：先 outcomes_get_market → 本工具下单 → okx_predictions_get_order 查状态",
    {
      marketId: z.string().describe("市场ID"),
      side: z.enum(["buy", "sell"]).describe("buy/sell"),
      size: z.string().describe("数量"),
      outcome: z.enum(["yes", "no"]).describe("yes/no"),
      price: z.string().optional().describe("限价价格"),
    },
    async ({ marketId, side, size, outcome, price }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      const privateKey = process.env.AGENT_PRIVATE_KEY
      if (!privateKey) return toError(new Error("未配置 AGENT_PRIVATE_KEY"))
      try {
        const body: any = { marketId, side, size, outcome }
        if (price) body.price = price
        const data = await privateApi.createPredictionsOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_cancel_order",
    "## 功能：撤销 Outcomes 订单\n## 场景：撤单\n## 关键词：预测撤单\n## 参数：\n##   - orderId: 订单ID\n## 鉴权：需要 Key\n## 风险：撤单\n## 返回量：结果\n## 关联：place → 本工具撤单",
    { orderId: z.string().describe("订单ID") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.cancelPredictionsOrder(auth, { orderId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_cancel_all",
    "## 功能：撤销全部 Outcomes 订单\n## 场景：清仓\n## 关键词：预测全撤\n## 参数：\n##   - assetIds: 可选\n## 鉴权：需要 Key\n## 风险：全撤\n## 返回量：结果\n## 关联：批量撤单",
    { assetIds: z.string().optional().describe("可选资产ID列表") },
    async ({ assetIds }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body = assetIds ? { assetIds } : {}
        const data = await privateApi.cancelAllPredictionsOrders(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_heartbeat",
    "## 功能：Outcomes 心跳保活\n## 场景：防止断线撤单\n## 关键词：预测心跳\n## 参数：无\n## 鉴权：需要 Key\n## 风险：无\n## 返回量：结果\n## 关联：下单后定时调用",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.predictionsHeartbeat(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_get_order",
    "## 功能：查询 Outcomes 订单详情\n## 场景：查单\n## 关键词：预测订单详情\n## 参数：\n##   - orderId\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：订单信息\n## 关联：place → 本工具",
    { orderId: z.string().describe("订单ID") },
    async ({ orderId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.getPredictionsOrder(auth, orderId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_order_list",
    "## 功能：查询 Outcomes 订单列表\n## 场景：查历史单\n## 关键词：预测订单列表\n## 参数：\n##   - marketId?, status?, limit?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：列表\n## 关联：place → 本工具",
    {
      marketId: z.string().optional().describe("可选市场ID"),
      status: z.string().optional().describe("可选状态"),
      limit: z.number().optional().describe("可选数量"),
    },
    async ({ marketId, status, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (marketId) params.marketId = marketId
        if (status) params.status = status
        if (limit) params.limit = limit
        const data = await privateApi.getPredictionsOrders(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── T-004 Outcomes 持仓 & 账户 ─────────────────────────────────────────
  server.tool(
    "okx_predictions_positions",
    "## 功能：查询 Outcomes 持仓\n## 场景：查仓位\n## 关键词：预测持仓\n## 参数：\n##   - marketId?, status?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：持仓列表\n## 关联：place → 本工具",
    {
      marketId: z.string().optional().describe("可选"),
      status: z.string().optional().describe("可选"),
    },
    async ({ marketId, status }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (marketId) params.marketId = marketId
        if (status) params.status = status
        const data = await privateApi.getPredictionsPositions(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_split",
    "## 功能：xp 拆分为 YES+NO\n## 场景：持仓转换\n## 关键词：预测 split\n## 参数：\n##   - amount\n## 鉴权：需要 Key + EIP712\n## 风险：资金操作\n## 返回量：结果\n## 关联：positions → 本工具",
    { amount: z.string().describe("金额") },
    async ({ amount }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.splitPredictionsPosition(auth, { amount })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_merge",
    "## 功能：YES+NO 合并为 xp\n## 场景：持仓转换\n## 关键词：预测 merge\n## 参数：\n##   - amount\n## 鉴权：需要 Key + EIP712\n## 风险：资金操作\n## 返回量：结果\n## 关联：split 逆操作",
    { amount: z.string().describe("金额") },
    async ({ amount }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.mergePredictionsPosition(auth, { amount })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_redeem",
    "## 功能：事件结算后赎回赢家代币\n## 场景：结算赎回\n## 关键词：预测 redeem\n## 参数：\n##   - assetId?\n## 鉴权：需要 Key + EIP712\n## 风险：资金操作\n## 返回量：结果\n## 关联：事件结束后调用",
    { assetId: z.string().optional().describe("可选资产ID") },
    async ({ assetId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body = assetId ? { assetId } : {}
        const data = await privateApi.redeemPredictions(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_balance",
    "## 功能：查询 xp 余额\n## 场景：查预测账户余额\n## 关键词：预测余额\n## 参数：无\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：余额\n## 关联：positions 相关",
    {},
    async () => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const data = await privateApi.getPredictionsBalance(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_trades",
    "## 功能：查询 Outcomes 成交记录\n## 场景：查 fills\n## 关键词：预测成交\n## 参数：\n##   - marketId?, limit?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：成交列表\n## 关联：order 相关",
    {
      marketId: z.string().optional().describe("可选"),
      limit: z.number().optional().describe("可选"),
    },
    async ({ marketId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (marketId) params.marketId = marketId
        if (limit) params.limit = limit
        const data = await privateApi.getPredictionsTrades(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── T-005 Event Contracts (EVENTS instType) ────────────────────────────
  server.tool(
    "okx_event_place_order",
    "## 功能：事件合约下单\n## 场景：主站 EVENTS 合约交易\n## 关键词：event contract, EVENTS, outcome\n## 参数：\n##   - instId, side, sz, outcome, px?, ordType?\n## 鉴权：需要 Key\n## 风险：真实交易\n## 返回量：订单结果\n## 关联：okx_event_instruments → 本工具 (必须 outcome+speedBump)",
    {
      instId: z.string().describe("合约ID"),
      side: z.enum(["buy", "sell"]).describe("buy/sell"),
      sz: z.string().describe("数量"),
      outcome: z.enum(["yes", "no"]).describe("必填 yes/no"),
      px: z.string().optional().describe("价格"),
      ordType: z.string().optional().describe("订单类型"),
    },
    async ({ instId, side, sz, outcome, px, ordType }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body: any = { instId, side, sz, outcome, speedBump: "1" }
        if (px) body.px = px
        if (ordType) body.ordType = ordType
        const data = await privateApi.placeOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_cancel_order",
    "## 功能：事件合约撤单\n## 场景：撤 EVENTS 单\n## 关键词：event cancel\n## 参数：\n##   - instId?, ordId?\n## 鉴权：需要 Key\n## 风险：撤单\n## 返回量：结果\n## 关联：place → cancel",
    {
      instId: z.string().optional().describe("可选"),
      ordId: z.string().optional().describe("可选"),
    },
    async ({ instId, ordId }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body: any = {}
        if (instId) body.instId = instId
        if (ordId) body.ordId = ordId
        const data = await privateApi.cancelOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_amend_order",
    "## 功能：事件合约改单\n## 场景：改 EVENTS 单\n## 关键词：event amend\n## 参数：\n##   - instId?, ordId?, newSz?, newPx?\n## 鉴权：需要 Key\n## 风险：改单\n## 返回量：结果\n## 关联：place → amend",
    {
      instId: z.string().optional().describe("可选"),
      ordId: z.string().optional().describe("可选"),
      newSz: z.string().optional().describe("新数量"),
      newPx: z.string().optional().describe("新价格"),
    },
    async ({ instId, ordId, newSz, newPx }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const body: any = {}
        if (instId) body.instId = instId
        if (ordId) body.ordId = ordId
        if (newSz) body.newSz = newSz
        if (newPx) body.newPx = newPx
        const data = await privateApi.amendOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_fills",
    "## 功能：事件合约成交记录\n## 场景：查 fills\n## 关键词：event fills\n## 参数：\n##   - instId?, limit?\n## 鉴权：需要 Key\n## 风险：只读\n## 返回量：fills\n## 关联：place → fills",
    {
      instId: z.string().optional().describe("可选"),
      limit: z.number().optional().describe("可选"),
    },
    async ({ instId, limit }) => {
      const auth = getAuth()
      if (!auth) return toError(new Error("AUTH_REQUIRED"))
      try {
        const params: any = {}
        if (instId) params.instId = instId
        if (limit) params.limit = limit
        const data = await privateApi.getFills(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_event_instruments",
    "## 功能：查询可交易事件合约\n## 场景：发现 EVENTS 品种\n## 关键词：event instruments\n## 参数：\n##   - seriesId?\n## 鉴权：PUBLIC\n## 风险：只读\n## 返回量：合约列表\n## 关联：本工具 → place event order",
    {
      seriesId: z.string().optional().describe("可选系列ID"),
    },
    async ({ seriesId }) => {
      try {
        const params: any = { instType: "EVENTS" }
        if (seriesId) params.seriesId = seriesId
        const data = await publicApi.getInstruments("EVENTS", seriesId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
