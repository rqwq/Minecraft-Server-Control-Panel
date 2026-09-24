/**
 * Smoke test for backups.ts: snapshot creation, hardlink dedup, pruning
 * (2 launch / 3 hourly), crash marking, deletion and restore semantics.
 *
 * Usage: npm run smoke:backups
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  initBackups,
  backupsDirFor,
  createSnapshot,
  listBackups,
  deleteBackup,
  markSessionCrashed,
  snapshotPath
} from './.backups.bundle.mjs'
import { copyTree, swapIntoSaves } from './.world.bundle.mjs'

let failures = 0
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`)
}

const root = join(tmpdir(), `sc-backups-smoke-${Date.now()}`)
rmSync(root, { recursive: true, force: true })
initBackups(root)

const worldPath = join(root, 'saves', 'World')
mkdirSync(join(worldPath, 'region'), { recursive: true })
writeFileSync(join(worldPath, 'level.dat'), 'state-A')
writeFileSync(join(worldPath, 'region', 'r.0.0.mca'), 'regiondata')

const worldKey = worldPath

// ---- launch snapshots + dedup ---------------------------------------------------

const snap1 = createSnapshot(worldPath, worldKey, 'launch', 111)
check('launch snapshot created', snap1 !== null, true)
check('snapshot file count', snap1.files, 2)

// Unchanged world -> second snapshot dedups the region file (same inode).
const snap2 = createSnapshot(worldPath, worldKey, 'launch', 222)
check('second launch snapshot created', snap2 !== null, true)
const region1 = join(backupsDirFor(worldKey), 'launch', `launch-${snap1.createdAt}`, 'region', 'r.0.0.mca')
const region2 = join(backupsDirFor(worldKey), 'launch', `launch-${snap2.createdAt}`, 'region', 'r.0.0.mca')
check('unchanged file is hardlinked (dedup)', statSync(region2).ino, statSync(region1).ino)

// Changed level.dat -> real copy, different inode.
writeFileSync(join(worldPath, 'level.dat'), 'state-B')
const snap3 = createSnapshot(worldPath, worldKey, 'launch', 333)
const level3 = join(backupsDirFor(worldKey), 'launch', `launch-${snap3.createdAt}`, 'level.dat')
check('changed file is a real copy', statSync(level3).ino !== statSync(region2).ino, true)

// Pruning: only the newest 2 launch snapshots remain (snap1 is gone).
const launchList = () => listBackups().filter((b) => b.kind === 'launch' && b.worldPath === worldKey)
check('launch pruned to 2', launchList().length, 2)
check('oldest launch pruned', launchList().every((b) => b.createdAt >= snap2.createdAt), true)

// ---- hourly snapshots + prune to 3 ----------------------------------------------

for (let i = 0; i < 5; i++) {
  writeFileSync(join(worldPath, 'level.dat'), `state-h${i}`)
  createSnapshot(worldPath, worldKey, 'hourly', 999)
}
const hourlyList = () => listBackups().filter((b) => b.kind === 'hourly' && b.worldPath === worldKey)
check('hourly pruned to 3', hourlyList().length, 3)

// ---- crash marking ---------------------------------------------------------------

markSessionCrashed(worldKey, 999)
check('crash marks the session snapshots', hourlyList().every((b) => b.crashed), true)
check('other sessions unaffected', launchList().every((b) => !b.crashed), true)

// ---- deletion --------------------------------------------------------------------

const victim = hourlyList()[0]
deleteBackup(worldPath, victim.id)
check('backup deleted', listBackups().some((b) => b.id === victim.id), false)
const region3 = join(backupsDirFor(worldKey), 'launch', `launch-${snap3.createdAt}`, 'region', 'r.0.0.mca')
check('deduped files survive deletion', existsSync(region2) && existsSync(region3), true)

// ---- restore semantics ------------------------------------------------------------

const saves2 = join(root, 'saves', 'RestoreWorld')
mkdirSync(saves2, { recursive: true })
writeFileSync(join(saves2, 'level.dat'), 'current-bad-state')
const snapshotDir = snapshotPath(worldKey, launchList()[0].id)
check('snapshot path resolves', snapshotDir !== null, true)
const tmp = join(root, 'saves', '.sc-restore-tmp-1')
copyTree(snapshotDir, tmp)
swapIntoSaves(tmp, saves2)
check('restore replaces the world', readFileSync(join(saves2, 'level.dat'), 'utf8'), 'state-B')
const bakName = readdirSync(saves2).find((f) => /^level\.dat\.bak-/.test(f)) ?? ''
check('old level.dat kept as backup', bakName.length > 0, true)

rmSync(root, { recursive: true, force: true })

console.log(failures === 0 ? '\nAll backups smoke checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
