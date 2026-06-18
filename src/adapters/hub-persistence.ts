/**
 * Agent Hub SQLite 持久化层
 *
 * 独立于 agent-hub.ts，可选启用。
 * 持久化：tasks 状态、room messages（agents/connections 属会话级，不持久化）
 *
 * Usage:
 *   const db = new HubDB(".hub/hub.db")
 *   db.loadTasks(hub)   // 启动时恢复
 *   db.saveTask(...)    // 状态变化时保存
 */

import { isSqliteAvailable, openDB, ensureDir } from "./shared-sqlite.js"
import { logger } from "../utils/logger.js"

// ── DB 类型 ─────────────────────────────────────────────────────────────────

interface TaskRow {
  taskId: string
  status: string
  title: string
  assignedTo: string | null
  claimedAt: number | null
  result: string | null
  branch: string | null
  reviewedAt: string | null
}

interface MessageRow {
  id: number
  roomId: string
  from: string
  text: string
  ts: string
}

// ═══════════════════════════════════════════════════════════════════════════
// HubDB
// ═══════════════════════════════════════════════════════════════════════════

const log = logger("HubDB")

export class HubDB {
  private db: any = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  // ── 初始化 ──

  open(): boolean {
    if (!isSqliteAvailable()) {
      log.info("node:sqlite 不可用，跳过持久化")
      return false
    }
    try {
      // 确保目录存在
      ensureDir(this.dbPath)
      this.db = openDB(this.dbPath, { create: true })
      this.migrate()
      log.info(`已打开 ${this.dbPath}`)
      return true
    } catch (e: unknown) {
      log.error(`打开失败: ${String(e)}`)
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
      CREATE TABLE IF NOT EXISTS hub_tasks (
        taskId     TEXT PRIMARY KEY,
        status     TEXT NOT NULL DEFAULT 'unassigned',
        title      TEXT NOT NULL DEFAULT '',
        assignedTo TEXT,
        claimedAt  INTEGER,
        result     TEXT,
        branch     TEXT,
        reviewedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS hub_messages (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        roomId TEXT NOT NULL,
        "from" TEXT NOT NULL,
        text   TEXT NOT NULL,
        ts     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON hub_messages(roomId, id);
    `)
  }

  // ── Task CRUD ──

  saveTask(task: {
    taskId: string
    status: string
    title?: string
    assignedTo?: string | null
    claimedAt?: number | null
    result?: string | null
    branch?: string | null
    reviewedAt?: string | null
  }): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO hub_tasks (taskId, status, title, assignedTo, claimedAt, result, branch, reviewedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(taskId) DO UPDATE SET
          status=excluded.status, assignedTo=excluded.assignedTo, claimedAt=excluded.claimedAt,
          result=excluded.result, branch=excluded.branch, reviewedAt=excluded.reviewedAt
      `).run(
        task.taskId, task.status, task.title || task.taskId,
        task.assignedTo || null, task.claimedAt || null,
        task.result || null, task.branch || null, task.reviewedAt || null,
      )
    } catch (e: unknown) { log.error(`saveTask(${task.taskId}) 失败: ${String(e)}`) }
  }

  loadTasks(): TaskRow[] {
    if (!this.db) return []
    try {
      return this.db.prepare("SELECT * FROM hub_tasks ORDER BY taskId").all() as TaskRow[]
    } catch (e: unknown) {
      log.error(`loadTasks 失败: ${String(e)}`)
      return []
    }
  }

  // ── Message CRUD ──

  saveMessage(roomId: string, from: string, text: string, ts: string): void {
    if (!this.db) return
    try {
      this.db.prepare(`INSERT INTO hub_messages (roomId, "from", text, ts) VALUES (?, ?, ?, ?)`).run(roomId, from, text, ts)
      // 房间消息上限 500 条
      this.db.prepare(`
        DELETE FROM hub_messages WHERE roomId = ? AND id NOT IN (
          SELECT id FROM hub_messages WHERE roomId = ? ORDER BY id DESC LIMIT 500
        )
      `).run(roomId, roomId)
    } catch (e: unknown) { log.error(`saveMessage(${roomId}) 失败: ${String(e)}`) }
  }

  loadMessages(roomId: string, limit = 50): MessageRow[] {
    if (!this.db) return []
    try {
      return this.db.prepare(
        `SELECT * FROM hub_messages WHERE roomId = ? ORDER BY id DESC LIMIT ?`
      ).all(roomId, limit).reverse() as MessageRow[]
    } catch (e: unknown) {
      log.error(`loadMessages(${roomId}) 失败: ${String(e)}`)
      return []
    }
  }

  // ── 统计 ──

  stats(): { taskCount: number; messageCount: number; dbPath: string } {
    if (!this.db) return { taskCount: 0, messageCount: 0, dbPath: this.dbPath }
    try {
      const tc = (this.db.prepare("SELECT COUNT(*) as n FROM hub_tasks").get() as any)?.n || 0
      const mc = (this.db.prepare("SELECT COUNT(*) as n FROM hub_messages").get() as any)?.n || 0
      return { taskCount: tc, messageCount: mc, dbPath: this.dbPath }
    } catch {
      return { taskCount: 0, messageCount: 0, dbPath: this.dbPath }
    }
  }
}
