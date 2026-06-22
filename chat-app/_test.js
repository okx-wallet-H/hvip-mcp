
// ═══════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════
let state = {
  token: null,
  username: null,
  hasKeys: false,
  keyHint: null,
  authMode: 'unlock', // 'unlock' | 'register'
  messages: [],
  streaming: false,
  abortController: null,
  currentConvId: null,
}

// ═══════════════════════════════════════════════════
// DOM helpers
// ═══════════════════════════════════════════════════
const $ = id => document.getElementById(id)
const show = (el, display='flex') => { el.style.display = display }
const hide = el => { el.style.display = 'none' }

// ═══════════════════════════════════════════════════
// Theme
// ═══════════════════════════════════════════════════
function toggleTheme() {
  const d = document.documentElement
  const isDark = d.getAttribute('data-theme') === 'dark'
  d.setAttribute('data-theme', isDark ? 'light' : 'dark')
  $('theme-btn').textContent = isDark ? '🌙' : '☀️'
  localStorage.setItem('chat-theme', isDark ? 'light' : 'dark')
}
;(function(){
  const s = localStorage.getItem('chat-theme')
  if (s) document.documentElement.setAttribute('data-theme', s)
  $('theme-btn').textContent = s === 'dark' ? '☀️' : '🌙'
})()

// ═══════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════
let PIN_VISIBLE = false
$('pin-toggle').addEventListener('click', () => {
  PIN_VISIBLE = !PIN_VISIBLE
  $('auth-pin').type = PIN_VISIBLE ? 'text' : 'password'
  $('pin-toggle').textContent = PIN_VISIBLE ? '🙈' : '👁'
})

function toggleAuthMode() {
  state.authMode = state.authMode === 'unlock' ? 'register' : 'unlock'
  if (state.authMode === 'register') {
    $('auth-title').textContent = '创建账户'
    $('auth-sub').textContent = '设置用户名和 PIN，绑定你的 OKX API Key'
    $('auth-btn').textContent = '创建并解锁'
    $('switch-link').textContent = '已有账户？去解锁'
  } else {
    $('auth-title').textContent = '解锁账户'
    $('auth-sub').textContent = '输入 PIN 解锁，开始 AI 交易'
    $('auth-btn').textContent = '解锁'
    $('switch-link').textContent = '没有账户？去注册'
  }
  $('auth-error').classList.remove('show')

async function handleAuth() {
  const username = $('auth-username').value.trim()
  const pin = $('auth-pin').value
  const errEl = $('auth-error')

  if (!username || username.length < 3) { errEl.textContent = '用户名至少 3 个字符'; errEl.classList.add('show'); return }
  if (!pin || pin.length < 4) { errEl.textContent = 'PIN 至少 4 位'; errEl.classList.add('show'); return }

  $('auth-btn').disabled = true
  errEl.classList.remove('show')

  try {
    if (state.authMode === 'register') {
      const r = await fetch('/api/v2/auth/register', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({username, pin})
      })
      const d = await r.json()
      if (!d.ok) { errEl.textContent = d.error || '注册失败'; errEl.classList.add('show'); $('auth-btn').disabled = false; return }
    }

    // Unlock
    const r = await fetch('/api/v2/auth/unlock', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({username, pin})
    })
    const d = await r.json()
    if (!d.ok) { errEl.textContent = d.error || '解锁失败'; errEl.classList.add('show'); $('auth-btn').disabled = false; return }

    state.token = d.sessionToken
    state.username = d.username
    state.hasKeys = d.hasKeys
    state.keyHint = d.keyHint

    if (!d.hasKeys) {
      showKeyBinding()
    } else {
      showChat()
    }
  } catch (e) {
    errEl.textContent = '网络错误: ' + e.message
    errEl.classList.add('show')
  }
  $('auth-btn').disabled = false
}

// Enter key in auth
$('auth-username').addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-pin').focus() })
$('auth-pin').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth() })

// ═══════════════════════════════════════════════════
// Key Binding
// ═══════════════════════════════════════════════════
function showKeyBinding() {
  hide($('auth-screen'))
  hide($('chat-screen'))
  show($('key-screen'))
  $('key-pin').value = ''
  $('key-error').classList.remove('show')
  $('key-ok').classList.remove('show')
}

function skipKeys() {
  state.hasKeys = false
  showChat()
}

