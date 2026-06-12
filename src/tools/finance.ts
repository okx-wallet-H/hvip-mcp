import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerFinanceTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_savings_balance",
    "## 功能：查询活期赚币（简单赚币）的持仓余额，含当前年化利率\n## 场景：用于了解资金利用效率、判断是否值得把闲置USDT放入赚币、监控活期收益\n## 关键词：活期赚币, savings, 理财余额, 年化利率, 灵活理财, 赚币\n## 参数：\n##   - ccy: 币种，如 USDT，不填则返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具看赚币余额 → okx_get_savings_history 看收益 → 决定是否赎回",
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
    "## 功能：查询活期赚币的历史收益记录\n## 场景：用于复盘利息收入、计算实际年化收益、对账\n## 关键词：赚币收益, savings history, 利息记录, 活期收益, 理财收益\n## 参数：\n##   - ccy: 币种，如 USDT\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_savings_balance 看余额 → 本工具看收益 → 计算实际年化",
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
    "## 功能：获取链上质押（ETH/SOL/等）的产品列表\n## 场景：用于比较不同质押产品的收益率、选择最优质押方案\n## 关键词：质押产品, staking offers, ETH质押, SOL质押, 链上质押, 年化\n## 参数：\n##   - productId: 指定产品ID，不填则返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB\n## 关联：本工具比较质押产品 → okx_get_eth_staking_balance 或 okx_get_sol_staking_balance 看持仓",
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
    "## 功能：查询ETH质押（BETH）持仓余额\n## 场景：用于查看ETH质押总量、BETH数量和当前年化收益\n## 关键词：ETH质押, ETH staking, BETH, 质押余额, 质押收益\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：okx_get_staking_offers 看产品 → 本工具看持仓 → okx_get_eth_staking_history 看操作记录",
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
    "## 功能：查询ETH质押/赎回历史记录\n## 场景：用于追踪ETH质押和赎回操作、核对操作时间和数量\n## 关键词：ETH质押历史, staking history, 质押记录, 赎回记录\n## 参数：\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_eth_staking_balance 看余额 → 本工具看操作记录 → 计算收益",
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
    "## 功能：查询SOL质押持仓余额\n## 场景：用于查看SOL质押总量和当前年化收益\n## 关键词：SOL质押, SOL staking, 质押余额, 质押收益\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~300B\n## 关联：okx_get_staking_offers 看产品 → 本工具看SOL持仓 → 决定是否赎回",
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
    "## 功能：查询链上质押的订单/历史记录\n## 场景：用于查看ETH/SOL质押的申购和赎回记录、追踪质押操作状态\n## 关键词：质押订单, staking orders, 质押记录, 质押历史, 申购赎回\n## 参数：\n##   - productId: 产品ID，如 ETH。可选\n##   - state: 订单状态。1=等待申购, 2=申购中, 3=申购成功, 4=赎回中, 5=赎回成功, 6=已取消。可选\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查记录 → okx_stake_eth/okx_unstake_eth 操作 → okx_get_eth_staking_balance 确认",
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
    "## 功能：申购ETH链上质押\n## 场景：用于将ETH存入质押以赚取年化收益、长期持有ETH的被动收益\n## 关键词：ETH质押, stake eth, 申购质押, ETH存入, 质押申购\n## 参数：\n##   - amt: 质押数量（ETH）。必填\n##   - rate: 收益率类型。0.5=活期, 0.01=定期。可选\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认申购数量\n## 风险：FUND_TRANSFER — 质押ETH将锁仓，提现到账有延迟，调用前必须向用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_eth_staking_balance 看持仓 → 本工具申购 → okx_get_staking_orders 确认",
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
    "## 功能：赎回ETH链上质押\n## 场景：用于将质押的ETH赎回、提取质押收益、应对提现需求\n## 关键词：赎回ETH, unstake eth, 解除质押, ETH赎回, 提取质押\n## 参数：\n##   - amt: 赎回数量（ETH）。必填\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认赎回数量\n## 风险：FUND_TRANSFER — 赎回ETH需要等待链上确认，调用前必须向用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_eth_staking_balance 看持仓 → 本工具赎回 → okx_get_eth_staking_history 确认",
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
    "## 功能：查询SOL质押的申购/赎回历史记录\n## 场景：用于追踪SOL质押操作、核对质押和赎回记录\n## 关键词：SOL质押历史, sol staking history, 质押记录, SOL赎回记录\n## 参数：\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_sol_staking_balance 看持仓 → 本工具看操作历史 → 计算收益",
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
    "## 功能：申购或赎回活期赚币\n## 场景：用于将闲置资金存入活期赚币获取收益、或赎回赚币\n## 参数：\n##   - ccy: 币种。必填\n##   - amt: 申购数量。必填\n##   - side: 方向。purchase=申购, redempt=赎回。必填\n##   - rate: 利率。可选\n## 鉴权：🔴 需要 API Key（交易）- 将操作活期赚币，调用前必须确认\n## 风险：FUND_TRANSFER — 申购/赎回影响资金，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_savings_balance 看余额 → 本工具操作 → okx_get_savings_history 确认",
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
    "## 功能：获取鲨鱼鳍（SFP）产品列表\n## 场景：用于查看可购买的鲨鱼鳍结构化产品\n## 关键词：鲨鱼鳍, SFP, sfp products, 结构性产品\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具查看产品 → 选择购买 → 管理收益",
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
    "## 功能：赎回鲨鱼鳍（SFP）产品\n## 场景：用于提前赎回鲨鱼鳍结构性产品\n## 关键词：赎回SFP, redeem sfp, 鲨鱼鳍赎回\n## 参数：\n##   - productId: 产品ID。必填\n##   - amt: 赎回数量。必填\n## 鉴权：🔴 需要 API Key（交易）- 将赎回产品，调用前必须确认\n## 风险：FUND_TRANSFER — 赎回影响资金，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_sfp_products 查看产品 → 本工具赎回 → 确认到账",
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
    "## 功能：查询当前活跃的质押订单\n## 场景：用于查看正在申购或赎回中的质押订单\n## 关键词：质押活跃订单, active orders, 质押进行中\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看活跃订单 → okx_get_staking_orders 看全部 → 管理质押",
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
    "## 功能：取消ETH质押的赎回请求\n## 场景：用于在赎回确认前取消赎回操作\n## 关键词：取消赎回, cancel redeem, 取消ETH赎回\n## 参数：\n##   - amt: 取消赎回数量。必填\n## 鉴权：🔴 需要 API Key（交易）- 将取消赎回请求，调用前必须确认\n## 风险：WRITE — 取消赎回后ETH将继续质押，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_stake_eth 质押 → 本工具取消赎回 → ETH继续生息",
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
    "## 功能：申购SOL链上质押\n## 场景：用于将SOL存入质押以赚取收益\n## 关键词：SOL质押, stake sol, SOL申购, 质押SOL\n## 参数：\n##   - amt: 质押数量（SOL）。必填\n## 鉴权：🔴 需要 API Key（交易）- 将申购SOL质押，调用前必须确认\n## 风险：FUND_TRANSFER — 质押SOL后需等待赎回，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_sol_staking_balance 看持仓 → 本工具申购 → okx_get_staking_orders 确认",
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
    "## 功能：赎回SOL链上质押\n## 场景：用于将质押的SOL赎回\n## 关键词：赎回SOL, redeem sol, SOL解质押\n## 参数：\n##   - amt: 赎回数量（SOL）。必填\n## 鉴权：🔴 需要 API Key（交易）- 将赎回SOL质押，调用前必须确认\n## 风险：FUND_TRANSFER — 赎回SOL需等待链上确认，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：okx_get_sol_staking_balance 看持仓 → 本工具赎回 → 确认到账",
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
    "## 功能：调整灵活借贷的抵押品\n## 场景：用于增加或减少灵活借贷的抵押资产\n## 关键词：抵押调整, adjust collateral, 灵活借贷, 抵押品管理\n## 参数：\n##   - ccy: 抵押币种。必填\n##   - amt: 调整数量。必填\n##   - side: 方向。add=增加抵押, reduce=减少抵押。必填\n## 鉴权：🔴 需要 API Key（交易）- 将调整抵押品，调用前必须确认\n## 风险：FUND_TRANSFER — 调整抵押品影响借贷，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具调整 → 管理借贷风险 → 避免强平",
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
    "## 功能：查询灵活借贷支持的抵押资产\n## 场景：用于查看可抵押的币种和抵押率\n## 关键词：抵押资产, collateral assets, 灵活借贷抵押\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看抵押资产 → 调整抵押 → 管理借贷",
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
    "## 功能：查询灵活借贷信息\n## 场景：用于查看当前借贷详情\n## 关键词：灵活借贷, loan info, 借贷信息\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看借贷 → 管理风险",
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
    "## 功能：查询灵活借贷历史\n## 场景：用于追踪借贷操作记录\n## 关键词：借贷历史, loan history, 灵活借贷记录\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
    "## 功能：查询稳定币奖励产品\n## 场景：用于查看稳定币理财产品的收益率\n## 关键词：稳定币奖励, stable rewards, 稳定币理财\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
    "## 功能：获取活期借币利率历史\n## 场景：用于分析借币利率走势\n## 关键词：利率历史, lending rate history, 借币利率走势\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看利率历史 → okx_get_savings_balance 看余额",
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
    "## 功能：设置活期赚币出借利率\n## 场景：用于调整活期赚币的期望出借利率\n## 参数：\n##   - ccy: 币种。必填\n##   - rate: 出借利率。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改利率，调用前必须确认\n## 风险：WRITE — 修改利率影响收益，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具设利率 → okx_get_savings_balance 确认生效",
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
    "## 功能：查询稳定币奖励APY历史\n## 场景：用于查看稳定币理财的年化收益率历史\n## 关键词：稳定币APY, stable apy, 年化历史\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
    "## 功能：查询稳定币奖励申购赎回历史\n## 场景：用于查看稳定币理财的操作记录\n## 关键词：稳定币记录, stable history, 申购赎回\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
    "## 功能：查询鲨鱼鳍产品订单历史\n## 场景：用于查看鲨鱼鳍产品的申购赎回记录\n## 关键词：鲨鱼鳍历史, sfp history, 结构产品订单\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~5KB",
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
