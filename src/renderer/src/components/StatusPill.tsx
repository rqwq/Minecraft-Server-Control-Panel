import type { ServerState } from '../../../shared/types'

const LABELS: Record<ServerState, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  crashed: 'Crashed'
}

export function StatusPill({ state }: { state: ServerState }): JSX.Element {
  return (
    <span className={`pill pill--${state}`}>
      <span className="pill__dot" />
      {LABELS[state]}
    </span>
  )
}
