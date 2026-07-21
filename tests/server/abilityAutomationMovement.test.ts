import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityMovementError,
  planAbilityMovement,
} from '../../server/domain/abilityAutomation/movement'
import type { EncounterLifecycleTriggerHandler } from '../../server/domain/moveAutomation/reduceLifecycle'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseAbilityEntityState } from '#shared/abilityAutomation/entities'

const sheet = (slug: string): CharacterSheet => ({
  slug, nickname: slug, species: 'Bulbasaur', level: 10, revision: 1,
  capabilities: { overland: 8 },
})
const placement = (id: string, x: number, z: number): SheetPlacement => ({
  id, sheetKind: 'pokemon', sheetSlug: id, position: { x, y: 0, z },
})
const placements = [
  placement('actor', 0, 1),
  placement('defender', 0, 0),
  placement('target', 4, 1),
]
const entity = (overrides: Record<string, unknown> = {}) => ({
  entityId: 'entity.anchor', version: 1, kind: 'anchor', labelKey: 'entity.anchor',
  ownerPlacementId: 'defender', sourceAbilityInstanceId: 'base:defender:0',
  canonicalId: 'Anchor Ability', sourceOperationId: 'operation.anchor-source',
  controller: { kind: 'source-controller', id: 'defender' }, sideId: 'blue',
  position: { x: 7, y: 0, z: 3 }, base: 1, clearance: 1,
  occupancy: 'non-blocking', targetability: 'untargetable', movementMode: 'fixed', movementSpeed: 0,
  maximumHp: null, currentHp: null, damageReduction: null,
  duration: { kind: 'source-ability' }, tags: ['anchor'],
  payload: {
    kind: 'anchor', anchorKind: 'lock', anchoredPlacementIds: [], preventedMovementModes: [],
  },
  createdOperationId: 'operation.anchor-create', lastOperationId: 'operation.anchor-create',
  ...overrides,
})
const map = (entities: readonly unknown[] = [], placementOverrides = placements): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-movement-arena', name: 'Ability Movement Arena', revision: 9,
  dimensions: { x: 8, y: 3, z: 5 }, groundLevelY: 0, voxels: [],
  placements: [...placementOverrides],
  encounterState: {
    ...createEmptyEncounterState(),
    abilityEntities: parseAbilityEntityState({ schemaVersion: 1, entries: entities, receipts: [] }),
  },
})
const context = (options: {
  readonly entities?: readonly unknown[]
  readonly map?: TabletopMap
} = {}): AuthoritativeAbilityContext => {
  const selectedMap = options.map ?? map(options.entities)
  const sheets = selectedMap.placements.map(value => ({
    kind: 'pokemon' as const, slug: value.sheetSlug, revision: 1, sheet: sheet(value.sheetSlug),
  }))
  const tokens = selectedMap.placements.map(value => ({
    id: value.id, position: value.position, base: 1, clearance: 1,
  }))
  const byId = new Map(selectedMap.placements.map(value => [value.id, value]))
  const abilities = (placementId: string) => placementId === 'defender'
    ? [{ instanceId: 'base:defender:0', canonicalId: 'Anchor Ability', effective: true }]
    : [{ instanceId: `base:${placementId}:0`, canonicalId: 'Mover', effective: true }]
  return {
    map: selectedMap,
    actor: { placement: byId.get('actor')! },
    source: { placement: byId.get('actor')! },
    targets: [{ placement: byId.get('target')! }],
    placements: selectedMap.placements,
    tokens,
    resolvedSheets: sheets,
    abilityEntities: selectedMap.encounterState!.abilityEntities,
    time: 12_345,
    queries: {
      placements: { get: (id: string) => byId.get(id) ?? null },
      effectiveAbilities: { activeForPlacement: abilities },
    },
  } as unknown as AuthoritativeAbilityContext
}
const currentPlacement = (
  result: ReturnType<typeof planAbilityMovement>,
  placementId: string,
): SheetPlacement | null => {
  const change = result.plan.changes.find(value => value.kind === 'placement-state'
    && value.scope.placementId === placementId)
  return change?.kind === 'placement-state' ? change.current : null
}

const interruptHandler: EncounterLifecycleTriggerHandler = {
  id: 'handler.ability-movement-interrupt',
  resolve: ({ event }) => event.kind === 'placement-leaving-adjacency'
    ? [{
        effectId: null,
        reasonCode: 'ability-movement.interrupt',
        operations: [{
          id: 'operation.ability-movement-interrupt',
          kind: 'reaction-request',
          source: { kind: 'lifecycle-event', id: event.eventId },
          recipients: { kind: 'actor' },
          phase: 'movement',
          reasonCode: 'ability-movement.interrupt',
          payload: {
            requestId: 'request.ability-movement-interrupt',
            promptKey: 'ability-movement.interrupt',
            options: [{ id: 'option.respond', labelKey: 'ability-movement.respond' }],
            allowPass: true, timing: 'movement-step', priority: 0,
          },
        }],
        emittedEvents: [],
      }]
    : [],
}

