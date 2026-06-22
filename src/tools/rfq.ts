import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerRfqTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "okx_create_rfq",
    "WRITE",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_execute_quote",
    "READ",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_get_rfqs",
    "READ",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_get_quotes",
    "READ",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_get_rfq_counterparties",
    "READ",
    "[D:Strategy] create rfq",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRfqCounterparties(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_cancel_rfq",
    "WRITE",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_cancel_batch_rfqs",
    "WRITE",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_cancel_all_rfqs",
    "WRITE",
    "[D:Strategy] create rfq",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelAllRfqs(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_create_quote",
    "WRITE",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_cancel_quote",
    "WRITE",
    "[D:Strategy] create rfq",
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

  registerTool(
    server,
    "okx_get_rfq_trades",
    "READ",
    "[D:Strategy] create rfq",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRfqTrades(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
  registerTool(
    server,
    "okx_reset_rfq_mmp",
    "READ",
    "[D:Strategy] create rfq",
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
