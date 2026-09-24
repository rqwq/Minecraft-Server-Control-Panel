import { app } from 'electron'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AppSettings, JarProgress, ServerProfile, WorldProgress } from '../shared/types'
import { copyTree, instanceSlug, isValidWorld, hashPlayerData, readNewWorldMarker, savedPlayerUuid, seedPlayerData } from './world'
import { getPlayerRecord, updatePlayerRecord } from './playerSync'
import { ensureFabricJar, ensureVanillaJar } from './jar'
import { detectCustomEntry, ensureLoaderServer } from './loader'
import { localAddress, netInfo, serverAddress } from './net'

export interface PreparedServer {
  cwd: string
  javaArgs: string[]
  worldDir: string
  address: string
  localAddress: string
}

export interface PrepareEvents {
  worldProgress(p: WorldProgress): void
  jarProgress(p: JarProgress): void
  installLog(line: string): void
}

/** Client-pack folders (besides mods) that are mirrored into the server on every host. */
const PACK_FOLDERS = ['config', 'defaultconfigs', 'kubejs'] as const

/** Folders/files inside a run dir that the app owns — never junctioned from the install. */
const MANAGED_RUN_ENTRIES = new Set([
  'world',
  'world_nether',
  'world_the_end',
  'mods',
  'config',
  'defaultconfigs',
  'kubejs',
  'logs',
  'crash-reports',
  'server.properties',
  'eula.txt',
  '.sc-install.json',
  'user_jvm_args.txt'
])

/** Directory the server process runs in (holds the world, properties, eula). */
export function serverCwdFor(profile: ServerProfile, worldPath: string): string {
  if (profile.kind === 'custom') {
    return profile.customServerDir ?? ''
  }
  if (profile.kind === 'neoforge' || profile.kind === 'forge') {
    return join(app.getPath('userData'), 'runs', profile.id)
  }
  return instanceDirFor(profile, worldPath)
}

/** World copy location for a (server, world) pair — deterministic, survives restarts. */
export function instanceWorldDirFor(profile: ServerProfile, worldPath: string): string {
  return join(serverCwdFor(profile, worldPath), 'world')
}

export function instanceDirFor(profile: ServerProfile, worldPath: string): string {
  // The profile migrated from the pre-multi-server config keeps the old flat
  // layout so its existing instance copies remain valid.
  if (profile.legacyInstanceNaming) {
    return join(app.getPath('userData'), 'instances', instanceSlug(worldPath))
  }
  return join(app.getPath('userData'), 'instances', profile.id, instanceSlug(worldPath))
}

function copyClientPack(packDir: string, cwd: string, events: PrepareEvents): void {
  if (!existsSync(packDir)) throw new Error(`Client pack folder does not exist: ${packDir}`)
  // The picker accepts either the instance folder or its mods folder directly.
  const base = basename(packDir).toLowerCase() === 'mods' ? dirname(packDir) : packDir
  const modsSrc = base === packDir ? join(packDir, 'mods') : packDir
  const targets: Array<[string, string]> = [[modsSrc, 'mods']]
  for (const folder of PACK_FOLDERS) targets.push([join(base, folder), folder])

  for (const [src, label] of targets) {
    if (!existsSync(src)) continue
    copyTree(src, join(cwd, label), (p) =>
      events.worldProgress({ ...p, label: `Copying ${label}`, done: p.files >= p.totalFiles && p.totalFiles > 0 })
    )
    events.worldProgress({ label: `Copying ${label}`, files: 0, totalFiles: 0, bytes: 0, totalBytes: 0, done: true })
  }
}

function readProperties(path: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line.trim())
    if (match) map.set(match[1], match[2])
  }
  return map
}

function writeProperties(path: string, map: Map<string, string>): void {
  const lines = [...map.entries()].map(([k, v]) => `${k}=${v}`)
  const header = `#Minecraft server properties\n#Managed by ServerController (${new Date().toISOString()})\n`
  writeFileSync(path, `${header}${lines.join('\n')}\n`, 'utf8')
}

/** True when `link` is a junction/symlink pointing at `target`. */
function isJunctionTo(link: string, target: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && readlinkSync(link).toLowerCase() === target.toLowerCase()
  } catch {
    return false
  }
}

