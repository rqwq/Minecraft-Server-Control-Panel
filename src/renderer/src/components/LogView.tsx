import { useEffect, useRef, useState } from 'react'
import type { LogLine } from '../../../shared/types'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function LogView({ logs }: { logs: LogLine[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (pinned && el) el.scrollTop = el.scrollHeight
  }, [logs, pinned])

  const handleScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  return (
    <div className="logview-wrap">
      <div className="logview" ref={containerRef} onScroll={handleScroll}>
        {logs.length === 0 ? (
          <div className="logview__empty">No output yet.</div>
        ) : (
          logs.map((line, index) => (
            <div className={`log-line log-line--${line.level}`} key={index}>
              <span className="log-line__time">{formatTime(line.ts)}</span>
              <span className="log-line__text">{line.text}</span>
            </div>
          ))
        )}
      </div>
      {!pinned ? (
        <button
          type="button"
          className="btn btn--ghost logview__jump"
          onClick={() => {
            setPinned(true)
            const el = containerRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          ↓ Jump to latest
        </button>
      ) : null}
    </div>
  )
}
