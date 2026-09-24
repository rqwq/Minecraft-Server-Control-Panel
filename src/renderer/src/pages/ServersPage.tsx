import { useState } from 'react'
import { formatBytes } from '../../../shared/types'
import type { ServerProfile, WorldInfo } from '../../../shared/types'
import { useApp } from '../state/AppState'
import { Banner } from '../components/Banner'
import { ConfirmModal } from '../components/ConfirmModal'
import { Icon } from '../components/Icon'
import { NewWorldModal } from '../components/NewWorldModal'
import { StatusPill } from '../components/StatusPill'
import { WorldEditModal } from '../components/WorldEditModal'
import { Field } from '../components/Field'

function kindLabel(profile: ServerProfile): string {
  switch (profile.kind) {
    case 'vanilla':
      return profile.vanillaVersion ? `Vanilla ${profile.vanillaVersion}` : 'Vanilla'
    case 'fabric':
      return profile.fabricGame ? `Fabric ${profile.fabricGame}` : 'Fabric'
    case 'neoforge':
      return profile.neoforgeVersion ? `NeoForge ${profile.neoforgeVersion}` : 'NeoForge'
    case 'forge':
      return profile.forgeVersion ? `Forge ${profile.forgeVersion}` : 'Forge'
    default:
      return 'Custom server folder'
  }
}

function NewServerModal({ busy, onCreate, onCancel }: { busy: boolean; onCreate(name: string): void; onCancel(): void }): JSX.Element {
  const [name, setName] = useState('New server')
  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-server-title">
        <div className="modal__icon">
          <Icon name="terminal" size={22} />
        </div>
        <h2 id="new-server-title" className="modal__title">
          Create a server
        </h2>
        <p className="modal__text">
          A complete server: pick its source (vanilla, Fabric, NeoForge, Forge or a custom folder) in
          Settings, add worlds to it, and run several servers side by side.
        </p>
        <div className="form">
          <Field label="Server name">
            <input
              className="input"
              type="text"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !name.trim()}
            onClick={() => onCreate(name.trim())}
          >
            <Icon name="check" size={16} />
            Create server
          </button>
        </div>
      </div>
    </div>
  )
}

