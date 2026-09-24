import { Icon } from './Icon'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  onConfirm(): void
  onCancel(): void
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }: ConfirmModalProps): JSX.Element {
  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal__icon">
          <Icon name="alert" size={22} />
        </div>
        <h2 id="confirm-title" className="modal__title">
          {title}
        </h2>
        <p className="modal__text">{message}</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
