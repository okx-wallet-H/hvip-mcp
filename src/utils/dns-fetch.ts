/**
 * DNS 感知的 fetch 包装器
 * ============================
 *
 * 问题: Node.js 内置 fetch() 使用 undici HTTP 客户端，它绕过 Node.js 的 dns.setServers()，
 * 直接走系统 DNS 解析器（Windows 上为 127.0.0.1，由 VPN/代理软件设置但无实际 DNS 服务）。
 *
 * 后果: dns-fix.ts 虽已将 Node.js DNS 切换为 8.8.8.8，但 fetch() 仍因系统 DNS 不可达而失败。
 *
 * 修复: 用 node:https 替换 fetch，传入自定义 DNS lookup 函数，该函数使用已修复的 DNS。
 *
 * 用法:
 *   import { dnsFetch } from "./utils/dns-fetch.js"
 *   const res = await dnsFetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT")
 */

import https from "node:https"
import http from "node:http"
import { URL } from "node:url"
import dns from "node:dns"
import { promisify } from "node:util"

const resolve4Async = promisify(dns.resolve4)

/**
 * 使用 Node.js dns 模块（已由 dns-fix.ts 修复）进行解析的自定义 lookup 函数。
 * 也尝试使用硬编码 hosts 缓存。
 */
function dnsLookup(hostname: string, options: any, callback: (err: Error | null, address?: string, family?: number) => void): void {
  // 尝试 hosts 缓存（如果 dns-fix.ts 已启用）
  const cached = resolveFromCache(hostname)
  if (cached && cached.length > 0) {
    callback(null, cached[0], 4)
    return
  }

  // 使用 dns.resolve4（已由 dns-fix.ts 配置为 8.8.8.8）
  resolve4Async(hostname)
    .then(addresses => {
      if (addresses && addresses.length > 0) {
        callback(null, addresses[0], 4)
      } else {
        callback(new Error(`DNS resolve returned empty: ${hostname}`))
      }
    })
    .catch(err => {
      callback(err)
    })
}

/**
 * 硬编码 IP 缓存 — 当 DNS 解析完全不可用时作为最终兜底
 * 与 dns-fix.ts 中的缓存保持一致
 */
const HOSTS_CACHE: Record<string, string[]> = {
  "www.okx.com": ["104.18.0.82", "104.18.1.82", "172.64.149.132"],
  "okx.com": ["104.18.0.82", "104.18.1.82", "172.64.149.132"],
  "api.coinbase.com": ["104.18.10.133", "104.18.11.133"],
  "one.one.one.one": ["1.1.1.1", "1.0.0.1"],
  "api.deepseek.com": ["47.89.198.197", "47.89.200.123"],
}

function resolveFromCache(hostname: string): string[] | null {
  const normalized = hostname.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
  return HOSTS_CACHE[normalized] || null
}

/**
 * DNS 感知的 fetch — 替换全局 fetch 和直接 fetch 调用。
 *
 * 行为:
 * - 使用 node:https/node:http 代理实际请求
 * - DNS 解析使用 dns.resolve4（已由 dns-fix.ts 修复）
 * - 支持所有标准 HTTP 方法
 * - 支持超时
 * - 支持自定义 headers
 * - 返回标准 Response 对象（兼容现有代码）
 */
export async function dnsFetch(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
    timeout?: number
  } = {}
): Promise<Response> {
  const parsedUrl = new URL(url)
  const isHttps = parsedUrl.protocol === "https:"
  const mod = isHttps ? https : http

  const timeout = options.timeout || 30_000

  return new Promise<Response>((resolve, reject) => {
    // 信号处理
    const onAbort = () => {
      req.destroy(new Error("The operation was aborted"))
    }
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new Error("The operation was aborted"))
        return
      }
      options.signal.addEventListener("abort", onAbort, { once: true })
    }

    const req = mod.request(
      url,
      {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options.headers,
        },
        lookup: dnsLookup,
        timeout,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? false : true,
      },
      (res) => {
        // 清理 abort listener
        if (options.signal) {
          options.signal.removeEventListener("abort", onAbort)
        }

        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const body = Buffer.concat(chunks)
          resolve(
            new Response(body, {
              status: res.statusCode || 200,
              statusText: res.statusMessage || "OK",
              headers: res.headers as Record<string, string>,
            })
          )
        })
        res.on("error", (err) => {
          reject(err)
        })
      }
    )

    req.on("error", (err) => {
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort)
      }
      reject(err)
    })

    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"))
    })

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

/**
 * 补丁: 替换全局 fetch 为 dnsFetch。
 * 在应用入口处调用一次即可修复所有 fetch 调用。
 */
export function patchGlobalFetch(): void {
  const originalFetch = globalThis.fetch.bind(globalThis)
  const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method || "GET"
    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v })
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          headers[k] = v
        }
      } else {
        Object.assign(headers, init.headers)
      }
    }
    const body = init?.body?.toString()
    const signal = init?.signal
    const timeout = init?.signal ? undefined : 30_000

    return dnsFetch(url, { method, headers, body, signal, timeout })
  }

  // 只替换如果当前 fetch 有问题（通过测试 okx.com 是否可达）
  // 但为了保险，总是替换
  globalThis.fetch = patchedFetch as typeof globalThis.fetch
  console.log("[dns-fetch] 全局 fetch 已替换为 DNS 感知版本")
}

// 如果此模块被导入，自动打补丁
patchGlobalFetch()
