/**
 * SQLite 共享工具 — 统一切换检测，避免 3 文件各自重复 wasAlive/safeRun。
 */
let DatabaseSync: any = null
let _sqliteAvailable: boolean | null = null

export function isSqliteAvailable(): boolean {
  if (_sqliteAvailable !== null) return _sqliteAvailable
  try {
    DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (p: string, o?: any) => any }).DatabaseSync
    _sqliteAvailable = true
    return true
  } catch {
    _sqliteAvailable = false
    return false
  }
}

export function openDB(path: string, opts?: any): any | null {
  if (!isSqliteAvailable()) return null
  try { return new DatabaseSync(path, opts) } catch { return null }
}

export function ensureDir(dbPath: string): void {
  const fs = require("node:fs")
  const path = require("node:path")
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}
