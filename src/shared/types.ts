export type ServerKind = 'vanilla' | 'fabric' | 'neoforge' | 'forge' | 'custom'

/** Auto-installed loader servers (installer downloaded and run by the app). */
export type LoaderKind = 'neoforge' | 'forge'

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

/** A world attached to a server profile. The folder itself is never moved or deleted. */
export interface WorldRef {
  path: string
  lastHostedAt?: string | null
}

/**
 * A complete server: source (vanilla/loader/custom), resources, port and the
 * worlds that belong to it. Multiple servers can run at the same time as long
 * as their ports (and folders) do not conflict.
 */
export interface ServerProfile {
  id: string
  name: string
  kind: ServerKind
  vanillaVersion: string | null
  fabricGame: string | null
  fabricLoader: string | null
  neoforgeVersion: string | null
  forgeVersion: string | null
  customServerDir: string | null
  /** Client pack folder (instance or mods folder) copied into the server on every host. */
  clientPackDir: string | null
  memoryGb: number
  port: number
  onlineMode: boolean
  worlds: WorldRef[]
  /**
   * Set on the profile migrated from the pre-multi-server config so its
   * instance folders keep the legacy flat layout (instances/<world-slug>).
   */
  legacyInstanceNaming?: boolean
}

/** Fields of a profile the user may edit through server:update. */
export type ServerProfilePatch = Partial<Omit<ServerProfile, 'id' | 'worlds' | 'legacyInstanceNaming'>>

export interface AppSettings {
  javaPath: string | null
  /** Default world location: where the world picker opens and new worlds are created. */
  mcSavesDir: string | null
  /** Remembered saves folders (launcher instances etc.) offered in the create-world dialog. */
  savesDirHistory: string[]
  eulaAccepted: boolean
  /** 'auto' exposes the LAN IPv4; 'custom' exposes a user-provided host (e.g. a Radmin VPN IP). */
  exposeMode: 'auto' | 'custom'
  customAddress: string | null
  /** Last app version this install ran; a different value on launch = just updated. */
  lastSeenVersion: string | null
  servers: ServerProfile[]
}

export interface WorldInfo {
  path: string
  levelName: string
  versionName: string
  dataVersion: number | null
  seed: string | null
  gameType: number
  difficulty: number
  hardcore: boolean
  cheats: boolean
  dayTime: string | null
  folderSizeBytes: number
  playerCount: number
  /** True for a just-created world folder with no level.dat yet — the server generates it on first host. */
  isNewWorld?: boolean
  /** True when the folder exists but has no level.dat (and is not a fresh app-created world). */
  missingLevelDat?: boolean
}

export interface LevelEdits {
  levelName?: string
  gameType?: number
  difficulty?: number
  hardcore?: boolean
  cheats?: boolean
}

export interface JavaCandidate {
  path: string
  version: string | null
  source: string
}

export interface NetInfo {
  /** Best-guess LAN IPv4 (first non-internal interface). */
  lanIp: string | null
  /** Every non-internal IPv4 address found on this machine (Ethernet, Wi-Fi, VPN adapters like Radmin). */
  addresses: string[]
}

export interface VanillaVersion {
  id: string
  type: string
  releaseTime: string
}

export interface FabricVersion {
  version: string
  stable: boolean
}

export interface LoaderBuild {
  /** Full loader version, e.g. '21.1.57', '26.3.0.16-beta', '1.20.1-47.2.0'. */
  version: string
  tag: 'recommended' | 'latest' | null
  prerelease: boolean
}

export interface LoaderVersionList {
  /** Builds grouped by Minecraft version, newest Minecraft version first. */
  groups: Array<{ mc: string; builds: LoaderBuild[] }>
}

export interface LoaderStatus {
  installed: boolean
  dir: string | null
}

export interface InstalledLoader {
  kind: LoaderKind
  version: string
  dir: string
}

export interface LogLine {
  stream: 'out' | 'err'
  text: string
  level: 'info' | 'warn' | 'error'
  ts: number
}

export interface JarProgress {
  label: string
  received: number
  total: number
  done: boolean
}

export interface WorldProgress {
  label: string
  files: number
  totalFiles: number
  bytes: number
  totalBytes: number
  done: boolean
}

export interface ServerStatusPayload {
  serverId: string
  state: ServerState
  worldPath: string | null
  /** Address other players use to join: <exposed host>:<port>. */
  address: string | null
  /** Local address: localhost:<port>. */
  localAddress: string | null
  recentLogs: LogLine[]
}

// ---- main -> renderer event payloads (server-scoped) ----

export interface ServerLogEvent {
  serverId: string
  line: LogLine
}

export interface ServerStateEvent {
  serverId: string
  state: ServerState
  worldPath: string | null
  address: string | null
  localAddress: string | null
}

export interface ScopedJarProgress {
  serverId: string
  progress: JarProgress
}

export interface ScopedWorldProgress {
  serverId: string
  progress: WorldProgress
}

export interface StartResult {
  ok: boolean
  error?: string
  needsEula?: boolean
  address?: string
}

export interface SaveLevelResult {
  info: WorldInfo
  backupPath: string | null
}

export interface SyncBackResult {
  info: WorldInfo
  /** True when a played playerdata file was carried back into level.dat. */
  migratedPlayer: boolean
}

export interface CustomInspectResult {
  ok: boolean
  entry: string | null
  error?: string
}

// ---- server files (mods / config / datapacks) ----

export type FilesSectionId = 'mods' | 'config' | 'datapacks'

export interface FileEntry {
  name: string
  isDir: boolean
  sizeBytes: number
  modifiedAt: number
}

