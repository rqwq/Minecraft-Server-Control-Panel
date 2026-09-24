import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { BackupInfo, BackupKind } from '../shared/types'
import { instanceSlug, walkTree } from './world'

/**
 * Per-world backups, two categories:
 *  - "launch": the world right before each server launch (anti-corruption
 *    anchor — restores the pre-session state), newest 2 kept.
 *  - "hourly": a hot snapshot every hour while the server runs (after a
 *    save-all flush), newest 3 kept.
 *
 * Storage uses hardlink dedup: every backup is a full standalone folder, but
 * files that are byte-identical (same size + mtime) to the previous snapshot
 * are shared as NTFS hardlinks. Snapshot folders are write-once and restores
 * always make real copies, so in-place edits can never leak between backups
 * and the live world.
 */

const LAUNCH_KEEP = 2
const HOURLY_KEEP = 3
const META_NAME = 'backup.json'

interface SnapshotMeta {
  kind: BackupKind
  worldPath: string
  createdAt: number
  /** Host session these snapshots belong to (for crash marking). */
  session: number
  crashed: boolean
  files: number
  sizeBytes: number
}

let backupsRoot = ''

export function initBackups(userDataDir: string): void {
  backupsRoot = join(userDataDir, 'backups')
  mkdirSync(backupsRoot, { recursive: true })
}

export function backupsDirFor(worldPath: string): string {
  return join(backupsRoot, instanceSlug(worldPath))
}

function metaPath(snapshotDir: string): string {
  return join(snapshotDir, META_NAME)
}

function readMeta(snapshotDir: string): SnapshotMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(snapshotDir), 'utf8')) as SnapshotMeta
  } catch {
    return null
  }
}

function writeMeta(snapshotDir: string, meta: SnapshotMeta): void {
  writeFileSync(metaPath(snapshotDir), JSON.stringify(meta, null, 2), 'utf8')
}

function toInfo(id: string, meta: SnapshotMeta): BackupInfo {
  return {
    id,
    worldPath: meta.worldPath,
    kind: meta.kind,
    createdAt: meta.createdAt,
    session: meta.session,
    crashed: meta.crashed,
    files: meta.files,
    sizeBytes: meta.sizeBytes
  }
}

function snapshotDirs(worldPath: string, kind: BackupKind): Array<{ id: string; dir: string; meta: SnapshotMeta }> {
  const kindDir = join(backupsDirFor(worldPath), kind)
  if (!existsSync(kindDir)) return []
  const out: Array<{ id: string; dir: string; meta: SnapshotMeta }> = []
  for (const name of readdirSync(kindDir)) {
    const dir = join(kindDir, name)
    const meta = readMeta(dir)
    if (meta) out.push({ id: `${kind}/${name}`, dir, meta })
  }
  out.sort((a, b) => b.meta.createdAt - a.meta.createdAt)
  return out
}

/** Newest snapshot of the world (either kind) — the dedup source. */
function latestSnapshotDir(worldPath: string): string | null {
  const all = [...snapshotDirs(worldPath, 'launch'), ...snapshotDirs(worldPath, 'hourly')]
  all.sort((a, b) => b.meta.createdAt - a.meta.createdAt)
  return all[0]?.dir ?? null
}

/**
 * Copy sourceDir into destDir; files unchanged since `linkFrom` (same size +
 * mtime) are shared as hardlinks instead of copied. Copied files keep the
 * source mtime so the next snapshot can dedup against this one.
 */
