import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerFundingTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_funding_balance",
    "CAT:[资金] | → 请先调用 agent_catalog",
    { ccy: z.string().optional().describe("指定币种，不填则返回全部") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getBalance_funding(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_transfer",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      ccy:  z.string().describe("划转币种"),
      amt:  z.string().describe("划转数量"),
      from: z.enum(["6","18"]).describe("转出账户：6=资金账户，18=交易账户"),
      to:   z.enum(["6","18"]).describe("转入账户：6=资金账户，18=交易账户"),
    },
    async ({ ccy, amt, from, to }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.transfer(auth, { ccy, amt, from, to })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_currencies",
    "CAT:[资金] | → 请先调用 agent_catalog",
    { ccy: z.string().optional().describe("指定币种，如 BTC，不填返回全部") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCurrencies(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_deposit_address",
    "CAT:[资金] | → 请先调用 agent_catalog",
    { ccy: z.string().describe("币种，如 USDT、BTC、ETH") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getDepositAddress(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_deposit_history",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      ccy:   z.string().optional().describe("币种，不填返回全部"),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ ccy, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getDepositHistory(auth, ccy, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_withdrawal_history",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      ccy:   z.string().optional().describe("币种，不填返回全部"),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ ccy, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getWithdrawalHistory(auth, ccy, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_withdrawal",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      ccy:    z.string().describe("币种，如 USDT。必填"),
      amt:    z.string().describe("提币数量。必填"),
      dest:   z.enum(["3","4"]).describe("提币方式：3=内部转账, 4=链上提币"),
      toAddr: z.string().optional().describe("目标地址（链上提币必填）"),
      chain:  z.string().optional().describe("链名称，如 USDT-TRC20"),
      fee:    z.string().optional().describe("手续费，不填用默认"),
    },
    async ({ ccy, amt, dest, toAddr, chain, fee }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { ccy, amt, dest }
        if (toAddr) body.toAddr = toAddr
        if (chain) body.chain = chain
        if (fee) body.fee = fee
        const data = await privateApi.withdrawal(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 资金收尾（第十七批新增） ──────────────────────────────────────────────────

  server.tool(
    "okx_get_deposit_lightning",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      ccy: z.string().describe("币种，如 USDT。必填"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getDepositLightning(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_withdrawal_lightning",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      ccy: z.string().describe("提现币种。必填"),
      amt: z.string().describe("提现数量。必填"),
      to:  z.string().describe("提现去向。必填"),
    },
    async ({ ccy, amt, to }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.withdrawalLightning(auth, { ccy, amt, to })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_transfer_state",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      transferId: z.string().describe("划转ID（从 okx_transfer 返回获取）。必填"),
    },
    async ({ transferId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getTransferState(auth, transferId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 资产补完（v0.2.26 新缺口） ────────────────────────────────────────────

  server.tool(
    "okx_get_non_tradable_assets",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getNonTradableAssets(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_exchange_list",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {},
    async () => {
      try {
        const data = await privateApi.getExchangeList()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_deposit_withdraw_status",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getDepositWithdrawStatus(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_asset_bills_history",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAssetBillsHistory(auth, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_convert_currency_pair",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getConvertCurrencyPair(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_convert_estimate_quote",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {
      fromCcy: z.string().describe("卖出币种。必填"),
      toCcy:   z.string().describe("买入币种。必填"),
      sz:      z.string().describe("兑换数量。必填"),
    },
    async ({ fromCcy, toCcy, sz }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getConvertEstimateQuote(auth, { fromCcy, toCcy, sz })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_monthly_statement",
    "CAT:[资金] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.applyMonthlyStatement(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_asset_balances",
    "CAT:[资金] | → 请先调用 agent_catalog",
    { ccy: z.string().optional().describe("指定币种，不填返回全部") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAssetBalances(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