function WorldRow({
  profile,
  worldPath,
  info,
  error,
  busy,
  hostedHere
}: {
  profile: ServerProfile
  worldPath: string
  info: WorldInfo | null
  error: string | null
  busy: boolean
  hostedHere: boolean
}): JSX.Element {
  const { runtime, requestStart, stopServer, syncBack, removeWorld, saveEdits, openConsole, openBackups } = useApp()
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const name = info?.levelName ?? worldPath.split(/[\\/]/).pop() ?? worldPath
  const rt = runtime[profile.id]
  const state = rt?.state ?? 'stopped'

  const subtitle = error
    ? 'Folder unreadable'
    : info?.isNewWorld
      ? 'New world — generated on first host'
      : info?.missingLevelDat
        ? 'level.dat missing — Sync back can restore it'
        : info
          ? `${info.versionName} · ${formatBytes(info.folderSizeBytes)}${info.playerCount > 0 ? ` · ${info.playerCount} player(s)` : ''}`
          : 'Reading world…'

  const handleSave = async (edits: Parameters<typeof saveEdits>[1]): Promise<boolean> => saveEdits(worldPath, edits)

  return (
    <div className={`world-row ${hostedHere ? 'world-row--hosted' : ''}`}>
      <div className="world-row__main">
        <div className="world-row__title">
          <span className="world-row__name">{name}</span>
          {hostedHere ? <StatusPill state={state} /> : null}
        </div>
        <span className="world-row__sub mono" title={worldPath}>
          {subtitle} · {worldPath}
        </span>
      </div>
      <div className="world-row__actions">
        {!hostedHere ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={busy}
            title="Host this world on this server"
            onClick={() => void requestStart(profile.id, worldPath)}
          >
            <Icon name="play" size={14} />
            Host
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--small"
            disabled={state === 'stopping'}
            onClick={() => void stopServer(profile.id)}
          >
            <Icon name="stop" size={14} />
            Stop
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={hostedHere}
          onClick={() => setEditing(true)}
          title="View and edit world data"
        >
          <Icon name="globe" size={14} />
          Edit
        </button>
        {hostedHere ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => openConsole(profile.id)}
            title="Open this server's console"
          >
            <Icon name="terminal" size={14} />
            Console
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => openBackups(profile.id, worldPath)}
          title="Backups and server logs for this world"
        >
          <Icon name="archive" size={14} />
          Backups
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={hostedHere}
          title={hostedHere ? 'Stop the server first' : 'Remove this world from the server (folder is kept)'}
          onClick={() => setConfirmRemove(true)}
        >
          <Icon name="x" size={14} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={hostedHere}
          title={hostedHere ? 'Stop the server first' : 'Copy the played world back into your saves folder (rarely needed — it happens automatically on stop)'}
          onClick={() => void syncBack(profile.id, worldPath)}
        >
          <Icon name="sync" size={14} />
          Sync back
        </button>
      </div>

      {rt?.worldProgress ? <div className="world-row__note">{rt.worldProgress.label}…</div> : null}

      {editing && info ? (
        <WorldEditModal info={info} locked={hostedHere} onSave={handleSave} onClose={() => setEditing(false)} />
      ) : null}
      {confirmRemove ? (
        <ConfirmModal
          title="Remove world from server?"
          message={`"${name}" stays on disk untouched — it is only removed from this server's world list.`}
          confirmLabel="Remove"
          onConfirm={() => {
            setConfirmRemove(false)
            void removeWorld(profile.id, worldPath)
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      ) : null}
    </div>
  )
}

function ServerCard({ profile }: { profile: ServerProfile }): JSX.Element {
  const { runtime, worldInfos, worldErrors, settings, addWorld, createWorld, deleteServer, setPage, startBusy } =
    useApp()
  const [creatingWorld, setCreatingWorld] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const rt = runtime[profile.id]
  const state = rt?.state ?? 'stopped'
  const busy = state !== 'stopped' && state !== 'crashed'
  const starting = startBusy[profile.id] ?? false
  const hostedWorldPath = rt?.worldPath ?? null
  const noVersion =
    (profile.kind === 'vanilla' && !profile.vanillaVersion) ||
    (profile.kind === 'fabric' && (!profile.fabricGame || !profile.fabricLoader)) ||
    (profile.kind === 'neoforge' && !profile.neoforgeVersion) ||
    (profile.kind === 'forge' && !profile.forgeVersion) ||
    (profile.kind === 'custom' && !profile.customServerDir)

  return (
    <section className="card server-card">
      <header className="server-card__head">
        <div className="server-card__title">
          <h2 className="card__title">{profile.name}</h2>
          <span className="chip">{kindLabel(profile)}</span>
          <StatusPill state={state} />
        </div>
        <div className="server-card__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setPage('settings')} title="Configure in Settings">
            <Icon name="settings" size={14} />
            Configure
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy}
            title={busy ? 'Stop the server first' : 'Delete this server (world folders are kept)'}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </header>

      <div className="server-card__meta">
        <span className="mono">localhost:{profile.port}</span>
        <span>{profile.memoryGb} GB RAM</span>
        <span>{profile.onlineMode ? 'online mode' : 'offline mode'}</span>
        {profile.clientPackDir ? <span title={profile.clientPackDir}>client pack ✓</span> : null}
      </div>

      {noVersion ? (
        <Banner kind="warn">
          This server has no source configured yet — pick a version or folder in <strong>Settings</strong>.
        </Banner>
      ) : null}

      <div className="server-card__worlds">
        {profile.worlds.length === 0 ? (
          <p className="muted server-card__empty">No worlds yet — add one from your saves or create a new one.</p>
        ) : (
          profile.worlds.map((world) => (
            <WorldRow
              key={world.path}
              profile={profile}
              worldPath={world.path}
              info={worldInfos[world.path] ?? null}
              error={worldErrors[world.path] ?? null}
              busy={busy || starting}
              hostedHere={busy && hostedWorldPath === world.path}
            />
          ))
        )}
      </div>

      <div className="server-card__footer">
        <div className="server-card__addworld">
          <button type="button" className="btn btn--small" disabled={starting} onClick={() => void addWorld(profile.id)}>
            <Icon name="folder" size={14} />
            Add world…
          </button>
          <button type="button" className="btn btn--small" disabled={starting} onClick={() => setCreatingWorld(true)}>
            <Icon name="zap" size={14} />
            Create new world…
          </button>
        </div>
      </div>

      {creatingWorld ? (
        <NewWorldModal
          busy={false}
          savesDirs={settings.savesDirHistory}
          defaultDir={settings.mcSavesDir}
          onCreate={async (name, seed, savesDir) => {
            const ok = await createWorld(profile.id, name, seed, savesDir)
            if (ok) setCreatingWorld(false)
            return ok
          }}
          onCancel={() => setCreatingWorld(false)}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmModal
          title={`Delete "${profile.name}"?`}
          message="The server configuration is removed. World folders stay on disk; hosted copies stay in the app data folder."
          confirmLabel="Delete server"
          onConfirm={() => {
            setConfirmDelete(false)
            void deleteServer(profile.id)
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </section>
  )
}

export function ServersPage(): JSX.Element {
  const { servers, createServer, settings, startBusy } = useApp()
  const [showNewServer, setShowNewServer] = useState(false)
  const anyStarting = Object.values(startBusy).some(Boolean)

  return (
    <div className="page page--servers">
      <header className="page__header">
        <div>
          <h1 className="page__title">Servers & Worlds</h1>
          <p className="page__subtitle">
            Each server is a complete setup — source, port, memory and its own worlds. Several servers can
            run at the same time; every server has its own console.
          </p>
        </div>
        <div className="page__actions">
          <button type="button" className="btn btn--primary btn--big" onClick={() => setShowNewServer(true)}>
            <Icon name="terminal" size={16} />
            New server…
          </button>
        </div>
      </header>

      {servers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="terminal" size={34} />
          </div>
          <h2 className="empty-state__title">No servers yet</h2>
          <p className="empty-state__text">
            Create a server, configure its source in Settings, then add worlds from{' '}
            <span className="mono">{settings.mcSavesDir ?? 'your .minecraft saves folder'}</span> or create new ones.
          </p>
          <button type="button" className="btn btn--primary btn--big" onClick={() => setShowNewServer(true)}>
            <Icon name="terminal" size={16} />
            Create your first server…
          </button>
        </div>
      ) : (
        <div className="servers-list">
          {servers.map((profile) => (
            <ServerCard key={profile.id} profile={profile} />
          ))}
        </div>
      )}

      {showNewServer ? (
        <NewServerModal
          busy={anyStarting}
          onCreate={(name) => {
            setShowNewServer(false)
            void createServer(name)
          }}
          onCancel={() => setShowNewServer(false)}
        />
      ) : null}
    </div>
  )
}
