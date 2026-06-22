import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { toResult, toError, INST_TYPE_RUBIK, INST_TYPE_SWAP_FUT , registerTool} from "./shared.js"

export function registerStatsTools(server: McpServer): void {
  registerTool(
    server,
    "market_long_short_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getLongShortRatio(ccy, begin, end)
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
    "market_taker_volume",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:      z.string().describe("币种，如 BTC"),
      instType: z.enum(INST_TYPE_RUBIK).describe("产品类型"),
      begin:    z.string().optional().describe("开始时间戳（毫秒）"),
      end:      z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, instType, begin, end }) => {
      try {
        const data = await publicApi.getTakerVolume(ccy, instType, begin, end)
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
    "market_open_interest_volume",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().describe("币种，如 BTC"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getOpenInterestVolume(ccy, begin, end)
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
    "market_margin_lending_ratio",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().describe("币种，如 BTC、USDT") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateHistory(ccy)
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
    "market_stats_coins",
    "READ",
    "[D:Market] get long short ratio",
    {},
    async () => {
      try {
        const data = await publicApi.getSupportCoin()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_top_trader_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP、ETH-USDT-SWAP"),
      begin:  z.string().optional().describe("开始时间戳（毫秒）"),
      end:    z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ instId, begin, end }) => {
      try {
        const data = await publicApi.getTopTraderLongShortRatio(instId, begin, end)
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
    "market_put_call_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getOptionPutCallRatio(ccy, begin, end)
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
    "market_lending_rate_summary",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().optional().describe("币种，如 BTC、USDT，不填返回全部") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateSummary(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_top_trader_ls_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getTopTradersContractLSRatio(ccy, begin, end)
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
    "market_contract_taker_volume",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getContractsTakerVolume(ccy, begin, end)
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
    "market_contract_ls_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getContractsLongShortRatio(ccy, begin, end)
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
    "market_long_short_ratio_all",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getContractsLongShortRatio(ccy, begin, end)
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
    "market_taker_flow_contract",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:      z.string().describe("币种，如 BTC。必填"),
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型。SWAP=永续, FUTURES=交割"),
      begin:    z.string().optional().describe("开始时间戳（毫秒）"),
      end:      z.string().optional().describe("结束时间戳（毫秒）"),
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
    "market_open_interest_rubik",
    "READ",
    "[D:Market] get long short ratio",
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
    "market_savings_lending_rate",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().optional().describe("币种，如 BTC、USDT，不填返回全部") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateSummary(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_margin_lending_ratio_history",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().describe("币种，如 BTC、USDT") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateHistory(ccy)
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
    "market_option_open_interest",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().describe("币种，如 BTC、ETH。必填") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getOptionOpenInterestVolume(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_option_oi_expiry",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().describe("币种，如 BTC、ETH。必填") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getOptionOiExpiry(ccy)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts: row[0],
          tsIso: row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          expTime: row[1],
          oi: row[2],
          oiUsd: row[3],
          vol: row[4],
          volUsd: row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_option_oi_strike",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy: z.string().describe("币种，如 BTC、ETH。必填"),
      expTime: z.string().describe("到期日，格式 YYYYMMDD。必填"),
    },
    async ({ ccy, expTime }) => {
      try {
        const data = await publicApi.getOptionOiStrike(ccy, expTime)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts: row[0],
          tsIso: row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          strike: row[1],
          putOi: row[2],
          callOi: row[3],
          putVol: row[4],
          callVol: row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_account_ls_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getLongShortRatio(ccy, begin, end)
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
    "market_contract_trader_ls_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP"),
      begin:  z.string().optional().describe("开始时间戳（毫秒）"),
      end:    z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ instId, begin, end }) => {
      try {
        const data = await publicApi.getTopTraderLongShortRatio(instId, begin, end)
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
    "market_contract_position_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getTopTraderPositionRatio(instId)
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
    "market_option_oi_ratio",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getOptionPutCallRatio(ccy, begin, end)
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
    "market_option_taker_block_volume",
    "READ",
    "[D:Market] get long short ratio",
    { ccy: z.string().describe("币种，如 BTC、ETH。必填") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getOptionTakerBlockVolume(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "market_taker_volume_contract",
    "READ",
    "[D:Market] get long short ratio",
    {
      ccy:    z.string().describe("币种，如 BTC。必填"),
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP。必填"),
    },
    async ({ ccy, instId }) => {
      try {
        const data = await publicApi.getTakerVolumeContract(ccy, instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )
}
