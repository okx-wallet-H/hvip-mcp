/**
 * 共享 .env 加载 — 消除 chat-llm.ts / hub-server.ts / server.js 三处重复解析
 *
 * 用法（模块入口第一行）:
 *   import { loadEnv } from "../utils/load-env.js"
 *   loadEnv()
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export function loadEnv(dir?: string): void {
  const envPath = join(dir || process.cwd(), ".env")
  if (!existsSync(envPath)) return

  readFileSync(envPath, "utf-8").split(/\r?\n/).forEach(line => {
    const hashIdx = line.indexOf("#")
    if (hashIdx >= 0) line = line.substring(0, hashIdx)
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/)
    if (m) {
      const val = m[2].trim()
      if (!val) { delete process.env[m[1]] }
      else if (!process.env[m[1]]) { process.env[m[1]] = val }
    }
  })
}
