import type { EncounterZone, EncounterZoneMovementModifier } from '#shared/moveAutomation/encounterZones'
import type { TabletopMap } from '~/types/map'
import type { MapMovementTerrainIndex } from '~/utils/mapMovementTerrain'
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

interface SlowZoneIndex {
  readonly battlefield: boolean
  readonly cells: ReadonlySet<string>
}

const slowZoneIndex = (input: {
  readonly map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>
  readonly subject: BattlefieldZoneMovementSubject
  readonly registry: BattlefieldZoneEntryDefinitionRegistry
}): SlowZoneIndex => {
  let battlefield = false
  const cells = new Set<string>()
  for (const zone of projectBattlefieldZones(input.map).activeZones) {
    if (!slowTerrainModifier(zone)) continue
    if (!zoneAffectsMovementSubject({ zone, subject: input.subject, registry: input.registry })) {
      continue
    }
    if (zone.geometry.kind === 'battlefield') battlefield = true
    else if (zone.geometry.kind === 'cells') {
      for (const cell of zone.geometry.cells) cells.add(cellKey(cell.x, cell.y, cell.z))
    }
    else if (
      zone.geometry.kind === 'placement'
      && zone.geometry.placementId === input.subject.placementId
    ) battlefield = true
    else if (
      zone.geometry.kind === 'side'
      && input.subject.sideId !== null
      && zone.geometry.sideId === input.subject.sideId
    ) battlefield = true
  }
  return { battlefield, cells }
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
  const index = slowZoneIndex({
    map: input.map,
    subject: input.subject,
    registry: input.registry ?? DEFAULT_BATTLEFIELD_ZONE_ENTRY_REGISTRY,
  })
  const inheritedSlowAt = input.terrain.slowAt
  return Object.freeze({
    voxelAt: input.terrain.voxelAt,
    highestVoxelYBelow: input.terrain.highestVoxelYBelow,
    slowAt: (x: number, y: number, z: number): boolean => (
      inheritedSlowAt?.(x, y, z) === true
      || index.battlefield
      || index.cells.has(cellKey(x, y, z))
    ),
  })
}
