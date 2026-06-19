/**
 * LLM 成本追踪 — 记录每次 AI 调用的 token 用量和费用
 *
 * 存储: .hub/llm-costs.jsonl（每行一个 JSON，追加写入）
 * API:  GET /api/costs → 当日/累计汇总
 *       GET /api/costs/daily → 按日分组
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

// ═══════════════════════════════════════════════════════════
// 模型定价 ($/1M tokens)
// ═══════════════════════════════════════════════════════════

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":      { input: 3.00, output: 15.00 },
  "claude-sonnet-4-5":      { input: 3.00, output: 15.00 },
  "claude-haiku-4-5":       { input: 1.00, output: 5.00 },
  "claude-opus-4-8":        { input: 15.00, output: 75.00 },
  "gpt-4o-mini":            { input: 0.15, output: 0.60 },
  "gpt-4o":                 { input: 2.50, output: 10.00 },
  "deepseek-v4-pro":        { input: 0.55, output: 2.19 },
}

function getCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

// ═══════════════════════════════════════════════════════════

export interface CostEntry {
  timestamp: string
  agentId: string
  taskId?: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  purpose?: string  // "task" | "analysis" | "patrol" | "dispatch"
}

export interface CostSummary {
  today: { calls: number; inputTokens: number; outputTokens: number; cost: number }
  total: { calls: number; inputTokens: number; outputTokens: number; cost: number }
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>
  byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>
  hourly: Array<{ hour: string; calls: number; cost: number }>
}

export class HubCosts {
  private filePath: string
  private cache: CostEntry[] = []
  private cacheLoaded = false

  constructor(dbPath = ".hub/llm-costs.jsonl") {
    this.filePath = dbPath
  }

  /** 记录一次 LLM 调用 */
  record(entry: Omit<CostEntry, "timestamp" | "cost"> & { cost?: number }): void {
    const cost = entry.cost ?? getCost(entry.model, entry.inputTokens, entry.outputTokens)
    const rec: CostEntry = {
      timestamp: new Date().toISOString(),
      agentId: entry.agentId,
      taskId: entry.taskId,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cost: Math.round(cost * 10000) / 10000,  // 4 decimal places
      purpose: entry.purpose,
    }
    // 追加写入
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(this.filePath, JSON.stringify(rec) + "\n", "utf-8")
    } catch {}
    this.cache.push(rec)
  }

  /** 加载全部记录 */
  private loadAll(): CostEntry[] {
    if (this.cacheLoaded) return this.cache
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8")
        this.cache = raw.split("\n").filter(Boolean).map(line => {
          try { return JSON.parse(line) } catch { return null }
        }).filter(Boolean) as CostEntry[]
      }
    } catch {}
    this.cacheLoaded = true
    return this.cache
  }

  /** 汇总统计 */
  summary(): CostSummary {
    const all = this.loadAll()
    const today = new Date().toISOString().slice(0, 10)
    const todayEntries = all.filter(e => e.timestamp.startsWith(today))

    const sum = (entries: CostEntry[]) => ({
      calls: entries.length,
      inputTokens: entries.reduce((s, e) => s + e.inputTokens, 0),
      outputTokens: entries.reduce((s, e) => s + e.outputTokens, 0),
      cost: entries.reduce((s, e) => s + e.cost, 0),
    })

    const byModel: Record<string, any> = {}
    for (const e of all) {
      if (!byModel[e.model]) byModel[e.model] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
      byModel[e.model].calls++
      byModel[e.model].inputTokens += e.inputTokens
      byModel[e.model].outputTokens += e.outputTokens
      byModel[e.model].cost += e.cost
    }

    const byAgent: Record<string, any> = {}
    for (const e of all) {
      if (!byAgent[e.agentId]) byAgent[e.agentId] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
      byAgent[e.agentId].calls++
      byAgent[e.agentId].inputTokens += e.inputTokens
      byAgent[e.agentId].outputTokens += e.outputTokens
      byAgent[e.agentId].cost += e.cost
    }

    // 最近 24 小时按小时分组
    const hourly: Array<{ hour: string; calls: number; cost: number }> = []
    for (let h = 23; h >= 0; h--) {
      const slot = new Date(Date.now() - h * 3600_000).toISOString().slice(0, 13)
      const entries = all.filter(e => e.timestamp.startsWith(slot))
      hourly.push({ hour: slot, calls: entries.length, cost: entries.reduce((s, e) => s + e.cost, 0) })
    }

    return {
      today: sum(todayEntries),
      total: sum(all),
      byModel,
      byAgent,
      hourly,
    }
  }

  /** 最近 N 条记录 */
  recent(n = 50): CostEntry[] {
    const all = this.loadAll()
    return all.slice(-n)
  }
}
