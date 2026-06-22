import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE , registerTool} from "./shared.js"

export function registerBotTools(server: McpServer, auth: Auth | null): void {

  // ── 网格交易 ────────────────────────────────────────────────────────────────

  registerTool(
    server,
    "okx_get_grid_ai_param",
    "READ",
    "[D:Strategy] get grid ai param",
    {
      instId:      z.string().describe("产品ID，如 BTC-USDT、BTC-USDT-SWAP"),
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型：grid=现货网格，contract_grid=合约网格，moon_grid=天地网格"),
      direction:   z.enum(["long","short","neutral"]).optional().describe("合约网格方向（仅contract_grid需要）"),
    },
    async ({ instId, algoOrdType, direction }) => {
      try {
        const data = await publicApi.getGridAiParam(instId, algoOrdType, direction)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_grid_orders_pending",
    "READ",
    "[D:Strategy] get grid ai param",
    {
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型"),
      instId:      z.string().optional().describe("产品ID，不填返回全部"),
      instType:    z.enum(INST_TYPE_TRADE).optional().describe("产品类型筛选"),
    },
    async ({ algoOrdType, instId, instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getGridOrdersPending(auth, algoOrdType, instId, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_grid_orders_history",
    "READ",
    "[D:Strategy] get grid ai param",
    {
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型"),
      instId:      z.string().optional().describe("产品ID，不填返回全部"),
      instType:    z.enum(INST_TYPE_TRADE).optional().describe("产品类型筛选"),
    },
    async ({ algoOrdType, instId, instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getGridOrdersHistory(auth, algoOrdType, instId, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_grid_sub_orders",
    "READ",
    "[D:Strategy] get grid ai param",
    {
      algoId:      z.string().describe("网格策略ID"),
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型"),
      type:        z.enum(["filled","unfilled"]).describe("filled=已成交，unfilled=未成交"),
    },
    async ({ algoId, algoOrdType, type }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getGridSubOrders(auth, algoId, algoOrdType, type)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 定投 ────────────────────────────────────────────────────────────────────

  registerTool(
    server,
    "okx_get_recurring_orders_pending",
    "READ",
    "[D:Strategy] get grid ai param",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRecurringOrdersPending(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_recurring_orders_history",
    "READ",
    "[D:Strategy] get grid ai param",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRecurringOrdersHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 定投操作类（第十一批新增） ──────────────────────────────────────────────────

  registerTool(
    server,
    "okx_create_recurring_plan",
    "WRITE",
    "[D:Strategy] get grid ai param",
    {
      instId:   z.string().describe("定投产品ID。必填"),
      currency: z.string().describe("定投资金币种。必填"),
      amount:   z.string().describe("每期投资数量。必填"),
      period:   z.enum(["daily","weekly","monthly"]).describe("定投周期。daily=每日, weekly=每周, monthly=每月"),
    },
    async ({ instId, currency, amount, period }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.createRecurringPlan(auth, { instId, currency, amount, period })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_stop_recurring_plan",
    "WRITE",
    "[D:Strategy] get grid ai param",
    {
      algoId: z.string().describe("定投计划ID。必填"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.stopRecurringPlan(auth, { algoId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_recurring_sub_orders",
    "READ",
    "[D:Strategy] get grid ai param",
    {
      algoId: z.string().describe("定投计划ID。必填"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ algoId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRecurringSubOrders(auth, algoId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 网格操作类（第十四批新增） ──────────────────────────────────────────────

  registerTool(
    server,
    "okx_create_grid_order",
    "WRITE",
    "[D:Strategy] get grid ai param",
    {
      instId:      z.string().describe("产品ID。必填"),
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型。grid=现货网格, contract_grid=合约网格, moon_grid=天地网格"),
      maxPx:       z.string().describe("价格上限。必填"),
      minPx:       z.string().describe("价格下限。必填"),
      gridNum:     z.string().describe("网格数量。必填"),
      direction:   z.enum(["long","short","neutral"]).optional().describe("合约网格方向。long=做多, short=做空, neutral=中性"),
    },
    async ({ instId, algoOrdType, maxPx, minPx, gridNum, direction }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, algoOrdType, maxPx, minPx, gridNum }
        if (direction) body.direction = direction
        const data = await privateApi.createGridAlgo(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_stop_grid_order",
    "WRITE",
    "[D:Strategy] get grid ai param",
    {
      algoId:      z.string().describe("网格策略ID。必填"),
      instId:      z.string().describe("产品ID。必填"),
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型。grid=现货网格, contract_grid=合约网格, moon_grid=天地网格"),
    },
    async ({ algoId, instId, algoOrdType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.stopGridAlgo(auth, { algoId, instId, algoOrdType })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_close_grid_position",
    "WRITE",
    "[D:Strategy] get grid ai param",
    {
      algoId:      z.string().describe("网格策略ID。必填"),
      algoOrdType: z.enum(["grid","contract_grid","moon_grid"]).describe("网格类型"),
    },
    async ({ algoId, algoOrdType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.closeGridPosition(auth, { algoId, algoOrdType })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_grid_positions",
    "READ",
    "[D:Strategy] get grid ai param",
    {
      algoId: z.string().describe("网格策略ID。必填"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getGridPositions(auth, algoId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
