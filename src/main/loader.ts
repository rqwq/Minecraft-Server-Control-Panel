import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { compareRelease, forgeMc, neoforgeMc } from '../shared/types'
import type { InstalledLoader, LoaderKind, LoaderVersionList } from '../shared/types'
import { downloadTo } from './jar'
import type { JarProgress } from '../shared/types'

const NEOFORGE_VERSIONS_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge'
const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

const INSTALL_MARKER = '.sc-install.json'

let serversDir = ''
let jarsCacheDir = ''

/** Must be called once after app ready with the userData directory. */
export function initLoaderService(userDataDir: string): void {
  serversDir = join(userDataDir, 'servers')
  jarsCacheDir = join(userDataDir, 'jars')
  mkdirSync(serversDir, { recursive: true })
  mkdirSync(jarsCacheDir, { recursive: true })
}

/** Resolve how to launch a server folder (custom or app-installed loader server). */
export function detectCustomEntry(dir: string): string | null {
  if (!existsSync(dir)) return null
  if (existsSync(join(dir, 'win_args.txt'))) return '@win_args.txt'
  // Newer NeoForge installs extract win_args.txt under libraries/net/neoforged/neoforge/<version>/.
  const neoforgeLibs = join(dir, 'libraries', 'net', 'neoforged', 'neoforge')
  if (existsSync(neoforgeLibs)) {
    for (const version of readdirSync(neoforgeLibs)) {
      if (existsSync(join(neoforgeLibs, version, 'win_args.txt'))) {
        return `@libraries\\net\\neoforged\\neoforge\\${version}\\win_args.txt`
      }
    }
  }
  const jars: Array<{ name: string; mtime: number }> = []
  for (const file of readdirSync(dir)) {
    if (!/\.jar$/i.test(file)) continue
    if (!/(server|forge|fabric|neoforge|minecraft)/i.test(file.replace(/\.jar$/i, ''))) continue
    try {
      jars.push({ name: file, mtime: statSync(join(dir, file)).mtimeMs })
    } catch {
      /* skip unreadable */
    }
  }
  jars.sort((a, b) => b.mtime - a.mtime)
  return jars[0]?.name ?? null
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`)
  return (await res.json()) as T
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`)
  return res.text()
}

function sortGroups(list: LoaderVersionList): LoaderVersionList {
  list.groups.sort((a, b) => {
    const cmp = (compareRelease(b.mc, a.mc) ?? 0)
    if (cmp !== 0) return cmp
    return b.mc.localeCompare(a.mc)
  })
  for (const g of list.groups) {
    g.builds.sort((a, b) => {
      const pre = Number(a.prerelease) - Number(b.prerelease)
      if (pre !== 0) return pre
      return (compareRelease(b.version, a.version) ?? 0) || b.version.localeCompare(a.version)
    })
  }
  return list
}

export async function listNeoForgeVersions(): Promise<LoaderVersionList> {
  const data = await fetchJson<{ versions: string[] }>(NEOFORGE_VERSIONS_API)
  const groupsByMc = new Map<string, LoaderVersionList['groups'][number]>()

  for (const raw of data.versions) {
    // Stable 3-component releases, plus 3/4-component -beta builds (no alphas, no April Fools).
    if (!/^\d+\.\d+\.\d+(\.\d+)?(-beta)?$/.test(raw) || raw.includes('alpha')) continue
    const mc = neoforgeMc(raw)
    if (!mc) continue
    const group = groupsByMc.get(mc) ?? { mc, builds: [] }
    group.builds.push({ version: raw, tag: null, prerelease: raw.endsWith('-beta') })
    groupsByMc.set(mc, group)
  }
  return sortGroups({ groups: [...groupsByMc.values()] })
}

export async function listForgeVersions(): Promise<LoaderVersionList> {
  const [metadata, promos] = await Promise.all([
    fetchText(FORGE_METADATA),
    fetchJson<{ promos: Record<string, string> }>(FORGE_PROMOS).catch(() => ({ promos: {} as Record<string, string> }))
  ])
  const groupsByMc = new Map<string, LoaderVersionList['groups'][number]>()

  for (const match of metadata.matchAll(/<version>([\d.]+)-([\d.]+)<\/version>/g)) {
    const mc = match[1]
    const build = match[2]
    // Modern format only (1.17+): 3-component builds like 47.2.0 / 66.0.3.
    if (!/^\d+\.\d+\.\d+$/.test(build)) continue
    if ((compareRelease(mc, '1.17') ?? -1) < 0) continue
    const group = groupsByMc.get(mc) ?? { mc, builds: [] }
    const recommended = promos.promos[`${mc}-recommended`]
    const latest = promos.promos[`${mc}-latest`]
    const tag = build === recommended ? 'recommended' : build === latest ? 'latest' : null
    group.builds.push({ version: `${mc}-${build}`, tag, prerelease: false })
    groupsByMc.set(mc, group)
  }
  return sortGroups({ groups: [...groupsByMc.values()] })
}

