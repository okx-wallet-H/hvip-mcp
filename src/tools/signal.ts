import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE } from "./shared.js"

export function registerSignalTools(server: McpServer, auth: Auth | null): void {

  server.tool(
    "okx_get_signal_bots_pending",
    "## 功能：查询当前运行中的信号交易机器人列表\n## 场景：用于监控信号机器人运行状态、查看品种和仓位、判断是否需要停止\n## 关键词：信号机器人, signal bot, 信号交易, 自动跟单, 机器人状态\n## 参数：\n##   - algoId: 指定机器人ID，不填返回全部\n##   - instType: 产品类型。SPOT=现货, SWAP=永续, FUTURES=交割, MARGIN=杠杆\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看运行中的机器人 → okx_get_signal_positions 看持仓 → okx_get_signal_sub_orders 看子单",
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

  server.tool(
    "okx_get_signal_bots_history",
    "## 功能：查询已停止的信号交易机器人历史记录\n## 场景：用于复盘信号交易效果、评估机器人盈亏、优化信号策略\n## 关键词：信号历史, signal history, 机器人记录, 信号盈亏, 信号复盘\n## 参数：\n##   - algoId: 指定机器人ID\n##   - instType: 产品类型\n##   - limit: 返回条数，默认20\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看历史机器人 → okx_get_signal_positions_history 看持仓 → okx_get_signal_event_history 看信号",
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

  server.tool(
    "okx_get_signal_positions",
    "## 功能：查询指定信号机器人的当前持仓\n## 场景：用于查看信号跟单仓位、监控未实现盈亏\n## 关键词：信号持仓, signal positions, 跟单仓位, 信号仓位\n## 参数：\n##   - algoId: 信号机器人ID（从 okx_get_signal_bots_pending 获取）\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：okx_get_signal_bots_pending 获取机器人ID → 本工具看持仓 → 决定是否停止",
    {
      algoId: z.string().describe("信号机器人ID（从 okx_get_signal_bots_pending 获取）"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSignalPositions(auth, algoId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_signal_positions_history",
    "## 功能：查询指定信号机器人的历史持仓记录\n## 场景：用于复盘信号跟单的交易表现、统计盈亏\n## 关键词：信号持仓历史, signal positions history, 跟单盈亏, 信号交易记录\n## 参数：\n##   - algoId: 信号机器人ID（从 okx_get_signal_bots_history 获取）\n##   - limit: 返回条数，默认20\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_signal_bots_history 获取机器人ID → 本工具看历史持仓 → 统计盈亏",
    {
      algoId: z.string().describe("信号机器人ID（从 okx_get_signal_bots_history 获取）"),
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

  server.tool(
    "okx_get_signal_sub_orders",
    "## 功能：查询信号机器人触发的子订单列表\n## 场景：用于追踪每个信号对应的实际下单情况、验证信号执行效果\n## 关键词：信号子单, signal sub orders, 信号成交, 触发订单\n## 参数：\n##   - algoId: 信号机器人ID\n##   - limit: 返回条数，默认20\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_signal_positions 看持仓 → 本工具看子单 → okx_get_signal_event_history 看信号源",
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

  server.tool(
    "okx_get_signal_event_history",
    "## 功能：查询信号机器人收到的信号事件历史\n## 场景：用于分析信号来源、触发频率、执行成功率\n## 关键词：信号事件, signal events, 信号来源, 触发记录, 信号执行\n## 参数：\n##   - algoId: 信号机器人ID\n##   - limit: 返回条数，默认20\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_signal_sub_orders 看子单 → 本工具看信号源 → 评估信号质量",
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

  server.tool(
    "okx_create_signal_bot",
    "## 功能：创建信号交易机器人\n## 场景：用于订阅外部信号源、自动跟随信号开平仓\n## 关键词：创建信号, create signal, 信号机器人, 信号交易\n## 参数：\n##   - channel: 信号渠道。必填\n##   - signalName: 信号名称。必填\n## 鉴权：🔴 需要 API Key（交易）- 将创建信号机器人，调用前必须向用户确认\n## 风险：WRITE — 信号机器人会自动执行交易，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具创建 → okx_get_signal_bots_pending 查看状态 → okx_stop_signal_bot 停止",
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

  server.tool(
    "okx_stop_signal_bot",
    "## 功能：停止信号交易机器人\n## 场景：用于终止运行中的信号策略、平掉所有信号持仓\n## 关键词：停止信号, stop signal, 信号停止, 关闭信号机器人\n## 参数：\n##   - algoId: 信号机器人ID。必填\n## 鉴权：🔴 需要 API Key（交易）- 将停止信号并平仓，调用前必须向用户确认\n## 风险：WRITE — 停止信号会平掉所有持仓，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_signal_bots_pending 查看运行中 → 本工具停止",
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

  server.tool(
    "okx_get_signal_orders",
    "## 功能：查询信号机器人订单详情\n## 场景：用于查看信号策略的触发订单列表和成交记录\n## 关键词：信号订单, signal orders, 信号委托, 信号成交\n## 参数：\n##   - algoId: 信号机器人ID。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_signal_bots_pending 查看机器人 → 本工具查订单 → 分析表现",
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

  server.tool(
    "okx_get_signal_subscriptions",
    "## 功能：查询已订阅的信号源列表\n## 场景：用于查看当前订阅了哪些信号、信号源信息和状态\n## 关键词：信号订阅, signal subscriptions, 信号源, 订阅列表\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看已订阅信号 → okx_create_signal_bot 创建新的信号机器人",
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
