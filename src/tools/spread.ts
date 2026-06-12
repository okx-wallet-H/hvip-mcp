import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerSpreadTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_spreads",
    "## 功能：获取价差合约产品列表\n## 场景：用于跨期套利策略设计、发现可交易价差合约、筛选特定期限的价差品种\n## 关键词：价差合约, spreads, 跨期套利, 价差列表, 期限套利\n## 参数：\n##   - sprdId: 价差合约ID，如 BTC-USDT_BTC-USDT-SWAP\n##   - baseCcy: 标的币种，如 BTC\n##   - instId: 腿合约产品ID，精确筛选\n##   - state: 合约状态。live=活跃, expired=已到期, suspend=暂停\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB\n## 关联：本工具获取价差合约列表 → okx_get_spread_ticker 查行情 → okx_get_spread_candles 分析走势",
    {
      sprdId:  z.string().optional().describe("价差合约ID，如 BTC-USDT_BTC-USDT-SWAP"),
      baseCcy: z.string().optional().describe("标的币种，如 BTC"),
      instId:  z.string().optional().describe("腿合约产品ID，精确筛选"),
      state:   z.enum(["live","expired","suspend"]).optional().describe("合约状态"),
    },
    async ({ sprdId, baseCcy, instId, state }) => {
      try {
        const data = await publicApi.getSpreads(sprdId, baseCcy, instId, state)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_ticker",
    "## 功能：获取单个价差合约实时行情，含最新价、买卖价差\n## 场景：用于跨期套利监控、价差趋势判断、发现价差回归机会\n## 关键词：价差行情, spread ticker, 跨期套利, 价差价格, 买卖价差\n## 参数：\n##   - sprdId: 价差合约ID，如 BTC-USD-SWAP_BTC-USD-260925\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：先调 okx_get_spreads 获取可用价差合约ID → 本工具查行情 → okx_get_spread_candles 分析走势",
    {
      sprdId: z.string().describe("价差合约ID，如 BTC-USD-SWAP_BTC-USD-260925"),
    },
    async ({ sprdId }) => {
      try {
        const data = await publicApi.getSpreadTicker(sprdId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orderbook",
    "## 功能：获取价差合约订单簿深度\n## 场景：用于分析买卖双方挂单分布、判断价差市场的流动性质量、评估跨期套利滑点\n## 关键词：价差深度, spread orderbook, 价差挂单, 流动性, 套利深度\n## 参数：\n##   - sprdId: 价差合约ID\n##   - depth: 深度档位，默认20，最大400\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB\n## 关联：先调 okx_get_spreads 获取价差合约列表 → 本工具查深度 → okx_get_spread_ticker 判断套利机会",
    {
      sprdId: z.string().describe("价差合约ID"),
      depth:  z.number().int().min(1).max(400).optional().describe("深度档位，默认20，最大400"),
    },
    async ({ sprdId, depth }) => {
      try {
        const data = await publicApi.getSpreadOrderbook(sprdId, depth)
        const enriched = (data as any).data || data
        if (enriched && typeof enriched === 'object' && !Array.isArray(enriched)) {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_trades",
    "## 功能：获取价差合约最新成交记录\n## 场景：用于分析市场参与者对当前价差水平的认可度、判断套利策略有效性\n## 关键词：价差成交, spread trades, 套利成交, 价差交易, 成交记录\n## 参数：\n##   - sprdId: 价差合约ID\n##   - limit: 返回条数，默认20，最大100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_spread_ticker 查行情 → 本工具看最新成交 → okx_get_spread_candles 看走势",
    {
      sprdId: z.string().describe("价差合约ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ sprdId, limit }) => {
      try {
        const data = await publicApi.getSpreadTrades(sprdId, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_candles",
    "## 功能：获取价差合约K线数据\n## 场景：用于研究价差历史走势、识别均值回归机会、计算价差波动率\n## 关键词：价差K线, spread candles, 价差走势, 均值回归, 跨期套利分析\n## 参数：\n##   - sprdId: 价差合约ID\n##   - bar: K线周期。1m/5m/15m/30m=分钟, 1H=1小时, 4H=4小时, 1D=日线。默认1H\n##   - limit: 返回条数，默认100，最大300\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB — 微小\n## 关联：okx_get_spread_ticker 查当前价差 → 本工具看历史走势 → 判断是否处于均值回归区间",
    {
      sprdId: z.string().describe("价差合约ID"),
      bar:    z.enum(["1m","5m","15m","30m","1H","4H","1D"]).optional().describe("K线周期，默认1H"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, bar, limit }) => {
      try {
        const data = await publicApi.getSpreadCandles(sprdId, bar, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  // ── 价差操作类（第十六批新增） ──────────────────────────────────────────────

  server.tool(
    "okx_place_spread_order",
    "## 功能：下价差合约订单\n## 场景：用于执行价差套利交易、下跨期套利单\n## 关键词：价差下单, spread order, 价差交易, 跨期套利, 价差套利\n## 参数：\n##   - sprdId: 价差合约ID。必填\n##   - side: 买卖方向。buy=买入, sell=卖出。必填\n##   - ordType: 订单类型。market=市价, limit=限价。必填\n##   - sz: 数量。必填\n##   - px: 价格（限价单必填）。可选\n## 鉴权：🔴 需要 API Key（交易）- 将提交价差订单，调用前必须向用户确认\n## 风险：WRITE — 下单操作直接影响价差持仓，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_spread_ticker 看行情 → 本工具下单 → okx_get_spread_orders 查订单",
    {
      sprdId:  z.string().describe("价差合约ID。必填"),
      side:    z.enum(["buy","sell"]).describe("买卖方向。buy=买入, sell=卖出"),
      ordType: z.enum(["market","limit","post_only","fok","ioc"]).describe("订单类型。market=市价, limit=限价"),
      sz:      z.string().describe("数量。必填"),
      px:      z.string().optional().describe("价格（限价单必填）"),
    },
    async ({ sprdId, side, ordType, sz, px }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { sprdId, side, ordType, sz }
        if (px) body.px = px
        const data = await privateApi.placeSpreadOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_spread_order",
    "## 功能：撤销价差合约订单\n## 场景：用于取消未成交的价差挂单\n## 关键词：价差撤单, cancel spread, 取消价差, 撤单价差\n## 参数：\n##   - sprdId: 价差合约ID。必填\n##   - ordId: 订单ID。必填\n## 鉴权：🔴 需要 API Key（交易）- 将撤销价差订单，调用前必须向用户确认\n## 风险：WRITE — 撤单操作，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_spread_orders 查看挂单 → 本工具撤销 → 确认撤销成功",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
      ordId:  z.string().describe("订单ID。必填"),
    },
    async ({ sprdId, ordId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelSpreadOrder(auth, { sprdId, ordId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orders",
    "## 功能：查询价差合约当前挂单\n## 场景：用于查看价差合约的未成交订单列表、监控挂单状态\n## 关键词：价差挂单, spread orders, 价差委托, 价差未成交\n## 参数：\n##   - sprdId: 价差合约ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_place_spread_order 下单 → 本工具查看 → okx_cancel_spread_order 撤销",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersPending(auth, sprdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_spread_order",
    "## 功能：修改价差合约未成交订单\n## 场景：用于调整价差挂单的价格或数量\n## 关键词：修改价差, amend spread, 价差改单, 价差改价\n## 参数：\n##   - sprdId: 价差合约ID。必填\n##   - ordId: 订单ID。必填\n##   - newSz: 新数量。可选\n##   - newPx: 新价格。可选\n## 鉴权：🔴 需要 API Key（交易）- 将修改价差订单，调用前必须确认\n## 风险：WRITE — 修改订单，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_spread_orders 查看挂单 → 本工具修改 → 确认修改结果",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
      ordId:  z.string().describe("订单ID。必填"),
      newSz:  z.string().optional().describe("新数量"),
      newPx:  z.string().optional().describe("新价格"),
    },
    async ({ sprdId, ordId, newSz, newPx }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { sprdId, ordId }
        if (newSz) body.newSz = newSz
        if (newPx) body.newPx = newPx
        const data = await privateApi.amendSpreadOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orders_history",
    "## 功能：查询价差合约历史订单\n## 场景：用于查看已完成的历史价差订单、复盘价差交易\n## 关键词：价差历史订单, spread orders history, 价差成交历史\n## 参数：\n##   - sprdId: 价差合约ID。可选\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_spread_orders 查当前挂单 → 本工具查历史 → 复盘交易",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersHistory(auth, sprdId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_fills",
    "## 功能：查询价差合约成交明细\n## 场景：用于查看价差订单的逐笔成交记录、核对成交价格和数量\n## 关键词：价差成交, spread fills, 价差成交明细, 价差逐笔\n## 参数：\n##   - sprdId: 价差合约ID。可选\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_spread_orders 查订单 → 本工具查成交 → 核算成本",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadFills(auth, sprdId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_books",
    "## 功能：获取价差合约全深度订单簿\n## 场景：用于分析价差市场流动性全貌、发现隐藏的大额挂单\n## 关键词：价差全深度, spread books, 价差完整深度, 价差所有档位\n## 参数：\n##   - sprdId: 价差合约ID。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_spread_orderbook 看有限深度 → 本工具看全深度 → 分析流动性",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
    },
    async ({ sprdId }) => {
      try {
        const data = await publicApi.getSpreadOrderbook(sprdId)
        const enriched = (data as any).data || data
        if (enriched && typeof enriched === 'object' && !Array.isArray(enriched)) {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 价差收尾（第一批新缺口 v0.2.25） ──────────────────────────────────────

  server.tool(
    "okx_get_spread_orders_pending",
    "## 功能：查询价差合约当前挂单\n## 场景：用于查看价差合约的未成交订单列表、监控挂单状态\n## 关键词：价差挂单, spread pending, 价差委托, 价差未成交\n## 参数：\n##   - sprdId: 价差合约ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_place_spread_order 下单 → 本工具查看 → okx_cancel_spread_order 撤销",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersPending(auth, sprdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orders_history_archive",
    "## 功能：查询价差合约归档历史订单（3个月前）\n## 场景：用于长期复盘价差交易、年度交易统计\n## 关键词：价差归档, spread archive, 价差历史归档, 价差存档\n## 参数：\n##   - sprdId: 价差合约ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_spread_orders_history 查近期 → 本工具查归档 → 完整复盘",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersHistoryArchive(auth, sprdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_trades_public",
    "## 功能：获取价差合约公开成交记录\n## 场景：用于无需鉴权查看价差市场的成交情况、分析价格走势\n## 关键词：价差公开成交, spread public trades, 公开成交, 价差成交\n## 参数：\n##   - sprdId: 价差合约ID。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_spread_trades 看带详情成交 → 本工具公开查询",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
    },
    async ({ sprdId }) => {
      try {
        const data = await publicApi.getSpreadPublicTrades(sprdId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_trades_fills",
    "## 功能：获取价差合约的成交明细\n## 场景：用于查看价差订单的逐笔成交记录、核对成交价\n## 关键词：价差成交明细, spread fills, 价差逐笔, 价差成交记录\n## 参数：\n##   - sprdId: 价差合约ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_spread_orders 查订单 → 本工具查成交 → 核算成本",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadTradeFills(auth, sprdId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )
}
