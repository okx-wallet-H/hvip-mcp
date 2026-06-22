

// ═══ State ═══
let state = {
  token: null, username: null, hasKeys: false, keyHint: null,
  authMode: 'unlock', messages: [], streaming: false, abortController: null,
  currentConvId: null
};
const $ = id => document.getElementById(id);
const show = (el, d) => { el.style.display = d || 'flex'; };
const hide = el => { el.style.display = 'none'; };

// ═══ Theme ═══
function toggleTheme() {
  var d = document.documentElement;
  var is = d.getAttribute('data-theme') === 'dark';
  d.setAttribute('data-theme', is ? 'light' : 'dark');
}
(function(){});

(function(){ var s=localStorage.getItem('chat-theme'); if(s) document.documentElement.setAttribute('data-theme',s); })();

// ═══ Auth ═══
var pinVisible = false;
document.getElementById('pin-toggle').addEventListener('click', function(){
  pinVisible = !pinVisible;
  document.getElementById('auth-pin').type = pinVisible ? 'text' : 'password';
});

function toggleAuthMode() {
  state.authMode = state.authMode === 'unlock' ? 'register' : 'unlock';
  if (state.authMode === 'register') {
    $('auth-title').textContent = '创建账户';
    $('auth-btn').textContent = '创建并解锁';
    $('switch-link').textContent = '已有账户？去解锁';
  } else {
    $('auth-title').textContent = '解锁账户';
    $('auth-btn').textContent = '解锁';
    $('switch-link').textContent = '没有账户？去注册';
  }
  $('auth-error').classList.remove('show');
}

async function handleAuth() {
  var username = $('auth-username').value.trim();
  var pin = $('auth-pin').value;
  var errEl = $('auth-error');
  if (!username || username.length < 3) { errEl.textContent = '用户名至少 3 个字符'; errEl.classList.add('show'); return; }
  if (!pin || pin.length < 4) { errEl.textContent = 'PIN 至少 4 位'; errEl.classList.add('show'); return; }
  $('auth-btn').disabled = true;
  errEl.classList.remove('show');
  try {
    if (state.authMode === 'register') {
      var r1 = await fetch('/api/v2/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:username,pin:pin}) });
      var d1 = await r1.json();
      if (!d1.ok) { errEl.textContent = d1.error || '注册失败'; errEl.classList.add('show'); $('auth-btn').disabled = false; return; }
    }
    var r2 = await fetch('/api/v2/auth/unlock', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:username,pin:pin}) });
    var d2 = await r2.json();
    if (!d2.ok) { errEl.textContent = d2.error || '解锁失败'; errEl.classList.add('show'); $('auth-btn').disabled = false; return; }
    state.token = d2.sessionToken; state.username = d2.username; state.hasKeys = d2.hasKeys; state.keyHint = d2.keyHint;
    if (!d2.hasKeys) { showKeyBinding(); } else { showChat(); }
  } catch(e) { errEl.textContent = '网络错误'; errEl.classList.add('show'); }
  $('auth-btn').disabled = false;
}
document.getElementById('auth-username').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('auth-pin').focus(); });
document.getElementById('auth-pin').addEventListener('keydown', function(e){ if(e.key==='Enter') handleAuth(); });

// ═══ Key Binding ═══
function showKeyBinding() { hide($('auth-screen')); hide($('chat-screen')); show($('key-screen')); $('key-pin').value=''; $('key-error').classList.remove('show'); $('key-ok').classList.remove('show'); }
function skipKeys() { state.hasKeys = false; showChat(); }
function bindKeys() { showKeyBinding(); }

async function handleSaveKeys() {
  var apiKey = $('key-apikey').value.trim();
  var secret = $('key-secret').value.trim();
  var pp = $('key-passphrase').value.trim();
  var pin = $('key-pin').value;
  var demo = $('key-demo').checked;
  var errEl = $('key-error');
  if (!apiKey || !secret || !pp) { errEl.textContent = '请填写完整的 OKX API 信息'; errEl.classList.add('show'); return; }
  if (!pin || pin.length < 4) { errEl.textContent = '请输入 PIN 以加密存储'; errEl.classList.add('show'); return; }
  $('key-btn').disabled = true; errEl.classList.remove('show');
  try {
    var r = await fetch('/api/v2/auth/keys', { method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+state.token}, body:JSON.stringify({apiKey:apiKey,secret:secret,passphrase:pp,isDemo:demo,pin:pin}) });
    var d = await r.json();
    if (!d.ok) { errEl.textContent = d.error || '保存失败'; errEl.classList.add('show'); $('key-btn').disabled = false; return; }
    state.hasKeys = true; state.keyHint = apiKey.slice(0,4)+'****';
    $('key-ok').classList.add('show');
    setTimeout(showChat, 800);
  } catch(e) { errEl.textContent = '网络错误'; errEl.classList.add('show'); }
  $('key-btn').disabled = false;
}

