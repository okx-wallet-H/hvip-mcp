import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE } from "./shared.js"

export function registerBotTools(server: McpServer, auth: Auth | null): void {

  // ── 网格交易 ────────────────────────────────────────────────────────────────

  server.tool(
    "okx_get_grid_ai_param",
    "## 功能：获取OKX智能网格推荐参数（无需API Key）\n## 场景：用于开网格前快速评估参数合理性、比较AI建议与手动设置的优劣\n## 关键词：网格AI, grid ai, 网格推荐, 智能参数, 网格策略\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT、BTC-USDT-SWAP\n##   - algoOrdType: 网格类型。grid=现货网格, contract_grid=合约网格, moon_grid=天地网格\n##   - direction: 合约网格方向（仅contract_grid需要）。long=多头, short=空头, neutral=中性\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具获取AI参数 → 参考后开网格 → okx_get_grid_orders_pending 查看运行状态",
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

  server.tool(
    "okx_get_grid_orders_pending",
    "## 功能：查询当前运行中的网格策略列表\n## 场景：用于监控网格盈亏、查看成交次数和资金占用、判断是否需要调整\n## 关键词：运行中网格, grid pending, 网格策略, 网格盈亏, 网格状态\n## 参数：\n##   - algoOrdType: 网格类型\n##   - instId: 产品ID，不填返回全部\n##   - instType: 产品类型筛选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_grid_ai_param 获取参数 → 开网格 → 本工具监控运行 → okx_get_grid_sub_orders 看成交",
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

  server.tool(
    "okx_get_grid_orders_history",
    "## 功能：查询已停止的历史网格策略\n## 场景：用于评估历史策略效果、分析网格盈亏、优化下次参数\n## 关键词：历史网格, grid history, 网格记录, 策略复盘, 网格收益\n## 参数：\n##   - algoOrdType: 网格类型\n##   - instId: 产品ID，不填返回全部\n##   - instType: 产品类型筛选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_grid_orders_pending 看运行中 → 停止后 → 本工具查看最终盈亏",
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

  server.tool(
    "okx_get_grid_sub_orders",
    "## 功能：查询某个网格策略的子订单列表（每一格的买卖记录）\n## 场景：用于分析网格成交情况、验证策略是否按预期运行、计算实际收益\n## 关键词：网格子单, grid sub orders, 网格成交, 网格明细, 逐格记录\n## 参数：\n##   - algoId: 网格策略ID\n##   - algoOrdType: 网格类型\n##   - type: filled=已成交, unfilled=未成交\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_grid_orders_pending 获取网格ID → 本工具看每格成交 → 计算实际收益",
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

  server.tool(
    "okx_get_recurring_orders_pending",
    "## 功能：查询当前运行中的定投计划列表\n## 场景：用于查看定投周期、已投总额、当前盈亏、判断是否调整定投策略\n## 关键词：定投, recurring, 定期投资, DCA, 定投计划, 定投盈亏\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看定投状态 → okx_get_recurring_orders_history 看历史 → 评估定投效果",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRecurringOrdersPending(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_recurring_orders_history",
    "## 功能：查询已结束的历史定投计划\n## 场景：用于评估定投策略长期效果、分析总收益和年化收益率\n## 关键词：定投历史, recurring history, 定投记录, 定投收益, DCA收益\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_recurring_orders_pending 看运行中 → 本工具看历史 → 计算长期年化",
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

  server.tool(
    "okx_create_recurring_plan",
    "## 功能：创建定投计划（DCA）\n## 场景：用于设置定期买入计划、自动化定投策略、分批建仓\n## 关键词：创建定投, create recurring, DCA, 定投计划, 自动定投\n## 参数：\n##   - instId: 定投产品ID。必填\n##   - currency: 定投币种。必填\n##   - amount: 每期投资数量。必填\n##   - period: 定投周期。daily=每日, weekly=每周, monthly=每月。必填\n## 鉴权：🔴 需要 API Key（交易）- 将创建自动定投计划，调用前必须向用户确认\n## 风险：WRITE — 创建定投计划后系统将自动执行投资，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具创建 → okx_get_recurring_orders_pending 查看状态 → okx_stop_recurring_plan 停止",
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

  server.tool(
    "okx_stop_recurring_plan",
    "## 功能：停止定投计划\n## 场景：用于终止运行中的定投计划、不再继续自动定投\n## 关键词：停止定投, stop recurring, 终止定投, 取消定投\n## 参数：\n##   - algoId: 定投计划ID。必填\n## 鉴权：🔴 需要 API Key（交易）- 将停止自动定投，调用前必须向用户确认\n## 风险：WRITE — 停止后不再自动投资，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_recurring_orders_pending 查看运行中计划 → 本工具停止",
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

  server.tool(
    "okx_get_recurring_sub_orders",
    "## 功能：查询定投计划的子订单历史\n## 场景：用于查看定投计划的每次执行记录、检查每次成交价格和数量\n## 关键词：定投子订单, recurring sub orders, 定投明细, DCA订单, 定投成交\n## 参数：\n##   - algoId: 定投计划ID。必填\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_recurring_orders_pending 查计划 → 本工具查每次执行 → 计算平均成本",
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

  server.tool(
    "okx_create_grid_order",
    "## 功能：创建网格交易订单\n## 场景：用于设置现货网格/合约网格/天地网格策略\n## 关键词：创建网格, create grid, 网格交易, 现货网格, 合约网格, 天地网格\n## 参数：\n##   - instId: 产品ID。必填\n##   - algoOrdType: 网格类型。grid=现货网格, contract_grid=合约网格, moon_grid=天地网格。必填\n##   - maxPx: 价格上限。必填\n##   - minPx: 价格下限。必填\n##   - gridNum: 网格数量。必填\n##   - direction: 合约网格方向。long=做多, short=做空, neutral=中性。可选\n## 鉴权：🔴 需要 API Key（交易）- 将创建网格策略，调用前必须向用户确认\n## 风险：WRITE — 网格交易会自动下单，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具创建 → okx_get_grid_orders_pending 查看 → okx_stop_grid_order 停止",
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

  server.tool(
    "okx_stop_grid_order",
    "## 功能：停止网格交易订单\n## 场景：用于终止运行中的网格策略、清空网格仓位\n## 关键词：停止网格, stop grid, 网格停止, 终止网格\n## 参数：\n##   - algoId: 网格策略ID。必填\n##   - instId: 产品ID。必填\n##   - algoOrdType: 网格类型。必填\n## 鉴权：🔴 需要 API Key（交易）- 将停止网格策略平仓，调用前必须确认\n## 风险：WRITE — 停止网格将清空所有网格订单，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_grid_orders_pending 查看运行中 → 本工具停止 → 确认已停止",
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

  server.tool(
    "okx_close_grid_position",
    "## 功能：平仓网格策略的持仓\n## 场景：用于手动平掉网格策略的当前持仓、部分或全部平仓\n## 关键词：网格平仓, close grid position, 网格持仓平仓\n## 参数：\n##   - algoId: 网格策略ID。必填\n##   - algoOrdType: 网格类型。必填\n## 鉴权：🔴 需要 API Key（交易）- 将平掉网格持仓，调用前必须向用户确认\n## 风险：WRITE — 平仓操作影响持仓，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_grid_positions 查看网格持仓 → 本工具平仓",
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

  server.tool(
    "okx_get_grid_positions",
    "## 功能：查询网格策略的持仓详情\n## 场景：用于查看网格持仓方向、数量和盈亏\n## 关键词：网格持仓, grid positions, 网格仓位, 网格盈亏\n## 参数：\n##   - algoId: 网格策略ID。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_grid_orders_pending 查看策略 → 本工具看持仓 → 决定是否平仓",
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
