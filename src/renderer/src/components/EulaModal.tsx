import { Icon } from './Icon'

interface EulaModalProps {
  onAccept(): void
  onCancel(): void
  busy: boolean
}

export function EulaModal({ onAccept, onCancel, busy }: EulaModalProps): JSX.Element {
  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="eula-title">
        <div className="modal__icon">
          <Icon name="alert" size={22} />
        </div>
        <h2 id="eula-title" className="modal__title">
          Minecraft EULA
        </h2>
        <p className="modal__text">
          Hosting a Minecraft server requires accepting the Minecraft End User License Agreement. On
          your behalf, ServerController will write <code>eula=true</code> into the server folder's{' '}
          <code>eula.txt</code>.
        </p>
        <p className="modal__text">
          Read the agreement at{' '}
          <a
            href="https://www.minecraft.net/en-us/eula"
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.preventDefault()}
          >
            minecraft.net/en-us/eula
          </a>{' '}
          (copy the link to open it in your browser).
        </p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={onAccept} disabled={busy}>
            Accept &amp; continue
          </button>
        </div>
      </div>
    </div>
  )
}
