// Build-output sanity check, run after `npm run build` (see `check:build`).
//
// Obfuscation rewrites every JS chunk, so a bad transform would only surface
// as a broken packaged app. This script catches the two failure classes a
// compile step can see without launching Electron:
//   1. Syntax — every emitted JS file must still parse.
//   2. ESM chunk wiring — every named import of a local chunk must match an
//      export of that chunk (obfuscator renames must not drift between the
//      declaration and its export clause).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { transform } from 'esbuild'

const OUT = 'out'
const failures = []

function listJsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full))
    else if (/\.js$/.test(name)) out.push(full)
  }
  return out
}

const files = listJsFiles(OUT)
if (files.length === 0) {
  console.error('check-build: no JS files found under out/ — run `npm run build` first')
  process.exit(1)
}

// 1. Every file must parse (esbuild throws on syntax errors).
for (const file of files) {
  try {
    await transform(readFileSync(file, 'utf8'), { loader: 'js' })
  } catch (err) {
    failures.push(`${file}: syntax error: ${err.message}`)
  }
}

// 2. Static import/export names must agree across local chunks.
const normalize = (path) => path.replaceAll('\\', '/')
const exportsOf = new Map()
for (const file of files) {
  const code = readFileSync(file, 'utf8')
  const names = new Set()
  for (const match of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const clause = part.trim()
      if (!clause) continue
      const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(clause)
      names.add(asMatch ? asMatch[2] : clause.split(/\s+/)[0])
    }
  }
  for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/g)) {
    names.add(match[1])
  }
  if (/export\s+default/.test(code)) names.add('default')
  exportsOf.set(normalize(file), names)
}

for (const file of files) {
  const code = readFileSync(file, 'utf8')
  const importRe = /import\s*(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}\s*)?from\s*['"](\.[^'"]+)['"]/g
  for (const match of code.matchAll(importRe)) {
    const target = normalize(join(file, '..', match[3].split('?')[0]))
    const exported = exportsOf.get(target)
    if (match[1] && !(exported && exported.has('default'))) {
      failures.push(`${file}: default import from ${match[3]} has no default export`)
    }
    if (!match[2]) continue
    for (const part of match[2].split(',')) {
      const clause = part.trim()
      const asMatch = /^([\w$]+)(?:\s+as\s+[\w$]+)?$/.exec(clause)
      const name = asMatch ? asMatch[1] : clause
      if (!name) continue
      if (!exported || !exported.has(name)) {
        failures.push(`${file}: imports "${name}" from ${match[3]} but that chunk does not export it`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`check-build: FAILED (${failures.length} problem(s)):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`check-build: OK (${files.length} JS files parse, chunk imports/exports agree)`)