function ensureJunction(target: string, link: string): void {
  if (isJunctionTo(link, target)) return
  try {
    rmSync(link, { recursive: true, force: true })
  } catch {
    /* in use or missing */
  }
  try {
    symlinkSync(target, link, 'junction')
  } catch {
    /* fall back to a real copy of small dirs below */
  }
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const item of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, item.name)
    const d = join(dest, item.name)
    if (item.isDirectory()) copyDir(s, d)
    else if (item.isFile() || item.isSymbolicLink()) copyFileSync(s, d)
  }
}

/**
 * Build the per-profile run dir for a managed loader server: everything from
 * the shared install is junctioned (huge libraries are shared read-only, so
 * several servers can run the same loader version at once), small root files
 * are copied, and app-managed entries (world, mods, config, properties…) stay
 * per-profile.
 */
function buildLoaderRunDir(installDir: string, runDir: string): void {
  mkdirSync(runDir, { recursive: true })
  for (const item of readdirSync(installDir, { withFileTypes: true })) {
    if (MANAGED_RUN_ENTRIES.has(item.name)) continue
    const src = join(installDir, item.name)
    const dest = join(runDir, item.name)
    if (item.isDirectory()) {
      ensureJunction(src, dest)
      if (!existsSync(dest)) copyDir(src, dest) // junction refused — copy as a fallback
    } else if (item.isFile()) {
      try {
        copyFileSync(src, dest)
      } catch {
        /* keep whatever is already there */
      }
    }
  }
}

async function resolveServerFiles(
  profile: ServerProfile,
  javaPath: string,
  events: PrepareEvents
): Promise<{ cwd: string; entryArgs: string[] }> {
  if (profile.kind === 'custom') {
    if (!profile.customServerDir || !existsSync(profile.customServerDir)) {
      throw new Error('Custom server folder is not set (see Settings)')
    }
    const entry = detectCustomEntry(profile.customServerDir)
    if (!entry) {
      throw new Error('No launchable server jar (or win_args.txt) found in the custom folder')
    }
    return { cwd: profile.customServerDir, entryArgs: entry.startsWith('@') ? [entry] : ['-jar', entry] }
  }

  if (profile.kind === 'neoforge' || profile.kind === 'forge') {
    const kind = profile.kind
    const version = kind === 'neoforge' ? profile.neoforgeVersion : profile.forgeVersion
    if (!version) throw new Error(`No ${kind} version selected (see Settings)`)
    const installDir = await ensureLoaderServer(
      kind,
      version,
      { jarProgress: (p) => events.jarProgress(p), installLog: (line) => events.installLog(line) },
      javaPath
    )
    const runDir = join(app.getPath('userData'), 'runs', profile.id)
    buildLoaderRunDir(installDir, runDir)
    const entry = detectCustomEntry(runDir)
    if (!entry) throw new Error(`${kind} ${version} is installed but has no launch entry`)
    return { cwd: runDir, entryArgs: entry.startsWith('@') ? [entry] : ['-jar', entry] }
  }
  throw new Error(`Unsupported server source: ${profile.kind}`)
}

async function resolveVanillaFabric(
  profile: ServerProfile,
  worldPath: string,
  events: PrepareEvents
): Promise<{ cwd: string; entryArgs: string[] }> {
  const instanceDir = instanceDirFor(profile, worldPath)
  mkdirSync(instanceDir, { recursive: true })
  if (profile.kind === 'vanilla') {
    if (!profile.vanillaVersion) throw new Error('No vanilla version selected (see Settings)')
    const jarPath = await ensureVanillaJar(profile.vanillaVersion, (p) => events.jarProgress(p))
    copyFileSync(jarPath, join(instanceDir, 'server.jar'))
    return { cwd: instanceDir, entryArgs: ['-jar', 'server.jar'] }
  }
  // fabric
  if (!profile.fabricGame || !profile.fabricLoader) {
    throw new Error('Fabric game/loader version not selected (see Settings)')
  }
  const jarPath = await ensureFabricJar(profile.fabricGame, profile.fabricLoader, (p) => events.jarProgress(p))
  copyFileSync(jarPath, join(instanceDir, 'fabric-server-launch.jar'))
  return { cwd: instanceDir, entryArgs: ['-jar', 'fabric-server-launch.jar'] }
}

