import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus, Target, Shield, Activity, Zap, Clock, Star, Users } from "lucide-react"

interface SignalData {
  id: string
  symbol: string
  timeframe: string
  direction: string
  confidence: number
  price: number
  grade: string
  qualityScore: number
  qualifiedCount: number
  cautionedCount: number
  testedCount: number
  reason: string
  multiTf: {
    agreement: string
    secondary: Record<string, { signal: string; confidence: number }>
  }
  risk: {
    atr_14: number
    sl_price: number
    tp_price: number
    sl_distance: number
    tp_distance: number
    risk_reward_ratio: number
    suggested_position_pct: number
    risk_per_trade_pct: number
  } | null
  ensemble: {
    avgSharpe: number
    avgWinRate: number
    avgTrades: number
    breakdown: Record<string, number>
    agreement: string
  }
  topStrategy: string
  createdAt: string
  expiresAt: string
  followers: number
}

interface SignalStore {
  signals: SignalData[]
  lastRun: string | null
}

// AI Trader names who might follow
const TRADER_NAMES = ["Ares", "Athena", "Hermes", "Hades", "Apollo", "Artemis", "Poseidon", "Dionysus"]

export function SignalSquare() {
  const [store, setStore] = useState<SignalStore>({ signals: [], lastRun: null })
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState("all") // all, A, B, C, LONG, SHORT, BTC, ETH, SOL

  useEffect(() => {
    const load = async () => {
      const r = await fetch("/api/signals").catch(() => null)
      if (r?.ok) setStore(await r.json())
    }
    load()
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  }, [])

  const filtered = store.signals.filter(s => {
    if (filter === "LONG" || filter === "SHORT") return s.direction === filter
    if (filter === "A" || filter === "B" || filter === "C") return s.grade === filter
    if (filter === "BTC" || filter === "ETH" || filter === "SOL") return s.symbol?.startsWith(filter)
    return true
  }).sort((a, b) => b.qualityScore - a.qualityScore)

  const gradeColors: Record<string, string> = {
    A: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    B: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    C: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  }

  const activeCount = filtered.length
  const aCount = filtered.filter(s => s.grade === "A").length
  const longCount = filtered.filter(s => s.direction === "LONG").length
  const shortCount = filtered.filter(s => s.direction === "SHORT").length

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
          {["all", "A", "B", "C", "LONG", "SHORT", "BTC", "ETH", "SOL"].map(f => (
            <Button
              key={f}
              variant={filter === f ? "default" : "ghost"}
              size="xs"
              onClick={() => setFilter(f)}
              className="text-[10px] h-6"
            >
              {f === "all" ? "全部" : f}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3" /> {activeCount} 活跃
          </span>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Star className="h-3 w-3 text-emerald-500" /> {aCount} A-grade
          </span>
          <span className="text-[10px] text-muted-foreground">
            {longCount}L / {shortCount}S
          </span>
          {store.lastRun && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(store.lastRun).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* Signal cards */}
      {!filtered.length ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2">信号广场暂无信号</p>
            <p className="text-xs text-muted-foreground/60">
              Quanta 每 4h 运行 VBT 引擎产出信号。运行 <code className="text-[11px] bg-muted px-1 rounded">node scripts/signal-generator.mjs</code> 立即生成
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(s => {
            const up = s.direction === "LONG"
            const isSelected = selected === s.id
            const gradeCls = gradeColors[s.grade] || ""
            const expiresIn = Math.max(0, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 60000))

            return (
              <Card
                key={s.id}
                className={cn(
                  "cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 overflow-hidden",
                  isSelected && "ring-2 ring-primary",
                  up ? "border-l-2 border-l-emerald-500" : s.direction === "SHORT" ? "border-l-2 border-l-red-500" : ""
                )}
                onClick={() => setSelected(isSelected ? null : s.id)}
              >
                <CardHeader className="pb-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={up ? "success" : s.direction === "SHORT" ? "destructive" : "secondary"} className="text-[9px] gap-0.5">
                        {up ? <TrendingUp className="h-2.5 w-2.5" /> : s.direction === "SHORT" ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                        {s.direction}
                      </Badge>
                      <span className="text-xs font-semibold">{s.symbol}</span>
                      <span className="text-[10px] text-muted-foreground">{s.timeframe}</span>
                    </div>
                    <Badge className={cn("text-[9px] border", gradeCls)}>{s.grade}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">{s.id}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">exp {expiresIn}m</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">置信度</span>
                    <span className={cn("font-mono font-semibold",
                      s.confidence >= 70 ? "text-emerald-600" : s.confidence >= 40 ? "text-amber-600" : "text-red-600"
                    )}>{s.confidence}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">质量分</span>
                    <span className="font-mono">{s.qualityScore}/100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sharpe</span>
                    <span className={cn("font-mono", s.ensemble.avgSharpe >= 0.5 ? "text-emerald-600" : s.ensemble.avgSharpe >= 0 ? "text-amber-600" : "text-red-600")}>
                      {s.ensemble.avgSharpe.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">通过</span>
                    <span className="font-mono">{s.qualifiedCount}+{s.cautionedCount}/{s.testedCount}</span>
                  </div>
                  {/* Risk bar */}
                  {s.risk && (
                    <div className="flex items-center gap-2 pt-1 mt-1 border-t border-border">
                      <div className="flex-1">
                        <div className="flex justify-between text-[9px]">
                          <span className="text-red-500">SL {s.risk.sl_price.toFixed(1)}</span>
                          <span className="text-emerald-500">TP {s.risk.tp_price.toFixed(1)}</span>
                        </div>
                        <div className="h-1 bg-muted rounded-full mt-0.5 relative">
                          <div
                            className="absolute h-1 bg-primary rounded-full"
                            style={{
                              left: `${Math.min(100, Math.max(0, (s.price - (s.direction === "LONG" ? s.risk.sl_price : s.risk.tp_price)) /
                                Math.abs(s.risk.tp_price - s.risk.sl_price) * 100))}%`,
                              width: `${Math.abs(s.risk.tp_price - s.risk.sl_price) / s.price * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground">{s.risk.suggested_position_pct.toFixed(0)}%</span>
                    </div>
                  )}
                  {/* Multi-TF badge */}
                  {s.multiTf.agreement !== "neutral" && (
                    <Badge variant={s.multiTf.agreement === "confirmed" ? "success" : "warning"} className="text-[8px] mt-1">
                      {s.multiTf.agreement === "confirmed" ? "✓ multi-TF" : "⚠ cross-TF conflict"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Detail panel */}
      {selected && (() => {
        const s = filtered.find(x => x.id === selected)
        if (!s) return null
        return (
          <Card className="animate-slide-up">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Badge variant={s.direction === "LONG" ? "success" : "destructive"} className="text-[10px]">{s.direction}</Badge>
                {s.symbol} {s.timeframe}
                <Badge className={cn("text-[9px] border", gradeColors[s.grade])}>{s.grade} · {s.qualityScore}/100</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{s.id} · {s.reason}</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-[10px] text-muted-foreground">入场价</div>
                  <div className="text-sm font-bold font-mono">${s.price.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">止损价</div>
                  <div className="text-sm font-bold font-mono text-red-600">${s.risk?.sl_price.toFixed(1) || "--"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">止盈价</div>
                  <div className="text-sm font-bold font-mono text-emerald-600">${s.risk?.tp_price.toFixed(1) || "--"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">建议仓位</div>
                  <div className="text-sm font-bold font-mono">{s.risk?.suggested_position_pct.toFixed(0) || "--"}%</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Avg Sharpe:</span>{" "}
                  <span className="font-mono font-semibold">{s.ensemble.avgSharpe.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg 胜率:</span>{" "}
                  <span className="font-mono font-semibold">{s.ensemble.avgWinRate.toFixed(0)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Strategies 通过:</span>{" "}
                  <span className="font-mono font-semibold">{s.qualifiedCount}+{s.cautionedCount}/{s.testedCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">最佳策略:</span>{" "}
                  <span className="font-mono font-semibold">{s.topStrategy}</span>
                </div>
              </div>
              {/* Multi-TF */}
              {Object.keys(s.multiTf.secondary).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-[10px] text-muted-foreground">Multi-TF: </span>
                  {Object.entries(s.multiTf.secondary).map(([tf, info]) => (
                    <Badge key={tf} variant="outline" className="text-[9px] ml-1">
                      {tf}: {info.signal} ({info.confidence}%)
                    </Badge>
                  ))}
                  <Badge variant={s.multiTf.agreement === "confirmed" ? "success" : s.multiTf.agreement === "conflict" ? "destructive" : "secondary"} className="text-[9px] ml-1">
                    {s.multiTf.agreement}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}
    </div>
  )
}
