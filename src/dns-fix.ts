/**
 * DNS 修复模块 — 当系统 DNS 不可用时，自动回退到公共 DNS
 * ======================================================
 *
 * 问题: 某些 Windows 环境将 DNS 服务器设为 127.0.0.1（本地代理/VPN），
 * 但实际没有 DNS 服务在监听，导致域名解析失败 (ECONNREFUSED / ENOTFOUND)。
 *
 * 修复: 检测默认 DNS 是否可达，若不可达则自动切换至 8.8.8.8 / 1.1.1.1。
 *
 * v5 增强:
 * - 硬编码 IP 缓存 (hosts 映射) 作为最终兜底
 * - 修复成功后广播事件到 circuitBreaker，触发重置
 * - 增加导出函数供其他模块手动触发修复
 *
 * 用法: 在应用入口最先引入:
 *   import "./dns-fix.js"
 */

import dns from "node:dns"
import { promisify } from "node:util"
import { logger } from "./utils/logger.js"
import { circuitBreaker } from "./adapters/circuit-breaker.js"

const log = logger("dns-fix")
const FALLBACK_DNS = ["8.8.8.8", "1.1.1.1", "8.8.4.4"]
const TEST_DOMAIN = "one.one.one.one"

const resolve4Async = promisify(dns.resolve4)

// ═══════════════════════════════════════════════════════════════════════════
// 硬编码 IP 缓存 — 当 DNS 解析完全不可用时作为最终兜底
// ═══════════════════════════════════════════════════════════════════════════

const HOSTS_CACHE: Record<string, string[]> = {
  "www.okx.com": ["104.18.0.82", "104.18.1.82", "172.64.149.132"],
  "okx.com": ["104.18.0.82", "104.18.1.82", "172.64.149.132"],
  "api.coinbase.com": ["104.18.10.133", "104.18.11.133"],
  "one.one.one.one": ["1.1.1.1", "1.0.0.1"],
  "api.deepseek.com": ["47.89.198.197", "47.89.200.123"],
}

/** 从缓存中解析域名 */
function resolveFromCache(hostname: string): string[] | null {
  const normalized = hostname.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
  return HOSTS_CACHE[normalized] || null
}

// ═══════════════════════════════════════════════════════════════════════════
// 异步 DNS 检测
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 异步检测 DNS 是否可达，不可达则回退到公共 DNS。
 * 返回 true 表示 DNS 可用/已修复，false 表示修复失败。
 */
async function checkAndFixDns(): Promise<boolean> {
  try {
    const servers = dns.getServers()

    // 如果 DNS 已经配置为公共 DNS，无需修复
    if (servers.some(s => FALLBACK_DNS.includes(s))) {
      return true
    }

    // 如果只配置了 localhost，几乎肯定有问题
    const hasLocalhost = servers.some(s => s.startsWith("127."))
    if (!hasLocalhost) {
      // 非 localhost 配置，可能用户自定义了私有 DNS，不自动覆盖
      log.info(`DNS 非 localhost 配置 (${servers.join(", ")})，跳过自动修复`)
      return true
    }

    // 异步测试 DNS 是否可用
    try {
      await resolve4Async(TEST_DOMAIN)
      return true
    } catch (resolveErr: any) {
      const code = resolveErr.code || ""
      if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEOUT" || code === "EAI_AGAIN") {
        log.warn(`系统 DNS (${servers.join(", ")}) 不可达 (${code})，切换至公共 DNS: ${FALLBACK_DNS.join(", ")}`)
        dns.setServers(FALLBACK_DNS)

        // 验证修复：立即再次解析测试域名
        try {
          await resolve4Async(TEST_DOMAIN)
          log.info(`DNS 修复成功，当前服务器: ${dns.getServers().join(", ")}`)
          // 修复成功 → 通知 circuit breaker 重置 okx-api
          circuitBreaker.reset("okx-api")
          log.info(`⏰ DNS 修复 → 已重置熔断器 okx-api`)
          return true
        } catch (verifyErr: any) {
          log.warn(`公共 DNS 也无法解析: ${verifyErr.code} — ${verifyErr.message}，尝试硬编码缓存...`)
          // 公共 DNS 也不可用 → 走 hosts 缓存
          return tryHostsFallback()
        }
      }
      // 其他 DNS 错误（如 NXDOMAIN），不是 DNS 服务器问题，无需修复
      return true
    }
  } catch (e) {
    log.warn(`DNS 检测失败: ${e instanceof Error ? e.message : String(e)}`)
    return tryHostsFallback()
  }
}

/**
 * 使用硬编码 IP 缓存作为最终兜底。
 * 劫持 dns.resolve4 来插入缓存结果。
 */
