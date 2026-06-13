import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerFundingTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_funding_balance",
    "CAT:[资金] | ## 功能：查询资金账户（非交易账户）余额，含可用余额和冻结余额\n## 场景：用于查看资金账户资产、确认是否有足够资金提现、充值前核对余额\n## 关键词：资金账户, funding balance, 可用余额, 冻结余额, 提现余额\n## 参数：\n##   - ccy: 指定币种，不填则返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_currencies 查币种 → 本工具查余额 → okx_transfer 划转 或 okx_withdrawal 提现",
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
    "CAT:[资金] | ## 功能：账户间资金划转（资金账户 ↔ 交易账户）\n## 场景：用于将资金从资金账户转到交易账户准备交易、或将盈利转回资金账户提现\n## 关键词：划转, transfer, 资金转移, 账户划转, 资金账户, 交易账户\n## 参数：\n##   - ccy: 划转币种\n##   - amt: 划转数量\n##   - from: 转出账户：6=资金账户，18=交易账户\n##   - to: 转入账户：6=资金账户，18=交易账户\n## 鉴权：🔴 需要 API Key（交易）- 调用前必须向用户确认划转方向和金额\n## 风险：FUND_TRANSFER — 划转操作移动真实资金，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_funding_balance 查资金余额 → 本工具划转 → okx_get_balance 确认到账",
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
    "CAT:[资金] | ## 功能：获取OKX支持的所有币种列表，含充值/提现是否开放、最小提现量、手续费等信息\n## 场景：用于充值前确认网络状态、判断某币种是否可提现、了解最小提现限额\n## 关键词：币种列表, currencies, 充值, 提现, 网络, 手续费, 最小提现\n## 参数：\n##   - ccy: 指定币种，如 BTC，不填返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具查币种 → okx_get_deposit_address 获取充值地址 → okx_get_deposit_history 查充值记录",
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
    "CAT:[资金] | ## 功能：获取指定币种的充值地址（含网络/链信息）\n## 场景：用于获取USDT/BTC/ETH等币种的充值地址、确认链名称（ERC20/TRC20等）\n## 关键词：充值地址, deposit address, 充币地址, 入金, 链名称\n## 参数：\n##   - ccy: 币种，如 USDT、BTC、ETH\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用（但需提醒用户核对链名称，充错链不可逆）\n## 返回量：微小 ~500B\n## 关联：okx_get_currencies 确认币种可用 → 本工具获取地址 → okx_get_deposit_history 追踪到账",
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
    "CAT:[资金] | ## 功能：查询充值记录，含状态（待确认/成功/失败）、到账数量和交易哈希\n## 场景：用于追踪充值是否到账、核对充值金额、排查充值失败原因\n## 关键词：充值记录, deposit history, 充币历史, 入金记录, 到账查询\n## 参数：\n##   - ccy: 币种，不填返回全部\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_deposit_address 获取地址 → 充值后 → 本工具追踪到账状态",
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
    "CAT:[资金] | ## 功能：查询提现记录，含提现状态、手续费和链上交易哈希\n## 场景：用于追踪提现进度、核对提现金额、查询链上交易状态\n## 关键词：提现记录, withdrawal history, 出金历史, 提币记录, 链上哈希\n## 参数：\n##   - ccy: 币种，不填返回全部\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_withdrawal 提现 → 本工具追踪提现状态 → okx_get_funding_balance 确认余额变化",
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
    "CAT:[资金] | ## 功能：提币到外部地址\n## 场景：将资产从OKX提现到外部钱包或交易所\n## 关键词：提币, 提现, withdrawal, 出金, 转出\n## 参数：\n##   - ccy: 币种，如 USDT。必填\n##   - amt: 提币数量。必填\n##   - dest: 提币方式。3=内部转账, 4=链上提币。必填\n##   - toAddr: 目标地址。链上提币必填\n##   - chain: 链名称，如 USDT-TRC20。链上提币必填\n##   - fee: 手续费。可选\n## 鉴权：🔴 需要 API Key（提现）- 调用前必须二次确认\n## 风险：FUND_TRANSFER — 提币操作直接转出资金，调用前必须向用户二次确认\n## 返回量：微小 ~500B\n## 关联：okx_get_currencies 查支持币种 → okx_get_funding_balance 确认余额 → 本工具提币",
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
    "CAT:[资金] | ## 功能：获取闪电充值地址（获取临时充值地址）\n## 场景：用于快速生成充值地址接收资金、获取本地货币支付方式的充值信息\n## 关键词：闪电充值, lightning deposit, 快速充值, 充值地址, 闪电入金\n## 参数：\n##   - ccy: 币种，如 USDT。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用（地址有效期内可重复使用）\n## 返回量：微小 ~500B\n## 关联：本工具获取闪电地址 → 用户充值 → okx_get_deposit_history 追踪到账",
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
    "CAT:[资金] | ## 功能：闪电提现（快速提现到本地支付方式）\n## 场景：用于快速提现到第三方支付渠道、小额快速出金\n## 关键词：闪电提现, lightning withdrawal, 快速提现, 闪电出金\n## 参数：\n##   - ccy: 提现币种。必填\n##   - amt: 提现数量。必填\n##   - to: 提现去向。必填\n## 鉴权：🔴 需要 API Key（提现）- 将提现资金，调用前必须向用户二次确认\n## 风险：FUND_TRANSFER — 提现操作直接转出资金，调用前必须二次确认\n## 返回量：微小 ~500B\n## 关联：本工具闪电提现 → okx_get_withdrawal_history 追踪提现状态",
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
    "CAT:[资金] | ## 功能：查询资金划转状态\n## 场景：用于追踪跨账户划转是否到账、确认划转成功\n## 关键词：划转状态, transfer state, 资金划转, 转账状态, 划转查询\n## 参数：\n##   - transferId: 划转ID。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：okx_transfer 划转 → 本工具追踪状态 → 确认到账",
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
    "CAT:[资金] | ## 功能：查询不可交易资产（如法币、非流通代币）的持仓余额\n## 场景：用于查看账户中不能直接交易但可能具有价值的资产\n## 关键词：不可交易资产, non tradable, 法币资产, 非流通资产\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查不可交易资产 → okx_get_balance 看可交易资产 → 全面掌握持仓",
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
    "CAT:[资金] | ## 功能：获取OKX支持的交易所/平台列表（提现外部地址校验用）\n## 场景：用于提现时选择目标交易所、确认提现通道是否可用\n## 关键词：交易所列表, exchange list, 提现平台, 外部交易所\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具查看支持交易所 → okx_withdrawal 提现时选择目标",
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
    "CAT:[资金] | ## 功能：查询充值提现的状态信息\n## 场景：用于查看充值或提现是否到账、链上确认进度\n## 关键词：充提状态, deposit withdraw, 充值状态, 提现状态, 到账查询\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_deposit_address 获取地址 → 充值后 → 本工具查状态",
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
    "CAT:[资金] | ## 功能：查询资金账户的历史账单流水\n## 场景：用于审计资金账户的资金变动、核对出入金记录\n## 关键词：资金账单, asset bills, 资金流水, 资金账户账单\n## 参数：\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具查资金流水 → okx_get_balance 核对余额 → 对账",
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
    "CAT:[资金] | ## 功能：获取闪兑支持的币种对详情\n## 场景：用于查看闪兑交易的兑换比例和支持的兑换对\n## 关键词：兑换币种对, convert pair, 闪兑对, 兑换详情\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查兑换对 → okx_get_convert_estimate_quote 获取预估 → okx_convert_trade 执行",
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
    "CAT:[资金] | ## 功能：获取闪兑预估报价\n## 场景：用于兑换前查看预估兑换率和数量、比较各方案优劣\n## 参数：\n##   - fromCcy: 卖出币种。必填\n##   - toCcy: 买入币种。必填\n##   - sz: 兑换数量。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具获取预估 → okx_get_convert_currency_pair 看详情 → okx_convert_trade 执行",
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
    "CAT:[资金] | ## 功能：获取账户月度账单\n## 场景：用于查看月度交易汇总、收入支出明细\n## 关键词：月度账单, monthly statement, 月结, 月度报告\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具看月度汇总 → 评估月度盈亏 → 调整策略",
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
    "CAT:[资金] | ## 功能：查询资金账户余额\n## 场景：用于查看资金账户各币种可用和冻结余额\n## 参数：\n##   - ccy: 指定币种，不填返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
