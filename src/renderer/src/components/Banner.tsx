import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface BannerProps {
  kind: 'info' | 'warn' | 'error' | 'success'
  children: ReactNode
}

export function Banner({ kind, children }: BannerProps): JSX.Element {
  const icon =
    kind === 'warn' || kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'zap'
  return (
    <div className={`banner banner--${kind}`}>
      <Icon name={icon} size={16} />
      <div className="banner__body">{children}</div>
    </div>
  )
}
