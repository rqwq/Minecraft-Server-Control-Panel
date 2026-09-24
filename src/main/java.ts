import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { javaMajorOf } from '../shared/types'
import type { JavaCandidate } from '../shared/types'

function walkFor(root: string, fileName: string, maxDepth: number, out: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName) {
      out.push(full)
    } else if (entry.isDirectory() && maxDepth > 0) {
      walkFor(full, fileName, maxDepth - 1, out)
    }
  }
}

function launcherRuntimeJavaws(): string[] {
  const roots = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Minecraft Launcher', 'runtime'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Minecraft Launcher', 'runtime'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Minecraft Launcher', 'runtime')
  ]
  const found: string[] = []
  for (const root of roots) {
    if (root && existsSync(root)) walkFor(root, 'javaw.exe', 6, found)
  }
  return found
}

function programFilesJavaws(): string[] {
  const roots = [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Java'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Eclipse Adoptium'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft')
  ]
  const found: string[] = []
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name, 'bin', 'javaw.exe')
      if (existsSync(candidate)) found.push(candidate)
    }
  }
  return found
}

function whereExes(name: string): string[] {
  try {
    const stdout = execSync(`where ${name}`, { timeout: 8000, windowsHide: true, encoding: 'utf8' })
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.toLowerCase().endsWith('.exe'))
  } catch {
    return []
  }
}

function probeVersion(javaPath: string): string | null {
  try {
    const res = spawnSync(javaPath, ['-version'], { timeout: 10000, windowsHide: true, encoding: 'utf8' })
    const text = `${res.stderr ?? ''}\n${res.stdout ?? ''}`
    const match = /version "([^"]+)"/.exec(text)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/** Major version from a java -version string: '21.0.3' → 21, '1.8.0_501' → 8. */
export const javaMajor = javaMajorOf

/** javaw.exe prints nothing attachable; prefer the java.exe sibling for probing. */
function probeableExe(javawPath: string): string {
  const javaExe = join(javawPath, '..', 'java.exe')
  return existsSync(javaExe) ? javaExe : javawPath
}

export function detectJava(manualPath: string | null | undefined): JavaCandidate[] {
  const candidates: JavaCandidate[] = []
  const seen = new Set<string>()

  const push = (path: string | null | undefined, source: string): void => {
    if (!path || !existsSync(path)) return
    let real = path
    try {
      real = realpathSync(path)
    } catch {
      /* keep as-is */
    }
    const key = real.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ path: real, version: null, source })
  }

  if (manualPath) push(manualPath, 'Manual override')
  if (process.env['JAVA_HOME']) push(join(process.env['JAVA_HOME'], 'bin', 'javaw.exe'), 'JAVA_HOME')
  for (const p of whereExes('javaw.exe')) push(p, 'PATH')
  for (const p of whereExes('java.exe')) push(p, 'PATH')
  for (const p of launcherRuntimeJavaws()) push(p, 'Minecraft launcher runtime')
  for (const p of programFilesJavaws()) push(p, 'Installed JDK/JRE')

  for (const candidate of candidates) {
    candidate.version = probeVersion(probeableExe(candidate.path))
  }

  // Prefer the newest runtime (modern servers need 17/21+; an old Java 8 on PATH
  // must not win over a newer one). A manual override always stays first.
  const manual = manualPath ? candidates.shift() : null
  candidates.sort((a, b) => javaMajor(b.version) - javaMajor(a.version))
  return manual ? [manual, ...candidates] : candidates
}