async function handleSaveKeys() {
  const apiKey = $('key-apikey').value.trim()
  const secret = $('key-secret').value.trim()
  const passphrase = $('key-passphrase').value.trim()
  const pin = $('key-pin').value
  const isDemo = $('key-demo').checked
  const errEl = $('key-error')

  if (!apiKey || !secret || !passphrase) { errEl.textContent = '请填写完整的 OKX API 信息'; errEl.classList.add('show'); return }
  if (!pin || pin.length < 4) { errEl.textContent = '请输入 PIN 以加密存储'; errEl.classList.add('show'); return }

  $('key-btn').disabled = true
  errEl.classList.remove('show')

  try {
    const r = await fetch('/api/v2/auth/keys', {
      method: 'PUT', headers: {'Content-Type':'application/json', Authorization:'Bearer '+state.token},
      body: JSON.stringify({apiKey, secret, passphrase, isDemo, pin})
    })
    const d = await r.json()
    if (!d.ok) { errEl.textContent = d.error || '保存失败'; errEl.classList.add('show'); $('key-btn').disabled = false; return }

    state.hasKeys = true
    state.keyHint = apiKey.slice(0,4) + '****'
    $('key-ok').classList.add('show')
    setTimeout(showChat, 800)
  } catch (e) {
    errEl.textContent = '网络错误: ' + e.message
    errEl.classList.add('show')
  }
  $('key-btn').disabled = false
}

function bindKeys() { showKeyBinding() }

// ═══════════════════════════════════════════════════
// Chat
// ═══════════════════════════════════════════════════
async function showChat() {
  hide($('auth-screen'))
  hide($('key-screen'))
  show($('chat-screen'), 'flex')
  $('chat-name').textContent = state.username
  $('chat-avatar').textContent = state.username[0].toUpperCase()
  $('key-badge').style.display = state.hasKeys ? 'inline' : 'none'
  $('btn-bindkey').style.display = state.hasKeys ? 'none' : 'inline-block'
  $('welcome-status').textContent = state.hasKeys
    ? '374 个 OKX 工具就绪 · 直接提问或交易'
    : '公开行情可用 · 绑定 OKX Key 解锁交易'

  // 创建新对话 + 加载最新对话历史
  await loadOrCreateConversation()
  $('chat-input').focus()
}

async function loadOrCreateConversation() {
  try {
    // 创建新对话
    const r = await fetch('/api/v2/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ title: '新的对话' })
    })
    if (r.ok) {
      const data = await r.json()
      state.currentConvId = data.id
      // 新对话不需要加载历史
    }
  } catch { /* 非关键 */ }
}

// ── Conversation History ─────────────────────────────────

function toggleHistory() {
  var panel = $('history-panel'), overlay = $('history-overlay')
  var isOpen = panel.classList.contains('open')
  if (isOpen) { closeHistory() }
  else { loadConversations(); panel.classList.add('open'); overlay.style.display = 'block' }
}
function closeHistory() {
  $('history-panel').classList.remove('open')
  $('history-overlay').style.display = 'none'
}

