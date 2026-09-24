import { useMemo, useState } from 'react'
import { Field } from './Field'
import { Icon } from './Icon'

interface NewWorldModalProps {
  busy: boolean
  /** Remembered saves folders, most recent first (launcher instances etc.). */
  savesDirs: string[]
  /** Current default saves folder (Settings), if set. */
  defaultDir: string | null
  onCreate(name: string, seed: string | null, savesDir: string | null): Promise<boolean>
  onCancel(): void
}

export function NewWorldModal({ busy, savesDirs, defaultDir, onCreate, onCancel }: NewWorldModalProps): JSX.Element {
  const [name, setName] = useState('New World')
  const [seed, setSeed] = useState('')
  const [targetDir, setTargetDir] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  // Default first, then remembered folders the user picked before.
  const options = useMemo(() => {
    const all = [...(defaultDir ? [defaultDir] : []), ...savesDirs]
    const seen = new Set<string>()
    return all.filter((dir) => {
      const key = dir.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [defaultDir, savesDirs])

  const effectiveDir = targetDir ?? options[0] ?? null

  const browse = async (): Promise<void> => {
    setBrowsing(true)
    try {
      const dir = await window.api.pickFolder()
      if (dir) {
        setTargetDir(dir)
        // An explicitly browsed folder becomes the default for next time.
        await window.api.setConfig({ mcSavesDir: dir })
      }
    } finally {
      setBrowsing(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    await onCreate(name.trim() || 'New World', seed.trim() ? seed.trim() : null, effectiveDir)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-world-title">
        <div className="modal__icon">
          <Icon name="zap" size={22} />
        </div>
        <h2 id="new-world-title" className="modal__title">
          Create a new world
        </h2>
        <p className="modal__text">
          Creates an empty world folder in the selected saves folder. The server generates the world the
          first time you host it — no singleplayer needed. After <strong>Sync back</strong> it behaves
          like any normal save.
        </p>
        <div className="form">
          <Field label="World name">
            <input
              className="input"
              type="text"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Seed (optional)" hint="Numbers or text. Leave empty for a random seed.">
            <input
              className="input"
              type="text"
              value={seed}
              disabled={busy}
              onChange={(event) => setSeed(event.target.value)}
            />
          </Field>
          <Field
            label="Create in"
            hint="Pick the saves folder of the Minecraft instance you play — e.g. a Prism/CurseForge instance saves folder, not necessarily .minecraft. Remembered for next time."
          >
            <div className="custom-dir-row">
              <select
                className="input mono"
                value={effectiveDir ?? ''}
                disabled={busy || browsing}
                onChange={(event) => setTargetDir(event.target.value || null)}
              >
                {options.length === 0 ? <option value="">%APPDATA%\.minecraft\saves (default)</option> : null}
                {options.map((dir) => (
                  <option key={dir} value={dir}>
                    {dir}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" disabled={busy || browsing} onClick={() => void browse()}>
                <Icon name="folder" size={16} />
                Browse…
              </button>
            </div>
          </Field>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void handleCreate()} disabled={busy}>
            <Icon name="check" size={16} />
            Create world
          </button>
        </div>
      </div>
    </div>
  )
}
