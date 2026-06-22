import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE , registerTool} from "./shared.js"

export function registerTradingTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "trade_place",
    "WRITE",
    "[D:Trading] place order",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT"),
      tdMode:  z.enum(["cash","isolated","cross"]).describe("交易模式：cash=现货，isolated=逐仓，cross=全仓"),
      side:    z.enum(["buy","sell"]).describe("买卖方向"),
      ordType: z.enum(["market","limit","post_only","fok","ioc"]).describe("订单类型"),
      sz:      z.string().describe("委托数量"),
      px:      z.string().optional().describe("委托价格（限价单必填）"),
    },
    async ({ instId, tdMode, side, ordType, sz, px }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, tdMode, side, ordType, sz }
        if (px) body["px"] = px
        const data = await privateApi.placeOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_cancel",
    "WRITE",
    "[D:Trading] place order",
    {
      instId: z.string().describe("产品ID"),
      ordId:  z.string().describe("订单ID"),
    },
    async ({ instId, ordId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelOrder(auth, instId, ordId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_amend",
    "WRITE",
    "[D:Trading] place order",
    {
      instId: z.string().describe("产品ID"),
      ordId:  z.string().describe("订单ID"),
      newSz:  z.string().optional().describe("新委托数量"),
      newPx:  z.string().optional().describe("新委托价格"),
    },
    async ({ instId, ordId, newSz, newPx }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId, ordId }
        if (newSz) body["newSz"] = newSz
        if (newPx) body["newPx"] = newPx
        const data = await privateApi.amendOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_orders_active",
    "READ",
    "[D:Trading] place order",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部"),
      instId:   z.string().optional().describe("产品ID，精确筛选"),
      ordType:  z.enum(["market","limit","post_only","fok","ioc"]).optional().describe("订单类型筛选"),
    },
    async ({ instType, instId, ordType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersPending(auth, instType, instId, ordType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_order",
    "READ",
    "[D:Trading] place order",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT"),
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

  registerTool(
    server,
    "trade_fills",
    "READ",
    "[D:Trading] place order",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId:   z.string().optional().describe("产品ID"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instType, instId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFills(auth, instType, instId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_orders_archive",
    "READ",
    "[D:Trading] place order",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认50"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersHistoryArchive(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_place_batch",
    "WRITE",
    "[D:Trading] place order",
    {
      orders: z.string().describe("订单数组JSON字符串，如 '[{\"instId\":\"BTC-USDT\",\"tdMode\":\"cash\",\"side\":\"buy\",\"ordType\":\"limit\",\"sz\":\"0.001\",\"px\":\"60000\"}]'。最多20笔"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.batchOrders(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_cancel_batch",
    "WRITE",
    "[D:Trading] place order",
    {
      orders: z.string().describe("撤单数组JSON字符串，如 '[{\"instId\":\"BTC-USDT\",\"ordId\":\"123456\"}]'"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.cancelBatchOrders(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_close",
    "WRITE",
    "[D:Trading] place order",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      posSide: z.enum(["long","short"]).optional().describe("持仓方向。long=平多头, short=平空头。全仓必填"),
      mgnMode: z.enum(["cross","isolated"]).optional().describe("保证金模式"),
      ccy:     z.string().optional().describe("保证金币种（全仓可选填）"),
    },
    async ({ instId, posSide, mgnMode, ccy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { instId }
        if (posSide) body.posSide = posSide
        if (mgnMode) body.mgnMode = mgnMode
        if (ccy) body.ccy = ccy
        const data = await privateApi.closePosition(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_amend_batch",
    "WRITE",
    "[D:Trading] place order",
    {
      orders: z.string().describe("改单数组JSON字符串，如 '[{\"instId\":\"BTC-USDT\",\"ordId\":\"123\",\"newPx\":\"62000\"}]'。最多20笔"),
    },
    async ({ orders }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(orders) as Record<string, unknown>[]
        const data = await privateApi.amendBatchOrders(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_fills_history",
    "READ",
    "[D:Trading] place order",
    {
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instType, instId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getFillsHistory(auth, instType, instId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_cancel_all",
    "WRITE",
    "[D:Trading] place order",
    {
      instType:   z.enum(INST_TYPE_TRADE).describe("产品类型"),
      instFamily: z.string().optional().describe("产品族，如 BTC-USDT。仅合约需填"),
    },
    async ({ instType, instFamily }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.massCancel(auth, instType, instFamily)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_cancel_all_after",
    "WRITE",
    "[D:Trading] place order",
    {
      timeOut: z.string().describe("倒计时秒数，0=取消定时全撤，正数=设N秒后全撤，最大120秒"),
    },
    async ({ timeOut }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelAllAfter(auth, { timeOut })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_order_precheck",
    "READ",
    "[D:Trading] place order",
    {
      params: z.string().describe("订单参数JSON字符串，如 '{\"instId\":\"BTC-USDT\",\"tdMode\":\"cash\",\"side\":\"buy\",\"ordType\":\"limit\",\"sz\":\"0.001\",\"px\":\"60000\"}'"),
    },
    async ({ params }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const parsed = JSON.parse(params) as Record<string, unknown>
        const data = await privateApi.orderPrecheck(auth, parsed)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_rate_limit",
    "READ",
    "[D:Trading] place order",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getAccountRateLimit(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_easy_convert",
    "WRITE",
    "[D:Trading] place order",
    {
      fromCcy: z.string().describe("卖出币种，如 USDT"),
      toCcy:   z.string().describe("买入币种，如 BTC"),
      sz:      z.string().describe("卖出数量"),
    },
    async ({ fromCcy, toCcy, sz }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.easyConvert(auth, { fromCcy, toCcy, sz })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_easy_convert_history",
    "READ",
    "[D:Trading] place order",
    {
      after:  z.string().optional().describe("查询此时间之后的记录（毫秒Unix时间戳）"),
      before: z.string().optional().describe("查询此时间之前的记录（毫秒Unix时间戳）"),
      limit:  z.string().optional().describe("返回条数，默认100"),
    },
    async ({ after, before, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEasyConvertHistory(auth, after, before, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 交易收尾（第十三批新增） ────────────────────────────────────────────────

  registerTool(
    server,
    "trade_mmp_config",
    "READ",
    "[D:Trading] place order",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getMmpConfig(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_mmp_config_set",
    "WRITE",
    "[D:Trading] place order",
    {
      instFamily:     z.string().describe("产品族，如 BTC-USD。必填"),
      timeInterval:   z.string().describe("时间窗口（毫秒）。必填"),
      frozenInterval: z.string().describe("冻结时间（毫秒）。必填"),
      limit:          z.string().describe("限制量。必填"),
    },
    async ({ instFamily, timeInterval, frozenInterval, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.setMmpConfig(auth, { instFamily, timeInterval, frozenInterval, limit })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "strategy_algo_order",
    "READ",
    "[D:Trading] place order",
    {
      algoId: z.string().optional().describe("策略委托ID"),
    },
    async ({ algoId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrderAlgo(auth, algoId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
  // ── 交易收尾（第二批新缺口） ────────────────────────────────────────────────

  registerTool(
    server,
    "trade_mmp_reset",
    "READ",
    "[D:Trading] place order",
    {
      instFamily: z.string().describe("产品族，如 BTC-USD。必填"),
    },
    async ({ instFamily }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.resetMmp(auth, { instFamily })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_orders_archived",
    "READ",
    "[D:Trading] place order",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型"),
      limit:    z.number().int().min(1).max(100).optional().describe("返回条数，默认50"),
    },
    async ({ instType, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrdersHistoryArchive(auth, instType, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_order_by_client",
    "READ",
    "[D:Trading] place order",
    {
      instId:  z.string().describe("产品ID。必填"),
      clOrdId: z.string().describe("客户端自定义订单ID。必填"),
    },
    async ({ instId, clOrdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOrderByClientId(auth, instId, clOrdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 一键还款（v0.2.26 新缺口） ─────────────────────────────────────────────

  registerTool(
    server,
    "trade_repay_options",
    "READ",
    "[D:Trading] place order",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOneClickRepayCurrencyList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_repay",
    "WRITE",
    "[D:Trading] place order",
    {
      ccy:      z.string().describe("还款使用的币种。必填"),
      repayCcy: z.string().describe("要偿还的债务币种。必填"),
    },
    async ({ ccy, repayCcy }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.oneClickRepay(auth, { ccy, repayCcy })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_repay_history",
    "READ",
    "[D:Trading] place order",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getOneClickRepayHistory(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "trade_easy_convert_currencies",
    "READ",
    "[D:Trading] place order",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEasyConvertCurrencyList(auth)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
