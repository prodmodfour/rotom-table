import { describe, expect, it } from 'vitest'
import {
  stablePersistableSheetJson,
  stripDerivedSheetFolder,
  stripDerivedSheetRuntimeFields,
  toPersistableSheetPayload,
} from '~/utils/sheets/persistence'

describe('sheet persistence helpers', () => {
  it('strips derived runtime fields without mutating the source sheet', () => {
    const sheet = {
      slug: 'bolt',
      folder: 'party/a',
      nickname: 'Bolt',
      combat: { currentHp: 12 },
      sessionPlayerAccessible: true,
      playerProfileAccessible: true,
    }

    const persisted = stripDerivedSheetRuntimeFields(sheet)

    expect(persisted).toEqual({ slug: 'bolt', nickname: 'Bolt', combat: { currentHp: 12 } })
    expect(stripDerivedSheetFolder(sheet)).toEqual(persisted)
    expect(persisted).not.toBe(sheet)
    expect(sheet).toHaveProperty('folder', 'party/a')
    expect(sheet).toHaveProperty('sessionPlayerAccessible', true)
    expect(sheet).toHaveProperty('playerProfileAccessible', true)
  })

  it('returns a persistable JSON-record payload', () => {
    const payload = toPersistableSheetPayload({
      slug: 'ace',
      folder: '',
      player: true,
      playerProfileAccessible: true,
    })

    expect(payload).toEqual({ slug: 'ace', player: true })
    expect(payload).not.toHaveProperty('folder')
    expect(payload).not.toHaveProperty('playerProfileAccessible')
  })

  it('builds stable persisted JSON that ignores runtime-only fields and sorts keys', () => {
    const first = stablePersistableSheetJson({
      slug: 'ace',
      folder: 'a',
      player: true,
      level: 5,
      playerProfileAccessible: true,
    })
    const second = stablePersistableSheetJson({
      player: true,
      level: 5,
      folder: 'b',
      sessionPlayerAccessible: true,
      slug: 'ace',
    })

    expect(first).toBe('{"level":5,"player":true,"slug":"ace"}')
    expect(second).toBe(first)
  })
})
