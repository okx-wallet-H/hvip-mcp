import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerAffiliateTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "sys_affiliate_invitees",
    "READ",
    "[D:System] 推广数据查询 | 推广相关",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateInviteeList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_affiliate_invitee_detail",
    "READ",
    "[D:System] 推广数据查询 | 推广相关",
    {
      uid: z.string().optional().describe("用户ID"),
    },
    async ({ uid }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateInviteeDetail(auth, uid)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_affiliate_links",
    "READ",
    "[D:System] 推广数据查询 | 推广相关",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateLinkList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_affiliate_performance",
    "READ",
    "[D:System] 推广数据查询 | 推广相关",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliatePerformance(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_affiliate_co_inviters",
    "READ",
    "[D:System] 推广数据查询 | 推广相关",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateCoInviterList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_affiliate_sub_list",
    "READ",
    "[D:System] 推广数据查询 | 推广相关",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateSubAffiliateList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
