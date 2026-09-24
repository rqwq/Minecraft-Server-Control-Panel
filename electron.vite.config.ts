import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import JavaScriptObfuscator from 'javascript-obfuscator'

/**
 * Obfuscates every emitted JS chunk of a production build so the packaged
 * app.asar ships unreadable code (the repo source itself stays clear).
 *
 * Runs only when mode === 'production' — `electron-vite build` (used by CI
 * and `npm run dist` before electron-builder). `npm run dev` builds the
 * main/preload bundles with mode 'development' and is never obfuscated.
 *
 * Transform choices are deliberately conservative: local identifiers and
 * string literals are mangled, but nothing is injected that could change
 * the semantics of import/require calls or ESM export clauses across
 * chunks (renameGlobals and transformObjectKeys stay off;
 * controlFlowFlattening / deadCodeInjection are skipped for build size and
 * runtime performance). External module specifiers survive the string
 * array untouched because the decoder still produces the exact original
 * string at runtime.
 */
function obfuscatePlugin(): Plugin {
  let enabled = false
  return {
    name: 'obfuscate-output',
    apply: 'build',
    configResolved(config) {
      enabled = config.mode === 'production'
    },
    generateBundle(_options, bundle) {
      if (!enabled) return
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !/\.[cm]?js$/.test(file.fileName)) continue
        const result = JavaScriptObfuscator.obfuscate(file.code, {
          compact: true,
          simplify: true,
          numbersToExpressions: true,
          stringArray: true,
          stringArrayEncoding: ['base64'],
          stringArrayThreshold: 1,
          splitStrings: true,
          splitStringsChunkLength: 8,
          identifierNamesGenerator: 'mangled',
          // Must stay off — see the comment above the factory.
          renameGlobals: false,
          transformObjectKeys: false,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          selfDefending: false,
          unicodeEscapeSequence: false
        })
        file.code = result.getObfuscatedCode()
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), obfuscatePlugin()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), obfuscatePlugin()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    esbuild: { jsx: 'automatic' },
    server: {
      // Dedicated port: never fight with other vite/Tauri dev servers over the
      // 5173+ default range (a Tauri devUrl pointing at 5173 would otherwise
      // load whichever server holds the port).
      host: '127.0.0.1',
      port: 5199
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [obfuscatePlugin()]
  }
})
