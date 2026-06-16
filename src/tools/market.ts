import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { toResult, toError, INST_TYPE_MARKET , registerTool} from "./shared.js"

export function registerMarketTools(server: McpServer): void {
  registerTool(
    server,
    "okx_get_ticker",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    { instId: z.string().describe("产品ID，如 BTC-USDT、ETH-USDT-SWAP。支持逗号分隔批量查询，如 BTC-USDT,ETH-USDT,SOL-USDT") },
    async ({ instId }) => {
      try {
        const ids = instId.split(",").map(s => s.trim()).filter(Boolean)
        const allData: any[] = []
        for (const id of ids) {
          const data = await publicApi.getTicker(id) as any[]
          const enriched = data.map((item: any) => ({
            ...item,
            tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          }))
          allData.push(...enriched)
        }
        return toResult(allData)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_tickers",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    { instType: z.enum(INST_TYPE_MARKET).describe("产品类型") },
    async ({ instType }) => {
      try {
        const data = await publicApi.getTickers(instType)
        // 分页保护：全量数据可能很大（~77KB），截取 top 20 按交易量排序
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
    "okx_get_orderbook",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID"),
      depth: z.number().int().min(1).max(400).optional().describe("深度档位，默认20，最大400"),
    },
    async ({ instId, depth }) => {
      try {
        const data = await publicApi.getOrderbook(instId, depth)
        const enriched = (data as any).data || data
        if (Array.isArray(enriched)) {
          const withTsIso = enriched.map((item: any) => ({
            ...item,
            tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          }))
          return toResult(withTsIso)
        }
        if (enriched && typeof enriched === 'object') {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID"),
      bar: z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      limit: z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, limit }) => {
      try {
        const data = await publicApi.getCandles(instId, bar, limit)
        // 修复：数组转语义化对象 [ts,o,h,l,c,vol,volCcy] → {ts,tsIso,open,high,low,close,vol,volCcy}
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_trades",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID"),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ instId, limit }) => {
      try {
        const data = await publicApi.getTrades(instId, limit)
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
    "okx_get_history_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT"),
      bar:     z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:   z.string().optional().describe("查询此时间戳之前的数据（毫秒Unix时间戳，用于翻页）"),
      before:  z.string().optional().describe("查询此时间戳之后的数据（毫秒Unix时间戳）"),
      limit:   z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getHistoryCandles(instId, bar, after, before, limit)
        // 修复：数组转语义化对象
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_history_trades",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, limit }) => {
      try {
        const data = await publicApi.getHistoryTrades(instId, limit)
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
    "okx_get_system_status",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {},
    async () => {
      try {
        const data = await publicApi.getSystemStatus()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_block_tickers",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instType: z.enum(INST_TYPE_MARKET).describe("产品类型"),
    },
    async ({ instType }) => {
      try {
        const data = await publicApi.getBlockTickers(instType)
        // 分页保护：截取 top 20
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
    "okx_get_books_full",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT"),
      depth:  z.number().int().min(1).max(400).optional().describe("深度档位，默认全量，可选限制"),
    },
    async ({ instId, depth }) => {
      try {
        const data = await publicApi.getBooksFull(instId, depth)
        const enriched = (data as any).data || data
        if (Array.isArray(enriched)) {
          const withTsIso = enriched.map((item: any) => ({
            ...item,
            tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          }))
          return toResult(withTsIso)
        }
        if (enriched && typeof enriched === 'object') {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_index_tickers",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      quoteCcy: z.string().optional().describe("计价币种，如 USDT、USD、BTC"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT"),
    },
    async ({ quoteCcy, instId }) => {
      try {
        const data = await publicApi.getIndexTickers(quoteCcy, instId)
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
    "okx_get_index_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("指数产品ID，如 BTC-USDT"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒Unix时间戳）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒Unix时间戳）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getIndexCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )


  // ── 市场数据补完（v0.2.26 新缺口） ────────────────────────────────────────

  registerTool(
    server,
    "okx_get_block_ticker",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getBlockTicker(instId)
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
    "okx_get_history_index_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("指数产品ID，如 BTC-USDT。必填"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getHistoryIndexCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_history_mark_price_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getHistoryMarkPriceCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_mark_price_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getMarkPriceCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_get_sprd_history_candles",
    "READ",
    "CAT:[行情] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
      bar:    z.enum(["1m","5m","15m","30m","1H","4H","1D"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getSpreadHistoryCandles(sprdId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )
}
