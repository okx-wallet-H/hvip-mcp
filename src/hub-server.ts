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
import { URL } from "node:url"
import { agentHub } from "./adapters/agent-hub.js"
import { HubDB } from "./adapters/hub-persistence.js"
import { HubMemory } from "./adapters/hub-memory.js"
import { HubRegistry } from "./adapters/hub-registry.js"

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
  <!-- Memory -->
  <div class="card" style="grid-column:1/-1">
    <div class="card-title">
      <span>🧠 共享记忆</span>
      <span style="font-weight:400;font-size:11px">
        <input id="memSearch" placeholder="搜索记忆..." style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:2px 8px;border-radius:4px;font-size:11px;width:160px" onkeyup="searchMemory()">
        <select id="memType" onchange="searchMemory()" style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:2px 4px;border-radius:4px;font-size:11px;margin-left:4px">
          <option value="">全部</option><option value="memory">记忆</option><option value="doc">文档</option><option value="directive">指令</option><option value="skill">技能</option>
        </select>
        <span id="memStats" style="color:#484f58;margin-left:8px"></span>
      </span>
    </div>
    <div class="card-body" id="memoryPanel" style="max-height:250px"><div class="empty">加载中...</div></div>
  </div>
  <!-- Store -->
  <div class="card" style="grid-column:1/-1">
    <div class="card-title">
      <span>🛒 MCP 插件商店</span>
      <span style="font-weight:400;font-size:11px">
        <input id="storeSearch" placeholder="搜索插件..." style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:2px 8px;border-radius:4px;font-size:11px;width:140px" onkeyup="renderStore()">
        <span id="storeCount" style="color:#484f58;margin-left:8px"></span>
      </span>
    </div>
    <div class="card-body" id="storePanel" style="max-height:320px"><div class="empty">加载中...</div></div>
  </div>
  <!-- Live Feed -->
  <div class="card" style="grid-column:1/-1">
    <div class="card-title"><span>📡 实时动态</span><span id="feedLabel" style="font-weight:400;color:#484f58"></span></div>
    <div class="card-body" id="liveFeed" style="max-height:180px"><div class="empty">等待事件...</div></div>
  </div>
</div>

<script>
const HOST = '${host}'
const WS_PORT = ${wsPort}
let msgs = []
let feed = []
let taskProgress = {}  // taskId -> latest progress text

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
    const progressText = t._progress ? '<div style="font-size:11px;color:#8b949e;margin-top:2px;padding:4px;background:#0d1117;border-radius:4px;max-height:80px;overflow:hidden;white-space:pre-wrap">'+esc(t._progress)+'</div>' : ''
    const spawnBtn = (t.status==='unassigned'||t.status==='reviewed')
      ? ' <button onclick="spawnWorker(\\''+esc(t.taskId)+'\\')" style="font-size:10px;background:#1f6feb;color:white;border:none;padding:1px 8px;border-radius:8px;cursor:pointer;margin-left:4px">🤖 拉起 AI</button>'
      : ''
    return '<div class=task-row>'+
      '<b>'+esc(t.taskId)+'</b> '+esc(t.title)+
      '<span class="tag '+t.status+'">'+t.status+'</span>'+spawnBtn+progressText+
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

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;')}

// ── Live Feed + Task Progress ──
function addFeed(m){
  feed.unshift(m); if(feed.length>50) feed.pop()
  const el=document.getElementById('liveFeed')
  document.getElementById('feedLabel').textContent=feed.length+'条'
  el.innerHTML=feed.slice(0,20).map(f=>{
    return '<div class=msg-row style="font-size:12px">'+
      '<span style=color:#58a6ff>'+esc(f.from||f.agentId||'?')+'</span>'+
      ' <span class=ts>'+timeAgo(f.ts||new Date().toISOString())+'</span>'+
      '<br>'+esc((f.text||f.message||'').substring(0,200))+
      '</div>'
  }).join('')
}

function updateTaskProgress(taskId, text){
  taskProgress[taskId] = text
  fetch('/api/status').then(r=>r.json()).then(s=>{
    s.tasks.forEach(t=>{ if(t.taskId===taskId) t._progress=taskProgress[taskId] })
    renderTasks(s.tasks)
  }).catch(()=>{})
}

// ── Memory Panel ──
async function searchMemory(){const q=document.getElementById('memSearch').value.trim();const url=q?'/api/memory/search?q='+encodeURIComponent(q):'/api/memory';const r=await fetch(url).catch(()=>null);if(!r)return;const entries=await r.json();const stats=await fetch('/api/memory/stats').then(r=>r.json()).catch(()=>({}));document.getElementById('memStats').textContent=stats.total+'条';const el=document.getElementById('memoryPanel');if(!entries.length){el.innerHTML='<div class=empty>无匹配记忆</div>';return}
el.innerHTML=entries.map(e=>{const conf=Math.round(e.confidence*100);const bar='<div style="display:inline-block;width:50px;height:6px;background:#21262d;border-radius:3px;vertical-align:middle;margin:0 4px"><div style="width:'+conf+'%;height:100%;background:'+(conf>70?'#3fb950':conf>30?'#d29922':'#f85149')+';border-radius:3px"></div></div>';const ts=timeAgo(e.createdAt);return'<div class=msg-row style="display:flex;gap:6px;align-items:flex-start"><span style="font-size:10px;min-width:50px;color:#484f58">'+ts+'</span><span class="badge" style="font-size:10px">'+esc(e.type)+'</span><span style="flex:1;font-size:12px">'+esc(e.text.length>200?e.text.slice(0,200)+'...':e.text)+'</span>'+bar+'<span style="font-size:10px;color:#484f58">'+conf+'%</span><span style="font-size:10px;color:#8b949e">'+esc(e.agentId.slice(0,12))+'</span></div>'}).join('')}