export function listLoaderVersions(kind: LoaderKind): Promise<LoaderVersionList> {
  return kind === 'neoforge' ? listNeoForgeVersions() : listForgeVersions()
}

export function managedServerDir(kind: LoaderKind, version: string): string {
  return join(serversDir, `${kind}-${version}`)
}

export function loaderStatus(kind: LoaderKind, version: string): { installed: boolean; dir: string | null } {
  if (!version) return { installed: false, dir: null }
  const dir = managedServerDir(kind, version)
  const installed = existsSync(join(dir, INSTALL_MARKER)) && detectCustomEntry(dir) !== null
  return { installed, dir: installed ? dir : null }
}

/** All app-installed loader servers (persisted in servers/ with an install marker). */
export function listInstalledLoaders(): InstalledLoader[] {
  if (!serversDir || !existsSync(serversDir)) return []
  const out: InstalledLoader[] = []
  for (const name of readdirSync(serversDir)) {
    const dir = join(serversDir, name)
    const markerPath = join(dir, INSTALL_MARKER)
    if (!existsSync(markerPath)) continue
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { kind: LoaderKind; version: string }
      if (marker.kind && marker.version) out.push({ kind: marker.kind, version: marker.version, dir })
    } catch {
      /* skip unreadable marker */
    }
  }
  return out
}

/** Remove an installed loader server; it reinstalls automatically if hosted again. */
export function removeLoaderServer(kind: LoaderKind, version: string): void {
  rmSync(managedServerDir(kind, version), { recursive: true, force: true })
}

export interface LoaderEvents {
  jarProgress(p: JarProgress): void
  installLog(line: string): void
}

function installerUrl(kind: LoaderKind, version: string): string {
  if (kind === 'neoforge') {
    return `${NEOFORGE_MAVEN}/${version}/neoforge-${version}-installer.jar`
  }
  return `${FORGE_MAVEN}/${version}/forge-${version}-installer.jar`
}

/** javaw has no attachable console output; prefer the java.exe sibling for the installer run. */
function consoleJava(javaPath: string): string {
  const javaExe = join(dirname(javaPath), 'java.exe')
  return existsSync(javaExe) ? javaExe : javaPath
}

function runInstaller(
  javaPath: string,
  installerPath: string,
  targetDir: string,
  installLog: (line: string) => void,
  withDirArg: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Modern installers accept the target dir as an argument; older ones only use the cwd.
    const args = ['-jar', installerPath, '--installServer']
    if (withDirArg) args.push(targetDir)
    const proc = spawn(consoleJava(javaPath), args, {
      cwd: targetDir,
      windowsHide: true
    })
    let tail = ''
    const keep = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        installLog(trimmed)
        tail = `${tail}${trimmed}\n`.split('\n').slice(-14).join('\n')
      }
    }
    proc.stdout?.on('data', keep)
    proc.stderr?.on('data', keep)
    proc.on('error', (err) => reject(err))
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Loader installer exited with code ${code}\n${tail.trim()}`))
      }
    })
  })
}

/**
 * Ensure a loader server is installed under userData/servers/<kind>-<version>/.
 * Downloads the installer (cached), runs `--installServer`, and marks the result.
 * The produced folder is launched like a custom server folder.
 */
export async function ensureLoaderServer(
  kind: LoaderKind,
  version: string,
  events: LoaderEvents,
  javaPath: string
): Promise<string> {
  if (!version) throw new Error('No loader version selected (see Settings)')
  const dir = managedServerDir(kind, version)
  const marker = join(dir, INSTALL_MARKER)
  if (existsSync(marker) && detectCustomEntry(dir) !== null) return dir

  // A folder without the marker is a broken/interrupted install — start clean.
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const installerPath = join(jarsCacheDir, `${kind}-${version}-installer.jar`)
  if (!existsSync(installerPath)) {
    events.installLog(`Downloading ${kind} ${version} installer…`)
    await downloadTo(installerUrl(kind, version), installerPath, `${kind} ${version} installer`, (p) =>
      events.jarProgress(p)
    )
    renameSync(`${installerPath}.part`, installerPath)
  }

  events.installLog(`Running ${kind} ${version} installer (downloads libraries, one-time)…`)
  try {
    await runInstaller(javaPath, installerPath, dir, events.installLog, true)
  } catch (errWithArg) {
    // Some installer versions reject an explicit target dir — retry with cwd only.
    events.installLog('Retrying installer without the target directory argument…')
    try {
      await runInstaller(javaPath, installerPath, dir, events.installLog, false)
    } catch {
      throw errWithArg
    }
  }

  const entry = detectCustomEntry(dir)
  if (!entry) throw new Error(`Installer finished but no launch entry (win_args.txt or server jar) was found`)
  writeFileSync(marker, JSON.stringify({ kind, version, installedAt: new Date().toISOString() }), 'utf8')
  events.installLog(`${kind} ${version} installed — launch entry: ${entry}`)
  return dir
}
