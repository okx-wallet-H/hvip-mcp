import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerAffiliateTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_affiliate_invitee_list",
    "CAT:[推广] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateInviteeList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_affiliate_invitee_detail",
    "CAT:[推广] | → 请先调用 agent_catalog",
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

  server.tool(
    "okx_get_affiliate_link_list",
    "CAT:[推广] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateLinkList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_affiliate_performance",
    "CAT:[推广] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliatePerformance(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_co_inviter_list",
    "CAT:[推广] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAffiliateCoInviterList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_sub_affiliate_list",
    "CAT:[推广] | → 请先调用 agent_catalog",
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
