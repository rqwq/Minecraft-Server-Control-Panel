interface ToggleProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled = false }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'toggle--on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  )
}
