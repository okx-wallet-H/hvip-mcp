import { useState, useEffect, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, Star, ExternalLink, CheckCircle, Terminal } from "lucide-react"

interface Plugin {
  id: string
  name: string
  category: string
  description: string
  install: string
  repo: string
  stars: string
  tags: string
  verified: boolean
  createdAt: string
}

type StoreData = Record<string, Plugin[]>

/** 判断插件是否匹配搜索关键词 */
function matchesSearch(p: Plugin, term: string): boolean {
  const q = term.toLowerCase()
  return (
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.tags.toLowerCase().includes(q)
  )
}

export function StorePanel() {
  const [data, setData] = useState<StoreData>({})
  const [search, setSearch] = useState("")
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/store")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: StoreData) => {
        setData(d)
        setTotal(Object.values(d).reduce((s, arr) => s + arr.length, 0))
        setError(false)
      })
      .catch(() => { setError(true) })
  }, [])

  // 搜索时同时过滤分类和分类内的插件
  const categories = useMemo(() => {
    const entries = Object.entries(data)
    if (!search) return entries

    return entries
      .map(([cat, plugins]): [string, Plugin[]] => {
        const filtered = plugins.filter(p => matchesSearch(p, search))
        return [cat, filtered]
      })
      .filter(([, plugins]) => plugins.length > 0)
  }, [data, search])

  // 当前显示的实际插件数量（搜索后）
  const visibleCount = useMemo(() =>
    categories.reduce((s, [, p]) => s + p.length, 0),
    [categories]
  )

  const isEmpty = !categories.length

  return (
    <div className="animate-fade-in space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索插件…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Badge variant="secondary" className="text-xs">
          {search ? `${visibleCount} / ${total}` : `${total}`} 插件
        </Badge>
      </div>

      {error ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground">加载失败，请刷新重试</p>
        </div>
      ) : isEmpty && !search ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground">加载中…</p>
        </div>
      ) : isEmpty && search ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground">无匹配</p>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(([cat, plugins]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {cat}
                </h3>
                <Badge variant="outline" className="text-[9px]">{plugins.length}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {plugins.map(p => (
                  <Card
                    key={p.id}
                    className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{p.name}</span>
                            {p.verified && (
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            {p.description}
                          </p>
                        </div>
                        {p.repo && (
                          <a
                            href={`https://github.com/${p.repo}`}
                            target="_blank"
                            rel="noopener"
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                          </a>
                        )}
                      </div>

                      {/* Install command */}
                      <div className="flex items-center gap-1.5 bg-muted rounded-md px-2.5 py-1.5">
                        <Terminal className="h-3 w-3 text-muted-foreground shrink-0" />
                        <code className="text-[10px] font-mono text-muted-foreground truncate">
                          {p.install}
                        </code>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                          <Star className="h-3 w-3" /> {p.stars}
                        </span>
                        {p.tags
                          .split(",")
                          .map(t => t.trim())
                          .filter(Boolean)
                          .map(t => (
                            <span
                              key={t}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
