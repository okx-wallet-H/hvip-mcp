import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerRfqTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_create_rfq",
    `## 功能：创建报价请求（RFQ，Request For Quote），用于大宗交易询价
## 场景：用于向做市商或对手方发起大宗交易询价、获取定制报价
## 关键词：询价, RFQ, 报价请求, 大宗交易询价, 请求报价
## 参数：
##   - instId: 产品ID。必填
##   - side: 买卖方向。buy=买入, sell=卖出。必填
##   - sz: 数量。必填
##   - szType: 数量类型。base=按币, quote=按计价币。可选
## 鉴权：🔴 需要 API Key（交易）- 将发送大宗交易询价，调用前必须向用户确认
## 风险：WRITE — 发送RFQ后会收到报价，调用前必须确认
## 返回量：微小 ~500B
## 关联：本工具询价 → okx_get_quotes 查收到的报价 → okx_execute_quote 执行报价`,
    {
      instId: z.string().describe("产品ID。必填"),
      side:   z.enum(["buy","sell"]).describe("买卖方向。buy=买入, sell=卖出"),
      sz:     z.string().describe("数量。必填"),
      szType: z.enum(["base","quote"]).optional().describe("数量类型。base=按币, quote=按计价币"),
    },
    async ({ instId, side, sz, szType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, side, sz }
        if (szType) body.szType = szType
        const data = await privateApi.createRfq(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_execute_quote",
    `## 功能：执行报价（接受对手方的大宗交易报价）
## 场景：用于接受RFQ报价、确认大宗交易成交
## 关键词：执行报价, execute quote, 接受报价, 大宗成交, 确认交易
## 参数：
##   - instId: 产品ID。必填
##   - quoteId: 报价ID。必填
##   - rfqId: RFQ ID。必填
##   - sz: 成交数量。必填
## 鉴权：🔴 需要 API Key（交易）- 将执行大宗交易成交，调用前必须向用户确认
## 风险：WRITE — 执行报价后即成交，调用前必须确认
## 返回量：微小 ~500B
## 关联：okx_create_rfq 发起询价 → okx_get_quotes 查看报价 → 本工具成交`,
    {
      instId:  z.string().describe("产品ID。必填"),
      quoteId: z.string().describe("报价ID。必填"),
      rfqId:   z.string().describe("RFQ ID。必填"),
      sz:      z.string().describe("成交数量。必填"),
    },
    async ({ instId, quoteId, rfqId, sz }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.executeRfqQuote(auth, { instId, quoteId, rfqId, sz })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_rfqs",
    `## 功能：查询询价记录列表
## 场景：用于查看历史RFQ、追踪询价状态、确认询价是否已报价
## 关键词：询价记录, RFQ列表, 询价历史, RFQ记录, 报价请求记录
## 参数：
##   - state: 状态筛选。active=进行中, executed=已成交, canceled=已取消。可选
## 鉴权：⚠️ 需要 API Key（只读）
## 风险：READ — 只读查询，Agent 可自动调用
## 返回量：中等 ~5KB
## 关联：本工具查询价列表 → okx_get_quotes 查看对应报价 → 管理大宗交易`,
    {
      state: z.enum(["active","executed","canceled"]).optional().describe("状态筛选。active=进行中, executed=已成交, canceled=已取消"),
    },
    async ({ state }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRfqs(auth, state)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_quotes",
    `## 功能：查询针对某RFQ的报价列表
## 场景：用于查看对手方对RFQ的回复报价、选择最优报价执行
## 关键词：报价列表, quotes, RFQ报价, 查询报价, 对手方报价
## 参数：
##   - rfqId: RFQ ID。必填
## 鉴权：⚠️ 需要 API Key（只读）
## 风险：READ — 只读查询，Agent 可自动调用
## 返回量：中等 ~5KB
## 关联：okx_get_rfqs 查询价 → 本工具查看报价 → okx_execute_quote 执行`,
    {
      rfqId: z.string().describe("RFQ ID。必填"),
    },
    async ({ rfqId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRfqQuotes(auth, rfqId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── RFQ 收尾（第八批新增） ───────────────────────────────────────────────

  server.tool(
    "okx_get_rfq_counterparties",
    "CAT:[策略-RFQ] | ## 功能：获取RFQ对手方列表\n## 场景：用于查看可询价的做市商和对手方\n## 关键词：RFQ对手方, counterparties, 报价对手, 询价对手\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看对手方 → okx_create_rfq 发起询价",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRfqCounterparties(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_rfq",
    "CAT:[策略-RFQ] | ## 功能：取消RFQ报价请求\n## 场景：用于取消已发送但未收到报价的询价\n## 关键词：取消询价, cancel rfq, 撤销询价\n## 参数：\n##   - rfqId: RFQ ID。必填\n## 鉴权：🔴 需要 API Key（交易）- 将取消询价，调用前必须确认\n## 风险：WRITE — 取消询价，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_rfqs 查看询价 → 本工具取消 → 重新询价",
    {
      rfqId: z.string().describe("RFQ ID。必填"),
    },
    async ({ rfqId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelRfq(auth, { rfqId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_batch_rfqs",
    "CAT:[策略-RFQ] | ## 功能：批量取消RFQ报价请求\n## 场景：用于同时取消多个询价\n## 关键词：批量取消, cancel batch rfqs, 批量撤销询价\n## 参数：\n##   - rfqIds: RFQ ID数组（JSON数组字符串）。必填\n## 鉴权：🔴 需要 API Key（交易）- 将批量取消询价，调用前必须确认\n## 风险：WRITE — 批量取消，调用前必须确认\n## 返回量：中等 ~2KB\n## 关联：okx_get_rfqs 查看询价 → 本工具批量取消",
    {
      rfqIds: z.string().describe("RFQ ID数组JSON字符串，如 '[\"123\",\"456\"]'"),
    },
    async ({ rfqIds }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(rfqIds)
        const data = await privateApi.cancelBatchRfqs(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_all_rfqs",
    "CAT:[策略-RFQ] | ## 功能：取消所有RFQ报价请求\n## 场景：用于一键清空所有未完成的询价\n## 关键词：全部取消, cancel all rfqs, 清空询价\n## 参数：无\n## 鉴权：🔴 需要 API Key（交易）- 将取消所有询价，调用前必须确认\n## 风险：WRITE — 取消全部询价，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具一键取消所有 → okx_create_rfq 重新询价",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelAllRfqs(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_create_quote",
    "CAT:[策略-RFQ] | ## 功能：创建报价（回复RFQ询价）\n## 场景：用于做市商回复询价、提供报价\n## 参数：\n##   - rfqId: RFQ ID。必填\n##   - quotePx: 报价价格。必填\n##   - sz: 报价数量。必填\n## 鉴权：🔴 需要 API Key（交易）- 将发送报价，调用前必须确认\n## 风险：WRITE — 发送报价，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_rfqs 查看询价 → 本工具报价 → okx_get_quotes 查看报价",
    {
      rfqId:   z.string().describe("RFQ ID。必填"),
      quotePx: z.string().describe("报价价格。必填"),
      sz:      z.string().describe("报价数量。必填"),
    },
    async ({ rfqId, quotePx, sz }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.createRfqQuote(auth, { rfqId, quotePx, sz })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_quote",
    "CAT:[策略-RFQ] | ## 功能：取消已发送的报价\n## 场景：用于取消尚未被接受的报价\n## 参数：\n##   - rfqId: RFQ ID。必填\n##   - quoteId: 报价ID。必填\n## 鉴权：🔴 需要 API Key（交易）- 将取消报价，调用前必须确认\n## 风险：WRITE — 取消报价，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_quotes 查看报价 → 本工具取消 → 重新报价",
    {
      rfqId:   z.string().describe("RFQ ID。必填"),
      quoteId: z.string().describe("报价ID。必填"),
    },
    async ({ rfqId, quoteId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelRfqQuote(auth, { rfqId, quoteId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_rfq_trades",
    "CAT:[策略-RFQ] | ## 功能：查询RFQ成交记录\n## 场景：用于查看大宗交易的成交历史\n## 关键词：RFQ成交, rfq trades, 大宗成交, 询价成交\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_rfqs 查询价 → 本工具查成交 → 核对大宗交易",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRfqTrades(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
  server.tool(
    "okx_reset_rfq_mmp",
    "CAT:[策略-RFQ] | ## 功能：重置RFQ的做市商保护（MMP）状态\n## 场景：用于触发MMP保护后手动恢复做市报价\n## 关键词：RFQ-MMP, reset mmp, 做市保护重置\n## 参数：无\n## 鉴权：🔴 需要 API Key（交易）- 重置做市保护，调用前必须确认\n## 风险：WRITE — 重置MMP后做市商可恢复报价，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具重置 → 恢复正常RFQ报价",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.resetRfqMmp(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
