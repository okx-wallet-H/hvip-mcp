import { useEffect, useRef, useState, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Pause, Play, Trash2, Brain, Wrench, CheckCircle2, XCircle, ChevronRight, Send, Zap, Circle, Wifi, WifiOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────

interface AIBlock {
  id: string
  taskId: string
  title: string
  text: string
  tools: Array<{ name: string; args: unknown }>
  status: "thinking" | "done" | "error"
  startTime: string
  tokens?: { input: number; output: number }
}

interface WorkerInfo {
  agentId: string
  name: string
  status: "idle" | "working" | "offline"
  capabilities: string[]
}

// ── Color markers for streaming text ──────────────────────────────────────
// Supports: [[green]]...[[/green]], [[red]]...[[/red]], [[yellow]]...[[/yellow]],
//           [[blue]]...[[/blue]], [[dim]]...[[/dim]], [[warn]]...[[/warn]]

const COLOR_MAP: Record<string, string> = {
  green:  "text-emerald-400",
  red:    "text-red-400",
  yellow: "text-amber-400",
  blue:   "text-sky-400",
  dim:    "text-zinc-500",
  warn:   "text-amber-300",
  info:   "text-sky-300",
  err:    "text-red-400 font-semibold",
  success:"text-emerald-400 font-semibold",
}

/** Parse color markers in text and render as React nodes */
function colorize(text: string): (string | React.ReactNode)[] {
  const parts: (string | React.ReactNode)[] = []
  const re = /\[\[(\w+)\]\]/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  const stack: string[] = []

  while ((match = re.exec(text)) !== null) {
    // Push text before this marker
    if (match.index > lastIdx) {
      const raw = text.slice(lastIdx, match.index)
      parts.push(raw)
    }
    const tag = match[1]
    if (tag.startsWith("/")) {
      // Closing tag
      const closeTag = tag.slice(1)
      if (stack.length > 0 && stack[stack.length - 1] === closeTag) {
        stack.pop()
      }
      // Push a marker to close styling — we handle via span nesting later
      parts.push(`[[/${closeTag}]]`)
    } else {
      // Opening tag
      stack.push(tag)
      parts.push(`[[${tag}]]`)
    }
    lastIdx = match.index + match[0].length
  }
  // Remaining text
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx))
  }

  // If no markers found, return as-is
  if (!text.includes("[[")) return [text]

  // Build React elements with proper nesting
  const output: (string | React.ReactNode)[] = []
  const openStack: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (typeof p !== "string") { output.push(p); continue }

    const openMatch = p.match(/^\[\[(\w+)\]\]$/)
    const closeMatch = p.match(/^\[\/\/(\w+)\]\]$/)

    if (closeMatch) {
      const tag = closeMatch[1]
      const idx = openStack.lastIndexOf(tag)
      if (idx >= 0) {
        openStack.splice(idx, 1)
      }
      continue
    }

    if (openMatch) {
      const tag = openMatch[1]
      openStack.push(tag)
      continue
    }

    // Plain text with current style stack
    if (openStack.length > 0) {
      const className = openStack.map(t => COLOR_MAP[t] || "").filter(Boolean).join(" ")
      output.push(
        <span key={`c-${i}`} className={className}>{p}</span>
      )
    } else {
      output.push(p)
    }
  }

  return output
}

/** Format HH:MM:SS timestamp */
function nowStamp(): string {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
}

// ── Component ─────────────────────────────────────────────────────────────

