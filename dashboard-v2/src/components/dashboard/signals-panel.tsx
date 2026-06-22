import { useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Task } from "@/hooks/use-api"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { TrendingUp, TrendingDown, Minus, Award, Plus, Zap } from "lucide-react"

interface Signal {
  taskId: string
  title: string
  status: string
  currentSignal: string
  price: string
  symbol: string
  sharpe: number
  mdd: number
  winRate: number
  confidence: number
  conclusion: string
  indicator: string
  last5: string[]
  /** vbt-backtest 扩展字段 */
  strategy: string
  totalReturn: number
  trades: number
}

/**
 * 构建兼容带括号和不带括号两种格式的正则。
 * vbt-signal 输出 SHARPE: 1.5
 * vbt-backtest 输出 [SHARPE]: 1.5
 */
function brace(key: string): string {
  return `(?:\\[)?${key}(?:\\])?:`
}

function extractSignals(tasks: Task[]): Signal[] {
  return tasks
    .filter(t => t.taskId.startsWith("V-"))
    .map(t => {
      const r = t.result || ""
      const sig: Signal = {
        taskId: t.taskId, title: t.title || t.taskId, status: t.status,
        currentSignal: "NEUTRAL", price: "--", sharpe: 0, mdd: 0, winRate: 0,
        confidence: 0, conclusion: "", symbol: "BTC/USDT", indicator: "", last5: [],
        strategy: "", totalReturn: 0, trades: 0,
      }

      // vbt-signal 独有字段
      const sm = r.match(new RegExp(`CURRENT_SIGNAL:\\s*(\\w+)`, "i"))
      if (sm) sig.currentSignal = sm[1].toUpperCase()

      const pm = r.match(new RegExp(`CURRENT_PRICE:\\s*(\\S+)`, "i"))
      if (pm) sig.price = pm[1]

      const ind = r.match(new RegExp(`INDICATOR:\\s*(\\S+)`, "i"))
      if (ind) sig.indicator = ind[1]

      const ls = r.match(new RegExp(`LAST_5_SIGNALS:\\s*\\[(.+)\\]`, "i"))
      if (ls) sig.last5 = ls[1].split(",").map(s => s.trim()).filter(Boolean)

      // 通用字段 — 兼容 [KEY]: 和 KEY: 两种格式
      const sym = r.match(new RegExp(`${brace("SYMBOL")}\\s*(\\S+)`, "i"))
      if (sym) sig.symbol = sym[1]

      const sh = r.match(new RegExp(`${brace("SHARPE")}\\s*([\\d.]+)`, "i"))
      if (sh) sig.sharpe = parseFloat(sh[1])

      const dd = r.match(new RegExp(`${brace("MAX_DD")}\\s*([\\d.]+)`, "i"))
      if (dd) sig.mdd = parseFloat(dd[1])

      const wr = r.match(new RegExp(`${brace("WIN_RATE")}\\s*([\\d.]+)`, "i"))
      if (wr) sig.winRate = parseFloat(wr[1])

      const cf = r.match(new RegExp(`${brace("CONFIDENCE")}\\s*(\\d+)`, "i"))
      if (cf) sig.confidence = parseInt(cf[1], 10)

      const cl = r.match(new RegExp(`${brace("CONCLUSION")}\\s*(.+)`, "i"))
      if (cl) sig.conclusion = cl[1].slice(0, 200)

      // vbt-backtest 扩展字段
      const st = r.match(new RegExp(`${brace("STRATEGY")}\\s*(.+)`, "i"))
      if (st) sig.strategy = st[1].trim()

      const tr = r.match(new RegExp(`${brace("TOTAL_RETURN")}\\s*([\\d.]+)`, "i"))
      if (tr) sig.totalReturn = parseFloat(tr[1])

      const td = r.match(new RegExp(`${brace("TRADES")}\\s*(\\d+)`, "i"))
      if (td) sig.trades = parseInt(td[1], 10)

      // 如果结果中有 CURRENT_SIGNAL 但没找到 SYMBOL，从标题猜品种
      if (!sym && sig.currentSignal !== "NEUTRAL" && t.title) {
        const guess = t.title.match(/(BTC|ETH|SOL|DOGE|ADA|XRP|BNB)[-/]?USDT/i)
        if (guess) sig.symbol = guess[1].toUpperCase() + "/USDT"
      }

      return sig
    })
    // 只保留有有效信号的条目：非NEUTRAL，或已完成/已审核
    .filter(s => s.currentSignal !== "NEUTRAL" || s.status === "done" || s.status === "reviewed" || s.sharpe > 0)
}

