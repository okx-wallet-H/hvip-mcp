import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { timeAgo } from "@/lib/utils"
import type { Agent } from "@/hooks/use-api"

interface AgentListProps {
  agents: Agent[]
}

export function AgentList({ agents }: AgentListProps) {
  const working = agents.filter(a => a.status === "working")
  const idle = agents.filter(a => a.status === "idle")

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          AI Agents
          <Badge variant="secondary" className="text-[10px]">{agents.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {working.length > 0 && (
          <div className="flex gap-2 flex-wrap pb-2 border-b border-border">
            {working.map(a => (
              <div key={a.agentId} className="flex-1 min-w-[140px] rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px] bg-amber-500/20 text-amber-600">
                      {(a.name || a.agentId).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] font-semibold text-foreground">{a.name || a.agentId}</span>
                </div>
                <Badge variant="warning" className="text-[9px]">执行中</Badge>
              </div>
            ))}
          </div>
        )}
        {idle.map(a => (
          <div key={a.agentId} className="flex items-center gap-3 py-1">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[10px] bg-emerald-500/20 text-emerald-600">
                {(a.name || a.agentId).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground">{a.name || a.agentId}</p>
              <p className="text-[10px] text-muted-foreground font-mono truncate">{a.agentId}</p>
            </div>
            <Badge variant="success" className="text-[9px]">idle</Badge>
            <span className="text-[10px] text-muted-foreground">{timeAgo(a.lastSeen)}</span>
          </div>
        ))}
        {!agents.length && (
          <p className="text-[12px] text-muted-foreground text-center py-4">等待 Agent 连接…</p>
        )}
      </CardContent>
    </Card>
  )
}
