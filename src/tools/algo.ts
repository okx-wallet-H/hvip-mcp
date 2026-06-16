import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE , registerTool} from "./shared.js"

export function registerAlgoTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "okx_get_algo_orders",
    "READ",
    "CAT:[交易-委托] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_algo_orders_history",
    "READ",
    "CAT:[交易-委托] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_place_algo_order",
    "WRITE",
    "CAT:[交易-委托] | → 请先调用 agent_catalog",
    { params: z.record(z.unknown()).describe("订单参数，参考OKX文档") },
    async ({ params }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.placeAlgoOrder(auth, params)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_cancel_algo_order",
    "WRITE",
    "CAT:[交易-委托] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_orders_algo_pending",
    "READ",
    "CAT:[交易-委托] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_amend_algo_order",
    "WRITE",
    "CAT:[交易-委托] | → 请先调用 agent_catalog",
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
