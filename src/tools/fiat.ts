import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerFiatTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "okx_get_fiat_buy_sell_pair",
    "READ",
    "[D:Funds] get fiat buy sell pair",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatBuySellPair(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_fiat_deposit",
    "READ",
    "[D:Funds] get fiat buy sell pair",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatDeposit(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_fiat_deposit_orders",
    "READ",
    "[D:Funds] get fiat buy sell pair",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFiatDepositOrderHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_fiat_deposit_methods",
    "READ",
    "[D:Funds] get fiat buy sell pair",
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
