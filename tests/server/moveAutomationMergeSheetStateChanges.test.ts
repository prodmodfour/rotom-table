import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  mergeDisjointMoveSheetStateChanges,
  MoveSheetStateChangeMergeError,
} from '~~/server/domain/moveAutomation/mergeSheetStateChanges'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetStateField,
  type MoveStateChangeInput,
} from '~~/server/domain/moveAutomation/plan'

const previousSheet = (): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Sprout',
  species: 'Bulbasaur',
  level: 20,
  revision: 3,
  combat: { currentHp: 1 },
})

const plannedSheet = (
  overrides: Partial<CharacterSheet> & { readonly updatedAt: number },
): CharacterSheet => ({ ...previousSheet(), ...overrides }) as CharacterSheet

const sheetChange = (
  sourceOperationId: string,
  changedFields: readonly MoveSheetStateField[],
  current: CharacterSheet,
): Extract<MoveStateChangeInput, { readonly kind: 'sheet-state' }> => ({
  kind: 'sheet-state',
  scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor' },
  expectedRevision: 3,
  sourceOperationId,
  reasonCode: sourceOperationId,
  previous: previousSheet(),
  current,
  changedFields,
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

describe('native MoveSpec sheet-state merging', () => {
  it('combines disjoint HP and Daily-usage writes into one revision', () => {
    const hp = sheetChange('synthesis.heal-normal', ['hp'], plannedSheet({
      revision: 4,
      updatedAt: 5_000,
      combat: { currentHp: 50 },
    }))
    const usage = sheetChange('synthesis.usage', ['moveUsage'], plannedSheet({
      revision: 4,
      updatedAt: 5_000,
      moveUsage: {
        daily: {
          synthesis: { moveName: 'Synthesis', uses: 1, updatedAt: 5_000 },
        },
      },
    }))

    const merged = mergeDisjointMoveSheetStateChanges([hp, usage])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      kind: 'sheet-state',
      sourceOperationId: null,
      reasonCode: 'combined-sheet-operations',
      changedFields: ['moveUsage', 'hp'],
      current: {
        revision: 4,
        updatedAt: 5_000,
        combat: { currentHp: 50 },
        moveUsage: { daily: { synthesis: { uses: 1 } } },
      },
    })
    expect(hp.current).not.toHaveProperty('moveUsage')
    expect((usage.current as CharacterSheet).combat).toEqual({ currentHp: 1 })
  })

  it('fails closed when two independent reducers claim the same typed field', () => {
    const first = sheetChange('operation.first', ['hp'], plannedSheet({
      revision: 4,
      updatedAt: 5_000,
      combat: { currentHp: 20 },
    }))
    const second = sheetChange('operation.second', ['hp'], plannedSheet({
      revision: 4,
      updatedAt: 5_000,
      combat: { currentHp: 30 },
    }))

    expect(() => mergeDisjointMoveSheetStateChanges([first, second]))
      .toThrowError(expect.objectContaining<Partial<MoveSheetStateChangeMergeError>>({
        code: 'conflicting-field-owner',
      }))
  })

  it('fails closed when reducers observed different sheet snapshots', () => {
    const hp = sheetChange('operation.hp', ['hp'], plannedSheet({
      revision: 4,
      updatedAt: 5_000,
      combat: { currentHp: 20 },
    }))
    const usage = sheetChange('operation.usage', ['moveUsage'], plannedSheet({
      revision: 4,
      updatedAt: 5_000,
      moveUsage: { daily: {} },
    }))
    ;(usage.previous as CharacterSheet).revision = 2

    expect(() => mergeDisjointMoveSheetStateChanges([hp, usage]))
      .toThrowError(expect.objectContaining<Partial<MoveSheetStateChangeMergeError>>({
        code: 'incompatible-snapshot',
      }))
  })
})
