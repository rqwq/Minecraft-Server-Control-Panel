import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  compoundChild,
  longChild,
  numberChild,
  parseNbt,
  readLevelDat,
  stringChild,
  TAG_BYTE,
  TAG_COMPOUND,
  TAG_INT,
  TAG_INT_ARRAY,
  TAG_STRING,
  writeLevelDat,
  writeNbt,
  type NbtCompound
} from './nbt'
import type { LevelEdits, WorldInfo } from '../shared/types'
import { fileHash } from './playerSync'

const SKIP_COPY_NAMES = new Set(['session.lock'])

// Minecraft 26.x stores difficulty by name inside difficulty_settings.
const DIFFICULTY_NAMES = ['peaceful', 'easy', 'normal', 'hard']

/** Marks a just-created world folder; the server generates the level.dat on first host. */
export const NEW_WORLD_MARKER = '.sc-new-world.json'

export interface NewWorldMarker {
  name: string
  seed: string | null
  created: string
}

export function isNewWorldDir(dir: string): boolean {
  return existsSync(dir) && existsSync(join(dir, NEW_WORLD_MARKER))
}

export function readNewWorldMarker(dir: string): NewWorldMarker | null {
  if (!isNewWorldDir(dir)) return null
  try {
    return JSON.parse(readFileSync(join(dir, NEW_WORLD_MARKER), 'utf8')) as NewWorldMarker
  } catch {
    return null
  }
}

