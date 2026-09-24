import { formatBytes } from '../../../shared/types'

interface ProgressBarProps {
  label: string
  value: number
  max: number
  detail?: string
}

export function ProgressBar({ label, value, max, detail }: ProgressBarProps): JSX.Element {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="progress">
      <div className="progress__head">
        <span className="progress__label">{label}</span>
        <span className="progress__detail">
          {detail ?? (max > 0 ? `${formatBytes(value)} / ${formatBytes(max)}` : formatBytes(value))}
        </span>
      </div>
      <div className="progress__track">
        <div className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
