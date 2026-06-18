/**
 * 统一 Logger — 分级日志，替代裸 console.log / process.stderr.write
 *
 * 用法:
 *   import { logger } from "./utils/logger.js"
 *   const log = logger("Hub")
 *   log.info("MCP Server 启动")
 *   log.warn("端口冲突")
 *   log.error("Worker 启动失败: " + e.message)
 *
 * 级别 (LOG_LEVEL 环境变量控制):
 *   DEBUG < INFO < WARN < ERROR < SILENT
 *   默认: INFO（生产环境建议 WARN）
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.SILENT]: "SILENT",
}

const LEVEL_EMOJI: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "🔍",
  [LogLevel.INFO]: "",
  [LogLevel.WARN]: "⚠️",
  [LogLevel.ERROR]: "❌",
  [LogLevel.SILENT]: "",
}

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "").toUpperCase()
  if (raw === "DEBUG") return LogLevel.DEBUG
  if (raw === "WARN" || raw === "WARNING") return LogLevel.WARN
  if (raw === "ERROR") return LogLevel.ERROR
  if (raw === "SILENT" || raw === "OFF") return LogLevel.SILENT
  return LogLevel.INFO
}

const currentLevel = resolveLevel()

export interface TaggedLogger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

class LoggerImpl implements TaggedLogger {
  constructor(private tag: string) {}

  debug(msg: string): void { this.write(LogLevel.DEBUG, msg) }
  info(msg: string): void { this.write(LogLevel.INFO, msg) }
  warn(msg: string): void { this.write(LogLevel.WARN, msg) }
  error(msg: string): void { this.write(LogLevel.ERROR, msg) }

  private write(level: LogLevel, msg: string): void {
    if (level < currentLevel) return
    const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.sss
    const emoji = LEVEL_EMOJI[level]
    const tag = this.tag ? `[${this.tag}]` : ""
    const prefix = emoji ? `${emoji} ${tag}` : tag
    process.stderr.write(`${ts} ${prefix} ${msg}\n`)
  }
}

/** 创建带标签的 Logger 实例 */
export function logger(tag: string): TaggedLogger {
  return new LoggerImpl(tag)
}

export { currentLevel as logLevel }
