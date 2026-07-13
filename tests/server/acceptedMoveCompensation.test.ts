import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import {
  AcceptedMoveCompensationValidationError,
  parseAcceptedMoveCompensationResult,
} from '~~/server/domain/moveAutomation/acceptedMoveCompensation'
import { createAcceptedMoveCompensationResult } from '~~/server/domain/moveAutomation/planAcceptedMoveCompensation'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveStateChangeInput,
} from '~~/server/domain/moveAutomation/plan'

const sheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'target',
  nickname: 'Private nickname',
  species: 'Pikachu',
  level: 20,
  revision: 4,
  combat: { currentHp: 40, injuries: 0, conditions: [] },
  stats: { atk: { stage: 0 } },
  movelist: [],
  ...overrides,
})

const planFixture = () => {
  const previousSheet = sheet()
  const currentSheet = sheet({
    revision: 5,
    combat: { currentHp: 22, injuries: 1, conditions: ['Burned'] },
    stats: { atk: { stage: 2 } },
  })
  const previousInventory = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
  const currentInventory = {
    ...previousInventory,
    revision: 1,
    updatedAt: 11,
    money: 500,
  }
  const inputs: MoveStateChangeInput[] = [
    {
      kind: 'map-hazards',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 7,
      sourceOperationId: 'move.add-spikes',
      reasonCode: 'hazard-added',
      previous: [],
      current: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
    {
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target' },
      expectedRevision: 4,
      sourceOperationId: null,
      reasonCode: 'combined-sheet-operations',
      previous: previousSheet,
      current: currentSheet,
      changedFields: ['hp', 'combatStages', 'conditions'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
    {
      kind: 'map-metadata',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 7,
      sourceOperationId: 'move.log',
      reasonCode: 'accepted-move-log-projection',
      previous: { note: 'before' },
      current: { note: 'before', moveLog: [{ moveName: 'Test' }] },
      compensation: unavailableMoveStateCompensation(
        'accepted-log-may-be-observed',
        'externally-observed',
      ),
    },
    {
      kind: 'group-inventory-state',
      scope: {
        kind: 'external-resource',
        resourceKind: 'group-inventory',
        resourceId: 'main',
      },
      expectedRevision: 0,
      sourceOperationId: 'move.consume-item',
      reasonCode: 'item-consumed',
      previous: previousInventory,
      current: currentInventory,
      compensation: unavailableMoveStateCompensation(
        'inventory-consumption-is-not-yet-invertible',
        'irreversible',
      ),
    },
  ]
  return createMoveStateChangePlan(inputs)
}

describe('accepted move compensation results', () => {
  it('records exact typed inverses and explicit unavailable safety without whole sheets', () => {
    const result = createAcceptedMoveCompensationResult({
      mapSlug: 'arena',
      originOperationId: 'op_movecomp001',
      plan: planFixture(),
    })

    expect(result).toMatchObject({
      schemaVersion: 1,
      mapSlug: 'arena',
      originOperationId: 'op_movecomp001',
    })
    expect(result.operations).toHaveLength(6)
    expect(result.operations.find(operation => (
      operation.operationId === 'inverse.state-change.1'
    ))).toEqual({
      operationId: 'inverse.state-change.1',
      stateChangeId: 'state-change.1',
      sourceOperationId: 'move.add-spikes',
      stateChangeKind: 'map-hazards',
      scope: { kind: 'map', mapSlug: 'arena' },
      resource: {
        kind: 'map',
        mapSlug: 'arena',
        beforeRevision: 7,
        afterRevision: 8,
      },
      reasonCode: 'hazard-added',
      availability: 'available',
      inverse: {
        kind: 'restore-map-hazards',
        scope: { kind: 'map', mapSlug: 'arena' },
        expectedCurrent: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
        restore: [],
      },
    })
    expect(result.operations.find(operation => (
      operation.operationId === 'inverse.state-change.2.hp'
    ))).toMatchObject({
      sourceOperationId: null,
      resource: {
        kind: 'sheet',
        sheetKind: 'pokemon',
        sheetSlug: 'target',
        beforeRevision: 4,
        afterRevision: 5,
      },
      inverse: {
        kind: 'restore-sheet-hp',
        expectedCurrent: { currentHp: 22, injuries: 1 },
        restore: { currentHp: 40, injuries: 0 },
      },
    })
    expect(result.operations.find(operation => (
      operation.operationId === 'inverse.state-change.2.combatStages'
    ))).toMatchObject({
      inverse: {
        kind: 'restore-sheet-combat-stages',
        expectedCurrent: { atk: 2 },
        restore: { atk: 0 },
      },
    })
    expect(result.operations.find(operation => (
      operation.operationId === 'inverse.state-change.2.conditions'
    ))).toMatchObject({
      inverse: {
        kind: 'restore-sheet-conditions',
        expectedCurrent: ['Burned'],
        restore: [],
      },
    })
    expect(result.operations.find(operation => (
      operation.stateChangeKind === 'map-metadata'
    ))).toMatchObject({
      availability: 'unavailable',
      safety: 'externally-observed',
      unavailableReasonCode: 'accepted-log-may-be-observed',
    })
    expect(result.operations.find(operation => (
      operation.stateChangeKind === 'group-inventory-state'
    ))).toMatchObject({
      availability: 'unavailable',
      safety: 'irreversible',
      unavailableReasonCode: 'inventory-consumption-is-not-yet-invertible',
    })

    const storedJson = JSON.stringify(result)
    expect(storedJson).not.toContain('Private nickname')
    expect(storedJson).not.toContain('Pikachu')
    expect(storedJson).not.toContain('"money"')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.operations)).toBe(true)
  })

  it('rejects arbitrary inverses, identity drift, and whole-document restore operations', () => {
    const result = createAcceptedMoveCompensationResult({
      mapSlug: 'arena',
      originOperationId: 'op_movecomp002',
      plan: planFixture(),
    })
    const arbitrary = JSON.parse(JSON.stringify(result)) as {
      operations: Array<{ inverse?: { kind: string } }>
    }
    arbitrary.operations[0]!.inverse!.kind = 'restore-document'

    expect(() => parseAcceptedMoveCompensationResult(arbitrary)).toThrowError(
      expect.objectContaining({ name: AcceptedMoveCompensationValidationError.name }),
    )
    expect(() => parseAcceptedMoveCompensationResult({
      ...result,
      mapSlug: 'other-arena',
    })).toThrow(/different map/)
  })
})
