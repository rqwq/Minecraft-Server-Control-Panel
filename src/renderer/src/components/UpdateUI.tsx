import { useApp } from '../state/AppState'
import { Icon } from './Icon'
import { FooterContacts } from './FooterContacts'
import { formatBytes, type UpdateStateEvent } from '../../../shared/types'

/**
 * Shared body of both update surfaces. 'gate' is the blocking startup screen
 * (no skip); 'popup' is the small 30-minute-check card, whose download button
 * is blocked while a Minecraft server is running.
 */
function UpdateCard({ variant }: { variant: 'gate' | 'popup' }): JSX.Element {
  const { updateState, downloadUpdate, installUpdate, dismissUpdatePopup, runtime, startBusy } = useApp()
  const serverBusy =
    Object.values(runtime).some((r) => r.state !== 'stopped') || Object.values(startBusy).some(Boolean)
  const busyHint = variant === 'popup' && serverBusy

  const renderChecking = (): JSX.Element => (
    <div className="update-card__checking">
      <div className="spinner" />
      <div className="update-card__title">Checking for updates…</div>
      {variant === 'gate' ? <div className="update-card__text">The app will unlock in a moment.</div> : null}
    </div>
  )

  const renderBody = (state: UpdateStateEvent): JSX.Element => {
    if (state.phase === 'available') {
      return (
        <div className="update-card__body">
          <div className="update-card__title">Update available — v{state.version}</div>
          <div className="update-card__text">
            Download and install the new version{variant === 'gate' ? ' to continue using the app' : ''}.
          </div>
          {busyHint ? <div className="update-card__hint">Stop the running server to update.</div> : null}
          <div className="update-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busyHint}
              onClick={() => void downloadUpdate()}
            >
              <Icon name="download" size={16} />
              Download & install
            </button>
            {variant === 'popup' ? (
              <button type="button" className="btn btn--ghost" onClick={dismissUpdatePopup}>
                Skip until next check
              </button>
            ) : null}
          </div>
        </div>
      )
    }

    if (state.phase === 'downloading') {
      const progress = state.progress
      return (
        <div className="update-card__body">
          <div className="update-card__title">Downloading v{state.version}…</div>
          <div className="progress">
            <div className="progress__head">
              <span className="progress__label">{progress ? `${Math.round(progress.percent)}%` : '…'}</span>
              <span className="progress__detail">
                {progress
                  ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)} · ${formatBytes(progress.speed)}/s`
                  : ''}
              </span>
            </div>
            <div className="progress__track">
              <div
                className="progress__fill"
                style={{ width: progress ? `${Math.min(100, Math.max(0, progress.percent))}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      )
    }

    if (state.phase === 'ready') {
      return (
        <div className="update-card__body">
          <div className="update-card__title">v{state.version} downloaded</div>
          <div className="update-card__text">Restart the app to finish installing the update.</div>
          {busyHint ? <div className="update-card__hint">Stop the running server, then restart & install.</div> : null}
          <div className="update-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busyHint}
              onClick={() => void installUpdate()}
            >
              <Icon name="refresh" size={16} />
              Restart & install
            </button>
            {variant === 'popup' ? (
              <button type="button" className="btn btn--ghost" onClick={dismissUpdatePopup}>
                Skip until next check
              </button>
            ) : null}
          </div>
        </div>
      )
    }

    if (state.phase === 'error') {
      return (
        <div className="update-card__body">
          <div className="update-card__title">Update check failed</div>
          <div className="update-card__text">{state.message ?? 'Could not reach the update server.'}</div>
        </div>
      )
    }

    return renderChecking()
  }

  return <div className="update-card">{!updateState || updateState.phase === 'checking' ? renderChecking() : renderBody(updateState)}</div>
}

/** Full-screen blocking overlay shown at app start (packaged builds only). */
export function UpdateScreen(): JSX.Element {
  return (
    <div className="update-screen">
      <UpdateCard variant="gate" />
      <div className="update-screen__footer">
        <FooterContacts />
      </div>
    </div>
  )
}

/** Small skippable card popped by the 30-minute background check. */
export function UpdatePopup(): JSX.Element {
  return (
    <div className="update-popup">
      <UpdateCard variant="popup" />
      <div className="update-popup__footer">
        <FooterContacts />
      </div>
    </div>
  )
}
