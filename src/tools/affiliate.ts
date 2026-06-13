import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerAffiliateTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_affiliate_invitee_list",
    "CAT:[推广] | ## 功能：获取推广邀请的用户列表\n## 场景：用于推广员查看邀请了哪些用户、统计推广效果\n## 关键词：推广列表, invitee list, 邀请列表, 推广大使\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看邀请列表 → okx_get_affiliate_performance 查看推广绩效",
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
    "CAT:[推广] | ## 功能：获取推广邀请的某个用户详细信息\n## 场景：用于查看特定被邀请用户的交易量和返佣详情\n## 关键词：邀请详情, invitee detail, 推广明细, 用户详情\n## 参数：\n##   - uid: 用户ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_affiliate_invitee_list 获取用户列表 → 本工具查详情",
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
    "CAT:[推广] | ## 功能：获取推广链接列表\n## 场景：用于查看已创建的推广链接、管理推广渠道\n## 关键词：推广链接, affiliate link, 邀请链接, 推广渠道\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看链接 → 分享给用户 → 追踪推广效果",
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
    "CAT:[推广] | ## 功能：获取推广绩效汇总\n## 场景：用于查看推广收益、交易量、返佣比例等核心数据\n## 关键词：推广绩效, affiliate performance, 推广收益, 返佣, 佣金统计\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看总绩效 → okx_get_affiliate_invitee_list 看明细 → 优化推广策略",
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
    "CAT:[推广] | ## 功能：获取联合邀请人列表\n## 场景：用于查看合作推广的联合邀请人\n## 关键词：联合邀请, co-inviter, 合作推广, 合邀列表\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看联合邀请人 → 管理合作推广关系",
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
    "CAT:[推广] | ## 功能：获取下级推广员列表\n## 场景：用于查看自己的下级推广员、管理推广团队\n## 关键词：下级推广, sub affiliate, 下级代理, 推广团队\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看下级推广员 → 管理推广团队 → 带动团队业绩",
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
