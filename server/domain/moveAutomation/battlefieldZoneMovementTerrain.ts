import type { EncounterZone, EncounterZoneMovementModifier } from '#shared/moveAutomation/encounterZones'
import type { MapVoxelV2, TabletopMap } from '~/types/map'
import type { MapMovementTerrainIndex } from '~/utils/mapMovementTerrain'
import { barrierOccupiedCells } from './barriersAndSmoke'
import { projectBattlefieldZones } from './battlefieldZones'
import {
  DEFAULT_BATTLEFIELD_ZONE_ENTRY_REGISTRY,
  canonicalBattlefieldZoneComponents,
  type BattlefieldZoneEntryDefinitionRegistry,
} from './battlefieldZoneDefinitions'
import {
  evaluateBattlefieldZoneEntryEligibility,
  type BattlefieldZoneMovementSubject,
} from './battlefieldZoneEligibility'

const cellKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`

const zoneEffectId = (zone: EncounterZone): string | null => {
  if (zone.kind === 'hazard') return zone.payload.hazardId
  if (zone.kind === 'pledge') return zone.payload.pledgeId
  if (zone.kind === 'smoke') return zone.payload.smokeId
  if (zone.kind === 'barrier') return zone.payload.barrierId
  return null
}

const canonicalMovementModifiers = (
  zone: EncounterZone,
): readonly EncounterZoneMovementModifier[] => {
  const effectId = zoneEffectId(zone)
  return effectId === null
    ? []
    : canonicalBattlefieldZoneComponents({ kind: zone.kind, effectId }).modifiers.movement
}

const mergedMovementModifiers = (
  zone: EncounterZone,
): readonly EncounterZoneMovementModifier[] => {
  const byId = new Map(zone.modifiers.movement.map(modifier => [modifier.id, modifier]))
  for (const modifier of canonicalMovementModifiers(zone)) {
    if (!byId.has(modifier.id)) byId.set(modifier.id, modifier)
  }
  return [...byId.values()]
}

const slowTerrainModifier = (zone: EncounterZone): boolean => {
  let multiplier = 1
  let hasCostModifier = false
  for (const modifier of mergedMovementModifiers(zone)) {
    if (modifier.attribute !== 'cost') continue
    hasCostModifier = true
    if (modifier.operation === 'add') multiplier += modifier.value
    else if (modifier.operation === 'multiply') multiplier *= modifier.value
    else multiplier = modifier.value
  }
  // The pathfinder's Slow Terrain primitive is exactly a doubled step cost.
  // Other numeric movement policies retain their typed query representation for
  // their owning tickets rather than being approximately reinterpreted here.
  return hasCostModifier && multiplier === 2
}

const entryDefinitionForZone = (
  zone: EncounterZone,
  registry: BattlefieldZoneEntryDefinitionRegistry,
) => {
  const effectId = zoneEffectId(zone)
  const canonicalHooks = effectId === null
    ? []
    : canonicalBattlefieldZoneComponents({ kind: zone.kind, effectId }).hooks.entry
  const hooks = [...zone.hooks.entry]
  for (const hook of canonicalHooks) {
    if (!hooks.some(candidate => candidate.id === hook.id)) hooks.push(hook)
  }
  for (const hook of hooks) {
    const definition = registry.get(hook.handlerId)
    if (definition) return definition
  }
  return null
}

const zoneAffectsMovementSubject = (input: {
  readonly zone: EncounterZone
  readonly subject: BattlefieldZoneMovementSubject
  readonly registry: BattlefieldZoneEntryDefinitionRegistry
}): boolean => {
  const definition = entryDefinitionForZone(input.zone, input.registry)
  if (!definition) return true
  return evaluateBattlefieldZoneEntryEligibility({
    zone: input.zone,
    definition,
    subject: input.subject,
  }).outcome === 'eligible'
}

interface MovementZoneIndex {
  readonly slowBattlefield: boolean
  readonly slowCells: ReadonlySet<string>
  readonly blockingCells: ReadonlyMap<string, MapVoxelV2>
  readonly blockingColumnYs: ReadonlyMap<string, readonly number[]>
}

const traversalBlocked = (zone: EncounterZone): boolean => mergedMovementModifiers(zone)
  .some(modifier => modifier.attribute === 'traversal' && modifier.operation === 'block')

const movementZoneIndex = (input: {
  readonly map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>
  readonly subject: BattlefieldZoneMovementSubject
  readonly registry: BattlefieldZoneEntryDefinitionRegistry
}): MovementZoneIndex => {
  let slowBattlefield = false
  const slowCells = new Set<string>()
  const blockingCells = new Map<string, MapVoxelV2>()
  const blockingColumnYs = new Map<string, number[]>()
  for (const zone of projectBattlefieldZones(input.map).activeZones) {
    if (zone.kind === 'barrier' && traversalBlocked(zone)) {
      for (const cell of barrierOccupiedCells(zone, input.map.dimensions)) {
        const key = cellKey(cell.x, cell.y, cell.z)
        if (input.subject.destroyHazards === true) {
          // Screen Cleaner treats Blocking Hazards as Slow Terrain for movement
          // while retaining their ordinary line-of-sight projection.
          slowCells.add(key)
          continue
        }
        blockingCells.set(key, {
          ...cell,
          materialId: 'airship_wall_bulkhead',
          blocksMovement: true,
          blocksSight: true,
          tags: ['barrier', zone.id],
        })
        const columnKey = `${cell.x}:${cell.z}`
        const ys = blockingColumnYs.get(columnKey)
        if (ys) ys.push(cell.y)
        else blockingColumnYs.set(columnKey, [cell.y])
      }
    }
    if (!slowTerrainModifier(zone)) continue
    if (!zoneAffectsMovementSubject({ zone, subject: input.subject, registry: input.registry })) {
      continue
    }
    if (zone.geometry.kind === 'battlefield') slowBattlefield = true
    else if (zone.geometry.kind === 'cells') {
      for (const cell of zone.geometry.cells) slowCells.add(cellKey(cell.x, cell.y, cell.z))
    }
    else if (
      zone.geometry.kind === 'placement'
      && zone.geometry.placementId === input.subject.placementId
    ) slowBattlefield = true
    else if (
      zone.geometry.kind === 'side'
      && input.subject.sideId !== null
      && zone.geometry.sideId === input.subject.sideId
    ) slowBattlefield = true
  }
  for (const ys of blockingColumnYs.values()) ys.sort((left, right) => right - left)
  return { slowBattlefield, slowCells, blockingCells, blockingColumnYs }
}

/**
 * Overlay canonical zone Slow Terrain on the voxel terrain index used by the
 * authoritative pathfinder. Eligibility is derived from server-owned side,
 * grounding, and type facts; browser paths and flags never participate.
 */
export const withBattlefieldZoneMovementTerrain = (input: {
  readonly map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>
  readonly terrain: MapMovementTerrainIndex
  readonly subject: BattlefieldZoneMovementSubject
  readonly registry?: BattlefieldZoneEntryDefinitionRegistry
}): MapMovementTerrainIndex => {
  const index = movementZoneIndex({
    map: input.map,
    subject: input.subject,
    registry: input.registry ?? DEFAULT_BATTLEFIELD_ZONE_ENTRY_REGISTRY,
  })
  const inheritedSlowAt = input.terrain.slowAt
  return Object.freeze({
    voxelAt: (x: number, y: number, z: number): MapVoxelV2 | null => (
      index.blockingCells.get(cellKey(x, y, z))
      ?? input.terrain.voxelAt(x, y, z)
      ?? null
    ),
    highestVoxelYBelow: (x: number, y: number, z: number): number | null => {
      const inherited = input.terrain.highestVoxelYBelow(x, y, z)
      const barrier = index.blockingColumnYs.get(`${x}:${z}`)?.find(value => value < y) ?? null
      if (inherited === null) return barrier
      if (barrier === null) return inherited
      return Math.max(inherited, barrier)
    },
    slowAt: (x: number, y: number, z: number): boolean => (
      inheritedSlowAt?.(x, y, z) === true
      || index.slowBattlefield
      || index.slowCells.has(cellKey(x, y, z))
    ),
  })
}
