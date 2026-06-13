import { readFileSync, writeFileSync } from 'fs';

const cats = {
  'market.ts':     '[行情]',
  'ws.ts':         '[行情-WS]',
  'trading.ts':    '[交易]',
  'algo.ts':       '[交易-委托]',
  'account.ts':    '[账户]',
  'subaccount.ts': '[账户-子账户]',
  'funding.ts':    '[资金]',
  'fiat.ts':       '[资金-法币]',
  'outcomes.ts':   '[预测]',
  'bot.ts':        '[策略-网格]',
  'signal.ts':     '[策略-信号]',
  'copy.ts':       '[策略-跟单]',
  'spread.ts':     '[策略-价差]',
  'rfq.ts':        '[策略-RFQ]',
  'public.ts':     '[公共]',
  'finance.ts':    '[金融]',
  'stats.ts':      '[统计]',
  'xlayer-ws.ts':  '[链上]',
  'affiliate.ts':  '[推广]',
  'agent-hub.ts':  '[系统]',
  'agent-utils.ts':'[系统]',
};

let total = 0;

for (const [file, cat] of Object.entries(cats)) {
  const path = 'src/tools/' + file;
  let c = readFileSync(path, 'utf8');

  // Replace: "## 功能： → "CAT:XXX | ## 功能：
  // This is safe because ## 功能：only appears at the start of tool descriptions
  const before = (c.match(/"## 功能：/g) || []).length;
  c = c.replace(/"## 功能：/g, '"CAT:' + cat + ' | ## 功能：');
  const after = (c.match(/"CAT:/g) || []).length;

  writeFileSync(path, c, 'utf8');
  console.log(file + ': ' + after + ' tags');
  total += after;
}
console.log('Total: ' + total);
