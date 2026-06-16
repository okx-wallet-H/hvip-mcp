import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerFinanceTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_savings_balance",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      ccy: z.string().optional().describe("币种，如 USDT，不填则返回全部"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSavingsBalance(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_savings_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      ccy: z.string().optional().describe("币种，如 USDT"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSavingsLendingHistory(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_staking_offers",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      productId: z.string().optional().describe("指定产品ID，不填则返回全部"),
    },
    async ({ productId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getStakingOffers(auth, productId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_eth_staking_balance",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEthStakingBalance(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_eth_staking_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEthStakingHistory(auth, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_sol_staking_balance",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSolStakingBalance(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_staking_orders",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      productId: z.string().optional().describe("产品ID，如 ETH。可选"),
      state:     z.string().optional().describe("订单状态。1=等待申购, 2=申购中, 3=申购成功, 4=赎回中, 5=赎回成功, 6=已取消"),
      limit:     z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ productId, state, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getStakingOrders(auth, productId, state, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_stake_eth",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      amt:  z.string().describe("质押数量（ETH）。必填"),
      rate: z.string().optional().describe("收益率类型。0.5=活期, 0.01=定期。不填默认活期"),
    },
    async ({ amt, rate }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { amt }
        if (rate) body.rate = rate
        const data = await privateApi.purchaseEthStaking(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_unstake_eth",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      amt: z.string().describe("赎回数量（ETH）。必填"),
    },
    async ({ amt }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.redeemEthStaking(auth, { amt })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_sol_staking_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSolStakingHistory(auth, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )


  server.tool(
    "okx_purchase_savings",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      ccy:  z.string().describe("币种。必填"),
      amt:  z.string().describe("申购数量。必填"),
      side: z.enum(["purchase","redempt"]).describe("方向。purchase=申购, redempt=赎回"),
      rate: z.string().optional().describe("利率"),
    },
    async ({ ccy, amt, side, rate }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { ccy, amt, side }
        if (rate) body.rate = rate
        const data = await privateApi.purchaseSavings(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_sfp_products",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSfpDcdProducts(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_redeem_sfp",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      productId: z.string().describe("产品ID。必填"),
      amt:       z.string().describe("赎回数量。必填"),
    },
    async ({ productId, amt }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.redeemSfpDcd(auth, { productId, amt })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_staking_active_orders",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getStakingActiveOrders(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_redeem_eth",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      amt: z.string().describe("取消赎回数量。必填"),
    },
    async ({ amt }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelRedeemEthStaking(auth, { amt })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_purchase_sol_staking",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      amt: z.string().describe("质押数量（SOL）。必填"),
    },
    async ({ amt }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.purchaseSolStaking(auth, { amt })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_redeem_sol_staking",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      amt: z.string().describe("赎回数量（SOL）。必填"),
    },
    async ({ amt }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.redeemSolStaking(auth, { amt })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_adjust_collateral",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      ccy:  z.string().describe("抵押币种。必填"),
      amt:  z.string().describe("调整数量。必填"),
      side: z.enum(["add","reduce"]).describe("方向。add=增加抵押, reduce=减少抵押"),
    },
    async ({ ccy, amt, side }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.adjustFlexibleLoanCollateral(auth, { ccy, amt, side })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_flexible_loan_collateral",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFlexibleLoanCollateralAssets(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_flexible_loan_info",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFlexibleLoanInfo(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_flexible_loan_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFlexibleLoanHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_stable_rewards_product",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getStableRewardsProductInfo(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_lending_rate_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      try {
        const data = await privateApi.getLendingRateHistoryDetail()
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_lending_rate",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {
      ccy:  z.string().describe("币种。必填"),
      rate: z.string().describe("出借利率。必填"),
    },
    async ({ ccy, rate }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setLendingRate(auth, { ccy, rate })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_stable_rewards_apy",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getStableRewardsApyHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_stable_rewards_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getStableRewardsHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_sfp_order_history",
    "CAT:[金融] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSfpOrderHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
