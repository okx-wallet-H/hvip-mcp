/**
 * OKX WebSocket streaming tools for Agent.
 *
 * In-memory event buffer shared across tool calls.
 * Agent calls okx_ws_subscribe once → events flow → okx_ws_events drains.
 * Private channels require API Key — uses same HMAC-SHA256 as REST.
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"
import { WsManager } from "../adapters/ws.js"
import type { Auth } from "../adapters/okx.js"

let wsManager: WsManager | null = null
function getOrCreateWs(): WsManager {
  if (!wsManager) wsManager = new WsManager()
  return wsManager
}

const ALL_CHANNELS = {
  public: [
    // 行情类（10）
    "tickers", "trades", "all-trades", "option-trades",
    "candle1m", "candle5m", "candle15m", "candle1H", "candle4H", "candle1D",
    // 深度类（2）
    "books5", "books",
    // 市场细节（1）
    "call-auction-details",
    // 公共数据（10）
    "mark-price", "mark-price-candles",
    "index-tickers", "index-candles",
    "funding-rate", "open-interest", "price-limit",
    "instruments", "option-summary", "estimated-price",
    // 风险预警（3）
    "liquidation-orders", "adl-warning", "status",
    // 事件合约（1）
    "event-contract-markets",
    // 经济日历（1）
    "economic-calendar",
    // 价差公开（4）
    "sprd/tickers", "sprd/candles", "sprd/order-book", "sprd/public-trades",
    // 大宗公开（3）
    "public-structure-block-trades", "public-block-trades", "block-tickers",
  ],
  private: [
    // 账户（5）
    "account", "positions", "balance_and_position", "position-risk-warning", "account-greeks",
    // 交易（4）
    "orders", "fills", "algo-orders", "advance-algo-orders",
    // 网格（4）
    "spot-grid-algo-orders", "contract-grid-algo-orders", "grid-positions", "grid-sub-orders",
    // 定投（1）
    "recurring-buy-orders",
    // 跟单（1）
    "lead-trading-notification",
    // 资金（2）
    "deposit-info", "withdrawal-info",
    // 大宗私有（3）
    "rfqs", "quotes", "structure-block-trades",
    // 价差私有（2）
    "sprd/orders", "sprd/trades",
  ],
} as const

export function registerWsTools(server: McpServer, auth: Auth | null): void {

  registerTool(
    server,
    "okx_ws_subscribe",
    "READ",
    "CAT:[行情-WS] | → 请先调用 agent_catalog",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT、ETH-USDT-SWAP。纯全局频道（status/instruments/economic-calendar）可传空字符串"),
      channel: z.string().describe("频道名。公开频道共 33 个，支持 tickers/trades/candle1m~1D/books5/books/funding-rate/open-interest/price-limit/instruments/mark-price/mark-price-candles/index-tickers/index-candles/option-summary/estimated-price/liquidation-orders/adl-warning/event-contract-markets/economic-calendar/status/sprd系列/public-block-trades系列/block-tickers"),
      instType: z.enum(["SPOT","SWAP","FUTURES","OPTION"]).optional().describe("部分频道需要产品类型"),
    },
    async ({ instId, channel }) => {
      try {
        if (!(ALL_CHANNELS.public as readonly string[]).includes(channel)) {
          return toError(new Error(
            `频道 "${channel}" 非公开频道。\n公开频道(${ALL_CHANNELS.public.length}个): ${ALL_CHANNELS.public.join(" ")}\n私有频道请用 okx_ws_subscribe_private。`
          ))
        }
        const ws = getOrCreateWs()
        const subId = await ws.subscribe({ channel, instId: instId.toUpperCase(), type: "public" })
        return toResult({
          subscribed: true,
          subscriptionId: subId,
          channel,
          instId: instId.toUpperCase(),
          type: "public",
          buffered: ws.countBuffered(subId),
          hint: `已订阅 ${instId || "全局"} ${channel}。调用 okx_ws_events 拉取事件。`,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_ws_subscribe_private",
    "READ",
    "CAT:[行情-WS] | → 请先调用 agent_catalog",
    {
      instId:  z.string().optional().describe("产品ID。账户级频道可不传（如 account/positions/balances）"),
      channel: z.string().describe("私有频道名。共 22 个: account / positions / balance_and_position / position-risk-warning / account-greeks / orders / fills / algo-orders / advance-algo-orders / spot-grid-algo-orders / contract-grid-algo-orders / grid-positions / grid-sub-orders / recurring-buy-orders / lead-trading-notification / deposit-info / withdrawal-info / rfqs / quotes / structure-block-trades / sprd/orders / sprd/trades"),
    },
    async ({ instId, channel }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        if (!(ALL_CHANNELS.private as readonly string[]).includes(channel)) {
          return toError(new Error(
            `频道 "${channel}" 非私有频道。\n私有频道(${ALL_CHANNELS.private.length}个): ${ALL_CHANNELS.private.join(" ")}\n公开频道请用 okx_ws_subscribe。`
          ))
        }
        const ws = getOrCreateWs()
        const subId = await ws.subscribe({
          channel,
          instId: (instId || "").toUpperCase(),
          type: "private",
          auth,
        })
        return toResult({
          subscribed: true,
          subscriptionId: subId,
          channel,
          instId: (instId || "全局").toUpperCase(),
          type: "private",
          buffered: ws.countBuffered(subId),
          hint: `已订阅私有频道 ${channel}。调用 okx_ws_events 拉取实时事件。`,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_ws_events",
    "READ",
    "CAT:[行情-WS] | → 请先调用 agent_catalog",
    {
      subscriptionId: z.string().optional().describe("订阅ID"),
      limit: z.number().int().min(1).max(50).default(20).describe("最大返回条数"),
      filter: z.string().optional().describe("过滤关键词"),
    },
    async ({ subscriptionId, limit, filter }) => {
      try {
        const ws = getOrCreateWs()
        let events = ws.drain(subscriptionId, limit)
        if (filter) {
          const kw = filter.toLowerCase()
          events = events.filter(e => JSON.stringify(e).toLowerCase().includes(kw))
        }
        events = events.slice(0, limit)
        return toResult({
          events,
          count: events.length,
          active: ws.getStatus().filter(s => s.active),
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_ws_status",
    "READ",
    "CAT:[行情-WS] | → 请先调用 agent_catalog",
    {},
    async () => {
      try {
        const ws = getOrCreateWs()
        return toResult({
          subscriptions: ws.getStatus(),
          totalBuffered: ws.countAllBuffered(),
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  registerTool(
    server,
    "okx_ws_close",
    "READ",
    "CAT:[行情-WS] | → 请先调用 agent_catalog",
    {
      subscriptionId: z.string().optional().describe("订阅ID，不传关闭所有"),
    },
    async ({ subscriptionId }) => {
      try {
        const ws = getOrCreateWs()
        const closed = ws.close(subscriptionId)
        return toResult({
          closed,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )
}
