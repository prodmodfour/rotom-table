import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { planInitiativeLifecycle } from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import { resolvePhysicalPowerLoad } from '~~/server/domain/capabilityAutomation/physicalPower'
import { removeCapabilityPresenceGroup } from '~~/server/domain/capabilityAutomation/presenceLifecycle'
import { applyAuthoritativeMovePlacementTransition } from '~~/server/domain/moveAutomation/placementTransition'
import { applyNativeSpatialMovements } from '~~/server/domain/moveAutomation/planNativeV2MoveState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const actor: SheetPlacement = {
  id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
}

const sheet: CharacterSheet = {
  slug: 'actor', nickname: 'Lifter', species: 'Machop', level: 20, revision: 3,
  skills: { athletics: '1d6' }, capabilities: { overland: 5, power: 4 },
  combat: { currentHp: 40, injuries: 0, conditions: [] },
}

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'physical-power-lifecycle',
  name: 'Physical Power Lifecycle',
  revision: 4,
  dimensions: { x: 6, y: 3, z: 4 },
  groundLevelY: 0,
  voxels: [],
  placements: [actor],
  initiative: { activeId: 'actor', round: 1, manualOrderIds: ['actor'] },
  encounterState: createEmptyEncounterState(),
  metadata: {
    capabilityObjects: [{
      id: 'crate', pounds: 71, position: { ...actor.position },
      attachmentKind: 'physical-power-load',
      attachedCapabilityCanonicalId: 'Power',
      attachedCapabilityInstanceId: 'capability:actor:Power:value-4',
      attachedToPlacementId: 'actor',
      physicalLoadOperationId: 'physical-load-operation',
      physicalLoadLastMovedRound: null,
      physicalLoadLastCheckRound: 1,
    }],
  },
})

const plan = (random: () => number) => planInitiativeLifecycle({
  map: mapFixture(),
  previous: { activeId: 'actor', round: 1 },
  current: { activeId: 'actor', round: 2 },
  orderIds: ['actor'],
  operationId: 'physical-power-round-two',
  time: 2_000,
  random,
  loadSheets: () => ({
    pokemonSheets: new Map([['actor', sheet]]),
    trainerSheets: new Map<string, TrainerSheet>(),
  }),
})

const loadObject = (map: TabletopMap): Record<string, unknown> => (
  map.metadata?.capabilityObjects?.[0] as Record<string, unknown>
)

describe('physical Power round lifecycle', () => {
  it('classifies an attachment with its exact effective Power source rather than another same-canonical source', () => {
    const map = mapFixture()
    const exact = resolvePhysicalPowerLoad({
      map,
      placementId: actor.id,
      powerByCapabilityInstanceId: new Map([
        ['capability:actor:Power:value-1', 1],
        ['capability:actor:Power:value-4', 4],
      ]),
    })
    expect(exact).toMatchObject({
      loadClass: 'staggering', power: 4, pounds: 71,
      capabilityInstanceId: 'capability:actor:Power:value-4',
    })
    expect(resolvePhysicalPowerLoad({
      map,
      placementId: actor.id,
      powerByCapabilityInstanceId: new Map([['capability:actor:Power:value-1', 1]]),
    })).toBeNull()
  })

  it('fails closed when an attached object is no longer co-located with its owner', () => {
    const map = mapFixture()
    const object = loadObject(map)
    object.position = { x: actor.position.x + 1, y: actor.position.y, z: actor.position.z }
    expect(() => resolvePhysicalPowerLoad({
      map,
      placementId: actor.id,
      powerByCapabilityInstanceId: new Map([['capability:actor:Power:value-4', 4]]),
    })).toThrow(/malformed physical Power load authority/i)
  })

  it('moves every exact attachment with Move-authored placement movement and records the authoritative round', () => {
    const moved = applyAuthoritativeMovePlacementTransition({
      map: mapFixture(),
      actorPlacement: actor,
      movement: {
        kind: 'pass',
        from: actor.position,
        destination: { x: 2, y: 0, z: 1 },
      },
      fail: (_code, message) => { throw new Error(message) },
    })
    expect(moved.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(loadObject(moved)).toMatchObject({
      position: { x: 2, y: 0, z: 1 },
      physicalLoadLastMovedRound: 1,
    })
  })

  it('moves attachments with native MoveSpec displacement endpoints', () => {
    const moved = applyNativeSpatialMovements(mapFixture(), [{
      operationId: 'operation.move-displacement',
      recipientPlacementId: actor.id,
      origin: actor.position,
      destination: { x: 2, y: 0, z: 1 },
    }] as unknown as Parameters<typeof applyNativeSpatialMovements>[1])
    expect(moved.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(loadObject(moved)).toMatchObject({
      position: { x: 2, y: 0, z: 1 },
      physicalLoadLastMovedRound: 1,
    })
  })

  it('releases a removed presence’s physical load without deleting or relocating its objects', () => {
    const removed = removeCapabilityPresenceGroup({
      map: mapFixture(),
      ownerPlacementId: actor.id,
    })
    expect(removed.removedPlacementIds).toEqual(new Set([actor.id]))
    expect(removed.map.placements).toEqual([])
    expect(loadObject(removed.map)).toMatchObject({ id: 'crate', position: actor.position, pounds: 71 })
    expect(loadObject(removed.map).attachmentKind).toBeUndefined()
    expect(loadObject(removed.map).attachedToPlacementId).toBeUndefined()
  })

  it('records a successful Staggering Weight Athletics check once for the new round', () => {
    const result = plan(() => 0.99)
    expect(result.rollLedger).toContainEqual(expect.objectContaining({
      rollId: 'physical-power-staggering:2:actor',
      naturalResults: [6],
      finalValue: 6,
    }))
    expect(loadObject(result.nextMap)).toMatchObject({
      attachmentKind: 'physical-power-load',
      physicalLoadLastCheckRound: 2,
    })
  })

  it('drops the entire exact load when the new-round Athletics check fails', () => {
    const result = plan(() => 0)
    expect(result.rollLedger).toContainEqual(expect.objectContaining({
      rollId: 'physical-power-staggering:2:actor',
      naturalResults: [1],
      finalValue: 1,
    }))
    expect(loadObject(result.nextMap)).toMatchObject({ id: 'crate', position: actor.position })
    expect(loadObject(result.nextMap).attachmentKind).toBeUndefined()
    expect(loadObject(result.nextMap).attachedCapabilityInstanceId).toBeUndefined()
  })
})
