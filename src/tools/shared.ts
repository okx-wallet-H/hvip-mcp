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
