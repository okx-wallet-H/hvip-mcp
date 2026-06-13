/**
 * OKX Predictions WebSocket tools — WS-01/WS-02/WS-03
 *
 * WS-01: 5 public channels (prediction-market-prices, pm-books, pm-trades, pm-tickers, pm-event-status)
 * WS-02: 5 private channels (pm-order, pm-position, pm-user-trade, pm-balance, pm-pnl)
 * WS-03: 6 K-line channels (pm-candle1m/5m/15m/1H/4H/1D)
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toResult, toError, getAuth, AUTH_REQUIRED } from "./shared.js"
import { PredictionsWsManager, PUBLIC_PM_CHANNELS, CANDLE_PM_CHANNELS, PRIVATE_PM_CHANNELS, ALL_PM_CHANNELS } from "../adapters/ws-predictions.js"
import type { Auth } from "../adapters/okx.js"

let wsManager: PredictionsWsManager | null = null

function getOrCreateWs(auth?: Auth): PredictionsWsManager {
  if (!wsManager) wsManager = new PredictionsWsManager(auth)
  return wsManager
}

export function registerWsPredictionsTools(server: McpServer): void {
  // ── WS-01 + WS-03: 公共频道 + K线频道 ──────────────────────────────────
  server.tool(
    "okx_predictions_ws_subscribe",
    "## 功能：订阅预测市场 WebSocket 实时频道\n## 场景：用于实时获取预测市场行情、深度、成交、事件状态等推送\n## 关键词：预测WS, websocket, 实时订阅, 行情推送\n## 参数：\n##   - channel: 频道名。公频: prediction-market-prices/pm-books/pm-trades/pm-tickers/pm-event-status。K线: pm-candle1m/5m/15m/1H/4H/1D。私频: pm-order/pm-position/pm-user-trade/pm-balance/pm-pnl\n##   - instId: 资产ID，如 yesAssetId 或 event-{eventId}\n## 鉴权：公共频道不需要 Key；私有频道需要 API Key\n## 风险：READ — 只读订阅\n## 返回量：微小 ~300B\n## 关联：本工具订阅 → okx_predictions_ws_events 拉取事件 → okx_predictions_ws_unsubscribe 取消订阅",
    {
      channel: z.enum(ALL_PM_CHANNELS).describe("频道名"),
      instId:  z.string().describe("资产ID，如 yesAssetId 或 event-{eventId}"),
    },
    async ({ channel, instId }) => {
      try {
        const isPrivate = PRIVATE_PM_CHANNELS.includes(channel as any)
        const auth = isPrivate ? getAuth() : undefined
        if (isPrivate && !auth) return toError(AUTH_REQUIRED)
        const ws = getOrCreateWs(auth || undefined)
        const id = await ws.subscribe(channel, instId)
        return toResult({ subId: id, channel, instId, status: "subscribed", tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_ws_unsubscribe",
    "## 功能：取消预测市场 WebSocket 订阅\n## 场景：不再需要某个频道的实时推送时调用\n## 关键词：取消订阅, unsubscribe, ws\n## 参数：\n##   - subId: 订阅ID（subscribe 返回的）\n## 鉴权：PUBLIC\n## 风险：READ\n## 返回量：微小 ~200B\n## 关联：okx_predictions_ws_subscribe → 本工具",
    { subId: z.string().describe("订阅ID") },
    async ({ subId }) => {
      try {
        const ws = getOrCreateWs()
        await ws.unsubscribe(subId)
        return toResult({ subId, status: "unsubscribed", tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_ws_events",
    "## 功能：拉取预测市场 WebSocket 缓冲事件\n## 场景：Agent 轮询调用以获取缓冲的实时事件数据\n## 关键词：拉取事件, events, ws, 缓冲区\n## 参数：\n##   - limit: 拉取条数，默认10\n## 鉴权：PUBLIC\n## 风险：READ\n## 返回量：微小 ~2KB\n## 关联：okx_predictions_ws_subscribe 订阅 → 本工具拉取数据",
    { limit: z.number().int().min(1).max(100).optional().describe("拉取条数，默认10") },
    async ({ limit }) => {
      try {
        const ws = getOrCreateWs()
        const events = ws.events(limit ?? 10)
        return toResult({ count: events.length, events, tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_predictions_ws_status",
    "## 功能：查看预测市场 WebSocket 连接状态\n## 场景：检查连接是否正常、订阅数、缓冲区大小\n## 关键词：状态, status, 连接, ws\n## 参数：无\n## 鉴权：PUBLIC\n## 风险：READ\n## 返回量：微小 ~500B\n## 关联：本工具 → okx_predictions_ws_subscribe",
    {},
    async () => {
      try {
        const ws = getOrCreateWs()
        return toResult({ ...ws.status(), tsIso: new Date().toISOString() })
      } catch (e) { return toError(e) }
    }
  )
}
