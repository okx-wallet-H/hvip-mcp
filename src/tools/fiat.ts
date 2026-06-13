import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerFiatTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_fiat_buy_sell_pair",
    "CAT:[资金-法币] | ## 功能：获取法币买卖支持的币种对\n## 场景：用于查看支持的法币交易对、了解可直接用法币买卖的币种\n## 关键词：法币交易对, fiat pair, 法币买卖, 法币币种\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查支持对 → okx_get_fiat_deposit 查看入金方式",
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
    "CAT:[资金-法币] | ## 功能：获取法币入金信息\n## 场景：用于查看法币充值渠道、入金状态\n## 关键词：法币入金, fiat deposit, 法币充值, 法币入金\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看入金 → okx_get_fiat_deposit_methods 看支付方式",
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
    "CAT:[资金-法币] | ## 功能：查询法币入金订单历史\n## 场景：用于追踪法币充值记录、核对入金状态和金额\n## 关键词：法币入金订单, fiat deposit orders, 充值记录, 入金历史\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查入金历史 → 到账确认 → 交易准备",
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
    "CAT:[资金-法币] | ## 功能：获取法币入金支持的支付方式列表\n## 场景：用于查看可用的法币入金支付方式（银行转账/第三方支付等）\n## 关键词：法币支付方式, fiat methods, 入金方式, 支付渠道\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看支付方式 → 选择合适方式入金",
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
