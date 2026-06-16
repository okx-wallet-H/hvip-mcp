/**
 * Agent Hub 独立服务器
 *
 * 不依赖 MCP server，可 7×24 守护运行。
 * 持久化 tasks + messages 到 SQLite，重启不丢状态。
 * 内置 HTTP 仪表盘 — 浏览器打开即可监控所有 Agent 活动。
 *
 * Usage:
 *   node dist/hub-server.js
 *   node dist/hub-server.js --port 9321 --host 0.0.0.0 --web-port 3000
 *
 * PM2:
 *   pm2 start dist/hub-server.js --name hvip-hub
 */

import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { spawn } from "node:child_process"
import { agentHub } from "./adapters/agent-hub.js"
import { HubDB } from "./adapters/hub-persistence.js"

const VERSION = "0.3.0"

// ── CLI 参数 ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

const wsPort   = parseInt(flag("port")     || process.env.HUB_PORT      || "9321", 10)
const host     = flag("host")              || process.env.HUB_HOST      || "127.0.0.1"
const webPort  = parseInt(flag("web-port") || process.env.HUB_WEB_PORT  || "3000", 10)
const dbPath   = flag("db")               || process.env.HUB_DB_PATH   || ".hub/hub.db"

// ═══════════════════════════════════════════════════════════════════════════
// 仪表盘 HTML
// ═══════════════════════════════════════════════════════════════════════════

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent Hub · 仪表盘</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,monospace;background:#0d1117;color:#c9d1d9;min-height:100vh}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:18px;color:#58a6ff}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.dot.online{background:#3fb950;box-shadow:0 0 6px #3fb950}
.dot.offline{background:#f85149}
.dot.working{background:#d29922;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px;max-width:1400px;margin:0 auto}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
.card-title{background:#1c2128;padding:8px 14px;font-size:13px;font-weight:600;border-bottom:1px solid #30363d;display:flex;justify-content:space-between}
.card-body{padding:12px 14px;max-height:420px;overflow-y:auto;font-size:13px;line-height:1.6}
.agent-row,.task-row,.msg-row{padding:6px 0;border-bottom:1px solid #21262d}
.agent-row:last-child,.task-row:last-child,.msg-row:last-child{border-bottom:none}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;margin-left:6px}
.tag.idle{background:#1b3a1b;color:#3fb950}
.tag.working{background:#3d2e00;color:#d29922}
.tag.done{background:#1b3a1b;color:#3fb950}
.tag.reviewed{background:#0d3068;color:#58a6ff}
.tag.unassigned{background:#21262d;color:#8b949e}
.tag.assigned{background:#3d2e00;color:#d29922}
.badge{display:inline-block;background:#21262d;padding:1px 6px;border-radius:4px;font-size:11px;margin-right:4px}
.ts{color:#484f58;font-size:11px;margin-left:8px}
.empty{color:#484f58;font-style:italic;padding:20px;text-align:center}
.stats{display:flex;gap:16px}
.stat{text-align:center}
.stat-val{font-size:28px;font-weight:700;color:#58a6ff}
.stat-label{font-size:11px;color:#8b949e}
.error-banner{background:#490202;color:#f85149;padding:8px 16px;font-size:12px;display:none}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>🤖 Agent Hub <span style="font-weight:400;color:#8b949e;font-size:14px">v${VERSION}</span></h1>
    <span style="font-size:11px;color:#484f58">ws://${host}:${wsPort}</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-val" id="agentCount">0</div><div class="stat-label">Agents</div></div>
    <div class="stat"><div class="stat-val" id="taskCount">0</div><div class="stat-label">Tasks</div></div>
    <div class="stat"><div class="stat-val" id="msgCount">0</div><div class="stat-label">消息</div></div>
  </div>
</div>
<div class="error-banner" id="errorBanner"></div>

<!-- 新建任务 -->
<div style="padding:0 16px;max-width:1400px;margin:0 auto">
  <div class="card">
    <div class="card-title">➕ 告诉 AI 做什么（编号自动生成）</div>
    <div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="flex:5;min-width:280px">
        <label style="font-size:11px;color:#8b949e;display:block">用自然语言描述需求，编号自动生成</label>
        <input id="newTaskDesc" placeholder="例如：写 WebSocket 私有频道、修 agent-hub 心跳超时 bug、给 README 加安装说明..." style="width:100%;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:13px">
      </div>
      <button onclick="createTask()" style="background:#238636;color:white;border:none;padding:6px 16px;border-radius:4px;font-size:13px;cursor:pointer;white-space:nowrap">创建任务</button>
      <button onclick="createAndSpawn()" style="background:#1f6feb;color:white;border:none;padding:6px 16px;border-radius:4px;font-size:13px;cursor:pointer;white-space:nowrap">创建并拉起 AI 干活 🤖</button>
    </div>
  </div>
</div>

<div class="grid">
  <!-- Agents -->
  <div class="card">
    <div class="card-title"><span>🧑‍💻 在线 Agent</span><span id="agentLabel">0 在线</span></div>
    <div class="card-body" id="agents"><div class="empty">等待 Agent 连接...</div></div>
  </div>
  <!-- Tasks -->
  <div class="card">
    <div class="card-title"><span>📋 任务</span><span id="taskLabel"></span></div>
    <div class="card-body" id="tasks"><div class="empty">暂无任务</div></div>
  </div>
  <!-- Room Messages -->
  <div class="card" style="grid-column:1/-1">
    <div class="card-title"><span>💬 实时消息</span><span id="msgLabel">#lobby</span></div>
    <div class="card-body" id="messages" style="max-height:300px"><div class="empty">暂无消息</div></div>
  </div>
</div>

<script>
const HOST = '${host}'
const WS_PORT = ${wsPort}
let msgs = []

function timeAgo(iso){const d=new Date(iso);const s=Math.floor((Date.now()-d)/1e3);if(s<10)return'刚刚';if(s<60)return s+'s前';if(s<3600)return Math.floor(s/60)+'m前';return Math.floor(s/3600)+'h前'}

function renderAgents(agents){
  const el=document.getElementById('agents')
  document.getElementById('agentCount').textContent=agents.length
  document.getElementById('agentLabel').textContent=agents.length+' 在线'
  if(!agents.length){el.innerHTML='<div class=empty>等待 Agent 连接...</div>';return}
  el.innerHTML=agents.map(a=>{
    const dot=a.status==='working'?'working':'online'
    const tag=a.status==='working'?'working':'idle'
    return '<div class=agent-row>'+
      '<span class="dot '+dot+'"></span>'+
      '<b>'+esc(a.name)+'</b> '+
      '<span style=color:#8b949e>'+esc(a.agentId)+'</span>'+
      '<span class="tag '+tag+'">'+a.status+'</span>'+
      '<span class=ts>'+timeAgo(a.lastSeen)+'</span>'+
      (a.capabilities.length?'<br><span style=font-size:11px;color:#484f58>能力: '+a.capabilities.map(c=>'<span class=badge>'+esc(c)+'</span>').join(' ')+'</span>':'')+
      '</div>'
  }).join('')
}

function renderTasks(tasks){
  const el=document.getElementById('tasks')
  document.getElementById('taskCount').textContent=tasks.length
  const done=tasks.filter(t=>t.status==='reviewed').length
  document.getElementById('taskLabel').textContent=tasks.length+' 个 · '+done+' 已完成'
  if(!tasks.length){el.innerHTML='<div class=empty>暂无任务</div>';return}
  el.innerHTML=tasks.map(t=>{
    const spawnBtn = (t.status==='unassigned'||t.status==='reviewed')
      ? ' <button onclick="spawnWorker(\''+esc(t.taskId)+'\')" style="font-size:10px;background:#1f6feb;color:white;border:none;padding:1px 8px;border-radius:8px;cursor:pointer;margin-left:4px">🤖 拉起 AI</button>'
      : ''
    return '<div class=task-row>'+
      '<b>'+esc(t.taskId)+'</b> '+esc(t.title)+
      '<span class="tag '+t.status+'">'+t.status+'</span>'+spawnBtn+
      (t.assignedTo?'<br><span style=font-size:11px>认领: <b>'+esc(t.assignedTo)+'</b></span>':'')+
      (t.branch?' <span style=font-size:11px;color:#58a6ff>'+esc(t.branch)+'</span>':'')+
      (t.result?'<br><span style=font-size:11px;color:#8b949e>'+esc(t.result)+'</span>':'')+
      '</div>'
  }).join('')
}

function addMsg(m){
  msgs.push(m); if(msgs.length>100) msgs.shift()
  const el=document.getElementById('messages')
  document.getElementById('msgCount').textContent=msgs.length
  if(msgs.length===0){el.innerHTML='<div class=empty>暂无消息</div>';return}
  el.innerHTML=msgs.slice(-60).map(m=>{
    return '<div class=msg-row>'+
      '<span style=color:#58a6ff>'+esc(m.from)+'</span>'+
      ' <span style=color:#484f58>→</span> '+
      '<span style=color:#8b949e>'+esc(m.roomId)+'</span>'+
      ': '+esc(m.text)+
      '<span class=ts>'+timeAgo(m.ts)+'</span>'+
      '</div>'
  }).join('')
  el.scrollTop=el.scrollHeight
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function showError(msg){const b=document.getElementById('errorBanner');b.textContent=msg;b.style.display='block';setTimeout(()=>b.style.display='none',8000)}

function showOk(msg){const b=document.getElementById('errorBanner');b.textContent=msg;b.style.background='#0d3320';b.style.color='#3fb950';b.style.display='block';setTimeout(()=>{b.style.display='none';b.style.background='#490202';b.style.color='#f85149'},5000)}

function genTaskId(desc){const ts=Date.now().toString(36).slice(-4);const w=desc.replace(/[^a-zA-Z0-9_\\u4e00-\\u9fff]/g,' ').split(/\\s+/).filter(Boolean).slice(0,3).join('-');return (w||'TASK')+'-'+ts}

async function createTask(){const desc=document.getElementById('newTaskDesc').value.trim();if(!desc){showError('请描述你要 AI 做什么');return};const id=genTaskId(desc);const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:id,title:desc})});if(r.ok){document.getElementById('newTaskDesc').value='';showOk('任务 '+id+' 已创建');document.getElementById('newTaskDesc').dataset.lastId=id;setTimeout(()=>fetch('/api/status').then(r=>r.json()).then(s=>renderTasks(s.tasks)),500)}else{const e=await r.json().catch(()=>({}));showError(e.error||'创建失败')}}

async function spawnWorker(taskId){if(!confirm('启动 AI Agent 处理任务 '+taskId+'？'))return;const r=await fetch('/api/tasks/'+encodeURIComponent(taskId)+'/spawn',{method:'POST'});if(r.ok){showOk('🤖 AI Agent 已启动，正在处理 '+taskId+'... 刷新页面查看进度')}else{const e=await r.json().catch(()=>({}));showError(e.error||'启动失败')}}

async function createAndSpawn(){const desc=document.getElementById('newTaskDesc').value.trim();if(!desc){showError('请描述你要 AI 做什么');return};const id=genTaskId(desc);const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:id,title:desc})});if(!r.ok){const e=await r.json().catch(()=>({}));showError(e.error||'创建失败');return};document.getElementById('newTaskDesc').value='';showOk('🤖 任务 '+id+' 已创建，AI 正在启动...');fetch('/api/status').then(r=>r.json()).then(s=>renderTasks(s.tasks));spawnWorker(id)}


// ── WebSocket 实时更新 ──
function connect(){
  const ws=new WebSocket('ws://'+HOST+':'+WS_PORT)
  ws.onopen=()=>{
    ws.send(JSON.stringify({type:'agent:hello',agentId:'dashboard-'+Date.now(),name:'仪表盘',version:'${VERSION}',capabilities:[]}))
  }
  ws.onmessage=(e)=>{
    try{
      const m=JSON.parse(e.data)
      if(m.type==='agent:registered'){
        // 获取初始快照：用 room:history
        ws.send(JSON.stringify({type:'room:history',roomId:'#lobby',limit:60}))
        // 拉状态
        fetch('/api/status').then(r=>r.json()).then(s=>{
          renderAgents(s.agents); renderTasks(s.tasks)
        }).catch(()=>{})
      }
      if(m.type==='room:history'){ msgs=m.messages||[]; addMsg(null) }
      if(m.type==='agent:update'){ fetch('/api/status').then(r=>r.json()).then(s=>{renderAgents(s.agents);renderTasks(s.tasks)}).catch(()=>{}) }
      if(m.type==='room:message'){ addMsg(m) }
      if(m.type==='task:completed'||m.type==='task:released'||m.type==='task:dispatch'){ fetch('/api/status').then(r=>r.json()).then(s=>renderTasks(s.tasks)).catch(()=>{}) }
      if(m.type==='agent:registered'&&m.agentId!=='dashboard'){ fetch('/api/status').then(r=>r.json()).then(s=>renderAgents(s.agents)).catch(()=>{}) }
    }catch(ex){}
  }
  ws.onclose=()=>{ showError('WebSocket 断开，5 秒后重连...'); setTimeout(connect,5000) }
  ws.onerror=()=>{}
}
connect()
// 定期刷新状态
setInterval(()=>{fetch('/api/status').then(r=>r.json()).then(s=>{renderAgents(s.agents);renderTasks(s.tasks)}).catch(()=>{})},5000)
</script>
</body>
</html>`

// ═══════════════════════════════════════════════════════════════════════════
// HTTP 服务器
// ═══════════════════════════════════════════════════════════════════════════

function startHttpServer(): void {
  const httpServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (_req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    // GET / — 仪表盘
    if (_req.method === "GET" && (_req.url === "/" || _req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(DASHBOARD_HTML)
      return
    }

    // GET /api/status — JSON 快照
    if (_req.method === "GET" && _req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(agentHub.status()))
      return
    }

    // ── POST /api/tasks — 创建任务 ──
    if (_req.method === "POST" && _req.url === "/api/tasks") {
      const chunks: Buffer[] = []
      _req.on("data", (c: Buffer) => chunks.push(c))
      _req.on("end", () => {
        try {
          const { taskId, title } = JSON.parse(Buffer.concat(chunks).toString())
          if (!taskId) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "缺少 taskId" })); return }
          // 注册到 Hub 内存 + 持久化
          agentHub.registerTask(taskId, title || taskId)
          db?.saveTask({ taskId, status: "unassigned", title: title || taskId })
          process.stderr.write(`[Hub] 新任务: ${taskId} "${title}"\n`)
          res.writeHead(201, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true, taskId, title }))
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "JSON 解析失败" }))
        }
      })
      return
    }

    // ── POST /api/tasks/<id>/spawn — 拉起 Worker ──
    if (_req.method === "POST" && _req.url?.startsWith("/api/tasks/") && _req.url.endsWith("/spawn")) {
      const taskId = _req.url.slice("/api/tasks/".length, -"/spawn".length)
      if (!taskId) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "缺少 taskId" })); return }

      const hubUrl = `ws://127.0.0.1:${wsPort}`
      const repoPath = process.cwd()

      process.stderr.write(`[Hub] 🤖 拉起 Worker: ${taskId}\n`)
      const worker = spawn("node", ["dist/hub-worker.js", "--task", taskId, "--hub", hubUrl, "--repo", repoPath], {
        cwd: repoPath,
        stdio: "pipe",
        detached: true,
      })
      worker.stdout?.on("data", (d: Buffer) => process.stderr.write(`[Worker-${taskId}] ${d}`))
      worker.stderr?.on("data", (d: Buffer) => process.stderr.write(`[Worker-${taskId}] ${d}`))
      worker.on("error", (e: Error) => process.stderr.write(`[Hub] Worker 启动失败: ${e.message}\n`))
      worker.on("close", (code: number | null) => process.stderr.write(`[Hub] Worker-${taskId} 退出 (${code})\n`))
      // 不 await — detached 让 Worker 独立运行

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, taskId, hubUrl, workerPid: worker.pid }))
      return
    }

    // GET /api/health
    if (_req.method === "GET" && _req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", name: "hvip-hub", version: VERSION, wsPort, webPort, db: dbPath }))
      return
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not Found" }))
  })

  httpServer.listen(webPort, host, () => {
    process.stderr.write(`[Hub] 🌐 仪表盘 → http://${host}:${webPort}\n`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════════════════

const banner = [
  `╔══════════════════════════════════════════════════╗`,
  `║  🤖 Agent Hub v${VERSION}  独立服务器              ║`,
  `║  📡 WebSocket → ws://${host}:${String(wsPort).padEnd(35)}║`,
  `║  🌐 仪表盘   → http://${host}:${String(webPort).padEnd(34)}║`,
  `║  💾 ${dbPath.padEnd(42)}║`,
  `╚══════════════════════════════════════════════════╝`,
].join("\n")

process.stderr.write(banner + "\n")

// 持久化
const db = new HubDB(dbPath)
if (db.open()) {
  agentHub.setDB(db)
  const stats = db.stats()
  process.stderr.write(`[Hub] DB 状态: ${stats.taskCount} tasks, ${stats.messageCount} messages\n`)
}

// 启动 HTTP 仪表盘
startHttpServer()

// 启动 WebSocket Hub
agentHub.start(wsPort, host, VERSION)

// ── 优雅退出 ──────────────────────────────────────────────────────────────

function shutdown() {
  process.stderr.write("\n[Hub] 正在关闭...\n")
  agentHub.close()
  db.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// ── 保活 ──────────────────────────────────────────────────────────────────

const keepAlive = setInterval(() => {}, 60_000)
process.on("exit", () => clearInterval(keepAlive))

export {}
