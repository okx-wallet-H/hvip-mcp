/**
 * 聊天助手 SQLite 持久化层
 *
 * 管理 5 张表：users / api_keys / sessions / conversations / messages
 * 遵循 HubDB 模式：open() / close() / migrate() / stats()
 *
 * Usage:
 *   const db = new ChatDB(".hub/chat.db")
 *   db.open()
 *   db.registerUser("alice", pin) => { ok, userId }
 */

import { isSqliteAvailable, openDB, ensureDir } from "./shared-sqlite.js"
import { hashPin, verifyPin, encryptCredentials, decryptCredentials } from "./chat-encryption.js"
import { logger } from "../utils/logger.js"
import type { OkxCredentials } from "./chat-encryption.js"
import crypto from "node:crypto"

const log = logger("ChatDB")

// ── Row Types ─────────────────────────────────────────────────

interface UserRow {
  id: number
  username: string
  pin_hash: string
  pin_salt: string
  created_at: string
}

interface ApiKeyRow {
  id: number
  user_id: number
  encrypted_data: string
  iv: string
  auth_tag: string
  key_salt: string
  is_demo: number
  key_hint: string
  created_at: string
}

interface SessionRow {
  id: string
  user_id: number
  created_at: string
  expires_at: string
}

interface ConversationRow {
  id: string
  user_id: number
  title: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: number
  conversation_id: string
  role: string
  content: string | null
  tool_calls: string | null
  token_in: number
  token_out: number
  model: string | null
  created_at: string
}

// ═══════════════════════════════════════════════════════════════
// ChatDB
// ═══════════════════════════════════════════════════════════════

export class ChatDB {
  private db: any = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  open(): boolean {
    if (!isSqliteAvailable()) {
      log.info("node:sqlite 不可用，跳过聊天持久化")
      return false
    }
    try {
      ensureDir(this.dbPath)
      this.db = openDB(this.dbPath, { create: true })
      this.migrate()
      log.info(`ChatDB 已打开 ${this.dbPath}`)
      return true
    } catch (e: unknown) {
      log.error(`ChatDB 打开失败: ${String(e)}`)
      return false
    }
  }

