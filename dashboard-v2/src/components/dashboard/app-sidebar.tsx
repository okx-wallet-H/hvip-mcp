import { useSidebar } from "@/hooks/use-sidebar"
import { useEffect, useState } from "react"
import {
  LayoutDashboard, ListTodo, Users, Terminal, Scale, BarChart3, Store, Brain,
  ChevronLeft, Zap, Swords, RadioTower, type LucideIcon
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useApi } from "@/hooks/use-api"
import { ThemeToggle } from "./theme-toggle"

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
}

const MAIN_NAV: NavItem[] = [
  { id: "dashboard", label: "工作台", icon: LayoutDashboard, shortcut: "1" },
  { id: "tasks", label: "任务", icon: ListTodo, shortcut: "2" },
  { id: "agents", label: "AI 值守", icon: Users, shortcut: "3" },
  { id: "signal-square", label: "信号广场", icon: RadioTower, shortcut: "4" },
  { id: "arena", label: "交易员竞技场", icon: Swords, shortcut: "5" },
]

const MONITOR_NAV: NavItem[] = [
  { id: "terminal", label: "终端", icon: Terminal, shortcut: "0" },
  { id: "debate", label: "辩论厅", icon: Scale, shortcut: "6" },
  { id: "signals", label: "信号中心", icon: BarChart3, shortcut: "7" },
]

const EXTRA_NAV: NavItem[] = [
  { id: "store", label: "插件商店", icon: Store, shortcut: "8" },
  { id: "memory", label: "记忆库", icon: Brain, shortcut: "9" },
]

export function AppSidebar({ activePanel, onNavigate }: {
  activePanel: string
  onNavigate: (id: string) => void
}) {
  const { state, toggleSidebar } = useSidebar()
  const { agents, tasks, version } = useApi()
  const [stats, setStats] = useState({ memory: 0, plugins: 24 })

  const collapsed = state === "collapsed"

  const NavSection = ({ items, label }: { items: NavItem[]; label?: string }) => (
    <div className="px-2 py-1">
      {label && !collapsed && (
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {items.map(item => (
          <Tooltip key={item.id} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium transition-all duration-200",
                  activePanel === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.shortcut && (
                      <kbd className="hidden lg:inline-flex h-5 items-center gap-0.5 rounded border border-sidebar-border bg-sidebar-accent/50 px-1.5 font-mono text-[10px] font-medium text-sidebar-foreground/50">
                        ⌘{item.shortcut}
                      </kbd>
                    )}
                  </>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                {item.label} {item.shortcut && <kbd className="ml-1 text-[9px] opacity-60">⌘{item.shortcut}</kbd>}
              </TooltipContent>
            )}
          </Tooltip>
        ))}
      </div>
    </div>
  )

  return (
    <aside
      data-state={state}
      className={cn(
        "flex flex-col border-r border-sidebar-border bg-sidebar-background transition-all duration-300 ease-in-out",
        collapsed ? "w-[--sidebar-width-icon]" : "w-[--sidebar-width]"
      )}
    >
      {/* Brand */}
      <div className={cn("flex items-center gap-2 px-3 py-4", collapsed && "justify-center")}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-sidebar-foreground">Agent Hub</h2>
            <p className="text-[10px] text-sidebar-foreground/50">v{version} · 工作台</p>
          </div>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 py-2">
          <NavSection items={MAIN_NAV} label="核心" />
          <NavSection items={MONITOR_NAV} label="监控" />
          <NavSection items={EXTRA_NAV} label="工具" />
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        {!collapsed && (
          <div className="mb-2 flex flex-col gap-1 px-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-sidebar-foreground/60">Agents</span>
              <span className="font-mono font-medium text-sidebar-foreground">{agents.length}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-sidebar-foreground/60">Tasks</span>
              <span className="font-mono font-medium text-sidebar-foreground">{tasks.length}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-sidebar-foreground/50">Live</span>
            </div>
          </div>
        )}
        <div className={cn("flex items-center", collapsed ? "justify-center flex-col gap-1" : "justify-between")}>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-8 w-8 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground"
            aria-label="Toggle sidebar"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform duration-300", collapsed && "rotate-180")} />
          </Button>
        </div>
      </div>
    </aside>
  )
}
