// Fix getHintBtns in _clean.js, verify, rebuild index.html
const fs = require('fs');
const cp = require('child_process');

let js = fs.readFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/_clean.js', 'utf8');

// Find and replace getHintBtns - use a marker-based approach
const startMarker = 'function getHintBtns() {';
const endMarker = '\n}\n\nfunction quickAsk';
const idx1 = js.indexOf(startMarker);
const idx2 = js.indexOf(endMarker, idx1);
if (idx1 < 0 || idx2 < 0) { console.log('Cannot find getHintBtns'); process.exit(1); }

const newFunc = `function getHintBtns() {
  var btns = ["₿ BTC 价格","Ξ ETH 费率","📊 市场情绪","📈 RSI 分析","🔥 热门币种","💡 交易机会"];
  var qs = ["BTC 现在什么价格？","ETH 资金费率多少？","市场情绪怎么样？","BTC RSI 超买还是超卖？","最近有什么热门币？","帮我分析一下现在的交易机会"];
  var h = "";
  for (var i = 0; i < btns.length; i++) {
    h += "<button onclick=quickAsk('" + qs[i] + "')>" + btns[i] + "</button>";
  }
  return h;
}
`;

js = js.slice(0, idx1) + newFunc + js.slice(idx2 + 1); // +1 for the \n we consumed
fs.writeFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/_clean.js', js);

// Verify syntax
try {
  cp.execFileSync('node', ['--check', 'C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/_clean.js'], {stdio:'pipe'});
  console.log('✅ Syntax OK');
} catch(e) {
  console.log('❌ Syntax FAIL');
  // Show the fixed function
  const lines = js.split('\n');
  const funcStart = js.indexOf('function getHintBtns');
  const funcLine = js.slice(0, funcStart).split('\n').length;
  for (let i = funcLine - 1; i < funcLine + 10; i++) console.log(i + ':', lines[i]);
  process.exit(1);
}

// Rebuild HTML
const html = fs.readFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/index.html', 'utf8');
const before = html.split('<script>')[0];
const after = html.split('</script>')[1];
const newHtml = before + '<script>\n' + js + '\n</script>' + after;
fs.writeFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/index.html', newHtml);
console.log('✅ index.html rebuilt');
