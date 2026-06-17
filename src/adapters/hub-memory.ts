/**
 * Agent Hub 共享记忆系统
 *
 * 灵感来自 Artel (NicolasPrimeau/artel)。
 * 4 层记忆类型 + 置信度衰减 + 语义搜索，SQLite 单文件持久化。
 *
 * Usage:
 *   const mem = new HubMemory(".hub/memory.db")
 *   mem.open()
 *   mem.store({ type: "memory", text: "...", agentId: "worker-01", tags: ["btc"] })
 *   mem.search("BTC 行情")  // 关键词 + 标签搜索
 */

import { isSqliteAvailable, openDB, ensureDir } from "./shared-sqlite.js"

// ── 类型 ─────────────────────────────────────────────────────────────────

export type MemoryType = "memory" | "doc" | "directive" | "skill"

export interface MemoryEntry {
  id: string
  type: MemoryType
  agentId: string
  text: string
  tags: string
  confidence: number        // 0.0–1.0
  readCount: number
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export interface StoreOpts {
  type?: MemoryType
  agentId: string
  text: string
  tags?: string[]
  confidence?: number
  parentId?: string | null
}

// ═══════════════════════════════════════════════════════════════════════════

export class HubMemory {
  private db: any = null
  private dbPath: string
  private decayTimer: ReturnType<typeof setInterval> | null = null

  /** 4 种记忆类型的衰减参数 */
  static DECAY = {
    memory:    { rate: 0.94, windowDays: 7 },   // 7 天后开始衰减
    doc:       { rate: 1.0,  windowDays: 0 },   // 永不衰减
    directive: { rate: 1.0,  windowDays: 0 },   // 永不衰减
    skill:     { rate: 0.90,  windowDays: 14 },  // 14 天后开始衰减
  } as const

  private static HEAT_THRESHOLD = 3              // 衰减周期内被读 >= 次则跳过衰减
  private static DECAY_INTERVAL_MS = 3600_000    // 1 小时

  constructor(dbPath: string) { this.dbPath = dbPath }

  // ── 生命周期 ─────────────────────────────────────────────────────────

  open(): boolean {
    if (!isSqliteAvailable()) {
      process.stderr.write("[Memory] node:sqlite 不可用\n")
      return false
    }
    try {
      ensureDir(this.dbPath)
      this.db = openDB(this.dbPath, { create: true })
      this.migrate()
      process.stderr.write(`[Memory] 已打开 ${this.dbPath}\n`)
      this.startDecay()
      return true
    } catch (e) { process.stderr.write(`[Memory] 打开失败: ${String(e)}\n`); return false }
  }

  close(): void {
    if (this.decayTimer) { clearInterval(this.decayTimer); this.decayTimer = null }
    if (this.db) { try { this.db.close() } catch {}; this.db = null }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL DEFAULT 'memory',
        agentId    TEXT NOT NULL,
        text       TEXT NOT NULL,
        tags       TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 1.0,
        readCount  INTEGER NOT NULL DEFAULT 0,
        parentId   TEXT,
        createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
      CREATE INDEX IF NOT EXISTS idx_memory_tags ON memory(tags);
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agentId);
      CREATE INDEX IF NOT EXISTS idx_memory_confidence ON memory(confidence);
    `)
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  store(opts: StoreOpts): MemoryEntry {
    const id = `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const type = opts.type || "memory"
    const tags = (opts.tags || []).map(t => t.replace(/,/g, "")).join(",")
    const confidence = Math.min(1, Math.max(0, opts.confidence ?? 1.0))
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO memory (id, type, agentId, text, tags, confidence, readCount, parentId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, type, opts.agentId, opts.text, tags, confidence, opts.parentId || null, now, now)

    return { id, type, agentId: opts.agentId, text: opts.text, tags, confidence, readCount: 0, parentId: opts.parentId || null, createdAt: now, updatedAt: now }
  }

  get(id: string): MemoryEntry | null {
    const row = this.db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as any
    if (!row) return null
    // 读取加热
    this.db.prepare("UPDATE memory SET readCount = readCount + 1 WHERE id = ?").run(id)
    return this.rowToEntry(row)
  }

