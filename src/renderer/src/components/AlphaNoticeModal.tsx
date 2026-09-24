import { useApp } from '../state/AppState'
import { Icon, BrandIcon } from './Icon'

/**
 * TEMPORARY alpha-stage notice, shown once on every app launch. Remove this
 * component (and its uses in App.tsx / AppState.tsx) once the app leaves
 * Alpha — it exists only to set expectations about bugs and to point users
 * at the repo / Discord contact.
 */
export function AlphaNoticeModal(): JSX.Element {
  const { appVersion, pushToast, dismissAlphaNotice } = useApp()

  const copyDiscord = async (): Promise<void> => {
    try {
      await window.api.copyDiscord()
      pushToast('success', 'Discord username copied — .extremism')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal alpha-notice" role="dialog" aria-modal="true" aria-labelledby="alpha-title">
        <div className="alpha-notice__icon">
          <Icon name="info" size={52} />
        </div>
        <h2 id="alpha-title" className="alpha-notice__title">
          Alpha version
        </h2>
        <p className="alpha-notice__text">
          The app is currently in Alpha and may contain bugs.
        </p>
        <p className="alpha-notice__version">Version: {appVersion ? `v${appVersion}` : 'unknown'}</p>
        <p className="alpha-notice__text alpha-notice__text--muted">
          Found a problem? Report it on GitHub or contact us on Discord.
        </p>
        <div className="alpha-notice__actions">
          <button type="button" className="btn" onClick={() => void window.api.openRepo()}>
            <BrandIcon name="github" size={15} />
            GitHub repository
          </button>
          <button
            type="button"
            className="btn"
            title="Discord: .extremism — click to copy"
            onClick={() => void copyDiscord()}
          >
            <BrandIcon name="discord" size={15} />
            Discord
          </button>
          <button type="button" className="btn btn--primary" onClick={dismissAlphaNotice}>
            Continue
          </button>
        </div>
        <div className="modal__license">ServerController © 2026. All rights reserved.</div>
      </div>
    </div>
  )
}
