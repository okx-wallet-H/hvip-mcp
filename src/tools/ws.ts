/**
 * OKX WebSocket streaming tools for Agent.
 *
 * In-memory event buffer shared across tool calls.
 * Agent calls okx_ws_subscribe once → events flow → okx_ws_events drains.
 * Private channels require API Key — uses same HMAC-SHA256 as REST.
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"
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

  server.tool(
    "okx_ws_subscribe",
    "CAT:[行情-WS] | ## 功能：订阅 OKX WebSocket 实时公开频道，事件自动缓冲在内存中\n## 场景：Agent 需要实时监控行情、爆仓单、资金费率、价差/大宗市场时调用，替代 REST 轮询\n## 关键词：WebSocket, ws, 实时推送, 实时行情, 订阅, subscribe, 爆仓, 资金费率, 价差, 大宗\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT、ETH-USDT-SWAP。status/instruments/economic-calendar 等全局频道不需要 instId\n##   - channel: 频道名。可选: tickers / trades / all-trades / candle1m~1D / books5 / books / funding-rate / open-interest / price-limit / instruments / mark-price / mark-price-candles / index-tickers / index-candles / option-summary / estimated-price / liquidation-orders / adl-warning / event-contract-markets / economic-calendar / status / sprd/* / public-*-block-trades / block-tickers\n## 鉴权：PUBLIC — 公开频道，无需 API Key\n## 风险：READ — 只读\n## 返回量：微小 ~500B\n## 关联：本工具订阅 → okx_ws_events 拉取 → okx_ws_close 关闭",
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

  server.tool(
    "okx_ws_subscribe_private",
    "CAT:[行情-WS] | ## 功能：订阅 OKX WebSocket 私有频道——实时推送账户余额、持仓变动、订单成交、网格/策略/跟单状态\n## 场景：Agent 需要实时跟踪账户变化（非轮询 REST）时调用\n## 关键词：WebSocket, ws, 私有频道, 实时账户, 订单推送, positions, orders, 网格, 跟单\n## 参数：\n##   - instId: 产品ID。account/positions/balance_and_position 等账户级频道可不传\n##   - channel: 私有频道名。可选: account / positions / balance_and_position / position-risk-warning / account-greeks / orders / fills / algo-orders / advance-algo-orders / spot-grid-algo-orders / contract-grid-algo-orders / grid-positions / grid-sub-orders / recurring-buy-orders / lead-trading-notification / deposit-info / withdrawal-info / rfqs / quotes / structure-block-trades / sprd/orders / sprd/trades\n## 鉴权：⚠️ 需要 API Key（必须开通读取权限）\n## 风险：READ — 只读订阅，但需 API Key\n## 返回量：微小 ~500B\n## 关联：本工具订阅 → okx_ws_events 拉取 → okx_ws_close 关闭",
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

  server.tool(
    "okx_ws_events",
    "CAT:[行情-WS] | ## 功能：拉取 okx_ws_subscribe 缓冲的实时事件，每次拉取后清空\n## 场景：Agent 定期检查最新行情、代替轮询 REST API\n## 关键词：拉取, poll, 事件, events, 缓冲区, 最新消息\n## 参数：\n##   - subscriptionId: 订阅ID（选填，不填返回全部）\n##   - limit: 最大返回条数，默认20\n##   - filter: 过滤关键词\n## 鉴权：PUBLIC — 读内存缓冲区\n## 风险：READ — 只读\n## 返回量：受 limit 控制，默认 ~2KB\n## 关联：okx_ws_subscribe 订阅 → 本工具拉取 → 决策",
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

  server.tool(
    "okx_ws_status",
    "CAT:[行情-WS] | ## 功能：查看当前所有 WebSocket 订阅状态及缓冲区事件数量\n## 场景：Agent 查看订阅列表、缓冲区积压情况\n## 关键词：状态, status, 订阅列表, 缓冲区, 连接\n## 参数：无\n## 鉴权：PUBLIC\n## 风险：READ — 只读\n## 返回量：微小 ~500B\n## 关联：okx_ws_subscribe → 本工具 → okx_ws_close 关闭",
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

  server.tool(
    "okx_ws_close",
    "CAT:[行情-WS] | ## 功能：关闭指定或所有 WebSocket 订阅，释放连接资源\n## 场景：Agent 完成监控后清理\n## 关键词：关闭, close, 取消订阅, 断开, 停止\n## 参数：\n##   - subscriptionId: 要关闭的订阅ID（不传关闭所有）\n## 鉴权：PUBLIC\n## 风险：WRITE — 会断开连接，但无资金风险\n## 返回量：微小 ~200B\n## 关联：okx_ws_status → 本工具关闭",
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
