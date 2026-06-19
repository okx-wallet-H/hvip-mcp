/**
 * 熔断器 — 保护外部 API 调用，防止级联故障
 *
 * 状态机: CLOSED → (3 failures) → OPEN → (60s cooldown) → HALF_OPEN → (success) → CLOSED
 *                                                                   → (failure) → OPEN
 *
 * 集成: OKX API / Memory DB / MCP Server / any external call
 * API:  GET /api/circuits → 查看所有熔断器状态
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"

interface CircuitEntry {
  name: string
  state: CircuitState
  failures: number
  successCount: number
  failureCount: number
  lastFailure: string | null
  lastSuccess: string | null
  openedAt: string | null
  cooldownMs: number
}

export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>()
  private failureThreshold = 3
  private cooldownMs = 60_000  // 1 minute default

  constructor(opts?: { failureThreshold?: number; cooldownMs?: number }) {
    if (opts?.failureThreshold) this.failureThreshold = opts.failureThreshold
    if (opts?.cooldownMs) this.cooldownMs = opts.cooldownMs
  }

  /** 获取或创建熔断器 */
  private get(name: string): CircuitEntry {
    let c = this.circuits.get(name)
    if (!c) {
      c = {
        name, state: "CLOSED", failures: 0,
        successCount: 0, failureCount: 0,
        lastFailure: null, lastSuccess: null, openedAt: null,
        cooldownMs: this.cooldownMs,
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
    // OPEN: 检查冷却时间
    if (c.openedAt) {
      const elapsed = Date.now() - new Date(c.openedAt).getTime()
      if (elapsed >= c.cooldownMs) {
        c.state = "HALF_OPEN"
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
    }
    if (c.state === "CLOSED") {
      c.failures = 0
    }
  }

  /** 调用失败 */
  onFailure(name: string): void {
    const c = this.get(name)
    c.failures++
    c.failureCount++
    c.lastFailure = new Date().toISOString()
    if (c.failures >= this.failureThreshold) {
      c.state = "OPEN"
      c.openedAt = new Date().toISOString()
    }
  }

  /** 包裹一个异步函数 */
  async wrap<T>(name: string, fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (!this.canCall(name)) {
      if (fallback) return fallback()
      throw new Error(`Circuit OPEN: ${name}`)
    }
    try {
      const result = await fn()
      this.onSuccess(name)
      return result
    } catch (e) {
      this.onFailure(name)
      if (fallback) return fallback()
      throw e
    }
  }

  /** 获取所有熔断器状态 */
  status(): CircuitEntry[] {
    return [...this.circuits.values()]
  }

  /** 重置指定熔断器 */
  reset(name: string): void {
    this.circuits.delete(name)
  }
}

/** 全局单例 — 供各模块共享熔断状态 */
export const circuitBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 })
