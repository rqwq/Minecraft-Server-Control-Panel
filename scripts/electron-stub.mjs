/**
 * Electron stub for bundling main-process modules that import 'electron'
 * (files.ts needs `shell`, its transitive instance.ts needs `app.getPath`).
 * The userData root is injectable so tests get a throwaway location.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const app = {
  getPath: () => process.env.SC_STUB_USERDATA ?? join(tmpdir(), `sc-stub-${Date.now()}`)
}

export const shell = {
  openPath: async () => '',
  showItemInFolder: () => {}
}
