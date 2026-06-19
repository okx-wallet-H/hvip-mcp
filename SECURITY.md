# Security Policy

## 支持版本

| 版本 | 支持状态 |
|------|----------|
| 0.5.x | ✅ 活跃支持 |
| 0.4.x | ❌ 不再支持 |
| < 0.4 | ❌ 不再支持 |

## 报告漏洞

如果你发现安全漏洞，**请不要在公开 Issue 中报告**。

请发送邮件至项目维护者，或通过 GitHub Security Advisory 私下报告:
https://github.com/okx-wallet-H/hvip-mcp/security/advisories/new

我们会在 48 小时内确认收到报告，并在 7 天内提供修复时间线。

## 安全最佳实践

### API 密钥

- **绝不**在代码中硬编码 API 密钥
- 所有密钥通过 `.env` 文件注入，`.env` 已在 `.gitignore` 中排除
- OKX API 密钥建议配置 IP 白名单 + 只读权限（除非需要交易）

### 执行模式

- 默认开启只读模式 (`OKX_READ_ONLY=true`)
- 交易功能需显式配置 API 密钥 + 关闭只读模式
- AI Trader 默认为 `simulate` 模式，`live` 需显式设置

### 网络安全

- Hub WebSocket 支持 PSK 鉴权 (`HUB_AUTH_TOKEN`)
- MCP HTTP 端点支持 Bearer Token 鉴权 (`MCP_AUTH_TOKEN`)
- 建议生产环境使用反向代理 (nginx/Caddy) + HTTPS

### 依赖安全

- 定期运行 `npm audit`
- CI 工作流包含 typecheck + lint + build + 自检
- 生产依赖仅包含必要包，开发工具仅在构建阶段使用

## 已知安全约束

- Worker v2 的 `run_command` 工具有命令白名单限制
- 文件读写工具限制在仓库根目录内，禁止路径遍历
- SQLite 数据库文件仅本地访问，无网络暴露

## 审计历史

- 2026-06: 三轮内部安全审计，P0/P1 全部清零
- 详见 `memory/security-audit-status.md`
