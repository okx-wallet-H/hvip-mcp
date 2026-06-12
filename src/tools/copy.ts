import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_SWAP_FUT } from "./shared.js"

export function registerCopyTools(server: McpServer, auth: Auth | null): void {

  // ── 公开接口：查询任意带单员 ──────────────────────────────────────────────────

  server.tool(
    "okx_get_lead_trader_positions",
    "## 功能：查询指定带单员当前持仓列表\n## 场景：用于跟单前评估带单员当前仓位、判断是否值得跟单\n## 关键词：带单员持仓, lead trader positions, 跟单, 交易员仓位, 带单\n## 参数：\n##   - uniqueCode: 带单员唯一标识码，从OKX App「跟单」页面获取\n##   - instType: 产品类型。SWAP=永续, FUTURES=交割。不填返回全部\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具看带单员持仓 → okx_get_lead_trader_stats 看绩效 → 决定是否跟单",
    {
      uniqueCode: z.string().describe("带单员唯一标识码，从OKX App「跟单」页面获取"),
      instType:   z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型，不填返回全部"),
    },
    async ({ uniqueCode, instType }) => {
      try {
        const data = await publicApi.getLeadTraderPositions(uniqueCode, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_lead_trader_history",
    "## 功能：查询指定带单员历史持仓记录\n## 场景：用于评估带单员历史表现、分析交易风格和盈亏分布\n## 关键词：带单员历史, trader history, 交易记录, 跟单历史, 带单盈亏\n## 参数：\n##   - uniqueCode: 带单员唯一标识码\n##   - instType: 产品类型\n##   - limit: 返回条数，默认20\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_lead_trader_positions 看当前 → 本工具看历史 → okx_get_lead_trader_stats 看统计",
    {
      uniqueCode: z.string().describe("带单员唯一标识码"),
      instType:   z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型，不填返回全部"),
      limit:      z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ uniqueCode, instType, limit }) => {
      try {
        const data = await publicApi.getLeadTraderHistory(uniqueCode, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_lead_trader_stats",
    "## 功能：查询指定带单员的绩效统计\n## 场景：用于评估带单员的核心指标（收益率、最大回撤、胜率、跟单人数）\n## 关键词：带单员统计, trader stats, 收益率, 最大回撤, 胜率, 跟单人数\n## 参数：\n##   - uniqueCode: 带单员唯一标识码\n##   - instType: 产品类型\n##   - lastDays: 统计周期（天）：7/30/90/180\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具看绩效汇总 → okx_get_lead_trader_history 看详细交易 → 决定是否跟单",
    {
      uniqueCode: z.string().describe("带单员唯一标识码"),
      instType:   z.enum(INST_TYPE_SWAP_FUT).describe("产品类型"),
      lastDays:   z.enum(["7","30","90","180"]).describe("统计周期（天）：7/30/90/180"),
    },
    async ({ uniqueCode, instType, lastDays }) => {
      try {
        const data = await publicApi.getLeadTraderStats(uniqueCode, instType, lastDays)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 私有接口：查询自己的带单数据 ──────────────────────────────────────────────

  server.tool(
    "okx_get_my_lead_positions",
    "## 功能：查询我当前作为带单员的持仓列表\n## 场景：用于带单员查看自己的带单仓位、管理带单策略\n## 关键词：我的带单, my lead positions, 带单持仓, 跟单账户\n## 参数：\n##   - instType: 产品类型，不填返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具看持仓 → okx_get_my_lead_history 看历史带单 → okx_get_profit_sharing_total 看分成",
    {
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型，不填返回全部"),
    },
    async ({ instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMyLeadPositions(auth, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_my_lead_history",
    "## 功能：查询我的历史带单记录\n## 场景：用于带单员复盘自己的带单表现、统计盈亏\n## 关键词：我的带单历史, my lead history, 带单记录, 分成记录\n## 参数：\n##   - instType: 产品类型\n##   - limit: 返回条数，默认20\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_my_lead_positions 看当前 → 本工具看历史 → okx_get_profit_sharing_details 看分成明细",
    {
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMyLeadHistory(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_copy_instruments",
    "## 功能：查询我当前作为带单员允许跟单的品种列表\n## 场景：用于带单员管理允许跟单的交易品种\n## 关键词：跟单品种, copy instruments, 允许跟单, 品种设置\n## 参数：\n##   - instType: 产品类型\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具查看允许跟单的品种 → 调整带单设置",
    {
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型"),
    },
    async ({ instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCopyInstruments(auth, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_profit_sharing_total",
    "## 功能：查询我的带单累计收取的分成金额\n## 场景：用于带单员查看累计分成收入\n## 关键词：带单分成, profit sharing, 分成收入, 累计分成\n## 参数：\n##   - instType: 产品类型\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~300B\n## 关联：本工具看总分成 → okx_get_profit_sharing_details 看逐笔明细",
    {
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型"),
    },
    async ({ instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getProfitSharingTotal(auth, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_profit_sharing_details",
    "## 功能：查询带单盈利分成的逐笔明细\n## 场景：用于带单员核对每笔分成金额、来源跟单者和时间\n## 关键词：分成明细, profit details, 分笔分成, 跟单分成\n## 参数：\n##   - instType: 产品类型\n##   - limit: 返回条数，默认20\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_profit_sharing_total 看总分成 → 本工具看逐笔明细",
    {
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getProfitSharingDetails(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 跟单操作类（第十批新增） ──────────────────────────────────────────────────

  server.tool(
    "okx_copy_trader",
    "## 功能：设置跟单（跟单指定带单员）\n## 场景：用于开始跟单某个带单员、设置跟单参数\n## 关键词：跟单, copy trade, 开始跟单, 设置跟单\n## 参数：\n##   - uniqueCode: 带单员唯一标识码。必填\n##   - instType: 产品类型。SWAP=永续, FUTURES=交割。必填\n##   - amount: 跟单数量。必填\n##   - amountType: 数量类型。1=固定张数, 2=固定金额, 3=比例。可选\n## 鉴权：🔴 需要 API Key（交易）- 将开始跟单，调用前必须向用户确认\n## 风险：WRITE — 开始跟单后系统将自动复制带单员交易，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_lead_trader_stats 评估带单员 → 本工具跟单 → okx_get_copy_settings 查看设置",
    {
      uniqueCode:  z.string().describe("带单员唯一标识码。必填"),
      instType:    z.enum(INST_TYPE_SWAP_FUT).describe("产品类型。SWAP=永续, FUTURES=交割"),
      amount:      z.string().describe("跟单数量"),
      amountType:  z.string().optional().describe("数量类型。1=固定张数, 2=固定金额, 3=比例"),
    },
    async ({ uniqueCode, instType, amount, amountType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { uniqueCode, instType, amount }
        if (amountType) body.amountType = amountType
        const data = await privateApi.setCopySettings(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_stop_copy_trader",
    "## 功能：停止跟单（关闭子持仓）\n## 场景：用于停止跟随某带单员的交易、平掉所有跟随仓位\n## 关键词：停止跟单, stop copy, 关闭跟单, 取消跟单\n## 参数：\n##   - subPosId: 子持仓ID。可选\n## 鉴权：🔴 需要 API Key（交易）- 将平掉跟单仓位，调用前必须向用户确认\n## 风险：WRITE — 平仓操作影响持仓，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具停止跟单 → okx_get_my_lead_history 确认结果",
    {
      subPosId: z.string().optional().describe("子持仓ID"),
    },
    async ({ subPosId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = {}
        if (subPosId) body.subPosId = subPosId
        const data = await privateApi.closeSubposition(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_copy_settings",
    "## 功能：查询当前跟单设置\n## 场景：用于查看已设置的跟单规则、跟单数量和类型\n## 关键词：跟单设置, copy settings, 跟单规则, 跟单配置\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看设置 → okx_set_copy_settings 修改 → 管理跟单策略",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCopySettings(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_copy_settings",
    "## 功能：修改跟单设置（跟单数量/比例等）\n## 场景：用于调整已有跟单的参数、修改跟单金额或比例\n## 关键词：修改跟单, update copy settings, 调整跟单, 跟单参数\n## 参数：\n##   - uniqueCode: 带单员唯一标识码。可选\n##   - instType: 产品类型。SWAP/FUTURES。可选\n##   - amount: 跟单数量。可选\n##   - amountType: 数量类型。1=固定张数, 2=固定金额, 3=比例。可选\n## 鉴权：🔴 需要 API Key（交易）- 修改跟单设置影响后续跟单，调用前须向用户确认\n## 风险：WRITE — 修改跟单参数，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_copy_settings 查看当前 → 本工具修改 → 确认变更生效",
    {
      uniqueCode: z.string().optional().describe("带单员唯一标识码"),
      instType:   z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型"),
      amount:     z.string().optional().describe("跟单数量"),
      amountType: z.string().optional().describe("数量类型。1=固定张数, 2=固定金额, 3=比例"),
    },
    async ({ uniqueCode, instType, amount, amountType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = {}
        if (uniqueCode) body.uniqueCode = uniqueCode
        if (instType) body.instType = instType
        if (amount) body.amount = amount
        if (amountType) body.amountType = amountType
        const data = await privateApi.updateCopySettings(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── PUBLIC 跟单查询（第九批新增） ────────────────────────────────────────

  server.tool(
    "okx_get_public_lead_traders",
    "## 功能：公开查询带单员排行榜\n## 场景：用于发现优秀带单员、评估带单员综合表现\n## 关键词：带单员排行, public lead traders, 带单排行榜, 跟单推荐\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具看排行榜 → okx_get_lead_trader_stats 看详情 → 选择跟单",
    {},
    async () => {
      try {
        const data = await publicApi.getPublicLeadTraders()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_public_copy_config",
    "## 功能：公开查询跟单系统配置\n## 场景：用于了解跟单规则、最低跟单金额、最大跟单比例等\n## 关键词：跟单配置, copy config, 跟单规则, 跟单限制\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具查看规则 → 设置跟单参数",
    {},
    async () => {
      try {
        const data = await publicApi.getPublicCopyConfig()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_public_lead_trader_pnl",
    "## 功能：公开查询带单员收益数据\n## 场景：用于评估带单员的历史收益表现\n## 关键词：带单收益, lead trader pnl, 跟单收益, 带单盈利率\n## 参数：\n##   - uniqueCode: 带单员唯一标识码。必填\n##   - lastDays: 统计周期（天）：7/30/90/180。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微弱 ~500B\n## 关联：本工具看收益 → okx_get_lead_trader_stats 看统计 → 决定是否跟单",
    {
      uniqueCode: z.string().describe("带单员唯一标识码。必填"),
      lastDays:   z.enum(["7","30","90","180"]).describe("统计周期（天）：7/30/90/180"),
    },
    async ({ uniqueCode, lastDays }) => {
      try {
        const data = await publicApi.getPublicLeadTraderPnl(uniqueCode, lastDays)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 私有跟单操作（第九批新增） ────────────────────────────────────────────

  server.tool(
    "okx_get_copy_traders",
    "## 功能：查询跟单我的交易员列表\n## 场景：用于查看有哪些交易员在跟单自己、管理跟单关系\n## 关键词：我的跟单者, copy traders, 跟单员, 粉丝\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看跟单者 → 管理跟单关系",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCopyTraders(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_first_copy_settings",
    "## 功能：首次设置跟单（初始配置跟单参数）\n## 场景：用于首次开始跟单时设置全部参数\n## 关键词：首次跟单, first copy, 初次跟单, 跟单初始化\n## 参数：\n##   - uniqueCode: 带单员唯一标识码。必填\n##   - instType: 产品类型。SWAP/FUTURES。必填\n##   - amount: 跟单数量。必填\n##   - amountType: 数量类型。可选\n## 鉴权：🔴 需要 API Key（交易）- 将开始跟单，调用前必须确认\n## 风险：WRITE — 首次跟单设置后将自动复制交易，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_lead_trader_stats 评估 → 本工具首次跟单 → okx_get_copy_settings 确认",
    {
      uniqueCode: z.string().describe("带单员唯一标识码。必填"),
      instType:   z.enum(INST_TYPE_SWAP_FUT).describe("产品类型。SWAP=永续, FUTURES=交割"),
      amount:     z.string().describe("跟单数量。必填"),
      amountType: z.string().optional().describe("数量类型。1=固定张数, 2=固定金额, 3=比例"),
    },
    async ({ uniqueCode, instType, amount, amountType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { uniqueCode, instType, amount }
        if (amountType) body.amountType = amountType
        const data = await privateApi.firstCopySettings(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_unrealized_profit_sharing",
    "## 功能：查询带单未实现的分成金额\n## 场景：用于查看当前持仓中尚未结算的潜在分成收入\n## 关键词：未实现分成, unrealized profit, 待结算分成, 持仓分成\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微弱 ~300B\n## 关联：本工具看未实现分成 → okx_get_profit_sharing_total 看已实现分成",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getUnrealizedProfitSharing(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_total_unrealized_profit_sharing",
    "## 功能：查询带单累计未实现分成总额\n## 场景：用于查看所有带单的累计潜在分成收入\n## 关键词：累计未实现, total unrealized, 未实现总额, 潜在分成\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微弱 ~300B\n## 关联：本工具看累计未实现 → okx_get_unrealized_profit_sharing 看明细",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getTotalUnrealizedProfitSharing(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_profit_sharing_ratio",
    "## 功能：修改带单分成比例\n## 场景：用于调整跟单者的盈利分成比例\n## 关键词：修改分成, profit ratio, 分成比例, 调整分成\n## 参数：\n##   - profitSharingRatio: 分成比例。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改分成比例，调用前必须确认\n## 风险：WRITE — 修改分成比例影响收入，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_profit_sharing_total 看当前分成 → 本工具修改比例",
    {
      profitSharingRatio: z.string().describe("分成比例。必填"),
    },
    async ({ profitSharingRatio }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.amendProfitSharingRatio(auth, { profitSharingRatio })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_copy_settings",
    "## 功能：修改跟单设置\n## 场景：用于调整已有跟单的参数、更新跟单数量或类型\n## 关键词：修改跟单, amend copy, 跟单调整, 跟单参数修改\n## 参数：\n##   - subPosId: 子持仓ID。必填\n##   - amount: 新跟单数量。可选\n##   - amountType: 新数量类型。可选\n## 鉴权：🔴 需要 API Key（交易）- 将修改跟单设置，调用前必须确认\n## 风险：WRITE — 修改跟单参数影响后续跟单，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_copy_settings 查看当前 → 本工具修改 → 确认变更",
    {
      subPosId:   z.string().describe("子持仓ID。必填"),
      amount:     z.string().optional().describe("新跟单数量"),
      amountType: z.string().optional().describe("新数量类型。1=固定张数, 2=固定金额, 3=比例"),
    },
    async ({ subPosId, amount, amountType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { subPosId }
        if (amount) body.amount = amount
        if (amountType) body.amountType = amountType
        const data = await privateApi.amendCopySettings(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_public_preference_currency",
    "## 功能：公开查询带单员偏好的结算币种\n## 场景：用于查看带单员支持的跟单币种\n## 关键词：带单币种, preference currency, 跟单币种, 结算币种\n## 参数：\n##   - uniqueCode: 带单员唯一标识码。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：本工具查币种偏好 → okx_get_lead_trader_stats 查绩效 → 决定跟单",
    {
      uniqueCode: z.string().describe("带单员唯一标识码。必填"),
    },
    async ({ uniqueCode }) => {
      try {
        const data = await publicApi.getPublicPreferenceCurrency(uniqueCode)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_stop_copy_trading",
    "## 功能：停止跟单/停止带单\n## 场景：用于停止当前的跟单关系或终止带单\n## 参数：无\n## 鉴权：🔴 需要 API Key（交易）- 将停止跟单，调用前必须确认\n## 风险：WRITE — 停止跟单影响持仓，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_copy_settings 查看设置 → 本工具停止",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.stopCopyTrading(auth, {})
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
