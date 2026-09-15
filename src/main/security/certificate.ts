/**
 * 방장 자체 서명 인증서 (계획서 5.3)
 * 설치 후 첫 실행 시 생성하여 userData 에 보관하고, 초대코드에 SHA-256 지문을 넣어 참가자가 고정 검증한다.
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { generate } from 'selfsigned'
import { createLogger } from '../logger'

const log = createLogger('cert')

export interface HostCertificate {
  keyPem: string
  certPem: string
  /** 표준 Base64 SHA-256(DER) — Electron certificate.fingerprint 의 'sha256/' 뒤 부분과 동일 */
  fingerprintBase64: string
}

function certDir(): string {
  return path.join(app.getPath('userData'), 'cert')
}

export function pemToDer(pem: string): Buffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}

export function fingerprintOfCertPem(certPem: string): string {
  return createHash('sha256').update(pemToDer(certPem)).digest('base64')
}

export async function loadOrCreateHostCertificate(): Promise<HostCertificate> {
  const dir = certDir()
  const keyPath = path.join(dir, 'host.key.pem')
  const certPath = path.join(dir, 'host.cert.pem')
  try {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const keyPem = fs.readFileSync(keyPath, 'utf8')
      const certPem = fs.readFileSync(certPath, 'utf8')
      return { keyPem, certPem, fingerprintBase64: fingerprintOfCertPem(certPem) }
    }
  } catch (e) {
    log.warn('기존 인증서를 읽을 수 없어 새로 생성합니다', e)
  }

  const pems = await generate([{ name: 'commonName', value: 'sjting-host' }], {
    keySize: 2048,
    notAfterDate: new Date(Date.now() + 3650 * 24 * 3600 * 1000),
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true }
    ]
  })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(keyPath, pems.private, { encoding: 'utf8', mode: 0o600 })
  fs.writeFileSync(certPath, pems.cert, 'utf8')
  log.info('새 방장 인증서를 생성했습니다')
  return { keyPem: pems.private, certPem: pems.cert, fingerprintBase64: fingerprintOfCertPem(pems.cert) }
}
