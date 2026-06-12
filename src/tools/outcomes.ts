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
}
