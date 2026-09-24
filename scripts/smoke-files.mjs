/**
 * Smoke test for files.ts: section resolution (custom / client pack / run
 * folder fallback), listing, drag-and-drop style adds (files and folders,
 * overwrite on re-add, same-path no-op), deletion with name validation, and
 * reveal.
 *
 * Usage: npm run smoke:files
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `sc-files-smoke-${Date.now()}`)
mkdirSync(join(root, 'userData'), { recursive: true })
process.env.SC_STUB_USERDATA = join(root, 'userData')

const { sectionDirFor, filesInfoFor, addFiles, deleteFile, revealEntry } = await import('./.files.bundle.mjs')

let failures = 0
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`)
}

const worldPath = join(root, 'saves', 'W')
mkdirSync(worldPath, { recursive: true })
writeFileSync(join(worldPath, 'level.dat'), 'nbt-ish')

const customDir = join(root, 'custom-server')
mkdirSync(customDir, { recursive: true })
const customProfile = { id: 'c1', kind: 'custom', customServerDir: customDir, clientPackDir: null, worlds: [{ path: worldPath }] }

const packDir = join(root, 'pack')
mkdirSync(packDir, { recursive: true })
const managedProfile = { id: 'm1', kind: 'neoforge', customServerDir: null, clientPackDir: packDir, worlds: [{ path: worldPath }] }
const noPackProfile = { id: 'm2', kind: 'vanilla', customServerDir: null, clientPackDir: null, worlds: [{ path: worldPath }] }

// ---- section resolution ----------------------------------------------------------

check('custom mods dir', sectionDirFor(customProfile, 'mods', worldPath).dir, join(customDir, 'mods'))
check('custom config dir', sectionDirFor(customProfile, 'config', worldPath).dir, join(customDir, 'config'))
check('client pack mods dir', sectionDirFor(managedProfile, 'mods', worldPath).dir, join(packDir, 'mods'))
check('client pack config dir', sectionDirFor(managedProfile, 'config', worldPath).dir, join(packDir, 'config'))

// The picker may also point straight at the pack's mods folder.
const modsPackProfile = { ...managedProfile, clientPackDir: join(packDir, 'mods') }
check('mods-folder pack: mods resolves to itself', sectionDirFor(modsPackProfile, 'mods', worldPath).dir, join(packDir, 'mods'))
check('mods-folder pack: config resolves beside it', sectionDirFor(modsPackProfile, 'config', worldPath).dir, join(packDir, 'config'))

check('client pack mods carries the source note', sectionDirFor(managedProfile, 'mods', worldPath).warning !== null, true)
check('client pack config has no warning', sectionDirFor(managedProfile, 'config', worldPath).warning !== null, false)
const fallback = sectionDirFor(noPackProfile, 'mods', worldPath)
check('run-folder fallback warns', fallback.warning !== null, true)
check(
  'run-folder fallback dir',
  fallback.dir.startsWith(join(root, 'userData', 'instances', 'm2')) && fallback.dir.endsWith('mods'),
  true
)

check('datapacks targets the source world', sectionDirFor(managedProfile, 'datapacks', worldPath).dir, join(worldPath, 'datapacks'))
check('datapacks without world has no dir', sectionDirFor(managedProfile, 'datapacks', null).dir, '')

// ---- listing ---------------------------------------------------------------------

const info = filesInfoFor(managedProfile, worldPath)
check('sections listed', info.sections.map((s) => s.id).join(','), 'mods,config,datapacks')
check('missing folders reported as not existing', info.sections.every((s) => !s.exists), true)
const infoNoWorld = filesInfoFor(managedProfile, null)
check('no world -> no datapacks section', infoNoWorld.sections.some((s) => s.id === 'datapacks'), false)

// ---- adds ------------------------------------------------------------------------

const src = join(root, 'downloads')
mkdirSync(src, { recursive: true })
writeFileSync(join(src, 'cool-mod.jar'), 'jar-bytes')
writeFileSync(join(src, 'another-mod.jar'), 'jar-bytes-2')
const packSrc = join(src, 'unzipped-datapack')
mkdirSync(join(packSrc, 'data'), { recursive: true })
writeFileSync(join(packSrc, 'pack.mcmeta'), '{}')
writeFileSync(join(packSrc, 'data', 'tick.mcfunction'), 'say hi')

const addedMods = addFiles(managedProfile, 'mods', worldPath, [join(src, 'cool-mod.jar'), join(src, 'another-mod.jar')])
check('two jars added', addedMods.join(','), 'cool-mod.jar,another-mod.jar')
check('mods folder created', existsSync(join(packDir, 'mods')), true)
check('jar content copied', readFileSync(join(packDir, 'mods', 'cool-mod.jar'), 'utf8'), 'jar-bytes')

// Re-dropping a folder replaces the old copy.
writeFileSync(join(packSrc, 'data', 'tick.mcfunction'), 'say updated')
const addedDir = addFiles(managedProfile, 'mods', worldPath, [packSrc])
check('folder add reported', addedDir.join(','), 'unzipped-datapack')
check('folder content copied', readFileSync(join(packDir, 'mods', 'unzipped-datapack', 'data', 'tick.mcfunction'), 'utf8'), 'say updated')

// Same-path drop is a no-op.
const listed = filesInfoFor(managedProfile, worldPath).sections.find((s) => s.id === 'mods')
const noOp = addFiles(managedProfile, 'mods', worldPath, [join(packDir, 'mods', 'cool-mod.jar')])
check('same-path drop is a no-op', noOp.length, 0)
check('list unchanged after no-op', filesInfoFor(managedProfile, worldPath).sections.find((s) => s.id === 'mods').entries.length, listed.entries.length)

// Folders sort before files, dirs flagged.
const modsEntries = filesInfoFor(managedProfile, worldPath).sections.find((s) => s.id === 'mods').entries
check('folders sort first', modsEntries[0].name, 'unzipped-datapack')
check('dir flag set', modsEntries[0].isDir, true)
check('file flag clear', modsEntries.find((e) => e.name === 'cool-mod.jar').isDir, false)

// Datapacks add creates the folder.
writeFileSync(join(src, 'map-pack.zip'), 'zip-bytes')
addFiles(managedProfile, 'datapacks', worldPath, [join(src, 'map-pack.zip')])
check('datapacks folder created in the world', existsSync(join(worldPath, 'datapacks', 'map-pack.zip')), true)

// ---- deletes ---------------------------------------------------------------------

deleteFile(managedProfile, 'mods', worldPath, 'cool-mod.jar')
check('file deleted', existsSync(join(packDir, 'mods', 'cool-mod.jar')), false)
deleteFile(managedProfile, 'mods', worldPath, 'unzipped-datapack')
check('folder deleted', existsSync(join(packDir, 'mods', 'unzipped-datapack')), false)

let threw = ''
try {
  deleteFile(managedProfile, 'mods', worldPath, '..\\evil')
} catch (err) {
  threw = err instanceof Error ? err.message : String(err)
}
check('traversal name rejected', threw.length > 0, true)

threw = ''
try {
  deleteFile(managedProfile, 'mods', worldPath, 'missing.jar')
} catch (err) {
  threw = err instanceof Error ? err.message : String(err)
}
check('missing file rejected', threw.length > 0, true)

// ---- reveal ----------------------------------------------------------------------

check('reveal missing entry fails', revealEntry(managedProfile, 'mods', worldPath, 'missing.jar'), false)
check('reveal folder creates it on demand', revealEntry(managedProfile, 'config', worldPath, null), true)
check('folder created by reveal', existsSync(join(packDir, 'config')), true)

// Datapacks need a world.
threw = ''
try {
  addFiles(managedProfile, 'datapacks', null, [join(src, 'map-pack.zip')])
} catch (err) {
  threw = err instanceof Error ? err.message : String(err)
}
check('datapacks add without world throws', threw.length > 0, true)

rmSync(root, { recursive: true, force: true })

console.log(failures === 0 ? '\nAll files smoke checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