export function LiveTerminal() {
  const [blocks, setBlocks] = useState<AIBlock[]>([])
  const [paused, setPaused] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [workers, setWorkers] = useState<WorkerInfo[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const blocksRef = useRef<AIBlock[]>([])
  const pauseBufferRef = useRef<Record<string, unknown>[]>([])
  const pausedRef = useRef(false)
  const autoScrollRef = useRef(true)

  // Keep refs in sync
  useEffect(() => { blocksRef.current = blocks }, [blocks])
  useEffect(() => { pausedRef.current = paused }, [paused])

  // ── Submit task ──
  async function submitTask(text: string) {
    if (!text.trim() || sending) return
    setSending(true)
    const taskId = `Q-${Date.now().toString(36)}`
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, title: text.trim(), template: "", params: {} }),
      })
      setPrompt("")
    } catch { /* ignore */ }
    setSending(false)
  }

  // ── Fetch worker status ──
  const fetchWorkers = useCallback(async () => {
    try {
      const r = await fetch("/api/status")
      if (r.ok) {
        const data = await r.json()
        if (data.agents) {
          setWorkers(data.agents.map((a: any) => ({
            agentId: a.agentId,
            name: a.name,
            status: a.status as "idle" | "working" | "offline",
            capabilities: a.capabilities || [],
          })))
        }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchWorkers()
    const timer = setInterval(fetchWorkers, 10000)
    return () => clearInterval(timer)
  }, [fetchWorkers])

  // ── WebSocket connection (independent of paused state!) ──
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return
      const ws = new WebSocket(`ws://${location.hostname}:9321`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        ws.send(JSON.stringify({
          type: "agent:hello",
          agentId: `term-${Date.now()}`,
          name: "终端面板",
          version: "2.0",
          capabilities: [],
        }))
        // Replay buffered messages on reconnect
        const buf = pauseBufferRef.current
        if (buf.length > 0) {
          console.log(`[Terminal] 重放 ${buf.length} 条缓冲消息`)
          for (const m of buf) handleMessage(m)
          pauseBufferRef.current = []
        }
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          // If paused, buffer the message instead of dropping
          if (pausedRef.current) {
            pauseBufferRef.current.push(msg)
            // Cap buffer at 500 messages
            if (pauseBufferRef.current.length > 500) {
              pauseBufferRef.current.shift()
            }
            return
          }
          handleMessage(msg)
        } catch { /* ignore malformed */ }
      }

      ws.onclose = () => {
        setWsConnected(false)
        reconnectTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, []) // ← Only mount/unmount, NOT paused!

  // ── Message handler ──
  function handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string
    const taskId = (msg.taskId as string) || ""
    const agentId = (msg.agentId || msg.from as string) || ""

    switch (type) {
      case "task:progress": {
        const delta = msg.delta as string
        if (!delta || !taskId) return
        updateBlock(taskId, block => ({
          ...block,
          text: block.text + delta,
          status: "thinking" as const,
        }), taskId, (msg.title as string) || taskId)
        break
      }

      case "task:tool": {
        const toolName = (msg.tool as string) || "?"
        const toolArgs = msg.args
        if (!taskId) return
        updateBlock(taskId, block => ({
          ...block,
          tools: [...block.tools, { name: toolName, args: toolArgs }],
          text: block.text + `\n🔧 调用工具: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)})\n`,
        }), taskId, (msg.title as string) || taskId)
        break
      }

      case "task:done": {
        const result = (msg.result as string) || ""
        const usage = msg.usage as { inputTokens: number; outputTokens: number } | undefined
        const error = msg.error as string
        updateBlock(taskId, block => ({
          ...block,
          status: error ? "error" : "done",
          tokens: usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined,
          text: block.text + (error
            ? `\n[[err]]❌ ${error}[[/err]]\n`
            : `\n[[success]]✅ 完成 (${usage?.inputTokens || 0}+${usage?.outputTokens || 0} tokens)[[/success]]\n`),
        }), taskId, (msg.title as string) || taskId)
        // Refresh worker count after task completes
        fetchWorkers()
        break
      }

      case "task:assigned":
      case "task:claim": {
        if (agentId && taskId) {
          updateBlock(taskId, block => block, taskId, (msg.title as string) || taskId)
          fetchWorkers()
        }
        break
      }

      case "task:announced": {
        if (taskId) {
          const existing = blocksRef.current.find(b => b.taskId === taskId)
          if (!existing) {
            const block: AIBlock = {
              id: Math.random().toString(36).slice(2),
              taskId,
              title: (msg.title as string) || taskId,
              text: `[[dim]][${nowStamp()}] 任务已创建[[/dim]]\n`,
              tools: [],
              status: "thinking",
              startTime: nowStamp(),
            }
            setBlocks(prev => {
              const next = [...prev, block]
              return next.length > 50 ? next.slice(-50) : next
            })
          }
        }
        break
      }

      case "agent:update": {
        // Update worker list when agent status changes
        fetchWorkers()
        break
      }

      case "agent:offline": {
        fetchWorkers()
        break
      }
    }
  }

  function updateBlock(
    taskId: string,
    updater: (block: AIBlock) => AIBlock,
    defaultTaskId: string,
    defaultTitle: string,
  ) {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.taskId === taskId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = updater(next[idx])
        return next
      }
      // Create new block
      const block: AIBlock = updater({
        id: Math.random().toString(36).slice(2),
        taskId,
        title: defaultTitle,
        text: "",
        tools: [],
        status: "thinking",
        startTime: nowStamp(),
      })
      const next = [...prev, block]
      return next.length > 50 ? next.slice(-50) : next
    })
  }

  // ── Auto-scroll (respects pause) ──
  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [blocks, paused])

  // ── Derived stats ──
  const activeBlocks = blocks.filter(b => b.status === "thinking")
  const doneBlocks = blocks.filter(b => b.status === "done" || b.status === "error")
  const workingWorkers = workers.filter(w => w.status === "working" && !w.agentId.startsWith("term-") && !w.agentId.startsWith("dashboard"))
  const idleWorkers = workers.filter(w => w.status === "idle" && !w.agentId.startsWith("term-") && !w.agentId.startsWith("dashboard"))
  const totalWorkers = workingWorkers.length + idleWorkers.length

  const quickActions = [
    { label: "BTC行情", text: "查BTC价格和资金费率，分析趋势" },
    { label: "系统健康", text: "检查系统健康状态，Agent在线情况" },
    { label: "代码审查", text: "审查最近改动的代码质量" },
    { label: "信号扫描", text: "运行VBT信号扫描，输出当前信号" },
  ]

  return (
    <div className="space-y-4 animate-fade-in h-full flex flex-col">
      {/* ── Status bar: Worker count + Connection ── */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-1">
        {/* Connection indicator */}
        <div className="flex items-center gap-1.5">
          {wsConnected ? (
            <Wifi className="h-3 w-3 text-emerald-500" />
          ) : (
            <WifiOff className="h-3 w-3 text-red-500 animate-pulse" />
          )}
          <span className={wsConnected ? "text-emerald-500" : "text-red-500"}>
            {wsConnected ? "已连接" : "重连中…"}
          </span>
        </div>
        <span className="text-zinc-600">|</span>
        {/* Worker indicators */}
        <div className="flex items-center gap-1.5">
          {workingWorkers.map(w => (
            <span key={w.agentId} className="flex items-center gap-1">
              <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
              <span className="text-emerald-400">{w.name}</span>
            </span>
          ))}
          {idleWorkers.map(w => (
            <span key={w.agentId} className="flex items-center gap-1">
              <Circle className="h-2 w-2 fill-zinc-600 text-zinc-600" />
              <span className="text-zinc-400">{w.name}</span>
            </span>
          ))}
          {totalWorkers === 0 && (
            <span className="text-zinc-500 italic">无在线 Worker</span>
          )}
        </div>
      </div>

      {/* ── Quick input ── */}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-muted/50 rounded-lg px-3">
          <Zap className="h-4 w-4 text-primary shrink-0" />
          <Input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submitTask(prompt) }}
            placeholder="输入任务，Enter 发给 AI…"
            className="border-0 bg-transparent h-9 text-sm focus-visible:ring-0"
          />
        </div>
        <Button size="sm" onClick={() => submitTask(prompt)} disabled={!prompt.trim() || sending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Quick action chips ── */}
      <div className="flex gap-1.5 flex-wrap">
        {quickActions.map(q => (
          <Button key={q.label} size="xs" variant="ghost" className="text-[10px] h-6" onClick={() => submitTask(q.text)}>
            {q.label}
          </Button>
        ))}
      </div>

      {/* ── Active AI thinking blocks ── */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
        {activeBlocks.map(b => (
          <Card key={b.id} className="border-primary/30 bg-zinc-950 text-zinc-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
              <Brain className="h-3.5 w-3.5 text-primary animate-pulse" />
              <span className="text-xs font-semibold text-primary">{b.taskId}</span>
              <span className="text-[10px] text-zinc-500">[{b.startTime}]</span>
              <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">{b.title?.slice(0, 60)}</span>
              <div className="ml-auto flex items-center gap-1.5">
                {b.tools.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] bg-amber-500/20 text-amber-400 border-amber-500/30">
                    {b.tools.length} 工具
                  </Badge>
                )}
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            </div>
            {/* Streaming text with colorization */}
            <div className="p-3 font-mono text-[11px] leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap">
              {b.text ? (
                <ColorizedText text={b.text} />
              ) : (
                <span className="text-zinc-600 animate-pulse">思考中…</span>
              )}
              {b.status === "thinking" && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />}
            </div>
            {/* Tool calls */}
            {b.tools.length > 0 && (
              <div className="flex gap-1.5 px-3 py-1.5 border-t border-zinc-800 flex-wrap">
                {b.tools.map((t, i) => (
                  <Badge key={i} variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 gap-1">
                    <Wrench className="h-2.5 w-2.5" />
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        ))}

        {/* ── Completed blocks — collapsed summary ── */}
        {doneBlocks.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
              <CheckCircle2 className="h-3 w-3" />
              最近完成 ({doneBlocks.length})
            </div>
            {doneBlocks.slice(-10).reverse().map(b => (
              <div key={b.id}>
                <div
                  className="flex items-center gap-2 px-2 py-1 rounded text-[10px] bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    const el = document.getElementById(`done-${b.id}`)
                    if (el) el.classList.toggle("hidden")
                  }}
                >
                  {b.status === "done"
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    : <XCircle className="h-3 w-3 text-red-500" />
                  }
                  <span className="font-mono text-muted-foreground">{b.taskId}</span>
                  <span className="text-[9px] text-zinc-600">[{b.startTime}]</span>
                  <span className="text-muted-foreground/60 truncate max-w-[200px]">{b.title?.slice(0, 40)}</span>
                  {b.tokens && (
                    <span className="text-muted-foreground/40 ml-auto">
                      {b.tokens.input}+{b.tokens.output} tokens
                    </span>
                  )}
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                </div>
                {/* Expanded text */}
                <div key={`exp-${b.id}`} id={`done-${b.id}`} className="hidden p-2 font-mono text-[10px] leading-relaxed bg-zinc-950 text-zinc-400 rounded whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                  <ColorizedText text={b.text || "(无输出)"} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {blocks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40">
            <Zap className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm font-medium">终端空闲中</p>
            <p className="text-[10px] mt-1">输入任务或从快捷操作开始</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-2 border-t border-border">
        {/* Pause button */}
        <Button
          size="xs"
          variant="ghost"
          className={cn("h-6 w-6 p-0", paused && "bg-amber-500/10")}
          onClick={() => {
            setPaused(!paused)
            if (paused) {
              // Unpausing: replay buffer then auto-scroll
              const buf = pauseBufferRef.current
              if (buf.length > 0) {
                console.log(`[Terminal] 恢复暂停，重放 ${buf.length} 条消息`)
                for (const m of buf) handleMessage(m)
                pauseBufferRef.current = []
              }
              autoScrollRef.current = true
            }
          }}
          title={paused ? "恢复自动滚动" : "暂停自动滚动"}
        >
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
        </Button>

        {/* Clear button */}
        <Button size="xs" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBlocks([])} title="清空终端">
          <Trash2 className="h-3 w-3" />
        </Button>

        <span className="text-zinc-600">|</span>

        {/* Stats */}
        <span className="flex items-center gap-1">
          <span className="font-medium">{blocks.length}</span> 个任务
        </span>
        <span className="flex items-center gap-1">
          <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
          <span className="font-medium">{activeBlocks.length}</span> 活跃
        </span>
        <span className="text-zinc-600">|</span>
        <span className="flex items-center gap-1">
          {workingWorkers.length > 0 ? (
            <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500 animate-pulse" />
          ) : (
            <Circle className="h-2 w-2 fill-zinc-600 text-zinc-600" />
          )}
          <span>
            <span className="font-medium">{workingWorkers.length}</span>
            <span className="text-zinc-500">/</span>
            <span>{totalWorkers}</span> Worker
            <span className="text-zinc-500 ml-1">
              ({idleWorkers.length} 空闲)
            </span>
          </span>
        </span>

        {/* Paused indicator */}
        {paused && (
          <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/30 ml-auto">
            已暂停 · 缓冲 {pauseBufferRef.current.length} 条
          </Badge>
        )}
      </div>
    </div>
  )
}

// ── ColorizedText Component ───────────────────────────────────────────────

function ColorizedText({ text }: { text: string }) {
  if (!text.includes("[[")) {
    return <>{text}</>
  }

  // Simple parser: split by color markers
  const segments: { text: string; color?: string }[] = []
  const re = /\[\[(\/?\w+)\]\]/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  const stack: string[] = []

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({
        text: text.slice(lastIdx, match.index),
        color: stack.length > 0 ? stack[stack.length - 1] : undefined,
      })
    }
    const tag = match[1]
    if (tag.startsWith("/")) {
      stack.pop()
    } else {
      stack.push(tag)
    }
    lastIdx = match.index + match[0].length
  }

  if (lastIdx < text.length) {
    segments.push({
      text: text.slice(lastIdx),
      color: stack.length > 0 ? stack[stack.length - 1] : undefined,
    })
  }

  return (
    <>
      {segments.map((s, i) =>
        s.color ? (
          <span key={i} className={COLOR_MAP[s.color] || ""}>{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  )
}
