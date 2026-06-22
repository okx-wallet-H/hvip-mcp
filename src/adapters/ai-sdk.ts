/**
 * AI SDK 统一封装 — 多模型降级链
 * =========================================
 *
 * 支持多 Provider 自动降级:
 *   Primary   → DeepSeek (Anthropic 兼容端点, 成本最低)
 *   Secondary → Anthropic Direct (稳定性最佳)
 *   Tertiary  → Groq (速度快, OpenAI 格式)
 *
 * 降级策略:
 *   - 网络错误/超时/5xx → 自动降级到下一个
 *   - 4xx 错误 → 不降级（参数错误换了也没用）
 *   - 每个模型失败后冷却 60s
 *
 * v6 自愈增强:
 *   - 每步 API 调用超时 (timeout, 默认 120s)
 *   - 总执行超时 (totalTimeout, 默认 600s)
 *   - 超时后自动降级/终止，防止 Worker 永久卡住
 *
 * 用法:
 *   const agent = new AgentLoop()
 *   const result = await agent.run(prompt, tools, { timeout: 120_000 })
 */

import Anthropic from "@anthropic-ai/sdk"
import type { Tool, MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages"

// ═══════════════════════════════════════════════════════════════
// Model Tier Definition
// ═══════════════════════════════════════════════════════════════

interface ModelTier {
  provider: string
  model: string
  apiKey: string
  baseURL: string
  protocol: "anthropic" | "openai"  // API format
  cooldownUntil: number
  enabled: boolean
}

const MODEL_TIERS: ModelTier[] = [
  {
    provider: "deepseek",
    model: process.env.DEEPSEEK_MODEL || "claude-sonnet-4-6",
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_AUTH_TOKEN || "",
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic",
    protocol: "anthropic",
    cooldownUntil: 0,
    enabled: !!(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_AUTH_TOKEN),
  },
  {
    provider: "anthropic",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "",
    baseURL: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    protocol: "anthropic",
    cooldownUntil: 0,
    enabled: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  },
  {
    provider: "groq",
    model: process.env.GROQ_MODEL || "llama-4-scout-17b-16e-instruct",
    apiKey: process.env.GROQ_API_KEY || "",
    baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    protocol: "openai",
    cooldownUntil: 0,
    // NOTE: Groq speaks OpenAI format, not Anthropic. The Anthropic SDK client created
    // for this tier will fail with 4xx. Until an OpenAI-format client is added,
    // this tier is effectively a no-op fallback placeholder.
    enabled: false,  // Disabled until OpenAI client support is added
  },
]

const COOLDOWN_MS = 60_000  // Failed models cool down for 60s
const FALLBACK_ENABLED = process.env.LLM_FALLBACK !== "false" && process.env.LLM_FALLBACK !== "FALSE" && process.env.LLM_FALLBACK !== "0"

// ═══════════════════════════════════════════════════════════════
// Tool Definition
// ═══════════════════════════════════════════════════════════════

export interface AgentTool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; enum?: string[]; description?: string }>
    required: string[]
  }
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

// ═══════════════════════════════════════════════════════════════
// Agent Loop with Fallback + Timeout
// ═══════════════════════════════════════════════════════════════

export interface AgentOptions {
  model?: string
  maxTokens?: number
  maxSteps?: number
  temperature?: number
  system?: string
  onText?: (delta: string) => void
  onToolCall?: (name: string, input: unknown) => void
  onStepFinish?: (step: number) => void
  /** Force a specific provider (skip fallback) */
  forceProvider?: string
  /**
   * Per-step API call timeout in milliseconds.
   * If a single API call (including tool exec) exceeds this, it triggers fallback/error.
   * Default: 120_000 (2 min)
   * Set to 0 to disable per-step timeout.
   */
  timeout?: number
  /**
   * Total execution timeout in milliseconds.
   * If the entire agent.run() exceeds this, it throws an error.
   * Default: 600_000 (10 min)
   * Set to 0 to disable total timeout.
   */
  totalTimeout?: number
}

