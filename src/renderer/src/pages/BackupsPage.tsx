import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, ServerLogContent, ServerLogFile } from '../../../shared/types'
import { formatBytes } from '../../../shared/types'
import { useApp } from '../state/AppState'
import { Banner } from '../components/Banner'
import { ConfirmModal } from '../components/ConfirmModal'
import { Icon } from '../components/Icon'

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function BackupRow({ backup, onRestore, onDelete }: { backup: BackupInfo; onRestore(b: BackupInfo): void; onDelete(b: BackupInfo): void }): JSX.Element {
  return (
    <div className={`backup-row ${backup.crashed ? 'backup-row--crashed' : ''}`}>
      <div className="backup-row__main">
        <span className="backup-row__time mono">{formatWhen(backup.createdAt)}</span>
        {backup.crashed ? <span className="chip chip--crashed">crashed session</span> : null}
        {backup.kind === 'hourly' ? <span className="chip">hot snapshot</span> : null}
      </div>
      <span className="backup-row__meta">
        {backup.files} files · {formatBytes(backup.sizeBytes)}
      </span>
      <div className="backup-row__actions">
        <button type="button" className="btn btn--small" onClick={() => onRestore(backup)}>
          <Icon name="sync" size={14} />
          Restore
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          title="Delete this backup"
          onClick={() => onDelete(backup)}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}

export function BackupsPage(): JSX.Element {
  const { servers, worldInfos, backupsTarget, refreshWorldInfo, pushToast } = useApp()

  const [tab, setTab] = useState<'backups' | 'logs'>('backups')
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [selectedWorld, setSelectedWorld] = useState<string | null>(backupsTarget.worldPath)
  const [restoreConfirm, setRestoreConfirm] = useState<BackupInfo | null>(null)
  const [stopPrompt, setStopPrompt] = useState<BackupInfo | null>(null)
  const [stopNames, setStopNames] = useState<string[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<BackupInfo | null>(null)
  const [logsServerId, setLogsServerId] = useState<string | null>(backupsTarget.serverId)
  const [logFiles, setLogFiles] = useState<ServerLogFile[] | null>(null)
  const [logView, setLogView] = useState<ServerLogContent | null>(null)

  // Every world known to the app, plus worlds that only exist in backups.
  const worldOptions: Array<{ path: string; label: string }> = (() => {
    const seen = new Set<string>()
    const out: Array<{ path: string; label: string }> = []
    for (const server of servers) {
      for (const world of server.worlds) {
        if (seen.has(world.path)) continue
        seen.add(world.path)
        const name = worldInfos[world.path]?.levelName ?? world.path.split(/[\\/]/).pop() ?? world.path
        out.push({ path: world.path, label: `${name} (${server.name})` })
      }
    }
    for (const backup of backups ?? []) {
      if (seen.has(backup.worldPath)) continue
      seen.add(backup.worldPath)
      out.push({ path: backup.worldPath, label: `${backup.worldPath.split(/[\\/]/).pop() ?? backup.worldPath} (unassigned)` })
    }
    return out
  })()

  const effectiveWorld =
    selectedWorld && worldOptions.some((w) => w.path === selectedWorld)
      ? selectedWorld
      : worldOptions[0]?.path ?? null

  const refreshBackups = useCallback(async (): Promise<void> => {
    try {
      setBackups(await window.api.listBackups())
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
      setBackups([])
    }
  }, [pushToast])

  useEffect(() => {
    void refreshBackups()
  }, [refreshBackups])

  const refreshLogFiles = useCallback(async (serverId: string | null): Promise<void> => {
    if (!serverId) {
      setLogFiles([])
      return
    }
    try {
      setLogFiles(await window.api.serverLogFiles(serverId))
    } catch {
      setLogFiles([])
    }
  }, [])

  useEffect(() => {
    if (tab === 'logs') void refreshLogFiles(logsServerId ?? servers[0]?.id ?? null)
  }, [tab, logsServerId, servers, refreshLogFiles])

  const worldBackups = (backups ?? []).filter((b) => b.worldPath === effectiveWorld)
  const launchBackups = worldBackups.filter((b) => b.kind === 'launch')
  const hourlyBackups = worldBackups.filter((b) => b.kind === 'hourly')

  const finishRestore = async (backup: BackupInfo, stopServers: boolean): Promise<void> => {
    if (!effectiveWorld) return
    try {
      const result = await window.api.restoreBackup(backup.worldPath, backup.id, stopServers)
      if (result.ok) {
        pushToast('success', 'Backup restored into your saves folder')
        void refreshBackups()
        void refreshWorldInfo(backup.worldPath)
      } else if (result.needsStop) {
        setStopNames(result.runningServers ?? [])
        setStopPrompt(backup)
      } else if (result.error) {
        pushToast('error', result.error)
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const viewLog = async (file: ServerLogFile): Promise<void> => {
    try {
      setLogView(await window.api.readServerLog(file.serverId, file.name))
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const openLogsFolder = async (): Promise<void> => {
    const id = logsServerId ?? servers[0]?.id
    if (!id) return
    try {
      const opened = await window.api.openLogsFolder(id)
      if (!opened) pushToast('info', 'No logs folder yet — host the server once first')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="page page--backups">
      <header className="page__header">
        <div>
          <h1 className="page__title">Backups</h1>
          <p className="page__subtitle">
            Restore points for corrupted sessions: the world before every server launch (newest 2), and a
            hot snapshot every hour while a server runs (newest 3).
          </p>
        </div>
        <div className="page__actions">
          <div className="profile-tabs profile-tabs--page">
            <button
              type="button"
              className={`profile-tab profile-tab--page ${tab === 'backups' ? 'profile-tab--active' : ''}`}
              onClick={() => setTab('backups')}
            >
              <span className="profile-tab__name">Backups</span>
              <span className="profile-tab__sub">restore points</span>
            </button>
            <button
              type="button"
              className={`profile-tab profile-tab--page ${tab === 'logs' ? 'profile-tab--active' : ''}`}
              onClick={() => setTab('logs')}
            >
              <span className="profile-tab__name">Server logs</span>
              <span className="profile-tab__sub">latest · debug · crash reports</span>
            </button>
          </div>
        </div>
      </header>

      {tab === 'backups' ? (
        <>
          <div className="backups-toolbar">
            <label className="field">
              <span className="field__label">World</span>
              <select
                className="input mono"
                value={effectiveWorld ?? ''}
                onChange={(event) => setSelectedWorld(event.target.value || null)}
              >
                {worldOptions.length === 0 ? <option value="">No worlds yet</option> : null}
                {worldOptions.map((world) => (
                  <option key={world.path} value={world.path}>
                    {world.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!effectiveWorld ? (
            <section className="card">
              <p className="muted">Add a world to a server first — backups appear after its first host.</p>
            </section>
          ) : (
            <>
              <section className="card">
                <h2 className="card__title">Server launch</h2>
                <p className="card__note">The world exactly as it was before each host — the state to restore after a corrupted session. Newest 2 kept.</p>
                <div className="backup-list">
                  {launchBackups.length === 0 ? (
                    <p className="muted">No launch backups yet — they are created every time this world is hosted.</p>
                  ) : (
                    launchBackups.map((backup) => (
                      <BackupRow
                        key={backup.id}
                        backup={backup}
                        onRestore={(b) => setRestoreConfirm(b)}
                        onDelete={(b) => setDeleteConfirm(b)}
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="card">
                <h2 className="card__title">Hourly (while running)</h2>
                <p className="card__note">Taken every hour while the server runs, after a save-all flush. Newest 3 kept.</p>
                <div className="backup-list">
                  {hourlyBackups.length === 0 ? (
                    <p className="muted">No hourly backups yet — the server must run for an hour to produce one.</p>
                  ) : (
                    hourlyBackups.map((backup) => (
                      <BackupRow
                        key={backup.id}
                        backup={backup}
                        onRestore={(b) => setRestoreConfirm(b)}
                        onDelete={(b) => setDeleteConfirm(b)}
                      />
                    ))
                  )}
                </div>
              </section>

              <Banner kind="info">
                Backups are deduplicated on disk: unchanged files are shared between snapshots, so each
                backup costs roughly only what changed since the previous one. Restoring replaces the
                saves folder (a level.dat backup of the replaced world is kept inside it).
              </Banner>
            </>
          )}
        </>
      ) : (
        <section className="card">
          <div className="card__head">
            <label className="field">
              <span className="field__label">Server</span>
              <select
                className="input mono"
                value={logsServerId ?? servers[0]?.id ?? ''}
                onChange={(event) => setLogsServerId(event.target.value || null)}
              >
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => void openLogsFolder()}>
              <Icon name="folder" size={16} />
              Open logs folder
            </button>
          </div>
          {logFiles === null ? (
            <p className="muted">Reading…</p>
          ) : logFiles.length === 0 ? (
            <p className="muted">
              No log files yet — they appear after the server has been hosted at least once.
            </p>
          ) : (
            <div className="backup-list">
              {logFiles.map((file) => (
                <div key={file.name} className="backup-row">
                  <div className="backup-row__main">
                    <Icon name="file" size={15} />
                    <span className="backup-row__time mono">{file.name}</span>
                  </div>
                  <span className="backup-row__meta">
                    {formatBytes(file.sizeBytes)} · {formatWhen(file.modifiedAt)}
                  </span>
                  <div className="backup-row__actions">
                    <button type="button" className="btn btn--small" onClick={() => void viewLog(file)}>
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {restoreConfirm ? (
        <ConfirmModal
          title="Restore this backup?"
          message={`The current world folder is replaced with the backup from ${formatWhen(restoreConfirm.createdAt)} (the old level.dat is kept as a backup inside the folder). Any progress made after that point is lost.`}
          confirmLabel="Restore"
          onConfirm={() => {
            const backup = restoreConfirm
            setRestoreConfirm(null)
            void finishRestore(backup, false)
          }}
          onCancel={() => setRestoreConfirm(null)}
        />
      ) : null}

      {stopPrompt ? (
        <ConfirmModal
          title="Server is running"
          message={`${(stopNames.length > 0 ? stopNames : ['The server']).join(', ')} must be stopped before the backup can be restored. Stop it now and restore? (The world is saved first.)`}
          confirmLabel="Stop & restore"
          onConfirm={() => {
            const backup = stopPrompt
            setStopPrompt(null)
            void finishRestore(backup, true)
          }}
          onCancel={() => setStopPrompt(null)}
        />
      ) : null}

      {deleteConfirm ? (
        <ConfirmModal
          title="Delete this backup?"
          message={`The snapshot from ${formatWhen(deleteConfirm.createdAt)} is removed. Files shared with newer backups stay intact.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const backup = deleteConfirm
            setDeleteConfirm(null)
            void window.api
              .deleteBackup(backup.worldPath, backup.id)
              .then(() => refreshBackups())
              .catch((err: unknown) => pushToast('error', err instanceof Error ? err.message : String(err)))
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      ) : null}

      {logView ? (
        <div className="modal-overlay" onClick={() => setLogView(null)}>
          <div className="modal modal--wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head-row">
              <h2 className="modal__title mono">{logView.name}</h2>
              <button type="button" className="btn btn--ghost" onClick={() => setLogView(null)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            {logView.truncated ? (
              <p className="modal__note">Large file — showing only the last 256 KB.</p>
            ) : null}
            <pre className="backup-log-viewer">{logView.text}</pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
