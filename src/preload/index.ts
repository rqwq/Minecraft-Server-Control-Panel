import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { RendererApi } from '../shared/api'
import type {
  ScopedJarProgress,
  ScopedWorldProgress,
  ServerLogEvent,
  ServerStateEvent,
  UpdateStateEvent
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: RendererApi = {
  selectWorld: () => ipcRenderer.invoke('dialog:selectWorld'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickJava: () => ipcRenderer.invoke('java:pick'),
  detectJava: () => ipcRenderer.invoke('java:detect'),
  netInfo: () => ipcRenderer.invoke('net:info'),
  worldInfo: (path) => ipcRenderer.invoke('world:info', path),
  saveLevel: (path, edits) => ipcRenderer.invoke('world:saveLevel', path, edits),
  syncBack: (serverId, path) => ipcRenderer.invoke('world:syncBack', serverId, path),
  listServers: () => ipcRenderer.invoke('servers:list'),
  createServer: (name) => ipcRenderer.invoke('server:create', name),
  updateServer: (id, patch) => ipcRenderer.invoke('server:update', id, patch),
  deleteServer: (id) => ipcRenderer.invoke('server:delete', id),
  addWorld: (serverId, path) => ipcRenderer.invoke('server:addWorld', serverId, path),
  createWorld: (serverId, name, seed, savesDir) =>
    ipcRenderer.invoke('server:createWorld', serverId, name, seed, savesDir),
  removeWorld: (serverId, path) => ipcRenderer.invoke('server:removeWorld', serverId, path),
  startServer: (serverId, worldPath) => ipcRenderer.invoke('server:start', serverId, worldPath),
  stopServer: (serverId) => ipcRenderer.invoke('server:stop', serverId),
  sendCommand: (serverId, command) => ipcRenderer.invoke('server:send', serverId, command),
  serverStatus: (serverId) => ipcRenderer.invoke('server:status', serverId),
  statusAll: () => ipcRenderer.invoke('servers:statusAll'),
  vanillaVersions: () => ipcRenderer.invoke('jar:vanillaVersions'),
  fabricVersions: () => ipcRenderer.invoke('jar:fabricVersions'),
  loaderVersions: (kind) => ipcRenderer.invoke('loader:versions', kind),
  loaderStatus: (kind, version) => ipcRenderer.invoke('loader:status', kind, version),
  listInstalledLoaders: () => ipcRenderer.invoke('loader:list'),
  removeLoader: (kind, version) => ipcRenderer.invoke('loader:remove', kind, version),
  ensureLoader: (kind, version, serverId) => ipcRenderer.invoke('loader:ensure', kind, version, serverId),
  ensureJar: (kind, a, b, serverId) => ipcRenderer.invoke('jar:ensure', kind, a, b, serverId),
  customInspect: (dir) => ipcRenderer.invoke('custom:inspect', dir),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (worldPath, backupId, stopServers) =>
    ipcRenderer.invoke('backups:restore', worldPath, backupId, stopServers),
  deleteBackup: (worldPath, backupId) => ipcRenderer.invoke('backups:delete', worldPath, backupId),
  serverLogFiles: (serverId) => ipcRenderer.invoke('serverlogs:list', serverId),
  readServerLog: (serverId, name) => ipcRenderer.invoke('serverlogs:read', serverId, name),
  openLogsFolder: (serverId) => ipcRenderer.invoke('serverlogs:openFolder', serverId),
  listFiles: (serverId, worldPath) => ipcRenderer.invoke('files:list', serverId, worldPath),
  addFiles: (serverId, section, worldPath, sourcePaths) =>
    ipcRenderer.invoke('files:add', serverId, section, worldPath, sourcePaths),
  deleteFile: (serverId, section, worldPath, name) =>
    ipcRenderer.invoke('files:delete', serverId, section, worldPath, name),
  revealFile: (serverId, section, worldPath, name) =>
    ipcRenderer.invoke('files:reveal', serverId, section, worldPath, name),
  getPathForFile: (file) => webUtils.getPathForFile(file as File),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  acceptEula: () => ipcRenderer.invoke('eula:accept'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openRepo: () => ipcRenderer.invoke('util:openRepo'),
  copyDiscord: () => ipcRenderer.invoke('util:copyDiscord'),
  openUrl: (url) => ipcRenderer.invoke('util:openUrl', url),
  whatsNewCheck: () => ipcRenderer.invoke('whatsnew:check'),
  releaseNotes: (version) => ipcRenderer.invoke('whatsnew:notes', version),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (prerelease?: boolean) => ipcRenderer.invoke('update:download', prerelease),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onServerLog: (callback) => subscribe<ServerLogEvent>('server:log', callback),
  onServerState: (callback) => subscribe<ServerStateEvent>('server:state', callback),
  onJarProgress: (callback) => subscribe<ScopedJarProgress>('jar:progress', callback),
  onWorldProgress: (callback) => subscribe<ScopedWorldProgress>('world:progress', callback),
  onUpdateState: (callback) => subscribe<UpdateStateEvent>('update:state', callback)
}

contextBridge.exposeInMainWorld('api', api)
