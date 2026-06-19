import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Task } from "@/hooks/use-api"
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Lightbulb, Table, FileText } from "lucide-react"

interface DebateGroup {
  parent: string
  workers: Task[]
  topic: string
}

interface KeyPoint {
  agentIndex: number
  text: string
  sentiment: number
}

function buildDebateGroups(tasks: Task[]): Record<string, DebateGroup> {
  const groups: Record<string, DebateGroup> = {}
  for (const t of tasks) {
    if (!t.taskId.startsWith("D-")) continue
    const base = t.taskId.replace(/-W\d+$/, "")
    if (!groups[base]) groups[base] = { parent: base, workers: [], topic: "" }
    groups[base].workers.push(t)
  }
  for (const g of Object.values(groups)) {
    const raw = g.workers[0]?.title || g.parent
    const m = raw.match(/[|｜]\s*(.+)/)
    g.topic = m ? m[1] : raw.replace(/^D-/, "").replace(/-W\d+$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
  }
  return groups
}

function calcSentiment(text: string): number {
  if (!text) return 50
  const bull = (text.match(/bullish|LONG|看涨|做多|上涨|利好/gi) || []).length
  const bear = (text.match(/bearish|SHORT|看跌|做空|下跌|利空/gi) || []).length
  if (bull + bear === 0) return 50
  return Math.round((bull / (bull + bear)) * 100)
}

/**
 * parseKeyPoints — 提取结构化论点
 * 从 Agent 结果中识别：
 *   - "关键论点 / Key Points / 论点 / Arguments" 等章节
 *   - 编号列表 (1. / ① / (1))
 *   - 带 -/* 的无序列表
 */
function parseKeyPoints(text: string): string[] {
  if (!text) return []
  const points: string[] = []

  // 1) 提取章节标题下的内容
  const sectionPatterns = [
    /(?:关键论点|Key\s*[Pp]oints|论点|Arguments|论据)[：:]\s*([\s\S]*?)(?=\n(?:CONCLUSION|结论|Summary|综合判断|最终观点|##)|$)/i,
    /(?:##\s*)?(?:关键论点|Key\s*Points|论点)\s*\n+([\s\S]*?)(?=\n(?:##|结论|CONCLUSION)|$)/i,
  ]
  for (const pat of sectionPatterns) {
    const m = text.match(pat)
    if (m) {
      const content = m[1].trim()
      const items = content.split(/\n/).filter(line => {
        const tr = line.trim()
        return tr && (tr.match(/^\d+[.、\)]/) || tr.match(/^[①-⑩]/) || tr.match(/^[\(\[]\d+[\)\]]/) || tr.startsWith("- ") || tr.startsWith("* "))
      }).map(line => line.replace(/^\s*\d+[.、\)]\s*/, "").replace(/^[-*]\s*/, "").replace(/^[①-⑩]\s*/, "").trim())
      if (items.length > 0) {
        points.push(...items)
      } else {
        // 如果没有列表结构，尝试按句号分割
        const sentences = content.split(/[。；\n]/).filter(s => s.trim().length > 10).map(s => s.trim())
        if (sentences.length > 0) points.push(...sentences.slice(0, 5))
      }
    }
  }

  // 2) 全局提取编号列表作为降级方案
  if (points.length === 0) {
    const numberedItems = text.match(/^\d+[.、].+$/gm)
    if (numberedItems) {
      points.push(...numberedItems.map(s => s.replace(/^\d+[.、]\s*/, "").trim()))
    }
  }

  return points.slice(0, 10)
}

/**
 * extractTableRows — 识别 Markdown 表格行
 * 匹配以 | 开头和结尾且包含多个 | 的行
 */
function extractTableRows(text: string): string[][] {
  if (!text) return []
  const rows: string[][] = []
  const lines = text.split('\n')
  let inTable = false
  for (const line of lines) {
    const tr = line.trim()
    if (tr.startsWith('|') && tr.endsWith('|')) {
      const cells = tr.split('|').filter((c, i, arr) => {
        // 跳过空的首尾，保留中间空单元格
        return arr.length > 2 ? true : c.trim()
      }).map(c => c.trim())
      // 过滤分隔行 (|---|)
      if (cells.some(c => c.includes('---'))) continue
      if (cells.length >= 2) {
        rows.push(cells)
        inTable = true
      }
    } else {
      inTable = false
    }
  }
  return rows
}

/**
 * extractConclusion — 提取结论/综合判断
 * 匹配: CONCLUSION / 结论 / Summary / 综合判断 / 最终观点
 */
function extractConclusion(text: string): string {
  if (!text) return ''
  const patterns = [
    /(?:CONCLUSION|结论|Summary|综合判断|最终观点)[：:]\s*([\s\S]*?)(?=\n(?:##|$))/i,
    /(?:##\s*)?(?:结论|CONCLUSION|总结|综合)\s*\n+([\s\S]*?)(?=\n##|$)/i,
  ]
  for (const pat of patterns) {
    const m = text.match(pat)
    if (m) {
      const raw = m[1].trim()
      // 截取到下一个章节或结尾
      const cutoff = raw.search(/\n(?=##|Key\s*Points|论点|———|---|___|$)/)
      return cutoff > 0 ? raw.slice(0, cutoff).trim().slice(0, 500) : raw.slice(0, 500)
    }
  }
  return ''
}

export function DebatePanel({ tasks }: { tasks: Task[] }) {
  const groups = useMemo(() => Object.values(buildDebateGroups(tasks)), [tasks])
  const [detail, setDetail] = useState<DebateGroup | null>(null)

  if (detail) return <DebateDetail group={detail} onBack={() => setDetail(null)} />

  if (!groups.length) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">暂无辩论。创建 D- 前缀的多 Agent 辩论任务后，辩论将在此显示。</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-fade-in">
      {groups.map(g => {
        const done = g.workers.filter(w => w.status === "done" || w.status === "reviewed").length
        const sentiments = g.workers.map(w => calcSentiment(w.result || ""))
        const avg = sentiments.reduce((a, b) => a + b, 0) / sentiments.length
        const agreement = Math.max(0, 100 - Math.max(...sentiments.map(s => Math.abs(s - avg))) * 2)
        const stanceCls = avg > 60 ? "bullish" : avg < 40 ? "bearish" : "neutral"
        const statusCls = done === g.workers.length ? "done" : "running"

        return (
          <Card
            key={g.parent}
            className={cn(
              "cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-1 overflow-hidden",
              stanceCls === "bullish" && "border-l-2 border-l-emerald-500",
              stanceCls === "bearish" && "border-l-2 border-l-red-500",
              stanceCls === "neutral" && "border-l-2 border-l-indigo-400"
            )}
            onClick={() => setDetail(g)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{g.topic.slice(0, 80)}</CardTitle>
              <div className="flex gap-3 text-[11px] text-muted-foreground">
                <Badge variant={statusCls === "done" ? "success" : "warning"} className="text-[9px]">
                  {statusCls === "done" ? "已完成" : "进行中"}
                </Badge>
                <span>{g.workers.length} Agent</span>
                <span>{done}/{g.workers.length} 完成</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Sentiment spectrum */}
              <div className="h-2 rounded-full bg-gradient-to-r from-red-500 via-amber-500 via-zinc-400 via-indigo-500 to-emerald-500 relative">
                <div className="absolute -top-1.5 w-5 h-5 rounded-full bg-white border-2 border-indigo-500 shadow-md transition-all duration-700"
                  style={{ left: `${avg}%`, transform: "translateX(-50%)" }} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xl font-bold font-mono text-indigo-600">{Math.round(agreement)}%</span>
                  <span className="text-[10px] text-muted-foreground ml-1">共识度</span>
                </div>
                <div className="flex -space-x-2">
                  {g.workers.map((_, i) => (
                    <Avatar key={i} className="h-6 w-6 border-2 border-background">
                      <AvatarFallback className="text-[9px]" style={{ background: i === 0 ? "#6366f1" : "#d97706", color: "#fff" }}>
                        #{i + 1}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function DebateDetail({ group, onBack }: { group: DebateGroup; onBack: () => void }) {
  const sentiments = group.workers.map(w => calcSentiment(w.result || ""))
  const avg = sentiments.reduce((a, b) => a + b, 0) / sentiments.length
  const stance = avg > 60 ? "🐂 偏多" : avg < 40 ? "🐻 偏空" : "➖ 中性"
  const agreement = Math.max(0, 100 - Math.max(...sentiments.map(s => Math.abs(s - avg))) * 2)

  // 提取所有论点和结论
  const allKeyPoints: KeyPoint[] = useMemo(() => {
    return group.workers.flatMap((w, i) => {
      const points = parseKeyPoints(w.result || "")
      return points.map(text => ({ agentIndex: i, text, sentiment: calcSentiment(w.result || "") }))
    })
  }, [group])

  const allTables: { agentIndex: number; rows: string[][] }[] = useMemo(() => {
    return group.workers.map((w, i) => ({
      agentIndex: i,
      rows: extractTableRows(w.result || ""),
    })).filter(t => t.rows.length > 0)
  }, [group])

  const conclusions: { agentIndex: number; text: string }[] = useMemo(() => {
    return group.workers.map((w, i) => ({
      agentIndex: i,
      text: extractConclusion(w.result || ""),
    })).filter(c => c.text.length > 0)
  }, [group])

  // 综合所有结论（如果有多个 Agent 的结论则合并）
  const combinedConclusion = useMemo(() => {
    if (conclusions.length === 0) return ''
    return conclusions.map(c => `[Agent #${c.agentIndex + 1}] ${c.text}`).join('\n\n')
  }, [conclusions])

  return (
    <div className="animate-fade-in space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-4 w-4" /> 返回辩论列表
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">{group.topic}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{group.workers.length} 个 Agent 参与</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold font-mono text-indigo-600">{Math.round(agreement)}%</div>
              <div className="text-[10px] text-muted-foreground">共识度</div>
            </div>
          </div>
          {/* Consensus strip */}
          <div className="flex items-center gap-3 mt-3">
            <span className="text-xs text-muted-foreground">🐻</span>
            <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 relative">
              <div className="absolute -top-1.5 w-4 h-4 rounded-full bg-white border-2 border-indigo-500 shadow-md"
                style={{ left: `${avg}%`, transform: "translateX(-50%)" }} />
            </div>
            <span className="text-xs text-muted-foreground">🐂</span>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-1">{stance} · 均分 {Math.round(avg)}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ── 综合结论框 ──────────────────────────────────── */}
          {combinedConclusion && (
            <div className="rounded-lg border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">综合结论</span>
                <Badge variant="secondary" className="text-[8px] ml-auto">
                  共识度 {Math.round(agreement)}%
                </Badge>
              </div>
              <div className="space-y-2">
                {conclusions.map(c => (
                  <div key={c.agentIndex} className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    <span className="font-semibold text-foreground">Agent #{c.agentIndex + 1}：</span>
                    {c.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 多空色谱对比 ────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              <TrendingDown className="h-3 w-3 text-red-500" />
              <span className="text-xs font-semibold">立场光谱</span>
            </div>
            <div className="space-y-1.5">
              {group.workers.map((w, i) => {
                const sent = calcSentiment(w.result || "")
                const barColor = sent > 60 ? "bg-emerald-500" : sent < 40 ? "bg-red-500" : "bg-indigo-400"
                const emoji = sent > 60 ? "🐂" : sent < 40 ? "🐻" : "➖"
                return (
                  <div key={w.taskId} className="flex items-center gap-2">
                    <span className="text-[10px] w-14 shrink-0 text-muted-foreground">Agent #{i + 1}</span>
                    <div className="flex-1 h-4 rounded-full bg-muted relative overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                        style={{ width: `${sent}%` }} />
                    </div>
                    <span className="text-[10px] w-10 text-right shrink-0">{emoji} {sent}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── 论点提取 ────────────────────────────────────── */}
          {allKeyPoints.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-3 w-3 text-amber-500" />
                <span className="text-xs font-semibold">关键论点（{allKeyPoints.length}）</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {allKeyPoints.map((kp, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                      kp.sentiment > 60 && "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20",
                      kp.sentiment < 40 && "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20",
                      kp.sentiment >= 40 && kp.sentiment <= 60 && "border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20"
                    )}
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <Badge variant="secondary" className="text-[8px]">
                        #{kp.agentIndex + 1}
                      </Badge>
                      <span className="text-[8px] text-muted-foreground">
                        {kp.sentiment > 60 ? "🐂 看多" : kp.sentiment < 40 ? "🐻 看空" : "➖ 中性"}
                      </span>
                    </div>
                    <span>{kp.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 表格行识别 ──────────────────────────────────── */}
          {allTables.map(t => (
            <div key={t.agentIndex}>
              <div className="flex items-center gap-2 mb-2">
                <Table className="h-3 w-3 text-indigo-500" />
                <span className="text-xs font-semibold">Agent #{t.agentIndex + 1} 数据表（{t.rows.length} 行）</span>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-[11px]">
                  <tbody>
                    {t.rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? "bg-muted/50 font-semibold" : "border-t border-border"}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1 whitespace-nowrap">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* ── 聊天流 ──────────────────────────────────────── */}
          <div>
            <span className="text-xs font-semibold block mb-2">完整对话</span>
            <div className="space-y-3 max-h-[40vh] overflow-y-auto">
              {group.workers.map((w, i) => {
                const sent = calcSentiment(w.result || "")
                const stanceEmoji = sent > 60 ? "🐂 看多" : sent < 40 ? "🐻 看空" : "➖ 中性"
                return (
                  <div key={w.taskId} className={cn("flex gap-3", i % 2 === 1 && "flex-row-reverse")}>
                    <Avatar className={cn("h-8 w-8 shrink-0", i % 2 === 1 && "bg-amber-500/20", i % 2 === 0 && "bg-indigo-500/20")}>
                      <AvatarFallback className="text-[10px] font-bold" style={{ background: i % 2 === 1 ? "#d97706" : "#6366f1", color: "#fff" }}>
                        #{i + 1}
                      </AvatarFallback>
                    </Avatar>
                    <div className={cn(
                      "rounded-lg px-3 py-2 max-w-[75%] text-sm",
                      i % 2 === 1 ? "bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800" : "bg-muted"
                    )}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-semibold text-primary">Agent #{i + 1}</span>
                        <Badge variant={sent > 60 ? "success" : sent < 40 ? "destructive" : "secondary"} className="text-[8px]">
                          {stanceEmoji}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground">{w.status}</span>
                      </div>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{w.result?.slice(0, 800) || "等待结果…"}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
