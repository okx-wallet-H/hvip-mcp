import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

interface CircuitData {
  circuits: Array<{ name: string; state: string; failures: number }>
  openCount: number
  healthy: boolean
}

export function CircuitsCard() {
  const [data, setData] = useState<CircuitData | null>(null)

  useEffect(() => {
    const fetchCircuits = async () => {
      try {
        const r = await fetch("/api/circuits")
        if (r.ok) {
          const j = await r.json()
          setData(j)
        }
      } catch { /* API not ready */ }
    }
    fetchCircuits()
    const t = setInterval(fetchCircuits, 15000)
    return () => clearInterval(t)
  }, [])

  if (!data) return null

  const openCircuits = data.circuits.filter(c => c.state === "OPEN")

  return (
    <Card className={cn(
      "transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5",
      !data.healthy && "border-red-500/50",
    )}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          data.healthy ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600",
        )}>
          {data.healthy ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={cn(
            "text-2xl font-bold tracking-tight tabular-nums",
            !data.healthy && "text-red-600",
          )}>
            {data.openCount}
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">
            {data.healthy ? "熔断器健康" : "熔断器开路"}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {data.circuits.length > 0
              ? `${data.circuits.length} 个监控中`
              : "全部 CLOSED"}
            {openCircuits.length > 0 && ` · ${openCircuits.map(c => c.name).join(", ")} 开路`}
          </span>
        </div>
        <div className="ml-auto flex items-center">
          <div className={cn(
            "h-2 w-2 rounded-full",
            data.healthy ? "bg-emerald-500 animate-pulse" : "bg-red-500",
          )} />
        </div>
      </CardContent>
    </Card>
  )
}
