/**
 * API 积分管理 — 多租户 Key + 余额 + 扣费 + 充值
 * =====================================================
 *
 * 每个商户独立 API Key，绑定积分余额。
 * 每次工具调用按风险等级扣费:
 *   READ:          1 积分
 *   WRITE:         5 积分
 *   FUND_TRANSFER: 10 积分
 *   ADMIN:         20 积分
 *
 * 数据存储在 SQLite (.hub/api-credits.db)
 */

import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { logger } from "../utils/logger.js"
import type { RiskLevel } from "../tools/shared.js"

const log = logger("Credits")

// ═══════════════════════════════════════════════════════════════
// Cost table
// ═══════════════════════════════════════════════════════════════

export const CREDIT_COST: Record<RiskLevel, number> = {
  READ: 1,
  WRITE: 5,
  FUND_TRANSFER: 10,
  ADMIN: 20,
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ApiKeyRecord {
  id: number
  key: string
  clientName: string
  credits: number
  totalUsed: number
  enabled: boolean
  createdAt: string
  lastUsedAt: string | null
}

// ═══════════════════════════════════════════════════════════════
// Credit Manager
// ═══════════════════════════════════════════════════════════════

export class ApiCredits {
  private db: DatabaseSync
  private cache = new Map<string, ApiKeyRecord>()
  private cacheLoaded = false

  constructor(dbPath = ".hub/api-credits.db") {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec("PRAGMA journal_mode=WAL")
    this.init()
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        client_name TEXT NOT NULL,
        credits REAL NOT NULL DEFAULT 0,
        total_used INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
    `)
    this.loadCache()
  }

  private loadCache() {
    const rows = this.db.prepare("SELECT * FROM api_keys").all() as ApiKeyRecord[]
    for (const r of rows) this.cache.set(r.key, r)
    this.cacheLoaded = true
    log.info(`已加载 ${rows.length} 个 API Key`)
  }

  /** 查找 Key — 缓存命中或直接查 DB */
  lookup(key: string): ApiKeyRecord | null {
    if (!this.cacheLoaded) this.loadCache()
    const cached = this.cache.get(key)
    if (cached) return cached

    // 缓存未命中 → 查 DB（支持跨进程创建的 Key）
    const row = this.db.prepare("SELECT * FROM api_keys WHERE key = ?").get(key) as ApiKeyRecord | undefined
    if (row) {
      this.cache.set(key, row)
      return row
    }
    return null
  }

  /** 校验并扣费 */
  deduct(key: string, riskLevel: RiskLevel): { ok: true; remaining: number } | { ok: false; error: string } {
    const record = this.lookup(key)
    if (!record) return { ok: false, error: "无效的 API Key" }
    if (!record.enabled) return { ok: false, error: "API Key 已禁用" }

    const cost = CREDIT_COST[riskLevel] || 1
    if (record.credits < cost) return { ok: false, error: `积分不足 (需要 ${cost}，剩余 ${record.credits})` }

    record.credits -= cost
    record.totalUsed++
    record.lastUsedAt = new Date().toISOString()

    // Update DB
    this.db.prepare("UPDATE api_keys SET credits = ?, total_used = ?, last_used_at = ? WHERE id = ?")
      .run(record.credits, record.totalUsed, record.lastUsedAt, record.id)

    return { ok: true, remaining: record.credits }
  }

  /** 管理：创建 Key */
  createKey(clientName: string, initialCredits = 1000): ApiKeyRecord {
    const key = "hvip-" + Array.from({ length: 32 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("")

    const result = this.db.prepare(
      "INSERT INTO api_keys (key, client_name, credits) VALUES (?, ?, ?)"
    ).run(key, clientName, initialCredits)

    const record: ApiKeyRecord = {
      id: result.lastInsertRowid as number,
      key,
      clientName,
      credits: initialCredits,
      totalUsed: 0,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    }
    this.cache.set(key, record)
    return record
  }

  /** 管理：充值 */
  topUp(key: string, amount: number): { ok: boolean; newBalance?: number; error?: string } {
    const record = this.lookup(key)
    if (!record) return { ok: false, error: "Key 不存在" }
    if (amount <= 0) return { ok: false, error: "充值金额必须 > 0" }

    record.credits += amount
    this.db.prepare("UPDATE api_keys SET credits = ? WHERE id = ?").run(record.credits, record.id)
    return { ok: true, newBalance: record.credits }
  }

  /** 管理：启用/禁用 Key */
  setEnabled(key: string, enabled: boolean): boolean {
    const record = this.lookup(key)
    if (!record) return false
    record.enabled = enabled
    this.db.prepare("UPDATE api_keys SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, record.id)
    return true
  }

  /** 管理：列出所有 Key (含 Key 前缀，完整 Key 仅创建时返回) */
  listAll(): Array<Omit<ApiKeyRecord, "key"> & { keyPrefix: string }> {
    return [...this.cache.values()].map(r => ({
      id: r.id, clientName: r.clientName, credits: r.credits,
      totalUsed: r.totalUsed, enabled: r.enabled,
      createdAt: r.createdAt, lastUsedAt: r.lastUsedAt,
      keyPrefix: r.key.slice(0, 12) + "..." + r.key.slice(-8),
    }))
  }

  /** 客户端：查询余额 */
  getBalance(key: string): { clientName: string; credits: number; totalUsed: number } | null {
    const record = this.lookup(key)
    if (!record) return null
    return { clientName: record.clientName, credits: record.credits, totalUsed: record.totalUsed }
  }

  close() { try { this.db.close() } catch {} }
}

// 全局单例
let instance: ApiCredits | null = null

export function getApiCredits(dbPath?: string): ApiCredits {
  if (!instance) instance = new ApiCredits(dbPath)
  return instance
}
