/**
 * 聊天助手会话级 Auth 存储（仅内存，不落盘）
 *
 * 解锁时存入明文 OKX 凭证，锁定/过期时清除。
 * 安全约束：PIN 不在浏览器存储，sessionToken 仅存 React state。
 */

import type { OkxCredentials } from "./chat-encryption.js"
import { logger } from "../utils/logger.js"

const log = logger("AuthStore")

export interface SessionData {
  userId: number
  username: string
  cred: OkxCredentials
  sessionToken: string
  createdAt: number
  lastActivity: number
}

// Session expires after 15 min of inactivity (P1-4: reduced from 30min)
const SESSION_TTL_MS = 15 * 60_000

function scrubCred(cred: OkxCredentials): void {
  // Overwrite sensitive fields to prevent memory-dump leaks
  (cred as any).apiKey = "[REDACTED]"
  ;(cred as any).secret = "[REDACTED]"
  ;(cred as any).passphrase = "[REDACTED]"
}

export class AuthStore {
  private store = new Map<string, SessionData>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  set(
    sessionToken: string,
    data: { userId: number; username: string; cred: OkxCredentials },
  ): void {
    this.store.set(sessionToken, {
      ...data,
      sessionToken,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    })
    log.info(`AuthStore: ${data.username} 已解锁 (${this.store.size} 活跃)`)
  }

  get(sessionToken: string): SessionData | undefined {
    const data = this.store.get(sessionToken)
    if (!data) return undefined

    // Check expiry
    if (Date.now() - data.lastActivity > SESSION_TTL_MS) {
      this.delete(sessionToken)
      return undefined
    }

    // Touch lastActivity
    data.lastActivity = Date.now()
    return data
  }

  delete(sessionToken: string): void {
    const data = this.store.get(sessionToken)
    // Scrub credentials from memory before deleting
    if (data?.cred) scrubCred(data.cred)
    this.store.delete(sessionToken)
    if (data) log.info(`AuthStore: ${data.username} 已锁定（凭据已清除）`)
  }

  /**
   * Lock all sessions for a user (e.g., API key changed)
   */
  deleteByUserId(userId: number): void {
    for (const [token, data] of this.store.entries()) {
      if (data.userId === userId) {
        if (data.cred) scrubCred(data.cred)
        this.store.delete(token)
      }
    }
  }

  size(): number {
    return this.store.size
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  startCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      let cleaned = 0
      for (const [token, data] of this.store.entries()) {
        if (now - data.lastActivity > SESSION_TTL_MS) {
          if (data.cred) scrubCred(data.cred)
          this.store.delete(token)
          cleaned++
        }
      }
      if (cleaned > 0) log.info(`AuthStore: 自动清理 ${cleaned} 个过期会话`)
    }, intervalMs)
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

/** Singleton */
export const authStore = new AuthStore()
