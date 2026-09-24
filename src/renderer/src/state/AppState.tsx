import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AppSettings,
  FabricVersion,
  JarProgress,
  JavaCandidate,
  LevelEdits,
  LoaderKind,
  LoaderVersionList,
  LogLine,
  NetInfo,
  ServerProfile,
  ServerProfilePatch,
  ServerState,
  StartResult,
  UpdateStateEvent,
  VanillaVersion,
  WorldInfo,
  WorldProgress
} from '../../../shared/types'
import type { Page, Toast } from '../types'

const LOG_CAP = 2000

interface VanillaVersionList {
  latest: string
  versions: VanillaVersion[]
}

interface FabricVersionList {
  game: FabricVersion[]
  loader: FabricVersion[]
}

interface LoaderVersions {
  kind: LoaderKind
  list: LoaderVersionList
}

/** Live per-server state held in the renderer (process state, logs, progress). */
export interface ServerRuntime {
  state: ServerState
  worldPath: string | null
  address: string | null
  localAddress: string | null
  logs: LogLine[]
  jarProgress: JarProgress | null
  worldProgress: WorldProgress | null
}

const EMPTY_RUNTIME: ServerRuntime = {
  state: 'stopped',
  worldPath: null,
  address: null,
  localAddress: null,
  logs: [],
  jarProgress: null,
  worldProgress: null
}

interface AppContextValue {
  settings: AppSettings
  servers: ServerProfile[]
  runtime: Record<string, ServerRuntime>
  worldInfos: Record<string, WorldInfo>
  worldErrors: Record<string, string>
  netInfo: NetInfo | null
  page: Page
  consoleServerId: string | null
  /** World/server the Backups window was opened for. */
  backupsTarget: { serverId: string | null; worldPath: string | null }
  /** World/server the Files window was opened for. */
  filesTarget: { serverId: string | null; worldPath: string | null }
  toasts: Toast[]
  vanillaVersions: VanillaVersionList | null
  fabricVersions: FabricVersionList | null
  loaderVersions: LoaderVersions | null
  javaCandidates: JavaCandidate[] | null
  startBusy: Record<string, boolean>
  showEulaModal: boolean
  /** App version from the main process (package.json version), shown under the app name. */
  appVersion: string | null
  /** Latest updater snapshot; null until the first update event arrives. */
  updateState: UpdateStateEvent | null
  /** True while the blocking "Checking for updates" screen must cover the app (startup only). */
  startupGate: boolean
  /** True when the small 30-minute-check popup is open. */
  updatePopup: boolean
  dismissUpdatePopup(): void
  /** TEMPORARY alpha notice — true on every launch until dismissed. */
  alphaNotice: boolean
  dismissAlphaNotice(): void
  /** "What's new" data while that modal is open; null while closed. */
  whatsNew: { version: string; notes: string | null } | null
  dismissWhatsNew(): void
  downloadUpdate(prerelease?: boolean): Promise<void>
  installUpdate(): Promise<void>
  setPage(page: Page): void
  openConsole(serverId: string): void
  openBackups(serverId: string | null, worldPath: string | null): void
  openFiles(serverId: string | null, worldPath: string | null): void
  refreshServers(): Promise<void>
  refreshWorldInfo(path: string): Promise<WorldInfo | null>
  createServer(name: string): Promise<ServerProfile | null>
  deleteServer(id: string): Promise<void>
  updateServer(id: string, patch: ServerProfilePatch): Promise<ServerProfile | null>
  addWorld(serverId: string): Promise<void>
  createWorld(serverId: string, name: string, seed: string | null, savesDir: string | null): Promise<boolean>
  removeWorld(serverId: string, path: string): Promise<void>
  saveEdits(path: string, edits: LevelEdits): Promise<boolean>
  syncBack(serverId: string, path: string): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  requestStart(serverId: string, worldPath: string): Promise<void>
  stopServer(serverId: string): Promise<void>
  sendCommand(serverId: string, command: string): Promise<boolean>
  loadJavaCandidates(force?: boolean): Promise<void>
  loadVanillaVersions(force?: boolean): Promise<void>
  loadFabricVersions(force?: boolean): Promise<void>
  loadLoaderVersions(kind: LoaderKind, force?: boolean): Promise<void>
  openEulaModal(): void
  closeEulaModal(): void
  acceptEula(): Promise<void>
  pushToast(kind: Toast['kind'], message: string): void
  dismissToast(id: number): void
}