/** Create a fresh (empty) world folder in saves; the server generates it on first host. */
export function createNewWorld(savesDir: string, rawName: string, rawSeed: string | null): string {
  const name = rawName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'New World'
  const seed = rawSeed !== null ? rawSeed.trim() : ''
  mkdirSync(savesDir, { recursive: true })

  let target = join(savesDir, name)
  for (let i = 2; existsSync(target); i++) {
    target = join(savesDir, `${name} (${i})`)
  }

  mkdirSync(target, { recursive: true })
  const marker: NewWorldMarker = { name, seed: seed.length > 0 ? seed : null, created: new Date().toISOString() }
  writeFileSync(join(target, NEW_WORLD_MARKER), JSON.stringify(marker, null, 2), 'utf8')
  return target
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

interface WalkEntry {
  src: string
  dest: string
  size: number
  isDir: boolean
}

export function walkTree(rootSrc: string, rootDest: string): WalkEntry[] {
  const entries: WalkEntry[] = []
  const recurse = (src: string, dest: string): void => {
    for (const item of readdirSync(src, { withFileTypes: true })) {
      if (SKIP_COPY_NAMES.has(item.name)) continue
      const s = join(src, item.name)
      const d = join(dest, item.name)
      if (item.isDirectory()) {
        entries.push({ src: s, dest: d, size: 0, isDir: true })
        recurse(s, d)
      } else if (item.isFile()) {
        entries.push({ src: s, dest: d, size: 0, isDir: false })
      }
    }
  }
  recurse(rootSrc, rootDest)
  return entries
}

function dirSizeBytes(dir: string): number {
  let total = 0
  for (const entry of walkTree(dir, dir)) {
    if (entry.isDir) continue
    try {
      total += statSync(entry.src).size
    } catch {
      /* unreadable file — ignore */
    }
  }
  return total
}

export function isValidWorld(dir: string): boolean {
  return existsSync(join(dir, 'level.dat'))
}

export function readWorldInfo(dir: string): WorldInfo {
  if (!isValidWorld(dir)) {
    // A created-but-never-hosted new world has no level.dat yet.
    if (isNewWorldDir(dir)) {
      const marker = readNewWorldMarker(dir)
      return {
        path: dir,
        levelName: marker?.name ?? basename(dir),
        versionName: '—',
        dataVersion: null,
        seed: marker?.seed ?? null,
        gameType: 0,
        difficulty: 2,
        hardcore: false,
        cheats: false,
        dayTime: null,
        folderSizeBytes: 0,
        playerCount: 0,
        isNewWorld: true
      }
    }
    if (existsSync(dir)) {
      // The folder exists but its level.dat is gone (e.g. an interrupted sync-back).
      // Report it as damaged rather than throwing — Sync back can restore it.
      return {
        path: dir,
        levelName: basename(dir),
        versionName: '—',
        dataVersion: null,
        seed: null,
        gameType: 0,
        difficulty: 2,
        hardcore: false,
        cheats: false,
        dayTime: null,
        folderSizeBytes: dirSizeBytes(dir),
        playerCount: 0,
        missingLevelDat: true
      }
    }
    throw new Error(`World folder does not exist:\n${dir}`)
  }
  const root = readLevelDat(join(dir, 'level.dat'))
  const data = compoundChild(root, 'Data')
  if (!data) throw new Error('level.dat is missing the Data compound')

  const version = compoundChild(data, 'Version')
  const worldGen = compoundChild(data, 'WorldGenSettings')
  let seedLong = longChild(data, 'RandomSeed') ?? (worldGen ? longChild(worldGen, 'seed') : null)
  const dayTime = longChild(data, 'DayTime')
  // Minecraft 26.x moved worldgen settings (including the seed) out of level.dat.
  if (seedLong === null) {
    const genSettings = join(dir, 'data', 'minecraft', 'world_gen_settings.dat')
    if (existsSync(genSettings)) {
      try {
        const genData = compoundChild(readLevelDat(genSettings), 'data')
        seedLong = genData ? longChild(genData, 'seed') : null
      } catch {
        /* unreadable worldgen settings — leave the seed unknown */
      }
    }
  }
  // 26.x also moved difficulty/hardcore into a difficulty_settings compound.
  const diffSettings = compoundChild(data, 'difficulty_settings')
  let difficulty: number | null = numberChild(data, 'difficulty')
  if (difficulty === null && diffSettings) {
    const byName = stringChild(diffSettings, 'difficulty')
    difficulty = byName !== null ? DIFFICULTY_NAMES.indexOf(byName) : numberChild(diffSettings, 'difficulty')
    if (difficulty === -1) difficulty = null
  }

  const playerdataDir = join(dir, 'playerdata')
  const playerCount = existsSync(playerdataDir)
    ? readdirSync(playerdataDir).filter((f) => f.toLowerCase().endsWith('.dat')).length
    : 0

  return {
    path: dir,
    levelName: stringChild(data, 'LevelName') ?? '(unnamed)',
    versionName: version ? (stringChild(version, 'Name') ?? 'unknown') : 'unknown',
    dataVersion: numberChild(data, 'DataVersion'),
    seed: seedLong !== null ? seedLong.toString() : null,
    gameType: numberChild(data, 'GameType') ?? 0,
    difficulty: difficulty ?? 2,
    hardcore:
      (numberChild(data, 'hardcore') ?? (diffSettings ? numberChild(diffSettings, 'hardcore') : null) ?? 0) !== 0,
    cheats: (numberChild(data, 'allowCommands') ?? 0) !== 0,
    dayTime: dayTime !== null ? dayTime.toString() : null,
    folderSizeBytes: dirSizeBytes(dir),
    playerCount
  }
}

export interface SaveLevelResultData {
  backupPath: string | null
}

export function saveLevelEdits(dir: string, edits: LevelEdits): SaveLevelResultData {
  const levelPath = join(dir, 'level.dat')
  const root = readLevelDat(levelPath)
  const data = compoundChild(root, 'Data')
  if (!data) throw new Error('level.dat is missing the Data compound')

  const backupPath = `${levelPath}.bak-${timestamp()}`
  copyFileSync(levelPath, backupPath)

  const setTag = (key: string, tag: NbtCompound[string]): void => {
    data[key] = tag
  }

  if (edits.levelName !== undefined && edits.levelName.trim().length > 0) {
    setTag('LevelName', { type: TAG_STRING, value: edits.levelName.trim() })
  }
  if (edits.gameType !== undefined) {
    setTag('GameType', { type: TAG_INT, value: edits.gameType })
  }
  if (edits.difficulty !== undefined) {
    if (data['difficulty'] !== undefined) setTag('difficulty', { type: TAG_BYTE, value: edits.difficulty })
    // Minecraft 26.x keeps difficulty in a difficulty_settings compound, as a name string.
    const diffSettings = compoundChild(data, 'difficulty_settings')
    if (diffSettings) {
      const existing = diffSettings['difficulty']
      diffSettings['difficulty'] =
        existing && existing.type === TAG_STRING
          ? { type: TAG_STRING, value: DIFFICULTY_NAMES[edits.difficulty] ?? 'normal' }
          : { type: TAG_BYTE, value: edits.difficulty }
    }
  }
  if (edits.hardcore !== undefined) {
    if (data['hardcore'] !== undefined) setTag('hardcore', { type: TAG_BYTE, value: edits.hardcore ? 1 : 0 })
    const diffSettings = compoundChild(data, 'difficulty_settings')
    if (diffSettings) diffSettings['hardcore'] = { type: TAG_BYTE, value: edits.hardcore ? 1 : 0 }
  }
  if (edits.cheats !== undefined) {
    setTag('allowCommands', { type: TAG_BYTE, value: edits.cheats ? 1 : 0 })
  }

  writeLevelDat(levelPath, root)
  return { backupPath }
}

export interface CopyProgress {
  files: number
  totalFiles: number
  bytes: number
  totalBytes: number
}

/**
 * Recursively mirror src into dest (dest is recreated). Skips session.lock.
 * The size walk happens first so progress can report totals.
 */
export function copyTree(src: string, dest: string, onProgress?: (p: CopyProgress) => void): void {
  if (!existsSync(src)) throw new Error(`Source folder does not exist: ${src}`)
  const entries = walkTree(src, dest)
  for (const entry of entries) {
    if (!entry.isDir) entry.size = statSize(entry.src)
  }
  const totalFiles = entries.filter((e) => !e.isDir).length
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  let files = 0
  let bytes = 0
  let lastReport = 0
  for (const entry of entries) {
    if (entry.isDir) {
      mkdirSync(entry.dest, { recursive: true })
      continue
    }
    mkdirSync(dirname(entry.dest), { recursive: true })
    copyFileSync(entry.src, entry.dest)
    // Preserve the source mtime so backup snapshots can hardlink-dedup
    // unchanged files across copies.
    try {
      const st = statSync(entry.src)
      utimesSync(entry.dest, st.atime, st.mtime)
    } catch {
      /* cosmetic only */
    }
    files++
    bytes += entry.size
    const now = Date.now()
    if (onProgress && now - lastReport > 100) {
      lastReport = now
      onProgress({ files, totalFiles, bytes, totalBytes })
    }
  }
  if (onProgress) onProgress({ files, totalFiles, bytes, totalBytes })
}

function statSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Player data migration (singleplayer level.dat <-> dedicated server playerdata)
//
// Singleplayer keeps the local player inside level.dat (Data.Player); a
// dedicated server keeps players in playerdata/<uuid>.dat and ignores
// Data.Player. The UUID an offline-mode server assigns (derived from the
// player name) often differs from the singleplayer UUID, so we cannot rely on
// names matching: on host we seed playerdata for every known UUID, and on
// sync-back we migrate whichever playerdata file the server actually rewrote
// during the session (tracked via content hashes — see playerSync.ts).
// ---------------------------------------------------------------------------

const HEX = (v: bigint, pad: number): string => v.toString(16).padStart(pad, '0')

/** Canonical UUID string from a player compound's UUID tag (int-array or legacy long pair). */
function playerUuid(player: NbtCompound): string | null {
  const uuidTag = player['UUID']
  if (uuidTag && uuidTag.type === TAG_INT_ARRAY) {
    const arr = uuidTag.value as Int32Array
    if (arr.length === 4) {
      // The 4 ints are the 128-bit UUID big-endian; groups are 8-4-4-4-12 hex digits.
      const hex = [...arr].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    }
  }
  const most = longChild(player, 'UUIDMost')
  const least = longChild(player, 'UUIDLeast')
  if (most !== null && least !== null) {
    const hex = `${HEX(BigInt.asUintN(64, most), 16)}${HEX(BigInt.asUintN(64, least), 16)}`
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }
  return null
}

/** The 4 NBT UUID ints for a canonical UUID string, or null when malformed. */
function uuidToInts(uuid: string): Int32Array | null {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(uuid.trim())
  if (!m) return null
  const hex = m.slice(1).join('')
  return Int32Array.from({ length: 4 }, (_, i) => Number.parseInt(hex.slice(i * 8, i * 8 + 8), 16) | 0)
}

function playerDataPath(worldDir: string, uuid: string): string {
  return join(worldDir, 'playerdata', `${uuid}.dat`)
}

function listPlayerDataFiles(worldDir: string): string[] {
  const dir = join(worldDir, 'playerdata')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.dat'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

/** uuid (file name) for a playerdata file path. */
function uuidOf(path: string): string {
  return basename(path).replace(/\.dat$/i, '')
}

/** uuid -> sha1 of every playerdata file (used to detect server rewrites). */
export function hashPlayerData(worldDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of listPlayerDataFiles(worldDir)) {
    out[uuidOf(file)] = fileHash(file)
  }
  return out
}

/**
 * On host: write the singleplayer player (level.dat Data.Player) into
 * playerdata/<uuid>.dat for every UUID that has no file yet — the singleplayer
 * UUID and the (offline-mode) server UUID, so the server resumes position,
 * inventory and health no matter which one the player joins as. Never
 * clobbers existing files: server progress always wins. Returns the UUIDs
 * actually seeded.
 */
export function seedPlayerData(worldDir: string, uuids: Array<string | null>): string[] {
  const levelPath = join(worldDir, 'level.dat')
  if (!existsSync(levelPath)) return []
  let player: NbtCompound | null = null
  try {
    const data = compoundChild(readLevelDat(levelPath), 'Data')
    player = data ? compoundChild(data, 'Player') : null
  } catch {
    return []
  }
  if (!player) return []

  const seeded: string[] = []
  for (const raw of uuids) {
    const uuid = raw?.trim().toLowerCase()
    if (!uuid) continue
    const target = playerDataPath(worldDir, uuid)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    // playerdata/<uuid>.dat is a gzip'd NBT whose root compound IS the player.
    writeFileSync(target, gzipSync(writeNbt(player)))
    seeded.push(uuid)
  }
  return seeded
}

export interface PlayerRecordLike {
  spUuid?: string | null
  playedUuid?: string | null
  hashes?: Record<string, string>
}

export interface PlayedFile {
  path: string
  uuid: string
}

/**
 * The playerdata file the server actually rewrote during the hosted session:
 * any file whose content hash differs from the recorded post-seed hash, or
 * that was not recorded at all (created by the server during play).
 * Preference: the remembered playedUuid, then the singleplayer UUID, then the
 * sole candidate, then the most recently modified file.
 */
export function choosePlayedFile(worldDir: string, record: PlayerRecordLike): PlayedFile | null {
  const candidates: PlayedFile[] = []
  for (const file of listPlayerDataFiles(worldDir)) {
    const uuid = uuidOf(file)
    const recorded = record.hashes?.[uuid]
    const current = fileHash(file)
    if (recorded === undefined || recorded !== current) candidates.push({ path: file, uuid })
  }
  if (candidates.length === 0) return null
  if (record.playedUuid) {
    const byPlayed = candidates.find((c) => c.uuid === record.playedUuid?.toLowerCase())
    if (byPlayed) return byPlayed
  }
  if (record.spUuid) {
    const bySp = candidates.find((c) => c.uuid === record.spUuid?.toLowerCase())
    if (bySp) return bySp
  }
  if (candidates.length === 1) return candidates[0]
  return candidates.reduce((newest, c) => (statMtime(c.path) > statMtime(newest.path) ? c : newest))
}

function statMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * True when any file in `dir` changed after `sinceMs` — used to detect that
 * the original saves folder was played in singleplayer while the server ran,
 * in which case an automatic sync-back must not overwrite it.
 */
export function dirModifiedSince(dir: string, sinceMs: number): boolean {
  if (!existsSync(dir)) return false
  for (const entry of walkTree(dir, dir)) {
    if (!entry.isDir && statMtime(entry.src) > sinceMs) return true
  }
  return false
}

/**
 * On sync-back: write the played player (source playerdata file) back into the
 * level.dat's Data.Player, so singleplayer resumes where the player left the
 * server, with the server inventory. The Player.UUID tag is rewritten to the
 * singleplayer UUID so singleplayer treats the data as its own local player.
 */
export function migratePlayerIn(worldDir: string, previousUuid: string | null, source?: PlayedFile | null): string | null {
  const levelPath = join(worldDir, 'level.dat')
  if (!existsSync(levelPath)) return null

  let resolved: PlayedFile | null = source ?? null
  if (!resolved) {
    // No explicit source: fall back to exact UUID match, then the only file.
    if (previousUuid && existsSync(playerDataPath(worldDir, previousUuid))) {
      resolved = { path: playerDataPath(worldDir, previousUuid), uuid: previousUuid }
    } else {
      const files = listPlayerDataFiles(worldDir)
      if (files.length === 1) resolved = { path: files[0], uuid: uuidOf(files[0]) }
    }
  }
  if (!resolved) return null

  try {
    const player = parseNbt(gunzipSync(readFileSync(resolved.path)))
    const root = readLevelDat(levelPath)
    const data = compoundChild(root, 'Data')
    if (!data) return null
    // Keep the player's UUID tag consistent with the singleplayer account that
    // owns this save, so singleplayer treats it as its own local player.
    if (previousUuid && previousUuid.toLowerCase() !== resolved.uuid.toLowerCase()) {
      const ints = uuidToInts(previousUuid)
      if (ints) {
        player['UUID'] = { type: TAG_INT_ARRAY, value: ints }
      }
    }
    data['Player'] = { type: TAG_COMPOUND, value: player }
    writeLevelDat(levelPath, root)
    return resolved.uuid
  } catch {
    return null
  }
}

/** UUID of the singleplayer player in a saves world's level.dat, if any. */
export function savedPlayerUuid(worldDir: string): string | null {
  const levelPath = join(worldDir, 'level.dat')
  if (!existsSync(levelPath)) return null
  try {
    const data = compoundChild(readLevelDat(levelPath), 'Data')
    const player = data ? compoundChild(data, 'Player') : null
    return player ? playerUuid(player) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sync back
// ---------------------------------------------------------------------------

/**
 * Atomically replace the saves world folder with `readyDir` (a complete copy
 * already placed in the saves root). The old folder is renamed aside and only
 * deleted after the new one is in place; a crash mid-way is rolled back or
 * finished by recoverWorldFolder().
 */
export function swapIntoSaves(readyDir: string, savesWorldDir: string): void {
  const savesRoot = dirname(savesWorldDir)
  const old = join(savesRoot, `.sc-sync-old-${Date.now()}`)

  let oldLevel: Buffer | null = null
  if (existsSync(savesWorldDir)) {
    const levelPath = join(savesWorldDir, 'level.dat')
    if (existsSync(levelPath)) {
      try {
        oldLevel = readFileSync(levelPath)
      } catch {
        oldLevel = null
      }
    }
    renameSync(savesWorldDir, old)
  }

  try {
    renameSync(readyDir, savesWorldDir)
  } catch (err) {
    // Roll back: put the original folder back before surfacing the error.
    if (existsSync(old) && !existsSync(savesWorldDir)) renameSync(old, savesWorldDir)
    rmSync(readyDir, { recursive: true, force: true })
    throw err
  }

  if (oldLevel) {
    writeFileSync(join(savesWorldDir, `level.dat.bak-${timestamp()}`), oldLevel)
  }
  rmSync(old, { recursive: true, force: true })
}

export interface SyncBackResult {
  /** UUID whose playerdata was carried back into level.dat Data.Player, if any. */
  migratedUuid: string | null
}

/**
 * Replace the original saves world with the instance copy. The old folder is
 * renamed aside (never deleted first), the new copy is renamed into place, and
 * only then is the old folder removed — a crash mid-way can always be rolled
 * forward or back by recoverWorldFolder(). The player the server actually
 * rewrote during the session (per `record`) is carried back into Data.Player.
 */
export function syncBackWorld(
  instanceWorldDir: string,
  savesWorldDir: string,
  record?: PlayerRecordLike
): SyncBackResult {
  if (!existsSync(instanceWorldDir)) {
    throw new Error(`No instance world copy found at:\n${instanceWorldDir}`)
  }
  if (!existsSync(join(instanceWorldDir, 'level.dat'))) {
    throw new Error('The instance world has no level.dat — it was never generated. Host it first, then sync back.')
  }
  const savesRoot = dirname(savesWorldDir)
  const tmp = join(savesRoot, `.sc-sync-tmp-${Date.now()}`)

  copyTree(instanceWorldDir, tmp)

  // Carry the played player back into level.dat for singleplayer. With a
  // record, only a server-rewritten file qualifies; if nobody played this
  // session, Data.Player stays as-is. Without a record, fall back to exact
  // UUID matching (legacy behavior).
  const previousUuid = savedPlayerUuid(savesWorldDir)
  let migratedUuid: string | null = null
  if (record) {
    const played = choosePlayedFile(tmp, record)
    migratedUuid = played ? migratePlayerIn(tmp, previousUuid, played) : null
  } else {
    migratedUuid = migratePlayerIn(tmp, previousUuid)
  }

  swapIntoSaves(tmp, savesWorldDir)
  return { migratedUuid }
}

/**
 * Repair a saves folder left mid-swap by a crash during sync-back.
 * Called once per known world at app startup; safe to run any time.
 */
export function recoverWorldFolder(worldDir: string): void {
  if (!worldDir) return
  const root = dirname(worldDir)
  if (!existsSync(root)) return
  let tmp: string | null = null
  let old: string | null = null
  try {
    for (const name of readdirSync(root)) {
      if (/^\.sc-sync-tmp-/.test(name)) tmp = join(root, name)
      else if (/^\.sc-sync-old-/.test(name)) old = join(root, name)
    }
  } catch {
    return
  }
  if (!tmp && !old) return
  const worldOk = existsSync(join(worldDir, 'level.dat'))
  if (!worldOk) {
    if (old && existsSync(old)) {
      // Crash between renaming the original aside and moving the new copy in:
      // restore the original.
      try {
        if (existsSync(worldDir)) rmSync(worldDir, { recursive: true, force: true })
        renameSync(old, worldDir)
        if (tmp) rmSync(tmp, { recursive: true, force: true })
        return
      } catch {
        return
      }
    }
    if (tmp && existsSync(tmp) && existsSync(join(tmp, 'level.dat'))) {
      // Legacy crash (older app version deleted the folder before renaming):
      // the finished copy is in tmp — finish the swap.
      try {
        if (existsSync(worldDir)) rmSync(worldDir, { recursive: true, force: true })
        renameSync(tmp, worldDir)
        return
      } catch {
        return
      }
    }
  }
  // World is fine — the leftovers are garbage from a completed sync-back.
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    if (old) rmSync(old, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

export function instanceSlug(worldPath: string): string {
  const base = basename(worldPath) || 'world'
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'world'
  const hash = createHash('md5').update(worldPath.toLowerCase()).digest('hex').slice(0, 8)
  return `${slug}-${hash}`
}

export function slugify(value: string, fallback = 'server'): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || fallback
}
