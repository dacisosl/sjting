/**
 * 웹앱 빌드 — 결과물은 cloud/public 에 생성되어 Cloudflare Worker 의 정적 파일(assets)로 함께 배포된다.
 * Electron 렌더러와 같은 소스(src/renderer)를 쓰며 __PLATFORM__ 만 'web' 으로 다르다.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve('src/renderer'),
  publicDir: resolve('src/renderer/public-web'),
  base: '/',
  plugins: [react(), tailwindcss()],
  define: { __PLATFORM__: JSON.stringify('web'), __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  build: {
    outDir: resolve('cloud/public'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022'
  }
})
