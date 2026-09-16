/// <reference types="vite/client" />

/** 빌드 시 주입되는 상수 (electron.vite.config.ts / vite.web.config.ts 의 define) */
declare const __PLATFORM__: 'electron' | 'web'
declare const __APP_VERSION__: string