function tryHostsFallback(): boolean {
  try {
    log.warn(`⚠️ 启用硬编码 hosts 缓存作为最终兜底`)
    // 劫持 dns.resolve4：先查缓存，缓存未命中再用系统 DNS
    const origResolve4 = (dns as any).resolve4
    if (!origResolve4.__patched) {
      function patchedResolve4(hostname: string, opts: any, cb?: any) {
        const cached = resolveFromCache(hostname)
        if (cached) {
          log.info(`hosts缓存命中: ${hostname} → ${cached.join(", ")}`)
          // 确保使用正确的回调方式
          const callback = typeof opts === 'function' ? opts : cb
          if (typeof callback === 'function') {
            callback(null, cached)
          }
          return
        }
        // 缓存未命中，回退到原始方法
        if (typeof opts === 'function') {
          origResolve4(hostname, opts)
        } else if (cb) {
          origResolve4(hostname, opts, cb)
        } else {
          origResolve4(hostname, opts)
        }
      }
      patchedResolve4.__patched = true
      ;(dns as any).resolve4 = patchedResolve4
    }
    // 通知 circuit breaker 重置
    circuitBreaker.reset("okx-api")
    log.info(`⏰ hosts缓存启用 → 已重置熔断器 okx-api`)
    return true
  } catch (e) {
    log.warn(`hosts 兜底失败: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/**
 * 同步兜底：如果异步修复失败，使用同步方式强制回退。
 * 用于模块加载时快速检测 localhost DNS 并切换。
 */
function checkAndFixDnsSyncFallback(): boolean {
  try {
    const servers = dns.getServers()
    const hasLocalhost = servers.some(s => s.startsWith("127."))

    // 只有在配置了 localhost DNS 且无公共 DNS 时才强制切换
    if (hasLocalhost && !servers.some(s => FALLBACK_DNS.includes(s))) {
      log.warn(`同步兜底: 检测到 localhost DNS (${servers.join(", ")})，强制切换至公共 DNS`)
      dns.setServers(FALLBACK_DNS)
      log.info(`同步兜底 DNS 切换完成，当前服务器: ${dns.getServers().join(", ")}`)
      return true
    }
    return true
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 导出工具函数
// ═══════════════════════════════════════════════════════════════════════════

export async function isDnsFixed(): Promise<boolean> {
  try {
    await resolve4Async(TEST_DOMAIN)
    return true
  } catch {
    // 尝试 hosts 缓存
    return resolveFromCache(TEST_DOMAIN) !== null
  }
}

export function getCurrentDnsServers(): string[] {
  return dns.getServers()
}

/** 供其他模块手动触发 DNS 修复 + circuit breaker 重置 */
export async function forceDnsRepair(): Promise<boolean> {
  log.info(`🛠️ 手动触发 DNS 修复...`)
  const result = await checkAndFixDns()
  if (result) {
    circuitBreaker.reset("okx-api")
    log.info(`🛠️ DNS 修复成功，熔断器已重置`)
  } else {
    log.warn(`🛠️ DNS 修复失败`)
  }
  return result
}

/**
 * 使用 hosts 缓存直接解析域名（不依赖系统 DNS）
 */
export function resolveWithCache(hostname: string): string[] | null {
  return resolveFromCache(hostname)
}

// ═══════════════════════════════════════════════════════════════════════════
// 模块加载时立即执行检测 + 修复
// ═══════════════════════════════════════════════════════════════════════════

// 第一步：同步兜底（只要 DNS 配置了 127.0.0.1 就强制切换，无需等待异步解析）
checkAndFixDnsSyncFallback()

// 第二步：异步精细检测（验证 DNS 是否真正可用，必要时再次修复）
checkAndFixDns().then(fixed => {
  if (fixed) {
    log.info(`DNS 自愈完成`)
  } else {
    log.warn(`DNS 自愈失败，将使用强行切换的公共 DNS`)
  }
}).catch(err => {
  log.warn(`DNS 自愈异常: ${err.message}`)
})

// 第三步：延迟二次验证（确保后续 API 调用时 DNS 已稳定）
setTimeout(async () => {
  try {
    await resolve4Async("www.okx.com")
    log.info(`DNS 二次验证: www.okx.com 解析成功`)
  } catch (e: any) {
    log.warn(`DNS 二次验证失败 (${e?.code || e?.message}), 再次尝试修复...`)
    dns.setServers(FALLBACK_DNS)
    try {
      await resolve4Async("www.okx.com")
      log.info(`DNS 二次修复成功`)
    } catch {
      log.warn(`DNS 二次修复失败，启用 hosts 缓存兜底`)
      tryHostsFallback()
    }
  }
}, 5000)

// ═══════════════════════════════════════════════════════════════════════════
// 第四步：周期性 DNS 健康检查（每 60 秒）
// 解决 VPN/代理软件定期重置 DNS 的问题
// ═══════════════════════════════════════════════════════════════════════════
setInterval(async () => {
  const servers = dns.getServers()
  // 快速检查：如果 DNS 又被重置回 localhost，立即修复
  if (servers.some(s => s.startsWith("127.")) && !servers.some(s => FALLBACK_DNS.includes(s))) {
    log.warn(`⏰ 周期性 DNS 检测: DNS 已被重置回 ${servers.join(", ")}，重新修复...`)
    dns.setServers(FALLBACK_DNS)
    log.info(`⏰ 周期性 DNS 修复完成: ${dns.getServers().join(", ")}`)
    // 重置熔断器
    circuitBreaker.reset("okx-api")
    log.info(`⏰ 周期性 DNS 修复 → 重置熔断器 okx-api`)
    return
  }

  // 深入检测：即使 DNS 不是 localhost，也要验证它是否真正可用
  try {
    await resolve4Async(TEST_DOMAIN)
  } catch (e: any) {
    // DNS 虽然配置了非 localhost，但也不可用 → 强制修复
    log.warn(`⏰ 周期性 DNS 检测: 当前 DNS (${servers.join(", ")}) 不可达 (${e.code})，强制切换至公共 DNS`)
    dns.setServers(FALLBACK_DNS)
    try {
      await resolve4Async(TEST_DOMAIN)
      log.info(`⏰ 周期性 DNS 修复成功: ${dns.getServers().join(", ")}`)
      circuitBreaker.reset("okx-api")
    } catch {
      log.warn(`⏰ 周期性 DNS: 公共 DNS 也无法解析，启用 hosts 缓存`)
      tryHostsFallback()
    }
  }
}, 60_000)