interface SignalsPanelProps {
  tasks: Task[]
  onCreateTask?: (payload: { taskId: string; title: string; template: string; params: Record<string, string> }) => Promise<boolean>
  onRefresh?: () => void
}

export function SignalsPanel({ tasks, onCreateTask, onRefresh }: SignalsPanelProps) {
  const signals = useMemo(() => extractSignals(tasks), [tasks])

  const longs = signals.filter(s => s.currentSignal === "LONG").length
  const shorts = signals.filter(s => s.currentSignal === "SHORT").length
  const neutrals = signals.filter(s => s.currentSignal === "NEUTRAL").length
  const wrVals = signals.filter(s => s.winRate > 0).map(s => s.winRate)
  const avgWR = wrVals.length ? Math.round(wrVals.reduce((a,b)=>a+b,0) / wrVals.length) : 0

  // ── 创建信号表单 ──
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sym, setSym] = useState("BTC/USDT")
  const [indicator, setIndicator] = useState("SUPERTREND(7,3)")
  const [timeframe, setTimeframe] = useState("4h")
  const [lookback, setLookback] = useState("180")
  const [submitting, setSubmitting] = useState(false)

  const handleCreateSignal = useCallback(async () => {
    if (!indicator.trim()) return
    setSubmitting(true)
    try {
      const taskId = `V-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const title = `[信号] ${sym} ${indicator} (${timeframe})`
      const ok = await onCreateTask?.({
        taskId,
        title,
        template: "vbt-signal",
        params: { symbol: sym, indicator, timeframe, lookback },
      })
      if (ok) {
        setDialogOpen(false)
        // 刷新任务列表
        setTimeout(() => onRefresh?.(), 500)
      }
    } finally {
      setSubmitting(false)
    }
  }, [sym, indicator, timeframe, lookback, onCreateTask, onRefresh])

  return (
    <div className="animate-fade-in space-y-4">
      {/* KPI row + 创建按钮 */}
      <div className="flex items-center gap-3">
        <div className="grid gap-3 grid-cols-4 flex-1">
          <Card>
            <CardContent className="p-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              <div><div className="text-xl font-bold">{longs}</div><div className="text-[10px] text-muted-foreground">做多信号</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex items-center gap-2">
              <Minus className="h-5 w-5 text-indigo-400" />
              <div><div className="text-xl font-bold">{neutrals}</div><div className="text-[10px] text-muted-foreground">中性信号</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              <div><div className="text-xl font-bold">{shorts}</div><div className="text-[10px] text-muted-foreground">做空信号</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              <div><div className="text-xl font-bold">{avgWR}%</div><div className="text-[10px] text-muted-foreground">平均胜率</div></div>
            </CardContent>
          </Card>
        </div>

        {/* 创建信号按钮 */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="text-xs gap-1.5 shrink-0 h-9">
              <Zap className="h-4 w-4" />
              创建 VBT 信号
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-amber-500" />
                创建 VBT 信号任务
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">交易品种</label>
                <Input value={sym} onChange={e => setSym(e.target.value)} placeholder="BTC/USDT" className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">指标/策略 *</label>
                <Input value={indicator} onChange={e => setIndicator(e.target.value)} placeholder="SUPERTREND(7,3)" className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">K线周期</label>
                <Input value={timeframe} onChange={e => setTimeframe(e.target.value)} placeholder="4h" className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">回看天数</label>
                <Input value={lookback} onChange={e => setLookback(e.target.value)} placeholder="180" className="h-8 text-xs" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button size="sm" className="text-xs gap-1" disabled={!indicator.trim() || submitting} onClick={handleCreateSignal}>
                  {submitting ? "创建中…" : <><Plus className="h-3.5 w-3.5" /> 创建信号</>}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!signals.length ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground">暂无信号。点击右上角「创建 VBT 信号」开始。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {signals.map(s => {
            const isLong = s.currentSignal === "LONG"
            const isShort = s.currentSignal === "SHORT"
            const isNeutral = s.currentSignal === "NEUTRAL"
            const confPct = s.confidence || (s.winRate > 0 ? Math.round(s.winRate) : 50)
            const confColor = confPct >= 70 ? "text-emerald-600" : confPct >= 40 ? "text-amber-600" : "text-red-600"

            return (
              <Card key={s.taskId} className={cn(
                "transition-all duration-200 hover:shadow-sm",
                isLong && "border-l-2 border-l-emerald-500",
                isShort && "border-l-2 border-l-red-500",
                isNeutral && "border-l-2 border-l-indigo-400",
              )}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={isLong ? "success" : isShort ? "destructive" : "secondary"} className="gap-1">
                        {isLong ? <TrendingUp className="h-3 w-3" /> : isShort ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                        {isLong ? "做多" : isShort ? "做空" : "观望"}
                      </Badge>
                      <span className="text-sm font-semibold">{s.symbol}</span>
                      <span className="text-xs text-muted-foreground">· {s.indicator || s.strategy || s.taskId}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                      <span className={cn("text-[10px] font-semibold", confColor)}>
                        置信度 {confPct}%
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-5 gap-4 text-xs mb-3">
                    <div>
                      <span className="text-muted-foreground">当前价</span>
                      <p className="font-semibold text-foreground">{s.price}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sharpe</span>
                      <p className={cn("font-semibold", s.sharpe >= 1 ? "text-emerald-600" : "text-amber-600")}>
                        {s.sharpe ? s.sharpe.toFixed(2) : "--"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">最大回撤</span>
                      <p className="font-semibold text-red-600">{s.mdd ? s.mdd.toFixed(1) + "%" : "--"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">胜率</span>
                      <p className={cn("font-semibold", s.winRate >= 50 ? "text-emerald-600" : "text-amber-600")}>
                        {s.winRate ? s.winRate.toFixed(1) + "%" : "--"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">置信度</span>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[40px]">
                          <div className="h-full rounded-full transition-all" style={{ width: `${confPct}%`, background: confPct >= 70 ? "#16a34a" : confPct >= 40 ? "#d97706" : "#dc2626" }} />
                        </div>
                        <span className="font-mono text-[10px]">{confPct}%</span>
                      </div>
                    </div>
                  </div>
                  {s.conclusion && (
                    <div className={cn(
                      "text-xs p-2.5 rounded-md border-l-2",
                      isLong ? "bg-emerald-50 dark:bg-emerald-950 border-l-emerald-500" :
                      isShort ? "bg-red-50 dark:bg-red-950 border-l-red-500" :
                      "bg-muted border-l-indigo-400"
                    )}>
                      {s.conclusion}
                    </div>
                  )}
                  {/* vbt-backtest 扩展信息 */}
                  {(s.strategy || s.totalReturn > 0 || s.trades > 0) && (
                    <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
                      {s.strategy && <span>策略: {s.strategy}</span>}
                      {s.totalReturn > 0 && <span>总收益: <span className={s.totalReturn >= 0 ? "text-emerald-600" : "text-red-600"}>{s.totalReturn.toFixed(1)}%</span></span>}
                      {s.trades > 0 && <span>交易: {s.trades} 次</span>}
                    </div>
                  )}
                  {s.last5.length > 0 && (
                    <div className="mt-2 flex gap-1.5 items-center text-[10px] text-muted-foreground">
                      最近信号:
                      {s.last5.map((l, i) => (
                        <span key={i} className={cn(
                          "px-1.5 py-0.5 rounded-full text-[9px]",
                          l.includes("LONG") ? "bg-emerald-500/10 text-emerald-600" :
                          l.includes("SHORT") ? "bg-red-500/10 text-red-600" :
                          "bg-muted text-muted-foreground"
                        )}>{l}</span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
