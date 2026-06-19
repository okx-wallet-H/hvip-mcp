import { useState } from "react"
import { SidebarProvider, useSidebar } from "@/hooks/use-sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { KPICards } from "@/components/dashboard/kpi-cards"
import { AgentList } from "@/components/dashboard/agent-list"
import { TaskList } from "@/components/dashboard/task-list"
import { LiveTerminal } from "@/components/dashboard/live-terminal"
import { DebatePanel } from "@/components/dashboard/debate-panel"
import { SignalsPanel } from "@/components/dashboard/signals-panel"
import { MemoryPanel } from "@/components/dashboard/memory-panel"
import { StorePanel } from "@/components/dashboard/store-panel"
import { TraderArena } from "@/components/dashboard/trader-arena"
import { SignalSquare } from "@/components/dashboard/signal-square"
import { CostsCard } from "@/components/dashboard/costs-card"
import { CircuitsCard } from "@/components/dashboard/circuits-card"
import { useApi } from "@/hooks/use-api"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

const PANELS: Record<string, string> = {
  dashboard: "工作台",
  tasks: "任务队列",
  agents: "AI 值守",
  terminal: "实时终端",
  debate: "辩论厅",
  signals: "信号中心",
  arena: "交易员竞技场",
  "signal-square": "信号广场",
  store: "插件商店",
  memory: "记忆库",
}

function DashboardLayout() {
  const { state, isMobile } = useSidebar()
  const api = useApi()
  const [activePanel, setActivePanel] = useState("dashboard")
  const collapsed = state === "collapsed"

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar activePanel={activePanel} onNavigate={setActivePanel} />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — exactly like shadcn Blocks breadcrumb bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
          <Separator orientation="vertical" className="h-4" />
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            {PANELS[activePanel] || activePanel}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono">
              {api.lastRefresh.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              v{api.version}
            </span>
          </div>
        </header>

        {/* Panel content with scrolling */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {activePanel === "dashboard" && (
            <div className="animate-fade-in space-y-4">
              <KPICards agents={api.agents} tasks={api.tasks} />
              <div className="grid gap-3 md:grid-cols-2">
                <CostsCard />
                <CircuitsCard />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <AgentList agents={api.agents} />
                <TaskList tasks={api.tasks} onSpawn={api.spawnWorker} />
              </div>
            </div>
          )}

          {activePanel === "tasks" && (
            <div className="animate-fade-in max-w-4xl mx-auto">
              <TaskList tasks={api.tasks} onSpawn={api.spawnWorker} />
            </div>
          )}

          {activePanel === "agents" && (
            <div className="animate-fade-in max-w-4xl mx-auto space-y-4">
              <AgentList agents={api.agents} />
              {/* Guardian cards would go here */}
              <p className="text-[12px] text-muted-foreground text-center">11 岗 AI 值守 — 希腊神话主题人设</p>
            </div>
          )}

          {activePanel === "arena" && (
            <div className="animate-fade-in">
              <TraderArena />
            </div>
          )}

          {activePanel === "terminal" && (
            <div className="animate-fade-in h-full flex flex-col">
              <LiveTerminal />
            </div>
          )}

          {activePanel === "debate" && (
            <div className="animate-fade-in">
              <DebatePanel tasks={api.tasks} />
            </div>
          )}

          {activePanel === "signal-square" && (
            <div className="animate-fade-in">
              <SignalSquare />
            </div>
          )}

          {activePanel === "signals" && (
            <div className="animate-fade-in">
              <SignalsPanel tasks={api.tasks} />
            </div>
          )}

          {activePanel === "store" && (
            <div className="animate-fade-in">
              <StorePanel />
            </div>
          )}

          {activePanel === "memory" && (
            <div className="animate-fade-in">
              <MemoryPanel />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <SidebarProvider defaultOpen={true}>
      <TooltipProvider delayDuration={300}>
        <DashboardLayout />
      </TooltipProvider>
    </SidebarProvider>
  )
}
