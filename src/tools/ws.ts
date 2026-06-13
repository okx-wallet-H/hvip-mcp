/**
 * OKX WebSocket streaming tools for Agent.
 *
 * In-memory event buffer shared across tool calls.
 * Agent calls okx_ws_subscribe once → events flow → okx_ws_events drains.
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError } from "./shared.js"
import { WsManager } from "../adapters/ws.js"

let wsManager: WsManager | null = null
function getOrCreateWs(): WsManager {
  if (!wsManager) wsManager = new WsManager()
  return wsManager
}

const PUBLIC_CHANNELS = [
  "tickers", "trades",
  "candle1m", "candle5m", "candle15m", "candle1H", "candle4H", "candle1D",
  "books5", "books",
  "mark-price", "funding-rate", "open-interest", "price-limit", "index-tickers",
] as const

export function registerWsTools(server: McpServer): void {

  server.tool(
    "okx_ws_subscribe",
    "CAT:[行情-WS] | ## 功能：订阅OKX WebSocket实时数据，事件自动缓冲在内存中\n## 场景：Agent 需要实时监控行情变化而非轮询时调用\n## 关键词：WebSocket, ws, 实时推送, 实时行情, 订阅, subscribe, 流式\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT、ETH-USDT-SWAP\n##   - channel: 频道名。(tickers/trades/candle1m~1D/books5/books等)\n##   - instType: SPOT/SWAP/FUTURES/OPTION（tickers/trades 频道需要）\n## 鉴权：PUBLIC — 公开频道\n## 风险：READ — 只读订阅\n## 返回量：微小 ~500B\n## 关联：本工具订阅 → okx_ws_events 拉取 → 决策 → okx_ws_close 关闭",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT"),
      channel: z.string().describe("频道名"),
      instType: z.enum(["SPOT","SWAP","FUTURES","OPTION"]).optional().describe("tickers/trades 需要"),
    },
    async ({ instId, channel }) => {
      try {
        if (!PUBLIC_CHANNELS.includes(channel as any)) {
          return toError(new Error(`频道 "${channel}" 不支持。支持: ${PUBLIC_CHANNELS.join(" ")}`))
        }
        const ws = getOrCreateWs()
        const subId = await ws.subscribe({ channel, instId: instId.toUpperCase(), type: "public" })
        return toResult({
          subscribed: true,
          subscriptionId: subId,
          channel,
          instId: instId.toUpperCase(),
          buffered: ws.countBuffered(subId),
          hint: `已订阅 ${instId.toUpperCase()} ${channel}。调用 okx_ws_events 拉取事件。`,
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