  close(): void {
    if (this.db) {
      try { this.db.close() } catch {}
      this.db = null
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT NOT NULL UNIQUE,
        pin_hash   TEXT NOT NULL,
        pin_salt   TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chat_api_keys (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL UNIQUE,
        encrypted_data TEXT NOT NULL,
        iv             TEXT NOT NULL,
        auth_tag       TEXT NOT NULL,
        key_salt       TEXT NOT NULL,
        is_demo        INTEGER DEFAULT 0,
        key_hint       TEXT NOT NULL,
        created_at     TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES chat_users(id)
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES chat_users(id)
      );

      CREATE TABLE IF NOT EXISTS chat_conversations (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        title      TEXT DEFAULT 'New Chat',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES chat_users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_conv_user ON chat_conversations(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT,
        tool_calls      TEXT,
        token_in        INTEGER DEFAULT 0,
        token_out       INTEGER DEFAULT 0,
        model           TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_msg_conv ON chat_messages(conversation_id, id);
    `)
  }

  // ── User Management ──

  /**
   * 注册新用户。username 必须唯一（3-20 字符，字母数字下划线中文）
   */
  registerUser(username: string, pin: string): { ok: boolean; userId?: number; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }
    if (!/^[\w一-鿿]{3,20}$/.test(username)) {
      return { ok: false, error: "用户名 3-20 字符，仅字母数字下划线中文" }
    }
    if (pin.length < 4) return { ok: false, error: "PIN 至少 4 位" }

    try {
      const { hash, salt } = hashPin(pin)
      this.db.prepare(
        "INSERT INTO chat_users (username, pin_hash, pin_salt) VALUES (?, ?, ?)"
      ).run(username, hash, salt)

      const user = this.db.prepare(
        "SELECT id FROM chat_users WHERE username = ?"
      ).get(username) as UserRow | undefined

      if (!user) return { ok: false, error: "注册失败" }
      return { ok: true, userId: user.id }
    } catch (e: unknown) {
      const msg = String(e)
      if (msg.includes("UNIQUE")) return { ok: false, error: "用户名已存在" }
      log.error(`registerUser 失败: ${msg}`)
      return { ok: false, error: msg }
    }
  }

  /**
   * 验证 PIN
   */
  authenticateUser(username: string, pin: string): { ok: boolean; userId?: number; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }

    try {
      const user = this.db.prepare(
        "SELECT id, pin_hash, pin_salt FROM chat_users WHERE username = ?"
      ).get(username) as UserRow | undefined

      if (!user) return { ok: false, error: "用户不存在" }

      if (!verifyPin(pin, user.pin_hash, user.pin_salt)) {
        return { ok: false, error: "PIN 错误" }
      }

      return { ok: true, userId: user.id }
    } catch (e: unknown) {
      log.error(`authenticateUser 失败: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
  }

  /**
   * 列出所有用户（用于注册界面下拉提示）
   */
  listUsers(): { id: number; username: string }[] {
    if (!this.db) return []
    try {
      return (this.db.prepare(
        "SELECT id, username FROM chat_users ORDER BY username"
      ).all() as UserRow[]).map(u => ({ id: u.id, username: u.username }))
    } catch { return [] }
  }

  // ── API Key Management ──

  /**
   * 保存/更新加密的 OKX API Key
   */
  saveApiKey(userId: number, cred: OkxCredentials, pin: string): { ok: boolean; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }

    // 验证 PIN
    const user = this.db.prepare(
      "SELECT pin_hash, pin_salt FROM chat_users WHERE id = ?"
    ).get(userId) as UserRow | undefined

    if (!user) return { ok: false, error: "用户不存在" }
    if (!verifyPin(pin, user.pin_hash, user.pin_salt)) {
      return { ok: false, error: "PIN 错误" }
    }

    try {
      const keySalt = crypto.randomBytes(32)
      const { encryptedData, iv, authTag, keySalt: ks, keyHint } = encryptCredentials(cred, pin, keySalt)

      this.db.prepare(`
        INSERT INTO chat_api_keys (user_id, encrypted_data, iv, auth_tag, key_salt, is_demo, key_hint)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          encrypted_data=excluded.encrypted_data,
          iv=excluded.iv,
          auth_tag=excluded.auth_tag,
          key_salt=excluded.key_salt,
          is_demo=excluded.is_demo,
          key_hint=excluded.key_hint
      `).run(userId, encryptedData, iv, authTag, ks, cred.isDemo ? 1 : 0, keyHint)

      return { ok: true }
    } catch (e: unknown) {
      log.error(`saveApiKey 失败: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
  }

  /**
   * 解密并返回 OKX 凭证
   */
  getDecryptedKeys(userId: number, pin: string): { ok: boolean; cred?: OkxCredentials; keyHint?: string; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }

    try {
      const row = this.db.prepare(
        "SELECT encrypted_data, iv, auth_tag, key_salt, key_hint FROM chat_api_keys WHERE user_id = ?"
      ).get(userId) as ApiKeyRow | undefined

      if (!row) return { ok: false, error: "未绑定 OKX API Key" }

      const cred = decryptCredentials(
        row.encrypted_data, row.iv, row.auth_tag, row.key_salt, pin,
      )

      if (!cred) return { ok: false, error: "解密失败，PIN 错误或数据损坏" }

      return { ok: true, cred, keyHint: row.key_hint }
    } catch (e: unknown) {
      log.error(`getDecryptedKeys 失败: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
  }

  /**
   * 检查用户是否已绑定 Key（不解密）
   */
  hasApiKey(userId: number): { hasKeys: boolean; keyHint?: string } {
    if (!this.db) return { hasKeys: false }
    try {
      const row = this.db.prepare(
        "SELECT key_hint FROM chat_api_keys WHERE user_id = ?"
      ).get(userId) as ApiKeyRow | undefined
      return row ? { hasKeys: true, keyHint: row.key_hint } : { hasKeys: false }
    } catch { return { hasKeys: false } }
  }

  // ── Session Management ──

  /**
   * 创建会话 token（30 分钟有效）
   */
  createSession(userId: number): { ok: boolean; sessionToken?: string; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }

    try {
      const sessionToken = crypto.randomBytes(32).toString("hex")
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString() // 30 min

      this.db.prepare(
        "INSERT INTO chat_sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
      ).run(sessionToken, userId, expiresAt)

      return { ok: true, sessionToken }
    } catch (e: unknown) {
      log.error(`createSession 失败: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
  }

  /**
   * 验证会话 token，返回用户信息
   */
  validateSession(sessionToken: string): { ok: boolean; userId?: number; username?: string; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }

    try {
      const row = this.db.prepare(`
        SELECT s.user_id, u.username, s.expires_at
        FROM chat_sessions s
        JOIN chat_users u ON u.id = s.user_id
        WHERE s.id = ?
      `).get(sessionToken) as (SessionRow & { username: string; expires_at: string }) | undefined

      if (!row) return { ok: false, error: "会话无效" }

      if (new Date(row.expires_at) < new Date()) {
        // Expired — clean up
        this.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionToken)
        return { ok: false, error: "会话已过期，请重新解锁" }
      }

      return { ok: true, userId: row.user_id, username: row.username }
    } catch (e: unknown) {
      log.error(`validateSession 失败: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
  }

  /**
   * 删除会话（锁定）
   */
  deleteSession(sessionToken: string): void {
    if (!this.db) return
    try {
      this.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionToken)
    } catch {}
  }

  /**
   * 清理过期会话
   */
  cleanExpiredSessions(): number {
    if (!this.db) return 0
    try {
      const result = this.db.prepare(
        "DELETE FROM chat_sessions WHERE expires_at < datetime('now')"
      ).run()
      return result.changes || 0
    } catch { return 0 }
  }

  // ── Conversation Management ──

  createConversation(userId: number, title?: string): { ok: boolean; id?: string; error?: string } {
    if (!this.db) return { ok: false, error: "数据库不可用" }
    try {
      const id = crypto.randomUUID()
      this.db.prepare(
        "INSERT INTO chat_conversations (id, user_id, title) VALUES (?, ?, ?)"
      ).run(id, userId, title || "新对话")
      return { ok: true, id }
    } catch (e: unknown) {
      log.error(`createConversation 失败: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
  }

  listConversations(userId: number): ConversationRow[] {
    if (!this.db) return []
    try {
      return this.db.prepare(
        "SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
      ).all(userId) as ConversationRow[]
    } catch { return [] }
  }

  // ── Message Management ──

  saveMessage(msg: {
    conversationId: string
    role: string
    content?: string | null
    toolCalls?: string | null
    tokenIn?: number
    tokenOut?: number
    model?: string | null
  }): void {
    if (!this.db) return
    try {
      this.db.prepare(
        "INSERT INTO chat_messages (conversation_id, role, content, tool_calls, token_in, token_out, model) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(msg.conversationId, msg.role, msg.content || null, msg.toolCalls || null, msg.tokenIn || 0, msg.tokenOut || 0, msg.model || null)

      // Update conversation timestamp
      this.db.prepare(
        "UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?"
      ).run(msg.conversationId)
    } catch (e: unknown) {
      log.error(`saveMessage 失败: ${String(e)}`)
    }
  }

  loadMessages(conversationId: string, limit = 100): MessageRow[] {
    if (!this.db) return []
    try {
      return this.db.prepare(
        "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?"
      ).all(conversationId, limit) as MessageRow[]
    } catch { return [] }
  }

  deleteConversation(conversationId: string): void {
    if (!this.db) return
    try {
      this.db.prepare("DELETE FROM chat_messages WHERE conversation_id = ?").run(conversationId)
      this.db.prepare("DELETE FROM chat_conversations WHERE id = ?").run(conversationId)
    } catch {}
  }

  // ── Stats ──

  stats(): { userCount: number; sessionCount: number; conversationCount: number; messageCount: number } {
    if (!this.db) return { userCount: 0, sessionCount: 0, conversationCount: 0, messageCount: 0 }
    try {
      const uc = (this.db.prepare("SELECT COUNT(*) as n FROM chat_users").get() as any)?.n || 0
      const sc = (this.db.prepare("SELECT COUNT(*) as n FROM chat_sessions").get() as any)?.n || 0
      const cc = (this.db.prepare("SELECT COUNT(*) as n FROM chat_conversations").get() as any)?.n || 0
      const mc = (this.db.prepare("SELECT COUNT(*) as n FROM chat_messages").get() as any)?.n || 0
      return { userCount: uc, sessionCount: sc, conversationCount: cc, messageCount: mc }
    } catch {
      return { userCount: 0, sessionCount: 0, conversationCount: 0, messageCount: 0 }
    }
  }
}
