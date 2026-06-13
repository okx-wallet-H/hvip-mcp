import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE } from "./shared.js"

export function registerAlgoTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_algo_orders",
    "CAT:[交易-委托] | ## 功能：查询当前挂单中的策略委托单（止盈止损、冰山、时间加权等）\n## 场景：用于查看当前生效的策略单、监控止盈止损挂单、检查冰山/TWAP执行状态\n## 关键词：策略委托, algo orders, 止盈止损, 条件单, 冰山委托, TWAP, 策略单查询\n## 参数：\n##   - ordType: 策略类型。conditional=条件单, oco=OCO订单, trigger=触发单, move_order_stop=移动止损, iceberg=冰山, twap=时间加权\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_place_algo_order 下策略单 → 本工具查看挂单 → okx_cancel_algo_order 撤销",
    {
      ordType:  z.enum(["conditional","oco","trigger","move_order_stop","iceberg","twap"]).describe("策略类型"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
    },
    async ({ ordType, instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAlgoOrders(auth, ordType, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_algo_orders_history",
    "CAT:[交易-委托] | ## 功能：查询历史策略委托单记录（已触发/已撤销/失败的策略单）\n## 场景：用于复盘策略单执行情况、分析止盈止损触发历史、排查策略失败原因\n## 关键词：策略历史, algo orders history, 策略记录, 历史条件单, 止盈止损历史, 策略复盘\n## 参数：\n##   - ordType: 策略类型。conditional=条件单, oco=OCO, trigger=触发单, move_order_stop=移动止损, iceberg=冰山, twap=时间加权\n##   - state: 订单状态。effective=已生效, canceled=已撤销, order_failed=失败\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_algo_orders 查看当前挂单 → 本工具查历史 → 分析策略效果",
    {
      ordType:  z.enum(["conditional","oco","trigger","move_order_stop","iceberg","twap"]).describe("策略类型"),
      state:    z.enum(["effective","canceled","order_failed"]).describe("订单状态"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
    },
    async ({ ordType, state, instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAlgoOrdersHistory(auth, ordType, state, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_place_algo_order",
    "CAT:[交易-委托] | ## 功能：下策略委托单（止盈止损、条件单、OCO等），在满足条件时自动触发下单\n## 场景：用于设置止盈止损自动平仓、在价格突破时自动开仓、设置OCO二选一订单\n## 关键词：下策略单, place algo, 止盈止损下单, 条件单, OCO下单, 自动触发\n## 参数：\n##   - params: 订单参数（JSON对象），参考OKX文档。含 instId/tdMode/side/ordType/sz/px 及策略参数如 slTriggerPx/tpTriggerPx\n## 鉴权：🔴 需要 API Key（交易）- 会产生真实策略订单，调用前必须向用户确认\n## 风险：WRITE — 创建策略订单，可能自动触发真实交易，调用前必须向用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_algo_orders 查看当前策略 → 本工具下策略单 → okx_get_algo_orders 确认",
    { params: z.record(z.unknown()).describe("订单参数，参考OKX文档") },
    async ({ params }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.placeAlgoOrder(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_algo_order",
    "CAT:[交易-委托] | ## 功能：撤销指定的策略委托单\n## 场景：用于取消不再需要的止盈止损、关闭条件单、调整策略前先撤旧单\n## 关键词：撤销策略, cancel algo, 取消止盈止损, 撤策略单, 取消条件单\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - algoId: 策略订单ID，由 okx_place_algo_order 返回\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：WRITE — 撤销策略订单，调用前必须向用户确认\n## 返回量：微小 ~300B\n## 关联：okx_get_algo_orders 查看策略列表 → 本工具撤销 → okx_get_algo_orders_history 确认撤销",
    {
      instId: z.string().describe("产品ID"),
      algoId: z.string().describe("策略订单ID"),
    },
    async ({ instId, algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelAlgoOrder(auth, [{ instId, algoId }])
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_orders_algo_pending",
    "CAT:[交易-委托] | ## 功能：查询待触发的策略委托单（更灵活的查询方式）\n## 场景：用于查看所有待触发策略、按产品或ID精确查找策略单、监控自动交易状态\n## 关键词：策略挂单, orders algo pending, 待触发, 条件单查询, 止盈止损查询\n## 参数：\n##   - algoId: 策略订单ID，精确查询\n##   - instType: 产品类型。SPOT/MARGIN/SWAP/FUTURES/OPTION\n##   - instId: 产品ID，如 BTC-USDT\n##   - ordType: 策略类型。conditional/trigger/oco/move_order_stop/iceberg/twap\n##   - limit: 返回条数\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查询待触发策略 → okx_place_algo_order 下策略单 → okx_cancel_algo_order 撤销",
    {
      algoId:   z.string().optional().describe("策略订单ID，精确查询"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT"),
      ordType:  z.enum(["conditional","oco","trigger","move_order_stop","iceberg","twap"]).optional().describe("策略类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数"),
    },
    async ({ algoId, instType, instId, ordType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersAlgoPending(auth, algoId, instType, instId, ordType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_algo_order",
    "CAT:[交易-委托] | ## 功能：修改策略委托单（止盈止损价格、触发条件等）\n## 场景：用于调整止盈止损价格、修改触发条件、更新策略单参数\n## 关键词：修改策略, amend algo, 调整止盈止损, 修改条件单, 更新策略\n## 参数：\n##   - orders: 修改策略订单数组（JSON数组字符串），每项含 algoId/instId 及需修改的字段（如 newSz/newPx/slTriggerPx/tpTriggerPx）\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：WRITE — 修改策略订单，调用前必须向用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_orders_algo_pending 查询策略 → 本工具修改 → okx_get_algo_orders 确认修改",
    {
      orders: z.string().describe("修改策略订单数组JSON字符串，如 '[{\"algoId\":\"123\",\"instId\":\"BTC-USDT\",\"newTpTriggerPx\":\"65000\"}]'"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.amendAlgoOrder(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
