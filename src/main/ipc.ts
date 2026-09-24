import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AppInfo,
  AppSettings,
  BackupInfo,
  CustomInspectResult,
  FabricVersion,
  FilesInfo,
  FilesSectionId,
  InstalledLoader,
  JarProgress,
  LevelEdits,
  LoaderKind,
  LoaderStatus,
  LoaderVersionList,
  LogLine,
  NetInfo,
  RestoreResult,
  SaveLevelResult,
  ServerLogFile,
  ServerLogContent,
  ServerLogEvent,
  ServerProfile,
  ServerProfilePatch,
  ServerStateEvent,
  ServerStatusPayload,
  StartResult,
  SyncBackResult,
  VanillaVersion,
  WhatsNewCheck,
  WorldInfo,
  WorldProgress
} from '../shared/types'
import { nextFreePort } from '../shared/types'
import {
  createNewWorld,
  copyTree,
  dirModifiedSince,
  hashPlayerData,
  isNewWorldDir,
  isValidWorld,
  readWorldInfo,
  recoverWorldFolder,
  saveLevelEdits,
  swapIntoSaves,
  syncBackWorld
} from './world'
import { createSnapshot, deleteBackup, initBackups, listBackups, markSessionCrashed, snapshotPath } from './backups'
import { detectJava } from './java'
import { ensureFabricJar, ensureVanillaJar, initJarService, listFabricVersions, listVanillaVersions } from './jar'
import {
  detectCustomEntry,
  ensureLoaderServer,
  initLoaderService,
  listInstalledLoaders,
  listLoaderVersions,
  loaderStatus,
  managedServerDir,
  removeLoaderServer
} from './loader'
import { serverRegistry, type ServerEmitter } from './serverProcess'
import { instanceWorldDirFor, prepareServer, serverCwdFor } from './instance'
import { addFiles, deleteFile, filesInfoFor, revealEntry } from './files'
import { netInfo } from './net'
import { getPlayerRecord, initPlayerSync, updatePlayerRecord } from './playerSync'
import { getStore, makeProfile } from './store'
import { checkWhatsNew, notesForVersion } from './whatsnew'
import { checkForUpdate, downloadUpdate, installUpdate, DISCORD_USERNAME, REPO_URL, initUpdater } from './updater'