export interface AgentResult {
  text: string
  steps: number
  stopReason: string
  inputTokens: number
  outputTokens: number
  model: string
  provider: string
  tsIso: string
}

/** 创建一个带超时的 AbortController */
function withTimeout(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`请求超时 (${ms}ms)`)), ms)
  return {
    signal: controller.signal,
    cleanup: () => { clearTimeout(timer); controller.abort() },
  }
}

export class AgentLoop {
  private clients = new Map<string, Anthropic>()
  private tierStats = new Map<string, { success: number; fail: number }>()

  constructor() {
    for (const tier of MODEL_TIERS) {
      if (tier.enabled) {
        this.clients.set(tier.provider, new Anthropic({
          apiKey: tier.apiKey,
          baseURL: tier.baseURL,
        }))
      }
    }
  }

  /** Get available tiers in priority order */
  private getAvailableTiers(forceProvider?: string): ModelTier[] {
    const now = Date.now()
    return MODEL_TIERS.filter(t => {
      if (!t.enabled) return false
      if (forceProvider && t.provider !== forceProvider) return false
      if (t.cooldownUntil > now) return false
      return true
    })
  }

  /** Put a tier in cooldown after failure */
  private cooldown(provider: string): void {
    const tier = MODEL_TIERS.find(t => t.provider === provider)
    if (tier) {
      tier.cooldownUntil = Date.now() + COOLDOWN_MS
      const stats = this.tierStats.get(provider) || { success: 0, fail: 0 }
      stats.fail++
      this.tierStats.set(provider, stats)
    }
  }

  /** Record success */
  private recordSuccess(provider: string): void {
    const stats = this.tierStats.get(provider) || { success: 0, fail: 0 }
    stats.success++
    this.tierStats.set(provider, stats)
  }

  /** Get tier health for monitoring */
  getTierStats(): Record<string, { success: number; fail: number; cooldown: boolean }> {
    const now = Date.now()
    const result: Record<string, any> = {}
    for (const tier of MODEL_TIERS) {
      result[tier.provider] = {
        success: this.tierStats.get(tier.provider)?.success || 0,
        fail: this.tierStats.get(tier.provider)?.fail || 0,
        cooldown: tier.cooldownUntil > now,
        enabled: tier.enabled,
      }
    }
    return result
  }

