import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, ServerProfile } from '../shared/types'

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

/** The pre-multi-server config shape — read once for migration, then discarded. */
interface LegacyConfig {
  serverKind?: ServerProfile['kind']
  vanillaVersion?: string | null
  fabricGame?: string | null
  fabricLoader?: string | null
  neoforgeVersion?: string | null
  forgeVersion?: string | null
  customServerDir?: string | null
  clientPackDir?: string | null
  memoryGb?: number
  port?: number
  onlineMode?: boolean
  lastWorldPath?: string | null
}

/**
 * Convert a legacy flat config into the profile-based one. The previously
 * selected world becomes the one world of the migrated default server, and
 * legacyInstanceNaming keeps its instance folder layout valid.
 */
function migrateLegacy(raw: LegacyConfig): ServerProfile[] {
  const profile: ServerProfile = {
    id: 'srv-default',
    name: 'Default server',
    kind: raw.serverKind ?? 'vanilla',
    vanillaVersion: raw.vanillaVersion ?? null,
    fabricGame: raw.fabricGame ?? null,
    fabricLoader: raw.fabricLoader ?? null,
    neoforgeVersion: raw.neoforgeVersion ?? null,
    forgeVersion: raw.forgeVersion ?? null,
    customServerDir: raw.customServerDir ?? null,
    clientPackDir: raw.clientPackDir ?? null,
    memoryGb: raw.memoryGb ?? 2,
    port: raw.port ?? 25565,
    onlineMode: raw.onlineMode ?? false,
    worlds: raw.lastWorldPath ? [{ path: raw.lastWorldPath }] : [],
    legacyInstanceNaming: true
  }
  return [profile]
}

class ConfigStore {
  private data: AppSettings
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), 'config.json')
    this.data = { ...DEFAULT_SETTINGS }
    if (existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppSettings> & LegacyConfig
        if (Array.isArray(raw.servers)) {
          const { serverKind, vanillaVersion, fabricGame, fabricLoader, neoforgeVersion, forgeVersion,
            customServerDir, clientPackDir, memoryGb, port, onlineMode, lastWorldPath,
            ...rest } = raw as Partial<AppSettings> & LegacyConfig
          this.data = {
            ...DEFAULT_SETTINGS,
            ...rest,
            servers: raw.servers.filter((s) => s && typeof s.id === 'string')
          }
        } else {
          // Pre-multi-server config: fold the flat server settings into a default profile.
          const { serverKind, vanillaVersion, fabricGame, fabricLoader, neoforgeVersion, forgeVersion,
            customServerDir, clientPackDir, memoryGb, port, onlineMode, lastWorldPath,
            ...rest } = raw
          this.data = { ...DEFAULT_SETTINGS, ...rest, servers: migrateLegacy(raw) }
        }
      } catch {
        // Corrupt config: fall back to defaults, keep the file overwritten on next save.
      }
    }
    if (this.data.servers.length === 0 && !existsSync(this.filePath)) {
      // Brand-new install: seed one vanilla profile so the app is usable immediately.
      this.data.servers = [makeProfile('My server', 25565, [])]
    }
  }

  get(): AppSettings {
    return JSON.parse(JSON.stringify(this.data)) as AppSettings
  }

  patch(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...patch }
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
    return this.get()
  }

  listServers(): ServerProfile[] {
    return this.get().servers
  }

  getServer(id: string): ServerProfile | null {
    return this.data.servers.find((s) => s.id === id) ?? null
  }

  updateServer(id: string, mutate: (profile: ServerProfile) => ServerProfile): ServerProfile | null {
    const index = this.data.servers.findIndex((s) => s.id === id)
    if (index === -1) return null
    const next = mutate({ ...this.data.servers[index] })
    this.data.servers[index] = next
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
    return JSON.parse(JSON.stringify(next)) as ServerProfile
  }
}

let instance: ConfigStore | null = null

export function getStore(): ConfigStore {
  if (!instance) instance = new ConfigStore()
  return instance
}

const PROFILE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function makeProfileId(): string {
  let id = ''
  for (let i = 0; i < 10; i++) {
    id += PROFILE_ALPHABET[Math.floor(Math.random() * PROFILE_ALPHABET.length)]
  }
  return `srv-${id}`
}

export function makeProfile(name: string, port: number, worlds: ServerProfile['worlds']): ServerProfile {
  return {
    id: makeProfileId(),
    name: name.trim() || 'New server',
    kind: 'vanilla',
    vanillaVersion: null,
    fabricGame: null,
    fabricLoader: null,
    neoforgeVersion: null,
    forgeVersion: null,
    customServerDir: null,
    clientPackDir: null,
    memoryGb: 2,
    port,
    onlineMode: false,
    worlds
  }
}
