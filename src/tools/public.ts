import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE, INST_TYPE_PUBLIC, INST_TYPE_CONTRACTS, INST_TYPE_SWAP_FUT, INST_TYPE_MARGIN_PUB , registerTool} from "./shared.js"

export function registerPublicTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "market_instruments",
    "READ",
    "[D:Market] 交易产品列表(分页top20) | instType, instId? | 搜索产品用 market_instruments_search",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型"),
      instId: z.string().optional().describe("指定产品ID，不填则返回全量"),
    },
    async ({ instType, instId }) => {
      try {
        const data = await publicApi.getInstruments(instType, instId)
        const arr = data as any[]
        const top = arr.length > 20 ? arr.slice(0, 20) : arr
        return toResult({ total: arr.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_funding_rate",
    "READ",
    "[D:Market] 永续合约当前资金费率 | instId如BTC-USDT-SWAP | 历史趋势用 market_funding_rate_history → 极端费率扫 agent_market_scan",
    { instId: z.string().describe("永续合约产品ID，如 BTC-USDT-SWAP") },
    async ({ instId }) => {
      try {
        const data = await publicApi.getFundingRate(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          fundingTimeIso: item.fundingTime ? new Date(parseInt(item.fundingTime)).toISOString() : undefined,
          nextFundingTimeIso: item.nextFundingTime ? new Date(parseInt(item.nextFundingTime)).toISOString() : undefined,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_mark_price",
    "READ",
    "[D:Market] 标记价格(强平参考价) | instType, instId? | 标记价≠最新价 → 风控看 risk_overview",
    {
      instType: z.enum(INST_TYPE_PUBLIC).describe("产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId: z.string().optional().describe("产品ID，不填则返回该类型全量"),
    },
    async ({ instType, instId }) => {
      try {
        const data = await publicApi.getMarkPrice(instType, instId)
        const arr = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        const top = arr.length > 20 ? arr.slice(0, 20) : arr
        return toResult({ total: arr.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_index_price",
    "READ",
    "[D:Market] 指数现货价格 | instId如BTC-USDT | 指数成分用 market_index_components → 指数K线用 market_index_candles",
    { instId: z.string().describe("指数产品ID，如 BTC-USDT") },
    async ({ instId }) => {
      try {
        const data = await publicApi.getIndexPrice(instId)
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
    "market_open_interest",
    "READ",
    "[D:Market] 合约持仓量 | instType(SWAP/FUTURES/OPTION), instId? | 历史趋势用 market_open_interest_history",
    {
      instType: z.enum(INST_TYPE_CONTRACTS).describe("产品类型。SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId: z.string().optional().describe("产品ID，不填则返回全量"),
    },
    async ({ instType, instId }) => {
      try {
        const data = await publicApi.getOpenInterest(instType, instId)
        const arr = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        const top = arr.length > 20 ? arr.slice(0, 20) : arr
        return toResult({ total: arr.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_time",
    "READ",
    "[D:System] OKX系统当前Unix时间 | 无需参数 | 交易前校时 → 时间偏差可能导致签名失败",
    {},
    async () => {
      try {
        const data = await publicApi.getSystemTime()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_option_summary",
    "READ",
    "[D:Market] 期权合约概要(标的/行权价/到期日列表) | uly如BTC-USD, expTime? | 深入用 market_option_oi_* 系列",
    {
      uly:     z.string().describe("标的指数，如 BTC-USD、ETH-USD"),
      expTime: z.string().optional().describe("到期日筛选，格式 YYYYMMDD，如 20250101"),
    },
    async ({ uly, expTime }) => {
      try {
        const data = await publicApi.getOptSummary(uly, expTime)
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
    "sys_insurance_fund",
    "READ",
    "[D:System] 风险准备金余额 | instType, uly? | 极端行情时参考 → 大量爆仓时保险金会消耗",
    {
      instType: z.enum(INST_TYPE_MARGIN_PUB).describe("产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      uly:      z.string().optional().describe("标的指数，如 BTC-USD（SWAP/FUTURES/OPTION必填）"),
    },
    async ({ instType, uly }) => {
      try {
        const data = await publicApi.getInsuranceFund(instType, uly)
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
    "trade_contract_convert",
    "READ",
    "[D:Trading] 合约张数/币数换算 | instId, sz, unit(coin/contracts), opType(open/close) | 下单前必调 → trade_preflight",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP"),
      sz:      z.string().describe("数量（张数或币数，取决于unit）"),
      unit:    z.enum(["coin","usds","contracts"]).describe("sz的单位：coin=币，contracts=张"),
      opType:  z.enum(["open","close"]).describe("开仓或平仓"),
    },
    async ({ instId, sz, unit, opType }) => {
      try {
        const data = await publicApi.convertContractCoin(instId, sz, unit, opType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_announcements",
    "READ",
    "[D:System] OKX公告列表 | annType?, lang?默认中文 | 公告类型用 sys_announcement_types",
    {
      annType: z.string().optional().describe("公告类型ID，不填返回全部。可先调用 okx_get_announcement_types 查询可用类型"),
      lang:    z.enum(["zh-Hans","en-US"]).optional().describe("语言，默认中文"),
    },
    async ({ annType, lang }) => {
      try {
        const data = await publicApi.getAnnouncements(annType, lang)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_announcement_types",
    "READ",
    "[D:System] OKX公告类型ID列表 | 无需参数 | 配合 sys_announcements 按类型筛选",
    {},
    async () => {
      try {
        const data = await publicApi.getAnnouncementTypes()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_price_limit",
    "READ",
    "[D:Market] 产品限价范围(最高买价/最低卖价) | instId | 下单前必查 → trade_preflight",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填，不支持全量查询"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getPriceLimitBatch("", undefined, instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "account_position_tiers",
    "READ",
    "[D:Account] 仓位档位/维持保证金率 | instType?, instFamily? | 大仓位风控参考 → risk_overview",
    {
      instType:   z.enum(INST_TYPE_SWAP_FUT).describe("产品类型。SWAP=永续合约, FUTURES=交割合约"),
      tdMode:     z.enum(["cross","isolated"]).describe("保证金模式。cross=全仓, isolated=逐仓"),
      instFamily: z.string().optional().describe("产品族，如 BTC-USDT。与 uly 二选一必填"),
      uly:        z.string().optional().describe("标的指数，如 BTC-USDT。与 instFamily 二选一必填"),
    },
    async ({ instType, tdMode, instFamily, uly }) => {
      try {
        const data = await publicApi.getPositionTiers(instType, tdMode, instFamily, uly)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_open_interest_history",
    "READ",
    "[D:Market] 持仓量历史(5min/1H/1D) | instId, period | 配合 market_funding_rate 看多空博弈",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      period: z.enum(["5m","15m","30m","1H","2H","4H","6H","12H","1D","1W"]).optional().describe("时间粒度，默认5m"),
      limit:  z.string().optional().describe("返回条数，默认100，最大14400"),
    },
    async ({ instId, period, limit }) => {
      try {
        const data = await publicApi.getOpenInterestHistory(instId, period, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:    row[0],
          tsIso: row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          oi:    row[1],
          oiCcy: row[2],
          vol:   row[3],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_underlying",
    "READ",
    "[D:Market] 期权标的指数行情 | uly? | 期权定价基准 → 配合 market_option_summary",
    {
      instType: z.enum(INST_TYPE_CONTRACTS).optional().describe("产品类型。SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部"),
    },
    async ({ instType }) => {
      try {
        const data = await publicApi.getUnderlying(instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_taker_flow",
    "READ",
    "[D:Market] 主动买卖流向(买入量/卖出量) | instId, period | 多空力量对比 → scan_sentiment 情绪分析",
    {
      ccy:      z.string().describe("币种，如 BTC。必填"),
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型。SWAP=永续, FUTURES=交割"),
      begin:    z.string().optional().describe("开始时间戳(ms)"),
      end:      z.string().optional().describe("结束时间戳(ms)"),
    },
    async ({ ccy, instType, begin, end }) => {
      try {
        const data = await publicApi.getTakerFlow(ccy, instType, begin, end)
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
    "market_platform_volume",
    "READ",
    "[D:Market] OKX平台24h总交易量 | 无需参数 | 市场整体活跃度参考",
    {},
    async () => {
      try {
        const data = await publicApi.getPlatform24Volume()
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
    "market_call_auction",
    "READ",
    "[D:Market] 集合竞价详情(开盘价/撮合量) | instId | 开盘前后调用",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getCallAuctionDetails(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          auctionEndTimeIso: item.auctionEndTime ? new Date(parseInt(item.auctionEndTime)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_option_family_trades",
    "READ",
    "[D:Market] 期权产品族成交记录 | instFamily | 配合 market_option_summary 看活跃度",
    {
      instFamily: z.string().describe("产品族，如 BTC-USD。必填"),
      limit:      z.number().int().min(1).max(100).optional().describe("返回条数"),
    },
    async ({ instFamily, limit }) => {
      try {
        const data = await publicApi.getOptionInstrumentFamilyTrades(instFamily, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_option_trades",
    "READ",
    "[D:Market] 期权成交记录 | instId?, instFamily? | 历史期权交易明细",
    {
      instFamily: z.string().optional().describe("产品族，如 BTC-USD。与instId二选一"),
      instId:     z.string().optional().describe("期权产品ID，如 BTC-USD-260612-64000-C。与instFamily二选一"),
      limit:      z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instFamily, instId, limit }) => {
      try {
        const data = await publicApi.getOptionTrades(instFamily, instId, limit)
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
    "sys_exchange_rate",
    "READ",
    "[D:System] OKX法币汇率 | 无需参数 | 配合 fund_fiat_* 法币入金系列",
    {},
    async () => {
      try {
        const data = await publicApi.getExchangeRate()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_instruments_search",
    "READ",
    "[D:Market] 搜索交易产品(模糊匹配) | keyword | 找到instId后 → market_instruments 看详情",
    {
      keyword:  z.string().min(2).describe("搜索关键词，如 BTC、ETH、SOL。最少2个字符"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型筛选，不填搜索全部"),
    },
    async ({ keyword, instType }) => {
      try {
        const types = instType ? [instType] : ["SPOT","SWAP","FUTURES","OPTION"]
        const allResults: any[] = []
        for (const t of types) {
          const data = await publicApi.getInstruments(t) as any[]
          const kw = keyword.toUpperCase()
          const matches = data.filter((item: any) =>
            item.instId?.toUpperCase().includes(kw) ||
            item.baseCcy?.toUpperCase().includes(kw) ||
            item.uly?.toUpperCase().includes(kw) ||
            item.quoteCcy?.toUpperCase().includes(kw)
          )
          allResults.push(...matches)
        }
        const top = allResults.slice(0, 20)
        return toResult({ keyword, total: allResults.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_economic_calendar",
    "READ",
    "[D:Market] 宏观经济日历(CPI/FOMC/非农等) | 无需参数 | ⚠️需API Key → 大事件前风控参考",
    {
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
      limit: z.string().optional().describe("返回条数，默认100"),
    },
    async ({ begin, end, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEconomicCalendar(auth, begin, end, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  // ── 公共数据（第二批新缺口） ──────────────────────────────────────────────

  registerTool(
    server,
    "market_index_components",
    "READ",
    "[D:Market] 指数成分股列表 | index如BTC-USD | 指数行情用 market_index_tickers → K线用 market_index_candles",
    {
      index: z.string().describe("指数名称，如 BTC-USD。必填"),
    },
    async ({ index }) => {
      try {
        const data = await publicApi.getIndexComponents(index)
        const enriched = typeof data === 'object' && !Array.isArray(data) ? {
          ...data,
          tsIso: (data as any).ts ? new Date(parseInt((data as any).ts)).toISOString() : undefined,
        } : data
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "sys_discount_info",
    "READ",
    "[D:System] 利率/免息额度 | 无需参数 | 借币前参考 → account_loan_quota",
    {},
    async () => {
      try {
        const data = await publicApi.getDiscountRateInterestFreeQuota()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_estimated_price",
    "READ",
    "[D:Market] 期权预估行权价 | instId | 期权到期前预估结算价",
    {
      instId: z.string().describe("期权产品ID，如 BTC-USD-260612-64000-C。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getEstimatedPrice(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  // ── 公共数据补完（v0.2.26 新缺口） ────────────────────────────────────────

  registerTool(
    server,
    "market_funding_rate_history",
    "READ",
    "[D:Market] 资金费率历史 | instId, limit? | 配合 market_funding_rate 看费率趋势 → 预测结算方向",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, before, after, limit }) => {
      try {
        const data = await publicApi.getFundingRateHistory(instId, before, after, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.fundingTime ? new Date(parseInt(item.fundingTime)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_interest_loan_quota",
    "READ",
    "[D:Market] 借币利率/额度查询 | 无需参数 | 借币前必看 → account_borrow_repay",
    {},
    async () => {
      try {
        const data = await publicApi.getInterestRateLoanQuota()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_premium_history",
    "READ",
    "[D:Market] 溢价/折价历史 | instId, limit? | 基差分析 → 配合 market_index_candles 看期现价差",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      period: z.string().optional().describe("时间粒度，如 1D"),
    },
    async ({ instId, period }) => {
      try {
        const data = await publicApi.getPremiumHistory(instId, period)
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
    "market_delivery_history",
    "READ",
    "[D:Market] 交割/行权历史 | instType?, uly?, after?, before? | 季度交割前后参考",
    {
      instType:   z.enum(INST_TYPE_CONTRACTS).describe("产品类型。SWAP/FUTURES/OPTION。必填"),
      uly:        z.string().optional().describe("标的指数"),
      instFamily: z.string().optional().describe("产品族"),
    },
    async ({ instType, uly, instFamily }) => {
      try {
        const data = await publicApi.getDeliveryExerciseHistory(instType, uly, instFamily)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_settlement_history",
    "READ",
    "[D:Market] 结算历史(资金费率结算) | instType?, uly? | 永续费率结算记录",
    {
      instType:   z.enum(INST_TYPE_CONTRACTS).describe("产品类型。SWAP/FUTURES/OPTION。必填"),
      instFamily: z.string().optional().describe("产品族"),
      uly:        z.string().optional().describe("标的指数"),
    },
    async ({ instType, instFamily, uly }) => {
      try {
        const data = await publicApi.getSettlementHistory(instType, instFamily, uly)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_block_trades",
    "READ",
    "[D:Market] 公开大宗交易记录 | instType? | 大宗询价用 trade_rfq_* 系列",
    {
      instId: z.string().describe("产品ID。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getPublicBlockTrades(instId)
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
    "market_tick_bands",
    "READ",
    "[D:Market] 期权最小变动价位 | instType?, instFamily? | 期权下单前参考",
    {
      instType: z.enum(["OPTION"]).describe("产品类型。仅 OPTION 支持此查询"),
    },
    async ({ instType }) => {
      try {
        const data = await publicApi.getInstrumentTickBands(instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