  /**
   * Non-streaming agent loop with per-step timeout + total timeout.
   *
   * Per-step timeout: 每个 API 调用超过 timeout ms 即触发降级/报错
   * Total timeout:    整个 run() 超过 totalTimeout ms 即强制抛错
   */
  async run(prompt: string, tools: Record<string, AgentTool> = {}, opts: AgentOptions = {}): Promise<AgentResult> {
    const {
      model = "claude-sonnet-4-6",
      maxTokens = 4000,
      maxSteps = 10,
      temperature = 0.3,
      system = "",
      onText,
      onToolCall,
      onStepFinish,
      timeout = 120_000,         // 默认每步 2 分钟
      totalTimeout = 600_000,    // 默认总超时 10 分钟
    } = opts

    const anthropicTools: Tool[] = Object.values(tools).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))

    const messages: MessageParam[] = [{ role: "user", content: prompt }]
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let finalText = ""
    let stopReason = ""
    let activeProvider = ""
    let activeModel = ""

    // Allow opts.model to override tier default (respects caller intent)
    const effectiveModel = opts.model || model

    // ── 总超时保护 ──
    let totalTimedOut = false
    let totalTimer: ReturnType<typeof setTimeout> | undefined
    if (totalTimeout > 0) {
      totalTimer = setTimeout(() => { totalTimedOut = true }, totalTimeout)
    }

    try {
      for (let step = 0; step < maxSteps; step++) {
        // 检查总超时
        if (totalTimedOut) {
          throw new Error(`AgentLoop 总执行超时 (${totalTimeout}ms)`)
        }

        // ── 每步 API 调用超时 ──
        let stepCleanup: (() => void) | undefined
        let stepSignal: AbortSignal | undefined
        if (timeout > 0) {
          const tc = withTimeout(timeout)
          stepSignal = tc.signal
          stepCleanup = tc.cleanup
        }

        try {
          const result = await this.tryWithFallback(
            (client, tier) => client.messages.create({
              model: effectiveModel || tier.model,
              max_tokens: maxTokens,
              temperature,
              system,
              messages,
              tools: anthropicTools,
            }, stepSignal ? { signal: stepSignal } : undefined),
            opts.forceProvider,
          )

          if (!result.success) {
            throw new Error(`All model tiers failed. Last error: ${result.error}`)
          }

          const resp = result.data!
          activeProvider = result.tier!
          activeModel = result.model!

          totalInputTokens += resp.usage?.input_tokens || 0
          totalOutputTokens += resp.usage?.output_tokens || 0
          stopReason = resp.stop_reason

          const toolUses = resp.content.filter((b): b is ToolUseBlock => b.type === "tool_use")
          const textBlocks = resp.content.filter(b => b.type === "text")

          const stepText = textBlocks.map(t => t.text).join("")
          if (stepText && onText) onText(stepText)
          finalText += stepText

          onStepFinish?.(step + 1)

          // No tool calls → done
          if (toolUses.length === 0) break

          // Execute all tools (这些在 Worker 内部，不设超时，工具自己管理)
          const toolResults: MessageParam["content"] = []
          for (const tu of toolUses) {
            onToolCall?.(tu.name, tu.input)
            try {
              const tool = tools[tu.name]
              const result = tool ? await tool.execute(tu.input as Record<string, unknown>) : { error: `unknown tool: ${tu.name}` }
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: typeof result === "string" ? result : JSON.stringify(result),
              })
            } catch (e: unknown) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
              })
            }
          }

          messages.push({ role: "assistant", content: resp.content })
          messages.push({ role: "user", content: toolResults })
        } finally {
          stepCleanup?.()
        }
      }
    } finally {
      if (totalTimer) clearTimeout(totalTimer)
    }

    return {
      text: finalText.trim(),
      steps: Math.ceil((messages.length - 1) / 2),  // Messages = [user, asst, tools, asst, tools...] → actual step count
      stopReason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      model: activeModel,
      provider: activeProvider,
      tsIso: new Date().toISOString(),
    }
  }

  /** Streaming variant with fallback + timeout */
  async runStream(prompt: string, tools: Record<string, AgentTool> = {}, opts: AgentOptions = {}): Promise<AgentResult> {
    const {
      model = "claude-sonnet-4-6",
      maxTokens = 4000,
      maxSteps = 10,
      temperature = 0.3,
      system = "",
      onText,
      onToolCall,
      onStepFinish,
      timeout = 120_000,         // 默认每步 2 分钟
      totalTimeout = 600_000,    // 默认总超时 10 分钟
    } = opts

    const anthropicTools: Tool[] = Object.values(tools).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))

    const messages: MessageParam[] = [{ role: "user", content: prompt }]
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let finalText = ""
    let stopReason = ""
    let activeProvider = ""
    let activeModel = ""

    const effectiveModel = opts.model || model
    let isFallback = false

    // ── 总超时保护 ──
    let totalTimedOut = false
    let totalTimer: ReturnType<typeof setTimeout> | undefined
    if (totalTimeout > 0) {
      totalTimer = setTimeout(() => { totalTimedOut = true }, totalTimeout)
    }

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (totalTimedOut) {
          throw new Error(`AgentLoop 总执行超时 (${totalTimeout}ms)`)
        }

        const tierList = this.getAvailableTiers(opts.forceProvider)
        const primary = tierList[0]
        if (!primary) throw new Error("No available model tiers")

        let resp: any
        let alreadyCountedTokens = false

        if (primary.protocol === "anthropic") {
          // ── 每步流式调用超时 ──
          let stepCleanup: (() => void) | undefined
          let stepSignal: AbortSignal | undefined
          if (timeout > 0) {
            const tc = withTimeout(timeout)
            stepSignal = tc.signal
            stepCleanup = tc.cleanup
          }

          try {
            const client = this.clients.get(primary.provider)
            if (!client) throw new Error(`No client for ${primary.provider}`)

            const stream = await client.messages.create({
              model: effectiveModel || primary.model,
              max_tokens: maxTokens,
              temperature,
              system,
              messages,
              tools: anthropicTools,
              stream: true,
            }, stepSignal ? { signal: stepSignal } : undefined)

            const textChunks: string[] = []
            for await (const event of stream) {
              switch (event.type) {
                case "message_start":
                  totalInputTokens += event.message.usage.input_tokens
                  break
                case "content_block_delta":
                  if (event.delta.type === "text_delta" && event.delta.text) {
                    textChunks.push(event.delta.text)
                    onText?.(event.delta.text)
                  }
                  break
                case "message_delta":
                  totalOutputTokens += event.usage.output_tokens
                  stopReason = event.delta.stop_reason || stopReason
                  break
              }
            }

            const stepText = textChunks.join("")
            finalText += stepText
            onStepFinish?.(step + 1)
            this.recordSuccess(primary.provider)
            activeProvider = primary.provider
            activeModel = effectiveModel || primary.model
            alreadyCountedTokens = true

            // Re-fetch only for tool_use
            if (stopReason === "tool_use") {
              let reFetchCleanup: (() => void) | undefined
              let reFetchSignal: AbortSignal | undefined
              if (timeout > 0) {
                const tc = withTimeout(timeout)
                reFetchSignal = tc.signal
                reFetchCleanup = tc.cleanup
              }
              try {
                const complete = await client.messages.create({
                  model: effectiveModel || primary.model,
                  max_tokens: maxTokens,
                  temperature,
                  system,
                  messages,
                  tools: anthropicTools,
                  stream: false,
                }, reFetchSignal ? { signal: reFetchSignal } : undefined)
                totalInputTokens += complete.usage.input_tokens
                totalOutputTokens += complete.usage.output_tokens
                stopReason = complete.stop_reason
                resp = complete
              } finally {
                reFetchCleanup?.()
              }
            } else {
              break
            }
          } catch (e: any) {
            if (this.isRetryable(e)) {
              this.cooldown(primary.provider)
              isFallback = true

              let fbCleanup: (() => void) | undefined
              let fbSignal: AbortSignal | undefined
              if (timeout > 0) {
                const tc = withTimeout(timeout)
                fbSignal = tc.signal
                fbCleanup = tc.cleanup
              }
              try {
                const fallbackResult = await this.tryWithFallback(
                  (client, tier) => client.messages.create({
                    model: effectiveModel || tier.model,
                    max_tokens: maxTokens,
                    temperature,
                    system,
                    messages,
                    tools: anthropicTools,
                  }, fbSignal ? { signal: fbSignal } : undefined),
                  opts.forceProvider,
                )
                if (!fallbackResult.success) throw e
                resp = fallbackResult.data!
                activeProvider = fallbackResult.tier!
                activeModel = effectiveModel || fallbackResult.model!
              } finally {
                fbCleanup?.()
              }
            } else {
              throw e
            }
          } finally {
            stepCleanup?.()
          }
        } else {
          // Non-Anthropic protocol: use non-streaming
          isFallback = true
          let fbCleanup: (() => void) | undefined
          let fbSignal: AbortSignal | undefined
          if (timeout > 0) {
            const tc = withTimeout(timeout)
            fbSignal = tc.signal
            fbCleanup = tc.cleanup
          }
          try {
            const fallbackResult = await this.tryWithFallback(
              (client, tier) => client.messages.create({
                model: effectiveModel || tier.model,
                max_tokens: maxTokens,
                temperature,
                system,
                messages,
                tools: anthropicTools,
              }, fbSignal ? { signal: fbSignal } : undefined),
              opts.forceProvider,
            )
            if (!fallbackResult.success) throw new Error(fallbackResult.error || "All tiers failed")
            resp = fallbackResult.data!
            activeProvider = fallbackResult.tier!
            activeModel = effectiveModel || fallbackResult.model!
          } finally {
            fbCleanup?.()
          }
        }

        if (resp) {
          if (!alreadyCountedTokens) {
            totalInputTokens += resp.usage?.input_tokens || 0
            totalOutputTokens += resp.usage?.output_tokens || 0
          }
          stopReason = resp.stop_reason || stopReason

          const toolUses = (resp.content || []).filter((b: any) => b.type === "tool_use")
          const textBlocks = (resp.content || []).filter((b: any) => b.type === "text")
          const stepText = textBlocks.map((t: any) => t.text).join("")
          if (stepText) {
            if (!finalText.includes(stepText)) finalText += stepText
            if (isFallback || primary.protocol !== "anthropic") onText?.(stepText)
          }

          if (toolUses.length === 0) break

          const toolResults: MessageParam["content"] = []
          for (const tu of toolUses) {
            onToolCall?.(tu.name, tu.input)
            try {
              const tool = tools[tu.name]
              const result = tool ? await tool.execute(tu.input as Record<string, unknown>) : { error: `unknown tool: ${tu.name}` }
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: typeof result === "string" ? result : JSON.stringify(result),
              })
            } catch (e: unknown) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
              })
            }
          }

          messages.push({ role: "assistant", content: resp.content.map((b: any) => {
            if (b.type === "text") return { type: "text" as const, text: b.text }
            return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input }
          }) })
          messages.push({ role: "user", content: toolResults })
        } else {
          break
        }
      }
    } finally {
      if (totalTimer) clearTimeout(totalTimer)
    }

    return {
      text: finalText.trim(),
      steps: Math.ceil(messages.length / 2),
      stopReason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      model: activeModel,
      provider: activeProvider,
      tsIso: new Date().toISOString(),
    }
  }

  /** Try to execute a request across available tiers with fallback */
  private async tryWithFallback(
    fn: (client: Anthropic, tier: ModelTier) => Promise<any>,
    forceProvider?: string,
  ): Promise<{ success: boolean; data?: any; tier?: string; model?: string; error?: string }> {
    if (!FALLBACK_ENABLED) {
      const tiers = this.getAvailableTiers(forceProvider)
      if (!tiers.length) return { success: false, error: "No available model tiers (fallback disabled)" }
      const tier = tiers[0]
      const client = this.clients.get(tier.provider)
      if (!client) return { success: false, error: `No client for ${tier.provider}` }
      try {
        const data = await fn(client, tier)
        this.recordSuccess(tier.provider)
        return { success: true, data, tier: tier.provider, model: tier.model }
      } catch (e: any) {
        this.cooldown(tier.provider)
        return { success: false, error: e.message || String(e) }
      }
    }

    const tiers = this.getAvailableTiers(forceProvider)
    if (!tiers.length) return { success: false, error: "No available model tiers (all in cooldown or disabled)" }

    let lastError = ""
    for (const tier of tiers) {
      const client = this.clients.get(tier.provider)
      if (!client) continue

      try {
        const data = await fn(client, tier)
        this.recordSuccess(tier.provider)
        return { success: true, data, tier: tier.provider, model: tier.model }
      } catch (e: any) {
        lastError = e.message || String(e)
        if (this.isRetryable(e)) {
          this.cooldown(tier.provider)
          continue  // Try next tier
        } else {
          // Non-retryable error (4xx, auth, etc.) — don't try other tiers
          return { success: false, error: `${tier.provider}: ${lastError}` }
        }
      }
    }

    return { success: false, error: lastError || "All tiers exhausted" }
  }

  /** Determine if an error is retryable (should try next tier) */
  private isRetryable(e: any): boolean {
    const status = e?.status || e?.response?.status || 0
    // 5xx server errors, 429 rate limits, network errors → retry
    if (status >= 500) return true
    if (status === 429) return true
    // Network/timeout errors (including our custom abort/timeout)
    if (e?.code === "ECONNREFUSED" || e?.code === "ETIMEDOUT" || e?.code === "ENOTFOUND") return true
    if (e?.message?.includes("timeout") || e?.message?.includes("fetch failed")) return true
    if (e?.name === "AbortError" || e?.message?.includes("aborted")) return true
    // 4xx client errors → don't retry (bad request, auth, etc.)
    return false
  }
}

// Singleton
export const agentLoop = new AgentLoop()
