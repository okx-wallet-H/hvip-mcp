import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Task } from "@/hooks/use-api"

interface TaskListProps {
  tasks: Task[]
  onSpawn: (taskId: string) => Promise<boolean>
}

const STATUS_MAP: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "default" }> = {
  unassigned: { label: "待分配", variant: "secondary" },
  assigned: { label: "执行中", variant: "warning" },
  done: { label: "已完成", variant: "success" },
  reviewed: { label: "已审核", variant: "default" },
}

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "unassigned", label: "待分配" },
  { key: "assigned", label: "进行中" },
  { key: "done", label: "已完成" },
  { key: "reviewed", label: "已审核" },
]

const PAGE_SIZE = 15

export function TaskList({ tasks, onSpawn }: TaskListProps) {
  const [filter, setFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = filter === "all" ? tasks : tasks.filter(t => t.status === filter)
  const total = filtered.length
  const pages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(1, pages))
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // Calculate pipeline stats
  const pipeline = {
    unassigned: tasks.filter(t => t.status === "unassigned").length,
    assigned: tasks.filter(t => t.status === "assigned").length,
    done: tasks.filter(t => t.status === "done").length,
    reviewed: tasks.filter(t => t.status === "reviewed").length,
  }
  const pipelineTotal = tasks.length || 1

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          任务队列
          <Badge variant="secondary" className="text-[10px]">{tasks.length}</Badge>
        </CardTitle>
        <div className="flex gap-1 pt-1">
          {FILTERS.map(f => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "ghost"}
              size="xs"
              onClick={() => { setFilter(f.key); setPage(1) }}
              className="text-[10px] h-6 px-2"
            >
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 max-h-[420px] overflow-y-auto">
        {!pageItems.length ? (
          <p className="text-[12px] text-muted-foreground text-center py-6">暂无任务</p>
        ) : (
          pageItems.map(t => {
            const isOpen = expanded.has(t.taskId)
            const st = STATUS_MAP[t.status] || STATUS_MAP.unassigned
            return (
              <div
                key={t.taskId}
                className={cn(
                  "rounded-md transition-all duration-200",
                  isOpen && "bg-accent/50"
                )}
              >
                <div
                  className="flex items-center gap-3 p-2 cursor-pointer hover:bg-accent/30 rounded-md"
                  onClick={() => toggleExpand(t.taskId)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold font-mono text-primary">{t.taskId}</p>
                    <p className="text-[12px] text-foreground truncate">{t.title || t.taskId}</p>
                  </div>
                  <Badge variant={st.variant} className="text-[9px] shrink-0">{st.label}</Badge>
                  {t.status === "unassigned" && (
                    <Button
                      size="xs"
                      className="text-[10px] h-6 shrink-0"
                      onClick={(e) => { e.stopPropagation(); onSpawn(t.taskId) }}
                    >
                      启动
                    </Button>
                  )}
                </div>
                {isOpen && (
                  <div className="px-2 pb-2 pt-0 animate-slide-up">
                    {t.result ? (
                      <pre className="text-[11px] font-mono p-2 bg-muted/50 rounded-md max-h-[160px] overflow-y-auto whitespace-pre-wrap">
                        {t.result}
                      </pre>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">暂无结果</p>
                    )}
                    {t.branch && (
                      <p className="text-[10px] mt-1">
                        <span className="text-muted-foreground">branch:</span>{" "}
                        <code className="text-[10px]">{t.branch}</code>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-1 pt-3 pb-1">
            <Button size="xs" variant="ghost" className="text-[10px] h-6" disabled={currentPage <= 1} onClick={() => setPage(1)}>«</Button>
            <Button size="xs" variant="ghost" className="text-[10px] h-6" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</Button>
            <span className="text-[10px] text-muted-foreground px-2">{currentPage} / {pages}</span>
            <Button size="xs" variant="ghost" className="text-[10px] h-6" disabled={currentPage >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>›</Button>
            <Button size="xs" variant="ghost" className="text-[10px] h-6" disabled={currentPage >= pages} onClick={() => setPage(pages)}>»</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
