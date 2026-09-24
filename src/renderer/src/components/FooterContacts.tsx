import { useApp } from '../state/AppState'
import { BrandIcon } from './Icon'

/** License line + GitHub / Discord contact buttons (sidebar footer and update screens). */
export function FooterContacts(): JSX.Element {
  const { pushToast } = useApp()

  const copyDiscord = async (): Promise<void> => {
    try {
      await window.api.copyDiscord()
      pushToast('success', 'Discord username copied — .extremism')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="footer-contacts">
      <div className="footer-contacts__icons">
        <button
          type="button"
          className="footer-contacts__btn"
          title="GitHub repository"
          onClick={() => void window.api.openRepo()}
        >
          <BrandIcon name="github" size={15} />
        </button>
        <button
          type="button"
          className="footer-contacts__btn"
          title="Discord: .extremism — click to copy"
          onClick={() => void copyDiscord()}
        >
          <BrandIcon name="discord" size={15} />
        </button>
      </div>
      <div className="footer-contacts__license">ServerController © 2026. All rights reserved.</div>
    </div>
  )
}
