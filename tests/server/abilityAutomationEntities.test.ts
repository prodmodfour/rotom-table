import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityEntityCommandError,
  planAbilityEntityCommand,
  queryAbilityEntityTarget,
  reduceAbilityEntityCommand,
  reduceAbilityEntityLifecycle,
} from '../../server/domain/abilityAutomation/entities'
import {
  AbilityEntityValidationError,
  createEmptyAbilityEntityState,
  parseAbilityEntityState,
} from '#shared/abilityAutomation/entities'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const draft = (overrides: Record<string, unknown> = {}) => ({
  entityId: 'entity.anchor-one',
  kind: 'anchor',
  labelKey: 'ability.anchor.label',
  ownerPlacementId: 'owner-token',
  sourceAbilityInstanceId: 'base:owner-token:0',
  canonicalId: 'Anchored',
  sourceOperationId: 'operation.anchor-source',
  controller: { kind: 'source-controller', id: 'owner-token' },
  sideId: 'red',
  position: { x: 2, y: 0, z: 0 },
  base: 1,
  clearance: 1,
  occupancy: 'blocking',
  targetability: 'targetable',
  movementMode: 'fixed',
  movementSpeed: 0,
  maximumHp: null,
  currentHp: null,
  damageReduction: null,
  duration: { kind: 'source-ability' },
  tags: ['anchor'],
  payload: {
    kind: 'anchor', anchorKind: 'grapple',
    anchoredPlacementIds: [], preventedMovementModes: [],
  },
  ...overrides,
})
const createCommand = (entity = draft(), operationId = 'operation.create-anchor') => ({
  operationId,
  kind: 'create',
  entityId: entity.entityId,
  expectedVersion: null,
  entity,
})
const context = (encounterState = createEmptyEncounterState()): AuthoritativeAbilityContext => ({
  actor: { placement: { id: 'owner-token' } },
  tokens: [{ id: 'owner-token', position: { x: 0, y: 0, z: 0 }, base: 1, clearance: 1 }],
  map: {
    slug: 'entity-arena', revision: 7, dimensions: { x: 8, y: 4, z: 8 }, encounterState,
  },
  queries: {
    effectiveAbilities: {
      has: (placementId: string, canonicalId: string) => placementId === 'owner-token' && canonicalId === 'Anchored',
      activeForPlacement: () => [{ instanceId: 'base:owner-token:0' }],
    },
    relationships: { sideId: () => 'red' },
  },
} as unknown as AuthoritativeAbilityContext)
const encounterFrom = (result: ReturnType<typeof planAbilityEntityCommand>) => (
  result.plan.changes[0]!.current as ReturnType<typeof createEmptyEncounterState>
)