export async function prepareServer(
  profile: ServerProfile,
  worldPath: string,
  settings: AppSettings,
  javaPath: string,
  events: PrepareEvents
): Promise<PreparedServer> {
  const { cwd, entryArgs } =
    profile.kind === 'vanilla' || profile.kind === 'fabric'
      ? await resolveVanillaFabric(profile, worldPath, events)
      : await resolveServerFiles(profile, javaPath, events)

  // Mirror the client pack (mods/config/…) into the server. Skipped for custom folders —
  // those are managed entirely by the user.
  if (profile.kind !== 'custom' && profile.clientPackDir) {
    copyClientPack(profile.clientPackDir, cwd, events)
  }

  // The server always plays on a copy; the original saves folder stays untouched.
  const worldDir = join(cwd, 'world')
  const newWorld = !isValidWorld(worldPath)
  if (newWorld) {
    // No level.dat to copy — the server generates the world on first start.
    // If a previous session's world is already in the instance, it is resumed as-is.
    events.worldProgress({
      label: 'New world — generated by the server',
      files: 0,
      totalFiles: 0,
      bytes: 0,
      totalBytes: 0,
      done: true
    })
  } else {
    copyTree(worldPath, worldDir, (p) =>
      events.worldProgress({ ...p, label: 'Copying world', done: p.files >= p.totalFiles && p.totalFiles > 0 })
    )
    events.worldProgress({ label: 'Copying world', files: 0, totalFiles: 0, bytes: 0, totalBytes: 0, done: true })
  }

  // Carry the singleplayer player (Data.Player) into playerdata/ for both the
  // singleplayer UUID and the UUID actually used on the server last session —
  // offline-mode servers derive the UUID from the player name and the two
  // often differ. Existing files are never clobbered (server progress wins).
  const record = getPlayerRecord(worldPath)
  const spUuid = savedPlayerUuid(worldDir)
  const seeded = seedPlayerData(worldDir, [spUuid, record.playedUuid])
  if (seeded.length > 0) {
    events.installLog(`Migrated singleplayer player data into playerdata/ (${seeded.join(', ')})`)
  }
  // Snapshot the post-seed hashes so sync-back can tell which file the server
  // actually rewrote during play, and mark the session as not-yet-synced.
  updatePlayerRecord(worldPath, {
    spUuid,
    hashes: hashPlayerData(worldDir),
    hostCompletedAt: Date.now(),
    syncedBack: false
  })

  const worldName = basename(worldPath) || 'world'
  const properties = readProperties(join(cwd, 'server.properties'))
  properties.set('level-name', 'world')
  properties.set('server-port', String(profile.port))
  properties.set('online-mode', String(profile.onlineMode))
  // Required so offline/unofficial-launcher players are not kicked on 1.19+.
  properties.set('enforce-secure-profile', 'false')
  properties.set('view-distance', '10')
  properties.set('spawn-protection', '0')
  properties.set('white-list', 'false')
  properties.set('motd', `${worldName} — ServerController`)
  if (newWorld) {
    const marker = readNewWorldMarker(worldPath)
    if (marker?.seed) properties.set('level-seed', marker.seed)
  }
  // The server binds to all interfaces so LAN and VPN (Radmin) players can join;
  // never set server-ip here.
  properties.delete('server-ip')
  writeProperties(join(cwd, 'server.properties'), properties)

  if (settings.eulaAccepted) {
    writeFileSync(
      join(cwd, 'eula.txt'),
      `# Minecraft EULA accepted through ServerController on ${new Date().toISOString()}\neula=true\n`,
      'utf8'
    )
  }

  return {
    cwd,
    worldDir,
    address: serverAddress(settings, netInfo(), profile.port),
    localAddress: localAddress(profile.port),
    javaArgs: ['-Xms512M', `-Xmx${profile.memoryGb}G`, ...entryArgs, 'nogui']
  }
}
