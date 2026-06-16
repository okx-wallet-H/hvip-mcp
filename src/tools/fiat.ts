import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerFiatTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_fiat_buy_sell_pair",
    "CAT:[资金-法币] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatBuySellPair(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_fiat_deposit",
    "CAT:[资金-法币] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatDeposit(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_fiat_deposit_orders",
    "CAT:[资金-法币] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatDepositOrderHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_fiat_deposit_methods",
    "CAT:[资金-法币] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatDepositPaymentMethods(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