// ── Store Panel ──
let storeData = {}
async function renderStore(){const q=document.getElementById('storeSearch').value.trim();const url=q?'/api/store/search?q='+encodeURIComponent(q):'/api/store';const r=await fetch(url).catch(()=>null);if(!r)return;let cats=[],count=0;if(q){const list=await r.json();cats=[{category:'搜索结果',plugins:list}];list.forEach(()=>count++)}else{storeData=await r.json();cats=Object.entries(storeData).map(([k,v])=>({category:k,plugins:v}));Object.values(storeData).forEach(v=>v.forEach(()=>count++))}document.getElementById('storeCount').textContent=count+'个插件';const el=document.getElementById('storePanel');if(!count){el.innerHTML='<div class=empty>无匹配插件</div>';return}
el.innerHTML=cats.map(c=>{if(!c.plugins.length)return'';return'<div style="margin-bottom:10px"><div style="font-size:11px;color:#58a6ff;font-weight:600;margin-bottom:4px">'+esc(c.category)+' ('+c.plugins.length+')</div>'+c.plugins.map(p=>'<div class=msg-row style="display:flex;gap:6px;align-items:flex-start;padding:4px 0"><span style="min-width:14px;font-size:12px">'+(p.verified?'✅':'')+'</span><div style="flex:1"><b style="font-size:12px;color:#c9d1d9">'+esc(p.name)+'</b> <span class=badge style="font-size:9px">'+esc(p.stars)+' ★</span><br><span style="font-size:11px;color:#8b949e">'+esc(p.description)+'</span><br><span style="font-size:10px;color:#484f58">📦 '+esc(p.install)+'</span> <span style="font-size:10px;color:#58a6ff;cursor:pointer" onclick="navigator.clipboard.writeText(\''+esc(p.install)+'\').then(()=>showOk(\'已复制安装命令\'))">📋复制</span></div></div>').join('')+'</div>'}).join('')}
function loadStore(){renderStore()}

function renderMemoryStats(){fetch('/api/memory/stats').then(r=>r.json()).then(s=>{document.getElementById('memStats').textContent=s.total+'条';searchMemory()}).catch(()=>{})}


function showError(msg){const b=document.getElementById('errorBanner');b.textContent=msg;b.style.display='block';setTimeout(()=>b.style.display='none',8000)}

function showOk(msg){const b=document.getElementById('errorBanner');b.textContent=msg;b.style.background='#0d3320';b.style.color='#3fb950';b.style.display='block';setTimeout(()=>{b.style.display='none';b.style.background='#490202';b.style.color='#f85149'},5000)}

function genTaskId(desc){const ts=Date.now().toString(36).slice(-4);const rnd=Math.random().toString(36).slice(2,6);const market=/\b(BTC|ETH|SOL|行情|价格|多少钱|涨跌|K线|走势|大盘|资金费率)\b/i;const prefix=market.test(desc)?'M':'C';const w=desc.replace(/[^a-zA-Z0-9]/g,'-').split(/-+/).filter(Boolean).slice(0,2).join('-').toLowerCase();return prefix+'-'+(w||'task')+'-'+ts+'-'+rnd}

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
        renderMemoryStats(); loadStore()
      }
      if(m.type==='room:history'){ msgs=m.messages||[]; addMsg(null) }
      if(m.type==='agent:update'){ fetch('/api/status').then(r=>r.json()).then(s=>{renderAgents(s.agents);renderTasks(s.tasks)}).catch(()=>{}) }
      if(m.type==='room:message'){
        addMsg(m); addFeed(m)
        // 提取 Worker 进度更新
        const wid=m.from||''
        if(wid.startsWith('worker-')&&m.text){
          const tidMatch=wid.match(/worker-(\S+?)-\d+/)
          if(tidMatch) updateTaskProgress(tidMatch[1], m.text.slice(-500))
        }
      }
      if(m.type==='task:completed'||m.type==='task:released'||m.type==='task:dispatch'){ fetch('/api/status').then(r=>r.json()).then(s=>renderTasks(s.tasks)).catch(()=>{}) }
      if(m.type==='agent:registered'||m.type==='agent:update'||m.type==='room:member_joined'){ addFeed({from:'system',text:'Agent '+m.agentId+' '+m.type,ts:new Date().toISOString()}) }
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

