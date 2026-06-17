import { readFileSync, writeFileSync } from "node:fs"

let s = readFileSync("src/hub-server.ts", "utf8")

// 1. Update create task to accept template+params
s = s.replace(
  'const { taskId, title } = JSON.parse(Buffer.concat(chunks).toString("utf-8"))\r\n          if (!taskId)',
  'const { taskId, title, template, params } = JSON.parse(Buffer.concat(chunks).toString("utf-8"))\r\n          if (!taskId)')
s = s.replace(
  'agentHub.registerTask(taskId, title || taskId)\r\n          db?.saveTask({ taskId, status: "unassigned", title: title || taskId })',
  'agentHub.registerTask(taskId, title || taskId)\r\n          db?.saveTask({ taskId, status: "unassigned", title: title || taskId })\r\n          if (template && params) taskMeta.set(taskId, { templateId: template, params })')

// 2. Update spawn to build prompt from template
const oldSpawn = 'process.stderr.write(`[Hub] 🤖 拉起 Worker: ${taskId}\\n`)\r\n      const worker = spawn("node", ["dist/hub-worker.js", "--task", taskId, "--hub", hubUrl, "--repo", repoPath],'
const newSpawn = `const meta=taskMeta.get(taskId);let promptB64="";if(meta){const tpl=TASK_TEMPLATES.find(t=>t.id===meta.templateId);if(tpl){const p=tpl.buildPrompt(meta.params);promptB64=Buffer.from(p,"utf-8").toString("base64")}}process.stderr.write(\`[Hub] 🤖 拉起 Worker: \${taskId}\\n\`);const workerArgs=["dist/hub-worker.js","--task",taskId,"--hub",hubUrl,"--repo",repoPath];if(promptB64)workerArgs.push("--prompt-b64",promptB64);const worker=spawn("node",workerArgs,`

s = s.replace(oldSpawn, newSpawn)

// 3. Add /api/templates endpoint
s = s.replace(
  '    // GET /api/health',
  '    // GET /api/templates\r\n    if (_req.method === "GET" && _req.url === "/api/templates") {\r\n      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })\r\n      res.end(JSON.stringify(TASK_TEMPLATES.map(t=>({id:t.id,name:t.name,description:t.description,prefix:t.prefix,fields:t.fields}))))\r\n      return\r\n    }\r\n\r\n    // GET /api/health')

writeFileSync("src/hub-server.ts", s, "utf8")
console.log("Updated hub-server.ts:", s.length)
