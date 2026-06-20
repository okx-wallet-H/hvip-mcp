import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Activity, Sword, Target, Shield, Zap, DollarSign, BarChart3, Clock, Crosshair, Flame } from "lucide-react"

interface TraderPosition {
  symbol: string; direction: "LONG" | "SHORT"; leverage: number
  entryPrice: number; currentPrice?: number; margin: number
  liquidationPrice: number; unrealizedPnl: number; unrealizedPnlPct: number
}

interface LeaderboardEntry {
  id: string; name: string; emoji: string
  capital: number; equity: number; totalPnl: number; totalPnlPct: number
  unrealizedPnl: number; tradeCount: number; winCount: number
  totalFees: number; totalFunding: number
  openPositions: number; positions: TraderPosition[]
}

interface RiskData {
  mode: string; maxOrderUsd: number; dailyLossLimit: number
}

// Trader personas (matches ai-trader.ts)
const PERSONAS: Record<string, { title: string; style: string; desc: string }> = {
  ares:    { title: "战神·激进型", style: "趋势跟随 高杠杆", desc: "追涨杀跌，信号确认就重仓，错了快速止损" },
  athena:  { title: "智慧女神·均衡型", style: "多指标确认 严格风控", desc: "等回调入场，中等杠杆，不追高" },
  hades:   { title: "冥王·逆向收割", style: "极端情绪反向操作", desc: "众人恐惧时贪婪，市场过度反应时反手" },
  apollo:  { title: "太阳神·保守型", style: "回调入场 耐心纪律", desc: "宁可不做，不可做错。等待最优入场点" },
}

