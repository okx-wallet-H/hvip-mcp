import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Search, Plus, Trash2, Copy, ChevronDown } from "lucide-react"

type MemoryType = "memory" | "doc" | "directive" | "skill" | "strategy"

interface MemoryEntry {
  id: string
  type: MemoryType
  text: string
  tags?: string  // comma-separated string from API
  createdAt?: string
  confidence?: number
  agentId?: string
}

function parseTags(tags?: string): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags
  return tags.split(",").map(t => t.trim()).filter(Boolean)
}

const TYPE_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "doc", label: "文档" },
  { key: "directive", label: "指令" },
  { key: "memory", label: "记忆" },
  { key: "skill", label: "技能" },
  { key: "strategy", label: "策略" },
] as const

const TYPE_COLORS: Record<string, string> = {
  doc: "bg-blue-500/10 text-blue-600",
  directive: "bg-amber-500/10 text-amber-600",
  memory: "bg-indigo-500/10 text-indigo-600",
  skill: "bg-emerald-500/10 text-emerald-600",
  strategy: "bg-purple-500/10 text-purple-600",
}

const TYPE_LABELS: Record<string, string> = {
  memory: "记忆",
  doc: "文档",
  directive: "指令",
  skill: "技能",
  strategy: "策略",
}

export function MemoryPanel() {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [typeFilter, setTypeFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [stats, setStats] = useState({ total: 0 })

  // ── 新建记忆表单状态 ──
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newType, setNewType] = useState<MemoryType>("memory")
  const [newText, setNewText] = useState("")
  const [newTags, setNewTags] = useState("")
  const [newConfidence, setNewConfidence] = useState(0.8)
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    // 支持 ?type= 服务器端过滤
    const url = typeFilter !== "all" ? `/api/memory?type=${typeFilter}` : "/api/memory"
    const r = await fetch(url).catch(() => null)
    if (r?.ok) setEntries(await r.json())
    const s = await fetch("/api/memory/stats").then(r => r?.json()).catch(() => null)
    if (s) setStats(s)
  }

  useEffect(() => { load() }, [typeFilter])

  const filtered = entries.filter(e => {
    if (search && !(e.text || "").toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const remove = async (id: string) => {
    await fetch(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" })
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  // ── 新建记忆提交 ──
  const handleCreate = async () => {
    if (!newText.trim()) return
    setSubmitting(true)
    try {
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          text: newText,
          agentId: "dashboard",
          tags: newTags,
          confidence: newConfidence,
        }),
      })
      if (r.ok) {
        setDialogOpen(false)
        setNewText("")
        setNewTags("")
        setNewConfidence(0.8)
        await load()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="animate-fade-in space-y-4 max-w-5xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {TYPE_OPTIONS.map(o => (
          <Button
            key={o.key}
            variant={typeFilter === o.key ? "default" : "ghost"}
            size="xs"
            onClick={() => setTypeFilter(o.key)}
            className="text-[10px] h-7"
          >
            {o.label}
          </Button>
        ))}
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索记忆…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs pl-7 w-48"
          />
        </div>
        <Badge variant="secondary" className="text-[10px]">{stats.total || entries.length} 条</Badge>

        {/* 新建记忆按钮 */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="xs" className="text-[10px] h-7 gap-1">
              <Plus className="h-3 w-3" />
              新建
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>新建记忆</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* 类型下拉 */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">类型</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(["memory", "doc", "directive", "skill", "strategy"] as MemoryType[]).map(t => (
                    <Button
                      key={t}
                      variant={newType === t ? "default" : "outline"}
                      size="xs"
                      onClick={() => setNewType(t)}
                      className="text-[10px] h-7"
                    >
                      {TYPE_LABELS[t] || t}
                    </Button>
                  ))}
                </div>
              </div>

              {/* 文本 */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">内容</label>
                <textarea
                  value={newText}
                  onChange={e => setNewText(e.target.value)}
                  placeholder="输入记忆内容…"
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {/* 标签 */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">标签（逗号分隔）</label>
                <Input
                  value={newTags}
                  onChange={e => setNewTags(e.target.value)}
                  placeholder="BTC, ETH, 行情"
                  className="h-7 text-xs"
                />
              </div>

              {/* 置信度滑块 */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  置信度: {Math.round(newConfidence * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newConfidence}
                  onChange={e => setNewConfidence(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-secondary cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                  <span>不确定</span>
                  <span>很确定</span>
                </div>
              </div>

              {/* 提交按钮 */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  className="text-xs"
                  disabled={!newText.trim() || submitting}
                  onClick={handleCreate}
                >
                  {submitting ? "提交中…" : "保存记忆"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!filtered.length ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground">
            {entries.length ? "无匹配" : "暂无记忆，点击右上角「新建」添加第一条"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const isOpen = expanded.has(e.id)
            return (
              <Card
                key={e.id}
                className={cn("transition-all duration-200 cursor-pointer", isOpen && "border-primary/30")}
                onClick={() => toggle(e.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <Badge className={cn("text-[9px] shrink-0 mt-0.5", TYPE_COLORS[e.type] || "")}>
                      {e.type}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground leading-relaxed">
                        {isOpen ? e.text : (e.text || "").slice(0, 200)}
                      </p>
                      {parseTags(e.tags).length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {parseTags(e.tags).map((t: string) => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      )}
                      {e.confidence != null && (
                        <div className="mt-1 text-[9px] text-muted-foreground">
                          置信度: {Math.round((e.confidence as number) * 100)}% · {e.agentId || "未知来源"}
                        </div>
                      )}
                    </div>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform mt-1", isOpen && "rotate-180")} />
                  </div>
                  {isOpen && (
                    <div className="flex gap-1 mt-2 pt-2 border-t border-border animate-slide-up">
                      <Button size="xs" variant="ghost" className="text-[10px] h-6" onClick={ev => { ev.stopPropagation(); navigator.clipboard.writeText(e.text) }}>
                        <Copy className="h-3 w-3 mr-1" />复制
                      </Button>
                      <Button size="xs" variant="ghost" className="text-[10px] h-6 text-destructive hover:text-destructive" onClick={ev => { ev.stopPropagation(); remove(e.id) }}>
                        <Trash2 className="h-3 w-3 mr-1" />删除
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