function snapshotTree(sourceDir: string, destDir: string, linkFrom: string | null): { files: number; sizeBytes: number } {
  let files = 0
  let sizeBytes = 0
  for (const entry of walkTree(sourceDir, destDir)) {
    if (entry.isDir) {
      mkdirSync(entry.dest, { recursive: true })
      continue
    }
    mkdirSync(dirname(entry.dest), { recursive: true })
    let linked = false
    if (linkFrom) {
      const prev = join(linkFrom, entry.dest.slice(destDir.length + 1))
      try {
        const srcStat = statSync(entry.src)
        const prevStat = existsSync(prev) ? statSync(prev) : null
        // 2ms tolerance: utimesSync preserves mtimes only to whole
        // milliseconds, while NTFS keeps sub-millisecond precision.
        if (
          prevStat &&
          prevStat.isFile() &&
          prevStat.size === srcStat.size &&
          Math.abs(prevStat.mtimeMs - srcStat.mtimeMs) < 2
        ) {
          linkSync(prev, entry.dest)
          linked = true
        }
      } catch {
        /* fall back to a real copy */
      }
    }
    if (!linked) {
      try {
        copyFileSync(entry.src, entry.dest)
        // Preserve the source mtime so future snapshots can dedup against us.
        const st = statSync(entry.src)
        utimesSync(entry.dest, st.atime, st.mtime)
      } catch {
        continue // file vanished mid-walk (live world) — skip it
      }
    }
    files++
    try {
      sizeBytes += statSync(entry.dest).size
    } catch {
      /* ignore */
    }
  }
  return { files, sizeBytes }
}

function pruneSnapshots(worldPath: string, kind: BackupKind): void {
  const keep = kind === 'launch' ? LAUNCH_KEEP : HOURLY_KEEP
  const all = snapshotDirs(worldPath, kind)
  for (let i = keep; i < all.length; i++) {
    rmSync(all[i].dir, { recursive: true, force: true })
  }
}

/**
 * Take a snapshot of `sourceDir` for the given world. Returns null when the
 * source does not exist. Prunes the category afterwards.
 */
export function createSnapshot(
  sourceDir: string,
  worldPath: string,
  kind: BackupKind,
  session: number
): BackupInfo | null {
  if (!existsSync(sourceDir)) return null
  const createdAt = Date.now()
  const dir = join(backupsDirFor(worldPath), kind, `${kind}-${createdAt}`)
  mkdirSync(dir, { recursive: true })
  const { files, sizeBytes } = snapshotTree(sourceDir, dir, latestSnapshotDir(worldPath))
  const meta: SnapshotMeta = { kind, worldPath, createdAt, session, crashed: false, files, sizeBytes }
  writeMeta(dir, meta)
  pruneSnapshots(worldPath, kind)
  return toInfo(`${kind}/${kind}-${createdAt}`, meta)
}

export function listBackups(): BackupInfo[] {
  if (!backupsRoot || !existsSync(backupsRoot)) return []
  const out: BackupInfo[] = []
  for (const slug of readdirSync(backupsRoot)) {
    const worldDir = join(backupsRoot, slug)
    for (const kind of ['launch', 'hourly'] as BackupKind[]) {
      for (const snap of snapshotDirsByPath(join(worldDir, kind), kind)) out.push(snap)
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

function snapshotDirsByPath(kindDir: string, kind: BackupKind): BackupInfo[] {
  if (!existsSync(kindDir)) return []
  const out: BackupInfo[] = []
  for (const name of readdirSync(kindDir)) {
    const meta = readMeta(join(kindDir, name))
    if (meta) out.push(toInfo(`${kind}/${name}`, meta))
  }
  return out
}

/** Absolute path of a snapshot, validated against traversal. */
export function snapshotPath(worldPath: string, backupId: string): string | null {
  const [kind, ...rest] = backupId.split('/')
  if ((kind !== 'launch' && kind !== 'hourly') || rest.length !== 1) return null
  const dir = join(backupsDirFor(worldPath), kind, rest[0])
  if (!existsSync(metaPath(dir))) return null
  return dir
}

export function deleteBackup(worldPath: string, backupId: string): void {
  const dir = snapshotPath(worldPath, backupId)
  if (dir) rmSync(dir, { recursive: true, force: true })
}

/** Mark every snapshot of a host session as coming from a crashed server. */
export function markSessionCrashed(worldPath: string, session: number): void {
  for (const kind of ['launch', 'hourly'] as BackupKind[]) {
    for (const snap of snapshotDirs(worldPath, kind)) {
      if (snap.meta.session === session && !snap.meta.crashed) {
        snap.meta.crashed = true
        writeMeta(snap.dir, snap.meta)
      }
    }
  }
}
