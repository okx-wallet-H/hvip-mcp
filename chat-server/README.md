# hvip AI 交易助手

独立聊天服务，对接 MCP 调用 OKX 工具。

## 初始化

```bash
cd chat-server
npm install
cp .env.example .env   # 编辑填入 API Key
```

## .env 配置

```env
# DeepSeek（推荐，便宜）
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/anthropic

# 或者 Anthropic 直连
# ANTHROPIC_API_KEY=sk-xxx

# MCP 地址（默认本机）
MCP_URL=http://127.0.0.1:9222/mcp

# 端口（默认 3100）
CHAT_PORT=3100
```

## 启动

```bash
npm start
```

访问 `http://localhost:3100`

## PM2 守护

```bash
pm2 start server.js --name hvip-chat
pm2 save
```
