import { app } from 'electron'
import { fetchReleaseNotes } from './github'
import { getStore } from './store'

/**
 * "What's new" detection: the last version the user ran is remembered in the
 * config, so a start on a different (never-seen) version means the app was
 * just updated — that's when the release-notes window pops up.
 */

export interface WhatsNewCheck {
  version: string
  /** True when this launch is the first one on a newly installed version. */
  updated: boolean
  /** GitHub release notes (markdown) for the current version; null when unavailable. */
  notes: string | null
}

export async function checkWhatsNew(): Promise<WhatsNewCheck> {
  const version = app.getVersion()
  const store = getStore()
  const seenBefore = store.get().lastSeenVersion
  const updated = seenBefore !== null && seenBefore !== version
  if (seenBefore !== version) store.patch({ lastSeenVersion: version })
  const notes = updated ? await fetchReleaseNotes(version) : null
  return { version, updated, notes }
}

/** Release notes for an arbitrary version (the update the user skipped). */
export async function notesForVersion(version: string): Promise<string | null> {
  return fetchReleaseNotes(version)
}
