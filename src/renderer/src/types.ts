import type { RendererApi } from '../../shared/api'

declare global {
  interface Window {
    api: RendererApi
  }
}

export type Page = 'servers' | 'console' | 'settings' | 'backups' | 'files'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}
