/**
 * 熔断器 — 保护外部 API 调用，防止级联故障
 *
 * 状态机: CLOSED → (3 failures) → OPEN → (cooldown) → HALF_OPEN → (success) → CLOSED
 *                                                                   → (failure) → OPEN (with backoff)
 *
 * v2 增强:
 * - 指数退避 (每次 OPEN 冷却翻倍，上限 5min)
 * - 事件回调 (onStateChange) — 供外部模块监听状态转换
 * - 命名重置 + 日志
 *
 * 集成: OKX API / Memory DB / MCP Server / any external call
 * API:  GET /api/circuits → 查看所有熔断器状态
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"
export type CircuitEvent = "opened" | "closed" | "half_open" | "reset"

export interface CircuitEntry {
  name: string
  state: CircuitState
  failures: number
  successCount: number
  failureCount: number
  lastFailure: string | null
  lastSuccess: string | null
  openedAt: string | null
  cooldownMs: number
  /** 当前退避倍数 (1, 2, 4, 8...) */
  backoffMultiplier: number
}

export type StateChangeHandler = (event: CircuitEvent, name: string, entry: CircuitEntry) => void

export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>()
  private failureThreshold = 3
  private baseCooldownMs = 60_000  // 1 minute base
  private maxCooldownMs = 300_000  // 5 minutes max
  private listeners = new Set<StateChangeHandler>()

  constructor(opts?: { failureThreshold?: number; cooldownMs?: number; maxCooldownMs?: number }) {
    if (opts?.failureThreshold) this.failureThreshold = opts.failureThreshold
    if (opts?.cooldownMs) this.baseCooldownMs = opts.cooldownMs
    if (opts?.maxCooldownMs) this.maxCooldownMs = opts.maxCooldownMs
  }

  /** 注册状态变更监听 */
  onStateChange(handler: StateChangeHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  /** 内部通知 */
  private notify(event: CircuitEvent, name: string, entry: CircuitEntry): void {
    for (const h of this.listeners) {
      try { h(event, name, entry) } catch { /* 忽略监听器异常 */ }
    }
  }

  /** 获取或创建熔断器 */
  private get(name: string): CircuitEntry {
    let c = this.circuits.get(name)
    if (!c) {
      c = {
        name, state: "CLOSED", failures: 0,
        successCount: 0, failureCount: 0,
        lastFailure: null, lastSuccess: null, openedAt: null,
        cooldownMs: this.baseCooldownMs,
        backoffMultiplier: 1,
      }
      this.circuits.set(name, c)
    }
    return c
  }

  /** 调用前检查 — 返回 true 表示可以执行 */
  canCall(name: string): boolean {
    const c = this.get(name)
    if (c.state === "CLOSED") return true
    if (c.state === "HALF_OPEN") return true
    // OPEN: 检查冷却时间（含退避）
    if (c.openedAt) {
      const elapsed = Date.now() - new Date(c.openedAt).getTime()
      if (elapsed >= c.cooldownMs) {
        c.state = "HALF_OPEN"
        this.notify("half_open", name, c)
        return true
      }
    }
    return false
  }

  /** 调用成功 */
  onSuccess(name: string): void {
    const c = this.get(name)
    c.successCount++
    c.lastSuccess = new Date().toISOString()
    if (c.state === "HALF_OPEN") {
      c.state = "CLOSED"
      c.failures = 0
      c.backoffMultiplier = 1  // 成功时重置退避
      this.notify("closed", name, c)
    }
    if (c.state === "CLOSED") {
      c.failures = 0
    }
  }

  /** 调用失败 — 带指数退避 */
  onFailure(name: string): void {
    const c = this.get(name)
    c.failures++
    c.failureCount++
    c.lastFailure = new Date().toISOString()
    if (c.failures >= this.failureThreshold) {
      // 指数退避: baseCooldown * 2^(backoffMultiplier-1)，上限 maxCooldownMs
      const backoffMs = Math.min(
        this.baseCooldownMs * Math.pow(2, c.backoffMultiplier - 1),
        this.maxCooldownMs
      )
      c.cooldownMs = backoffMs
      c.backoffMultiplier++
      c.state = "OPEN"
      c.openedAt = new Date().toISOString()
      this.notify("opened", name, c)
    }
  }

  /** 包裹一个异步函数，支持重试和 fallback */
  async wrap<T>(
    name: string,
    fn: () => Promise<T>,
    fallback?: () => T,
    retries = 0,
  ): Promise<T> {
    if (!this.canCall(name)) {
      if (fallback) return fallback()
      throw new Error(`Circuit OPEN: ${name} (冷却中, ${this.get(name).cooldownMs}ms)`)
    }
    try {
      const result = await fn()
      this.onSuccess(name)
      return result
    } catch (e) {
      this.onFailure(name)
      // 重试逻辑：如果还有重试次数，等待指数退避后重试
      if (retries > 0) {
        const wait = Math.min(1000 * Math.pow(2, 3 - retries), 9000)
        await new Promise(r => setTimeout(r, wait))
        return this.wrap(name, fn, fallback, retries - 1)
      }
      if (fallback) return fallback()
      throw e
    }
  }

  /** 获取所有熔断器状态 */
  status(): CircuitEntry[] {
    return [...this.circuits.values()]
  }

  /** 重置指定熔断器 — 立即清除状态 */
  reset(name: string): void {
    const c = this.circuits.get(name)
    if (c) {
      this.notify("reset", name, c)
      this.circuits.delete(name)
    }
  }

  /** 重置所有熔断器 */
  resetAll(): void {
    for (const [name, c] of this.circuits) {
      this.notify("reset", name, c)
    }
    this.circuits.clear()
  }
}

/** 全局单例 — 供各模块共享熔断状态 */
export const circuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  cooldownMs: 60_000,
  maxCooldownMs: 300_000,
})
