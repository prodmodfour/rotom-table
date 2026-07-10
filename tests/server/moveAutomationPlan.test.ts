import { describe, expect, it } from 'vitest'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  MoveStateChangePlanError,
  createMoveStateChangePlan,
  isMoveStateChangePlanNoOp,
  unavailableMoveStateCompensation,
  type MoveStateChangeInput,
  type VersionedMoveEncounterState,
} from '~~/server/domain/moveAutomation/plan'
import type { CharacterSheet } from '~/types/characterSheet'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { SheetPlacement } from '~/types/map'

const sheet = (slug: string, revision: number, currentHp: number): CharacterSheet => ({
  slug,
  revision,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  combat: { currentHp },
  movelist: [],
})

const sheetStateChange = (
  slug: string,
  revision: number,
  previousHp: number,
  currentHp: number,
): MoveStateChangeInput => ({
  kind: 'sheet-state',
  scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: slug },
  expectedRevision: revision,
  sourceOperationId: `operation.hp.${slug}`,
  reasonCode: 'damage-applied',
  previous: sheet(slug, revision, previousHp),
  current: sheet(slug, revision + 1, currentHp),
  changedFields: ['hp'],
  compensation: unavailableMoveStateCompensation('field-level-inverse-not-yet-recorded'),
})

