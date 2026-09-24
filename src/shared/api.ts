import type {
  AppInfo,
  AppSettings,
  BackupInfo,
  CustomInspectResult,
  FabricVersion,
  FilesInfo,
  FilesSectionId,
  InstalledLoader,
  JavaCandidate,
  JarProgress,
  LevelEdits,
  LoaderKind,
  LoaderStatus,
  LoaderVersionList,
  LogLine,
  NetInfo,
  RestoreResult,
  SaveLevelResult,
  ScopedJarProgress,
  ScopedWorldProgress,
  ServerLogFile,
  ServerLogEvent,
  ServerLogContent,
  ServerProfile,
  ServerProfilePatch,
  ServerStateEvent,
  ServerStatusPayload,
  StartResult,
  SyncBackResult,
  UpdateStateEvent,
  VanillaVersion,
  WhatsNewCheck,
  WorldInfo
} from './types'

export type { ServerLogEvent, ServerStateEvent } from './types'

/**
 * Minimal shape of a dropped/picked DOM File. The renderer passes real File
 * objects; the preload forwards them to Electron's webUtils.getPathForFile.
 * (The full DOM File type is deliberately not used — the node-side tsconfig
 * that also compiles this file has no DOM lib.)
 */
export interface FileLike {
  readonly name: string
}

export interface RendererApi {
  // dialogs & global
  selectWorld(): Promise<string | null>
  pickFolder(): Promise<string | null>
  pickJava(): Promise<string | null>
  detectJava(): Promise<JavaCandidate[]>
  netInfo(): Promise<NetInfo>
  getConfig(): Promise<AppSettings>
  setConfig(patch: Partial<AppSettings>): Promise<AppSettings>
  acceptEula(): Promise<boolean>
  appInfo(): Promise<AppInfo>
  /** Opens the GitHub repository page in the default browser. */
  openRepo(): Promise<boolean>
  /** Copies the Discord username (.extremism) to the clipboard. */
  copyDiscord(): Promise<boolean>
  /**
   * Opens an external https://github.com/ link in the default browser.
   * Resolves false (without opening) for any other URL.
   */
  openUrl(url: string): Promise<boolean>

  // what's new (release notes)
  /** Startup check: was the app updated since the previous launch? */
  whatsNewCheck(): Promise<WhatsNewCheck>
  /** Release notes (markdown) of an arbitrary version; null when unavailable. */
  releaseNotes(version: string): Promise<string | null>

  // auto-update (packaged builds only; dev runs stay idle)
  /** Triggers a check for a new release. Results arrive via onUpdateState. */
  checkUpdate(): Promise<void>
  /** Starts downloading the found update. Progress arrives via onUpdateState. */
  downloadUpdate(): Promise<void>
  /** Quits the app and runs the installer. Refuses while servers are running. */
  installUpdate(): Promise<void>

  // worlds
  worldInfo(path: string): Promise<WorldInfo>
  saveLevel(path: string, edits: LevelEdits): Promise<SaveLevelResult>
  syncBack(serverId: string, path: string): Promise<SyncBackResult>

  // servers (profiles)
  listServers(): Promise<ServerProfile[]>
  createServer(name: string): Promise<ServerProfile>
  updateServer(id: string, patch: ServerProfilePatch): Promise<ServerProfile>
  deleteServer(id: string): Promise<ServerProfile[]>
  addWorld(serverId: string, path: string | null): Promise<ServerProfile>
  createWorld(serverId: string, name: string, seed: string | null, savesDir: string | null): Promise<ServerProfile>
  removeWorld(serverId: string, path: string): Promise<ServerProfile>

  // per-server lifecycle
  startServer(serverId: string, worldPath: string): Promise<StartResult>
  stopServer(serverId: string): Promise<boolean>
  sendCommand(serverId: string, command: string): Promise<boolean>
  serverStatus(serverId: string): Promise<ServerStatusPayload>
  statusAll(): Promise<ServerStatusPayload[]>

  // versions & downloads
  vanillaVersions(): Promise<{ latest: string; versions: VanillaVersion[] }>
  fabricVersions(): Promise<{ game: FabricVersion[]; loader: FabricVersion[] }>
  loaderVersions(kind: LoaderKind): Promise<LoaderVersionList>
  loaderStatus(kind: LoaderKind, version: string): Promise<LoaderStatus>
  listInstalledLoaders(): Promise<InstalledLoader[]>
  removeLoader(kind: LoaderKind, version: string): Promise<boolean>
  ensureLoader(kind: LoaderKind, version: string, serverId?: string): Promise<string>
  ensureJar(kind: 'vanilla' | 'fabric', a: string, b?: string, serverId?: string): Promise<string>
  customInspect(dir: string): Promise<CustomInspectResult>

  // backups
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(worldPath: string, backupId: string, stopServers: boolean): Promise<RestoreResult>
  deleteBackup(worldPath: string, backupId: string): Promise<boolean>

  // server log files (logs/, crash-reports/)
  serverLogFiles(serverId: string): Promise<ServerLogFile[]>
  readServerLog(serverId: string, name: string): Promise<ServerLogContent>
  openLogsFolder(serverId: string): Promise<boolean>

  // server files (mods / config / datapacks)
  listFiles(serverId: string, worldPath: string | null): Promise<FilesInfo>
  /** Copies files/folders into a section; returns the names that were added. */
  addFiles(serverId: string, section: FilesSectionId, worldPath: string | null, sourcePaths: string[]): Promise<string[]>
  deleteFile(serverId: string, section: FilesSectionId, worldPath: string | null, name: string): Promise<boolean>
  /** Opens the section folder, or reveals one entry in it (name = null opens the folder). */
  revealFile(serverId: string, section: FilesSectionId, worldPath: string | null, name: string | null): Promise<boolean>
  /** Absolute path of a dropped/picked DOM file (Electron webUtils bridge). */
  getPathForFile(file: FileLike): string

  // events
  onServerLog(callback: (event: ServerLogEvent) => void): () => void
  onServerState(callback: (event: ServerStateEvent) => void): () => void
  onJarProgress(callback: (progress: ScopedJarProgress) => void): () => void
  onWorldProgress(callback: (progress: ScopedWorldProgress) => void): () => void
  onUpdateState(callback: (state: UpdateStateEvent) => void): () => void
}

export type { LogLine, JarProgress }
