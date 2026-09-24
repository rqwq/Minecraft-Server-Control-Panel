import { useState, type KeyboardEvent } from 'react'

const HISTORY_KEY = 'sc-command-history'
const HISTORY_CAP = 100

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_CAP)))
  } catch {
    /* ignore */
  }
}

interface CommandInputProps {
  disabled: boolean
  onSend(command: string): void
}

export function CommandInput({ disabled, onSend }: CommandInputProps): JSX.Element {
  const [value, setValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)

  const submit = (): void => {
    const command = value.trim()
    if (!command || disabled) return
    const history = loadHistory()
    if (history[0] !== command) {
      const next = [command, ...history].slice(0, HISTORY_CAP)
      saveHistory(next)
    }
    onSend(command)
    setValue('')
    setHistoryIndex(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    const history = loadHistory()
    if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault()
      const next = historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1)
      setHistoryIndex(next)
      setValue(history[next])
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (historyIndex === null) return
      const next = historyIndex - 1
      if (next < 0) {
        setHistoryIndex(null)
        setValue('')
      } else {
        setHistoryIndex(next)
        setValue(history[next])
      }
    }
  }

  return (
    <div className="command-input">
      <span className="command-input__prompt">/</span>
      <input
        className="command-input__input"
        type="text"
        value={value}
        disabled={disabled}
        placeholder={disabled ? 'Server not running' : 'Type a command — runs at console permission (op level 4)…'}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      <button type="button" className="btn btn--primary" disabled={disabled || value.trim().length === 0} onClick={submit}>
        Send
      </button>
    </div>
  )
}
