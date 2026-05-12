import { describe, expect, it } from 'vitest'
import {
  stablePersistableSheetJson,
  stripDerivedSheetFolder,
  toPersistableSheetPayload,
} from '~/utils/sheets/persistence'

describe('sheet persistence helpers', () => {
  it('strips derived folder fields without mutating the source sheet', () => {
    const sheet = {
      slug: 'bolt',
      folder: 'party/a',
      nickname: 'Bolt',
      combat: { currentHp: 12 },
    }

    const persisted = stripDerivedSheetFolder(sheet)

    expect(persisted).toEqual({ slug: 'bolt', nickname: 'Bolt', combat: { currentHp: 12 } })
    expect(persisted).not.toBe(sheet)
    expect(sheet).toHaveProperty('folder', 'party/a')
  })

  it('returns a persistable JSON-record payload', () => {
    const payload = toPersistableSheetPayload({ slug: 'ace', folder: '', player: true })

    expect(payload).toEqual({ slug: 'ace', player: true })
    expect(payload).not.toHaveProperty('folder')
  })

  it('builds stable persisted JSON that ignores folder and sorts keys', () => {
    const first = stablePersistableSheetJson({ slug: 'ace', folder: 'a', player: true, level: 5 })
    const second = stablePersistableSheetJson({ player: true, level: 5, folder: 'b', slug: 'ace' })

    expect(first).toBe('{"level":5,"player":true,"slug":"ace"}')
    expect(second).toBe(first)
  })
})
