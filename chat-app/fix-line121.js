// Fix the broken line in _clean.js and rebuild HTML
const fs = require('fs');
const cp = require('child_process');

let cleanJS = fs.readFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/_clean.js', 'utf8');

// Fix line 121: change ''+qs[i]+'' to '\''+qs[i]+'\''
cleanJS = cleanJS.replace("''+qs[i]+''", "'\\''+qs[i]+'\\''");
fs.writeFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/_clean.js', cleanJS);

// Verify
try {
  cp.execFileSync(process.execPath, ['--check', 'C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/_clean.js'], {stdio:'pipe'});
  console.log('✅ Syntax OK');
} catch(e) {
  console.log('❌ Still broken:', e.stderr?.toString()?.slice(0,200));
  process.exit(1);
}

// Rebuild HTML
const html = fs.readFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/index.html', 'utf8');
const before = html.split('<script>')[0];
const after = html.split('</script>')[1];
const newHtml = before + '<script>' + cleanJS + '\n</script>' + after;
fs.writeFileSync('C:/Users/Administrator/Desktop/hvip-mcp-server/chat-app/index.html', newHtml);
console.log('✅ chat-app/index.html rebuilt');
