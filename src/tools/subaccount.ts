import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"

export function registerSubAccountTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "account_subaccount_list",
    "READ",
    "[D:Account] get subaccount list",
    {
      enable: z.boolean().optional().describe("筛选启用状态，不填则返回全部"),
    },
    async ({ enable }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.listSubAccounts(auth, enable)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccounts",
    "READ",
    "[D:Account] get subaccount list",
    {
      enable: z.boolean().optional().describe("筛选启用状态，不填则返回全部"),
    },
    async ({ enable }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.listSubAccounts(auth, enable)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_balance",
    "READ",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称"),
    },
    async ({ subAcct }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSubAccountBalance(auth, subAcct)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_transfer",
    "WRITE",
    "[D:Account] get subaccount list",
    {
      ccy:            z.string().describe("划转币种"),
      amt:            z.string().describe("划转数量"),
      from:           z.enum(["6","18"]).describe("转出账户类型：6=资金账户，18=交易账户"),
      to:             z.enum(["6","18"]).describe("转入账户类型：6=资金账户，18=交易账户"),
      fromSubAccount: z.string().optional().describe("转出子账户名，不填则为主账户"),
      toSubAccount:   z.string().optional().describe("转入子账户名，不填则为主账户"),
    },
    async ({ ccy, amt, from, to, fromSubAccount, toSubAccount }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { ccy, amt, from, to }
        if (fromSubAccount) body["fromSubAccount"] = fromSubAccount
        if (toSubAccount)   body["toSubAccount"]   = toSubAccount
        const data = await privateApi.transferSubAccount(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_transfer_out",
    "WRITE",
    "[D:Account] get subaccount list",
    {
      subAcct:        z.string().describe("子账户名称。必填"),
      canTransferOut: z.boolean().describe("是否允许转出。true=允许, false=禁止"),
    },
    async ({ subAcct, canTransferOut }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setSubAccountTransferOut(auth, { subAcct, canTransOut: canTransferOut })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_api_key",
    "READ",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称。必填"),
    },
    async ({ subAcct }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSubAccountApiKey(auth, subAcct)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_api_key_create",
    "WRITE",
    "[D:Account] get subaccount list",
    {
      subAcct:    z.string().describe("子账户名称。必填"),
      label:      z.string().describe("API Key备注名称。必填"),
      passphrase: z.string().describe("API Key交易密码。必填"),
      perm:       z.string().describe("权限字符串，如 read_only、trade"),
      ip:         z.string().optional().describe("IP白名单，多个用逗号分隔"),
    },
    async ({ subAcct, label, passphrase, perm, ip }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { subAcct, label, passphrase, perm }
        if (ip) body.ip = ip
        const data = await privateApi.createSubAccountApiKey(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_api_key_reset",
    "READ",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称。必填"),
      apiKey:  z.string().describe("需要修改的API Key。必填"),
      label:   z.string().optional().describe("API Key新备注"),
      perm:    z.string().optional().describe("新权限字符串"),
      ip:      z.string().optional().describe("新IP白名单，多个用逗号分隔"),
    },
    async ({ subAcct, apiKey, label, perm, ip }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { subAcct, apiKey }
        if (label) body.label = label
        if (perm) body.perm = perm
        if (ip) body.ip = ip
        const data = await privateApi.modifySubAccountApiKey(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_api_key_delete",
    "READ",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称。必填"),
      apiKey:  z.string().describe("需要删除的API Key。必填"),
    },
    async ({ subAcct, apiKey }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.deleteSubAccountApiKey(auth, { subAcct, apiKey })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_bills",
    "READ",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称。必填"),
      after:   z.string().optional().describe("查询此时间戳之后的记录（毫秒Unix时间戳）"),
      before:  z.string().optional().describe("查询此时间戳之前的记录（毫秒Unix时间戳）"),
      limit:   z.string().optional().describe("返回条数，默认100"),
    },
    async ({ subAcct, after, before, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSubAccountBills(auth, subAcct, after, before, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_assets",
    "READ",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称。必填"),
    },
    async ({ subAcct }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSubAccountFundingBalance(auth, subAcct)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_create",
    "WRITE",
    "[D:Account] get subaccount list",
    {
      subAcct: z.string().describe("子账户名称。必填"),
      label:   z.string().optional().describe("子账户备注"),
    },
    async ({ subAcct, label }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { subAcct }
        if (label) body.label = label
        const data = await privateApi.createSubAccount(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_subaccount_entrust_list",
    "READ",
    "[D:Account] get subaccount list",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEntrustSubAccountList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
