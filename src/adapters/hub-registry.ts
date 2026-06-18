/**
 * MCP 插件商店注册表
 *
 * Agent 分配任务时如果发现自己能力不够，可以查商店找到合适的插件。
 * SQLite 持久化，启动时预置精选插件。
 */

import { isSqliteAvailable, openDB, ensureDir } from "./shared-sqlite.js"
import { logger } from "../utils/logger.js"

export interface MCPPlugin {
  id: string; name: string; category: string; description: string
  repo: string; install: string; stars: string; tags: string
  verified: boolean; createdAt: string
}

const SEED: Omit<MCPPlugin,"id"|"createdAt">[] = [
  { name:"playwright-mcp", category:"浏览器自动化", description:"Microsoft官方: 让Agent控制浏览器, 截图/点击/填表/抓取网页", repo:"microsoft/playwright-mcp", install:"npx @playwright/mcp@latest", stars:"15k+", tags:"浏览器,自动化,测试,官方", verified:true },
  { name:"mcp-server-git", category:"版本控制", description:"让Agent直接操作Git: 查看diff/提交/创建分支/查看历史", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-git", stars:"10k+", tags:"git,版本控制,代码", verified:true },
  { name:"mcp-server-github", category:"代码托管", description:"让Agent管理GitHub: Issues/PRs/搜索仓库/查看文件", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-github", stars:"10k+", tags:"github,PR,issue,API", verified:true },
  { name:"mcp-server-postgres", category:"数据库", description:"让Agent直接查询PostgreSQL数据库, 支持只读模式", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-postgres", stars:"8k+", tags:"数据库,SQL,PostgreSQL", verified:true },
  { name:"mcp-server-filesystem", category:"文件系统", description:"Agent安全读写文件系统, 支持目录白名单限制", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-filesystem", stars:"10k+", tags:"文件,读写,安全", verified:true },
  { name:"mcp-server-fetch", category:"网络请求", description:"Agent发起HTTP请求获取网页内容, 支持HTML转Markdown", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-fetch", stars:"8k+", tags:"HTTP,抓取,网页,API", verified:true },
  { name:"hvip-mcp-server", category:"加密货币交易", description:"365个工具覆盖97.7% OKX API: 行情/交易/资金/策略/预测", repo:"okx-wallet-H/hvip-mcp", install:"npx hvip-mcp-server", stars:"新", tags:"OKX,交易,行情,加密货币", verified:true },
  { name:"claude-code-mcp", category:"AI开发", description:"Anthropic官方的Claude Code MCP集成, 支持自定义Agent", repo:"anthropics/claude-code", install:"内置", stars:"50k+", tags:"Claude,官方,Agent,开发", verified:true },
  { name:"mcp-server-brave-search", category:"搜索", description:"让Agent使用Brave搜索引擎搜索互联网获取最新信息", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-brave-search", stars:"5k+", tags:"搜索,互联网,Brave", verified:true },
  { name:"mcp-server-puppeteer", category:"浏览器自动化", description:"让Agent控制Headless Chrome: 截图/PDF/自动化测试", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-puppeteer", stars:"6k+", tags:"浏览器,Puppeteer,自动化", verified:true },
  { name:"mcp-server-slack", category:"即时通讯", description:"Agent通过Slack与团队沟通: 发消息/读频道/搜索历史", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-slack", stars:"4k+", tags:"Slack,沟通,团队", verified:true },
  { name:"mcp-server-sentry", category:"错误监控", description:"Agent查询Sentry错误日志, 获取堆栈追踪和上下文", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-sentry", stars:"3k+", tags:"错误,监控,Sentry,调试", verified:true },
  { name:"mission-control", category:"Agent编排", description:"32面板SPA仪表盘: 看板/技能市场/安全审计/成本追踪", repo:"builderz-labs/mission-control", install:"git clone + pnpm start", stars:"新", tags:"仪表盘,编排,安全,多Agent", verified:true },
  { name:"artel", category:"Agent协作", description:"4层共享记忆+语义搜索+CRDT多实例复制, Agent知识永续", repo:"NicolasPrimeau/artel", install:"docker compose up", stars:"新", tags:"记忆,协作,知识,分布式", verified:true },
  { name:"concilium", category:"Agent终端", description:"卡片式多Agent终端仪表盘, xterm.js嵌入, 支持所有CLI Agent", repo:"jonathanbossenger/concilium", install:"npm install -g concilium", stars:"新", tags:"终端,多Agent,仪表盘", verified:true },
  { name:"mcp-server-docker", category:"容器管理", description:"Agent操作Docker容器: 启动/停止/查看日志/管理镜像", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-docker", stars:"3k+", tags:"Docker,容器,部署", verified:true },
  { name:"mcp-server-kubernetes", category:"容器编排", description:"Agent管理K8s集群: 查看Pod/部署/服务/配置", repo:"flux159/mcp-server-kubernetes", install:"npx -y mcp-server-kubernetes", stars:"1k+", tags:"Kubernetes,集群,云原生", verified:true },
  { name:"mcp-server-sqlite", category:"数据库", description:"Agent本地SQLite查询, 轻量零配置, 适合数据分析", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-sqlite", stars:"4k+", tags:"SQLite,数据库,本地", verified:true },
  { name:"mcp-server-sequential-thinking", category:"推理增强", description:"Agent按步骤推理复杂问题, 每步可检查修正, 减少幻觉", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-sequential-thinking", stars:"5k+", tags:"推理,思考,逻辑,复杂问题", verified:true },
  { name:"mcp-server-time", category:"工具", description:"Agent获取精确时间和时区转换, 可设闹钟定时任务", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-time", stars:"2k+", tags:"时间,时区,定时", verified:true },
  { name:"mcp-server-everart", category:"AI记忆", description:"让Agent拥有长期记忆: 存储/检索/语义搜索, 支持向量嵌入", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-everart", stars:"2k+", tags:"记忆,向量,长期,语义", verified:true },
  { name:"nubase", category:"AI后端", description:"AI原生后端平台: 数据库/认证/存储/函数/记忆, MCP全访问", repo:"OtterMind/Nubase", install:"docker compose up", stars:"新", tags:"后端,数据库,认证,全栈", verified:true },
  { name:"nexus", category:"零配置Agent", description:"零API密钥MCP服务器: DuckDuckGo搜索/Ollama LLM/内存存储", repo:"black_shadow/nexus", install:"npx @black_shadow/nexus", stars:"新", tags:"零配置,本地,隐私", verified:true },
  { name:"mcp-server-rag-web-browser", category:"知识库", description:"Agent基于网页文档做RAG问答, 自动抓取+索引+检索", repo:"modelcontextprotocol/servers", install:"npx -y @modelcontextprotocol/server-rag-web-browser", stars:"2k+", tags:"RAG,知识库,网页,问答", verified:true },
]

const log = logger("Registry")

export class HubRegistry {
  private db: any = null

  constructor(private dbPath: string) {}

  open(): boolean {
    if (!isSqliteAvailable()) return false
    try {
      ensureDir(this.dbPath)
      this.db = openDB(this.dbPath, { create: true })
      this.db.exec(`CREATE TABLE IF NOT EXISTS registry (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, repo TEXT, install TEXT, stars TEXT, tags TEXT, verified INTEGER DEFAULT 0, createdAt TEXT DEFAULT (datetime('now')))`)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_registry_name ON registry(name); CREATE INDEX IF NOT EXISTS idx_registry_category ON registry(category); CREATE INDEX IF NOT EXISTS idx_registry_tags ON registry(tags)`)
      const n = (this.db.prepare("SELECT COUNT(*) as n FROM registry").get() as any)?.n || 0
      if (n === 0) { SEED.forEach(p => this.add(p)); log.info(`预置 ${SEED.length} 个MCP插件`) }
      else log.info(`已加载 ${n} 个MCP插件`)
      return true
    } catch (e) { log.error(`打开失败: ${String(e)}`); return false }
  }

  close(): void { if (this.db) { try { this.db.close() } catch {}; this.db = null } }

  add(p: Omit<MCPPlugin,"id"|"createdAt">): MCPPlugin {
    if (!this.db) throw new Error("Registry 未打开")
    const id = "mcp-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,5)
    const now = new Date().toISOString()
    this.db.prepare("INSERT OR REPLACE INTO registry (id,name,category,description,repo,install,stars,tags,verified,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,p.name,p.category,p.description,p.repo,p.install,p.stars,p.tags,p.verified?1:0,now)
    return { id, ...p, verified:p.verified||false, createdAt:now }
  }

  search(q: string, category?: string, limit=30): MCPPlugin[] {
    if (!this.db) return []
    let sql = "SELECT * FROM registry WHERE 1=1"; const params: any[] = []
    if (q) { const terms = q.split(/\s+/).filter(Boolean); terms.forEach(t => { sql += " AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)"; params.push("%"+t+"%","%"+t+"%","%"+t+"%") }) }
    if (category) { sql += " AND category = ?"; params.push(category) }
    sql += " ORDER BY verified DESC, stars DESC LIMIT ?"; params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as any[]
    return (Array.isArray(rows)?rows:[]).map((r:any)=>this.rowToPlugin(r))
  }

  byCategory(): Record<string,MCPPlugin[]> {
    if (!this.db) return {}
    const rows = this.db.prepare("SELECT * FROM registry ORDER BY category, stars DESC").all() as any[]
    const map: Record<string,MCPPlugin[]> = {}
    for (const r of (Array.isArray(rows)?rows:[])) { const c = r.category||"其他"; if(!map[c]) map[c]=[]; map[c].push(this.rowToPlugin(r)) }
    return map
  }

  all(limit=100): MCPPlugin[] {
    if (!this.db) return []
    return (this.db.prepare("SELECT * FROM registry ORDER BY stars DESC LIMIT ?").all(limit) as any[]).map((r:any)=>this.rowToPlugin(r))
  }

  get(id: string): MCPPlugin|null { if (!this.db) return null; const r=this.db.prepare("SELECT * FROM registry WHERE id=?").get(id) as any; return r?this.rowToPlugin(r):null }

  rowToPlugin(r: any): MCPPlugin { return { id:r.id,name:r.name,category:r.category,description:r.description,repo:r.repo,install:r.install,stars:r.stars,tags:r.tags,verified:!!r.verified,createdAt:r.createdAt } }
}
