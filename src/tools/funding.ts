import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerFundingTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "fund_balance",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    { ccy: z.string().optional().describe("指定币种，不填则返回全部") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getBalance_funding(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_transfer",
    "WRITE",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_currencies",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    { ccy: z.string().optional().describe("指定币种，如 BTC，不填返回全部") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getCurrencies(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_deposit_address",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    { ccy: z.string().describe("币种，如 USDT、BTC、ETH") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getDepositAddress(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_deposit_history",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_withdrawal_history",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_withdraw",
    "FUND_TRANSFER",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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
      if (dest === "4" && !toAddr) return toError(new Error("链上提币必须提供 toAddr（目标地址）"))
      if (dest === "4" && toAddr && !/^[A-Za-z0-9]{20,}$/.test(toAddr)) return toError(new Error(`目标地址 "${toAddr}" 格式无效`))
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

  registerTool(
    server,
    "fund_deposit_lightning",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_withdraw_lightning",
    "FUND_TRANSFER",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_transfer_state",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_non_tradable_assets",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getNonTradableAssets(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_exchange_list",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    {},
    async () => {
      try {
        const data = await privateApi.getExchangeList()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_deposit_withdraw_status",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getDepositWithdrawStatus(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_bills_history",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_convert_pair",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getConvertCurrencyPair(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_convert_quote",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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

  registerTool(
    server,
    "fund_monthly_statement",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.applyMonthlyStatement(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "fund_asset_balances",
    "READ",
    "[D:Funds] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions",
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