async function loadConversations() {
  var list = $('history-list')
  list.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">加载中...</div>'
  try {
    var r = await fetch('/api/v2/chat/sessions', {
      headers: { Authorization: 'Bearer ' + state.token }
    })
    if (!r.ok) { list.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">暂无历史</div>'; return }
    var chats = await r.json()
    if (!Array.isArray(chats) || !chats.length) {
      list.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">暂无历史</div>'
      return
    }
    list.innerHTML = chats.map(function(c) {
      var isActive = c.id === state.currentConvId
      var t = c.title || '未命名'
      var time = c.created_at ? c.created_at.slice(5,16).replace('T',' ') : ''
      return '<div class="h-item'+(isActive?' active':'')+'" onclick="switchChat(\''+c.id+'\')">' +
        '<span class="h-title">'+esc(t)+'</span>' +
        '<span class="h-time">'+time+'</span>' +
        '<button class="h-del" onclick="event.stopPropagation();deleteChat(\''+c.id+'\')" title="删除">🗑</button>' +
        '</div>'
    }).join('')
  } catch { list.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">加载失败</div>' }
}

async function switchChat(id) {
  if (id === state.currentConvId) { closeHistory(); return }
  try {
    var r = await fetch('/api/v2/chat/history?conversationId=' + id, {
      headers: { Authorization: 'Bearer ' + state.token }
    })
    if (r.ok) {
      var msgs = await r.json()
      state.currentConvId = id
      state.messages = []
      // Clear chat UI
      var list = $('msg-list')
      var welcome = $('welcome')
      list.innerHTML = ''
      if (welcome) list.appendChild(welcome)
      // Restore messages
      if (Array.isArray(msgs)) {
        msgs.forEach(function(m) {
          if (m.role === 'user' || m.role === 'assistant') {
            addMsg(m.role, m.content || '')
          }
        })
      }
      // If no messages, show welcome
      if (!msgs || !msgs.length) {
        if (welcome) welcome.style.display = ''
      } else {
        if (welcome) welcome.style.display = 'none'
      }
    }
  } catch {}
  closeHistory()
  loadConversations()
}

async function newChat() {
  try {
    var r = await fetch('/api/v2/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ title: '新的对话' })
    })
    if (r.ok) {
      var data = await r.json()
      state.currentConvId = data.id
      state.messages = []
      var list = $('msg-list')
      list.innerHTML = ''
      var w = document.createElement('div')
      w.className = 'welcome'; w.id = 'welcome'
      w.innerHTML = '<div class="w-icon">🤖</div><h2>AI 交易助手</h2><p id="welcome-status">374 个 OKX 工具就绪 · 直接提问</p><div class="hints">'+getHintButtons()+'</div>'
      list.appendChild(w)
    }
  } catch {}
  closeHistory()
  loadConversations()
}

async function deleteChat(id) {
  if (!confirm('删除此会话？')) return
  try {
    await fetch('/api/v2/chat/history?conversationId=' + id, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + state.token }
    })
    if (id === state.currentConvId) {
      state.currentConvId = null
      state.messages = []
      $('msg-list').innerHTML = '<div class="welcome" id="welcome"><div class="w-icon">🤖</div><h2>AI 交易助手</h2><p id="welcome-status">374 个 OKX 工具就绪 · 直接提问</p><div class="hints">'+getHintButtons()+'</div></div>'
    }
  } catch {}
  loadConversations()
}

// ── Persist ──────────────────────────────────────────────

async function persistMessage(msg) {
  if (!state.currentConvId) return
  try {
    await fetch('/api/v2/chat/history/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({
        conversationId: state.currentConvId,
        role: msg.role,
        content: msg.content
      })
    })
  } catch {}
}

async function lock() {
  if (state.token) {
    await fetch('/api/v2/auth/lock', {
      method: 'POST', headers: {Authorization: 'Bearer '+state.token}
    })
  }
  state.token = null; state.username = null; state.hasKeys = false
  state.messages = []; state.streaming = false
  $('msg-list').innerHTML = `<div class="welcome" id="welcome">
    <div class="w-icon">🤖</div><h2>AI 交易助手</h2>
    <p id="welcome-status">公开行情可用 · 绑定 OKX Key 解锁交易</p>
    <div class="hints">${getHintButtons()}</div></div>`
  hide($('chat-screen'))
  show($('auth-screen'))
  $('auth-pin').value = ''
}

function getHintButtons() {
  return ['₿ BTC 价格','Ξ ETH 费率','📊 市场情绪','📈 RSI 分析','🔥 热门币种','💡 交易机会']
    .map((t,i) => `<button onclick="quickAsk('${['BTC 现在什么价格？','ETH 资金费率多少？','市场情绪怎么样？','BTC RSI 超买还是超卖？','最近有什么热门币？','帮我分析一下现在的交易机会'][i]}')">${t}</button>`).join('')
}

function quickAsk(text) { $('chat-input').value = text; send() }

function onInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}
$('chat-input').addEventListener('input', function(){
  this.style.height = 'auto'
  this.style.height = Math.min(this.scrollHeight, 110) + 'px'
})

