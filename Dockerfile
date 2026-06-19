# hvip-mcp-server Docker 镜像
# =============================
# 多阶段构建：第一阶段编译，第二阶段最小运行时

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S hvip && adduser -S hvip -G hvip
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/ecosystem.config.cjs ./
RUN npm ci --omit=dev && npm install -g pm2
USER hvip
EXPOSE 3000 9321 9222
ENV NODE_ENV=production
CMD ["pm2-runtime", "ecosystem.config.cjs"]
