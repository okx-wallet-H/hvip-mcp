import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Activity, Sword, Target, Shield, Zap } from "lucide-react"

interface TraderPosition {
  traderId: string
  symbol: string
  direction: "LONG" | "SHORT"
  leverage: number
  entryPrice: number
  currentPrice?: number
  tpPrice: number
  slPrice: number
  tpPct: number
  slPct: number
  unrealizedPnlPct?: number
  unrealizedPnl?: number
  closed?: boolean
  result?: "TP" | "SL"
  realizedPnl?: number
  realizedPnlPct?: number
  openedAt: string
  closedAt?: string
}

interface Trader {
  id: string
  name: string
  emoji: string
  title: string
  style: string
  desc: string
  minLeverage: number
  maxLeverage: number
  capital: number
  totalPnl: number
  totalPnlPct: number
  tradeCount: number
  winCount: number
  openPositions: TraderPosition[]
  last活跃?: string
}

interface LeaderboardEntry {
  id: string
  name: string
  emoji: string
  title: string
  style: string
  capital: number
  totalPnl: number
  totalPnlPct: number
  tradeCount: number
  winCount: number
  openPositions: number
}

export function TraderArena() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [round, set轮次] = useState(0)
  const [lastUpdate, setLastUpdate] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const load = async () => {
    try {
      const r = await fetch("/api/traders")
      if (!r.ok) return
      const data = await r.json()
      setTraders(Object.values(data.traders || {}))
      set轮次(data.round || 0)
      setLastUpdate(data.lastSignalUpdate || "")

      const lb = await fetch("/api/traders/leaderboard").then(r => r.json()).catch(() => [])
      setLeaderboard(lb)
    } catch {}
  }

  useEffect(() => {
    load()
    if (!autoRefresh) return
    const timer = setInterval(load, 8000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  const totalPnl = leaderboard.reduce((s, t) => s + t.totalPnl, 0)
  const totalTrades = leaderboard.reduce((s, t) => s + t.tradeCount, 0)
  const activePositions = leaderboard.reduce((s, t) => s + t.openPositions, 0)

  return (
    <div className="animate-fade-in space-y-4">
      {/* Arena header */}
      <div className="grid gap-3 grid-cols-4">
        <Card className="bg-gradient-to-br from-amber-500/5 to-amber-500/10 border-amber-500/20">
          <CardContent className="p-3 flex items-center gap-2">
            <Sword className="h-5 w-5 text-amber-500" />
            <div>
              <div className="text-xl font-bold">{leaderboard.length}</div>
              <div className="text-[10px] text-muted-foreground">交易员</div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn("bg-gradient-to-br border", totalPnl >= 0 ? "from-emerald-500/5 to-emerald-500/10 border-emerald-500/20" : "from-red-500/5 to-red-500/10 border-red-500/20")}>
          <CardContent className="p-3 flex items-center gap-2">
            <Activity className={cn("h-5 w-5", totalPnl >= 0 ? "text-emerald-500" : "text-red-500")} />
            <div>
              <div className={cn("text-xl font-bold font-mono", totalPnl >= 0 ? "text-emerald-600" : "text-red-600")}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(0)}
              </div>
              <div className="text-[10px] text-muted-foreground">总盈亏 (USD)</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-500" />
            <div>
              <div className="text-xl font-bold">{activePositions}</div>
              <div className="text-[10px] text-muted-foreground">活跃仓位</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-500" />
            <div>
              <div className="text-xl font-bold">{totalTrades}</div>
              <div className="text-[10px] text-muted-foreground">总交易数</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trader cards */}
      {!leaderboard.length ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Sword className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2">交易员竞技场 等待首次信号...</p>
            <p className="text-xs text-muted-foreground/60">
              运行 <code className="text-[11px] bg-muted px-1 rounded">node scripts/trader-sim.mjs</code> 启动模拟
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {leaderboard.map((t, i) => {
            const up = t.totalPnlPct >= 0
            const trader = traders.find(x => x.id === t.id)
            const isSelected = selected === t.id

            return (
              <Card
                key={t.id}
                className={cn(
                  "cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-1",
                  isSelected && "ring-2 ring-primary",
                  up ? "border-emerald-500/30" : "border-red-500/30"
                )}
                onClick={() => setSelected(isSelected ? null : t.id)}
              >
                <CardHeader className="pb-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{t.emoji}</span>
                      <div>
                        <CardTitle className="text-xs">{t.name}</CardTitle>
                        <p className="text-[9px] text-muted-foreground">{t.title} · {t.style}</p>
                      </div>
                    </div>
                    <Badge variant={up ? "success" : "destructive"} className="text-[9px] font-mono">
                      {up ? "+" : ""}{t.totalPnlPct.toFixed(1)}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">本金</span>
                    <span className="font-mono font-semibold">${t.capital.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">胜率</span>
                    <span className="font-mono">{t.tradeCount > 0 ? Math.round(t.winCount / t.tradeCount * 100) : 0}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">活跃</span>
                    <span className="font-mono">{t.openPositions}</span>
                  </div>
                  {/* Position bar */}
                  {trader?.openPositions?.filter(p => !p.closed).map((p, j) => (
                    <div key={j} className="mt-1 pt-1 border-t border-border">
                      <div className="flex items-center gap-1 text-[10px]">
                        <Badge variant={p.direction === "LONG" ? "success" : "destructive"} className="text-[8px] px-1 py-0">
                          {p.direction}
                        </Badge>
                        <span className="text-muted-foreground">{p.symbol}</span>
                        <span className="font-mono ml-auto">{p.leverage}x</span>
                      </div>
                      {p.unrealizedPnlPct != null && (
                        <div className={cn(
                          "text-[10px] font-mono mt-0.5",
                          (p.unrealizedPnlPct || 0) >= 0 ? "text-emerald-600" : "text-red-600"
                        )}>
                          {(p.unrealizedPnlPct || 0) >= 0 ? "+" : ""}{p.unrealizedPnlPct?.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Detail panel for selected trader */}
      {selected && (() => {
        const trader = traders.find(x => x.id === selected)
        if (!trader) return null
        return (
          <Card className="animate-slide-up">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                {trader.emoji} {trader.name} · {trader.title}
                <Badge variant="outline" className="text-[9px]">{trader.style}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{trader.desc}</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-[10px] text-muted-foreground">本金</div>
                  <div className="text-sm font-bold font-mono">${trader.capital.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Total P&L</div>
                  <div className={cn("text-sm font-bold font-mono", trader.totalPnl >= 0 ? "text-emerald-600" : "text-red-600")}>
                    {trader.totalPnl >= 0 ? "+" : ""}{trader.totalPnl.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">胜率</div>
                  <div className="text-sm font-bold">
                    {trader.tradeCount > 0 ? Math.round(trader.winCount / trader.tradeCount * 100) : 0}%
                    <span className="text-[10px] text-muted-foreground ml-1">({trader.winCount}/{trader.tradeCount})</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">杠杆范围</div>
                  <div className="text-sm font-bold font-mono">{trader.minLeverage}x-{trader.maxLeverage}x</div>
                </div>
              </div>

              {/* Open positions */}
              <h4 className="text-xs font-semibold mb-2">持仓中</h4>
              {trader.openPositions.filter(p => !p.closed).length === 0 ? (
                <p className="text-xs text-muted-foreground mb-4">暂无持仓</p>
              ) : (
                <div className="space-y-2 mb-4">
                  {trader.openPositions.filter(p => !p.closed).map((p, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-muted/50 border border-border">
                      <Badge variant={p.direction === "LONG" ? "success" : "destructive"} className="text-[9px]">{p.direction}</Badge>
                      <span className="text-xs font-semibold">{p.symbol}</span>
                      <span className="text-xs text-muted-foreground">{p.leverage}x</span>
                      <span className="text-xs font-mono">Entry: ${p.entryPrice.toFixed(1)}</span>
                      <span className="text-xs font-mono text-emerald-600">TP: ${p.tpPrice.toFixed(1)}</span>
                      <span className="text-xs font-mono text-red-600">SL: ${p.slPrice.toFixed(1)}</span>
                      {p.unrealizedPnlPct != null && (
                        <span className={cn("text-xs font-mono ml-auto", (p.unrealizedPnlPct || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>
                          {(p.unrealizedPnlPct || 0) >= 0 ? "+" : ""}{p.unrealizedPnlPct?.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Trade history */}
              <h4 className="text-xs font-semibold mb-2">近期交易</h4>
              <div className="text-xs text-muted-foreground space-y-1 max-h-[200px] overflow-y-auto">
                {trader.openPositions.filter(p => p.closed).slice(-10).reverse().map((p, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <Badge variant={p.result === "TP" ? "success" : "destructive"} className="text-[8px] px-1">{p.result}</Badge>
                    <span>{p.symbol} {p.direction} {p.leverage}x</span>
                    <span className={cn("font-mono ml-auto", (p.realizedPnlPct || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {(p.realizedPnlPct || 0) >= 0 ? "+" : ""}{p.realizedPnlPct?.toFixed(2)}%
                    </span>
                    <span className="text-[9px]">{new Date(p.closedAt || "").toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
                {!trader.openPositions.some(p => p.closed) && <span>暂无交易</span>}
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Update info */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>轮次 {round} · {leaderboard.length} 交易员 · {activePositions} 个活跃仓位</span>
        <span>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "等待中"}</span>
      </div>
    </div>
  )
}
