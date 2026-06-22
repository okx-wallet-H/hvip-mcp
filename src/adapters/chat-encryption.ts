/**
 * 聊天助手加密模块
 *
 * PBKDF2 密钥派生 + AES-256-GCM 加解密。
 * PIN 不落盘 — 只存 hash+salt 用于验证，加密密钥在解锁时实时派生。
 */

import crypto from "node:crypto"

const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEYLEN = 32 // 256-bit
const PBKDF2_DIGEST = "sha256"
const AES_ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // 96-bit for GCM
const AUTH_TAG_LENGTH = 16 // 128-bit

// ═══════════════════════════════════════════════════════════════
// PIN Hash (用于验证 PIN 是否正确，不用于加密)
// ═══════════════════════════════════════════════════════════════

export function hashPin(pin: string, salt?: Buffer): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(32)
  const h = crypto.pbkdf2Sync(pin, s, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
  return {
    hash: h.toString("base64"),
    salt: s.toString("base64"),
  }
}

export function verifyPin(pin: string, storedHash: string, storedSalt: string): boolean {
  const salt = Buffer.from(storedSalt, "base64")
  const { hash } = hashPin(pin, salt)
  return crypto.timingSafeEqual(Buffer.from(hash, "base64"), Buffer.from(storedHash, "base64"))
}

// ═══════════════════════════════════════════════════════════════
// OKX Key Encryption (AES-256-GCM)
// ═══════════════════════════════════════════════════════════════

/**
 * 从 PIN 派生加密密钥（与验证 hash 使用不同的 salt）
 * 防止：即使攻击者知道验证 hash 的 salt，也无法派生加密密钥
 */
export function deriveEncryptionKey(pin: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
}

export function generateKeySalt(): Buffer {
  return crypto.randomBytes(32)
}

/**
 * 加密 OKX 凭证
 * 返回 base64 编码的 iv / authTag / ciphertext
 */
export function encryptApiKey(
  plaintext: string,
  key: Buffer,
): { iv: string; authTag: string; ciphertext: string } {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  }
}

/**
 * 解密 OKX 凭证
 * 认证失败（PIN 错误/tampered）时抛出异常
 */
export function decryptApiKey(
  iv: string,
  authTag: string,
  ciphertext: string,
  key: Buffer,
): string {
  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    key,
    Buffer.from(iv, "base64"),
    { authTagLength: AUTH_TAG_LENGTH },
  )
  decipher.setAuthTag(Buffer.from(authTag, "base64"))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ])

  return decrypted.toString("utf8")
}

// ═══════════════════════════════════════════════════════════════
// 序列化：OKX Auth → 纯文本 ↔ 加密存储
// ═══════════════════════════════════════════════════════════════

export interface OkxCredentials {
  apiKey: string
  secret: string
  passphrase: string
  isDemo: boolean
}

const FIELD_SEPARATOR = "::"

export function packCredentials(cred: OkxCredentials): string {
  return [
    cred.apiKey,
    cred.secret,
    cred.passphrase,
    cred.isDemo ? "1" : "0",
  ].join(FIELD_SEPARATOR)
}

export function unpackCredentials(packed: string): OkxCredentials {
  const parts = packed.split(FIELD_SEPARATOR)
  return {
    apiKey: parts[0] || "",
    secret: parts[1] || "",
    passphrase: parts[2] || "",
    isDemo: parts[3] === "1",
  }
}

/**
 * 完整的加密存储流程
 */
export function encryptCredentials(
  cred: OkxCredentials,
  pin: string,
  keySalt: Buffer,
): { encryptedData: string; iv: string; authTag: string; keySalt: string; keyHint: string } {
  const key = deriveEncryptionKey(pin, keySalt)
  const packed = packCredentials(cred)
  const { iv, authTag, ciphertext } = encryptApiKey(packed, key)
  return {
    encryptedData: ciphertext,
    iv,
    authTag,
    keySalt: keySalt.toString("base64"),
    keyHint: cred.apiKey.slice(0, 4) + "****",
  }
}

/**
 * 完整的解密流程
 */
export function decryptCredentials(
  encryptedData: string,
  iv: string,
  authTag: string,
  keySaltBase64: string,
  pin: string,
): OkxCredentials | null {
  try {
    const keySalt = Buffer.from(keySaltBase64, "base64")
    const key = deriveEncryptionKey(pin, keySalt)
    const packed = decryptApiKey(iv, authTag, encryptedData, key)
    return unpackCredentials(packed)
  } catch {
    return null
  }
}