export function TraderArena() {
  const [traders, setTraders] = useState<LeaderboardEntry[]>([])
  const [risk, setRisk] = useState<RiskData | null>(null)
  const [round, setRound] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    try {
      const lb = await fetch("/api/traders/leaderboard").then(r => r.json()).catch(() => [])
      setTraders(lb)
      const rk = await fetch("/api/traders/risk").then(r => r.json()).catch(() => null)
      setRisk(rk)
      // Get round from state
      try {
        const st = await fetch("/api/traders").then(r => r.json())
        setRound(st.round || 0)
      } catch {}
    } catch {}
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 8000)
    return () => clearInterval(timer)
  }, [])

  // ── Aggregate Stats ──
  const totalEquity = traders.reduce((s, t) => s + t.equity, 0)
  const totalPnl = traders.reduce((s, t) => s + t.totalPnl, 0)
  const activePositions = traders.reduce((s, t) => s + t.openPositions, 0)
  const totalTrades = traders.reduce((s, t) => s + t.tradeCount, 0)
  const avgWinRate = traders.filter(t => t.tradeCount > 0).length > 0
    ? traders.filter(t => t.tradeCount > 0).reduce((s, t) => s + (t.winCount / Math.max(1, t.tradeCount)), 0) / Math.max(1, traders.filter(t => t.tradeCount > 0).length)
    : 0
  const totalFees = traders.reduce((s, t) => s + t.totalFees, 0)

  if (!traders.length) {
    return (
      <div className="animate-fade-in flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <Sword className="h-16 w-16 text-muted-foreground/20 mx-auto" />
          <p className="text-sm text-muted-foreground">交易员竞技场等待首次信号...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* ═══ Hero Header ═══ */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Card className="bg-gradient-to-br from-blue-500/5 to-blue-500/10 border-blue-500/20">
          <CardContent className="p-3 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-blue-500" />
            <div>
              <div className="text-lg font-bold font-mono">${totalEquity.toFixed(0)}</div>
              <div className="text-[10px] text-muted-foreground">总权益</div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn("bg-gradient-to-br border", totalPnl >= 0
          ? "from-emerald-500/5 to-emerald-500/10 border-emerald-500/20"
          : "from-red-500/5 to-red-500/10 border-red-500/20")}>
          <CardContent className="p-3 flex items-center gap-2">
            <Activity className={cn("h-5 w-5", totalPnl >= 0 ? "text-emerald-500" : "text-red-500")} />
            <div>
              <div className={cn("text-lg font-bold font-mono", totalPnl >= 0 ? "text-emerald-600" : "text-red-600")}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(0)}
              </div>
              <div className="text-[10px] text-muted-foreground">总盈亏 USD</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-500" />
            <div>
              <div className="text-lg font-bold">{activePositions}</div>
              <div className="text-[10px] text-muted-foreground">活跃仓位</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-amber-500" />
            <div>
              <div className="text-lg font-bold">{totalTrades}</div>
              <div className="text-[10px] text-muted-foreground">总交易</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-emerald-500" />
            <div>
              <div className="text-lg font-bold">{(avgWinRate * 100).toFixed(0)}%</div>
              <div className="text-[10px] text-muted-foreground">胜率</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ Mode + Risk Bar ═══ */}
      {risk && (
        <div className="flex items-center gap-3 px-1 text-[11px]">
          <Badge variant={risk.mode === "live" ? "destructive" : risk.mode === "demo" ? "default" : "secondary"} className="text-[10px] font-semibold">
            {risk.mode === "live" ? "🔴 实盘" : risk.mode === "demo" ? "🟠 OKX模拟交易" : "🟢 本地模拟"}
          </Badge>
          {risk.mode !== "simulate" && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Shield className="h-3 w-3" /> 单笔≤${risk.maxOrderUsd} | 日亏损≤${risk.dailyLossLimit}
            </span>
          )}
          <span className="text-muted-foreground/50 ml-auto flex items-center gap-1">
            <Clock className="h-3 w-3" /> Round {round}
          </span>
          <span className="text-muted-foreground/50 flex items-center gap-1">
            <Flame className="h-3 w-3" /> 手续费 ${totalFees.toFixed(1)}
          </span>
        </div>
      )}

      {/* ═══ Trader Cards ═══ */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {traders.map((t) => {
          const isExpanded = expanded === t.id
          const persona = PERSONAS[t.id] || { title: "", style: "", desc: "" }
          const pnlColor = t.totalPnl >= 0 ? "text-emerald-600" : "text-red-600"
          const pnlBg = t.totalPnl >= 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
          const winRate = t.tradeCount > 0 ? Math.round(t.winCount / t.tradeCount * 100) : 0

          return (
            <Card
              key={t.id}
              className={cn(
                "cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1",
                isExpanded && "ring-2 ring-primary shadow-lg",
                t.openPositions > 0 ? "border-l-4 border-l-amber-500" : ""
              )}
              onClick={() => setExpanded(isExpanded ? null : t.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{t.emoji}</span>
                    <div>
                      <CardTitle className="text-sm font-bold">{t.name}</CardTitle>
                      <p className="text-[9px] text-muted-foreground leading-tight">{persona.title}</p>
                    </div>
                  </div>
                  <Badge variant={t.totalPnl >= 0 ? "success" : "destructive"} className="text-[10px] font-mono font-bold">
                    {t.totalPnl >= 0 ? "+" : ""}{t.totalPnlPct.toFixed(2)}%
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-2">
                {/* Equity bar */}
                <div>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-muted-foreground">权益</span>
                    <span className="font-mono font-semibold">${t.equity.toFixed(0)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", t.totalPnl >= 0 ? "bg-emerald-500" : "bg-red-500")}
                      style={{ width: `${Math.min(100, Math.abs(t.totalPnlPct) * 2)}%` }}
                    />
                  </div>
                </div>

                {/* Key Stats Row */}
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="bg-muted/50 rounded p-1">
                    <div className="text-[10px] text-muted-foreground">胜率</div>
                    <div className="text-xs font-bold font-mono">{winRate}%</div>
                  </div>
                  <div className="bg-muted/50 rounded p-1">
                    <div className="text-[10px] text-muted-foreground">盈亏</div>
                    <div className={cn("text-xs font-bold font-mono", pnlColor)}>
                      {t.totalPnl >= 0 ? "+" : ""}{t.totalPnl.toFixed(0)}
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded p-1">
                    <div className="text-[10px] text-muted-foreground">交易</div>
                    <div className="text-xs font-bold font-mono">{t.tradeCount}</div>
                  </div>
                </div>

                {/* Open Positions */}
                {t.positions.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-border">
                    {t.positions.map((p, j) => (
                      <div key={j} className={cn(
                        "rounded p-2 text-[10px]",
                        p.unrealizedPnl >= 0 ? "bg-emerald-500/5" : "bg-red-500/5"
                      )}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge variant={p.direction === "LONG" ? "success" : "destructive"} className="text-[8px] px-1 py-0 font-bold">
                            {p.direction}
                          </Badge>
                          <span className="font-semibold">{p.symbol}</span>
                          <span className="text-muted-foreground">{p.leverage}x</span>
                          <span className="ml-auto font-mono text-muted-foreground">
                            @ ${p.entryPrice.toFixed(1)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", p.unrealizedPnl >= 0 ? "bg-emerald-500" : "bg-red-500")}
                                style={{ width: `${Math.min(100, Math.abs(p.unrealizedPnlPct) * 3 + 20)}%` }}
                              />
                            </div>
                          </div>
                          <span className={cn("ml-2 font-mono font-bold", p.unrealizedPnl >= 0 ? "text-emerald-600" : "text-red-600")}>
                            {p.unrealizedPnl >= 0 ? "+" : ""}{p.unrealizedPnl.toFixed(1)}
                            <span className="text-muted-foreground font-normal ml-0.5">({p.unrealizedPnlPct >= 0 ? "+" : ""}{p.unrealizedPnlPct.toFixed(2)}%)</span>
                          </span>
                        </div>
                        <div className="flex justify-between text-[8px] text-muted-foreground/60 mt-0.5">
                          <span>保证金 ${p.margin.toFixed(0)}</span>
                          <span>强平 ${p.liquidationPrice.toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="pt-2 border-t border-border space-y-1.5 animate-slide-up">
                    <p className="text-[10px] text-muted-foreground italic">"{persona.desc}"</p>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <div className="flex justify-between bg-muted/30 rounded px-1.5 py-0.5">
                        <span className="text-muted-foreground">手续费</span>
                        <span className="font-mono">${t.totalFees.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between bg-muted/30 rounded px-1.5 py-0.5">
                        <span className="text-muted-foreground">资金费</span>
                        <span className="font-mono">${t.totalFunding.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between bg-muted/30 rounded px-1.5 py-0.5">
                        <span className="text-muted-foreground">余额</span>
                        <span className="font-mono">${t.capital.toFixed(0)}</span>
                      </div>
                      <div className="flex justify-between bg-muted/30 rounded px-1.5 py-0.5">
                        <span className="text-muted-foreground">未实现</span>
                        <span className={cn("font-mono", t.unrealizedPnl >= 0 ? "text-emerald-600" : "text-red-600")}>
                          {t.unrealizedPnl >= 0 ? "+" : ""}{t.unrealizedPnl.toFixed(1)}
                        </span>
                      </div>
                    </div>
                    {/* Mini equity label */}
                    <div className="text-[9px] text-muted-foreground/50 text-center pt-0.5">
                      {t.tradeCount > 0
                        ? `每笔均盈亏 $${(t.totalPnl / t.tradeCount).toFixed(0)} · 胜率 ${winRate}%`
                        : "等待首笔交易"}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ═══ Footer summary ═══ */}
      <div className="text-center text-[10px] text-muted-foreground/40">
        AI Trader 模拟盘 · {traders.length} 位交易员 · 每1h决策 · 数据仅供参考
      </div>
    </div>
  )
}
