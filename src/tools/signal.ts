import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE , registerTool} from "./shared.js"

export function registerSignalTools(server: McpServer, auth: Auth | null): void {

  registerTool(
    server,
    "strategy_signal_bots_active",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId:   z.string().optional().describe("指定机器人ID，不填返回全部"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型"),
    },
    async ({ algoId, instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalBotsPending(auth, algoId, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_bots_history",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId:   z.string().optional().describe("指定机器人ID"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ algoId, instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalBotsHistory(auth, algoId, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_positions",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId: z.string().describe("信号机器人ID（从 strategy_signal_bots_active 获取）"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalPositions(auth, algoId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_positions_history",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId: z.string().describe("信号机器人ID（从 strategy_signal_bots_history 获取）"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ algoId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalPositionsHistory(auth, algoId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_sub_orders",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId: z.string().describe("信号机器人ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ algoId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalSubOrders(auth, algoId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_event_history",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId: z.string().describe("信号机器人ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ algoId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalEventHistory(auth, algoId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 信号操作类（第十五批新增 — 路径经 curl 修正） ──────────────────────────

  registerTool(
    server,
    "strategy_signal_bot_create",
    "WRITE",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      channel:    z.string().describe("信号渠道。必填"),
      signalName: z.string().describe("信号名称。必填"),
    },
    async ({ channel, signalName }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.createSignal(auth, { channel, signalName })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_bot_stop",
    "WRITE",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId: z.string().describe("信号机器人ID。必填"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.stopSignal(auth, { algoId, algoOrdType: "contract" })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_orders",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {
      algoId: z.string().describe("信号机器人ID。必填"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalOrdersDetail(auth, algoId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_signal_subscriptions",
    "READ",
    "[D:Strategy] 当前活跃信号机器人 | algoOrdType?",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalSubscriptions(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
