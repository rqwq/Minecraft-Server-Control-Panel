import { useApp } from './state/AppState'
import { ServersPage } from './pages/ServersPage'
import { ServerConsolePage } from './pages/ServerConsolePage'
import { SettingsPage } from './pages/SettingsPage'
import { BackupsPage } from './pages/BackupsPage'
import { FilesPage } from './pages/FilesPage'
import { EulaModal } from './components/EulaModal'
import { AlphaNoticeModal } from './components/AlphaNoticeModal'
import { WhatsNewModal } from './components/WhatsNewModal'
import { Icon } from './components/Icon'
import { StatusPill } from './components/StatusPill'
import { FooterContacts } from './components/FooterContacts'
import { UpdatePopup, UpdateScreen } from './components/UpdateUI'
import type { Page } from './types'

const NAV: Array<{ id: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { id: 'servers', label: 'Servers & Worlds', icon: 'globe' },
  { id: 'backups', label: 'Backups', icon: 'archive' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

export function App(): JSX.Element {
  const {
    servers,
    runtime,
    page,
    consoleServerId,
    setPage,
    openConsole,
    showEulaModal,
    acceptEula,
    closeEulaModal,
    startBusy,
    toasts,
    dismissToast,
    appVersion,
    startupGate,
    updatePopup,
    alphaNotice,
    whatsNew
  } = useApp()

  const anyBusy = Object.values(startBusy).some(Boolean)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__logo">SC</div>
          <div className="sidebar__brandtext">
            <div className="sidebar__title">ServerController</div>
            <div className="sidebar__sub">{appVersion ? `v${appVersion}` : ''}</div>
          </div>
        </div>

        <nav className="sidebar__nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${page === item.id ? 'nav-item--active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__section-label">Servers</div>
        <nav className="sidebar__nav sidebar__nav--servers">
          {servers.length === 0 ? (
            <p className="sidebar__hint">Create a server on the Servers page.</p>
          ) : (
            servers.map((server) => {
              const state = runtime[server.id]?.state ?? 'stopped'
              return (
                <button
                  key={server.id}
                  type="button"
                  className={`nav-item nav-item--server ${page === 'console' && consoleServerId === server.id ? 'nav-item--active' : ''}`}
                  onClick={() => openConsole(server.id)}
                  title={`Open console — ${server.name}`}
                >
                  <span className={`nav-item__dot nav-item__dot--${state}`} />
                  <span className="nav-item__server-name">{server.name}</span>
                  <span className="nav-item__port mono">{server.port}</span>
                </button>
              )
            })
          )}
        </nav>

        <div className="sidebar__footer">
          {anyBusy ? <StatusPill state="starting" /> : null}
          <FooterContacts />
        </div>
      </aside>

      <main className="content">
        {page === 'servers' ? <ServersPage /> : null}
        {page === 'console' ? <ServerConsolePage /> : null}
        {page === 'backups' ? <BackupsPage /> : null}
        {page === 'files' ? <FilesPage /> : null}
        {page === 'settings' ? <SettingsPage /> : null}
      </main>

      {showEulaModal ? <EulaModal onAccept={() => void acceptEula()} onCancel={closeEulaModal} busy={anyBusy} /> : null}

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`} onClick={() => dismissToast(toast.id)}>
            <Icon name={toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'zap'} size={16} />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {updatePopup && !startupGate ? <UpdatePopup /> : null}
      {startupGate ? <UpdateScreen /> : null}
      {alphaNotice && !startupGate ? <AlphaNoticeModal /> : null}
      {whatsNew && !startupGate && !alphaNotice ? <WhatsNewModal /> : null}
    </div>
  )
}
