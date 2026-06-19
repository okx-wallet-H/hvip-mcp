import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { LayoutDashboard, CheckCircle2, Zap, Users } from "lucide-react"
import type { Agent, Task } from "@/hooks/use-api"

interface KPICardsProps {
  agents: Agent[]
  tasks: Task[]
}

export function KPICards({ agents, tasks }: KPICardsProps) {
  const working = agents.filter(a => a.status === "working").length
  const idle = agents.filter(a => a.status === "idle").length
  const done = tasks.filter(t => t.status === "done" || t.status === "reviewed").length
  const active = tasks.filter(t => t.status === "assigned").length
  const debates = tasks.filter(t => t.taskId.startsWith("D-")).length
  const total = agents.length

  const items = [
    { icon: Users, color: "bg-emerald-500/10 text-emerald-600", value: `${working} / ${total}`, label: "在线 Agent", subtitle: `${idle} 空闲` },
    { icon: Zap, color: "bg-amber-500/10 text-amber-600", value: active.toString(), label: "进行中任务", subtitle: `${done} 已完成` },
    { icon: CheckCircle2, color: "bg-indigo-500/10 text-indigo-600", value: done.toString(), label: "审核通过", subtitle: `共 ${tasks.length} 个任务` },
    { icon: LayoutDashboard, color: "bg-purple-500/10 text-purple-600", value: debates.toString(), label: "AI 辩论", subtitle: "多 Agent 协作" },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <Card
          key={i}
          className="transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 animate-slide-up"
          style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
        >
          <CardContent className="p-4 flex items-start gap-3">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", item.color)}>
              <item.icon className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-bold tracking-tight tabular-nums">{item.value}</span>
              <span className="text-[11px] font-medium text-muted-foreground">{item.label}</span>
              <span className="text-[10px] text-muted-foreground/60">{item.subtitle}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
