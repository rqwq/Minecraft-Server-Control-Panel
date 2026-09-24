/**
 * Smoke test for the NBT codec.
 * Round-trips a synthetic compound through writeNbt -> parseNbt (gzip included)
 * and, if a real level.dat path is passed, parses it and prints key fields.
 *
 * Usage: node scripts/smoke-nbt.mjs [path/to/level.dat]
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  parseNbt,
  writeNbt,
  TAG_BYTE,
  TAG_INT,
  TAG_LONG,
  TAG_STRING,
  TAG_LIST,
  TAG_COMPOUND,
  TAG_INT_ARRAY
} from './.nbt.bundle.mjs'

let failures = 0

function check(name, actual, expected) {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`)
}

// ---- synthetic round trip --------------------------------------------------

const synthetic = {
  Data: {
    type: TAG_COMPOUND,
    value: {
      LevelName: { type: TAG_STRING, value: 'Test World' },
      GameType: { type: TAG_INT, value: 1 },
      difficulty: { type: TAG_BYTE, value: 3 },
      allowCommands: { type: TAG_BYTE, value: 0 },
      RandomSeed: { type: TAG_LONG, value: -7483204589321n },
      Scores: {
        type: TAG_LIST,
        value: [
          { type: TAG_INT, value: 10 },
          { type: TAG_INT, value: 20 },
          { type: TAG_INT, value: 30 }
        ]
      },
      SomeIds: { type: TAG_INT_ARRAY, value: Int32Array.from([1, -2, 3]) },
      Nested: {
        type: TAG_COMPOUND,
        value: { Version: { type: TAG_STRING, value: '1.20.1' } }
      }
    }
  }
}

const written = writeNbt(synthetic)
const reparsed = parseNbt(gunzipSync(gzipSync(written)))

check('root has Data', Object.keys(reparsed).join(','), 'Data')
const data = reparsed.Data.value
check('LevelName', data.LevelName.value, 'Test World')
check('GameType', data.GameType.value, 1)
check('difficulty', data.difficulty.value, 3)
check('allowCommands', data.allowCommands.value, 0)
check('RandomSeed (BigInt)', data.RandomSeed.value, -7483204589321n)
check('list length', data.Scores.value.length, 3)
check('list element', data.Scores.value[1].value, 20)
check('int array[1]', data.SomeIds.value[1], -2)
check('nested compound', data.Nested.value.Version.value, '1.20.1')
check('byte length (gzip sanity)', gzipSync(written).length > 10, true)

// ---- real level.dat (optional) --------------------------------------------

const realPath = process.argv[2]
if (realPath) {
  const { readFileSync } = await import('node:fs')
  try {
    const root = parseNbt(gunzipSync(readFileSync(realPath)))
    const d = root.Data.value
    console.log('\nReal level.dat parsed:')
    console.log('  LevelName    =', d.LevelName?.value)
    console.log('  Version.Name =', d.Version?.value?.Name?.value)
    console.log('  DataVersion  =', d.DataVersion?.value)
    console.log('  GameType     =', d.GameType?.value)
    console.log('  difficulty   =', d.difficulty?.value)
    console.log('  hardcore     =', d.hardcore?.value)
    console.log('  cheats       =', d.allowCommands?.value)
    console.log('  RandomSeed   =', d.RandomSeed?.value ?? d.WorldGenSettings?.value?.seed?.value)
    console.log('  playerdata   = N/A (folder-level)')
  } catch (err) {
    failures++
    console.log(`FAIL  real level.dat parse — ${err.message}`)
  }
}

console.log(failures === 0 ? '\nAll NBT smoke checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
