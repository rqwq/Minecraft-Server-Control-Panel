import { useEffect, useState } from 'react'
import { compareRelease, profileMc } from '../../../shared/types'
import { useApp } from '../state/AppState'
import { Banner } from '../components/Banner'
import { CommandInput } from '../components/CommandInput'
import { Icon } from '../components/Icon'
import { LogView } from '../components/LogView'
import { ProgressBar } from '../components/ProgressBar'
import { StatusPill } from '../components/StatusPill'

const QUICK_COMMANDS = ['list', 'save-all', 'time set day', 'weather clear']
const CUSTOM_COMMANDS_KEY = 'sc-custom-commands'

function loadCustomCommands(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COMMANDS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : []
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []
  } catch {
    return []
  }
}

function saveCustomCommands(commands: string[]): void {
  try {
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(commands))
  } catch {
    /* ignore */
  }
}

/** User-defined quick-command chips, persisted in localStorage. */
function CustomCommandChips({
  disabled,
  onSend
}: {
  disabled: boolean
  onSend(command: string): void
}): JSX.Element {
  const [custom, setCustom] = useState<string[]>(loadCustomCommands)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const command = draft.trim()
    if (command && !custom.includes(command)) {
      const next = [...custom, command]
      setCustom(next)
      saveCustomCommands(next)
    }
    setDraft('')
    setAdding(false)
  }

  const remove = (command: string): void => {
    const next = custom.filter((c) => c !== command)
    setCustom(next)
    saveCustomCommands(next)
  }

  return (
    <>
      {custom.map((command) => (
        <span key={command} className="chip chip--action chip--custom mono">
          <button
            type="button"
            className="chip__command"
            disabled={disabled}
            title={command}
            onClick={() => onSend(command)}
          >
            {command}
          </button>
          <button
            type="button"
            className="chip__remove"
            title="Remove this command chip"
            onClick={() => remove(command)}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="input input--small mono chip__input"
          type="text"
          autoFocus
          placeholder="command, Enter to add"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            } else if (event.key === 'Escape') {
              setAdding(false)
              setDraft('')
            }
          }}
          onBlur={add}
        />
      ) : (
        <button
          type="button"
          className="chip chip--action chip--add"
          disabled={disabled}
          title="Add your own quick command (runs at console permission)"
          onClick={() => setAdding(true)}
        >
          + Add command
        </button>
      )}
    </>
  )
}

