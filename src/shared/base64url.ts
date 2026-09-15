/** Node/브라우저 공용 Base64URL 유틸 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const REV = new Int16Array(128).fill(-1)
for (let i = 0; i < B64.length; i++) REV[B64.charCodeAt(i)] = i
REV[43] = 62 // '+'
REV[47] = 63 // '/'

export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  if (i < bytes.length) {
    const rem = bytes.length - i
    const n = (bytes[i] << 16) | (rem === 2 ? bytes[i + 1] << 8 : 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (rem === 2) out += B64[(n >> 6) & 63]
  }
  return out
}

export function fromBase64Url(str: string): Uint8Array {
  const clean = str.replace(/=+$/, '').trim()
  const len = clean.length
  const outLen = Math.floor((len * 3) / 4)
  const out = new Uint8Array(outLen)
  let buf = 0
  let bits = 0
  let j = 0
  for (let i = 0; i < len; i++) {
    const c = clean.charCodeAt(i)
    const v = c < 128 ? REV[c] : -1
    if (v < 0) throw new Error('invalid base64url character')
    buf = ((buf << 6) | v) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[j++] = (buf >> bits) & 0xff
    }
  }
  return out.subarray(0, j)
}

/** 표준 Base64(패딩 포함) → 바이트 */
export function fromStdBase64(s: string): Uint8Array {
  return fromBase64Url(s.replace(/\+/g, '-').replace(/\//g, '_'))
}

/** 바이트 → 표준 Base64(패딩 포함) */
export function toStdBase64(b: Uint8Array): string {
  const url = toBase64Url(b).replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (url.length % 4)) % 4
  return url + '='.repeat(pad)
}