// ═══ Chat ═══
async function showChat() {
  hide($('auth-screen')); hide($('key-screen')); show($('chat-screen'), 'flex');
  $('chat-name').textContent = state.username;
  $('chat-avatar').textContent = state.username[0].toUpperCase();
  $('key-badge').style.display = state.hasKeys ? 'inline' : 'none';
  $('btn-bindkey').style.display = state.hasKeys ? 'none' : 'inline-block';
  $('welcome-status').textContent = state.hasKeys ? 'OKX 工具就绪' : '公开行情可用';
  try {
    var cr = await fetch('/api/v2/chat/sessions', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+state.token}, body:JSON.stringify({title:'新的对话'}) });
    if (cr.ok) { var cd = await cr.json(); state.currentConvId = cd.id; }
  } catch(e) {}
  $('chat-input').focus();
}

async function lock() {
  if (state.token) { await fetch('/api/v2/auth/lock', { method:'POST', headers:{Authorization:'Bearer '+state.token} }).catch(function(){}); }
  state.token = null; state.username = null; state.hasKeys = false;
  state.messages = []; state.streaming = false; state.currentConvId = null;
  $('msg-list').innerHTML = '<div class="welcome" id="welcome"><div class="w-icon">🤖</div><h2>AI 交易助手</h2><p id="welcome-status">公开行情可用</p><div class="hints">'+getHintBtns()+'</div></div>';
  hide($('chat-screen')); show($('auth-screen')); $('auth-pin').value = '';
}

function getHintBtns() {
  var btns = ["₿ BTC 价格","Ξ ETH 费率","📊 市场情绪","📈 RSI 分析","🔥 热门币种","💡 交易机会"];
  var qs = ["BTC 现在什么价格？","ETH 资金费率多少？","市场情绪怎么样？","BTC RSI 超买还是超卖？","最近有什么热门币？","帮我分析一下现在的交易机会"];
  var h = "";
  for (var i = 0; i < btns.length; i++) {
    h += "<button onclick=quickAsk('" + qs[i] + "')>" + btns[i] + "</button>";
  }
  return h;
}

function quickAsk(text) { $('chat-input').value = text; send(); }
function onInputKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
document.getElementById('chat-input').addEventListener('input', function(){ this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,110)+'px'; });

// ═══ SSE Chat ═══
async function send() {
  var text = $('chat-input').value.trim();
  if (!text || state.streaming) return;
  $('chat-input').value = ''; $('chat-input').style.height = 'auto';
  $('send-btn').disabled = true; state.streaming = true;
  $('chat-status').textContent = '';
  var welcome = $('welcome'); if (welcome) welcome.remove();
  addMsg('user', text);
  persistMsg({role:'user',content:text});
  var aiId = addMsg('ai', '', true);

  var history = state.messages.slice(-30).filter(function(m){return m.content}).map(function(m){return {role:m.role,content:m.content}});
  history.push({role:'user', content:text});

  var ctrl = new AbortController(); state.abortController = ctrl;
  try {
    var r = await fetch('/api/v2/chat/stream', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token}, body:JSON.stringify({messages:history}), signal:ctrl.signal });
    if (!r.ok) { var et=await r.text(); var em='HTTP '+r.status; try{em=JSON.parse(et).error||em}catch(e){} throw new Error(em); }
    var reader = r.body.getReader(); var dec = new TextDecoder(); var buf = '';
    while (true) {
      var part = await reader.read(); if (part.done) break;
      buf += dec.decode(part.value, {stream:true});
      while (buf.includes('\n\n')) {
        var idx = buf.indexOf('\n\n'); var frame = buf.slice(0,idx); buf = buf.slice(idx+2);
        var em = frame.match(/^event:\s*(.+)$/m); var dm = frame.match(/^data:\s*(.+)$/m);
        if (!em || !dm) continue;
        var type = em[1].trim(); var data;
        try { data = JSON.parse(dm[1]); } catch(e) { continue; }
        handleSSE(type, data, aiId);
      }
    }
  } catch(e) {
    if (e.name !== 'AbortError') {
      updateMsg(aiId, function(el){ var b=el.querySelector('.body'); b.textContent=(b.textContent||'')+'\n❌ 服务暂不可用'; el.classList.remove('streaming'); });
    }
  }
  state.streaming = false; state.abortController = null;
  $('send-btn').disabled = false; $('chat-status').textContent = '';
  updateMsg(aiId, function(el){ el.classList.remove('streaming'); });
}