export function ServerConsolePage(): JSX.Element {
  const {
    servers,
    runtime,
    worldInfos,
    netInfo,
    settings,
    consoleServerId,
    startBusy,
    setPage,
    openBackups,
    openFiles,
    requestStart,
    stopServer,
    sendCommand,
    pushToast
  } = useApp()

  const profile = servers.find((s) => s.id === consoleServerId) ?? null
  const rt = profile ? (runtime[profile.id] ?? null) : null
  const [restartPending, setRestartPending] = useState(false)
  const [opName, setOpName] = useState('')
  const [worldDraft, setWorldDraft] = useState('')

  const state = rt?.state ?? 'stopped'
  const busy = state !== 'stopped' && state !== 'crashed'
  const starting = profile ? (startBusy[profile.id] ?? false) : false
  const hostedWorldPath = rt?.worldPath ?? null

  useEffect(() => {
    if (restartPending && !busy) {
      setRestartPending(false)
      if (profile && hostedWorldPath) void requestStart(profile.id, hostedWorldPath)
    }
  }, [restartPending, busy, profile, hostedWorldPath, requestStart])

  if (!profile) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1 className="page__title">Console</h1>
            <p className="page__subtitle">Pick a server in the sidebar to open its console.</p>
          </div>
        </header>
      </div>
    )
  }

  const address = rt?.address ?? `${settings.exposeMode === 'custom' && settings.customAddress ? settings.customAddress : netInfo?.lanIp ?? 'localhost'}:${profile.port}`
  const localAddr = rt?.localAddress ?? `localhost:${profile.port}`

  const copyAddress = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      pushToast('success', 'Address copied')
    } catch {
      pushToast('info', `Server address: ${value}`)
    }
  }

  const hostedInfo = hostedWorldPath ? (worldInfos[hostedWorldPath] ?? null) : null
  const hostVersion = profileMc(profile)

  let versionBanner = null
  if (hostedInfo && hostVersion) {
    const cmp = compareRelease(hostVersion, hostedInfo.versionName)
    if (cmp !== null && cmp < 0) {
      versionBanner = (
        <Banner kind="warn">
          Downgrade warning: this world was last played in Minecraft {hostedInfo.versionName}, but this
          server runs {hostVersion}. Loading a world with an older server can permanently corrupt or lose
          data — the copy takes the risk, not your original save.
        </Banner>
      )
    } else if (cmp !== null && cmp > 0) {
      versionBanner = (
        <Banner kind="info">
          The world ({hostedInfo.versionName}) will be upgraded to {hostVersion} the first time the server
          loads it. That one-way upgrade applies to the hosted copy — sync back only if you intend to keep
          it.
        </Banner>
      )
    }
  }

  return (
    <div className="page page--console">
      <header className="page__header">
        <div className="console-header">
          <h1 className="page__title console-title">{profile.name}</h1>
          <StatusPill state={state} />
          <button type="button" className="address-chip mono" onClick={() => void copyAddress(address)} title="Copy address — share it with players on your LAN or VPN (e.g. Radmin)">
            <Icon name="copy" size={14} />
            {address}
          </button>
          {address !== localAddr ? (
            <button type="button" className="address-chip address-chip--local mono" onClick={() => void copyAddress(localAddr)} title="Copy local address">
              <Icon name="copy" size={14} />
              {localAddr}
            </button>
          ) : null}
          {!profile.onlineMode ? <span className="chip chip--offline">offline mode</span> : null}
        </div>
        <div className="page__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => openFiles(profile.id, hostedWorldPath ?? profile.worlds[0]?.path ?? null)}
            title="Manage mods, config and datapacks for this server"
          >
            <Icon name="folder" size={16} />
            Files
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => openBackups(profile.id, hostedWorldPath ?? profile.worlds[0]?.path ?? null)}
            title="Backups and server logs for this server's world"
          >
            <Icon name="archive" size={16} />
            Backups
          </button>
          {!busy ? (
            profile.worlds.length > 0 ? (
              <div className="start-row">
                <select
                  className="input input--small"
                  value={worldDraft || (hostedWorldPath ?? profile.worlds[profile.worlds.length - 1]?.path ?? '')}
                  disabled={starting}
                  onChange={(event) => setWorldDraft(event.target.value)}
                >
                  {profile.worlds.map((world) => {
                    const info = worldInfos[world.path]
                    return (
                      <option key={world.path} value={world.path}>
                        {info?.levelName ?? world.path.split(/[\\/]/).pop() ?? world.path}
                      </option>
                    )
                  })}
                </select>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={starting}
                  onClick={() => {
                    const target = worldDraft || hostedWorldPath || profile.worlds[profile.worlds.length - 1]?.path
                    if (target) void requestStart(profile.id, target)
                  }}
                >
                  <Icon name="play" size={16} />
                  {starting ? 'Preparing…' : state === 'crashed' ? 'Start again' : 'Start'}
                </button>
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setPage('servers')}>
                <Icon name="globe" size={16} />
                Add a world first
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                className="btn btn--danger"
                disabled={state === 'stopping'}
                onClick={() => void stopServer(profile.id)}
              >
                <Icon name="stop" size={16} />
                Stop
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={state !== 'running'}
                onClick={() => {
                  setRestartPending(true)
                  void stopServer(profile.id)
                }}
              >
                <Icon name="refresh" size={16} />
                Restart
              </button>
            </>
          )}
        </div>
      </header>

      {rt?.jarProgress ? (
        <ProgressBar label={`Downloading ${rt.jarProgress.label}`} value={rt.jarProgress.received} max={rt.jarProgress.total} />
      ) : null}
      {rt?.worldProgress ? (
        <ProgressBar
          label="Preparing server"
          value={rt.worldProgress.bytes}
          max={rt.worldProgress.totalBytes}
          detail={`${rt.worldProgress.files}/${rt.worldProgress.totalFiles} files — ${rt.worldProgress.label}`}
        />
      ) : null}

      <Banner kind="info">
        Commands run at server-console permission (<strong>op level 4</strong>) — they work even when cheats
        are disabled in the world. Share <span className="mono">{address}</span> with players on your LAN
        or VPN (Radmin): the server listens on all network interfaces.
      </Banner>
      {versionBanner}
      {profile.kind === 'custom' ? (
        <Banner kind="warn">
          Custom server folder mode: this server runs inside{' '}
          <span className="mono">{profile.customServerDir}</span>. ServerController only manages{' '}
          <code>world/</code>, <code>server.properties</code> and <code>eula.txt</code> there — make sure
          your loader and mods match this world. Only one server can use a given custom folder at a time.
        </Banner>
      ) : profile.clientPackDir ? (
        <Banner kind="info">
          Client pack copied from <span className="mono">{profile.clientPackDir}</span> — mods, config,
          defaultconfigs and kubejs are refreshed on every host.
        </Banner>
      ) : null}

      <div className="console-body">
        <LogView logs={rt?.logs ?? []} />
        <div className="console-controls">
          <CommandInput disabled={state !== 'running'} onSend={(command) => void sendCommand(profile.id, command)} />
          <div className="quick-row">
            {QUICK_COMMANDS.map((command) => (
              <button
                key={command}
                type="button"
                className="chip chip--action mono"
                disabled={state !== 'running'}
                onClick={() => void sendCommand(profile.id, command)}
              >
                {command}
              </button>
            ))}
            <CustomCommandChips
              disabled={state !== 'running'}
              onSend={(command) => void sendCommand(profile.id, command)}
            />
            <div className="quick-op">
              <input
                className="input input--small mono"
                type="text"
                placeholder="player"
                value={opName}
                disabled={state !== 'running'}
                onChange={(event) => setOpName(event.target.value)}
              />
              <button
                type="button"
                className="chip chip--action"
                disabled={state !== 'running' || opName.trim().length === 0}
                onClick={() => void sendCommand(profile.id, `op ${opName.trim()}`)}
              >
                op
              </button>
              <button
                type="button"
                className="chip chip--action"
                disabled={state !== 'running' || opName.trim().length === 0}
                onClick={() => void sendCommand(profile.id, `gamemode creative ${opName.trim()}`)}
              >
                gamemode creative
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
