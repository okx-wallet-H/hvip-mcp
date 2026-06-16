import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

export function registerSpreadTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_spreads",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId:  z.string().optional().describe("价差合约ID，如 BTC-USDT_BTC-USDT-SWAP"),
      baseCcy: z.string().optional().describe("标的币种，如 BTC"),
      instId:  z.string().optional().describe("腿合约产品ID，精确筛选"),
      state:   z.enum(["live","expired","suspend"]).optional().describe("合约状态"),
    },
    async ({ sprdId, baseCcy, instId, state }) => {
      try {
        const data = await publicApi.getSpreads(sprdId, baseCcy, instId, state)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_ticker",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID，如 BTC-USD-SWAP_BTC-USD-260925"),
    },
    async ({ sprdId }) => {
      try {
        const data = await publicApi.getSpreadTicker(sprdId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orderbook",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID"),
      depth:  z.number().int().min(1).max(400).optional().describe("深度档位，默认20，最大400"),
    },
    async ({ sprdId, depth }) => {
      try {
        const data = await publicApi.getSpreadOrderbook(sprdId, depth)
        const enriched = (data as any).data || data
        if (enriched && typeof enriched === 'object' && !Array.isArray(enriched)) {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_trades",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ sprdId, limit }) => {
      try {
        const data = await publicApi.getSpreadTrades(sprdId, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_candles",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID"),
      bar:    z.enum(["1m","5m","15m","30m","1H","4H","1D"]).optional().describe("K线周期，默认1H"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, bar, limit }) => {
      try {
        const data = await publicApi.getSpreadCandles(sprdId, bar, limit)
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

  // ── 价差操作类（第十六批新增） ──────────────────────────────────────────────

  server.tool(
    "okx_place_spread_order",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId:  z.string().describe("价差合约ID。必填"),
      side:    z.enum(["buy","sell"]).describe("买卖方向。buy=买入, sell=卖出"),
      ordType: z.enum(["market","limit","post_only","fok","ioc"]).describe("订单类型。market=市价, limit=限价"),
      sz:      z.string().describe("数量。必填"),
      px:      z.string().optional().describe("价格（限价单必填）"),
    },
    async ({ sprdId, side, ordType, sz, px }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { sprdId, side, ordType, sz }
        if (px) body.px = px
        const data = await privateApi.placeSpreadOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_cancel_spread_order",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
      ordId:  z.string().describe("订单ID。必填"),
    },
    async ({ sprdId, ordId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.cancelSpreadOrder(auth, { sprdId, ordId })
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orders",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersPending(auth, sprdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_amend_spread_order",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
      ordId:  z.string().describe("订单ID。必填"),
      newSz:  z.string().optional().describe("新数量"),
      newPx:  z.string().optional().describe("新价格"),
    },
    async ({ sprdId, ordId, newSz, newPx }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const body: Record<string, unknown> = { sprdId, ordId }
        if (newSz) body.newSz = newSz
        if (newPx) body.newPx = newPx
        const data = await privateApi.amendSpreadOrder(auth, body)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orders_history",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersHistory(auth, sprdId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_fills",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadFills(auth, sprdId, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_books",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
    },
    async ({ sprdId }) => {
      try {
        const data = await publicApi.getSpreadOrderbook(sprdId)
        const enriched = (data as any).data || data
        if (enriched && typeof enriched === 'object' && !Array.isArray(enriched)) {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  // ── 价差收尾（第一批新缺口 v0.2.25） ──────────────────────────────────────

  server.tool(
    "okx_get_spread_orders_pending",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersPending(auth, sprdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_orders_history_archive",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadOrdersHistoryArchive(auth, sprdId)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_trades_public",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
    },
    async ({ sprdId }) => {
      try {
        const data = await publicApi.getSpreadPublicTrades(sprdId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_spread_trades_fills",
    "CAT:[策略-价差] | → 请先调用 agent_catalog",
    {
      sprdId: z.string().optional().describe("价差合约ID"),
    },
    async ({ sprdId }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getSpreadTradeFills(auth, sprdId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )
}
