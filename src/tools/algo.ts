import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE } from "./shared.js"

export function registerAlgoTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_algo_orders",
    "查询当前挂单中的策略委托单（止盈止损、冰山、时间加权等）。⚠️ 需要API Key鉴权。",
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
    "查询历史策略委托单记录。⚠️ 需要API Key鉴权。",
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
    "下策略委托单（止盈止损、条件单等）。⚠️ 此操作会产生真实订单，调用前必须向用户确认。需要API Key鉴权。",
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
    "撤销策略委托单。⚠️ 需要API Key鉴权。",
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
    "## 功能：查询待触发的策略委托单（更灵活的查询方式）\n## 场景：用于查看所有待触发策略、按产品或ID精确查找策略单、监控自动交易状态\n## 关键词：策略挂单, orders algo pending, 待触发, 条件单查询, 止盈止损查询\n## 参数：\n##   - algoId: 策略订单ID，精确查询\n##   - instType: 产品类型。SPOT/MARGIN/SWAP/FUTURES/OPTION\n##   - instId: 产品ID，如 BTC-USDT\n##   - ordType: 策略类型。conditional/trigger/oco/move_order_stop/iceberg/twap\n##   - limit: 返回条数\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查询待触发策略 → okx_place_algo_order 下策略单 → okx_cancel_algo_order 撤销",
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
    "## 功能：修改策略委托单（止盈止损价格、触发条件等）\n## 场景：用于调整止盈止损价格、修改触发条件、更新策略单参数\n## 关键词：修改策略, amend algo, 调整止盈止损, 修改条件单, 更新策略\n## 参数：\n##   - orders: 修改策略订单数组（JSON数组字符串），每项含 algoId/instId 及需修改的字段（如 newSz/newPx/slTriggerPx/tpTriggerPx）\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：WRITE — 修改策略订单，调用前必须向用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_orders_algo_pending 查询策略 → 本工具修改 → okx_get_algo_orders 确认修改",
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
