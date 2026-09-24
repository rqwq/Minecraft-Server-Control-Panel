import { useEffect, useState } from 'react'
import { DIFFICULTIES, GAME_MODES, formatBytes } from '../../../shared/types'
import type { LevelEdits, WorldInfo } from '../../../shared/types'
import { Field } from './Field'
import { Icon } from './Icon'
import { Toggle } from './Toggle'

interface WorldEditModalProps {
  info: WorldInfo
  /** Editing is blocked while a server hosts this world. */
  locked: boolean
  onSave(edits: LevelEdits): Promise<boolean>
  onClose(): void
}

export function WorldEditModal({ info, locked, onSave, onClose }: WorldEditModalProps): JSX.Element {
  const [name, setName] = useState(info.levelName)
  const [gameType, setGameType] = useState(info.gameType)
  const [difficulty, setDifficulty] = useState(info.difficulty)
  const [hardcore, setHardcore] = useState(info.hardcore)
  const [cheats, setCheats] = useState(info.cheats)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(info.levelName)
    setGameType(info.gameType)
    setDifficulty(info.difficulty)
    setHardcore(info.hardcore)
    setCheats(info.cheats)
  }, [info])

  const dirty =
    name !== info.levelName ||
    gameType !== info.gameType ||
    difficulty !== info.difficulty ||
    hardcore !== info.hardcore ||
    cheats !== info.cheats

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    const edits: LevelEdits = {}
    if (name.trim() && name !== info.levelName) edits.levelName = name
    if (gameType !== info.gameType) edits.gameType = gameType
    if (difficulty !== info.difficulty) edits.difficulty = difficulty
    if (hardcore !== info.hardcore) edits.hardcore = hardcore
    if (cheats !== info.cheats) edits.cheats = cheats
    const ok = await onSave(edits)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="world-edit-title">
        <div className="modal__icon">
          <Icon name="globe" size={22} />
        </div>
        <h2 id="world-edit-title" className="modal__title">
          {info.levelName}
        </h2>
        <p className="modal__text mono">{info.path}</p>
        <div className="world-meta">
          <span>Version: <strong>{info.versionName}</strong></span>
          {info.dataVersion !== null ? <span>DataVersion: <strong>{info.dataVersion}</strong></span> : null}
          <span>Size: <strong>{formatBytes(info.folderSizeBytes)}</strong></span>
          <span>Players saved: <strong>{info.playerCount}</strong></span>
          {info.seed !== null ? <span className="mono">Seed: {info.seed}</span> : null}
        </div>
        {info.isNewWorld ? (
          <p className="modal__text">
            This world has not been generated yet — hosting it will create the level.dat.
          </p>
        ) : info.missingLevelDat ? (
          <p className="modal__text">
            <strong>level.dat is missing</strong> in this folder — host it and use Sync back to restore
            the world, or pick the correct folder.
          </p>
        ) : (
          <div className="form">
            <Field label="World name">
              <input
                className="input"
                type="text"
                value={name}
                disabled={locked || saving}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Default gamemode">
              <select
                className="input"
                value={gameType}
                disabled={locked || saving}
                onChange={(event) => setGameType(Number(event.target.value))}
              >
                {GAME_MODES.map((mode, index) => (
                  <option key={mode} value={index}>
                    {mode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Difficulty">
              <select
                className="input"
                value={difficulty}
                disabled={locked || saving}
                onChange={(event) => setDifficulty(Number(event.target.value))}
              >
                {DIFFICULTIES.map((diff, index) => (
                  <option key={diff} value={index}>
                    {diff}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hardcore">
              <Toggle checked={hardcore} disabled={locked || saving} onChange={setHardcore} />
            </Field>
            <Field
              label="Cheats (in-game only)"
              hint="Only gates in-game chat commands. The ServerController console always runs at op level 4 — even with cheats off."
            >
              <Toggle checked={cheats} disabled={locked || saving} onChange={setCheats} />
            </Field>
          </div>
        )}
        <p className="modal__note">
          {locked
            ? 'Editing is blocked while a server hosts this world.'
            : 'A timestamped backup (level.dat.bak-…) is written before saving.'}
        </p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
          {!info.isNewWorld && !info.missingLevelDat ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={locked || saving || !dirty}
              onClick={() => void handleSave()}
            >
              <Icon name="check" size={16} />
              Save world data
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
