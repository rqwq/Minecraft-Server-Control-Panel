import { useCallback, useEffect, useState } from 'react'
import type { CustomInspectResult, InstalledLoader, LoaderKind, LoaderVersionList, ServerKind, ServerProfile } from '../../../shared/types'
import { forgeMc, javaMajorOf, neoforgeMc, profileMc, requiredJavaMajor } from '../../../shared/types'
import { useApp } from '../state/AppState'
import { Banner } from '../components/Banner'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'

const SERVER_KINDS: Array<{ id: ServerKind; label: string; description: string }> = [
  { id: 'vanilla', label: 'Vanilla', description: 'Official Mojang server.jar — downloaded and cached automatically.' },
  { id: 'fabric', label: 'Fabric', description: 'Fabric server launcher jar — downloaded from meta.fabricmc.net.' },
  {
    id: 'neoforge',
    label: 'NeoForge',
    description: 'Installer downloaded and run for you, then reused. Bring mods via the client pack folder.'
  },
  {
    id: 'forge',
    label: 'Forge',
    description: 'Installer downloaded and run for you, then reused. Bring mods via the client pack folder.'
  },
  { id: 'custom', label: 'Custom server folder', description: 'Your installed modded server runs in place — nothing is managed for you.' }
]

function LoaderPanel({
  kind,
  list,
  value,
  onPick
}: {
  kind: LoaderKind
  list: LoaderVersionList | null
  value: string | null
  onPick(version: string): void
}): JSX.Element {
  const mcOf = kind === 'neoforge' ? neoforgeMc : forgeMc
  const mc = value ? mcOf(value) : null
  const group = (list?.groups ?? []).find((g) => g.mc === mc) ?? null

  const pickGroup = (targetMc: string): void => {
    const g = list?.groups.find((x) => x.mc === targetMc)
    const build = g?.builds.find((b) => !b.prerelease) ?? g?.builds[0]
    if (build) onPick(build.version)
  }

  return (
    <div className="kind-panel kind-panel--two">
      <Field label="Game version" hint={kind === 'neoforge' ? 'The newest builds may be marked (beta).' : undefined}>
        <select className="input" value={mc ?? ''} disabled={!list} onChange={(event) => pickGroup(event.target.value)}>
          {!list ? <option value="">Loading…</option> : null}
          {(list?.groups ?? []).map((g) => (
            <option key={g.mc} value={g.mc}>
              {g.mc}
            </option>
          ))}
        </select>
      </Field>
      <Field label={kind === 'neoforge' ? 'NeoForge build' : 'Forge build'}>
        <select
          className="input"
          value={value ?? ''}
          disabled={!list || !group}
          onChange={(event) => onPick(event.target.value)}
        >
          {!group ? <option value="">{value ?? 'Pick a game version first'}</option> : null}
          {(group?.builds ?? []).map((b) => (
            <option key={b.version} value={b.version}>
              {b.version}
              {b.tag ? ` — ${b.tag}` : ''}
              {b.prerelease ? ' (beta)' : ''}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

export function SettingsPage(): JSX.Element {
  const {
    settings,
    servers,
    updateSettings,
    updateServer,
    createServer,
    javaCandidates,
    loadJavaCandidates,
    vanillaVersions,
    loadVanillaVersions,
    fabricVersions,
    loadFabricVersions,
    loaderVersions,
    loadLoaderVersions,
    netInfo,
    openEulaModal,
    pushToast
  } = useApp()

  const [selectedId, setSelectedId] = useState<string | null>(servers[0]?.id ?? null)
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const [customEntry, setCustomEntry] = useState<CustomInspectResult | null>(null)
  const [loaderInstalled, setLoaderInstalled] = useState<boolean | null>(null)
  const [installedLoaders, setInstalledLoaders] = useState<InstalledLoader[] | null>(null)
  const [customAddressDraft, setCustomAddressDraft] = useState(settings.customAddress ?? '')

  const profile = servers.find((s) => s.id === selectedId) ?? servers[0] ?? null

  useEffect(() => {
    if (servers.length > 0 && !servers.some((s) => s.id === selectedId)) setSelectedId(servers[0].id)
  }, [servers, selectedId])

  const patchProfile = useCallback(
    async (patch: Parameters<typeof updateServer>[1]): Promise<void> => {
      if (!profile) return
      await updateServer(profile.id, patch)
    },
    [profile, updateServer]
  )

  const refreshInstalledLoaders = useCallback(async (): Promise<void> => {
    try {
      setInstalledLoaders(await window.api.listInstalledLoaders())
    } catch {
      setInstalledLoaders([])
    }
  }, [])

  useEffect(() => {
    void loadJavaCandidates()
  }, [loadJavaCandidates])

  useEffect(() => {
    if (!profile) return
    if (profile.kind === 'vanilla') void loadVanillaVersions()
    if (profile.kind === 'fabric') void loadFabricVersions()
    if (profile.kind === 'neoforge') void loadLoaderVersions('neoforge')
    if (profile.kind === 'forge') void loadLoaderVersions('forge')
  }, [profile, loadVanillaVersions, loadFabricVersions, loadLoaderVersions])

  useEffect(() => {
    setPortDraft(null)
  }, [profile?.id])

  useEffect(() => {
    let cancelled = false
    if (profile?.customServerDir) {
      void window.api.customInspect(profile.customServerDir).then((result) => {
        if (!cancelled) setCustomEntry(result)
      })
    } else {
      setCustomEntry(null)
    }
    return () => {
      cancelled = true
    }
  }, [profile?.customServerDir])

  const activeJava = settings.javaPath ?? javaCandidates?.[0]?.path ?? null
  const serverMc = profile ? profileMc(profile) : null
  const activeJavaMajor = javaMajorOf(javaCandidates?.find((c) => c.path === activeJava)?.version ?? null)
  const neededJavaMajor = requiredJavaMajor(serverMc)
  const javaTooOld = neededJavaMajor > 0 && activeJavaMajor >= 0 && activeJavaMajor < neededJavaMajor

  const browseCustom = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (!dir || !profile) return
    await patchProfile({ customServerDir: dir, kind: 'custom' })
  }

  const browsePack = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (!dir || !profile) return
    await patchProfile({ clientPackDir: dir })
  }

  const browseSaves = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (!dir) return
    await updateSettings({ mcSavesDir: dir })
  }

  const browseJava = async (): Promise<void> => {
    const path = await window.api.pickJava()
    if (!path) return
    await updateSettings({ javaPath: path })
    await loadJavaCandidates(true)
  }

  const removeLoaderInstall = async (kind: LoaderKind, version: string): Promise<void> => {
    try {
      await window.api.removeLoader(kind, version)
      pushToast('success', `Removed ${kind} ${version}`)
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
    void refreshInstalledLoaders()
  }

  const commitPort = (): Promise<void> => {
    if (!profile || portDraft === null) return Promise.resolve()
    const parsed = Number.parseInt(portDraft, 10)
    if (Number.isNaN(parsed) || parsed < 1024 || parsed > 65535) {
      setPortDraft(null)
      pushToast('error', 'Port must be between 1024 and 65535')
      return Promise.resolve()
    }
    if (parsed !== profile.port) return patchProfile({ port: parsed })
    setPortDraft(null)
    return Promise.resolve()
  }

  const commitCustomAddress = async (): Promise<void> => {
    const value = customAddressDraft.trim()
    await updateSettings({ customAddress: value.length > 0 ? value : null, exposeMode: value.length > 0 ? 'custom' : 'auto' })
  }

  const releases = vanillaVersions?.versions.filter((v) => v.type === 'release') ?? []
  const snapshots = vanillaVersions?.versions.filter((v) => v.type !== 'release') ?? []
  const fabricGames = fabricVersions?.game ?? []
  const fabricLoaders = fabricVersions?.loader ?? []

  const activeLoader: LoaderKind | null =
    profile && (profile.kind === 'neoforge' || profile.kind === 'forge') ? profile.kind : null
  const activeLoaderVersion =
    profile && activeLoader === 'neoforge' ? profile.neoforgeVersion : profile && activeLoader === 'forge' ? profile.forgeVersion : null

  useEffect(() => {
    let cancelled = false
    setLoaderInstalled(null)
    if (!activeLoader || !activeLoaderVersion) return
    void window.api
      .loaderStatus(activeLoader, activeLoaderVersion)
      .then((status) => {
        if (!cancelled) setLoaderInstalled(status.installed)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activeLoader, activeLoaderVersion])

  useEffect(() => {
    void refreshInstalledLoaders()
  }, [refreshInstalledLoaders, activeLoader, activeLoaderVersion])

  return (
    <div className="page page--settings">
      <header className="page__header">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__subtitle">Global options, and the configuration of each server.</p>
        </div>
        <div className="page__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void createServer('New server').then((created) => {
                if (created) setSelectedId(created.id)
              })
            }}
          >
            <Icon name="terminal" size={16} />
            New server…
          </button>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">Java runtime</h2>
        {javaCandidates === null ? (
          <p className="muted">Detecting Java runtimes…</p>
        ) : javaCandidates.length === 0 ? (
          <Banner kind="error">
            No Java runtime found. Install Java 17+ (e.g. from adoptium.net) or browse for javaw.exe
            manually — the Minecraft launcher's bundled runtime also works.
          </Banner>
        ) : (
          <div className="java-list">
            {javaCandidates.map((candidate) => (
              <button
                key={candidate.path}
                type="button"
                className={`java-row ${candidate.path === activeJava ? 'java-row--active' : ''}`}
                onClick={() => void updateSettings({ javaPath: candidate.path })}
              >
                <span className={`radio ${candidate.path === activeJava ? 'radio--on' : ''}`} />
                <span className="java-row__path mono" title={candidate.path}>
                  {candidate.path}
                </span>
                {candidate.version ? <span className="chip">{candidate.version}</span> : null}
                <span className="java-row__source">{candidate.source}</span>
              </button>
            ))}
          </div>
        )}
        {javaTooOld ? (
          <Banner kind="error">
            The selected server (Minecraft {serverMc}) needs <strong>Java {neededJavaMajor}+</strong>, but
            the active runtime is Java {activeJavaMajor} — the server will not start. Install a newer
            JDK/JRE (e.g. from adoptium.net or azul.com); it is detected automatically, or pick one above.
          </Banner>
        ) : null}
        <div className="card__footer">
          <span className="card__note">{activeJava ? 'Active runtime selected above.' : 'No runtime selected.'}</span>
          <button type="button" className="btn" onClick={() => void browseJava()}>
            <Icon name="folder" size={16} />
            Browse for javaw.exe…
          </button>
        </div>
      </section>

      {servers.length > 0 && profile ? (
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Server configuration</h2>
            <div className="profile-tabs">
              {servers.map((server) => (
                <button
                  key={server.id}
                  type="button"
                  className={`profile-tab ${server.id === profile.id ? 'profile-tab--active' : ''}`}
                  onClick={() => setSelectedId(server.id)}
                >
                  <span className="profile-tab__name">{server.name}</span>
                  <span className="profile-tab__sub">
                    {server.kind}
                    {server.kind === 'vanilla' && server.vanillaVersion ? ` ${server.vanillaVersion}` : ''}
                    {server.kind === 'fabric' && server.fabricGame ? ` ${server.fabricGame}` : ''}
                    {server.kind === 'neoforge' && server.neoforgeVersion ? ` ${server.neoforgeVersion}` : ''}
                    {server.kind === 'forge' && server.forgeVersion ? ` ${server.forgeVersion}` : ''} · port{' '}
                    {server.port}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="form">
            <Field label="Server name">
              <input
                className="input"
                type="text"
                value={profile.name}
                onChange={(event) => void patchProfile({ name: event.target.value })}
              />
            </Field>
          </div>

          <h3 className="card__subtitle">Server source</h3>
          <div className="kind-grid">
            {SERVER_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className={`kind-card ${profile.kind === kind.id ? 'kind-card--active' : ''}`}
                onClick={() => void patchProfile({ kind: kind.id })}
              >
                <span className="kind-card__label">{kind.label}</span>
                <span className="kind-card__description">{kind.description}</span>
              </button>
            ))}
          </div>

          {profile.kind === 'vanilla' ? (
            <div className="kind-panel">
              <Field label="Minecraft version" hint="Downloaded from Mojang on first host, then cached.">
                <select
                  className="input"
                  value={profile.vanillaVersion ?? ''}
                  disabled={!vanillaVersions}
                  onChange={(event) => void patchProfile({ vanillaVersion: event.target.value || null })}
                >
                  {!vanillaVersions ? <option>Loading…</option> : null}
                  <optgroup label="Releases">
                    {releases.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.id}
                      </option>
                    ))}
                  </optgroup>
                  {snapshots.length > 0 ? (
                    <optgroup label="Snapshots">
                      {snapshots.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.id}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </Field>
            </div>
          ) : null}

          {profile.kind === 'fabric' ? (
            <div className="kind-panel kind-panel--two">
              <Field label="Game version">
                <select
                  className="input"
                  value={profile.fabricGame ?? ''}
                  disabled={!fabricVersions}
                  onChange={(event) => void patchProfile({ fabricGame: event.target.value || null })}
                >
                  {!fabricVersions ? <option>Loading…</option> : null}
                  {fabricGames.map((version) => (
                    <option key={version.version} value={version.version}>
                      {version.version}
                      {version.stable ? ' (stable)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Loader version">
                <select
                  className="input"
                  value={profile.fabricLoader ?? ''}
                  disabled={!fabricVersions}
                  onChange={(event) => void patchProfile({ fabricLoader: event.target.value || null })}
                >
                  {!fabricVersions ? <option>Loading…</option> : null}
                  {fabricLoaders.map((version) => (
                    <option key={version.version} value={version.version}>
                      {version.version}
                      {version.stable ? ' (stable)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          {activeLoader ? (
            <>
              <LoaderPanel
                kind={activeLoader}
                list={loaderVersions?.kind === activeLoader ? loaderVersions.list : null}
                value={activeLoaderVersion}
                onPick={(version) =>
                  void patchProfile(activeLoader === 'neoforge' ? { neoforgeVersion: version } : { forgeVersion: version })
                }
              />
              <p className="card__note">
                {loaderInstalled === null
                  ? 'Checking install status…'
                  : loaderInstalled
                    ? `${activeLoader} ${activeLoaderVersion} is installed — reused on every host.`
                    : `Not installed yet — the ${activeLoader} installer is downloaded and run automatically on your first Host (one-time, a few minutes).`}
              </p>
            </>
          ) : null}

          {profile.kind === 'custom' ? (
            <div className="kind-panel">
              <Field
                label="Server folder"
                hint="An installed server directory containing run/win_args.txt or a server jar, plus your mods. Only one server can run from a given folder at a time."
              >
                <div className="custom-dir-row">
                  <span className="input input--static mono" title={profile.customServerDir ?? ''}>
                    {profile.customServerDir ?? 'No folder selected'}
                  </span>
                  <button type="button" className="btn" onClick={() => void browseCustom()}>
                    <Icon name="folder" size={16} />
                    Browse…
                  </button>
                </div>
              </Field>
              {customEntry ? (
                customEntry.ok ? (
                  <Banner kind="success">
                    Launch entry detected: <code className="mono">{customEntry.entry}</code>
                  </Banner>
                ) : (
                  <Banner kind="error">{customEntry.error}</Banner>
                )
              ) : null}
            </div>
          ) : null}

          {profile.kind !== 'custom' ? (
            <div className="kind-panel">
              <Field
                label="Client pack folder (optional)"
                hint="Your client instance folder (or its mods folder). mods, config, defaultconfigs and kubejs are copied into the server on every host — client-only mods are copied as-is, loaders ignore them."
              >
                <div className="custom-dir-row">
                  <span className="input input--static mono" title={profile.clientPackDir ?? ''}>
                    {profile.clientPackDir ?? 'No pack folder selected'}
                  </span>
                  <button type="button" className="btn" onClick={() => void browsePack()}>
                    <Icon name="folder" size={16} />
                    Browse…
                  </button>
                  {profile.clientPackDir ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => void patchProfile({ clientPackDir: null })}
                    >
                      <Icon name="x" size={16} />
                      Clear
                    </button>
                  ) : null}
                </div>
              </Field>
            </div>
          ) : null}

          <h3 className="card__subtitle">Hosting</h3>
          <div className="hosting-grid">
            <Field label={`Memory — ${profile.memoryGb} GB`} hint="Allocated to this server's JVM (-Xmx).">
              <input
                className="range"
                type="range"
                min={1}
                max={8}
                step={1}
                value={profile.memoryGb}
                onChange={(event) => void patchProfile({ memoryGb: Number(event.target.value) })}
              />
            </Field>
            <Field label="Port" hint="Each running server needs its own port. Join in-game at <host>:<port>.">
              <input
                className="input"
                type="number"
                min={1024}
                max={65535}
                value={portDraft ?? String(profile.port)}
                onChange={(event) => setPortDraft(event.target.value)}
                onBlur={() => void commitPort()}
              />
            </Field>
            <Field
              label="Online mode"
              hint={
                profile.onlineMode
                  ? 'Only authenticated Minecraft accounts can join.'
                  : 'Offline mode — unofficial/cracked launchers can join (recommended for local play).'
              }
            >
              <Toggle checked={profile.onlineMode} onChange={(next) => void patchProfile({ onlineMode: next })} />
            </Field>
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="muted">
            No servers yet — create one above or on the Servers page, then configure it here.
          </p>
        </section>
      )}

      <section className="card">
        <h2 className="card__title">Server address</h2>
        <p className="card__note">
          Every server binds to all network interfaces, so players on your LAN or VPN (e.g. Radmin) can
          join. Choose which address the app advertises.
        </p>
        <div className="address-modes">
          <button
            type="button"
            className={`kind-card kind-card--mini ${settings.exposeMode === 'auto' ? 'kind-card--active' : ''}`}
            onClick={() => void updateSettings({ exposeMode: 'auto', customAddress: null })}
          >
            <span className="kind-card__label">Automatic (LAN IP)</span>
            <span className="kind-card__description">
              {netInfo?.lanIp ? (
                <>
                  Detected: <span className="mono">{netInfo.lanIp}</span>
                </>
              ) : (
                'No LAN address detected — falls back to localhost.'
              )}
            </span>
          </button>
          <button
            type="button"
            className={`kind-card kind-card--mini ${settings.exposeMode === 'custom' ? 'kind-card--active' : ''}`}
            onClick={() => void updateSettings({ exposeMode: 'custom', customAddress: customAddressDraft.trim() || null })}
          >
            <span className="kind-card__label">Custom address</span>
            <span className="kind-card__description">
              For Radmin VPN and similar: enter the adapter's IP (or a hostname) and share it instead.
            </span>
          </button>
        </div>
        {settings.exposeMode === 'custom' ? (
          <div className="kind-panel">
            <Field
              label="Custom address"
              hint="Players join at <address>:<port>. The port belongs to each server — change it in Server configuration → Hosting, above."
            >
              <div className="custom-dir-row">
                <input
                  className="input mono"
                  type="text"
                  placeholder="e.g. 26.14.52.7 (Radmin) or myhost.example"
                  value={customAddressDraft}
                  onChange={(event) => setCustomAddressDraft(event.target.value)}
                  onBlur={() => void commitCustomAddress()}
                />
                <button type="button" className="btn btn--primary" onClick={() => void commitCustomAddress()}>
                  <Icon name="check" size={16} />
                  Apply
                </button>
              </div>
            </Field>
          </div>
        ) : null}
        {netInfo && netInfo.addresses.length > 0 ? (
          <p className="card__note">
            All detected addresses: <span className="mono">{netInfo.addresses.join(' · ')}</span>
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card__title">Worlds</h2>
        <div className="kind-panel">
          <Field
            label="Default saves folder"
            hint="Where the world picker opens and where new worlds are created — e.g. your launcher's saves folder (Prism instance .minecraft\saves, CurseForge instances, …). Leave empty to use %APPDATA%\.minecraft\saves."
          >
            <div className="custom-dir-row">
              <span className="input input--static mono" title={settings.mcSavesDir ?? ''}>
                {settings.mcSavesDir ?? '%APPDATA%\.minecraft\saves (default)'}
              </span>
              <button type="button" className="btn" onClick={() => void browseSaves()}>
                <Icon name="folder" size={16} />
                Browse…
              </button>
              {settings.mcSavesDir ? (
                <button type="button" className="btn btn--ghost" onClick={() => void updateSettings({ mcSavesDir: null })}>
                  <Icon name="x" size={16} />
                  Clear
                </button>
              ) : null}
            </div>
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Installed loader servers</h2>
          <button type="button" className="btn btn--ghost" onClick={() => void refreshInstalledLoaders()}>
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
        {installedLoaders === null ? (
          <p className="muted">Checking…</p>
        ) : installedLoaders.length === 0 ? (
          <p className="muted">
            None yet — pick NeoForge or Forge for a server and host once; the installation appears here and
            is kept between sessions.
          </p>
        ) : (
          <div className="loader-list">
            {installedLoaders.map((item) => (
              <div key={item.dir} className="loader-row">
                <span className="loader-row__name">
                  {item.kind} <span className="mono">{item.version}</span>
                </span>
                <span className="loader-row__dir mono" title={item.dir}>
                  {item.dir}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost"
                  title="Delete this installed server (reinstalls automatically if you host with it again)"
                  onClick={() => void removeLoaderInstall(item.kind, item.version)}
                >
                  <Icon name="x" size={14} />
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="card__note">
          Installations live in the app data folder and are shared by servers: each running server gets its
          own run directory with the big libraries linked in, so two servers can use the same loader
          version at the same time.
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Legal</h2>
        {settings.eulaAccepted ? (
          <Banner kind="success">Minecraft EULA accepted — eula=true is written to each hosted server.</Banner>
        ) : (
          <div className="card__footer">
            <span className="card__note">Hosting requires accepting the Minecraft EULA once.</span>
            <button type="button" className="btn btn--primary" onClick={openEulaModal}>
              Review & accept the Minecraft EULA
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
