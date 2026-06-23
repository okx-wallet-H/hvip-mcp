import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { toResult, toError, INST_TYPE_MARKET , registerTool} from "./shared.js"

export function registerMarketTools(server: McpServer): void {
  registerTool(
    server,
    "market_ticker",
    "READ",
    "[D:Market] 单个产品实时行情：最新价/24h涨跌幅/成交量 | instId如BTC-USDT，支持逗号批量 | 批量扫用market_tickers → 深度用market_orderbook",
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
    "market_tickers",
    "READ",
    "[D:Market] 全部产品行情列表：按产品类型获取所有ticker | instType如SPOT/SWAP/FUTURES/OPTION | 单个用market_ticker → 深度用market_orderbook",
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
    "market_orderbook",
    "READ",
    "[D:Market] 产品深度订单簿：合并档位买卖盘口 | instId必填，depth档位默认20最大400 | 全量深度用market_orderbook_full → 最新行情用market_ticker",
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
    "market_candles",
    "READ",
    "[D:Market] K线数据：OHLCV历史K线 | instId必填，bar周期1m-1W默认1H，limit最大300 | 历史K线用market_candles_history → 指数K线用market_index_candles",
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
    "market_trades",
    "READ",
    "[D:Market] 最新成交记录：产品最近成交明细 | instId必填，limit最大100默认20 | 历史成交用market_trades_history → K线用market_candles",
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
    "market_candles_history",
    "READ",
    "[D:Market] 历史K线数据：带翻页的历史OHLCV | instId必填，bar/after/before翻页，limit最大100 | 最新K线用market_candles → 指数历史K线用market_index_candles_history",
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
    "market_trades_history",
    "READ",
    "[D:Market] 历史成交记录：带翻页的历史成交明细 | instId必填，limit最大100 | 最新成交用market_trades → K线用market_candles",
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
    "sys_status",
    "READ",
    "[D:System] 系统状态查询：OKX API系统维护状态 | 无需参数 | 各模块状态用对应工具返回的tsIso判断",
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
    "market_block_tickers",
    "READ",
    "[D:Market] 大宗交易行情列表：按产品类型获取大宗交易ticker列表 | instType如SPOT/SWAP必填 | 单个大宗用market_block_ticker → 普通ticker用market_tickers",
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
    "market_orderbook_full",
    "READ",
    "[D:Market] 全量深度数据：完整订单簿买卖盘口（L2级别） | instId必填，depth限制档位 | 合并深度用market_orderbook → 最新行情用market_ticker",
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
    "market_index_tickers",
    "READ",
    "[D:Market] 指数行情：指数价格/涨跌幅/24h量 | quoteCcy或instId筛选 | 指数K线用market_index_candles → 普通ticker用market_ticker",
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
    "market_index_candles",
    "READ",
    "[D:Market] 指数K线数据：指数OHLCV历史K线 | instId必填，bar/after/before翻页，limit最大300 | 历史指数K线用market_index_candles_history → 普通K线用market_candles",
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
    "market_block_ticker",
    "READ",
    "[D:Market] 单个产品大宗交易行情 | instId如BTC-USDT必填 | 批量大宗用market_block_tickers → 普通ticker用market_ticker",
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
    "market_index_candles_history",
    "READ",
    "[D:Market] 指数历史K线数据：带翻页的指数OHLCV | instId必填，bar/after/before翻页，limit最大300 | 最新指数K线用market_index_candles → 标记价历史K线用market_mark_candles_history",
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
    "market_mark_candles_history",
    "READ",
    "[D:Market] 标记价历史K线：带翻页的标记价格OHLCV | instId如BTC-USDT-SWAP必填，bar/after/before翻页 | 最新标记价K线用market_mark_candles → 指数历史K线用market_index_candles_history",
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
    "market_mark_candles",
    "READ",
    "[D:Market] 标记价K线数据：标记价格OHLCV历史K线 | instId如BTC-USDT-SWAP必填，bar/after/before翻页 | 标记价历史K线用market_mark_candles_history → 指数K线用market_index_candles",
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
    "market_spread_candles_history",
    "READ",
    "[D:Market] 价差合约历史K线：价差产品的OHLCV历史数据 | sprdId必填，bar/after/before翻页，limit最大300 | 价差交易用sprd模块 → 普通K线用market_candles",
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
