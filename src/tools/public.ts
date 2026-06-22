import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE, INST_TYPE_PUBLIC, INST_TYPE_CONTRACTS, INST_TYPE_SWAP_FUT, INST_TYPE_MARGIN_PUB , registerTool} from "./shared.js"

export function registerPublicTools(server: McpServer, auth: Auth | null): void {
  registerTool(
    server,
    "okx_get_instruments",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_funding_rate",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_mark_price",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_index_price",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_open_interest",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_system_time",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_opt_summary",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_insurance_fund",
    "READ",
    "[D:Market] get instruments",
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
    "okx_convert_contract_coin",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_announcements",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_announcement_types",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_price_limit",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_position_tiers",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_open_interest_history",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_underlying",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_taker_flow",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_platform_24_volume",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_call_auction_details",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_option_instrument_family_trades",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_option_trades",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_exchange_rate",
    "READ",
    "[D:Market] get instruments",
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
    "okx_search_instruments",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_economic_calendar",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_index_components",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_index_components_market",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_discount_info",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_estimated_price",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_funding_rate_history",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_interest_rate_loan_quota",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_premium_history",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_delivery_exercise_history",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_settlement_history",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_public_block_trades",
    "READ",
    "[D:Market] get instruments",
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
    "okx_get_instrument_tick_bands",
    "READ",
    "[D:Market] get instruments",
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