describe('authoritative ability movement and displacement planning', () => {
  it('derives optional movement paths and atomically plans placement, lifecycle, and audit state', () => {
    const result = planAbilityMovement({
      context: context(),
      command: {
        operationId: 'operation.ability-shift', kind: 'shift', placementId: 'actor',
        destination: { x: 2, y: 0, z: 1 }, maximumCost: 4,
      },
      userName: 'GM',
    })
    expect(result.status).toBe('completed')
    expect(result.movements[0]).toMatchObject({
      mode: 'voluntary', origin: { x: 0, z: 1 }, destination: { x: 2, z: 1 },
      shortened: false,
    })
    expect(currentPlacement(result, 'actor')?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(result.plan.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'ability-movement-arena', expectedRevision: 9 },
    ])
    expect(result.lifecycleRuns[0]?.status).toBe('completed')
    expect(result.lifecycleRuns[0]?.processedPathEvents.length).toBeGreaterThan(0)
    expect(result.plan.changes.some(value => value.kind === 'map-metadata')).toBe(true)
  })

  it('stops before committing when an exact pre-step lifecycle checkpoint opens', () => {
    const result = planAbilityMovement({
      context: context(),
      command: {
        operationId: 'operation.interruptible-shift', kind: 'shift', placementId: 'actor',
        destination: { x: 2, y: 0, z: 1 }, maximumCost: 4,
      },
      handlers: [interruptHandler],
    })
    expect(result.status).toBe('pending-interrupt')
    expect(result.plan.changes).toEqual([])
    if (result.status !== 'pending-interrupt') throw new Error('expected pending movement')
    expect(result.lifecycleRuns[0]?.status).toBe('pending-interrupt')
  })

  it('truncates up-to forced displacement at an ability-created blocking entity', () => {
    const blocker = entity({
      entityId: 'entity.wall', kind: 'object', position: { x: 2, y: 0, z: 1 },
      occupancy: 'blocking', payload: { kind: 'object', objectKind: 'wall' }, tags: ['wall'],
    })
    const result = planAbilityMovement({
      context: context({ entities: [blocker] }),
      command: {
        operationId: 'operation.push', kind: 'displacement', placementId: 'actor',
        movementMode: 'forced', vector: { x: 1, y: 0, z: 0 }, requestedDistance: 3,
        distancePolicy: 'up-to-distance',
      },
    })
    expect(result.movements[0]).toMatchObject({
      destination: { x: 1, y: 0, z: 1 }, distance: 1,
      shortened: true, shorteningReason: 'ability-entity',
    })
    expect(currentPlacement(result, 'actor')?.position.x).toBe(1)
    expect(() => planAbilityMovement({
      context: context({ entities: [blocker] }),
      command: {
        operationId: 'operation.push-full', kind: 'displacement', placementId: 'actor',
        movementMode: 'forced', vector: { x: 1, y: 0, z: 0 }, requestedDistance: 3,
        distancePolicy: 'full-distance-required',
      },
    })).toThrowError(/blocked by entity/)
  })

  it('teleports without traversing route cells but enforces destination occupancy', () => {
    const routeBlocker = entity({
      entityId: 'entity.route-wall', kind: 'object', position: { x: 2, y: 0, z: 1 },
      occupancy: 'blocking', payload: { kind: 'object', objectKind: 'wall' }, tags: ['wall'],
    })
    const result = planAbilityMovement({
      context: context({ entities: [routeBlocker] }),
      command: {
        operationId: 'operation.teleport', kind: 'teleport', placementId: 'actor',
        destination: { x: 3, y: 0, z: 3 },
      },
    })
    expect(result.movements[0]).toMatchObject({
      mode: 'teleport', path: [{ x: 0, y: 0, z: 1 }, { x: 3, y: 0, z: 3 }],
    })
    expect(() => planAbilityMovement({
      context: context({ entities: [routeBlocker] }),
      command: {
        operationId: 'operation.teleport-blocked', kind: 'teleport', placementId: 'actor',
        destination: { x: 2, y: 0, z: 1 },
      },
    })).toThrowError(AbilityMovementError)
  })

  it('swaps two selected placements atomically while ignoring only their counterpart occupancy', () => {
    const result = planAbilityMovement({
      context: context(),
      command: {
        operationId: 'operation.swap', kind: 'swap',
        leftPlacementId: 'actor', rightPlacementId: 'target',
      },
    })
    expect(result.movements.map(value => value.placementId)).toEqual(['actor', 'target'])
    expect(currentPlacement(result, 'actor')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(currentPlacement(result, 'target')?.position).toEqual({ x: 0, y: 0, z: 1 })
    expect(result.plan.changes.filter(value => value.kind === 'placement-state')).toHaveLength(2)
  })

  it('honors active anchor locks and rejects unselected targets and client-authored extras', () => {
    const lock = entity({
      payload: {
        kind: 'anchor', anchorKind: 'root', anchoredPlacementIds: ['actor'],
        preventedMovementModes: ['forced', 'swap', 'teleport', 'voluntary'],
      },
    })
    expect(() => planAbilityMovement({
      context: context({ entities: [lock] }),
      command: {
        operationId: 'operation.locked', kind: 'shift', placementId: 'actor',
        destination: { x: 1, y: 0, z: 1 }, maximumCost: 2,
      },
    })).toThrowError(/prevents voluntary movement/)
    expect(() => planAbilityMovement({
      context: context(),
      command: {
        operationId: 'operation.foreign', kind: 'shift', placementId: 'defender',
        destination: { x: 1, y: 0, z: 0 }, maximumCost: 2,
      },
    })).toThrowError(/not authoritatively selected/)
    expect(() => planAbilityMovement({
      context: context(),
      command: {
        operationId: 'operation.extra', kind: 'teleport', placementId: 'actor',
        destination: { x: 3, y: 0, z: 3 }, clientPath: [{ x: 1, y: 0, z: 1 }],
      },
    })).toThrowError(/at most 0 entries|invalid shape/)
  })
})
