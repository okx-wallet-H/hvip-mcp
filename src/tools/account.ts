import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE, INST_TYPE_PUBLIC , registerTool} from "./shared.js"

export function registerAccountTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "okx_get_balance",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    { ccy: z.string().optional().describe("指定币种如 BTC、USDT，不填则返回所有币种") },
    async ({ ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getBalance(auth, ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_positions",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    { instType: z.enum(INST_TYPE_PUBLIC).optional().describe("产品类型，不填则返回全部") },
    async ({ instType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getPositions(auth, instType)
        const arr = Array.isArray(data) ? data : []
        // 附操作上下文，让 Agent 无需再查 config 就能平仓
        const enriched = arr.map((p: any) => ({
          ...p,
          tsIso: p.uTime ? new Date(parseInt(p.uTime)).toISOString() : undefined,
          _actionContext: {
            closePosition: "okx_close_position",
            requiredParams: {
              instId: p.instId,
              posSide: p.posSide,
              mgnMode: p.mgnMode || "cross",
              ccy: p.ccy,
            },
            hint: "平仓时直接使用 _actionContext.requiredParams 中的值",
          },
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  // okx_get_order 已在 trading.ts 注册，此处不再重复

  registerTool(
    server,
    "okx_get_orders_history",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_account_bills",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_account_config",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountConfig(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_leverage_info",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_max_size",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_fee_rates",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_positions_history",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_leverage",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_max_loan",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_interest_accrued",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_position_mode",
    "ADMIN",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_asset_valuation",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_convert_currencies",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getConvertCurrencies(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_convert_trade",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_margin_balance",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_bills",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_interest_rates",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_max_withdrawal",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_account_greeks",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_account_mode",
    "ADMIN",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_account_position_risk",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountPositionRisk(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_interest_limits",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getInterestLimits(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_account_subtypes",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountSubtypes(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_subaccount_trading_balance",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_preset_account_switch",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_activate_option",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.activateOption(auth, {})
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_position_builder",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_auto_earn",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_fee_type",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_settle_currency",
    "ADMIN",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_position_builder_graph",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getPositionBuilderGraph(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_precheck_delta_neutral",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.precheckDeltaNeutral(auth, {})
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_trade_fee",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_risk_state",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getRiskState(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_borrow_repay",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_borrow_repay_history",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_get_account_bills_archive",
    "READ",
    "CAT:[账户] | → 请先调用 agent_catalog",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountBillsArchive(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_set_auto_loan",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_set_trading_config",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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

  registerTool(
    server,
    "okx_move_positions",
    "WRITE",
    "CAT:[账户] | → 请先调用 agent_catalog",
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