describe('typed move state change plans', () => {
  it('represents a canonical immutable no-op without resource expectations', () => {
    const plan = createMoveStateChangePlan([])

    expect(plan).toEqual({
      schemaVersion: 1,
      changes: [],
      groups: {
        map: [],
        encounter: [],
        placements: [],
        sheets: [],
        externalResources: [],
      },
      expectedRevisions: [],
    })
    expect(isMoveStateChangePlanNoOp(plan)).toBe(true)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.groups)).toBe(true)
    expect(Object.isFrozen(plan.changes)).toBe(true)
  })

  it('represents a map-only plan with one CAS expectation and safe inverse metadata', () => {
    const currentHazards = [{ kind: 'spikes' as const, x: 1, y: 0, z: 1 }]
    const input: MoveStateChangeInput = {
      kind: 'map-hazards',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 7,
      sourceOperationId: 'operation.add-hazard',
      reasonCode: 'hazard-added',
      previous: [],
      current: currentHazards,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }

    const plan = createMoveStateChangePlan([input])
    currentHazards[0]!.x = 9

    expect(isMoveStateChangePlanNoOp(plan)).toBe(false)
    expect(plan.changes).toEqual([
      expect.objectContaining({
        id: 'state-change.1',
        order: 0,
        kind: 'map-hazards',
        expectedRevision: 7,
        previous: [],
        current: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
        compensation: {
          kind: 'inverse',
          strategy: 'restore-previous-value',
        },
      }),
    ])
    expect(plan.groups.map).toHaveLength(1)
    expect(plan.groups.map[0]?.changes[0]).toBe(plan.changes[0])
    expect(plan.groups.sheets).toEqual([])
    expect(plan.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'arena', expectedRevision: 7 },
    ])
    expect(Object.isFrozen(plan.changes[0]?.current)).toBe(true)
  })

  it('represents sheet-only and ordered multi-sheet plans without map patches', () => {
    const sheetOnly = createMoveStateChangePlan([
      sheetStateChange('target-a', 3, 40, 25),
    ])

    expect(sheetOnly.groups.map).toEqual([])
    expect(sheetOnly.groups.placements).toEqual([])
    expect(sheetOnly.groups.sheets).toHaveLength(1)
    expect(sheetOnly.groups.sheets[0]).toMatchObject({
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target-a' },
      expectedRevision: 3,
    })
    expect(sheetOnly.expectedRevisions).toEqual([
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target-a', expectedRevision: 3 },
    ])

    const multiSheet = createMoveStateChangePlan([
      sheetStateChange('target-b', 8, 60, 51),
      sheetStateChange('target-a', 3, 40, 25),
    ])

    expect(multiSheet.changes.map(change => ({
      id: change.id,
      order: change.order,
      scope: change.scope,
    }))).toEqual([
      {
        id: 'state-change.1',
        order: 0,
        scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target-b' },
      },
      {
        id: 'state-change.2',
        order: 1,
        scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target-a' },
      },
    ])
    expect(multiSheet.groups.sheets.map(group => group.scope.sheetSlug)).toEqual([
      'target-b',
      'target-a',
    ])
    expect(multiSheet.expectedRevisions).toEqual([
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target-b', expectedRevision: 8 },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target-a', expectedRevision: 3 },
    ])
  })

  it('groups encounter, placement, and external changes while sharing the owning map revision', () => {
    interface TestEncounterState extends VersionedMoveEncounterState {
      readonly effects: readonly string[]
    }

    const previousPlacement: SheetPlacement = {
      id: 'actor-token',
      sheetKind: 'pokemon',
      sheetSlug: 'actor',
      position: { x: 0, y: 0, z: 0 },
    }
    const currentPlacement: SheetPlacement = {
      ...previousPlacement,
      position: { x: 1, y: 0, z: 0 },
    }
    const previousInventory = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
    const currentInventory = {
      ...previousInventory,
      revision: 1,
      updatedAt: 11,
      money: 50,
    }

    const plan = createMoveStateChangePlan<TestEncounterState>([
      {
        kind: 'encounter-state',
        scope: { kind: 'encounter', mapSlug: 'arena' },
        expectedRevision: 4,
        sourceOperationId: 'operation.effect',
        reasonCode: 'effect-added',
        previous: { schemaVersion: 1, effects: [] },
        current: { schemaVersion: 1, effects: ['effect-1'] },
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
      {
        kind: 'placement-state',
        scope: { kind: 'placement', mapSlug: 'arena', placementId: 'actor-token' },
        expectedRevision: 4,
        sourceOperationId: 'operation.movement',
        reasonCode: 'movement-applied',
        previous: previousPlacement,
        current: currentPlacement,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
      {
        kind: 'group-inventory-state',
        scope: {
          kind: 'external-resource',
          resourceKind: 'group-inventory',
          resourceId: 'main',
        },
        expectedRevision: 0,
        sourceOperationId: 'operation.item',
        reasonCode: 'inventory-updated',
        previous: previousInventory,
        current: currentInventory,
        compensation: unavailableMoveStateCompensation('external-observation-unsafe'),
      },
    ])

    expect(plan.groups.encounter).toHaveLength(1)
    expect(plan.groups.placements).toHaveLength(1)
    expect(plan.groups.externalResources).toHaveLength(1)
    expect(plan.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'arena', expectedRevision: 4 },
      {
        kind: 'external-resource',
        resourceKind: 'group-inventory',
        resourceId: 'main',
        expectedRevision: 0,
      },
    ])
    expect(plan.changes[2]?.compensation).toEqual({
      kind: 'unavailable',
      reasonCode: 'external-observation-unsafe',
    })
  })

  it('rejects arbitrary patches, no-op entries, and conflicting owner revisions', () => {
    expect(() => createMoveStateChangePlan([
      {
        kind: 'json-patch',
        path: '/metadata/hacked',
        value: true,
      } as never,
    ])).toThrowError(expect.objectContaining({
      name: MoveStateChangePlanError.name,
      code: 'unsupported-change-kind',
    }))

    expect(() => createMoveStateChangePlan([{
      kind: 'map-metadata',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 4,
      sourceOperationId: null,
      reasonCode: 'nothing-changed',
      previous: { value: 1 },
      current: { value: 1 },
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }])).toThrowError(expect.objectContaining({ code: 'no-op-change' }))

    expect(() => createMoveStateChangePlan([{
      kind: 'map-hazards',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 4,
      sourceOperationId: null,
      reasonCode: 'hazard-added',
      previous: [],
      current: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }, {
      kind: 'placement-state',
      scope: { kind: 'placement', mapSlug: 'arena', placementId: 'actor-token' },
      expectedRevision: 5,
      sourceOperationId: null,
      reasonCode: 'movement-applied',
      previous: {
        id: 'actor-token',
        sheetKind: 'pokemon',
        sheetSlug: 'actor',
        position: { x: 0, y: 0, z: 0 },
      },
      current: {
        id: 'actor-token',
        sheetKind: 'pokemon',
        sheetSlug: 'actor',
        position: { x: 1, y: 0, z: 0 },
      },
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }])).toThrowError(expect.objectContaining({ code: 'revision-conflict' }))
  })
})
