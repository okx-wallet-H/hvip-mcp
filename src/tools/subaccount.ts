import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerSubAccountTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_subaccount_list",
    "## 功能：获取所有子账户列表及其状态\n## 场景：用于多策略账户管理、查看各子账户的启用状态\n## 关键词：子账户列表, subaccount list, 子账号列表, 子账户状态\n## 参数：\n##   - enable: 筛选启用状态，不填则返回全部\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具获取子账户列表 → okx_get_subaccount_balance 查余额 → okx_transfer_subaccount 划转",
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

  server.tool(
    "okx_list_subaccounts",
    "## 功能：获取所有子账户列表及其状态\n## 场景：用于多策略账户管理、查看各子账户的启用状态\n## 关键词：子账户, subaccounts, 多账户, 子账号, 账户管理\n## 参数：\n##   - enable: 筛选启用状态，不填则返回全部\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具获取子账户列表 → okx_get_subaccount_balance 查余额 → okx_transfer_subaccount 划转",
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

  server.tool(
    "okx_get_subaccount_balance",
    "## 功能：查询指定子账户的交易账户余额\n## 场景：用于监控各策略账户的资金状况、核对子账户资产\n## 关键词：子账户余额, subaccount balance, 子账号资产, 策略账户\n## 参数：\n##   - subAcct: 子账户名称\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：okx_list_subaccounts 获取子账户列表 → 本工具查余额 → okx_transfer_subaccount 划转",
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

  server.tool(
    "okx_transfer_subaccount",
    "## 功能：主子账户间资金划转\n## 场景：用于将资金从主账户分配到各策略子账户、或将盈利从子账户转回主账户\n## 关键词：子账户划转, transfer subaccount, 子账户转账, 账户间转账\n## 参数：\n##   - ccy: 划转币种\n##   - amt: 划转数量\n##   - from: 转出账户类型：6=资金账户，18=交易账户\n##   - to: 转入账户类型：6=资金账户，18=交易账户\n##   - fromSubAccount: 转出子账户名，不填则为主账户\n##   - toSubAccount: 转入子账户名，不填则为主账户\n## 鉴权：🔴 需要主账户 API Key（交易）- 调用前必须向用户确认划转方向和金额\n## 风险：FUND_TRANSFER — 划转操作移动真实资金，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_list_subaccounts 获取子账户 → okx_get_subaccount_balance 确认余额 → 本工具划转",
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

  server.tool(
    "okx_subaccount_set_transfer_out",
    "## 功能：设置子账户的资金转出权限\n## 场景：用于控制子账户是否可以向外部转出资金、管理多策略账户的资金权限\n## 关键词：子账户转出, 转出权限, set transfer out, 子账户权限, 风控, 资金管理\n## 参数：\n##   - subAcct: 子账户名称。必填\n##   - canTransferOut: 是否允许转出。必填\n## 鉴权：🔴 需要主账户 API Key（管理）- 调用前须向用户确认\n## 风险：ADMIN — 修改子账户权限，影响资金安全，调用前必须由用户确认\n## 返回量：微小 ~200B\n## 关联：okx_list_subaccounts 获取子账户列表 → 本工具管理权限 → okx_transfer_subaccount 划转",
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

  server.tool(
    "okx_get_subaccount_api_key",
    "## 功能：查询子账户的API Key列表\n## 场景：用于管理子账户的API权限、查看各子账户已创建的API Key\n## 关键词：子账户API, subaccount apikey, 子账户秘钥, API管理\n## 参数：\n##   - subAcct: 子账户名称。必填\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：okx_list_subaccounts 获取子账户 → 本工具查API Key → okx_create_subaccount_api_key 创建",
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

  server.tool(
    "okx_create_subaccount_api_key",
    "## 功能：为子账户创建新的API Key\n## 场景：用于为子账户开通API权限、分配交易额度\n## 关键词：创建API, create apikey, 子账户创建秘钥, API创建\n## 参数：\n##   - subAcct: 子账户名称。必填\n##   - label: API Key备注名称。必填\n##   - passphrase: API Key交易密码。必填\n##   - perm: 权限字符串，如 read_only、trade。必填\n##   - ip: IP白名单，多个用逗号分隔。可选\n## 鉴权：🔴 需要主账户 API Key（管理）- 调用前须向用户确认\n## 风险：ADMIN — 创建API Key影响子账户访问权限，调用前必须由用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_subaccount_api_key 查看现有 → 本工具创建 → okx_reset_subaccount_api_key 重置",
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

  server.tool(
    "okx_reset_subaccount_api_key",
    "## 功能：修改子账户的API Key（重置权限、IP白名单或备注）\n## 场景：用于更新子账户API Key的权限范围、修改IP白名单\n## 关键词：修改API, reset apikey, 重置秘钥, 更新API权限\n## 参数：\n##   - subAcct: 子账户名称。必填\n##   - apiKey: 需要修改的API Key。必填\n##   - label: API Key新备注。可选\n##   - perm: 新权限字符串。可选\n##   - ip: 新IP白名单。可选\n## 鉴权：🔴 需要主账户 API Key（管理）- 调用前须向用户确认\n## 风险：ADMIN — 修改API Key影响子账户访问权限，调用前必须由用户确认\n## 返回量：微小 ~500B\n## 关联：okx_create_subaccount_api_key 创建 → 本工具修改 → okx_delete_subaccount_api_key 删除",
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

  server.tool(
    "okx_delete_subaccount_api_key",
    "## 功能：删除子账户的API Key\n## 场景：用于撤销子账户的API访问权限、子账户不再需要交易时清理API Key\n## 关键词：删除API, delete apikey, 移除秘钥, 撤销API权限\n## 参数：\n##   - subAcct: 子账户名称。必填\n##   - apiKey: 需要删除的API Key。必填\n## 鉴权：🔴 需要主账户 API Key（管理）- 调用前须向用户确认\n## 风险：ADMIN — 删除API Key后子账户将无法通过API访问，调用前必须由用户确认\n## 返回量：微小 ~300B\n## 关联：okx_get_subaccount_api_key 查看现有 → 本工具删除 → okx_list_subaccounts 验证",
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

  server.tool(
    "okx_get_subaccount_bills",
    "## 功能：查询子账户的资金流水（账单）\n## 场景：用于审计子账户的资金变动、追踪子账户的划转和交易记录\n## 关键词：子账户账单, subaccount bills, 子账户流水, 资金变动, 子账户对账\n## 参数：\n##   - subAcct: 子账户名称。必填\n##   - after: 查询此时间戳之后的记录（毫秒Unix时间戳）。可选\n##   - before: 查询此时间戳之前的记录（毫秒Unix时间戳）。可选\n##   - limit: 返回条数，默认100。可选\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_subaccount_balance 查余额 → 本工具查流水 → okx_transfer_subaccount 划转",
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

  server.tool(
    "okx_get_subaccount_assets",
    "## 功能：查询子账户的资金账户余额（非交易账户）\n## 场景：用于查看子账户的充值资金、确认子账户资金账户资产\n## 关键词：子账户资产, subaccount assets, 子账户资金, 子账户余额, 子账号资金\n## 参数：\n##   - subAcct: 子账户名称。必填\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_subaccount_balance 看交易余额 → 本工具看资金余额 → 综合评估子账户资产",
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

  server.tool(
    "okx_create_subaccount",
    "## 功能：创建新的子账户\n## 场景：用于创建子账户管理多个交易策略、隔离资金和风险\n## 关键词：创建子账户, create subaccount, 新增子账号\n## 参数：\n##   - subAcct: 子账户名称。必填\n##   - label: 子账户备注。可选\n## 鉴权：🔴 需要主账户 API Key（管理）- 将创建新子账户，调用前必须确认\n## 风险：ADMIN — 创建子账户影响账户结构，调用前必须由用户确认\n## 返回量：微小 ~500B\n## 关联：本工具创建 → okx_list_subaccounts 查看 → okx_create_subaccount_api_key 设置API",
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

  server.tool(
    "okx_get_entrust_subaccount_list",
    "## 功能：获取委托子账户列表\n## 场景：用于查看托管子账户、管理委托交易权限\n## 关键词：委托子账户, entrust subaccount, 托管账户, 委托管理\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看委托子账户 → 管理子账户权限",
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