export interface FilesSection {
  id: FilesSectionId
  label: string
  /** Folder being listed and mutated (client pack source, run folder, or the world's datapacks). */
  targetDir: string
  /** Set when the target is a fallback a future client pack would overwrite. */
  warning: string | null
  /** False when the folder has not been created yet (first add creates it). */
  exists: boolean
  entries: FileEntry[]
}

export interface FilesInfo {
  serverId: string
  /** World the datapacks section belongs to (null when the server has no worlds). */
  worldPath: string | null
  sections: FilesSection[]
}

// ---- backups ----

export type BackupKind = 'launch' | 'hourly'

export interface BackupInfo {
  /** '<kind>/<dir name>' — stable id for restore/delete. */
  id: string
  worldPath: string
  kind: BackupKind
  createdAt: number
  /** Host session the snapshot belongs to. */
  session: number
  /** True when the server crashed during this session. */
  crashed: boolean
  files: number
  sizeBytes: number
}

export interface RestoreResult {
  ok: boolean
  /** True when servers hosting this world must be stopped first. */
  needsStop?: boolean
  /** Names of the servers that were holding the world (for the prompt). */
  runningServers?: string[]
  error?: string
}

export interface ServerLogFile {
  serverId: string
  name: string
  path: string
  sizeBytes: number
  modifiedAt: number
}

export interface ServerLogContent {
  name: string
  /** True when only the tail was returned (large file). */
  truncated: boolean
  text: string
}

// ---- app version & auto-update ----

export interface AppInfo {
  version: string
  /** True in a packaged (installed) build; dev runs never check for updates. */
  packaged: boolean
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'prerelease-available'
  | 'none'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  /** Bytes per second. */
  speed: number
}

/** One snapshot of the updater state, pushed to the renderer on every change. */
export interface UpdateStateEvent {
  phase: UpdatePhase
  /** Version of the update that was found / downloaded. */
  version?: string
  progress?: UpdateProgress
  /** Error text for phase === 'error'. */
  message?: string
}

/** Result of the startup "was the app just updated?" check. */
export interface WhatsNewCheck {
  version: string
  /** True when this launch is the first one on a newly installed version. */
  updated: boolean
  /** GitHub release notes (markdown) for the version; null when unavailable. */
  notes: string | null
}

/** Compare dotted release strings like "1.20.1" vs "1.9". Returns negative if a < b. */
export function compareRelease(a: string, b: string): number | null {
  const pa = /^(\d+(?:\.\d+)*)/.exec(a.trim())
  const pb = /^(\d+(?:\.\d+)*)/.exec(b.trim())
  if (!pa || !pb) return null
  const xa = pa[1].split('.').map(Number)
  const xb = pb[1].split('.').map(Number)
  const n = Math.max(xa.length, xb.length)
  for (let i = 0; i < n; i++) {
    const d = (xa[i] ?? 0) - (xb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export const GAME_MODES = ['Survival', 'Creative', 'Adventure', 'Spectator']
export const DIFFICULTIES = ['Peaceful', 'Easy', 'Normal', 'Hard']

/** Minecraft version a profile's selected server source will run. */
export function profileMc(profile: ServerProfile): string | null {
  switch (profile.kind) {
    case 'vanilla':
      return profile.vanillaVersion
    case 'fabric':
      return profile.fabricGame
    case 'neoforge':
      return profile.neoforgeVersion ? neoforgeMc(profile.neoforgeVersion) : null
    case 'forge':
      return profile.forgeVersion ? forgeMc(profile.forgeVersion) : null
    default:
      return null
  }
}

/**
 * Map a NeoForge version to its Minecraft version. Two schemes exist:
 * pre-2025 '21.1.57' → '1.21.1' (with the 47.x special case for 1.20.1),
 * and the year-based scheme '26.3.0.16' → '26.3'.
 */
export function neoforgeMc(version: string): string | null {
  const m3 = /^(\d+)\.(\d+)\.(\d+)(?:-beta)?$/.exec(version)
  if (m3) {
    if (m3[1] === '47') return '1.20.1'
    return m3[2] === '0' ? `1.${m3[1]}` : `1.${m3[1]}.${m3[2]}`
  }
  const m4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:-beta)?$/.exec(version)
  if (m4) return `${m4[1]}.${m4[2]}`
  return null
}

/** Map a full Forge version '1.20.1-47.2.0' / '26.3-66.0.3' to its Minecraft version. */
export function forgeMc(version: string): string | null {
  const m = /^(\d+(?:\.\d+){0,2})-/.exec(version)
  return m ? m[1] : null
}

/** Major Java version required to run a Minecraft version's dedicated server. */
export function requiredJavaMajor(mc: string | null | undefined): number {
  if (!mc) return 0
  if ((compareRelease(mc, '26') ?? -1) >= 0) return 25
  if ((compareRelease(mc, '1.20.5') ?? -1) >= 0) return 21
  if ((compareRelease(mc, '1.17') ?? -1) >= 0) return 17
  return 8
}

/** Major version from a java -version string: '21.0.3' → 21, '1.8.0_501' → 8. */
export function javaMajorOf(version: string | null | undefined): number {
  if (!version) return -1
  const legacy = /^1\.(\d+)/.exec(version)
  if (legacy) return Number(legacy[1])
  const modern = /^(\d+)/.exec(version)
  return modern ? Number(modern[1]) : -1
}

/** Next free port for a new server profile (never collides with existing profiles). */
export function nextFreePort(servers: ServerProfile[], base = 25565): number {
  const used = new Set(servers.map((s) => s.port))
  let port = base
  while (used.has(port)) port++
  return port
}