/** Add a saves folder to the remembered history (most recent first, capped). */
function rememberSavesDir(dir: string, setAsDefault = false): void {
  const store = getStore()
  const settings = store.get()
  const history = [dir, ...settings.savesDirHistory.filter((d) => d.toLowerCase() !== dir.toLowerCase())].slice(0, 8)
  store.patch(setAsDefault ? { savesDirHistory: history, mcSavesDir: dir } : { savesDirHistory: history })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const store = getStore()
  initJarService(app.getPath('userData'))
  initLoaderService(app.getPath('userData'))
  initPlayerSync(app.getPath('userData'))
  initBackups(app.getPath('userData'))

  /** Live host sessions: <serverId, world + session id + hourly timer>. */
  const activeSessions = new Map<string, { worldPath: string; session: number; hourlyTimer: NodeJS.Timeout | null }>()

  // Repair any saves folder left mid-swap by a crash during sync-back.
  for (const profile of store.listServers()) {
    for (const world of profile.worlds) recoverWorldFolder(world.path)
  }

  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const serverEmitter: ServerEmitter = {
    log: (serverId, line) => send('server:log', { serverId, line } satisfies ServerLogEvent),
    state: (serverId, state, worldPath, address, localAddress) =>
      send('server:state', { serverId, state, worldPath, address, localAddress } satisfies ServerStateEvent)
  }

  /** Log a line into a server's console (also visible in the log ring buffer on reload). */
  const serverLog = (serverId: string, text: string, level: LogLine['level'] = 'info'): void =>
    send('server:log', { serverId, line: { stream: 'out', text, level, ts: Date.now() } } satisfies ServerLogEvent)

  /**
   * Copy the played instance world back into the saves folder automatically —
   * progress would otherwise live only in the instance copy. Guarded: skipped
   * when the saves folder changed since the host (played in singleplayer
   * meanwhile), so it never overwrites newer singleplayer progress.
   */
  const tryAutoSyncBack = (serverId: string, worldPath: string): boolean => {
    try {
      const profile = store.getServer(serverId)
      if (!profile) return false
      const sourceDir = instanceWorldDirFor(profile, worldPath)
      if (!existsSync(join(sourceDir, 'level.dat'))) return false
      const record = getPlayerRecord(worldPath)
      const since = record.hostCompletedAt ?? 0
      if (since > 0 && dirModifiedSince(worldPath, since)) {
        serverLog(
          serverId,
          'The saves folder changed while the server ran (played in singleplayer?) — automatic sync-back skipped. Use Sync back manually if the server copy is the one you want.',
          'warn'
        )
        return false
      }
      const { migratedUuid } = syncBackWorld(sourceDir, worldPath, record)
      if (migratedUuid) updatePlayerRecord(worldPath, { playedUuid: migratedUuid })
      updatePlayerRecord(worldPath, { syncedBack: true })
      serverLog(serverId, 'Server stopped — progress synced back into your saves folder automatically.')
      return true
    } catch (err) {
      serverLog(
        serverId,
        `Automatic sync-back failed: ${err instanceof Error ? err.message : String(err)} — use Sync back manually.`,
        'error'
      )
      return false
    }
  }

  /**
   * Hot snapshot of the live instance world: flush the server's save buffers
   * (save-all flush), give it a moment, then copy. Unchanged files are
   * hardlink-deduped against the previous snapshot, so an idle world costs
   * almost nothing.
   */
  const hotSnapshot = (serverId: string, worldPath: string, session: number): void => {
    const manager = serverRegistry.get(serverId)
    if (!manager?.busy) return
    const source = manager.instanceWorldDir
    if (!source || !existsSync(source)) return
    serverLog(serverId, 'Saving world for the hourly backup…')
    manager.send('save-all flush')
    setTimeout(() => {
      try {
        const info = createSnapshot(source, worldPath, 'hourly', session)
        if (info) serverLog(serverId, `Hourly backup saved (${info.files} files, deduplicated on disk).`)
      } catch (err) {
        serverLog(serverId, `Hourly backup failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    }, 5000)
  }

  const pickDirectory = async (title: string, defaultPath?: string): Promise<string | null> => {
    const win = getWindow()
    const options = {
      title,
      defaultPath,
      properties: ['openDirectory', 'dontAddToRecent'] as Array<'openDirectory' | 'dontAddToRecent'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  const defaultSavesDir = (): string => join(app.getPath('appData'), '.minecraft', 'saves')

  const savesDirForPicker = (): string | undefined => {
    const settings = store.get()
    if (settings.mcSavesDir && existsSync(settings.mcSavesDir)) return settings.mcSavesDir
    const fallback = defaultSavesDir()
    return existsSync(fallback) ? fallback : undefined
  }

  // ---- dialogs & global config -------------------------------------------

  ipcMain.handle('dialog:selectWorld', (): Promise<string | null> =>
    pickDirectory('Select a Minecraft world folder', savesDirForPicker())
  )

  ipcMain.handle('dialog:pickFolder', (): Promise<string | null> =>
    pickDirectory('Select the server folder')
  )

  ipcMain.handle('java:pick', async (): Promise<string | null> => {
    const win = getWindow()
    const options = {
      title: 'Select javaw.exe',
      filters: [{ name: 'Java executable', extensions: ['exe'] }],
      properties: ['openFile', 'dontAddToRecent'] as Array<'openFile' | 'dontAddToRecent'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('java:detect', () => detectJava(store.get().javaPath))

  ipcMain.handle('net:info', (): NetInfo => netInfo())

  ipcMain.handle('config:get', (): AppSettings => store.get())

  ipcMain.handle('config:set', (_event, patch: Partial<AppSettings>): AppSettings => {
    // The server list is owned by the server:* endpoints; a config patch never
    // touches it.
    const { servers, ...rest } = patch
    void servers
    return store.patch(rest)
  })

  ipcMain.handle('eula:accept', () => {
    store.patch({ eulaAccepted: true })
    return true
  })

  // ---- app version, contacts & auto-update -------------------------------

  ipcMain.handle('app:info', (): AppInfo => ({ version: app.getVersion(), packaged: app.isPackaged }))

  ipcMain.handle('util:openRepo', () => shell.openExternal(REPO_URL))

  ipcMain.handle('util:copyDiscord', () => {
    clipboard.writeText(DISCORD_USERNAME)
    return true
  })

  // Links inside release notes are opened only when they point at github.com
  // — release notes are third-party-editable text, never a launcher for
  // arbitrary URLs.
  ipcMain.handle('util:openUrl', (_event, url: string): boolean => {
    if (typeof url !== 'string' || !url.startsWith('https://github.com/')) return false
    void shell.openExternal(url)
    return true
  })

  ipcMain.handle('update:check', () => checkForUpdate())

  ipcMain.handle('update:download', () => downloadUpdate())

  ipcMain.handle('update:install', () => installUpdate())

  // ---- what's new ------------------------------------------------------------

  ipcMain.handle('whatsnew:check', (): Promise<WhatsNewCheck> => checkWhatsNew())

  ipcMain.handle('whatsnew:notes', (_event, version: string): Promise<string | null> => notesForVersion(version))

  // ---- worlds -------------------------------------------------------------

  ipcMain.handle('world:info', (_event, path: string): WorldInfo => readWorldInfo(path))

  ipcMain.handle('world:saveLevel', (_event, path: string, edits: LevelEdits): SaveLevelResult => {
    if (serverRegistry.busy().some((m) => m.worldPath === path)) {
      throw new Error('Stop the server before editing this world')
    }
    const { backupPath } = saveLevelEdits(path, edits)
    return { info: readWorldInfo(path), backupPath }
  })

  // ---- servers (profiles) --------------------------------------------------

  ipcMain.handle('servers:list', (): ServerProfile[] => store.listServers())

  ipcMain.handle('server:create', (_event, name: string): ServerProfile => {
    const servers = store.listServers()
    const profile = makeProfile(String(name ?? ''), nextFreePort(servers), [])
    store.patch({ servers: [...servers, profile] })
    return profile
  })

  ipcMain.handle('server:update', (_event, id: string, patch: ServerProfilePatch): ServerProfile => {
    const current = store.getServer(id)
    if (!current) throw new Error('Server not found')
    const manager = serverRegistry.get(id)
    const running = manager?.busy ?? false
    if (running && (patch.kind !== undefined || patch.port !== undefined)) {
      throw new Error('Stop the server before changing its source or port')
    }
    if (patch.port !== undefined && patch.port !== current.port) {
      const clash = store.listServers().find((s) => s.id !== id && s.port === patch.port)
      if (clash) throw new Error(`Port ${patch.port} is already used by "${clash.name}"`)
    }
    const next = store.updateServer(id, (profile) => ({ ...profile, ...patch }))
    if (!next) throw new Error('Server not found')
    return next
  })

  ipcMain.handle('server:delete', (_event, id: string): ServerProfile[] => {
    const manager = serverRegistry.get(id)
    if (manager?.busy) throw new Error('Stop the server before deleting it')
    const servers = store.listServers().filter((s) => s.id !== id)
    return store.patch({ servers }).servers
  })

  ipcMain.handle('server:addWorld', (_event, id: string, path: string | null): ServerProfile => {
    const profile = store.getServer(id)
    if (!profile) throw new Error('Server not found')
    const worldPath = path ?? ''
    if (!isValidWorld(worldPath) && !isNewWorldDir(worldPath)) {
      throw new Error('Not a valid world folder (level.dat missing)')
    }
    if (profile.worlds.some((w) => w.path === worldPath)) return profile
    const next = store.updateServer(id, (p) => ({
      ...p,
      worlds: [...p.worlds, { path: worldPath, lastHostedAt: null }]
    }))
    if (!next) throw new Error('Server not found')
    recoverWorldFolder(worldPath)
    // Cache the saves folder this world came from for the create-world dialog.
    rememberSavesDir(dirname(worldPath))
    return next
  })

  ipcMain.handle(
    'server:createWorld',
    (_event, id: string, name: string, seed: string | null, savesDir: string | null): ServerProfile => {
      const settings = store.get()
      const targetDir = savesDir ?? settings.mcSavesDir ?? defaultSavesDir()
      const path = createNewWorld(targetDir, String(name ?? ''), seed)
      rememberSavesDir(targetDir)
      const next = store.updateServer(id, (p) => ({
        ...p,
        worlds: [...p.worlds, { path, lastHostedAt: null }]
      }))
      if (!next) throw new Error('Server not found')
      return next
    }
  )

  ipcMain.handle('server:removeWorld', (_event, id: string, path: string): ServerProfile => {
    const manager = serverRegistry.get(id)
    if (manager?.busy && manager.worldPath === path) {
      throw new Error('Stop the server before removing the hosted world')
    }
    const next = store.updateServer(id, (p) => ({
      ...p,
      worlds: p.worlds.filter((w) => w.path !== path)
    }))
    if (!next) throw new Error('Server not found')
    return next
  })

  ipcMain.handle('world:syncBack', (_event, id: string, path: string): SyncBackResult => {
    const profile = store.getServer(id)
    if (!profile) throw new Error('Server not found')
    const manager = serverRegistry.get(id)
    if (manager?.busy) throw new Error('Stop the server before syncing back')
    const sourceDir = instanceWorldDirFor(profile, path)
    if (!existsSync(sourceDir)) {
      throw new Error('No instance world copy found — host this world at least once first')
    }
    recoverWorldFolder(path)
    const { migratedUuid } = syncBackWorld(sourceDir, path, getPlayerRecord(path))
    if (migratedUuid) updatePlayerRecord(path, { playedUuid: migratedUuid })
    updatePlayerRecord(path, { syncedBack: true })
    return { info: readWorldInfo(path), migratedPlayer: migratedUuid !== null }
  })

  // ---- jars & loaders (shared caches; progress is scoped to a server) -----

  const loaderInstallLog = (serverId: string) => (line: string): void => {
    send('server:log', {
      serverId,
      line: { stream: 'out', text: `[loader] ${line}`, level: 'info', ts: Date.now() } as LogLine
    } satisfies ServerLogEvent)
  }

  const resolveJavaPath = (): string => {
    const settings = store.get()
    if (settings.javaPath && existsSync(settings.javaPath)) return settings.javaPath
    const best = detectJava(null)[0]
    if (!best) throw new Error('No Java runtime found — pick one in Settings')
    store.patch({ javaPath: best.path })
    return best.path
  }

  ipcMain.handle('jar:vanillaVersions', (): Promise<{ latest: string; versions: VanillaVersion[] }> =>
    listVanillaVersions()
  )

  ipcMain.handle('jar:fabricVersions', (): Promise<{ game: FabricVersion[]; loader: FabricVersion[] }> =>
    listFabricVersions()
  )

  ipcMain.handle(
    'jar:ensure',
    (_event, kind: 'vanilla' | 'fabric', a: string, b?: string, serverId?: string): Promise<string> => {
      const scope = serverId ?? ''
      const onProgress = (p: JarProgress): void => send('jar:progress', { serverId: scope, progress: p })
      if (kind === 'vanilla') return ensureVanillaJar(a, onProgress)
      if (!b) throw new Error('Missing loader version for Fabric')
      return ensureFabricJar(a, b, onProgress)
    }
  )

  ipcMain.handle('loader:versions', (_event, kind: LoaderKind): Promise<LoaderVersionList> =>
    listLoaderVersions(kind)
  )

  ipcMain.handle('loader:status', (_event, kind: LoaderKind, version: string): LoaderStatus =>
    loaderStatus(kind, version)
  )

  ipcMain.handle('loader:list', (): InstalledLoader[] => listInstalledLoaders())

  ipcMain.handle('loader:remove', (_event, kind: LoaderKind, version: string): boolean => {
    const dir = managedServerDir(kind, version)
    const clash = serverRegistry.busy().find((m) => (m.cwd ?? '').toLowerCase().startsWith(dir.toLowerCase()))
    if (clash) throw new Error('Stop the servers using this installation before removing it')
    removeLoaderServer(kind, version)
    return true
  })

  ipcMain.handle(
    'loader:ensure',
    (_event, kind: LoaderKind, version: string, serverId?: string): Promise<string> =>
      ensureLoaderServer(
        kind,
        version,
        {
          jarProgress: (p: JarProgress) => send('jar:progress', { serverId: serverId ?? '', progress: p }),
          installLog: loaderInstallLog(serverId ?? '')
        },
        resolveJavaPath()
      )
  )

  ipcMain.handle('custom:inspect', (_event, dir: string): CustomInspectResult => {
    if (!dir || !existsSync(dir)) return { ok: false, entry: null, error: 'Folder does not exist' }
    const entry = detectCustomEntry(dir)
    return entry
      ? { ok: true, entry }
      : { ok: false, entry: null, error: 'No server jar or win_args.txt found in this folder' }
  })

  // ---- server lifecycle -----------------------------------------------------

  const statusOf = (id: string): ServerStatusPayload => {
    const manager = serverRegistry.get(id)
    if (!manager) {
      return { serverId: id, state: 'stopped', worldPath: null, address: null, localAddress: null, recentLogs: [] }
    }
    return {
      serverId: id,
      state: manager.state,
      worldPath: manager.worldPath,
      address: manager.address,
      localAddress: manager.localAddress,
      recentLogs: manager.recentLogs
    }
  }

  ipcMain.handle('servers:statusAll', (): ServerStatusPayload[] =>
    store.listServers().map((p) => statusOf(p.id))
  )

  ipcMain.handle('server:status', (_event, id: string): ServerStatusPayload => statusOf(id))

  ipcMain.handle('server:start', async (_event, id: string, worldPath: string): Promise<StartResult> => {
    const profile = store.getServer(id)
    if (!profile) return { ok: false, error: 'Server not found' }
    const manager = serverRegistry.ensure(id)
    if (manager.busy) return { ok: false, error: 'This server is already running — stop it first' }
    if (!isValidWorld(worldPath) && !isNewWorldDir(worldPath)) {
      return { ok: false, error: 'Not a valid world folder (level.dat missing)' }
    }
    const settings = store.get()
    if (!settings.eulaAccepted) {
      return { ok: false, needsEula: true, error: 'Minecraft EULA must be accepted first' }
    }
    if (serverRegistry.portInUse(profile.port, id)) {
      return { ok: false, error: `Port ${profile.port} is already used by another running server` }
    }
    if (profile.kind === 'custom' && profile.customServerDir) {
      const clash = serverRegistry
        .busy()
        .find((m) => m.cwd?.toLowerCase() === profile.customServerDir?.toLowerCase())
      if (clash) {
        return { ok: false, error: 'Another server is already running in this custom folder' }
      }
    }
    const session = Date.now()

    let javaPath = settings.javaPath
    if (!javaPath || !existsSync(javaPath)) {
      const best = detectJava(null)[0]
      if (!best) return { ok: false, error: 'No Java runtime found — pick one in Settings' }
      javaPath = best.path
      store.patch({ javaPath })
    }

    // If the previous session of this world was never synced back (app closed
    // after a crash, or sync-back skipped), preserve that progress before the
    // fresh copy overwrites the instance.
    const prevRecord = getPlayerRecord(worldPath)
    if (!prevRecord.syncedBack && (prevRecord.hostCompletedAt ?? 0) > 0) {
      const levelPath = join(instanceWorldDirFor(profile, worldPath), 'level.dat')
      let hasProgress = false
      try {
        hasProgress = existsSync(levelPath) && statSync(levelPath).mtimeMs > (prevRecord.hostCompletedAt ?? 0)
      } catch {
        hasProgress = false
      }
      if (hasProgress) {
        serverLog(id, 'Unsynced progress from the previous session found — syncing it back before hosting.')
        tryAutoSyncBack(id, worldPath)
      }
    }

    // Launch backup: the world exactly as it was before this session touches
    // it — the restore point if the session corrupts the world.
    const launchBackup = createSnapshot(worldPath, worldPath, 'launch', session)
    if (launchBackup) {
      serverLog(id, `Launch backup saved (${launchBackup.files} files) — restorable from the Backups window.`)
    }

    try {
      const prepared = await prepareServer(profile, worldPath, settings, javaPath, {
        worldProgress: (p: WorldProgress) => send('world:progress', { serverId: id, progress: p }),
        jarProgress: (p: JarProgress) => send('jar:progress', { serverId: id, progress: p }),
        installLog: loaderInstallLog(id)
      })
      serverRegistry.ensure(id).start(
        {
          serverId: id,
          javaPath,
          args: prepared.javaArgs,
          cwd: prepared.cwd,
          worldPath,
          instanceWorldDir: prepared.worldDir,
          address: prepared.address,
          localAddress: prepared.localAddress
        },
        serverEmitter
      )
      serverRegistry.ensure(id).onceStopped(() => {
        const entry = activeSessions.get(id)
        if (entry?.hourlyTimer) clearInterval(entry.hourlyTimer)
        activeSessions.delete(id)
        if (serverRegistry.get(id)?.state !== 'stopped') {
          // Crashed: no new snapshot (it may be corrupt); the session's
          // existing snapshots are kept and marked as crash-session points.
          markSessionCrashed(worldPath, session)
          serverLog(id, 'Server crashed — snapshots from this session are marked and kept for recovery.', 'warn')
          return
        }
        // Progress lives only in the instance copy until synced back — never
        // lose it when the server stops (this also runs during app close: the
        // quit flow waits for the stop to finish before the app exits).
        tryAutoSyncBack(id, worldPath)
      })
      // Hourly hot backups while the server runs (deduplicated, newest 3 kept).
      const hourlyTimer = setInterval(
        () => {
          if (serverRegistry.get(id)?.state === 'running') hotSnapshot(id, worldPath, session)
        },
        60 * 60 * 1000
      )
      activeSessions.set(id, { worldPath, session, hourlyTimer })
      store.updateServer(id, (p) => ({
        ...p,
        worlds: p.worlds.some((w) => w.path === worldPath)
          ? p.worlds.map((w) =>
              w.path === worldPath ? { ...w, lastHostedAt: new Date().toISOString() } : w
            )
          : [...p.worlds, { path: worldPath, lastHostedAt: new Date().toISOString() }]
      }))
      return { ok: true, address: prepared.address }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('server:stop', (_event, id: string): boolean => serverRegistry.get(id)?.requestStop() ?? false)

  ipcMain.handle('server:send', (_event, id: string, command: string): boolean =>
    serverRegistry.get(id)?.send(command) ?? false
  )

  // ---- backups -------------------------------------------------------------

  /** Servers currently running that have this world in their list. */
  const serversHosting = (worldPath: string): Array<{ id: string; name: string }> => {
    const out: Array<{ id: string; name: string }> = []
    for (const manager of serverRegistry.busy()) {
      const profile = store.getServer(manager.serverId)
      if (profile && profile.worlds.some((w) => w.path === worldPath)) out.push({ id: profile.id, name: profile.name })
    }
    return out
  }

  ipcMain.handle('backups:list', (): BackupInfo[] => listBackups())

  ipcMain.handle('backups:delete', (_event, worldPath: string, backupId: string): boolean => {
    if (!snapshotPath(worldPath, backupId)) throw new Error('Backup not found')
    deleteBackup(worldPath, backupId)
    return true
  })

  ipcMain.handle(
    'backups:restore',
    async (_event, worldPath: string, backupId: string, stopServers: boolean): Promise<RestoreResult> => {
      const snapshotDir = snapshotPath(worldPath, backupId)
      if (!snapshotDir) return { ok: false, error: 'Backup not found' }
      const holding = serversHosting(worldPath)
      if (holding.length > 0) {
        if (!stopServers) return { ok: false, needsStop: true, runningServers: holding.map((h) => h.name) }
        await new Promise<void>((resolve) => {
          serverRegistry.onceAllStopped(resolve)
          for (const h of holding) serverRegistry.get(h.id)?.requestStop()
        })
      }
      try {
        recoverWorldFolder(worldPath)
        // Real copy (never hardlinks): restored files must not share inodes
        // with the snapshot, or later in-place writes would mutate the backup.
        const tmp = join(dirname(worldPath), `.sc-restore-tmp-${Date.now()}`)
        copyTree(snapshotDir, tmp)
        swapIntoSaves(tmp, worldPath)
        // The restored backup IS the newest saves state — make sure the
        // pre-host recovery sync never resurrects the replaced instance.
        updatePlayerRecord(worldPath, { syncedBack: true })
        // Drop the stale instance copies of the old (possibly corrupted) session.
        for (const profile of store.listServers()) {
          if (!profile.worlds.some((w) => w.path === worldPath)) continue
          const dir = instanceWorldDirFor(profile, worldPath)
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ---- server log files (logs/, crash-reports/) ----------------------------

  /** The run directory whose logs/ and crash-reports/ belong to this server. */
  const logsCwdFor = (serverId: string): string | null => {
    const profile = store.getServer(serverId)
    if (!profile) return null
    const world = [...profile.worlds].sort((a, b) =>
      (b.lastHostedAt ?? '').localeCompare(a.lastHostedAt ?? '')
    )[0]
    return serverCwdFor(profile, world?.path ?? '') || null
  }

  ipcMain.handle('serverlogs:list', (_event, serverId: string): ServerLogFile[] => {
    const cwd = logsCwdFor(serverId)
    if (!cwd || !existsSync(cwd)) return []
    const out: ServerLogFile[] = []
    const add = (file: string, label: string): void => {
      try {
        const st = statSync(file)
        if (st.isFile()) {
          out.push({ serverId, name: label, path: file, sizeBytes: st.size, modifiedAt: st.mtimeMs })
        }
      } catch {
        /* unreadable — skip */
      }
    }
    const logsDir = join(cwd, 'logs')
    if (existsSync(logsDir)) {
      for (const name of readdirSync(logsDir).filter((f) => /\.(log|txt)$/i.test(f))) add(join(logsDir, name), name)
    }
    const crashDir = join(cwd, 'crash-reports')
    if (existsSync(crashDir)) {
      for (const name of readdirSync(crashDir).filter((f) => /\.txt$/i.test(f)).sort().reverse()) {
        add(join(crashDir, name), `crash-reports/${name}`)
      }
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 40)
  })

  /** Resolve a listed log label to a file path, rejecting anything else. */
  const serverLogPath = (serverId: string, name: string): string | null => {
    const cwd = logsCwdFor(serverId)
    if (!cwd) return null
    if (!/^(crash-reports\/)?[A-Za-z0-9_.-]+$/.test(name)) return null
    const path = name.startsWith('crash-reports/')
      ? join(cwd, 'crash-reports', name.slice('crash-reports/'.length))
      : join(cwd, 'logs', name)
    return existsSync(path) ? path : null
  }

  ipcMain.handle('serverlogs:read', (_event, serverId: string, name: string): ServerLogContent => {
    const path = serverLogPath(serverId, name)
    if (!path) throw new Error('Log file not found')
    const MAX = 256 * 1024
    let buf = readFileSync(path)
    let truncated = false
    if (buf.length > MAX) {
      buf = buf.subarray(buf.length - MAX)
      truncated = true
    }
    return { name, truncated, text: buf.toString('utf8') }
  })

  ipcMain.handle('serverlogs:openFolder', (_event, serverId: string): boolean => {
    const cwd = logsCwdFor(serverId)
    if (!cwd) return false
    const logsDir = join(cwd, 'logs')
    void shell.openPath(existsSync(logsDir) ? logsDir : cwd)
    return true
  })

  // ---- server files (mods / config / datapacks) ----------------------------

  /** Datapacks live in the source saves world — refuse mutations while hosted. */
  const guardWorldNotHosted = (worldPath: string | null): void => {
    if (!worldPath) return
    const holder = serverRegistry.busy().find((m) => m.worldPath === worldPath)
    if (holder) {
      const profile = store.getServer(holder.serverId)
      throw new Error(`Stop "${profile?.name ?? 'the server'}" before changing this world's datapacks`)
    }
  }

  ipcMain.handle('files:list', (_event, serverId: string, worldPath: string | null): FilesInfo => {
    const profile = store.getServer(serverId)
    if (!profile) throw new Error('Server not found')
    return filesInfoFor(profile, worldPath)
  })

  ipcMain.handle(
    'files:add',
    (_event, serverId: string, section: FilesSectionId, worldPath: string | null, sourcePaths: string[]): string[] => {
      const profile = store.getServer(serverId)
      if (!profile) throw new Error('Server not found')
      if (section === 'datapacks') guardWorldNotHosted(worldPath)
      return addFiles(profile, section, worldPath, sourcePaths)
    }
  )

  ipcMain.handle(
    'files:delete',
    (_event, serverId: string, section: FilesSectionId, worldPath: string | null, name: string): boolean => {
      const profile = store.getServer(serverId)
      if (!profile) throw new Error('Server not found')
      if (section === 'datapacks') guardWorldNotHosted(worldPath)
      return deleteFile(profile, section, worldPath, name)
    }
  )

  ipcMain.handle(
    'files:reveal',
    (_event, serverId: string, section: FilesSectionId, worldPath: string | null, name: string | null): boolean => {
      const profile = store.getServer(serverId)
      if (!profile) throw new Error('Server not found')
      return revealEntry(profile, section, worldPath, name)
    }
  )
}
