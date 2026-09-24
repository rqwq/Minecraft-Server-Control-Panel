import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { FileEntry, FilesInfo, FilesSectionId, ServerProfile } from '../../../shared/types'
import { formatBytes } from '../../../shared/types'
import { useApp } from '../state/AppState'
import { Banner } from '../components/Banner'
import { ConfirmModal } from '../components/ConfirmModal'
import { Icon } from '../components/Icon'
import { StatusPill } from '../components/StatusPill'

const SECTION_TABS: Array<{ id: FilesSectionId; label: string; sub: string }> = [
  { id: 'mods', label: 'Mods', sub: 'jars copied into the server' },
  { id: 'config', label: 'Config', sub: 'mod and server configuration' },
  { id: 'datapacks', label: 'Datapacks', sub: 'per world, applied on host' }
]

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function worldLabel(profile: ServerProfile, worldPath: string, levelName: string | undefined): string {
  return levelName ?? worldPath.split(/[\\/]/).pop() ?? `${profile.name} world`
}

function FileRow({
  entry,
  onReveal,
  onDelete
}: {
  entry: FileEntry
  onReveal(entry: FileEntry): void
  onDelete(entry: FileEntry): void
}): JSX.Element {
  return (
    <div className="backup-row">
      <div className="backup-row__main">
        <Icon name={entry.isDir ? 'folder' : 'file'} size={15} />
        <span className="backup-row__time mono">{entry.name}</span>
      </div>
      <span className="backup-row__meta">
        {entry.isDir ? 'folder' : formatBytes(entry.sizeBytes)} · {formatWhen(entry.modifiedAt)}
      </span>
      <div className="backup-row__actions">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          title="Show in folder"
          onClick={() => onReveal(entry)}
        >
          <Icon name="folder" size={14} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          title={`Delete this ${entry.isDir ? 'folder' : 'file'}`}
          onClick={() => onDelete(entry)}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}

export function FilesPage(): JSX.Element {
  const { servers, runtime, worldInfos, filesTarget, pushToast } = useApp()

  const [serverId, setServerId] = useState<string | null>(filesTarget.serverId)
  const [worldPath, setWorldPath] = useState<string | null>(filesTarget.worldPath)
  const [section, setSection] = useState<FilesSectionId>(filesTarget.worldPath ? 'datapacks' : 'mods')
  const [info, setInfo] = useState<FilesInfo | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<FileEntry | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)

  const effectiveServerId = serverId && servers.some((s) => s.id === serverId) ? serverId : servers[0]?.id ?? null
  const profile = servers.find((s) => s.id === effectiveServerId) ?? null
  const worldOptions = profile?.worlds ?? []
  const effectiveWorld =
    worldPath && worldOptions.some((w) => w.path === worldPath) ? worldPath : worldOptions[0]?.path ?? null
  const activeSection = info?.sections.find((s) => s.id === section) ?? null

  const state = profile ? (runtime[profile.id]?.state ?? 'stopped') : 'stopped'
  const running = state !== 'stopped' && state !== 'crashed'

  const refresh = useCallback(async (): Promise<void> => {
    if (!effectiveServerId) {
      setInfo(null)
      return
    }
    try {
      setInfo(await window.api.listFiles(effectiveServerId, effectiveWorld))
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
      setInfo(null)
    }
  }, [effectiveServerId, effectiveWorld, pushToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0 || !effectiveServerId || !activeSection) return
    try {
      const added = await window.api.addFiles(effectiveServerId, activeSection.id, effectiveWorld, paths)
      if (added.length > 0) {
        pushToast('success', `Added ${added.length === 1 ? added[0] : `${added.length} files`}`)
      } else {
        pushToast('info', 'Nothing to add — the dropped files are already in this folder')
      }
      void refresh()
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const pathsFromFiles = (files: FileList | null): string[] => {
    const out: string[] = []
    for (const file of Array.from(files ?? [])) {
      try {
        const path = window.api.getPathForFile(file)
        if (path) out.push(path)
      } catch {
        /* item without a disk path — skip */
      }
    }
    return out
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    void addPaths(pathsFromFiles(event.dataTransfer.files))
  }

  const reveal = async (name: string | null): Promise<void> => {
    if (!effectiveServerId || !activeSection) return
    try {
      const opened = await window.api.revealFile(effectiveServerId, activeSection.id, effectiveWorld, name)
      if (!opened) pushToast('info', name ? 'File not found' : 'No folder to open for this section yet')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const doDelete = async (entry: FileEntry): Promise<void> => {
    if (!effectiveServerId || !activeSection) return
    try {
      await window.api.deleteFile(effectiveServerId, activeSection.id, effectiveWorld, entry.name)
      pushToast('success', `Deleted ${entry.name}`)
      void refresh()
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  if (servers.length === 0) {
    return (
      <div className="page page--files">
        <header className="page__header">
          <div>
            <h1 className="page__title">Files</h1>
            <p className="page__subtitle">Create a server first — its mods, config and datapacks are managed here.</p>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="page page--files">
      <header className="page__header">
        <div className="console-header">
          <h1 className="page__title console-title">Files</h1>
          <StatusPill state={state} />
          {profile ? <span className="chip">{profile.name}</span> : null}
        </div>
        <div className="page__actions">
          <label className="field">
            <span className="field__label">Server</span>
            <select
              className="input mono"
              value={effectiveServerId ?? ''}
              onChange={(event) => {
                setServerId(event.target.value || null)
                setWorldPath(null)
              }}
            >
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {running ? (
        <Banner kind="info">
          This server is running — files changed here take effect the next time the server starts.
        </Banner>
      ) : null}

      <div className="profile-tabs profile-tabs--page">
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`profile-tab profile-tab--page ${section === tab.id ? 'profile-tab--active' : ''}`}
            onClick={() => setSection(tab.id)}
          >
            <span className="profile-tab__name">{tab.label}</span>
            <span className="profile-tab__sub">{tab.sub}</span>
          </button>
        ))}
      </div>

      {activeSection?.warning ? <Banner kind="warn">{activeSection.warning}</Banner> : null}

      {!activeSection ? (
        <section className="card">
          <p className="muted">Add a world to this server first — datapacks are managed per world.</p>
        </section>
      ) : (
        <section
          className={`card files-card ${dragActive ? 'files-card--drag' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            dragDepthRef.current++
            setDragActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
            if (dragDepthRef.current === 0) setDragActive(false)
          }}
          onDrop={onDrop}
        >
          <div className="card__head files-card__head">
            <div className="files-card__heading">
              <h2 className="card__title">{activeSection.label}</h2>
              <p className="card__note mono" title={activeSection.targetDir}>
                {activeSection.targetDir}
              </p>
            </div>
            <div className="files-card__actions">
              {section === 'datapacks' && worldOptions.length > 1 ? (
                <label className="field">
                  <span className="field__label">World</span>
                  <select
                    className="input mono"
                    value={effectiveWorld ?? ''}
                    onChange={(event) => setWorldPath(event.target.value || null)}
                  >
                    {worldOptions.map((world) => (
                      <option key={world.path} value={world.path}>
                        {profile ? worldLabel(profile, world.path, worldInfos[world.path]?.levelName) : world.path}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="button" className="btn btn--ghost" onClick={() => void reveal(null)}>
                <Icon name="folder" size={16} />
                Open folder
              </button>
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                <Icon name="upload" size={16} />
                Add files…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  void addPaths(pathsFromFiles(event.target.files))
                  event.target.value = ''
                }}
              />
            </div>
          </div>

          {activeSection.entries.length === 0 ? (
            <div className="files-empty">
              <Icon name="upload" size={22} />
              <p>{activeSection.exists ? 'Empty folder' : 'Folder does not exist yet — the first file added creates it.'}</p>
              <p className="muted">Drag & drop files or folders here, or use Add files…</p>
            </div>
          ) : (
            <div className="backup-list">
              {activeSection.entries.map((entry) => (
                <FileRow
                  key={entry.name}
                  entry={entry}
                  onReveal={(e) => void reveal(e.name)}
                  onDelete={(e) => setDeleteConfirm(e)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {deleteConfirm ? (
        <ConfirmModal
          title={`Delete ${deleteConfirm.isDir ? 'folder' : 'file'}?`}
          message={`${deleteConfirm.name} is removed from ${activeSection?.label ?? 'this section'}. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const entry = deleteConfirm
            setDeleteConfirm(null)
            void doDelete(entry)
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      ) : null}
    </div>
  )
}