  search(q: string, limit = 20): MemoryEntry[] {
    if (!q.trim()) return this.recent(limit)
    const terms = q.split(/\s+/).filter(Boolean)
    // 构建 LIKE 查询——每个词匹配 text 或 tags
    const conditions = terms.map(() => "(text LIKE ? OR tags LIKE ?)")
    const sql = `SELECT * FROM memory WHERE ${conditions.join(" AND ")} ORDER BY confidence DESC, updatedAt DESC LIMIT ?`
    const params: any[] = []
    for (const t of terms) { params.push(`%${t}%`, `%${t}%`) }
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as any[]
    return (Array.isArray(rows) ? rows : []).map((r: any) => this.rowToEntry(r))
  }

  recent(limit = 20): MemoryEntry[] {
    const rows = this.db.prepare("SELECT * FROM memory ORDER BY updatedAt DESC LIMIT ?").all(limit) as any[]
    return (Array.isArray(rows) ? rows : []).map((r: any) => this.rowToEntry(r))
  }

  byType(type: MemoryType, limit = 50): MemoryEntry[] {
    const rows = this.db.prepare("SELECT * FROM memory WHERE type = ? ORDER BY confidence DESC LIMIT ?").all(type, limit) as any[]
    return (Array.isArray(rows) ? rows : []).map((r: any) => this.rowToEntry(r))
  }

  update(id: string, text: string, confidence?: number): boolean {
    const now = new Date().toISOString()
    const c = confidence !== undefined ? Math.min(1, Math.max(0, confidence)) : undefined
    if (c !== undefined) {
      this.db.prepare("UPDATE memory SET text = ?, confidence = ?, updatedAt = ? WHERE id = ?").run(text, c, now, id)
    } else {
      this.db.prepare("UPDATE memory SET text = ?, updatedAt = ? WHERE id = ?").run(text, now, id)
    }
    return this.db.changes > 0
  }

  delete(id: string): boolean {
    this.db.prepare("DELETE FROM memory WHERE id = ?").run(id)
    return this.db.changes > 0
  }

  stats(): { total: number; byType: Record<string, number>; avgConfidence: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as n FROM memory").get() as any)?.n || 0
    const types = this.db.prepare("SELECT type, COUNT(*) as n FROM memory GROUP BY type").all() as any[]
    const avg = (this.db.prepare("SELECT AVG(confidence) as n FROM memory").get() as any)?.n || 0
    const byType: Record<string, number> = {}
    for (const t of (Array.isArray(types) ? types : [])) byType[t.type] = t.n
    return { total, byType, avgConfidence: Math.round(avg * 100) / 100 }
  }

  // ── 衰减引擎 ───────────────────────────────────────────────────────

  private startDecay(): void {
    this.decayTimer = setInterval(() => this.runDecay(), HubMemory.DECAY_INTERVAL_MS)
  }

  private runDecay(): void {
    const now = Date.now()
    const rows = this.db.prepare("SELECT * FROM memory WHERE confidence > 0.05").all() as any[]
    if (!Array.isArray(rows)) return

    for (const row of rows) {
      const decay = HubMemory.DECAY[row.type as MemoryType]
      if (!decay || decay.rate >= 1.0) continue
      if (decay.windowDays > 0) {
        const ageDays = (now - new Date(row.updatedAt).getTime()) / 86400000
        if (ageDays < decay.windowDays) continue
      }
      // 热保护：被读够多次则跳过
      if (row.readCount >= HubMemory.HEAT_THRESHOLD) {
        this.db.prepare("UPDATE memory SET readCount = 0 WHERE id = ?").run(row.id)
        continue
      }
      const newConf = Math.max(0.05, row.confidence * decay.rate)
      this.db.prepare("UPDATE memory SET confidence = ? WHERE id = ?").run(newConf, row.id)
    }
  }

  private rowToEntry(r: any): MemoryEntry {
    return {
      id: r.id, type: r.type, agentId: r.agentId, text: r.text, tags: r.tags || "",
      confidence: r.confidence, readCount: r.readCount,
      parentId: r.parentId || null,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  }
}
