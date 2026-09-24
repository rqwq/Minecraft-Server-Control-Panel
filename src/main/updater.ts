import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStateEvent } from '../shared/types'
import { serverRegistry } from './serverProcess'

export const REPO_URL = 'https://github.com/rqwq/Minecraft-Server-Control-Panel'
export const DISCORD_USERNAME = '.extremism'

let sendState: ((payload: UpdateStateEvent) => void) | null = null
let checking = false
let downloading = false

/**
 * Auto-update for packaged (installed) builds only — `npm run dev` never
 * checks and the renderer never shows the update UI there.
 *
 * Updates come from GitHub Releases of rqwq/Minecraft-Server-Control-Panel.
 * CI publishes every push to a release* branch as a pre-release ("Preview");
 * allowPrerelease=false means installed apps only ever see releases that
 * have been manually promoted to a full release.
 */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return

  sendState = (payload: UpdateStateEvent): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update:state', payload)
  }

  autoUpdater.autoDownload = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => sendState?.({ phase: 'checking' }))
  autoUpdater.on('download-progress', (progress) =>
    sendState?.({
      phase: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        speed: progress.bytesPerSecond
      }
    })
  )
  autoUpdater.on('update-downloaded', (info) => {
    downloading = false
    autoUpdater.allowPrerelease = false
    sendState?.({ phase: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    checking = false
    downloading = false
    sendState?.({ phase: 'error', message: err instanceof Error ? err.message : 'Update check failed' })
  })
}

/** Ask GitHub for the newest promoted release. Results arrive via update:state events. */
export async function checkForUpdate(): Promise<void> {
  if (!app.isPackaged || checking) return
  checking = true
  try {
    autoUpdater.allowPrerelease = false
    const stable = await autoUpdater.checkForUpdates()
    if (stable?.isUpdateAvailable) {
      sendState?.({ phase: 'available', version: stable.updateInfo.version })
      return
    }
    autoUpdater.allowPrerelease = true
    const pre = await autoUpdater.checkForUpdates()
    sendState?.(
      pre?.isUpdateAvailable
        ? { phase: 'prerelease-available', version: pre.updateInfo.version }
        : { phase: 'none' }
    )
  } catch {
    // swallowed on purpose: the autoUpdater 'error' event already told the
    // renderer, and an unhandled rejection here would echo into the IPC log
  } finally {
    autoUpdater.allowPrerelease = false
    checking = false
  }
}

/** Download the found update (started only by an explicit user click). */
export async function downloadUpdate(prerelease = false): Promise<void> {
  if (!app.isPackaged || downloading) return
  downloading = true
  autoUpdater.allowPrerelease = prerelease
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    downloading = false
    // the autoUpdater 'error' event already reported the failure to the renderer
  }
}

/**
 * Quit and run the installer. Refuses while any Minecraft server is running
 * so a world is never killed mid-update.
 */
export async function installUpdate(): Promise<void> {
  if (!app.isPackaged) return
  if (serverRegistry.busyAny) throw new Error('Stop the running server(s) before installing the update')
  autoUpdater.quitAndInstall()
}
