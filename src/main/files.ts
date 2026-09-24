import { shell } from 'electron'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { FileEntry, FilesInfo, FilesSection, FilesSectionId, ServerProfile } from '../shared/types'
import { copyTree } from './world'
import { serverCwdFor } from './instance'

/**
 * Server file management (mods / config / world datapacks).
 *
 * Managed servers (vanilla/fabric/neoforge/forge) wipe and re-copy mods and
 * config from the client pack on every host — so when a client pack is set,
 * the file manager edits the client pack source, and the run folder inherits
 * the changes on the next host. Without a client pack (and for custom folders)
 * it edits the folder that actually runs.
 */

const SECTION_LABELS: Record<FilesSectionId, string> = {
  mods: 'Mods',
  config: 'Config',
  datapacks: 'Datapacks'
}

/** Names may never contain separators or traverse upward. */
function safeName(name: string): boolean {
  return name.length > 0 && !name.includes('\\') && !name.includes('/') && name !== '.' && name !== '..'
}

/**
 * Folder a section is listed from and mutated in. Mirrors copyClientPack's
 * pack-dir handling: the picker accepts either the instance folder or its
 * mods folder directly.
 */
export function sectionDirFor(
  profile: ServerProfile,
  section: FilesSectionId,
  worldPath: string | null
): { dir: string; warning: string | null } {
  if (section === 'datapacks') {
    if (!worldPath) return { dir: '', warning: null }
    return { dir: join(worldPath, 'datapacks'), warning: null }
  }
  if (profile.kind === 'custom') {
    return { dir: join(profile.customServerDir ?? '', section), warning: null }
  }
  if (profile.clientPackDir) {
    const packDir = profile.clientPackDir
    const base = basename(packDir).toLowerCase() === 'mods' ? dirname(packDir) : packDir
    const dir = section === 'mods' && base !== packDir ? packDir : join(base, section)
    return {
      dir,
      warning:
        section === 'mods'
          ? 'Files here are the client pack source — they are copied into the server on every host.'
          : null
    }
  }
  // No client pack: the run folder is the user's own copy and survives hosts
  // (managed run entries are never junctioned or wiped) — but a client pack
  // added later would overwrite it on the next host.
  const cwd = serverCwdFor(profile, worldPath ?? profile.worlds[0]?.path ?? '')
  return {
    dir: join(cwd, section),
    warning: `No client pack set — files are managed directly in the server run folder. Setting a client pack later will overwrite this folder on the next host.`
  }
}

function listEntries(dir: string): FileEntry[] {
  if (!existsSync(dir)) return []
  const out: FileEntry[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    try {
      const st = statSync(join(dir, item.name))
      out.push({
        name: item.name,
        isDir: item.isDirectory(),
        sizeBytes: item.isDirectory() ? 0 : st.size,
        modifiedAt: st.mtimeMs
      })
    } catch {
      /* unreadable — skip */
    }
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

export function filesInfoFor(profile: ServerProfile, worldPath: string | null): FilesInfo {
  const sections: FilesSection[] = []
  const build = (id: FilesSectionId): void => {
    const { dir, warning } = sectionDirFor(profile, id, worldPath)
    sections.push({
      id,
      label: SECTION_LABELS[id],
      targetDir: dir,
      warning,
      exists: !!dir && existsSync(dir),
      entries: dir ? listEntries(dir) : []
    })
  }
  build('mods')
  build('config')
  if (worldPath) build('datapacks')
  return { serverId: profile.id, worldPath, sections }
}

/** Copy files/folders from anywhere on disk into a section. Returns added names. */
export function addFiles(
  profile: ServerProfile,
  section: FilesSectionId,
  worldPath: string | null,
  sourcePaths: string[]
): string[] {
  const { dir } = sectionDirFor(profile, section, worldPath)
  if (!dir) throw new Error('No folder to add to — attach a world to this server first')
  mkdirSync(dir, { recursive: true })
  const added: string[] = []
  for (const source of sourcePaths) {
    if (!existsSync(source)) continue
    if (source.toLowerCase() === join(dir, basename(source)).toLowerCase()) continue // already there
    const dest = join(dir, basename(source))
    if (lstatSync(source).isDirectory()) {
      copyTree(source, dest) // wipes dest — a re-dropped folder replaces the old copy
    } else {
      copyFileSync(source, dest)
    }
    added.push(basename(source))
  }
  return added
}

export function deleteFile(
  profile: ServerProfile,
  section: FilesSectionId,
  worldPath: string | null,
  name: string
): boolean {
  if (!safeName(name)) throw new Error('Invalid file name')
  const { dir } = sectionDirFor(profile, section, worldPath)
  if (!dir) throw new Error('No folder set up for this section yet')
  const path = join(dir, name)
  if (!existsSync(path)) throw new Error('File not found')
  rmSync(path, { recursive: true, force: true })
  return true
}

/** Open the section folder, or reveal one entry in Explorer. */
export function revealEntry(
  profile: ServerProfile,
  section: FilesSectionId,
  worldPath: string | null,
  name: string | null
): boolean {
  const { dir } = sectionDirFor(profile, section, worldPath)
  if (!dir) return false
  if (name) {
    if (!safeName(name)) throw new Error('Invalid file name')
    const path = join(dir, name)
    if (!existsSync(path)) return false
    shell.showItemInFolder(path)
    return true
  }
  mkdirSync(dir, { recursive: true }) // first reveal creates the folder
  void shell.openPath(dir)
  return true
}