const DEFAULT_SETTINGS: AppSettings = {
  javaPath: null,
  mcSavesDir: null,
  savesDirHistory: [],
  eulaAccepted: false,
  exposeMode: 'auto',
  customAddress: null,
  lastSeenVersion: null,
  servers: []
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [servers, setServers] = useState<ServerProfile[]>([])
  const [runtime, setRuntime] = useState<Record<string, ServerRuntime>>({})
  const [worldInfos, setWorldInfos] = useState<Record<string, WorldInfo>>({})
  const [worldErrors, setWorldErrors] = useState<Record<string, string>>({})
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null)
  const [page, setPage] = useState<Page>('servers')
  const [consoleServerId, setConsoleServerId] = useState<string | null>(null)
  const [backupsTarget, setBackupsTarget] = useState<{ serverId: string | null; worldPath: string | null }>({
    serverId: null,
    worldPath: null
  })
  const [filesTarget, setFilesTarget] = useState<{ serverId: string | null; worldPath: string | null }>({
    serverId: null,
    worldPath: null
  })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [vanillaVersions, setVanillaVersions] = useState<VanillaVersionList | null>(null)
  const [fabricVersions, setFabricVersions] = useState<FabricVersionList | null>(null)
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersions | null>(null)
  const [javaCandidates, setJavaCandidates] = useState<JavaCandidate[] | null>(null)
  const [startBusy, setStartBusy] = useState<Record<string, boolean>>({})
  const [showEulaModal, setShowEulaModal] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateStateEvent | null>(null)
  const [startupGate, setStartupGate] = useState(true)
  const [updatePopup, setUpdatePopup] = useState(false)
  const [alphaNotice, setAlphaNotice] = useState(true)
  const [whatsNew, setWhatsNew] = useState<{ version: string; notes: string | null } | null>(null)

  const pendingStartRef = useRef<{ serverId: string; worldPath: string } | null>(null)
  const toastIdRef = useRef(0)
  const settingsRef = useRef(settings)
  const serversRef = useRef(servers)
  const vanillaVersionsRef = useRef(vanillaVersions)
  const fabricVersionsRef = useRef(fabricVersions)
  const loaderVersionsRef = useRef(loaderVersions)
  const startBusyRef = useRef<Record<string, boolean>>({})
  const packagedRef = useRef(false)
  const startupGateRef = useRef(true)
  const updateStateRef = useRef<UpdateStateEvent | null>(null)
  const gateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  useEffect(() => {
    serversRef.current = servers
  }, [servers])
  useEffect(() => {
    vanillaVersionsRef.current = vanillaVersions
  }, [vanillaVersions])
  useEffect(() => {
    fabricVersionsRef.current = fabricVersions
  }, [fabricVersions])
  useEffect(() => {
    loaderVersionsRef.current = loaderVersions
  }, [loaderVersions])
  useEffect(() => {
    startBusyRef.current = startBusy
  }, [startBusy])
  useEffect(() => {
    startupGateRef.current = startupGate
  }, [startupGate])
  useEffect(() => {
    updateStateRef.current = updateState
  }, [updateState])

  const pushToast = useCallback((kind: Toast['kind'], message: string): void => {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, kind, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 6000)
  }, [])

  const dismissToast = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const setStartBusyFor = useCallback((serverId: string, busy: boolean): void => {
    setStartBusy((prev) => ({ ...prev, [serverId]: busy }))
  }, [])

  const appendLog = useCallback((serverId: string, line: LogLine): void => {
    setRuntime((prev) => {
      const current = prev[serverId] ?? EMPTY_RUNTIME
      const logs = current.logs.length >= LOG_CAP ? current.logs.slice(current.logs.length - LOG_CAP + 1) : current.logs
      return { ...prev, [serverId]: { ...current, logs: [...logs, line] } }
    })
  }, [])

  const applyStatus = useCallback((payload: {
    serverId: string
    state: ServerState
    worldPath: string | null
    address: string | null
    localAddress: string | null
    recentLogs?: LogLine[]
  }): void => {
    setRuntime((prev) => {
      const current = prev[payload.serverId] ?? EMPTY_RUNTIME
      return {
        ...prev,
        [payload.serverId]: {
          ...current,
          state: payload.state,
          worldPath: payload.worldPath,
          address: payload.address,
          localAddress: payload.localAddress,
          logs: payload.recentLogs ? payload.recentLogs.slice(-LOG_CAP) : current.logs
        }
      }
    })
  }, [])

  const refreshWorldInfo = useCallback(async (path: string): Promise<WorldInfo | null> => {
    try {
      const info = await window.api.worldInfo(path)
      setWorldInfos((prev) => ({ ...prev, [path]: info }))
      setWorldErrors((prev) => {
        if (!prev[path]) return prev
        const next = { ...prev }
        delete next[path]
        return next
      })
      return info
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setWorldErrors((prev) => ({ ...prev, [path]: message }))
      return null
    }
  }, [])

  const refreshServers = useCallback(async (): Promise<void> => {
    const config = await window.api.getConfig()
    setSettings(config)
    setServers(config.servers)
    const statuses = await window.api.statusAll()
    for (const status of statuses) applyStatus(status)
    for (const profile of config.servers) {
      for (const world of profile.worlds) void refreshWorldInfo(world.path)
    }
  }, [applyStatus, refreshWorldInfo])

  const openConsole = useCallback((serverId: string): void => {
    setConsoleServerId(serverId)
    setPage('console')
  }, [])

  const openBackups = useCallback((serverId: string | null, worldPath: string | null): void => {
    setBackupsTarget({ serverId, worldPath })
    setPage('backups')
  }, [])

  const openFiles = useCallback((serverId: string | null, worldPath: string | null): void => {
    setFilesTarget({ serverId, worldPath })
    setPage('files')
  }, [])

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      setSettings((prev) => ({ ...prev, ...patch }))
      try {
        const next = await window.api.setConfig(patch)
        setSettings(next)
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [pushToast]
  )

  const createServer = useCallback(
    async (name: string): Promise<ServerProfile | null> => {
      try {
        const profile = await window.api.createServer(name)
        setServers((prev) => [...prev, profile])
        pushToast('success', `Server "${profile.name}" created — add worlds and configure it`)
        return profile
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
        return null
      }
    },
    [pushToast]
  )

  const deleteServer = useCallback(
    async (id: string): Promise<void> => {
      try {
        const next = await window.api.deleteServer(id)
        setServers(next)
        setConsoleServerId((prev) => (prev === id ? null : prev))
        pushToast('success', 'Server removed')
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [pushToast]
  )

  const updateServer = useCallback(
    async (id: string, patch: ServerProfilePatch): Promise<ServerProfile | null> => {
      try {
        const next = await window.api.updateServer(id, patch)
        setServers((prev) => prev.map((s) => (s.id === id ? next : s)))
        return next
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
        return null
      }
    },
    [pushToast]
  )

  const addWorld = useCallback(
    async (serverId: string): Promise<void> => {
      try {
        const path = await window.api.selectWorld()
        if (!path) return
        const next = await window.api.addWorld(serverId, path)
        setServers((prev) => prev.map((s) => (s.id === serverId ? next : s)))
        void refreshWorldInfo(path)
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [pushToast, refreshWorldInfo]
  )

  const createWorld = useCallback(
    async (serverId: string, name: string, seed: string | null, savesDir: string | null): Promise<boolean> => {
      try {
        const next = await window.api.createWorld(serverId, name, seed, savesDir)
        setServers((prev) => prev.map((s) => (s.id === serverId ? next : s)))
        const added = next.worlds[next.worlds.length - 1]
        if (added) void refreshWorldInfo(added.path)
        pushToast('success', 'World folder created — host it to generate the world')
        return true
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [pushToast, refreshWorldInfo]
  )

  const removeWorld = useCallback(
    async (serverId: string, path: string): Promise<void> => {
      try {
        const next = await window.api.removeWorld(serverId, path)
        setServers((prev) => prev.map((s) => (s.id === serverId ? next : s)))
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [pushToast]
  )

  const saveEdits = useCallback(
    async (path: string, edits: LevelEdits): Promise<boolean> => {
      try {
        const result = await window.api.saveLevel(path, edits)
        setWorldInfos((prev) => ({ ...prev, [path]: result.info }))
        pushToast('success', `World data saved${result.backupPath ? ' — backup written' : ''}`)
        return true
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [pushToast]
  )

  const syncBack = useCallback(
    async (serverId: string, path: string): Promise<void> => {
      try {
        const result = await window.api.syncBack(serverId, path)
        setWorldInfos((prev) => ({ ...prev, [path]: result.info }))
        pushToast(
          result.migratedPlayer ? 'success' : 'info',
          result.migratedPlayer
            ? 'Played world synced back — player position and inventory restored'
            : 'Played world synced back (no player played on the server since the last sync)'
        )
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [pushToast]
  )

  const stopServer = useCallback(
    async (serverId: string): Promise<void> => {
      const accepted = await window.api.stopServer(serverId)
      if (!accepted) pushToast('info', 'This server is not running')
    },
    [pushToast]
  )

  const sendCommand = useCallback(
    async (serverId: string, command: string): Promise<boolean> => {
      const accepted = await window.api.sendCommand(serverId, command)
      if (!accepted) pushToast('error', 'Server is not running — command not sent')
      return accepted
    },
    [pushToast]
  )

  const loadJavaCandidates = useCallback(
    async (force = false): Promise<void> => {
      if (javaCandidates && !force) return
      try {
        const found = await window.api.detectJava()
        setJavaCandidates(found)
        if (found.length === 0) pushToast('error', 'No Java runtime found — install Java or pick javaw.exe manually')
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [javaCandidates, pushToast]
  )

  const loadVanillaVersions = useCallback(
    async (force = false): Promise<void> => {
      if (vanillaVersionsRef.current && !force) return
      try {
        const list = await window.api.vanillaVersions()
        setVanillaVersions(list)
      } catch (err) {
        pushToast('error', `Could not load Mojang version list: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [pushToast]
  )

  const loadFabricVersions = useCallback(
    async (force = false): Promise<void> => {
      if (fabricVersionsRef.current && !force) return
      try {
        const list = await window.api.fabricVersions()
        setFabricVersions(list)
      } catch (err) {
        pushToast('error', `Could not load Fabric versions: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [pushToast]
  )

  const loadLoaderVersions = useCallback(
    async (kind: LoaderKind, force = false): Promise<void> => {
      const cached = loaderVersionsRef.current
      if (cached && cached.kind === kind && !force) return
      try {
        const list = await window.api.loaderVersions(kind)
        setLoaderVersions({ kind, list })
      } catch (err) {
        pushToast('error', `Could not load ${kind} versions: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [pushToast]
  )

  const resolveAndEnsureServerFiles = useCallback(
    async (profile: ServerProfile): Promise<void> => {
      // Fill in a default version when none was picked yet, then pre-download /
      // pre-install so progress streams into this server's console.
      if (profile.kind === 'vanilla') {
        let version = profile.vanillaVersion
        if (!version) {
          const list = vanillaVersionsRef.current ?? (await window.api.vanillaVersions())
          setVanillaVersions(list)
          version = list.latest
          if (!version) throw new Error('Could not resolve latest vanilla release')
          const next = await window.api.updateServer(profile.id, { vanillaVersion: version })
          setServers((prev) => prev.map((s) => (s.id === profile.id ? next : s)))
        }
        await window.api.ensureJar('vanilla', version, profile.id)
      } else if (profile.kind === 'fabric') {
        let game = profile.fabricGame
        let loader = profile.fabricLoader
        if (!game || !loader) {
          const list = fabricVersionsRef.current ?? (await window.api.fabricVersions())
          setFabricVersions(list)
          game = game ?? list.game.find((g) => g.stable)?.version ?? list.game[0]?.version
          loader = loader ?? list.loader.find((l) => l.stable)?.version ?? list.loader[0]?.version
          if (!game || !loader) throw new Error('Could not resolve Fabric game/loader versions')
          const next = await window.api.updateServer(profile.id, { fabricGame: game, fabricLoader: loader })
          setServers((prev) => prev.map((s) => (s.id === profile.id ? next : s)))
        }
        await window.api.ensureJar('fabric', game, loader, profile.id)
      } else if (profile.kind === 'neoforge' || profile.kind === 'forge') {
        const kind = profile.kind
        const setting: 'neoforgeVersion' | 'forgeVersion' = kind === 'neoforge' ? 'neoforgeVersion' : 'forgeVersion'
        let version = profile[setting]
        if (!version) {
          const cached = loaderVersionsRef.current
          const list = cached && cached.kind === kind ? cached.list : await window.api.loaderVersions(kind)
          if (!cached || cached.kind !== kind) setLoaderVersions({ kind, list })
          const group = list.groups[0]
          version = (group?.builds.find((b) => !b.prerelease) ?? group?.builds[0])?.version
          if (!version) throw new Error(`Could not resolve a ${kind} version`)
          const next = await window.api.updateServer(profile.id, { [setting]: version } as ServerProfilePatch)
          setServers((prev) => prev.map((s) => (s.id === profile.id ? next : s)))
        }
        await window.api.ensureLoader(kind, version, profile.id)
      }
    },
    []
  )

  const requestStart = useCallback(
    async (serverId: string, worldPath: string): Promise<void> => {
      if (startBusyRef.current[serverId]) return
      const profile = serversRef.current.find((s) => s.id === serverId)
      if (!profile) return
      if (!settingsRef.current.eulaAccepted) {
        pendingStartRef.current = { serverId, worldPath }
        setShowEulaModal(true)
        return
      }
      setStartBusyFor(serverId, true)
      setRuntime((prev) => ({
        ...prev,
        [serverId]: { ...(prev[serverId] ?? EMPTY_RUNTIME), worldProgress: null, jarProgress: null }
      }))
      // Open the console right away: downloads and loader installs stream there.
      openConsole(serverId)
      try {
        await resolveAndEnsureServerFiles(profile)
        const result: StartResult = await window.api.startServer(serverId, worldPath)
        if (result.ok) {
          // world list may have gained this world / lastHostedAt
          void refreshServers()
        } else if (result.needsEula) {
          pendingStartRef.current = { serverId, worldPath }
          setShowEulaModal(true)
        } else if (result.error) {
          pushToast('error', result.error)
        }
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      } finally {
        setStartBusyFor(serverId, false)
        setRuntime((prev) => ({
          ...prev,
          [serverId]: { ...(prev[serverId] ?? EMPTY_RUNTIME), jarProgress: null }
        }))
      }
    },
    [openConsole, pushToast, refreshServers, resolveAndEnsureServerFiles, setStartBusyFor]
  )

  const openEulaModal = useCallback((): void => {
    setShowEulaModal(true)
  }, [])

  const closeEulaModal = useCallback((): void => {
    pendingStartRef.current = null
    setShowEulaModal(false)
  }, [])

  const acceptEula = useCallback(async (): Promise<void> => {
    await window.api.acceptEula()
    setSettings((prev) => ({ ...prev, eulaAccepted: true }))
    setShowEulaModal(false)
    const pending = pendingStartRef.current
    pendingStartRef.current = null
    if (pending) void requestStart(pending.serverId, pending.worldPath)
  }, [requestStart])

  // ---- version display + auto-update gate ---------------------------------
  //
  // Startup: the app opens behind a blocking "Checking for updates" screen
  // (packaged builds only). No update / check failure lifts it; an available
  // update keeps it blocked until the user downloads & installs. Every 30
  // minutes a silent background check pops a small skippable popup instead.

  const dismissUpdatePopup = useCallback((): void => {
    setUpdatePopup(false)
    // Skipping an available update (without pressing the update button) shows
    // what the user is missing: the release notes of that version.
    const state = updateStateRef.current
    const skippedVersion =
      state?.phase === 'available' || state?.phase === 'prerelease-available' ? state.version : undefined
    if (!skippedVersion) return
    void (async () => {
      let notes: string | null = null
      try {
        notes = await window.api.releaseNotes(skippedVersion)
      } catch {
        notes = null
      }
      setWhatsNew({ version: skippedVersion, notes })
    })()
  }, [])

  const dismissAlphaNotice = useCallback((): void => {
    setAlphaNotice(false)
  }, [])

  const dismissWhatsNew = useCallback((): void => {
    setWhatsNew(null)
  }, [])

  const downloadUpdate = useCallback(async (prerelease = false): Promise<void> => {
    try {
      await window.api.downloadUpdate(prerelease)
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }, [pushToast])

  const installUpdate = useCallback(async (): Promise<void> => {
    try {
      await window.api.installUpdate()
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }, [pushToast])

  useEffect(() => {
    let cancelled = false

    const unsubUpdate = window.api.onUpdateState((state) => {
      setUpdateState(state)
      // Any definitive answer clears the startup-check hang safety net.
      if (gateTimeoutRef.current && state.phase !== 'checking') {
        clearTimeout(gateTimeoutRef.current)
        gateTimeoutRef.current = null
      }
      if (state.phase === 'available') {
        // The startup gate shows the update full-screen; only background
        // (30-minute) finds pop the small card.
        if (!startupGateRef.current) setUpdatePopup(true)
      }
      if (state.phase === 'prerelease-available') {
        setStartupGate(false)
        setUpdatePopup(true)
      }
      if (state.phase === 'none' || state.phase === 'error') {
        setStartupGate(false)
        setUpdatePopup(false)
      }
    })

    void (async () => {
      try {
        const info = await window.api.appInfo()
        if (cancelled) return
        setAppVersion(info.version)
        packagedRef.current = info.packaged
      } catch {
        /* cosmetic — the version line simply stays empty */
      }
      if (cancelled) return
      if (!packagedRef.current) {
        // Dev runs never check for updates and never show the gate.
        setStartupGate(false)
        return
      }
      // Safety net: a hung check must never lock the user out of the app.
      gateTimeoutRef.current = setTimeout(() => {
        gateTimeoutRef.current = null
        setStartupGate(false)
      }, 20000)
      try {
        await window.api.checkUpdate()
      } catch {
        if (gateTimeoutRef.current) {
          clearTimeout(gateTimeoutRef.current)
          gateTimeoutRef.current = null
        }
        setStartupGate(false)
      }
    })()

    const interval = setInterval(() => {
      if (packagedRef.current) void window.api.checkUpdate()
    }, 30 * 60 * 1000)

    return () => {
      cancelled = true
      unsubUpdate()
      if (gateTimeoutRef.current) clearTimeout(gateTimeoutRef.current)
      clearInterval(interval)
    }
  }, [])

  // Post-update "What's new" check: the main process compares the remembered
  // last-run version with the current one; a difference means the app was
  // just updated, and the release-notes window opens (after the alpha notice,
  // if both would show at once).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const check = await window.api.whatsNewCheck()
        if (!cancelled && check.updated) setWhatsNew({ version: check.version, notes: check.notes })
      } catch {
        /* non-critical — the window simply doesn't open */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // One-time hydration + event subscriptions.
  useEffect(() => {
    const unsubLog = window.api.onServerLog((event) => appendLog(event.serverId, event.line))
    const unsubState = window.api.onServerState((event) => applyStatus(event))
    const unsubJar = window.api.onJarProgress(({ serverId, progress }) => {
      setRuntime((prev) => ({
        ...prev,
        [serverId]: { ...(prev[serverId] ?? EMPTY_RUNTIME), jarProgress: progress.done ? null : progress }
      }))
    })
    const unsubWorld = window.api.onWorldProgress(({ serverId, progress }) => {
      setRuntime((prev) => ({
        ...prev,
        [serverId]: { ...(prev[serverId] ?? EMPTY_RUNTIME), worldProgress: progress }
      }))
      if (progress.done) {
        // Keep the completed bar visible briefly, then clear it.
        setTimeout(() => {
          setRuntime((prev) => ({
            ...prev,
            [serverId]: { ...(prev[serverId] ?? EMPTY_RUNTIME), worldProgress: null }
          }))
        }, 800)
      }
    })

    void (async () => {
      try {
        setNetInfo(await window.api.netInfo())
      } catch {
        setNetInfo(null)
      }
      await refreshServers()
    })()

    return () => {
      unsubLog()
      unsubState()
      unsubJar()
      unsubWorld()
    }
  }, [appendLog, applyStatus, refreshServers])

  const value: AppContextValue = {
    settings,
    servers,
    runtime,
    worldInfos,
    worldErrors,
    netInfo,
    page,
    consoleServerId,
    backupsTarget,
    filesTarget,
    toasts,
    vanillaVersions,
    fabricVersions,
    loaderVersions,
    javaCandidates,
    startBusy,
    showEulaModal,
    appVersion,
    updateState,
    startupGate,
    updatePopup,
    dismissUpdatePopup,
    alphaNotice,
    dismissAlphaNotice,
    whatsNew,
    dismissWhatsNew,
    downloadUpdate,
    installUpdate,
    setPage,
    openConsole,
    openBackups,
    openFiles,
    refreshServers,
    refreshWorldInfo,
    createServer,
    deleteServer,
    updateServer,
    addWorld,
    createWorld,
    removeWorld,
    saveEdits,
    syncBack,
    updateSettings,
    requestStart,
    stopServer,
    sendCommand,
    loadJavaCandidates,
    loadVanillaVersions,
    loadFabricVersions,
    loadLoaderVersions,
    openEulaModal,
    closeEulaModal,
    acceptEula,
    pushToast,
    dismissToast
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
