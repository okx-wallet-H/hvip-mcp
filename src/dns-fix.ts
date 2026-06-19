/**
 * DNS 修复模块 — 当系统 DNS 不可用时，自动回退到公共 DNS
 * ======================================================
 *
 * 问题: 某些 Windows 环境将 DNS 服务器设为 127.0.0.1（本地代理/VPN），
 * 但实际没有 DNS 服务在监听，导致域名解析失败 (ECONNREFUSED / ENOTFOUND)。
 *
 * 修复: 检测默认 DNS 是否可达，若不可达则自动切换至 8.8.8.8 / 1.1.1.1。
 *
 * 用法: 在应用入口最先引入:
 *   import "./dns-fix.js"
 */

import dns from "node:dns"
import { logger } from "./utils/logger.js"

const log = logger("dns-fix")
const FALLBACK_DNS = ["8.8.8.8", "1.1.1.1", "8.8.4.4"]

function checkAndFixDns(): void {
  try {
    const servers = dns.getServers()
    
    // 如果 DNS 已经配置为公共 DNS，无需修复
    if (servers.some(s => FALLBACK_DNS.includes(s))) {
      return
    }

    // 如果只配置了 localhost，几乎肯定有问题
    const hasLocalhost = servers.some(s => s.startsWith("127."))
    if (!hasLocalhost) {
      // 非 localhost 配置，可能用户自定义了私有 DNS，不自动覆盖
      return
    }

    // 尝试解析一个外部域名测试 DNS 是否可用
    const testDomain = "one.one.one.one" // Cloudflare
    dns.resolve4(testDomain, (err) => {
      if (err && (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "ETIMEOUT")) {
        // DNS 不可用 → 回退到公共 DNS
        log.warn(`系统 DNS (${servers.join(", ")}) 不可达 (${err.code})，切换至公共 DNS: ${FALLBACK_DNS.join(", ")}`)
        dns.setServers(FALLBACK_DNS)
        
        // 验证修复
        dns.resolve4("www.okx.com", (verifyErr) => {
          if (verifyErr) {
            log.warn(`公共 DNS 也无法解析: ${verifyErr.code}`)
          } else {
            log.info(`DNS 修复成功，当前服务器: ${dns.getServers().join(", ")}`)
          }
        })
      }
    })
  } catch (e) {
    log.warn(`DNS 检测失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

checkAndFixDns()