function handleSSE(type, data, aiId) {
  if (type === 'text') {
    updateMsg(aiId, function(el){ el.querySelector('.body').textContent += data.delta || ''; scrollBottom(); });
  } else if (type === 'done') {
    updateMsg(aiId, function(el){
      var body = el.querySelector('.body');
      var m = state.messages.filter(function(x){return x.elId===aiId}).pop();
      if (m) m.content = body ? body.textContent : (data.text || '');
    });
    persistMsg({role:'assistant',content:data.text||''});
  } else if (type === 'error') {
    updateMsg(aiId, function(el){ var b=el.querySelector('.body'); if(!b.textContent) b.textContent='❌ '+data.message; });
  }
}

async function persistMsg(msg) {
  if (!state.currentConvId) return;
  try { await fetch('/api/v2/chat/history/save', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token}, body:JSON.stringify({conversationId:state.currentConvId,role:msg.role,content:msg.content}) }); } catch(e) {}
}

// ═══ History Sidebar ═══
function toggleHistory() {
  var panel = $('history-panel'), overlay = $('history-overlay');
  if (panel.classList.contains('open')) { closeHistory(); }
  else { loadConversations(); panel.classList.add('open'); overlay.style.display='block'; }
}
function closeHistory() { $('history-panel').classList.remove('open'); $('history-overlay').style.display='none'; }

async function loadConversations() {
  var list = $('history-list');
  list.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">加载中...</div>';
  try {
    var r = await fetch('/api/v2/chat/sessions', { headers:{Authorization:'Bearer '+state.token} });
    if (!r.ok) { list.innerHTML='<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">暂无历史</div>'; return; }
    var chats = await r.json();
    if (!Array.isArray(chats) || chats.length===0) { list.innerHTML='<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">暂无历史</div>'; return; }
    list.innerHTML = chats.map(function(c){
      var t = c.title || '未命名';
      var time = c.created_at ? c.created_at.slice(5,16).replace('T',' ') : '';
      return '<div class="h-item'+(c.id===state.currentConvId?' active':'')+'" onclick="switchChat(\''+c.id+'\')">'+
        '<span class="h-title">'+esc(t)+'</span>'+
        '<span class="h-time">'+time+'</span>'+
        '<button class="h-del" onclick="event.stopPropagation();deleteChat(\''+c.id+'\')" title="删除">🗑</button></div>';
    }).join('');
  } catch(e) { list.innerHTML='<div style="text-align:center;font-size:11px;color:var(--muted);padding:20px">加载失败</div>'; }
}

async function switchChat(id) {
  if (id === state.currentConvId) { closeHistory(); return; }
  try {
    var r = await fetch('/api/v2/chat/history?conversationId='+id, { headers:{Authorization:'Bearer '+state.token} });
    if (r.ok) {
      var msgs = await r.json();
      state.currentConvId = id; state.messages = [];
      var lst = $('msg-list'); var w = $('welcome'); lst.innerHTML = '';
      if (w) lst.appendChild(w);
      if (Array.isArray(msgs)) { msgs.forEach(function(m){ if (m.role==='user'||m.role==='assistant') addMsg(m.role, m.content||''); }); }
    }
  } catch(e) {}
  closeHistory(); loadConversations();
}

async function newChat() {
  try {
    var r = await fetch('/api/v2/chat/sessions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token}, body:JSON.stringify({title:'新的对话'}) });
    if (r.ok) {
      var d = await r.json(); state.currentConvId = d.id; state.messages = [];
      var lst = $('msg-list'); lst.innerHTML = '';
      var w = document.createElement('div'); w.className='welcome'; w.id='welcome';
      w.innerHTML = '<div class="w-icon">🤖</div><h2>AI 交易助手</h2><p>直接提问即可</p><div class="hints">'+getHintBtns()+'</div>';
      lst.appendChild(w);
    }
  } catch(e) {}
  closeHistory(); loadConversations();
}

async function deleteChat(id) {
  if (!confirm('删除此会话？')) return;
  try {
    await fetch('/api/v2/chat/history?conversationId='+id, { method:'DELETE', headers:{Authorization:'Bearer '+state.token} });
    if (id === state.currentConvId) { newChat(); }
  } catch(e) {}
  loadConversations();
}

// ═══ UI ═══
function addMsg(role, content, streaming) {
  var el = document.createElement('div'); el.className = 'msg ' + role;
  if (streaming) { el.classList.add('streaming'); }
  el.innerHTML = '<div class="sender">'+(role==='user'?'👤 你':'🤖 hvip AI')+'</div><div class="body">'+esc(content)+'</div>';
  if (streaming) { var cr = document.createElement('span'); cr.className='cursor'; el.querySelector('.body').appendChild(cr); }
  $('msg-list').appendChild(el); scrollBottom();
  var id = 'msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6); el.id = id;
  state.messages.push({role:role, content:content, elId:id});
  return id;
}
function updateMsg(id, fn) { var el = document.getElementById(id); if (el) fn(el); }
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function scrollBottom() { $('msg-list').scrollTop = $('msg-list').scrollHeight; }