const workers: ReturnType<typeof spawn>[] = []

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
          const { taskId, title } = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
          if (!taskId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "缺少 taskId" })); return }
          // 注册到 Hub 内存 + 持久化
          agentHub.registerTask(taskId, title || taskId)
          db?.saveTask({ taskId, status: "unassigned", title: title || taskId })
          process.stderr.write(`[Hub] 新任务: ${taskId} "${title}"\n`)
          res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ ok: true, taskId, title }))
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ error: "JSON 解析失败" }))
        }
      })
      return
    }

    // ── POST /api/tasks/<id>/spawn — 拉起 Worker ──
    if (_req.method === "POST" && _req.url?.startsWith("/api/tasks/") && _req.url.endsWith("/spawn")) {
      const rawId = _req.url.slice("/api/tasks/".length, -"/spawn".length)
      const taskId = decodeURIComponent(rawId)
      if (!taskId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "缺少 taskId" })); return }

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
      worker.on("close", (code: number | null) => {
        process.stderr.write(`[Hub] Worker-${taskId} 退出 (${code})\n`)
        const idx = workers.indexOf(worker); if (idx >= 0) workers.splice(idx, 1)
      })
      workers.push(worker)
      process.stderr.write(`[Hub] 活跃 Worker: ${workers.length}\n`)
      // 不 await — detached 让 Worker 独立运行

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: true, taskId, hubUrl, workerPid: worker.pid }))
      return
    }

    // ── Memory API ──
    if (_req.method === "POST" && _req.url === "/api/memory") {
      const chunks: Buffer[] = []
      _req.on("data", (c: Buffer) => chunks.push(c))
      _req.on("end", () => {
        try {
          const { type, text, agentId, tags, confidence, parentId } = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
          if (!text || !agentId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "text + agentId required" })); return }
          const entry = memory.store({ type, agentId, text, tags, confidence, parentId })
          res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" })
          res.end(JSON.stringify(entry))
        } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "JSON parse error" })) }
      })
      return
    }
    if (_req.method === "GET" && _req.url === "/api/memory/stats") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(memory.stats()))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/memory/search")) {
      const url = new URL(_req.url, `http://${host}:${webPort}`)
      const q = url.searchParams.get("q") || ""
      const entries = memory.search(q, 30)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entries))
      return
    }
    if (_req.method === "GET" && _req.url === "/api/memory") {
      const entries = memory.recent(30)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entries))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/memory/by-id/")) {
      const id = _req.url.slice("/api/memory/by-id/".length)
      const entry = memory.get(id)
      if (!entry) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "not found" })); return }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entry))
      return
    }

    // ── Registry API (MCP商店) ──
    if (_req.method === "GET" && _req.url === "/api/store") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(registry.byCategory()))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/store/search")) {
      const qs = (_req.url || "").split("?")[1] || ""; const params = new Map<string,string>()
      qs.split("&").forEach(p => { const [k,v] = p.split("="); if(k) params.set(decodeURIComponent(k), decodeURIComponent(v||"")) })
      const q = params.get("q") || ""; const cat = params.get("cat") || ""
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(registry.search(q, cat || undefined, 30)))
      return
    }
    if (_req.method === "GET" && _req.url?.startsWith("/api/store/")) {
      const id = _req.url.slice("/api/store/".length)
      const p = registry.get(id);
      if (!p) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "not found" })); return }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(p)); return
    }
    if (_req.method === "POST" && _req.url === "/api/store") {
      const chunks: Buffer[] = []; _req.on("data",(c:Buffer)=>chunks.push(c)); _req.on("end",()=>{
        try { const b = JSON.parse(Buffer.concat(chunks).toString("utf-8")); const p = registry.add(b); res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(p)) }
        catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "parse error" })) }
      }); return
    }

    // GET /api/health
    if (_req.method === "GET" && _req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ status: "ok", name: "hvip-hub", version: VERSION, wsPort, webPort, db: dbPath, registry: registry.all().length + " plugins" }))
      return
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
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

// 记忆系统
const memoryPath = flag("memory-db") || process.env.HUB_MEMORY_DB || ".hub/memory.db"
const memory = new HubMemory(memoryPath)
const memOk = memory.open()
if (memOk) {
  const ms = memory.stats()
  process.stderr.write(`[Hub] 🧠 记忆: ${ms.total} 条 (doc:${ms.byType.doc||0} directive:${ms.byType.directive||0} memory:${ms.byType.memory||0} skill:${ms.byType.skill||0})\n`)
}

// 插件商店
const registryPath = flag("registry-db") || process.env.HUB_REGISTRY_DB || ".hub/registry.db"
const registry = new HubRegistry(registryPath)
registry.open()

// 启动 HTTP 仪表盘
startHttpServer()

// 启动 WebSocket Hub
agentHub.start(wsPort, host, VERSION)

// ── 优雅退出 ──────────────────────────────────────────────────────────────

function shutdown() {
  process.stderr.write("\n[Hub] 正在关闭...\n")
  for (const w of workers) { try { w.kill() } catch {} }
  agentHub.close()
  db.close()
  memory.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// ── 保活 ──────────────────────────────────────────────────────────────────

const keepAlive = setInterval(() => {}, 60_000)
process.on("exit", () => clearInterval(keepAlive))

export {}
