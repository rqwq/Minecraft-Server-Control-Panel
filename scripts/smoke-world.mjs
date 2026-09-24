/**
 * Smoke test for world.ts: player-data migration (singleplayer level.dat <->
 * dedicated server playerdata), safe sync-back and crash recovery.
 *
 * Usage: npm run smoke:world
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  TAG_BYTE,
  TAG_COMPOUND,
  TAG_DOUBLE,
  TAG_FLOAT,
  TAG_INT,
  TAG_INT_ARRAY,
  TAG_LIST,
  TAG_LONG,
  TAG_STRING,
  parseNbt,
  writeNbt,
  readLevelDat,
  writeLevelDat,
  compoundChild
} from './.nbt.bundle.mjs'
// The singleplayer player's UUID (A) and the offline-server-assigned UUID (B) —
// the mismatch case that broke position/inventory sync-back.
import {
  createNewWorld,
  isNewWorldDir,
  hashPlayerData,
  seedPlayerData,
  readWorldInfo,
  recoverWorldFolder,
  savedPlayerUuid,
  syncBackWorld,
  choosePlayedFile,
  dirModifiedSince,
  copyTree
} from './.world.bundle.mjs'

let failures = 0
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`)
}

const UUID_A_INTS = Int32Array.from([-1180618119, -1859772090, 2063355745, -1918449483])

function uuidOfInts(ints) {
  // Same canonical mapping as the app: 4 big-endian ints, groups 8-4-4-4-12.
  const hex = [...ints].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
const uuidA = uuidOfInts(UUID_A_INTS)
const uuidB = '5f6b7c8d-1111-2222-3333-444455556666'

function playerTag(posX, uuidInts = UUID_A_INTS) {
  return {
    type: TAG_COMPOUND,
    value: {
      UUID: { type: TAG_INT_ARRAY, value: uuidInts },
      Pos: {
        type: TAG_LIST,
        value: [
          { type: TAG_DOUBLE, value: posX },
          { type: TAG_DOUBLE, value: 70 },
          { type: TAG_DOUBLE, value: 2.5 }
        ]
      },
      Health: { type: TAG_FLOAT, value: 20 },
      Inventory: {
        type: TAG_LIST,
        value: [{ type: TAG_COMPOUND, value: { id: { type: TAG_STRING, value: 'minecraft:diamond' } } }]
      }
    }
  }
}

function makeLevelDat(dir, { withPlayer = true, levelName = 'Test World', posX = 1.5, dayTime = 100n } = {}) {
  const data = {
    LevelName: { type: TAG_STRING, value: levelName },
    Version: { type: TAG_COMPOUND, value: { Name: { type: TAG_STRING, value: '1.21.4' } } },
    DataVersion: { type: TAG_INT, value: 4189 },
    GameType: { type: TAG_INT, value: 0 },
    difficulty: { type: TAG_BYTE, value: 2 },
    hardcore: { type: TAG_BYTE, value: 0 },
    allowCommands: { type: TAG_BYTE, value: 0 },
    RandomSeed: { type: TAG_LONG, value: 123456789n },
    DayTime: { type: TAG_LONG, value: dayTime }
  }
  if (withPlayer) data.Player = playerTag(posX)
  writeLevelDat(join(dir, 'level.dat'), { Data: { type: TAG_COMPOUND, value: data } })
}

const playerDataFileOf = (worldDir, uuid) => join(worldDir, 'playerdata', `${uuid}.dat`)
const readPlayerFile = (worldDir, uuid) => parseNbt(gunzipSync(readFileSync(playerDataFileOf(worldDir, uuid))))
const dataOf = (dir) => compoundChild(readLevelDat(join(dir, 'level.dat')), 'Data')

// ---- setup -------------------------------------------------------------------

const root = join(tmpdir(), `sc-world-smoke-${Date.now()}`)
rmSync(root, { recursive: true, force: true })
const savesWorld = join(root, 'saves', 'MyWorld')
const instanceWorld = join(root, 'instance', 'world')
mkdirSync(savesWorld, { recursive: true })
mkdirSync(instanceWorld, { recursive: true })

// Singleplayer world with the player inside level.dat.
makeLevelDat(savesWorld, { posX: 1.5 })

// ---- readWorldInfo: normal, missing level.dat, new world ---------------------

const info = readWorldInfo(savesWorld)
check('world info levelName', info.levelName, 'Test World')
check('world info seed', info.seed, '123456789')
check('world info size > 0', info.folderSizeBytes > 0, true)

const brokenDir = join(root, 'saves', 'BrokenWorld')
mkdirSync(brokenDir, { recursive: true })
check('missing level.dat flagged, not thrown', readWorldInfo(brokenDir).missingLevelDat, true)

const newWorldPath = createNewWorld(join(root, 'saves'), 'Brand New', '42')
check('new world marker', isNewWorldDir(newWorldPath), true)
check('new world info', readWorldInfo(newWorldPath).isNewWorld, true)

// ---- host: seed playerdata for the singleplayer UUID --------------------------

check('saved player uuid extracted', savedPlayerUuid(savesWorld), uuidA)

copyTree(savesWorld, instanceWorld)
const seeded = seedPlayerData(instanceWorld, [savedPlayerUuid(instanceWorld), null])
check('player seeded for singleplayer uuid', seeded.join(','), uuidA)
check('seeded Pos preserved', readPlayerFile(instanceWorld, uuidA).Pos.value[0].value, 1.5)

// Host-time record: hashes captured right after seeding, BEFORE the server runs.
const record = { spUuid: uuidA, playedUuid: null, hashes: hashPlayerData(instanceWorld) }
check('record captured the seeded file', Object.keys(record.hashes).join(','), uuidA)

// Idempotent: existing files are never clobbered (server progress wins).
const clobberWorld = join(root, 'instance', 'clobber')
mkdirSync(clobberWorld, { recursive: true })
copyTree(savesWorld, clobberWorld)
seedPlayerData(clobberWorld, [uuidA])
writeFileSync(
  playerDataFileOf(clobberWorld, uuidA),
  gzipSync(writeNbt({ ...readPlayerFile(clobberWorld, uuidA), Pos: playerTag(50).value.Pos }))
)
check('re-seed does not clobber existing file', seedPlayerData(clobberWorld, [uuidA]).length, 0)

// ---- play on the server under a MISMATCHED (offline) uuid ---------------------

// The server assigns uuid B (OfflinePlayer:<name>) — different from the
// singleplayer uuid A. It creates B's file; A's stale file is untouched.
const bPlayer = playerTag(99.5)
bPlayer.value.UUID = { type: TAG_INT_ARRAY, value: Int32Array.from([111, 222, 333, 444]) }
mkdirSync(join(instanceWorld, 'playerdata'), { recursive: true })
writeFileSync(playerDataFileOf(instanceWorld, uuidB), gzipSync(writeNbt(bPlayer.value)))

// The changed file must be detected as the played one — not the stale A file.
const played = choosePlayedFile(instanceWorld, record)
check('choosePlayedFile picks the server-rewritten file', played?.uuid, uuidB)

// ---- sync-back with the record: position + inventory carried over -------------

const result = syncBackWorld(instanceWorld, savesWorld, record)
check('sync-back migrated the played player (mismatched uuid)', result.migratedUuid, uuidB)

const swapped = dataOf(savesWorld)
check('sync-back carried player position', swapped.Player.value.Pos.value[0].value, 99.5)
check('sync-back carried inventory', swapped.Player.value.Inventory.value.length, 1)
check(
  'Player.UUID rewritten to the singleplayer uuid',
  Int32Array.from(swapped.Player.value.UUID.value).join(','),
  Int32Array.from(UUID_A_INTS).join(',')
)
check('level.dat backup written', readdirSync(savesWorld).filter((f) => /^level\.dat\.bak-/.test(f)).length, 1)
check('no leftover tmp/old dirs', readdirSync(join(root, 'saves')).filter((f) => f.startsWith('.sc-sync')).length, 0)

// The app persists playedUuid after a successful sync-back (ipc does this).
record.playedUuid = result.migratedUuid

// ---- next host: seeds the played uuid from Data.Player ------------------------

const instance2 = join(root, 'instance', 'world2')
mkdirSync(instance2, { recursive: true })
copyTree(savesWorld, instance2)
// Simulate a saves folder whose playerdata lacks the played file
// (e.g. synced from an older app version): the seed must restore it from
// the now-played Data.Player.
rmSync(playerDataFileOf(instance2, uuidB))
const seeded2 = seedPlayerData(instance2, [savedPlayerUuid(instance2), record.playedUuid])
check('next host seeds the played uuid from Data.Player', seeded2.join(','), uuidB)
check('seeded played data has the played position', readPlayerFile(instance2, uuidB).Pos.value[0].value, 99.5)

// ---- sync-back when nobody played: Data.Player is preserved -------------------

const record2 = { spUuid: uuidA, playedUuid: uuidB, hashes: hashPlayerData(instance2) }
const result2 = syncBackWorld(instance2, savesWorld, record2)
check('no players played -> no migration', result2.migratedUuid, null)
check('no players played -> Data.Player preserved', dataOf(savesWorld).Player.value.Pos.value[0].value, 99.5)

// ---- fallback path (no record): exact uuid match still works ------------------

const instance3 = join(root, 'instance', 'world3')
mkdirSync(instance3, { recursive: true })
copyTree(savesWorld, instance3)
writeFileSync(
  playerDataFileOf(instance3, uuidA),
  gzipSync(writeNbt({ ...readPlayerFile(instance3, uuidA), Pos: playerTag(77).value.Pos }))
)
const result3 = syncBackWorld(instance3, savesWorld)
check('fallback (no record) migrates by exact uuid', result3.migratedUuid, uuidA)
check('fallback carried position', dataOf(savesWorld).Player.value.Pos.value[0].value, 77)

// ---- auto-sync guard: dirModifiedSince ------------------------------------------

const guardDir = join(root, 'saves', 'GuardWorld')
mkdirSync(guardDir, { recursive: true })
writeFileSync(join(guardDir, 'level.dat'), 'x')
const past = new Date(Date.now() - 60000)
utimesSync(join(guardDir, 'level.dat'), past, past)
check('dirModifiedSince false for an untouched folder', dirModifiedSince(guardDir, Date.now() - 1000), false)
utimesSync(join(guardDir, 'level.dat'), new Date(), new Date())
check('dirModifiedSince true after a change', dirModifiedSince(guardDir, Date.now() - 1000), true)

// ---- crash recovery -------------------------------------------------------------

// Case 1: crash between renaming the original aside and moving the new copy in.
const crashWorld = join(root, 'saves', 'CrashWorld')
mkdirSync(crashWorld, { recursive: true })
makeLevelDat(crashWorld, { levelName: 'Crash World', posX: 5 })
const oldAside = join(root, 'saves', '.sc-sync-old-1700000000000')
renameSync(crashWorld, oldAside)
recoverWorldFolder(crashWorld)
check('recovery restores renamed-away original', existsSync(join(crashWorld, 'level.dat')), true)
check('recovery keeps original content', readWorldInfo(crashWorld).levelName, 'Crash World')

// Case 2: legacy crash — folder deleted, finished copy stuck in tmp.
rmSync(crashWorld, { recursive: true, force: true })
rmSync(oldAside, { recursive: true, force: true })
const tmpCopy = join(root, 'saves', '.sc-sync-tmp-1700000000001')
mkdirSync(tmpCopy, { recursive: true })
makeLevelDat(tmpCopy, { levelName: 'Recovered', posX: 7 })
recoverWorldFolder(crashWorld)
check('recovery finishes legacy tmp swap', readWorldInfo(crashWorld).levelName, 'Recovered')

// Case 3: healthy world with garbage leftovers — garbage is removed, world kept.
recoverWorldFolder(crashWorld)
check('healthy recovery keeps world', readWorldInfo(crashWorld).levelName, 'Recovered')
check('healthy recovery cleans leftovers', readdirSync(join(root, 'saves')).filter((f) => f.startsWith('.sc-sync')).length, 0)

// ---- sync-back refuses an ungenerated instance -----------------------------------

const emptyInstance = join(root, 'instance', 'empty-world')
mkdirSync(emptyInstance, { recursive: true })
let threw = false
try {
  syncBackWorld(emptyInstance, crashWorld)
} catch {
  threw = true
}
check('sync-back refuses world without level.dat', threw, true)

rmSync(root, { recursive: true, force: true })

console.log(failures === 0 ? '\nAll world smoke checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
