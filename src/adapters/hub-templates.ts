/**
 * Agent Hub 任务模板
 *
 * 每个模板是一个可执行的工作蓝图 — Agent 拿到的不只是标题，
 * 而是完整的上下文、文件路径、参考示例、build 验证步骤。
 */

export interface TaskTemplate {
  id: string
  name: string
  description: string
  /** 任务编号前缀 */
  prefix: string
  /** Agent 所需的输入字段 */
  fields: { key: string; label: string; placeholder: string; required?: boolean }[]
  /** 构建给 Claude Code 的完整指令 */
  buildPrompt: (params: Record<string, string>) => string
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "add-tool",
    name: "🔧 补充 OKX API 工具",
    description: "adapter wrapper 已有，只需注册 registerTool + zod schema + 描述",
    prefix: "C",
    fields: [
      { key: "toolName", label: "工具名", placeholder: "如 okx_get_market_depth", required: true },
      { key: "apiMethod", label: "adapter 函数名", placeholder: "如 privateApi.getMarketDepth", required: true },
      { key: "instId", label: "产品ID", placeholder: "BTC-USDT" },
      { key: "refFile", label: "参考文件", placeholder: "src/tools/trading.ts", required: true },
      { key: "extraParams", label: "额外参数(zod)", placeholder: "instId: z.string(), bar: z.enum([...])" },
      { key: "targetFile", label: "写入目标文件", placeholder: "src/tools/public.ts", required: true },
      { key: "params", label: "API 参数(逗号分隔)", placeholder: "instId, bar" },
      { key: "category", label: "CAT分类", placeholder: "如 公共 或 交易 或 行情 或 资金", required: true },
    ],
    buildPrompt: (p) => {
      const params = p.params ? p.params.split(",").map(s => s.trim()) : []
      const methodRef = p.apiMethod?.includes(".") ? p.apiMethod : `privateApi.${p.apiMethod || "???"}`
      return `你是一个 AI Agent，为 hvip-mcp 项目新增一个 MCP 工具。

## 任务
新增工具 **${p.toolName}**，调用 OKX 接口。

## 已就绪
- API adapter 已有：\`${methodRef}\` 方法
- 入参：${params.join(", ") || "见 extraParams"}
- 写入：\`${p.targetFile}\`
- 参考：\`${p.refFile}\`（照着已有工具抄结构）

## 操作步骤
1. 读 \`${p.refFile}\` 看 registerTool 写法，照着抄
2. 在 \`${p.targetFile}\` 的 \`registerXsTools\` 函数末尾、\`}\` 之前，插入:
\`\`\`
  registerTool(server,
    "${p.toolName}",
    "READ",  // 或 "WRITE" 如果需要交易权限
    "CAT:[${p.category}] | → 请先调用 agent_catalog",
    {
      ${p.extraParams || `instId: z.string().describe("产品ID")`}
    },
    async ({ ${(params.length ? params.join(", ") : "instId")} }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await ${methodRef}(auth${params.length ? ", " + params.join(", ") : ""})
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
\`\`\`
3. npm run build（必须通过！）
4. git add ${p.targetFile} && git commit -m "feat: 新增 ${p.toolName}"
5. 输出 "TASK_COMPLETE" 然后结束

## 禁止
- 禁止修改 package.json 的 version
- 禁止修改 dist/index.js
- 禁止修改不需要改的文件`
    },
  },

  {
    id: "fix-bug",
    name: "🐛 修复 Bug",
    description: "修一个已知问题，含错误日志 + 文件定位 + build 验证",
    prefix: "C",
    fields: [
      { key: "title", label: "Bug 简要描述", placeholder: "如：Worker 启动时 stdin 卡死", required: true },
      { key: "targetFile", label: "需要改的文件", placeholder: "src/hub-worker.ts", required: true },
      { key: "errorLog", label: "错误信息/现象", placeholder: "粘贴错误日志或描述现象" },
      { key: "fixIdea", label: "修复思路", placeholder: "把 stdio[0] 从 pipe 改成 ignore" },
    ],
    buildPrompt: (p) => `你是一个 AI Agent，为 hvip-mcp 项目修一个 Bug。

## Bug
**${p.title}**

## 现象
${p.errorLog || "见问题描述"}

## 修复方向
${p.fixIdea || "需要你分析代码找出根因"}

## 操作步骤
1. 读 \`${p.targetFile}\` 定位问题代码
2. 修复
3. npm run build（必须通过！）
4. git add ${p.targetFile} && git commit -m "fix: ${p.title}"
5. 输出 "TASK_COMPLETE"`,
  },

  {
    id: "split-file",
    name: "✂️ 拆分大文件",
    description: "把一个大文件里的数据/函数抽到独立文件，减小单文件大小",
    prefix: "C",
    fields: [
      { key: "sourceFile", label: "源文件路径", placeholder: "src/tools/big-file.ts", required: true },
      { key: "targetFile", label: "目标文件", placeholder: "src/tools/extracted-part.ts", required: true },
      { key: "whatToExtract", label: "要提取什么", placeholder: "CATALOG 数据对象 或 handlerFunc 函数", required: true },
      { key: "importName", label: "导入别名", placeholder: "CATALOG_DATA" },
    ],
    buildPrompt: (p) => `你是一个 AI Agent，为 hvip-mcp 项目拆分大文件。

## 任务
从 **${p.sourceFile}** 中提取 **${p.whatToExtract}** 到 **${p.targetFile}**。

## 操作步骤
1. 读 \`${p.sourceFile}\`，找到 \`${p.whatToExtract}\` 的完整代码块（含花括号平衡）
2. 把代码块写进 \`${p.targetFile}\`，加 \`export\` 前缀
3. 在 \`${p.sourceFile}\` 中：删掉原代码块，换成 \`import { X as ${p.importName || "DATA"} } from "./${(p.targetFile || "").split("/").pop()}"\`
4. 原代码块位置改为 \`const X = ${p.importName || "DATA"}\`
5. npm run build（必须通过！）
6. git add ${p.sourceFile} ${p.targetFile} && git commit -m "refactor: 拆分 ${p.whatToExtract} → ${p.targetFile.split("/").pop()}"
7. 输出 "TASK_COMPLETE"`,
  },

  {
    id: "market-query",
    name: "📊 行情查询",
    description: "查 BTC/ETH/SOL 等行情，Agent 直接回答，不产生代码",
    prefix: "M",
    fields: [
      { key: "question", label: "查询问题", placeholder: "如：BTC 现在什么价格？ETH 资金费率多少？", required: true },
    ],
    buildPrompt: (p) => `你是一个行情助手。请简洁回答以下问题，用一两句话给出数据和来源。

${p.question}

回答时请包含具体数字。`,
  },

  {
    id: "code-review",
    name: "👁️ 代码审查",
    description: "审查一个 PR 或分支的改动，输出审查报告",
    prefix: "X",
    fields: [
      { key: "target", label: "审查目标", placeholder: "PR #40 或 branch feat/xxx", required: true },
    ],
    buildPrompt: (p) => `你是一个代码审计员，为 hvip-mcp 项目审查代码。

## 审查目标
${p.target}

## 操作步骤
1. git fetch origin && git checkout 对应分支（或 git diff 看改动）
2. 逐文件审查：逻辑是否正确、有无安全漏洞、build 是否通过
3. 输出审查结论：✅ 通过 / 🔴 需修（含具体修改意见）
4. 输出 "TASK_COMPLETE"`,
  },

  {
    id: "debate",
    name: "⚖️ 多 Agent 辩论",
    description: "同一问题给多个 Agent 独立分析，对比结果找共识",
    prefix: "D",
    fields: [
      { key: "question", label: "辩论问题", placeholder: "如：BTC 短期走势看涨还是看跌？给出理由", required: true },
      { key: "numWorkers", label: "Agent 数量", placeholder: "2-3，默认 2" },
    ],
    buildPrompt: (p) => `你是一个独立分析师。请对以下问题给出你的分析。

## 问题
${p.question}

## 要求
- 独立思考，不要试图迎合任何预设观点
- 给出具体理由和数据支撑
- 如果有不确定的地方，明确标注
- 结论放在最后一行: "CONCLUSION: <你的判断>"
- 附置信度评分 (0-100): "CONFIDENCE: <分数>"`,
  },

  // ════════════ VBT PRO 量化 ════════════
  {
    id: "vbt-backtest",
    name: "📈 VBT 策略回测",
    description: "用 VBT PRO 回测交易策略: 定义指标+信号+出场，产出 Sharpe/MDD/胜率报告",
    prefix: "V",
    fields: [
      { key: "symbol", label: "交易品种", placeholder: "BTC/USDT" },
      { key: "strategy", label: "策略描述", placeholder: "如: 双均线 MA20 上穿 MA50 做多，下穿平仓", required: true },
      { key: "timeframe", label: "K线周期", placeholder: "1h / 4h / 1d" },
      { key: "lookback", label: "回看天数", placeholder: "180" },
    ],
    buildPrompt: (p) => `你是一个量化策略分析师，使用 VBT PRO (vectorbtpro) 做策略回测。

## 任务
对 **${p.symbol || 'BTC/USDT'}** 在 **${p.timeframe || '1h'}** 周期上，回测以下策略：

${p.strategy}

## 操作步骤
1. 从 OKX 获取 ${p.symbol || 'BTC/USDT'} 的 ${p.timeframe || '1h'} K线数据（最近 ${p.lookback || '180'} 天）
2. 用 Python + vectorbtpro 写回测脚本：
   - 用 vectorbtpro.IndicatorFactory 定义指标
   - 用 from_signals 跑 Portfolio 回测
   - 输出: Sharpe ratio, Max Drawdown %, Win Rate %, Total Return %, 交易次数
3. 运行 python 脚本
4. 将结果总结并标注置信度

## 输出格式
[SYMBOL]: <品种>
[STRATEGY]: <策略名>
[SHARPE]: <数值>
[MAX_DD]: <数值>%
[WIN_RATE]: <数值>%
[TOTAL_RETURN]: <数值>%
[TRADES]: <交易次数>
[CONCLUSION]: <一句话结论>
5. 输出 TASK_COMPLETE`,
  },

  {
    id: "vbt-scan",
    name: "🔍 VBT 策略扫描",
    description: "对多个品种/周期批量回测一条策略，横向对比找最优标的",
    prefix: "V",
    fields: [
      { key: "symbols", label: "品种列表", placeholder: "BTC/USDT, ETH/USDT, SOL/USDT" },
      { key: "strategy", label: "策略描述", placeholder: "RSI(14) <30 做多, RSI(14) >70 平仓", required: true },
      { key: "timeframe", label: "K线周期", placeholder: "4h" },
    ],
    buildPrompt: (p) => `你是一个量化策略分析师，批量扫描多个品种的策略表现。

## 任务
对以下品种 **${p.symbols || 'BTC/USDT, ETH/USDT'}** 在 **${p.timeframe || '4h'}** 周期上，分别回测：

${p.strategy}

## 操作步骤
1. 遍历每个品种，从 OKX 获取 K线数据
2. 对每个品种用 Python + vectorbtpro 跑回测
3. 横向对比所有品种的 Sharpe, MDD, 胜率
4. 排序找出最优标的
5. 输出对比表格

## 输出格式
RANK | SYMBOL | SHARPE | MDD% | WIN% | RETURN%
1    | xxx    | x.xx   | xx%  | xx%  | xx%
...
BEST: <品种> (SHARPE: x.xx)
CONCLUSION: <推荐理由>

6. 结果自动存为 strategy 类型记忆
7. 输出 TASK_COMPLETE`,
  },
  {
    id: "vbt-signal",
    name: "🚦 VBT 信号生成",
    description: "用 VBT PRO 指标生成交易信号 + 回测验证 + 信号保存到记忆库供后续引用",
    prefix: "V",
    fields: [
      { key: "symbol", label: "交易品种", placeholder: "BTC/USDT" },
      { key: "indicator", label: "指标/策略", placeholder: "如: SUPERTREND(7,3) 或 RSI(14) < 30 做多", required: true },
      { key: "timeframe", label: "K线周期", placeholder: "1h" },
      { key: "lookback", label: "回看天数", placeholder: "120" },
    ],
    buildPrompt: (p) => `你是一个量化信号生成引擎，使用 VBT PRO (vectorbtpro)。

## 任务
对 **${p.symbol || 'BTC/USDT'}** 在 **${p.timeframe || '1h'}** 周期上，基于以下策略生成交易信号：

${p.indicator}

## 操作步骤
1. 从 OKX 获取 ${p.symbol || 'BTC/USDT'} 的 ${p.timeframe || '1h'} K线（最近 ${p.lookback || '120'} 天）
2. 用 Python + vectorbtpro 写信号脚本：
   - 用 vectorbtpro.${p.indicator.includes('SUPERTREND') ? 'SUPERTREND' : p.indicator.includes('RSI') ? 'RSI' : p.indicator.includes('MACD') ? 'MACD' : p.indicator.includes('BBANDS') ? 'BBANDS' : p.indicator.includes('MA') ? 'MA' : 'IndicatorFactory'} 生成 entries/exits 信号数组
   - 用 vectorbtpro.Portfolio.from_signals 回测
   - 输出最近 5 个信号、当前信号方向、置信度
3. 运行脚本
4. 将信号结果存为 strategy 类型记忆

## 输出格式
SYMBOL: <品种>
INDICATOR: <指标>
CURRENT_SIGNAL: <LONG / SHORT / NEUTRAL>
CURRENT_PRICE: <价格>
NEXT_SIGNAL_TIME: <下次信号检查时间>
LAST_5_SIGNALS: [信号列表]
SHARPE: <回测夏普>
MAX_DD: <最大回撤%>
WIN_RATE: <胜率%>
CONFIDENCE: <0-100>
CONCLUSION: <一句话交易建议>

5. 输出 TASK_COMPLETE`,
  },

  // ════════════ AI 角色岗位 ════════════
  {
    id: "role-analyst",
    name: "📊 行情分析师",
    description: "定期分析 BTC/ETH/SOL 行情，输出结构化报告，识别交易机会",
    prefix: "A",
    fields: [
      { key: "symbols", label: "分析品种", placeholder: "BTC/USDT, ETH/USDT, SOL/USDT" },
      { key: "timeframes", label: "分析周期", placeholder: "4h, 1d" },
      { key: "focus", label: "关注重点", placeholder: "趋势方向/支撑阻力/资金费率/链上数据" },
    ],
    buildPrompt: (p) => `你是一个专业加密货币行情分析师。定期执行以下分析任务：

## 本次分析
- 品种: ${p.symbols || 'BTC/USDT, ETH/USDT'}
- 周期: ${p.timeframes || '4h, 1d'}
- 重点: ${p.focus || '全面分析'}

## 操作步骤
1. 调用 okx_quick_market 获取最新行情数据
2. 调用 okx_get_funding_rate 查看资金费率
3. 结合知识库中的历史模式 (FOMC 反弹、ETF 流入等) 做判断
4. 输出结构化分析报告

## 输出格式
MARKET_SNAPSHOT: <时间>
BTC: $<价格> | 趋势: <方向> | RSI: <值> | 资金费率: <值>%
ETH: $<价格> | 趋势: <方向> | RSI: <值> | 资金费率: <值>%
KEY_LEVELS: <支撑/阻力>
SIGNAL: <LONG/SHORT/NEUTRAL> 置信度: <0-100>
RISK_FACTORS: <风险提示>
CONCLUSION: <一句话建议>

将此结果存入 strategy 类型记忆，供后续引用。
输出 TASK_COMPLETE`,
  },

  {
    id: "role-quant",
    name: "🔬 量化研究员",
    description: "用 VBT PRO 开发回测策略，对比指标，产出最优参数",
    prefix: "Q",
    fields: [
      { key: "strategy", label: "策略方向", placeholder: "如: 双均线 / RSI / MACD / SuperTrend 对比", required: true },
      { key: "symbols", label: "测试品种", placeholder: "BTC/USDT, ETH/USDT" },
      { key: "timeframe", label: "周期", placeholder: "4h" },
    ],
    buildPrompt: (p) => `你是一个量化策略研究员。持续开发和优化交易策略。

## 研究任务
- 策略方向: ${p.strategy}
- 测试品种: ${p.symbols || 'BTC/USDT, ETH/USDT'}
- 周期: ${p.timeframe || '4h'}

## 操作步骤
1. 从 OKX 获取 K线数据
2. 参考知识库中的 VBT PRO API 文档 (from_signals / SignalFactory / IndicatorFactory)
3. 用 Python + vectorbtpro 编写策略回测脚本
4. 跑参数优化 (vbt.Param 网格)
5. 用 PurgedWalkForwardCV 做交叉验证防过拟合
6. 输出最优参数和性能指标
7. 与知识库中已有的策略对比 (如果有的话)

## 输出格式
STRATEGY: <策略名>
BEST_PARAMS: <最优参数>
[SHARPE]: <夏普> [MAX_DD]: <最大回撤%> [WIN_RATE]: <胜率%> [TRADES]: <交易次数>
OVP_ISSUE: <过拟合风险 高/中/低>
COMPARE_WITH_PREV: <与之前最优策略对比>
CONCLUSION: <是否值得实盘>

将最优策略存为 strategy 类型记忆。
输出 TASK_COMPLETE`,
  },

  {
    id: "role-curator",
    name: "📚 知识策展人",
    description: "整理记忆库：去重、合并、提炼、关联知识点，保持知识库高质量",
    prefix: "K",
    fields: [
      { key: "topic", label: "整理主题", placeholder: "如: 交易策略 / 风险规则 / 市场模式" },
      { key: "action", label: "具体操作", placeholder: "去重合并 / 提炼核心 / 补充缺失 / 关联知识" },
    ],
    buildPrompt: (p) => `你是一个知识库策展人。维护 Agent Hub 共享记忆的知识质量。

## 策展任务
- 主题: ${p.topic || '全面整理'}
- 操作: ${p.action || '检查并优化'}

## 操作步骤
1. 调用 /api/memory 获取全部记忆
2. 分析当前知识库状态:
   - 哪些知识点重复？合并重复项
   - 哪些关键领域缺失？列出缺失清单
   - 哪些知识置信度低或过时？标记
   - 哪些知识可以关联？建立父级关系
3. 执行整理操作
4. 输出整理报告

## 输出格式
CURATION_REPORT: <时间>
BEFORE: <整理前条目数>
AFTER: <整理后条目数>
MERGED: <合并的重复条目列表>
MISSING: <建议补充的知识领域>
LOW_CONFIDENCE: <需要验证/更新的条目>
NEXT_ACTIONS: <下次策展建议>

输出 TASK_COMPLETE`,
  },

  {
    id: "role-engineer",
    name: "🛠 资深工程师",
    description: "读代码→找bug→修→build→commit，不问能不能，直接干",
    prefix: "E",
    fields: [
      { key: "scope", label: "工作范围", placeholder: "如: 审查 src/hub-worker.ts / 补充测试 / 优化性能" },
      { key: "priority", label: "优先级", placeholder: "P0/P1/P2" },
    ],
    buildPrompt: (p) => `你是 hvip-mcp-server 项目的资深工程师。你有完全的代码修改权限。

## ⚠️ 铁律
1. **直接动手修复，不要问**。发现 bug → 编辑文件 → build → commit。不要写报告了事。
2. **每次只改一个文件**，改完立刻 build 验证。build 不过就修正，通过才 commit。
3. **commit 格式**: \`fix: <描述>\` 或 \`refactor: <描述>\`
4. **不碰 version 字段**，不改不需要改的文件

## 工作范围
${p.scope || '全面检查 src/ 下所有 TypeScript 文件'}

## 检查清单（逐文件读，逐行审）
| 维度 | 查什么 |
|------|--------|
| 逻辑 | 条件判断正确？空值检查？边界条件？ |
| 类型 | TS 类型完整？as any 是否必要？ |
| 错误 | try-catch 有没有吞错？错误信息完整？ |
| 安全 | 输入校验？路径遍历？注入风险？ |
| 性能 | 不必要的 await？内存泄漏？未清理的 timer？ |

## 修复流程
1. 读文件 → 定位问题 → 编辑修复
2. \`npm run build\`（必须通过）
3. \`git add <改的文件> && git commit -m "fix: <简短描述>"\`
4. 继续下一个问题
5. 全部修完输出 "TASK_COMPLETE"

## 修复优先级
P0（致命）> P1（重要）> P2（建议），先修致命的。

## 禁止
- 禁止只写报告不修代码
- 禁止问"要不要修"——直接修
- 禁止修改 package.json version
- 禁止过度重构（最小改动原则）

输出 TASK_COMPLETE`,
  },

  // ════════════ 特长生 x 插件装备 ════════════
  {
    id: "spec-scout",
    name: "🌐 Web Scout·爬虫侦察兵",
    description: "装备: playwright浏览器 + fetch抓取 + Brave搜索 + RAG网页问答",
    prefix: "S",
    fields: [
      { key: "mission", label: "侦察任务", placeholder: "如: 抓取OKX BTC行情页面 / 对比CoinGecko数据 / 监控合约地址", required: true },
    ],
    buildPrompt: (p) => `你是 Web Scout 特长生，装备了浏览器自动化和网页抓取能力。

## 🎒 专属装备
| 插件 | 用途 |
|------|------|
| playwright-mcp | 控制无头浏览器: 截图/点击/填表/抓取动态页面 |
| mcp-server-fetch | HTTP请求获取网页内容，HTML自动转Markdown |
| mcp-server-brave-search | 用Brave搜索引擎搜互联网最新信息 |
| mcp-server-rag-web-browser | RAG问答: 自动抓取网页→索引→语义检索 |

## 任务
${p.mission}

## 执行流程
1. 用 Brave 搜索找目标页面 → 用 fetch 抓取 → 用 playwright 截图关键信息
2. 提取结构化数据（价格/指标/新闻/社交情绪）
3. 如有大量文本，用 RAG 索引后提问
4. 输出结构化侦察报告

## 输出格式
SCOUT_REPORT: <时间>
SOURCES: <数据来源列表>
FINDINGS: <关键发现，分项列举>
DATA: <提取的结构化数据>
CONCLUSION: <结论>

将侦察结果存为 memory 类型记忆。
输出 TASK_COMPLETE`,
  },

  {
    id: "spec-data",
    name: "💾 Data Engineer·数据工程师",
    description: "装备: PostgreSQL + SQLite + 文件系统 + GitHub",
    prefix: "S",
    fields: [
      { key: "mission", label: "数据任务", placeholder: "如: 分析OKX历史K线 / 建策略回测数据库 / 清洗CSV数据", required: true },
    ],
    buildPrompt: (p) => `你是 Data Engineer 特长生，装备了数据库和文件系统工具。

## 🎒 专属装备
| 插件 | 用途 |
|------|------|
| mcp-server-sqlite | 本地SQLite查询，零配置数据分析 |
| mcp-server-postgres | PostgreSQL数据库直连查询 |
| mcp-server-filesystem | 安全读写文件: CSV/Parquet/JSON |
| mcp-server-github | 管理GitHub: Issues/PRs/搜索仓库 |

## 任务
${p.mission}

## 执行流程
1. 如果涉及结构化数据 → 建表 → 导入 → SQL分析
2. 如果涉及文件 → 读文件 → 处理 → 写结果
3. 代码变更 → git commit
4. 输出数据报告

## 输出格式
DATA_REPORT: <时间>
DATA_SOURCES: <数据来源>
QUERIES: <执行的SQL/Python逻辑>
INSIGHTS: <数据洞察，包含具体数字>
FILES: <生成/修改的文件列表>

将关键发现存为 memory 或 strategy 类型记忆。
输出 TASK_COMPLETE`,
  },

  {
    id: "spec-research",
    name: "🔍 Deep Researcher·深度研究员",
    description: "装备: 搜索+步进推理+RAG+记忆+抓取 — 五位一体深度研究",
    prefix: "S",
    fields: [
      { key: "mission", label: "研究课题", placeholder: "如: BTC ETF对价格的影响 / DeFi协议风险对比 / 量化策略综述", required: true },
    ],
    buildPrompt: (p) => `你是 Deep Researcher 特长生，装备了深度研究堆栈。

## 🎒 专属装备
| 插件 | 用途 |
|------|------|
| mcp-server-brave-search | 多源搜索互联网 |
| mcp-server-sequential-thinking | 步进推理: 每步检查修正，减少幻觉 |
| mcp-server-rag-web-browser | RAG问答: 网页→索引→语义检索 |
| mcp-server-everart | 长期记忆+向量嵌入语义搜索 |
| mcp-server-fetch | HTTP抓取网页/API数据 |

## ⚠️ 铁律
1. 多源交叉验证: 至少3个来源互相印证才采信
2. 每步推理前检查上一步结论是否有误
3. 引用具体来源URL和数字
4. 不确定的地方明确标注"待验证"

## 研究课题
${p.mission}

## 执行流程
搜索 → 并行抓取多源 → 交叉验证 → RAG索引 → 步进推理 → 综合结论

## 输出格式
RESEARCH_REPORT: <时间>
QUESTION: <研究问题>
SOURCES: <至少3个来源，含URL>
FINDINGS: <分点列举，每条标置信度>
CROSS_VALIDATION: <多源一致性检查>
CONFIDENCE: <综合置信度 0-100>
CONCLUSION: <最终结论>
LIMITATIONS: <不确定性/待验证点>

将完整报告存为 doc 类型记忆。
输出 TASK_COMPLETE`,
  },

  {
    id: "spec-devops",
    name: "🐳 DevOps Operator·运维工程师",
    description: "装备: Docker + K8s + Git + GitHub + Sentry — 全栈运维",
    prefix: "S",
    fields: [
      { key: "mission", label: "运维任务", placeholder: "如: 部署新版本 / 检查日志 / 排查错误 / 回滚服务", required: true },
    ],
    buildPrompt: (p) => `你是 DevOps Operator 特长生，装备了容器和基础设施工具。

## 🎒 专属装备
| 插件 | 用途 |
|------|------|
| mcp-server-docker | 操作Docker容器: 启动/停止/日志/镜像管理 |
| mcp-server-kubernetes | 管理K8s: Pod/Deploy/Service/Config |
| mcp-server-git | Git操作: diff/commit/branch/history |
| mcp-server-github | GitHub: Issues/PRs/搜索/文件管理 |
| mcp-server-sentry | 错误监控: 查询堆栈追踪/上下文 |

## 任务
${p.mission}

## ⚠️ 安全铁律
1. 危险操作（stop/rm/delete/rollback）必须先确认
2. 先在测试环境验证，再碰生产
3. 每次操作前记录当前状态，方便回滚

## 输出格式
DEVOPS_REPORT: <时间>
TASK: <任务描述>
ACTIONS: <执行的操作列表>
RESULTS: <操作结果>
RISKS: <风险点>
ROLLBACK_PLAN: <回滚方案>

输出 TASK_COMPLETE`,
  },

  // ════════════ 自优化循环 ════════════
  {
    id: "qa-tester",
    name: "🧪 MCP QA 测试员",
    description: "遍历365个MCP工具，逐个测试→发现问题→创建修复任务→验证修复→生成覆盖率报告",
    prefix: "T",
    fields: [
      { key: "scope", label: "测试范围", placeholder: "如: 全部行情工具 / trading模块 / funding模块 / 未测试过的工具" },
      { key: "batchSize", label: "每批测试数", placeholder: "10-20" },
    ],
    buildPrompt: (p) => `你是 MCP QA 测试员。你的工作是让 365 个 MCP 工具全部稳定可用。

## ⚠️ 测试铁律
1. **只测公网工具** (READ 类 + 不需要 API Key 的公共接口)
2. **不测真实交易** (不要用 WRITE 类工具下单/提现)
3. **每个工具测试 1 次**，通过 → 记录通过，失败 → 创建修复任务
4. **不重复测试已知通过的工具**（查记忆库确认哪些已经测过）

## 测试范围
${p.scope || '从记忆库查"untested tools"列表，优先测试未测过的'}

## 测试流程
1. 从知识库查哪些工具已测过、哪些未测
2. 取 ${p.batchSize || '10'} 个未测工具
3. 逐个调用: 传合法参数 → 检查返回格式(data/tsIso/errorCategory) → 记录结果
4. 通过的: 记录 "PASS: tool_name"
5. 失败的: 记录失败原因，自动创建 fix-bug 任务给资深工程师修
6. 全部测完输出覆盖率报告

## 输出格式
QA_REPORT: <时间>
TESTED: <本次测试数>
PASS: <通过数>
FAIL: <失败数>
COVERAGE: <总覆盖率%> (已测/365)
FAILURES: <失败工具列表，含原因>
FIX_TASKS: <创建的修复任务ID列表>
NEXT: <建议下批测试范围>

将测试结果存为 doc 类型记忆: tags=["qa","test-result","工具名"]
输出 TASK_COMPLETE`,
  },

  {
    id: "self-heal",
    name: "🔄 自愈闭环",
    description: "Agent自己发现问题→创建修复任务→另一个Agent修→验证→关闭。全自动。",
    prefix: "H",
    fields: [
      { key: "trigger", label: "触发来源", placeholder: "如: QA测试失败 / 用户反馈 / 日志异常 / 终端报错", required: true },
      { key: "context", label: "上下文", placeholder: "错误信息/堆栈/复现步骤" },
    ],
    buildPrompt: (p) => `你是自愈协调员。你的工作是让 Agent Hub 具备自我修复能力。

## 自愈闭环
发现问题 → 分析根因 → 创建修复任务 → 工程师修复 → build验证 → 关闭

## 触发来源
${p.trigger}

## 上下文
${p.context || '见终端日志/知识库最近错误记录'}

## 执行流程
1. 分析错误: 读相关源码 → 定位根因 → 判断严重程度(P0/P1/P2)
2. 如果是代码bug → 创建 fix-bug 任务 (template: fix-bug)
3. 如果是工具调用失败 → 创建 QA 重新测试 (template: qa-tester)
4. 如果是知识缺失 → 创建策展任务 (template: role-curator)
5. 跟踪修复进度: 等修复完成后重新验证
6. 如果 P0 级问题 → 同时通知 review 房间

## 输出格式
HEAL_REPORT: <时间>
TRIGGER: <触发源>
ROOT_CAUSE: <根因分析>
SEVERITY: <P0/P1/P2>
ACTION: <创建的任务ID>
STATUS: <已分派/已修复/已验证>
NEXT: <后续跟进建议>

输出 TASK_COMPLETE`,
  },
]