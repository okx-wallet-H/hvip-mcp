import type { Auth } from "../adapters/okx.js"
import { createHRailsClient, type HRailsClient } from "../adapters/hrails.js"

export function getAuth(): Auth | null {
  const apiKey = process.env["OKX_API_KEY"]
  const secret = process.env["OKX_SECRET_KEY"]
  const passphrase = process.env["OKX_PASSPHRASE"]
  if (!apiKey || !secret || !passphrase) return null
  return {
    apiKey,
    secret,
    passphrase,
    isDemo: process.env["OKX_IS_DEMO"] === "true",
  }
}

export function getHRailsClient(): HRailsClient | null {
  const apiKey = process.env["HRAILS_API_KEY"]
  if (!apiKey) return null
  const base = process.env["HRAILS_BASE_URL"]
  return createHRailsClient(apiKey, base)
}

export const AUTH_REQUIRED = `此功能需要绑定 OKX API Key。

请在 Claude Desktop 配置文件中添加以下内容（hvip 不存储您的密钥，密钥仅保存在您本地）：

{
  "mcpServers": {
    "hvip": {
      "command": "npx",
      "args": ["hvip"],
      "env": {
        "OKX_API_KEY": "你的 API Key",
        "OKX_SECRET_KEY": "你的 Secret Key",
        "OKX_PASSPHRASE": "你的 Passphrase"
      }
    }
  }
}

API Key 在 OKX 官网「个人中心 → API」中创建，只需开通「读取」权限即可查询账户，交易功能还需开通「交易」权限。`

// ── instType 共享枚举（P1-2 修复） ──────────────────────────────────────────
// 每个常量背后是 OKX 不同端点真实支持的参数子集，不可随意合并
export const INST_TYPE_TRADE      = ["SPOT","MARGIN","SWAP","FUTURES","OPTION"] as const  // 交易/账户类
export const INST_TYPE_MARKET     = ["SPOT","SWAP","FUTURES","OPTION"] as const            // 行情类（不支持 MARGIN）
export const INST_TYPE_PUBLIC     = ["MARGIN","SWAP","FUTURES","OPTION"] as const          // 公开数据（标记价等，无 SPOT）
export const INST_TYPE_CONTRACTS  = ["SWAP","FUTURES","OPTION"] as const                   // 纯合约
export const INST_TYPE_SWAP_FUT   = ["SWAP","FUTURES"] as const                            // 永续+交割
export const INST_TYPE_MARGIN_PUB = ["MARGIN","SWAP","FUTURES","OPTION"] as const          // 含杠杆的公开数据
export const INST_TYPE_RUBIK      = ["SPOT","CONTRACTS"] as const                          // 交易大数据专用（OKX 原生 CONTRACTS）

export function toResult(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
}

// ── 错误分类（修复3：统一错误格式） ──────────────────────────────────────────

type ErrorCategory = "BUSINESS" | "AUTH" | "VALIDATION" | "NETWORK" | "RATE_LIMIT"

function classifyError(msg: string): { errorCode: string; errorCategory: ErrorCategory } {
  // OKX API 错误码映射
  const okxMatch = msg.match(/OKX (\d+):/)
  if (okxMatch && okxMatch[1]) {
    const code = parseInt(okxMatch[1])
    if (code >= 50000 && code < 50100) return { errorCode: `OKX_${code}`, errorCategory: "AUTH" }
    if (code >= 51000) return { errorCode: `OKX_${code}`, errorCategory: "BUSINESS" }
    if (code >= 50004 && code <= 50014) return { errorCode: `OKX_${code}`, errorCategory: "VALIDATION" }
    return { errorCode: `OKX_${code}`, errorCategory: "BUSINESS" }
  }
  // HTTP 错误
  if (msg.startsWith("HTTP ")) {
    const httpMatch = msg.match(/HTTP (\d+)/)
    const status = httpMatch && httpMatch[1] ? parseInt(httpMatch[1]) : 0
    if (status === 401 || status === 403) return { errorCode: "HTTP_401", errorCategory: "AUTH" }
    if (status === 429) return { errorCode: "HTTP_429", errorCategory: "RATE_LIMIT" }
    return { errorCode: "NETWORK_ERROR", errorCategory: "NETWORK" }
  }
  // AUTH_REQUIRED 消息
  if (msg.includes("API Key")) return { errorCode: "AUTH_REQUIRED", errorCategory: "AUTH" }
  // 默认
  return { errorCode: "UNKNOWN_ERROR", errorCategory: "BUSINESS" }
}

// ── 工具风险分级（只读模式 + 权限感知注册用） ────────────────────────────

export type RiskLevel = "READ" | "WRITE" | "FUND_TRANSFER" | "ADMIN"

/** 根据工具名自动推断风险级别 */
export function classifyRisk(toolName: string): RiskLevel {
  // ── ADMIN：修改账户全局配置 ──
  const admin = ["okx_set_account_mode", "okx_set_position_mode", "okx_set_settle_currency"]
  if (admin.includes(toolName)) return "ADMIN"

  // ── FUND_TRANSFER：真实资金移动 ──
  const fund = ["okx_withdrawal"]
  if (fund.some(p => toolName.startsWith(p))) return "FUND_TRANSFER"

  // ── WRITE：产生交易/修改状态 ──
  const writePrefixes = [
    "okx_place_", "okx_cancel_", "okx_amend_", "okx_create_",
    "okx_stop_", "okx_close_", "okx_batch_", "okx_set_",
    "okx_transfer", "okx_borrow", "okx_repay",
    "okx_convert_trade", "okx_preset_", "okx_activate_",
    "okx_move_", "okx_copy_", "okx_first_",
    "okx_one_click_", "okx_easy_convert",
    "agent_quick_trade",
  ]
  if (writePrefixes.some(p => toolName.startsWith(p))) return "WRITE"

  // ── 特殊：模拟/预检/反馈 虽是 agent 工具但只读 ──
  const readSpecials = [
    "agent_simulate_order", "okx_preflight_check", "okx_agent_feedback",
    "agent_catalog", "agent_catalog_detail", "agent_hub_status",
    "agent_hub_dispatch", "agent_hub_review", "agent_room_send", "agent_room_view",
    "okx_ws_subscribe", "okx_ws_events", "okx_ws_status", "okx_ws_close",
    "xlayer_subscribe", "xlayer_get_events", "xlayer_unsubscribe",
  ]
  if (readSpecials.includes(toolName)) return "READ"

  // ── X Layer 写操作 ──
  if (toolName.startsWith("xlayer_call")) return "WRITE"

  return "READ"
}

export function toError(e: unknown): {
  content: [{ type: "text"; text: string }]
  isError: true
  errorCode: string
  errorCategory: ErrorCategory
} {
  const msg = e instanceof Error ? e.message : String(e)
  const { errorCode, errorCategory } = classifyError(msg)
  return {
    content: [{ type: "text", text: msg }],
    isError: true,
    errorCode,
    errorCategory,
  }
}
