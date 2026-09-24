import { net } from 'electron'

export const RELEASES_API = 'https://api.github.com/repos/rqwq/Minecraft-Server-Control-Panel/releases/tags'

/**
 * GET via Electron's `net` (Chromium stack): unlike Node's fetch it honors
 * the system proxy, which matters on networks where api.github.com is not
 * directly reachable. Resolves null on any network error.
 */
export function netFetchText(url: string, timeoutMs: number): Promise<{ status: number; text: string } | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: { status: number; text: string } | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const request = net.request(url)
    request.setHeader('User-Agent', 'ServerController')
    const timer = setTimeout(() => request.abort(), timeoutMs)
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => done({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', () => done(null))
    })
    request.on('error', () => done(null))
    request.end()
  })
}

/**
 * Markdown body of a published release (GitHub release notes), or null when
 * the notes can't be fetched (offline, rate-limited, never released).
 */
export async function fetchReleaseNotes(version: string): Promise<string | null> {
  const release = await netFetchText(`${RELEASES_API}/v${version}`, 10000)
  if (!release || release.status !== 200) return null
  try {
    const parsed = JSON.parse(release.text) as { body?: string }
    return parsed.body?.trim() || null
  } catch {
    return null
  }
}
