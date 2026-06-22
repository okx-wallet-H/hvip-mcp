import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerAffiliateTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "okx_get_affiliate_invitee_list",
    "READ",
    "[D:System] get affiliate invitee list",
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
    "okx_get_affiliate_invitee_detail",
    "READ",
    "[D:System] get affiliate invitee list",
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
    "okx_get_affiliate_link_list",
    "READ",
    "[D:System] get affiliate invitee list",
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
    "okx_get_affiliate_performance",
    "READ",
    "[D:System] get affiliate invitee list",
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
    "okx_get_co_inviter_list",
    "READ",
    "[D:System] get affiliate invitee list",
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
    "okx_get_sub_affiliate_list",
    "READ",
    "[D:System] get affiliate invitee list",
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
