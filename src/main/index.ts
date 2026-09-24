import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { serverRegistry } from './serverProcess'
import { initUpdater } from './updater'
import { runIntegrityGate } from './integrity'

let mainWindow: BrowserWindow | null = null
let closingRequested = false

function loadRenderer(): void {
  const win = mainWindow
  if (!win) return
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const load = async (): Promise<void> => {
    try {
      if (!app.isPackaged && devUrl) {
        await win.loadURL(devUrl)
      } else {
        await win.loadFile(join(__dirname, '../renderer/index.html'))
      }
    } catch {
      /* transient dev-server race — did-fail-load retries below */
    }
  }
  void load()

  let retries = 0
  win.webContents.on('did-fail-load', (_event, code, _desc, _url, isMain) => {
    if (!isMain || code === -3 /* ERR_ABORTED */ || retries >= 15 || win.isDestroyed()) return
    retries++
    setTimeout(() => void load(), 400)
  })
}

function createWindow(): void {
  let shown = false
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#0e1116',
    show: false,
    autoHideMenuBar: true,
    title: 'ServerController',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    shown = true
    mainWindow?.show()
  })
  // Fallback: never leave the window hidden if the first load is slow or fails.
  setTimeout(() => {
    if (!shown && !mainWindow?.isDestroyed()) mainWindow?.show()
  }, 2500)

  mainWindow.on('close', (event) => {
    if (closingRequested) return
    if (!serverRegistry.busyAny) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: 'Servers still running',
      message: `${serverRegistry.busy().length} Minecraft server${serverRegistry.busy().length > 1 ? 's are' : ' is'} still running.`,
      detail: 'Stop them now? Each world is saved and automatically synced back into your saves folder before the app closes.',
      buttons: ['Stop & close', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    if (choice === 0) requestQuit()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  loadRenderer()
}

function requestQuit(): void {
  if (closingRequested) return
  closingRequested = true
  const finish = (): void => {
    mainWindow?.destroy()
    app.quit()
  }
  if (!serverRegistry.busyAny) {
    finish()
    return
  }
  // Fires once every server has exited AND their automatic sync-backs have
  // finished (the stop listener runs before this one) — the app never quits
  // mid-sync.
  serverRegistry.onceAllStopped(finish)
  serverRegistry.requestStopAll()
  // Safety nets: force-kill stuck process trees, then an absolute ceiling.
  setTimeout(() => serverRegistry.forceKillAll(), 35000)
  setTimeout(() => app.exit(0), 180000)
}

app.whenReady().then(() => {
  // Integrity gate first: a copy whose app.asar doesn't match the official
  // release shows the unofficial-copy warning instead of the app and never
  // initializes the normal IPC surface. Dev runs skip the check.
  void runIntegrityGate().then((integrityOk) => {
    if (!integrityOk) return
    registerIpc(() => mainWindow)
    initUpdater(() => mainWindow)
    createWindow()
    app.on('activate', () => {
      if (integrityOk && BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', (event) => {
  if (!closingRequested && serverRegistry.busyAny) {
    event.preventDefault()
    requestQuit()
  }
})
