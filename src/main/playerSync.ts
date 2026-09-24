import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * Per-world player migration bookkeeping.
 *
 * Singleplayer keeps the local player inside level.dat (Data.Player); a
 * dedicated server keeps players in playerdata/<uuid>.dat — and the UUID an
 * offline-mode server assigns (derived from the player name) frequently does
 * NOT match the UUID embedded in a singleplayer world. To carry player
 * position/inventory across host <-> sync-back anyway, we record at host time
 * which playerdata files we seeded (with content hashes), so sync-back can
 * tell exactly which file the server rewrote during play and migrate that one.
 */
export interface PlayerRecord {
  /** Singleplayer player UUID from level.dat Data.Player, if any. */
  spUuid: string | null
  /** UUID whose playerdata the player actually played under last session. */
  playedUuid: string | null
  /** sha1 of every playerdata file right after seeding on host. */
  hashes: Record<string, string>
  /** Wall-clock ms when the last host finished preparing (post-seed copy done). */
  hostCompletedAt?: number
  /** True once the instance progress has been synced back after the last host. */
  syncedBack?: boolean
}

/** All records, keyed by lowercase world path. */
type PlayerRecords = Record<string, PlayerRecord>

let recordsPath: string | null = null
let records: PlayerRecords | null = null

/** Must be called once with the userData dir (electron-free for tests). */
export function initPlayerSync(userDataDir: string): void {
  recordsPath = join(userDataDir, 'player-sync.json')
  if (existsSync(recordsPath)) {
    try {
      records = JSON.parse(readFileSync(recordsPath, 'utf8')) as PlayerRecords
    } catch {
      records = {}
    }
  } else {
    records = {}
  }
}

/** Test seam: use an explicit file instead of initPlayerSync. */
export function setPlayerRecordsPath(path: string): void {
  recordsPath = path
  records = null
}

function flush(): void {
  if (recordsPath && records) writeFileSync(recordsPath, JSON.stringify(records, null, 2), 'utf8')
}

export function getPlayerRecord(worldPath: string): PlayerRecord {
  return (
    records?.[worldPath.toLowerCase()] ?? { spUuid: null, playedUuid: null, hashes: {} }
  )
}

export function updatePlayerRecord(worldPath: string, patch: Partial<PlayerRecord>): PlayerRecord {
  if (!records) records = {}
  const key = worldPath.toLowerCase()
  records[key] = { ...getPlayerRecord(worldPath), ...patch }
  flush()
  return records[key]
}

/** sha1 of a file's current bytes ('' when missing). */
export function fileHash(path: string): string {
  try {
    return createHash('sha1').update(readFileSync(path)).digest('hex')
  } catch {
    return ''
  }
}

/** uuid (file name) of a playerdata file path. */
export function uuidOfPlayerDataFile(path: string): string {
  return basename(path).replace(/\.dat$/i, '')
}
