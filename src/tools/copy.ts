import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_SWAP_FUT , registerTool} from "./shared.js"

export function registerCopyTools(server: McpServer, auth: Auth | null): void {

  // ── 公开接口：查询任意带单员 ──────────────────────────────────────────────────

  registerTool(
    server,
    "okx_get_lead_trader_positions",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_lead_trader_history",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_lead_trader_stats",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_my_lead_positions",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_my_lead_history",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_copy_instruments",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_profit_sharing_total",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_profit_sharing_details",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_copy_trader",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_stop_copy_trader",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_copy_settings",
    "READ",
    "[D:Strategy] get lead trader positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCopySettings(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_set_copy_settings",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_public_lead_traders",
    "READ",
    "[D:Strategy] get lead trader positions",
    {},
    async () => {
      try {
        const data = await publicApi.getPublicLeadTraders()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_public_copy_config",
    "READ",
    "[D:Strategy] get lead trader positions",
    {},
    async () => {
      try {
        const data = await publicApi.getPublicCopyConfig()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_public_lead_trader_pnl",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_copy_traders",
    "READ",
    "[D:Strategy] get lead trader positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCopyTraders(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_first_copy_settings",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_unrealized_profit_sharing",
    "READ",
    "[D:Strategy] get lead trader positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getUnrealizedProfitSharing(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_total_unrealized_profit_sharing",
    "READ",
    "[D:Strategy] get lead trader positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getTotalUnrealizedProfitSharing(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_amend_profit_sharing_ratio",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_amend_copy_settings",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_get_public_preference_currency",
    "READ",
    "[D:Strategy] get lead trader positions",
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

  registerTool(
    server,
    "okx_stop_copy_trading",
    "WRITE",
    "[D:Strategy] get lead trader positions",
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