describe('ability-created anchors, decoys, objects, and subordinate entities', () => {
  it('strictly parses bounded targetable occupancy and source lifecycle', () => {
    const state = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand()).state
    expect(parseAbilityEntityState(state).entries[0]).toMatchObject({
      entityId: 'entity.anchor-one', kind: 'anchor', occupancy: 'blocking',
      targetability: 'targetable', duration: { kind: 'source-ability' }, version: 1,
    })
    expect(Object.isFrozen(state.entries[0]?.position)).toBe(true)
    expect(() => parseAbilityEntityState({ ...state, callback: () => true }))
      .toThrowError(AbilityEntityValidationError)
  })

  it('supports every closed entity family without sheet identity', () => {
    let state = createEmptyAbilityEntityState()
    const entities = [
      draft(),
      draft({
        entityId: 'entity.decoy-one', kind: 'decoy', occupancy: 'non-blocking',
        position: { x: 3, y: 0, z: 0 }, payload: { kind: 'decoy', mimicsPlacementId: 'owner-token' },
      }),
      draft({
        entityId: 'entity.object-one', kind: 'object', position: { x: 4, y: 0, z: 0 },
        maximumHp: 20, currentHp: 20, damageReduction: 5,
        movementMode: 'controlled', movementSpeed: 3,
        payload: { kind: 'object', objectKind: 'wall' },
      }),
      draft({
        entityId: 'entity.subordinate-one', kind: 'subordinate', position: { x: 5, y: 0, z: 0 },
        payload: { kind: 'subordinate', templateId: 'template.mini-nose', initiativePolicy: 'after-source' },
      }),
    ]
    entities.forEach((entity, index) => {
      state = reduceAbilityEntityCommand(state, createCommand(entity, `operation.create-${index}`)).state
    })
    expect(state.entries.map(entity => entity.kind)).toEqual(['anchor', 'decoy', 'object', 'subordinate'])
    expect(state.entries.every(entity => !('sheetSlug' in entity))).toBe(true)
  })

  it('plans creation atomically after source, bounds, and occupancy validation', () => {
    const created = planAbilityEntityCommand({ context: context(), command: createCommand() })
    expect(created).toMatchObject({ status: 'applied', outcome: 'created' })
    expect(encounterFrom(created).abilityEntities?.entries).toHaveLength(1)
    expect(created.plan.changes[0]).toMatchObject({
      reasonCode: 'ability-entity.create', expectedRevision: 7,
    })
    const retry = planAbilityEntityCommand({
      context: context(encounterFrom(created)), command: createCommand(),
    })
    expect(retry.status).toBe('duplicate')
    expect(retry.plan.changes).toEqual([])
  })

  it('rejects blocking overlap, out-of-bounds placement, inactive sources, and foreign owners', () => {
    expect(() => planAbilityEntityCommand({
      context: context(),
      command: createCommand(draft({ position: { x: 0, y: 0, z: 0 } })),
    })).toThrowError(/overlaps placement/)
    expect(() => planAbilityEntityCommand({
      context: context(),
      command: createCommand(draft({ position: { x: 8, y: 0, z: 0 } })),
    })).toThrowError(/outside map bounds/)
    const inactive = context()
    ;(inactive.queries.effectiveAbilities as unknown as { has: () => boolean }).has = () => false
    expect(() => planAbilityEntityCommand({ context: inactive, command: createCommand() }))
      .toThrowError(/not currently effective/)
    expect(() => planAbilityEntityCommand({
      context: context(), command: createCommand(draft({ ownerPlacementId: 'other-token' })),
    })).toThrowError(/another owner/)
  })

  it('moves controlled entities, applies DR/HP, transfers control, and removes optimistically', () => {
    const objectDraft = draft({
      entityId: 'entity.object-one', kind: 'object', movementMode: 'controlled', movementSpeed: 3,
      maximumHp: 20, currentHp: 20, damageReduction: 5,
      payload: { kind: 'object', objectKind: 'wall' },
    })
    let state = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand(objectDraft)).state
    const moved = reduceAbilityEntityCommand(state, {
      operationId: 'operation.move', kind: 'move', entityId: 'entity.object-one',
      expectedVersion: 1, position: { x: 4, y: 0, z: 0 },
    })
    expect(moved.entity).toMatchObject({ version: 2, position: { x: 4 } })
    state = moved.state
    const damaged = reduceAbilityEntityCommand(state, {
      operationId: 'operation.damage', kind: 'damage', entityId: 'entity.object-one',
      expectedVersion: 2, amount: 12,
    })
    expect(damaged.entity).toMatchObject({ version: 3, currentHp: 13 })
    const controlled = reduceAbilityEntityCommand(damaged.state, {
      operationId: 'operation.control', kind: 'transfer-control', entityId: 'entity.object-one',
      expectedVersion: 3, controller: { kind: 'placement', id: 'owner-token' },
    })
    expect(controlled.entity?.controller).toEqual({ kind: 'placement', id: 'owner-token' })
    const removed = reduceAbilityEntityCommand(controlled.state, {
      operationId: 'operation.remove', kind: 'remove', entityId: 'entity.object-one', expectedVersion: 4,
    })
    expect(removed.entity).toBeNull()
    expect(removed.state.entries).toEqual([])
    expect(() => reduceAbilityEntityCommand(state, {
      operationId: 'operation.stale', kind: 'remove', entityId: 'entity.object-one', expectedVersion: 1,
    })).toThrowError(AbilityEntityCommandError)
  })

  it('enforces fixed movement and speed bounds', () => {
    const anchorState = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand()).state
    expect(() => reduceAbilityEntityCommand(anchorState, {
      operationId: 'operation.move-fixed', kind: 'move', entityId: 'entity.anchor-one',
      expectedVersion: 1, position: { x: 3, y: 0, z: 0 },
    })).toThrowError(/Fixed entities/)
    const object = draft({
      entityId: 'entity.object-one', kind: 'object', movementMode: 'controlled', movementSpeed: 1,
      payload: { kind: 'object', objectKind: 'wall' },
    })
    const objectState = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand(object)).state
    expect(() => reduceAbilityEntityCommand(objectState, {
      operationId: 'operation.move-far', kind: 'move', entityId: 'entity.object-one',
      expectedVersion: 1, position: { x: 5, y: 0, z: 0 },
    })).toThrowError(/exceeds its movement speed/)
  })

  it('queries targetability and cleans up or advances entities by game-event duration', () => {
    const targetable = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand()).state
    expect(queryAbilityEntityTarget(targetable, 'entity.anchor-one')?.entityId).toBe('entity.anchor-one')
    const hidden = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand(draft({ targetability: 'untargetable' }))).state
    expect(queryAbilityEntityTarget(hidden, 'entity.anchor-one')).toBeNull()

    const roundState = reduceAbilityEntityCommand(createEmptyAbilityEntityState(), createCommand(draft({
      duration: { kind: 'round', boundary: 'end', remaining: 2 },
    }))).state
    const advanced = reduceAbilityEntityLifecycle(roundState, { kind: 'round-boundary', boundary: 'end' })
    expect(advanced.entries[0]?.duration).toEqual({ kind: 'round', boundary: 'end', remaining: 1 })
    expect(reduceAbilityEntityLifecycle(advanced, { kind: 'round-boundary', boundary: 'end' }).entries).toEqual([])
    expect(reduceAbilityEntityLifecycle(targetable, {
      kind: 'effective-ability-snapshot', placementId: 'owner-token', activeAbilityInstanceIds: [],
    }).entries).toEqual([])
  })
})
