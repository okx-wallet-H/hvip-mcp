import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { DollarSign, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface CostsData {
  todayCost: number
  totalCost: number
  budget: number
  calls: number
}

export function CostsCard() {
  const [data, setData] = useState<CostsData | null>(null)

  useEffect(() => {
    const fetchCosts = async () => {
      try {
        const r = await fetch("/api/costs")
        if (r.ok) {
          const j = await r.json()
          setData({
            todayCost: j.today?.cost || 0,
            totalCost: j.total?.cost || 0,
            budget: j.budget || 5.0,
            calls: j.today?.calls || 0,
          })
        }
      } catch { /* API not ready */ }
    }
    fetchCosts()
    const t = setInterval(fetchCosts, 30000)
    return () => clearInterval(t)
  }, [])

  if (!data) return null

  const pct = data.budget > 0 ? (data.todayCost / data.budget) * 100 : 0
  const warn = pct > 80
  const danger = pct > 100

  return (
    <Card className={cn(
      "transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5",
    )}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          danger ? "bg-red-500/10 text-red-600" : warn ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600",
        )}>
          <DollarSign className="h-5 w-5" />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={cn(
            "text-2xl font-bold tracking-tight tabular-nums",
            danger && "text-red-600",
          )}>
            ${data.todayCost.toFixed(2)}
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">今日 LLM 成本</span>
          <span className="text-[10px] text-muted-foreground/60">
            {data.calls} 次调用 · 预算 ${data.budget.toFixed(0)}
            {danger && " ⚠️ 超预算"}
            {warn && !danger && ` · ${pct.toFixed(0)}%`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <TrendingUp className="h-3 w-3" />
          累计 ${data.totalCost.toFixed(2)}
        </div>
      </CardContent>
    </Card>
  )
}
