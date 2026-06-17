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
  /** 任务编号前缀: C=代码, M=行情, X=其他 */
  prefix: "C" | "M" | "X"
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
]