// ── SSE Chat ──
async function send() {
  const text = $('chat-input').value.trim()
  if (!text || state.streaming) return

  $('chat-input').value = ''
  $('chat-input').style.height = 'auto'
  $('send-btn').disabled = true
  state.streaming = true
  $('chat-status').textContent = '思考中...'

  const welcome = $('welcome')
  if (welcome) welcome.remove()

  addMsg('user', text)
  persistMessage({ role: 'user', content: text })
  const aiId = addMsg('ai', '', true)

  // Build history (last 30 msgs)
  const history = state.messages.slice(-30).filter(function(m){return m.content}).map(function(m){return {role:m.role,content:m.content}})
  history.push({role:'user', content:text})

  const controller = new AbortController()
  state.abortController = controller

  try {
    const r = await fetch('/api/v2/chat/stream', {
      method: 'POST',
      headers: {'Content-Type':'application/json', Authorization:'Bearer '+state.token},
      body: JSON.stringify({messages:history}),
      signal: controller.signal,
    })

    if (!r.ok) {
      const et = await r.text()
      let em = `HTTP ${r.status}`
      try { em = JSON.parse(et).error || em } catch {}
      throw new Error(em)
    }

    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const {done, value} = await reader.read()
      if (done) break

      buf += decoder.decode(value, {stream:true})

      while (buf.includes('\n\n')) {
        const idx = buf.indexOf('\n\n')
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)

        const em = frame.match(/^event:\s*(.+)$/m)
        const dm = frame.match(/^data:\s*(.+)$/m)
        if (!em || !dm) continue

        const type = em[1].trim()
        let data
        try { data = JSON.parse(dm[1]) } catch { continue }

        handleSSE(type, data, aiId)
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      updateMsg(aiId, el => {
        const body = el.querySelector('.body')
        body.textContent = (body.textContent || '') + '\n❌ 服务暂不可用，请稍后再试'
        el.classList.remove('streaming')
      })
    }
  }

  state.streaming = false
  state.abortController = null
  $('send-btn').disabled = false
  $('chat-status').textContent = ''
  updateMsg(aiId, el => el.classList.remove('streaming'))
}

function handleSSE(type, data, aiId) {
  switch (type) {
    case 'text':
      updateMsg(aiId, el => {
        const body = el.querySelector('.body')
        body.textContent += data.delta || ''
        scrollBottom()
      })
      break

    case 'tool_start':
	      // 静默执行
	      break

    case 'tool_end':
	      if (data.toolError) $('chat-status').textContent = '获取失败'
	      break

    case 'done':
      updateMsg(aiId, el => {
        el.dataset.tokens = `${data.tokens?.input||0}↑ ${data.tokens?.output||0}↓`
      })
      $('chat-status').textContent = data.model ? `${data.tokens?.input||0}↑ ${data.tokens?.output||0}↓ · ${data.model}` : ''
      break

    case 'error':
      updateMsg(aiId, el => {
        const body = el.querySelector('.body')
        if (!body.textContent) body.textContent = '❌ ' + data.message
      })
      $('chat-status').textContent = ''
      break
  }
}

// ── UI helpers ──
function addMsg(role, content, streaming) {
  const el = document.createElement('div')
  el.className = 'msg ' + role
  if (streaming) el.classList.add('streaming')
  el.innerHTML = `<div class="sender">${role==='user'?'👤 你':'🤖 hvip AI'}</div><div class="body">${esc(content)}</div>`
  if (streaming) {
    const cursor = document.createElement('span')
    cursor.className = 'cursor'
    el.querySelector('.body').appendChild(cursor)
  }
  $('msg-list').appendChild(el)
  scrollBottom()

  const id = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6)
  el.id = id
  state.messages.push({role, content, elId: id})
  return id
}

function updateMsg(id, fn) {
  const el = document.getElementById(id)
  if (el) fn(el)
}

function addToolCard(msgId, tool) {
  const el = document.getElementById(msgId)
  if (!el) return

  let container = el.querySelector('.tool-cards')
  if (!container) {
    container = document.createElement('div')
    container.className = 'tool-cards'
    el.appendChild(container)
  }

  const card = document.createElement('div')
  card.className = 'tool-card'
  card.id = 'tc-' + tool.id
  card.innerHTML = `
    <div class="tc-header">
      <span class="spinner"></span>
      <span class="tc-name">${esc(tool.name)}</span>
    </div>
    <div class="tc-input">Input: ${esc(JSON.stringify(tool.input).slice(0,100))}</div>
  `
  container.appendChild(card)
  scrollBottom()
}

function updateToolCard(msgId, toolId, data) {
  const card = document.getElementById('tc-' + toolId)
  if (!card) return

  card.className = 'tool-card ' + data.status
  let html = `<div class="tc-header">`
  if (data.status === 'done') html += `✅ `
  else if (data.status === 'error') html += `❌ `
  html += `<span class="tc-name">${esc(card.querySelector('.tc-name')?.textContent || '')}</span>`
  if (data.duration) html += `<span class="tc-time">${data.duration}ms</span>`
  html += `</div>`

  if (data.result) {
    const rs = typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
    html += `<div class="tc-result">${esc(rs.slice(0,200))}</div>`
  }
  if (data.error) {
    html += `<div class="tc-error">${esc(data.error)}</div>`
  }

  card.querySelector('.tc-input')?.remove()
  card.innerHTML = html
  scrollBottom()
}

function esc(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function scrollBottom() {
  $('msg-list').scrollTop = $('msg-list').scrollHeight
}
