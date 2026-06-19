/**
 * AI SDK 统一封装 — 基于 @anthropic-ai/sdk (原版)
 *
 * 为什么用原版而不是 Vercel AI SDK:
 *   DeepSeek 的 Anthropic 兼容端点对 tool input_schema 要求严格，
 *   Vercel AI SDK 的 Zod→JSON Schema 转换会产生 type:null，DeepSeek 拒绝。
 *   原版 Anthropic SDK 直接传 JSON Schema，完全兼容。
 *
 * 用法:
 *   const agent = new AgentLoop({ model: 'claude-sonnet-4-6' })
 *   const result = await agent.run({ system, prompt, tools })
 */

import Anthropic from "@anthropic-ai/sdk"
import type { Tool, MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages"

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
// Agent Loop
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
}

export interface AgentResult {
  text: string
  steps: number
  stopReason: string
  inputTokens: number
  outputTokens: number
}

export class AgentLoop {
  private client: Anthropic

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY || "",
      baseURL: process.env.DEEPSEEK_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic",
    })
  }

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

    for (let step = 0; step < maxSteps; step++) {
      const resp = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
        tools: anthropicTools,
      })

      totalInputTokens += resp.usage.input_tokens
      totalOutputTokens += resp.usage.output_tokens
      stopReason = resp.stop_reason

      const toolUses = resp.content.filter((b): b is ToolUseBlock => b.type === "tool_use")
      const textBlocks = resp.content.filter(b => b.type === "text")

      const stepText = textBlocks.map(t => t.text).join("")
      if (stepText && onText) onText(stepText)
      finalText += stepText

      onStepFinish?.(step + 1)

      // No tool calls → done
      if (toolUses.length === 0) break

      // Execute all tools
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
    }

    return {
      text: finalText.trim(),
      steps: messages.length,
      stopReason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    }
  }

  /** Streaming variant */
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

    for (let step = 0; step < maxSteps; step++) {
      const stream = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
        tools: anthropicTools,
        stream: true,
      })

      const toolUseMap = new Map<string, { name: string; input: string }>()
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
            if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
              // Track tool input as it streams
            }
            break
          case "content_block_start":
            if (event.content_block.type === "tool_use") {
              toolUseMap.set(event.index.toString(), {
                name: event.content_block.name,
                input: "",
              })
            }
            break
          case "content_block_stop":
            // Tool input complete
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

      // For streaming, re-fetch the complete message to get tool_use blocks
      // (Anthropic streaming doesn't return full tool_use blocks)
      if (stopReason === "tool_use" || stopReason === "end_turn") {
        const complete = await this.client.messages.create({
          model,
          max_tokens: 100,
          temperature: 0,
          system,
          messages,
          tools: anthropicTools,
          stream: false,
        })

        totalInputTokens += complete.usage.input_tokens
        totalOutputTokens += complete.usage.output_tokens
        stopReason = complete.stop_reason

        const toolUses = complete.content.filter((b): b is ToolUseBlock => b.type === "tool_use")
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

        messages.push({ role: "assistant", content: complete.content.map(b => {
          if (b.type === "text") return { type: "text" as const, text: b.text }
          return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input }
        }) })
        messages.push({ role: "user", content: toolResults })
      } else {
        break
      }
    }

    return {
      text: finalText.trim(),
      steps: Math.ceil(messages.length / 2),
      stopReason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    }
  }
}

// Singleton
export const agentLoop = new AgentLoop()
