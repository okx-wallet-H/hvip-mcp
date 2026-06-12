import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE } from "./shared.js"

export function registerTradingTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_place_order",
    "## 功能：在OKX下单（市价/限价/只挂/全部成交或取消/立即成交并取消剩余）\n## 场景：用于开仓做多/做空、限价挂单、市价快速成交、只挂单不成交（post_only）\n## 关键词：下单, place order, 市价单, 限价单, 开仓, 平仓, 买入, 卖出\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - tdMode: 交易模式。cash=现货, isolated=逐仓, cross=全仓\n##   - side: 买卖方向。buy=买入, sell=卖出\n##   - ordType: 订单类型。market=市价, limit=限价, post_only=只挂, fok=全成或取消, ioc=立即成交并取消\n##   - sz: 委托数量（根据产品不同可为张数或币数，下单前建议先用 okx_convert_contract_coin 换算）\n##   - px: 委托价格（限价单必填）\n## 鉴权：🔴 需要 API Key（交易）- 会产生真实订单，调用前必须向用户明确确认\n## 风险：WRITE — 创建真实订单，调用前必须向用户确认产品、方向、数量和价格\n## 返回量：微小 ~500B\n## 关联：okx_get_ticker 看价格 → okx_get_balance 确认余额 → 本工具下单 → okx_get_order 确认成交",
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
    "## 功能：撤销指定订单\n## 场景：用于取消未成交的限价单、纠正误下单、清空某产品挂单\n## 关键词：撤单, cancel order, 撤销订单, 取消挂单, 取消委托\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - ordId: 订单ID，由 okx_place_order 返回\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：WRITE — 撤销订单，调用前必须向用户确认\n## 返回量：微小 ~300B\n## 关联：okx_place_order 下单 → okx_get_orders_pending 查看挂单 → 本工具撤单 → okx_get_order 确认撤销",
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
    "## 功能：修改未成交订单的价格或数量\n## 场景：用于调整限价单价格跟进市场、减少委托数量、修改挂单参数\n## 关键词：改单, amend order, 修改订单, 改价, 改量, 调整委托\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - ordId: 订单ID\n##   - newSz: 新委托数量（可选）\n##   - newPx: 新委托价格（可选）\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：WRITE — 修改订单，调用前必须向用户确认\n## 返回量：微小 ~300B\n## 关联：okx_get_orders_pending 查看挂单 → 本工具改单 → okx_get_order 确认修改",
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
    "## 功能：查询当前所有未成交挂单列表\n## 场景：用于监控未成交订单、检查限价单是否仍在队列中、批量查看挂单状态\n## 关键词：挂单查询, orders pending, 未成交订单, 限价单状态, 委托列表, 当前挂单\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部\n##   - instId: 产品ID，精确筛选\n##   - ordType: 订单类型筛选。market/limit/post_only/fok/ioc\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_place_order 下单 → 本工具查看挂单 → okx_cancel_order 撤单 / okx_amend_order 改单",
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
    "## 功能：查询最近的成交明细（逐笔成交），含成交价、成交量和手续费\n## 场景：用于精确计算成交均价、核对每笔成交手续费、比订单历史更细粒度地复盘\n## 关键词：成交明细, fills, 逐笔成交, 成交记录, 手续费明细, 均价计算\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n##   - instId: 产品ID\n##   - limit: 返回条数，默认100，最大100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~10KB — 中等\n## 关联：okx_place_order 下单 → 本工具看成交明细 → okx_get_fills_history 查历史成交",
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
    "## 功能：查询3个月以前的完整历史订单（归档数据）\n## 场景：用于长期交易记录分析、年度交易复盘、审计归档数据\n## 关键词：归档订单, orders history archive, 历史归档, 长期记录, 订单存档\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n##   - limit: 返回条数，默认50，最大100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_orders_history 查近期订单 → 本工具查归档 → 完整交易复盘",
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
    "## 功能：设置定时全撤（N秒后自动撤销所有挂单）\n## 场景：用于极端行情下启动紧急撤单倒计时、程序化风险控制、超时自动清空挂单\n## 关键词：定时全撤, cancel all after, 倒计时撤单, 紧急风控, 自动撤单\n## 参数：\n##   - timeOut: 倒计时秒数。0=取消定时全撤, 正数=设N秒后全撤。最大120秒\n## 鉴权：🔴 需要 API Key（交易）- 风控核心工具，调用前必须确认\n## 风险：FUND_TRANSFER — 定时撤销所有挂单，影响范围极大，调用前必须向用户确认\n## 返回量：微小 ~300B\n## 关联：okx_get_orders_pending 确认当前挂单 → 本工具设倒计时 → 到时间自动撤销",
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
    "## 功能：查询当前账户的API频率限制使用情况\n## 场景：用于高频交易前检查剩余配额、避免触发限频、调整请求节奏\n## 关键词：频率限制, rate limit, API配额, 限频查询, 剩余次数\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：本工具查看剩余配额 → 高频下单前确认 → 避免 HTTP 429 错误",
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
    "## 功能：闪兑（一键兑换不同币种）\n## 场景：用于快速兑换USDT到BTC/ETH等、小额换币需求、无需挂单即时成交\n## 关键词：闪兑, easy convert, 币种兑换, 一键换币, 快速兑换\n## 参数：\n##   - fromCcy: 卖出币种，如 USDT。必填\n##   - toCcy: 买入币种，如 BTC。必填\n##   - sz: 卖出数量。必填\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认兑换币种和数量\n## 风险：FUND_TRANSFER — 产生真实兑换交易，调用前必须向用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_ticker 看当前价 → 本工具闪兑 → okx_get_easy_convert_history 查记录",
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
    "## 功能：查询闪兑历史记录\n## 场景：用于复盘闪兑交易、核对兑换汇率、统计换币成本\n## 关键词：闪兑历史, easy convert history, 兑换记录, 换币历史\n## 参数：\n##   - after: 查询此时间之后的记录（毫秒Unix时间戳）\n##   - before: 查询此时间之前的记录（毫秒Unix时间戳）\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_easy_convert 闪兑 → 本工具查历史 → okx_get_account_bills 对账",
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
    "## 功能：查询MMP（做市商保护）配置\n## 场景：用于查看当前做市商保护参数、确认风控设置\n## 关键词：做市商保护, MMP, mmp config, 做市商风控, 市场保护\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：本工具查看配置 → okx_set_mmp_config 修改",
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
    "## 功能：设置MMP（做市商保护）参数\n## 场景：用于配置做市商风控参数、保护做市策略\n## 参数：\n##   - instFamily: 产品族，如 BTC-USD。必填\n##   - timeInterval: 时间窗口（毫秒）。必填\n##   - frozenInterval: 冻结时间（毫秒）。必填\n##   - limit: 限制量。必填\n## 鉴权：🔴 需要 API Key（交易）- 修改MMP参数影响做市策略，调用前必须确认\n## 风险：ADMIN — 修改风控配置可能影响交易执行，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_mmp_config 查看当前 → 本工具修改 → 生效",
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
    "## 功能：查询指定策略委托的详情\n## 场景：用于追踪策略委托状态、查看触发条件和执行结果\n## 关键词：策略委托详情, order algo, 策略单查询, 条件单详情\n## 参数：\n##   - algoId: 策略委托ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_orders_algo_pending 查看策略列表 → 本工具查详情",
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
    "## 功能：重置MMP（做市商保护）状态\n## 场景：用于在触发MMP保护后手动重置、恢复做市交易\n## 关键词：重置MMP, reset mmp, 做市商重置, MMP复位\n## 参数：\n##   - instFamily: 产品族，如 BTC-USD。必填\n## 鉴权：🔴 需要 API Key（交易）- 将重置MMP保护状态，调用前必须确认\n## 风险：WRITE — 重置MMP后做市商可恢复交易，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_mmp_config 查看MMP状态 → 本工具重置 → 恢复正常做市",
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
    "## 功能：查询3个月以前的完整历史订单（归档数据）\n## 场景：用于长期交易记录分析、年度复盘\n## 关键词：归档订单, orders archive, 历史归档, 订单存档\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n##   - limit: 返回条数，默认50，最大100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_orders_history 查近期订单 → 本工具查归档 → 完整复盘",
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
    "## 功能：通过客户端自定义ID查询订单详情\n## 场景：用于追踪使用自定义订单ID下单后的执行状态、在自有系统中关联订单\n## 关键词：订单ID, clOrdId, 自定义订单, 客户端ID, 订单查询\n## 参数：\n##   - instId: 产品ID。必填\n##   - clOrdId: 客户端自定义订单ID。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：okx_place_order 下单时设置clOrdId → 本工具查询 → 确认订单状态",
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
    "## 功能：获取一键还款支持的币种列表\n## 场景：用于查看哪些币种支持一键还款、了解可还款的债务类型\n## 关键词：一键还款, one click repay, 还款币种, 债务偿还\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看支持币种 → okx_one_click_repay 执行还款",
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
    "## 功能：执行一键还款（使用账户资金自动偿还借币债务）\n## 场景：用于快速偿还杠杆借贷利息、避免利息累积\n## 参数：\n##   - ccy: 还款使用的币种。必填\n##   - repayCcy: 要偿还的债务币种。必填\n## 鉴权：🔴 需要 API Key（交易）- 将使用账户资金还款，调用前必须确认\n## 风险：FUND_TRANSFER — 还款移动真实资金，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_one_click_repay_list 查支持币种 → 本工具还款 → okx_one_click_repay_history 查记录",
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
    "## 功能：查询一键还款历史记录\n## 场景：用于查看以往的还款操作、核对还款金额和币种\n## 关键词：还款历史, repay history, 一键还款记录, 债务偿还记录\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_one_click_repay 还款 → 本工具查记录 → 确认还款完成",
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
    "## 功能：获取闪兑支持的币种列表\n## 场景：用于查看哪些币种支持闪兑\n## 关键词：闪兑列表, easy convert list, 闪兑币种\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
