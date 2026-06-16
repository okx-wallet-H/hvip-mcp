import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE } from "./shared.js"

export function registerTradingTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_place_order",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT"),
      tdMode:  z.enum(["cash","isolated","cross"]).describe("交易模式：cash=现货，isolated=逐仓，cross=全仓"),
      side:    z.enum(["buy","sell"]).describe("买卖方向"),
      ordType: z.enum(["market","limit","post_only","fok","ioc"]).describe("订单类型"),
      sz:      z.string().describe("委托数量"),
      px:      z.string().optional().describe("委托价格（限价单必填）"),
    },
    async ({ instId, tdMode, side, ordType, sz, px }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, tdMode, side, ordType, sz }
        if (px) body["px"] = px
        const data = await privateApi.placeOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_order",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID"),
      ordId:  z.string().describe("订单ID"),
    },
    async ({ instId, ordId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelOrder(auth, instId, ordId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_order",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID"),
      ordId:  z.string().describe("订单ID"),
      newSz:  z.string().optional().describe("新委托数量"),
      newPx:  z.string().optional().describe("新委托价格"),
    },
    async ({ instId, ordId, newSz, newPx }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, ordId }
        if (newSz) body["newSz"] = newSz
        if (newPx) body["newPx"] = newPx
        const data = await privateApi.amendOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_orders_pending",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部"),
      instId:   z.string().optional().describe("产品ID，精确筛选"),
      ordType:  z.enum(["market","limit","post_only","fok","ioc"]).optional().describe("订单类型筛选"),
    },
    async ({ instType, instId, ordType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersPending(auth, instType, instId, ordType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_fills",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId:   z.string().optional().describe("产品ID"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instType, instId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFills(auth, instType, instId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_orders_history_archive",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认50"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersHistoryArchive(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_batch_orders",
    `## 功能：批量下单（最多20笔）
## 场景：用于需要同时下多个订单的策略（如一篮子建仓、多产品套利布局）
## 关键词：批量下单, 批量委托, batch orders, 一篮子订单, 组合下单
## 参数：
##   - orders: 订单数组（JSON数组字符串），每项含 instId/tdMode/side/ordType/sz/px 等字段。最多20笔
## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认每笔订单内容
## 风险：WRITE — 创建订单，调用前必须向用户逐笔确认
## 返回量：微小 ~2KB
## 关联：okx_get_instruments 获取产品列表 → 本工具批量下单 → okx_batch_cancel_orders 撤销`,
    {
      orders: z.string().describe("订单数组JSON字符串，如 '[{\"instId\":\"BTC-USDT\",\"tdMode\":\"cash\",\"side\":\"buy\",\"ordType\":\"limit\",\"sz\":\"0.001\",\"px\":\"60000\"}]'。最多20笔"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.batchOrders(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_batch_cancel_orders",
    `## 功能：批量撤销订单
## 场景：用于一键撤销所有未成交挂单、清空特定产品的订单队列
## 关键词：批量撤单, 批量撤销, batch cancel, 一键撤单, 清空挂单
## 参数：
##   - orders: 撤单数组（JSON数组字符串），每项含 instId/ordId。不填instId则撤销该产品所有挂单
## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认
## 风险：WRITE — 撤销订单，调用前必须向用户确认
## 返回量：微小 ~2KB
## 关联：okx_get_orders_pending 查看挂单 → 本工具批量撤销 → okx_get_orders_history 确认撤销`,
    {
      orders: z.string().describe("撤单数组JSON字符串，如 '[{\"instId\":\"BTC-USDT\",\"ordId\":\"123456\"}]'"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.cancelBatchOrders(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_close_position",
    `## 功能：市价全平某仓位
## 场景：用于紧急平仓止损/止盈、清空某方向全部持仓
## 关键词：平仓, 市价全平, close position, 止损平仓, 清仓, 紧急平仓
## 参数：
##   - instId: 产品ID，如 BTC-USDT-SWAP。必填
##   - posSide: 持仓方向。long=平多头, short=平空头。不填则按mgnMode自动判断
##   - mgnMode: 保证金模式。cross=全仓, isolated=逐仓
##   - ccy: 保证金币种（全仓时选填）
## 鉴权：🔴 需要 API Key（交易）- 风控核心工具，调用前必须二次确认
## 风险：FUND_TRANSFER — 平仓操作直接影响持仓和资金，调用前必须向用户确认
## 返回量：微小 ~300B
## 关联：okx_get_positions 确认持仓 → 本工具市价全平 → okx_get_orders_history 确认成交`,
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      posSide: z.enum(["long","short"]).optional().describe("持仓方向。long=平多头, short=平空头。全仓必填"),
      mgnMode: z.enum(["cross","isolated"]).optional().describe("保证金模式"),
      ccy:     z.string().optional().describe("保证金币种（全仓可选填）"),
    },
    async ({ instId, posSide, mgnMode, ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId }
        if (posSide) body.posSide = posSide
        if (mgnMode) body.mgnMode = mgnMode
        if (ccy) body.ccy = ccy
        const data = await privateApi.closePosition(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_batch_orders",
    `## 功能：批量修改未成交订单
## 场景：用于同时调整多个限价单的价格或数量、批量更新挂单策略
## 关键词：批量改单, 批量修改, amend batch orders, 批量改价, 批量调量
## 参数：
##   - orders: 改单数组（JSON数组字符串），每项含 instId/ordId/newSz/newPx。最多20笔
## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认
## 风险：WRITE — 修改订单，调用前必须向用户确认
## 返回量：微小 ~2KB
## 关联：okx_get_orders_pending 查看挂单 → 本工具批量改单 → okx_get_order 确认修改`,
    {
      orders: z.string().describe("改单数组JSON字符串，如 '[{\"instId\":\"BTC-USDT\",\"ordId\":\"123\",\"newPx\":\"62000\"}]'。最多20笔"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.amendBatchOrders(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_fills_history",
    `## 功能：查询历史成交明细（最近3个月）
## 场景：用于精确计算历史成交均价、复盘交易表现、核对成交记录
## 关键词：成交历史, 成交明细, fills history, 历史成交, 逐笔成交历史
## 参数：
##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。可选
##   - instId: 产品ID，如 BTC-USDT。可选
##   - limit: 返回条数，默认100
## 鉴权：⚠️ 需要 API Key（只读）
## 风险：READ — 只读查询，Agent 可自动调用
## 返回量：中等 ~10KB
## 关联：okx_get_fills 查最近成交 → 本工具查历史成交 → okx_get_orders_history 对账`,
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instType, instId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFillsHistory(auth, instType, instId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_mass_cancel",
    `## 功能：批量撤销某产品类型下所有挂单
## 场景：用于极端行情下紧急清空所有挂单、快速重置交易策略
## 关键词：批量撤单, 全部撤单, mass cancel, 清空挂单, 紧急撤单
## 参数：
##   - instType: 产品类型。SPOT/MARGIN/SWAP/FUTURES/OPTION。必填
##   - instFamily: 产品族，如 BTC-USDT。可选（仅合约需要）
## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认
## 风险：WRITE — 撤销所有挂单，影响范围大，调用前必须确认
## 返回量：微小 ~500B
## 关联：okx_get_orders_pending 确认挂单 → 本工具全部撤销 → okx_get_orders_history 确认`,
    {
      instType:   z.enum(INST_TYPE_TRADE).describe("产品类型"),
      instFamily: z.string().optional().describe("产品族，如 BTC-USDT。仅合约需填"),
    },
    async ({ instType, instFamily }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.massCancel(auth, instType, instFamily)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_all_after",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      timeOut: z.string().describe("倒计时秒数，0=取消定时全撤，正数=设N秒后全撤，最大120秒"),
    },
    async ({ timeOut }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelAllAfter(auth, { timeOut })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_order_precheck",
    `## 功能：下单预检（验证订单参数是否合法，不实际下单）
## 场景：用于下单前验证参数正确性、检查余额和风控限制、避免因参数错误导致的订单失败
## 关键词：下单预检, 预检查, order precheck, 订单验证, 参数检查
## 参数：
##   - params: 订单参数JSON对象，与 okx_place_order 参数相同。必填
## 鉴权：⚠️ 需要 API Key（只读）
## 风险：READ — 只读预检，不产生实际订单，Agent 可自动调用
## 返回量：微小 ~500B
## 关联：okx_place_order 下单前 → 本工具预检参数 → 通过后正式下单`,
    {
      params: z.string().describe("订单参数JSON字符串，如 '{\"instId\":\"BTC-USDT\",\"tdMode\":\"cash\",\"side\":\"buy\",\"ordType\":\"limit\",\"sz\":\"0.001\",\"px\":\"60000\"}'"),
    },
    async ({ params }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(params) as Record<string, unknown>
        const data = await privateApi.orderPrecheck(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_rate_limit",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountRateLimit(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_easy_convert",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      fromCcy: z.string().describe("卖出币种，如 USDT"),
      toCcy:   z.string().describe("买入币种，如 BTC"),
      sz:      z.string().describe("卖出数量"),
    },
    async ({ fromCcy, toCcy, sz }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.easyConvert(auth, { fromCcy, toCcy, sz })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_easy_convert_history",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      after:  z.string().optional().describe("查询此时间之后的记录（毫秒Unix时间戳）"),
      before: z.string().optional().describe("查询此时间之前的记录（毫秒Unix时间戳）"),
      limit:  z.string().optional().describe("返回条数，默认100"),
    },
    async ({ after, before, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEasyConvertHistory(auth, after, before, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 交易收尾（第十三批新增） ────────────────────────────────────────────────

  server.tool(
    "okx_get_mmp_config",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMmpConfig(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_mmp_config",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instFamily:     z.string().describe("产品族，如 BTC-USD。必填"),
      timeInterval:   z.string().describe("时间窗口（毫秒）。必填"),
      frozenInterval: z.string().describe("冻结时间（毫秒）。必填"),
      limit:          z.string().describe("限制量。必填"),
    },
    async ({ instFamily, timeInterval, frozenInterval, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setMmpConfig(auth, { instFamily, timeInterval, frozenInterval, limit })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_order_algo",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      algoId: z.string().optional().describe("策略委托ID"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrderAlgo(auth, algoId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
  // ── 交易收尾（第二批新缺口） ────────────────────────────────────────────────

  server.tool(
    "okx_reset_mmp",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instFamily: z.string().describe("产品族，如 BTC-USD。必填"),
    },
    async ({ instFamily }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.resetMmp(auth, { instFamily })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_orders_archive",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认50"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersHistoryArchive(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_order_by_clOrdId",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      instId:  z.string().describe("产品ID。必填"),
      clOrdId: z.string().describe("客户端自定义订单ID。必填"),
    },
    async ({ instId, clOrdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrderByClientId(auth, instId, clOrdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 一键还款（v0.2.26 新缺口） ─────────────────────────────────────────────

  server.tool(
    "okx_get_one_click_repay_list",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOneClickRepayCurrencyList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_one_click_repay",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {
      ccy:      z.string().describe("还款使用的币种。必填"),
      repayCcy: z.string().describe("要偿还的债务币种。必填"),
    },
    async ({ ccy, repayCcy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.oneClickRepay(auth, { ccy, repayCcy })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_one_click_repay_history",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOneClickRepayHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_easy_convert_currency_list",
    "CAT:[交易] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEasyConvertCurrencyList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
