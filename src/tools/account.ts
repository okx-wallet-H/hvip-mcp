import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE, INST_TYPE_PUBLIC } from "./shared.js"

export function registerAccountTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_balance",
    "## 功能：查询交易账户余额，含各币种的总权益、可用余额、冻结余额和未实现盈亏\n## 场景：用于查看账户资产、检查是否有足够资金下单、监控未实现盈亏\n## 关键词：余额, balance, 账户资产, 可用余额, 冻结, 权益, 持仓盈亏\n## 参数：\n##   - ccy: 指定币种如 BTC、USDT，不填则返回所有币种\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：下单前必调 → okx_get_balance 确认余额 → okx_get_ticker 查价格 → okx_place_order 下单",
    { ccy: z.string().optional().describe("指定币种如 BTC、USDT，不填则返回所有币种") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getBalance(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_positions",
    "## 功能：查询当前所有持仓信息，含持仓方向、数量、均价、未实现盈亏和杠杆倍数\n## 场景：用于查看当前仓位、监控浮动盈亏、判断风险敞口、决定是否平仓\n## 关键词：持仓, positions, 仓位, 未实现盈亏, 持仓均价, 杠杆, 头寸\n## 参数：\n##   - instType: 产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_balance 看余额 → 本工具看持仓 → okx_get_mark_price 看标记价 → okx_close_position 平仓",
    { instType: z.enum(INST_TYPE_PUBLIC).optional().describe("产品类型，不填则返回全部") },
    async ({ instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getPositions(auth, instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_order",
    "## 功能：查询单笔订单的详细状态，含成交价、成交量、手续费和订单状态\n## 场景：用于确认下单是否成交、核查成交价格和数量、排查订单异常\n## 关键词：订单详情, order, 成交状态, 订单查询, 成交价, 手续费\n## 参数：\n##   - instId: 产品ID\n##   - ordId: 订单ID\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：okx_place_order 下单 → 本工具查订单状态 → okx_get_fills 看成交明细",
    {
      instId: z.string().describe("产品ID"),
      ordId:  z.string().describe("订单ID"),
    },
    async ({ instId, ordId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrder(auth, instId, ordId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_orders_history",
    "## 功能：查询最近的历史成交订单列表（最近3个月）\n## 场景：用于复盘交易表现、统计盈亏、核对历史成交记录\n## 关键词：历史订单, orders history, 成交记录, 交易历史, 复盘, 盈亏统计\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n##   - limit: 返回条数，默认50，最大100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_orders_pending 看挂单 → 本工具看历史成交 → okx_get_fills 看逐笔成交",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认50"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersHistory(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_bills",
    "## 功能：查询交易账户资金流水（账单），含每笔出入金、手续费、资金费率、结算盈亏等\n## 场景：用于审计资金变动、排查不明扣款、统计手续费支出、对账\n## 关键词：账单, bills, 资金流水, 出入金, 手续费记录, 资金费率扣款, 对账\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部\n##   - ccy: 币种，如 USDT\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_balance 看余额变化 → 本工具查原因 → okx_get_orders_history 交叉验证",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型，不填返回全部"),
      ccy:      z.string().optional().describe("币种，如 USDT"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instType, ccy, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountBills(auth, instType, ccy, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_config",
    "## 功能：查询账户当前配置，含账户模式（单币种/多币种/组合保证金）、持仓模式（单向/双向）和主账户UID\n## 场景：用于了解账户交易权限、确认持仓模式是否支持所需策略、排查下单失败原因\n## 关键词：账户配置, account config, 持仓模式, 账户模式, UID, 保证金模式\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：下单前必调 → 本工具确认账户配置 → okx_get_leverage_info 查杠杆 → okx_place_order 下单",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountConfig(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_leverage_info",
    "## 功能：查询指定产品的当前杠杆倍数设置\n## 场景：用于交易前确认风险敞口、验证杠杆是否在档位允许范围内\n## 关键词：杠杆, leverage, 杠杆倍数, 风险敞口, 保证金\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP\n##   - mgnMode: 保证金模式：isolated=逐仓，cross=全仓\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~300B\n## 关联：okx_get_position_tiers 查杠杆上限 → 本工具查当前杠杆 → okx_set_leverage 调整",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP"),
      mgnMode: z.enum(["isolated","cross"]).describe("保证金模式：isolated=逐仓，cross=全仓"),
    },
    async ({ instId, mgnMode }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getLeverageInfo(auth, instId, mgnMode)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_max_size",
    "## 功能：查询某产品最大可开仓数量\n## 场景：用于下单前判断最大可买卖数量、验证用户输入的数量是否超限\n## 关键词：最大可开, 最大下单量, max size, 可开数量, 下单上限\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - tdMode: 保证金模式。cross=全仓, isolated=逐仓, cash=非保证金。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~200B — 微小\n## 关联：先调 okx_get_instruments 获取产品 → 本工具查最大可开 → okx_place_order 下单",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      tdMode: z.enum(["cross","isolated","cash"]).describe("保证金模式。cross=全仓, isolated=逐仓, cash=非保证金"),
      ccy:    z.string().optional().describe("币种（仅MARGIN全仓时需要），如 USDT"),
    },
    async ({ instId, tdMode, ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMaxSize(auth, instId, tdMode, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_fee_rates",
    "## 功能：查询账户当前手续费率\n## 场景：用于计算交易成本、比较不同等级费率差异、下单前估算手续费\n## 关键词：手续费, 费率, fee rate, 交易费, maker, taker\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部\n##   - instId: 产品ID，如 BTC-USDT。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：okx_get_account_config 查账户配置 → 本工具查费率 → okx_place_order 下单计算成本",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型，不填返回全部"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT"),
      uly:      z.string().optional().describe("标的指数，如 BTC-USDT"),
    },
    async ({ instType, instId, uly }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFeeRates(auth, instType, instId, uly)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_positions_history",
    "## 功能：查询历史持仓记录（已平仓仓位）\n## 场景：用于复盘历史交易、分析平仓盈亏、统计胜率、审计交易记录\n## 关键词：历史持仓, 平仓记录, positions history, 已平仓, 平仓盈亏, 交易复盘\n## 参数：\n##   - instType: 产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。可选，不填返回全部\n##   - instId: 产品ID，如 BTC-USDT-SWAP。可选\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：okx_get_positions 查当前持仓 → 本工具查历史平仓 → okx_get_order_history 核对订单",
    {
      instType: z.enum(INST_TYPE_PUBLIC).optional().describe("产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT-SWAP"),
      limit:    z.number().optional().describe("返回条数，默认100"),
    },
    async ({ instType, instId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getPositionsHistory(auth, instType, instId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_leverage",
    "## 功能：设置某产品的杠杆倍数\n## 场景：用于调整杠杆（不同持仓量档位对应不同最大杠杆）、在行情波动大时降低杠杆控制风险\n## 关键词：设置杠杆, 调整杠杆, set leverage, 杠杆倍数, 全仓逐仓\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - lever: 杠杆倍数，如 10。必填（需在 okx_get_position_tiers 返回的范围内）\n##   - mgnMode: 保证金模式。cross=全仓, isolated=逐仓。必填\n##   - posSide: 持仓方向。不填则双向生效\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：ADMIN — 修改账户配置，须向用户解释杠杆倍数和爆仓风险后再确认\n## 返回量：微小 ~200B\n## 关联：先调 okx_get_position_tiers 确认杠杆上限 → 本工具设置杠杆 → okx_place_order 下单",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      lever:   z.string().describe("杠杆倍数，如 10。必须在仓位档位允许范围内"),
      mgnMode: z.enum(["cross","isolated"]).describe("保证金模式。cross=全仓, isolated=逐仓"),
      posSide: z.enum(["long","short"]).optional().describe("持仓方向。不填则双向生效"),
    },
    async ({ instId, lever, mgnMode, posSide }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, lever, mgnMode }
        if (posSide) body.posSide = posSide
        const data = await privateApi.setLeverage(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_max_loan",
    "## 功能：查询某产品的最大可借数量\n## 场景：用于杠杆交易前判断最大可借额度、计算保证金使用率\n## 关键词：最大可借, 借款上限, max loan, 杠杆借款, 可借额度\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT。必填\n##   - mgnMode: 保证金模式。cross=全仓, isolated=逐仓。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~200B — 微小\n## 关联：okx_get_max_size 查可开数量 → 本工具查可借额度 → okx_place_order 下单",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT。必填"),
      mgnMode: z.enum(["cross","isolated"]).describe("保证金模式。cross=全仓, isolated=逐仓"),
    },
    async ({ instId, mgnMode }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMaxLoan(auth, instId, mgnMode)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_interest_accrued",
    "## 功能：查询借币利息累计明细\n## 场景：用于计算当前借币成本、评估持仓利息负担、决定是否提前还款\n## 关键词：借币利息, 利息明细, interest accrued, 借款成本, 利息累计\n## 参数：\n##   - instId: 产品ID，可选\n##   - ccy: 币种，如 USDT。可选\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_balance 查余额 → 本工具查利息 → 计算净收益",
    {
      instId: z.string().optional().describe("产品ID，可选"),
      ccy:    z.string().optional().describe("币种，如 USDT"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, ccy, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getInterestAccrued(auth, instId, ccy, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_position_mode",
    "## 功能：设置持仓模式（单向持仓/双向持仓）\n## 场景：用于切换持仓模式（如从单向切到双向支持同时做多空）、开单前确认持仓模式正确\n## 关键词：持仓模式, 持仓方向, position mode, 双向持仓, 单向持仓, 锁仓\n## 参数：\n##   - posMode: 持仓模式。long_short_mode=双向持仓, net_mode=单向持仓。必填\n## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认\n## 风险：ADMIN — 修改账户配置，影响所有合约/杠杆交易，调用前必须由用户确认\n## 返回量：微小 ~500B\n## 关联：先调 okx_get_account_config 看当前模式 → 本工具切换 → 调 okx_set_leverage 设杠杆",
    {
      posMode: z.enum(["long_short_mode","net_mode"]).describe("持仓模式。long_short_mode=双向持仓, net_mode=单向持仓"),
    },
    async ({ posMode }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setPositionMode(auth, { posMode })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_asset_valuation",
    "## 功能：获取OKX账户总资产估值（含交易账户和资金账户总权益）\n## 场景：用于查看总资产概况、按币种统计持仓价值、核对账户总权益变化\n## 关键词：资产估值, 总资产, asset valuation, 账户总权益, 资产概况\n## 参数：\n##   - ccy: 计价币种，如 USD、CNY。不填默认按所有币种\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：本工具看总资产 → okx_get_balance 看交易账户 → okx_get_funding_balance 看资金账户",
    {
      ccy: z.string().optional().describe("计价币种，如 USD、CNY。不填默认按所有币种"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAssetValuation(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_convert_currencies",
    "## 功能：获取OKX支持的一键兑换币种列表\n## 场景：用于在闪兑前查看支持哪些兑换对、确认目标币种是否可兑换\n## 关键词：兑换币种, convert currencies, 闪兑列表, 兑换支持, 可兑换币种\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查可兑换币种 → okx_convert_trade 执行兑换 → okx_get_easy_convert_history 查记录",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getConvertCurrencies(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_convert_trade",
    `## 功能：执行资产兑换（将一种资产直接换成另一种，如 USDT→BTC）
## 场景：用于快速换币、小额资产兑换、无需挂单的即时兑换
## 关键词：兑换, convert trade, 资产兑换, 换币, 一键兑换, 闪兑
## 参数：
##   - fromCcy: 卖出币种，如 USDT。必填
##   - toCcy: 买入币种，如 BTC。必填
##   - sz: 卖出数量。必填
## 鉴权：🔴 需要 API Key（交易）- 调用前须向用户确认兑换方向和数量
## 风险：FUND_TRANSFER — 产生真实兑换交易，调用前必须向用户确认
## 返回量：微小 ~500B
## 关联：okx_get_convert_currencies 查支持币种 → 本工具兑换 → okx_get_balance 确认到账`,
    {
      fromCcy: z.string().describe("卖出币种，如 USDT。必填"),
      toCcy:   z.string().describe("买入币种，如 BTC。必填"),
      sz:      z.string().describe("卖出数量。必填"),
    },
    async ({ fromCcy, toCcy, sz }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.convertTrade(auth, { fromCcy, toCcy, sz })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_margin_balance",
    "## 功能：查询某产品的保证金余额详情\n## 场景：用于杠杆/合约交易前查看可用保证金、占用保证金、保证金率\n## 关键词：保证金余额, 保证金率, margin balance, 可用保证金, 占用保证金\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT。必填\n##   - mgnMode: 保证金模式。cross=全仓, isolated=逐仓。必填\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：okx_get_balance 查总余额 → 本工具查保证金 → okx_get_positions 查持仓",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT。必填"),
      mgnMode: z.enum(["cross","isolated"]).describe("保证金模式。cross=全仓, isolated=逐仓"),
    },
    async ({ instId, mgnMode }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMarginBalance(auth, instId, mgnMode)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_bills",
    "## 功能：查询账户账单流水（所有币种的全部交易流水）\n## 场景：用于审计交易记录、查看资金流向、调试不明扣款\n## 关键词：账单, bills, 资金流水, 交易流水, 账户账单\n## 参数：\n##   - instType: 产品类型。SPOT/MARGIN/SWAP/FUTURES/OPTION。可选\n##   - ccy: 币种，如 USDT。可选\n##   - limit: 返回条数，默认100\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具查流水 → okx_get_account_bills 查账单详情 → 对账",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型，不填返回全部"),
      ccy:      z.string().optional().describe("币种，如 USDT"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instType, ccy, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountBills(auth, instType, ccy, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_interest_rates",
    "## 功能：查询各币种的借币利率\n## 场景：用于比较不同币种的借贷成本、计算持仓利息、选择低成本借币币种\n## 关键词：借币利率, interest rate, 利率查询, 借贷成本, 币种利率\n## 参数：\n##   - ccy: 币种，如 USDT、BTC。可选，不填返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查利率 → okx_get_interest_accrued 查已计利息 → 计算总成本",
    {
      ccy: z.string().optional().describe("币种，如 USDT、BTC。不填返回全部"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getInterestRate(auth, ccy)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_max_withdrawal",
    "## 功能：查询各币种的最大可提现数量\n## 场景：用于提现前确认可提额度、判断账户是否有足够资金转出\n## 关键词：最大提现, 可提限额, max withdrawal, 提现额度, 出金上限\n## 参数：\n##   - ccy: 币种，如 USDT。可选，不填返回全部\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查可提额度 → okx_get_balance 确认余额 → okx_withdrawal 提现",
    {
      ccy: z.string().optional().describe("币种，如 USDT。不填返回全部"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMaxWithdrawal(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_greeks",
    "## 功能：查询期权 Greeks 风险参数（Delta/Gamma/Vega/Theta）\n## 场景：用于期权持仓风险评估、计算对冲比例、管理期权敞口\n## 关键词：期权风险, greeks, 期权参数, Delta, Gamma, Vega, Theta, 期权敞口\n## 参数：\n##   - instType: 产品类型。SWAP/FUTURES/OPTION。可选\n##   - instFamily: 产品族，如 BTC-USD。可选\n##   - uly: 标的指数，如 BTC-USD。可选\n##   - instId: 产品ID。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看风险参数 → okx_get_positions 看持仓 → 调整对冲",
    {
      instType:   z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT/MARGIN/SWAP/FUTURES/OPTION"),
      instFamily: z.string().optional().describe("产品族，如 BTC-USD"),
      uly:        z.string().optional().describe("标的指数，如 BTC-USD"),
      instId:     z.string().optional().describe("产品ID"),
    },
    async ({ instType, instFamily, uly, instId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountGreeks(auth, instType, instFamily, uly, instId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_account_mode",
    "## 功能：设置账户模式（单币种/多币种/组合保证金）\n## 场景：用于切换账户模式以支持不同交易策略、升级到高级保证金模式\n## 关键词：账户模式, set account level, 保证金模式, 单币种, 多币种, 组合保证金\n## 参数：\n##   - acctLv: 账户层级。1=简单交易模式, 2=单币种保证金模式, 3=多币种保证金模式, 4=组合保证金模式。必填\n## 鉴权：🔴 需要 API Key（交易）- 修改账户模式影响资金使用方式，调用前必须向用户确认\n## 风险：ADMIN — 修改账户配置，影响所有交易行为和保证金计算，调用前必须由用户确认\n## 返回量：微小 ~500B\n## 关联：okx_get_account_config 查看当前模式 → 本工具切换 → 调整交易策略",
    {
      acctLv: z.enum(["1","2","3","4"]).describe("账户层级。1=简单交易, 2=单币种保证金, 3=多币种保证金, 4=组合保证金"),
    },
    async ({ acctLv }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setAccountLevel(auth, { acctLv })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_position_risk",
    "## 功能：查询账户持仓风险\n## 场景：用于评估账户整体风险敞口、查看各产品的风险率\n## 关键词：持仓风险, position risk, 风险敞口, 账户风控\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具查风险 → okx_get_positions 查持仓 → 调整风险管理",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountPositionRisk(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_interest_limits",
    "## 功能：查询各币种的利息限额\n## 场景：用于查看各币种的免息额度和利息上限\n## 关键词：利息限额, interest limits, 免息额度, 利息上限\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查限额 → okx_get_interest_accrued 看已计息 → 管理借贷",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getInterestLimits(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_subtypes",
    "## 功能：查询账户子类型\n## 场景：用于查看账户的子类型分类和配置\n## 关键词：账户子类型, account subtypes, 账户分类\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查看账户类型 → 了解交易权限",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountSubtypes(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_subaccount_trading_balance",
    "## 功能：查询子账户的交易账户余额\n## 场景：用于查看子账户的交易资金\n## 关键词：子账户交易余额, subaccount trading, 子账户资金\n## 参数：\n##   - subAcct: 子账户名称。必填\n## 鉴权：⚠️ 需要主账户 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具查子账户交易余额 → okx_get_subaccount_assets 查资金余额",
    {
      subAcct: z.string().describe("子账户名称。必填"),
    },
    async ({ subAcct }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSubAccountTradingBalance(auth, subAcct)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_preset_account_switch",
    "## 功能：预设账户模式切换\n## 场景：用于在切换账户模式前预设参数\n## 参数：\n##   - acctLv: 目标账户层级。必填\n## 鉴权：🔴 需要 API Key（交易）- 将预设账户模式切换，调用前必须确认\n## 风险：ADMIN — 影响账户配置，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具预设 → okx_set_account_mode 执行切换",
    {
      acctLv: z.string().describe("目标账户层级。必填"),
    },
    async ({ acctLv }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.presetAccountSwitch(auth, { acctLv })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_activate_option",
    "## 功能：激活期权交易权限\n## 场景：用于开通期权交易功能\n## 关键词：期权激活, activate option, 期权权限, 开通期权\n## 参数：无\n## 鉴权：🔴 需要 API Key（交易）- 将激活期权交易，调用前必须确认\n## 风险：ADMIN — 开通期权后涉及复杂交易品种，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具激活 → okx_get_instruments 查看期权产品 → 交易期权",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.activateOption(auth, {})
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_position_builder",
    "## 功能：组合保证金试算\n## 场景：用于测试不同持仓组合下的保证金需求\n## 关键词：持仓试算, position builder, 组合保证金, 保证金估算\n## 参数：\n##   - body: 试算参数JSON。必填\n## 鉴权：🔴 需要 API Key（交易）- 将进行保证金试算，调用前必须确认\n## 风险：WRITE — 试算操作影响账户状态，调用前必须确认\n## 返回量：中等 ~5KB\n## 关联：本工具试算 → 优化持仓组合 → 降低保证金占用",
    {
      body: z.string().describe("试算参数JSON字符串。必填"),
    },
    async ({ body }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        const data = await privateApi.positionBuilder(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_auto_earn",
    "## 功能：设置自动理财\n## 场景：用于开启或关闭闲置资金的自动理财功能\n## 关键词：自动理财, auto earn, 自动赚币, 闲置资金\n## 参数：\n##   - ccy: 币种。必填\n##   - autoEarn: 是否开启自动理财。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改理财设置，调用前必须确认\n## 风险：WRITE — 修改自动理财设置，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具设置 → okx_get_savings_balance 查看理财余额",
    {
      ccy:      z.string().describe("币种。必填"),
      autoEarn: z.boolean().describe("是否开启自动理财。true=开启, false=关闭"),
    },
    async ({ ccy, autoEarn }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setAutoEarn(auth, { ccy, autoEarn })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_fee_type",
    "## 功能：设置手续费类型\n## 场景：用于切换计费模式（按张/按币）\n## 关键词：手续费类型, fee type, 计费模式, 费率设置\n## 参数：\n##   - feeType: 手续费类型。0=按币, 1=按USDT。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改手续费类型，调用前必须确认\n## 风险：WRITE — 修改计费方式影响交易成本，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：okx_get_fee_rates 看当前费率 → 本工具切类型 → 优化成本",
    {
      feeType: z.enum(["0","1"]).describe("手续费类型。0=按币, 1=按USDT"),
    },
    async ({ feeType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setFeeType(auth, { feeType })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_settle_currency",
    "## 功能：设置账户结算币种\n## 场景：用于更改账户的默认结算货币\n## 关键词：结算币种, settle currency, 默认结算, 计价币种\n## 参数：\n##   - ccy: 结算币种，如 USDT。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改结算币种，调用前必须确认\n## 风险：ADMIN — 修改结算币种影响账户，调用前必须确认\n## 返回量：微小 ~300B\n## 关联：本工具设置 → okx_get_account_config 确认变更生效",
    {
      ccy: z.string().describe("结算币种，如 USDT。必填"),
    },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setSettleCurrency(auth, { ccy })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_position_builder_graph",
    "## 功能：获取组合保证金试算结果图表\n## 场景：用于查看组合保证金模拟结果的图形数据\n## 关键词：试算图表, position builder graph, 保证金模拟\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_position_builder 试算 → 本工具看图表 → 优化组合",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getPositionBuilderGraph(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_precheck_delta_neutral",
    "## 功能：预检Delta中性设置\n## 场景：用于检查期权持仓的Delta中性条件\n## 关键词：Delta中性, delta neutral, 期权对冲, 方向中性\n## 参数：无\n## 鉴权：🔴 需要 API Key（交易）- 将预检Delta中性，调用前必须确认\n## 风险：WRITE — 预检操作，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具预检 → 调整期权持仓 → 实现Delta中性",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.precheckDeltaNeutral(auth, {})
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_trade_fee",
    "## 功能：查询交易手续费（按产品维度）\n## 场景：用于查看具体产品的Maker/Taker费率\n## 关键词：交易手续费, trade fee, maker taker, 费率查询\n## 参数：\n##   - instType: 产品类型。可选\n##   - instId: 产品ID。可选\n##   - uly: 标的指数。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具查产品费率 → okx_get_fee_rates 看账户费率 → 评估交易成本",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型"),
      instId:   z.string().optional().describe("产品ID"),
      uly:      z.string().optional().describe("标的指数"),
    },
    async ({ instType, instId, uly }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getTradeFee(auth, instType, instId, uly)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_risk_state",
    "## 功能：查询账户风控状态\n## 场景：用于了解账户是否存在风险警告\n## 关键词：风控状态, risk state, 账户风险, 强平风险\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查风险 → 强平预警 → 调整保证金",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRiskState(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_borrow_repay",
    "## 功能：借币或还款\n## 场景：用于增加借款或偿还债务\n## 参数：\n##   - ccy: 币种。必填\n##   - side: 方向。borrow=借币, repay=还款。必填\n##   - amt: 数量。必填\n## 鉴权：🔴 需要 API Key（交易）- 将操作借贷，调用前必须确认\n## 风险：FUND_TRANSFER — 借入/偿还资金，调用前必须确认\n## 返回量：微小 ~500B\n## 关联：本工具操作 → okx_get_borrow_repay_history 看记录",
    {
      ccy:  z.string().describe("币种。必填"),
      side: z.enum(["borrow","repay"]).describe("方向。borrow=借币, repay=还款"),
      amt:  z.string().describe("数量。必填"),
    },
    async ({ ccy, side, amt }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.borrowRepay(auth, { ccy, side, amt })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_borrow_repay_history",
    "## 功能：查询借币还款历史\n## 场景：用于追踪借贷操作记录\n## 关键词：借贷历史, borrow repay history, 借款记录\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_borrow_repay 操作 → 本工具查记录",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getBorrowRepayHistory(auth)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_account_bills_archive",
    "## 功能：查询归档账单流水\n## 场景：用于查看3个月前的历史账单\n## 关键词：归档账单, bills archive, 历史账单\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：中等 ~10KB",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountBillsArchive(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_auto_loan",
    "## 功能：设置自动借贷\n## 场景：用于开启或关闭杠杆交易的自动借币功能\n## 参数：\n##   - ccy: 币种。必填\n##   - side: 方向。on=开启, off=关闭。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改自动借贷设置，调用前必须确认\n## 风险：WRITE — 影响杠杆交易，调用前必须确认\n## 返回量：微小 ~300B",
    {
      ccy:  z.string().describe("币种。必填"),
      side: z.enum(["on","off"]).describe("方向。on=开启, off=关闭"),
    },
    async ({ ccy, side }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setAutoLoan(auth, { ccy, autoLoan: side === "on" })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_set_trading_config",
    "## 功能：设置交易配置\n## 场景：用于调整账户的交易参数设置\n## 参数：\n##   - jsonString: 配置参数JSON。必填\n## 鉴权：🔴 需要 API Key（交易）- 将修改交易配置，调用前必须确认\n## 风险：WRITE — 影响交易行为，调用前必须确认\n## 返回量：微小 ~300B",
    {
      jsonString: z.string().describe("配置参数JSON字符串。必填"),
    },
    async ({ jsonString }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(jsonString) as Record<string, unknown>
        const data = await privateApi.setTradingConfig(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_move_positions",
    "## 功能：迁移持仓\n## 场景：用于将持仓在不同账户间迁移\n## 参数：\n##   - body: 迁移参数JSON。必填\n## 鉴权：🔴 需要 API Key（交易）- 将迁移持仓，调用前必须确认\n## 风险：WRITE — 影响持仓，调用前必须确认\n## 返回量：中等 ~2KB",
    {
      body: z.string().describe("迁移参数JSON字符串。必填"),
    },
    async ({ body }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        const data = await privateApi.movePositions(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
