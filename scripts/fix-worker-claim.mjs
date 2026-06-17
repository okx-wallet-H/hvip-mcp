import { readFileSync, writeFileSync } from "node:fs"

let s = readFileSync("src/hub-worker.ts", "utf8")

s = s.replace(
  "process.stderr.write(`[Worker] 注册成功。可用任务: [${(msg.pendingTasks || []).join(\", \")}]`)\r\n      break",
  "process.stderr.write(`[Worker] 注册成功。可用任务: [${(msg.pendingTasks || []).join(\", \")}]`)\r\n      if (msg.pendingTasks?.includes(TASK_ID) && !taskReceived) {\r\n        taskReceived = true\r\n        doTask(TASK_ID, `Hub 任务: ${TASK_ID}`, \"\", PROMPT_B64)\r\n      }\r\n      break"
)

writeFileSync("src/hub-worker.ts", s, "utf8")
console.log("done")
