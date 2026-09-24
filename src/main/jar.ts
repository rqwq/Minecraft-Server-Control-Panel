import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FabricVersion, JarProgress, VanillaVersion } from '../shared/types'

const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions'

let cacheDir = ''

/** Must be called once after app ready with the userData directory. */
export function initJarService(userDataDir: string): void {
  // Top-level jars/ folder — deliberately NOT under Electron's cache/ dir,
  // which cleanup tools (and Chromium itself) consider disposable.
  cacheDir = join(userDataDir, 'jars')
  mkdirSync(cacheDir, { recursive: true })
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`)
  return (await res.json()) as T
}

interface MojangManifest {
  latest: { release: string; snapshot: string }
  versions: Array<{ id: string; type: string; url: string; releaseTime: string }>
}

export async function listVanillaVersions(): Promise<{ latest: string; versions: VanillaVersion[] }> {
  const manifest = await fetchJson<MojangManifest>(MOJANG_MANIFEST)
  return {
    latest: manifest.latest.release,
    versions: manifest.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
  }
}

export async function listFabricVersions(): Promise<{ game: FabricVersion[]; loader: FabricVersion[] }> {
  const [game, loader] = await Promise.all([
    fetchJson<FabricVersion[]>(`${FABRIC_META}/game`),
    fetchJson<FabricVersion[]>(`${FABRIC_META}/loader`)
  ])
  return { game, loader }
}

interface DownloadResult {
  bytes: number
  sha1: string
}

export async function downloadTo(
  url: string,
  destPath: string,
  label: string,
  onProgress: (p: JarProgress) => void
): Promise<DownloadResult> {
  // Self-heal the destination folder — it can go missing (cleanup tools) while
  // the app is running, and a missing parent must not crash the app.
  mkdirSync(dirname(destPath), { recursive: true })
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const body = res.body
  const total = Number(res.headers.get('content-length')) || 0
  const partPath = `${destPath}.part`
  const stream = createWriteStream(partPath)
  const hash = createHash('sha1')
  let received = 0
  let lastReport = 0

  // A failed open/write emits 'error' on the stream. Without a handler that is
  // an uncaught exception; race it so it rejects this promise cleanly instead.
  const streamFailure = new Promise<never>((_resolve, reject) => stream.on('error', reject))

  try {
    const endPromise = (async (): Promise<void> => {
      for await (const chunk of body) {
        const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        stream.write(buf)
        hash.update(buf)
        received += buf.length
        const now = Date.now()
        if (now - lastReport > 100) {
          lastReport = now
          onProgress({ label, received, total, done: false })
        }
      }
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })
    })()
    await Promise.race([endPromise, streamFailure])
  } catch (err) {
    stream.destroy()
    try {
      unlinkSync(partPath)
    } catch {
      /* ignore */
    }
    // Stop the fetch body from streaming into a dead write stream.
    try {
      await body.cancel()
    } catch {
      /* already done */
    }
    throw err
  }

  onProgress({ label, received, total, done: true })
  return { bytes: received, sha1: hash.digest('hex') }
}

export async function ensureVanillaJar(
  versionId: string,
  onProgress: (p: JarProgress) => void
): Promise<string> {
  const destPath = join(cacheDir, `vanilla-${versionId}.jar`)
  const manifest = await fetchJson<MojangManifest>(MOJANG_MANIFEST)
  const version = manifest.versions.find((v) => v.id === versionId)
  if (!version) throw new Error(`Unknown Minecraft version: ${versionId}`)
  const versionMeta = await fetchJson<{ downloads: { server: { url: string; sha1: string; size: number } } }>(
    version.url
  )
  const server = versionMeta.downloads?.server
  if (!server) throw new Error(`No server jar published for ${versionId}`)

  if (existsSync(destPath)) {
    let sizeOk = false
    try {
      sizeOk = statSync(destPath).size === server.size
    } catch {
      sizeOk = false
    }
    if (sizeOk) {
      onProgress({ label: `vanilla ${versionId}`, received: server.size, total: server.size, done: true })
      return destPath
    }
    unlinkSync(destPath)
  }

  const label = `vanilla ${versionId}`
  const { sha1 } = await downloadTo(server.url, destPath, label, onProgress)
  if (sha1 !== server.sha1.toLowerCase()) {
    try {
      unlinkSync(`${destPath}.part`)
    } catch {
      /* ignore */
    }
    throw new Error(`Checksum mismatch for ${label} — download corrupted, try again`)
  }
  renameSync(`${destPath}.part`, destPath)
  return destPath
}

export async function ensureFabricJar(
  game: string,
  loader: string,
  onProgress: (p: JarProgress) => void
): Promise<string> {
  const destPath = join(cacheDir, `fabric-${game}-${loader}.jar`)
  if (existsSync(destPath)) {
    return destPath
  }
  const installers = await fetchJson<FabricVersion[]>(`${FABRIC_META}/installer`)
  const installer = installers.find((i) => i.stable)?.version ?? installers[0]?.version
  if (!installer) throw new Error('Could not resolve a Fabric installer version')
  const url = `${FABRIC_META}/loader/${encodeURIComponent(game)}/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/jar`
  const label = `fabric ${game}`
  await downloadTo(url, destPath, label, onProgress)
  renameSync(`${destPath}.part`, destPath)
  return destPath
}
