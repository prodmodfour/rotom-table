import type {
  EncounterZoneGeometry,
  EncounterZoneSource,
} from '#shared/moveAutomation/encounterZones'
import {
  electricGrassyTerrainDamagePolicy,
  GRASSY_TERRAIN_TURN_HEAL_PERCENT,
  type ElectricGrassyTerrainKind,
} from '#shared/moveAutomation/terrain'
import type {
  GridAnchor,
  MapFieldEffects,
  MapTerrainKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { isMapTerrainKind } from '~/utils/mapFieldEffectDefinitions'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { normalizeConditionName } from '~/utils/statusConditions'
import { queryBattlefieldZones } from './battlefieldZones'
import type {
  MoveAutomationTargetGrounding,
  MoveAutomationTargetStateResolver,
} from './targetState'

export interface AuthoritativeTerrainInstance {
  readonly kind: MapTerrainKind
  readonly zoneId: string
  readonly source: EncounterZoneSource
  readonly geometry: EncounterZoneGeometry
}

export type TerrainMechanicsInteraction =
  | 'membership'
  | 'movement'
  | 'damage'
  | 'condition'
  | 'healing'

export type TerrainMechanicsTraceOutcome =
  | 'applied'
  | 'entered'
  | 'left'
  | 'retained'
  | 'outside-zone'
  | 'not-grounded'
  | 'not-applicable'
  | 'prevented'
  | 'superseded'
  | 'unavailable'

export interface TerrainMechanicsTraceEntry {
  readonly interaction: TerrainMechanicsInteraction
  readonly terrainKind: MapTerrainKind
  readonly zoneId: string
  readonly placementId: string
  readonly outcome: TerrainMechanicsTraceOutcome
  readonly reasonCode: string
  readonly value: number | string | boolean | null
}

export interface TerrainMembershipResolution {
  readonly placementId: string
  readonly grounding: MoveAutomationTargetGrounding | null
  /** At most one effective overlapping instance per terrain kind, in authoritative order. */
  readonly terrains: readonly AuthoritativeTerrainInstance[]
  readonly trace: readonly TerrainMechanicsTraceEntry[]
}

export interface TerrainMovementResolution {
  readonly placementId: string
  readonly enteredZoneIds: readonly string[]
  readonly leftZoneIds: readonly string[]
  readonly retainedZoneIds: readonly string[]
  readonly trace: readonly TerrainMechanicsTraceEntry[]
}

export interface TerrainDamageResolution {
  readonly modifiers: readonly MoveDamageModifier[]
  readonly trace: readonly TerrainMechanicsTraceEntry[]
}

export interface TerrainConditionResolution {
  readonly blockedBy: string | null
  readonly trace: readonly TerrainMechanicsTraceEntry[]
}

export interface TerrainHealingResolution {
  readonly applies: boolean
  readonly percent: number | null
  readonly zoneId: string | null
  readonly trace: readonly TerrainMechanicsTraceEntry[]
}

export interface MoveAutomationTerrainResolver {
  /** Every active native-plus-compatibility terrain, including local cell geometry. */
  active(): readonly AuthoritativeTerrainInstance[]
  /** Resolve grounded footprint membership at the current or a server-owned proposed position. */
  membership(input: {
    readonly placementId: string
    readonly position?: GridAnchor
  }): TerrainMembershipResolution
  /** Compare two server-owned movement positions without mutating the map. */
  movement(input: {
    readonly placementId: string
    readonly from: GridAnchor
    readonly to: GridAnchor
  }): TerrainMovementResolution
  damage(input: {
    readonly placementId: string
    readonly moveType: string
    readonly targetImmune?: boolean
  }): TerrainDamageResolution
  condition(input: {
    readonly placementId: string
    readonly conditionId: string
  }): TerrainConditionResolution
  turnHealing(input: {
    readonly placementId: string
  }): TerrainHealingResolution
  /** Project only Electric/Grassy compatibility rows for one authoritative actor. */
  projectFieldEffects(
    placementId: string,
    base?: MapFieldEffects | null,
  ): Required<MapFieldEffects>
}

export type TerrainMechanicsErrorCode =
  | 'duplicate-placement-id'
  | 'duplicate-token-id'

export class TerrainMechanicsError extends Error {
  readonly code: TerrainMechanicsErrorCode

  constructor(code: TerrainMechanicsErrorCode, message: string) {
    super(message)
    this.name = 'TerrainMechanicsError'
    this.code = code
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const indexedById = <Value>(input: {
  readonly values: readonly Value[]
  readonly idFor: (value: Value) => string
  readonly code: TerrainMechanicsErrorCode
  readonly label: string
}): ReadonlyMap<string, Value> => {
  const result = new Map<string, Value>()
  for (const value of input.values) {
    const id = input.idFor(value)
    if (result.has(id)) {
      throw new TerrainMechanicsError(input.code, `${input.label} ${id} is duplicated.`)
    }
    result.set(id, value)
  }
  return result
}

const isElectricGrassyTerrain = (
  kind: MapTerrainKind,
): kind is ElectricGrassyTerrainKind => kind === 'electric' || kind === 'grassy'

const traceEntry = (input: TerrainMechanicsTraceEntry): TerrainMechanicsTraceEntry => (
  deepFreeze({ ...input })
)

const activeTerrainInstances = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): readonly AuthoritativeTerrainInstance[] => deepFreeze(
  queryBattlefieldZones(map, { kind: 'all' }, { kinds: ['terrain'] }).flatMap(zone => (
    zone.kind === 'terrain' && isMapTerrainKind(zone.payload.terrainId)
      ? [{
          kind: zone.payload.terrainId,
          zoneId: zone.id,
          source: zone.source,
          geometry: zone.geometry,
        }]
      : []
  )),
)

const membershipFailureReason = (
  terrain: AuthoritativeTerrainInstance,
  outcome: Extract<
    TerrainMechanicsTraceOutcome,
    'outside-zone' | 'not-grounded' | 'superseded' | 'unavailable'
  >,
): string => `terrain.${terrain.kind}.${outcome}`

const terrainLabel = (kind: MapTerrainKind): string => (
  `${kind[0]!.toUpperCase()}${kind.slice(1)} Terrain`
)

/**
 * Build one immutable terrain query over current native and compatibility zones.
 * Geometry and grounding are evaluated together so global and local fields use
 * the same membership boundary before damage, condition, or lifecycle rules.
 */
export const createMoveAutomationTerrainResolver = (input: {
  readonly map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>
  readonly placements: readonly SheetPlacement[]
  readonly tokens: readonly SpawnedPokemon[]
  readonly targetStates: MoveAutomationTargetStateResolver
}): MoveAutomationTerrainResolver => {
  const active = activeTerrainInstances(input.map)
  const placements = indexedById({
    values: input.placements,
    idFor: placement => placement.id,
    code: 'duplicate-placement-id',
    label: 'Terrain placement',
  })
  const tokens = indexedById({
    values: input.tokens,
    idFor: token => token.id,
    code: 'duplicate-token-id',
    label: 'Terrain token',
  })

  const membership = (query: {
    readonly placementId: string
    readonly position?: GridAnchor
  }): TerrainMembershipResolution => {
    const placement = placements.get(query.placementId) ?? null
    const token = tokens.get(query.placementId) ?? null
    const state = input.targetStates.resolve(query.placementId)
    if (!placement || !token || !state) {
      return deepFreeze({
        placementId: query.placementId,
        grounding: null,
        terrains: [],
        trace: active.map(terrain => traceEntry({
          interaction: 'membership',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: query.placementId,
          outcome: 'unavailable',
          reasonCode: membershipFailureReason(terrain, 'unavailable'),
          value: null,
        })),
      })
    }

    const position = query.position ?? token.position
    const matchedIds = new Set(queryBattlefieldZones(input.map, {
      kind: 'placement',
      placementId: placement.id,
      sideId: placement.sideId ?? null,
      occupiedCells: gridFootprintCells(position, token),
    }, { kinds: ['terrain'] }).map(zone => zone.id))
    const selectedKinds = new Set<MapTerrainKind>()
    const terrains: AuthoritativeTerrainInstance[] = []
    const trace: TerrainMechanicsTraceEntry[] = []

    for (const terrain of active) {
      if (!matchedIds.has(terrain.zoneId)) {
        trace.push(traceEntry({
          interaction: 'membership',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: placement.id,
          outcome: 'outside-zone',
          reasonCode: membershipFailureReason(terrain, 'outside-zone'),
          value: false,
        }))
        continue
      }
      if (state.grounding !== 'grounded') {
        trace.push(traceEntry({
          interaction: 'membership',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: placement.id,
          outcome: 'not-grounded',
          reasonCode: membershipFailureReason(terrain, 'not-grounded'),
          value: state.grounding,
        }))
        continue
      }
      if (selectedKinds.has(terrain.kind)) {
        trace.push(traceEntry({
          interaction: 'membership',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: placement.id,
          outcome: 'superseded',
          reasonCode: membershipFailureReason(terrain, 'superseded'),
          value: terrains.find(candidate => candidate.kind === terrain.kind)?.zoneId ?? null,
        }))
        continue
      }
      selectedKinds.add(terrain.kind)
      terrains.push(terrain)
      trace.push(traceEntry({
        interaction: 'membership',
        terrainKind: terrain.kind,
        zoneId: terrain.zoneId,
        placementId: placement.id,
        outcome: 'applied',
        reasonCode: `terrain.${terrain.kind}.grounded-member`,
        value: true,
      }))
    }

    return deepFreeze({
      placementId: placement.id,
      grounding: state.grounding,
      terrains,
      trace,
    })
  }

  const movement = (query: {
    readonly placementId: string
    readonly from: GridAnchor
    readonly to: GridAnchor
  }): TerrainMovementResolution => {
    const previous = membership({ placementId: query.placementId, position: query.from })
    const current = membership({ placementId: query.placementId, position: query.to })
    const previousIds = new Set(previous.terrains.map(terrain => terrain.zoneId))
    const currentIds = new Set(current.terrains.map(terrain => terrain.zoneId))
    const enteredZoneIds = current.terrains
      .filter(terrain => !previousIds.has(terrain.zoneId))
      .map(terrain => terrain.zoneId)
    const leftZoneIds = previous.terrains
      .filter(terrain => !currentIds.has(terrain.zoneId))
      .map(terrain => terrain.zoneId)
    const retainedZoneIds = current.terrains
      .filter(terrain => previousIds.has(terrain.zoneId))
      .map(terrain => terrain.zoneId)
    const byId = new Map(active.map(terrain => [terrain.zoneId, terrain]))
    const movementTrace = [
      ...leftZoneIds.map(zoneId => ({ zoneId, outcome: 'left' as const })),
      ...enteredZoneIds.map(zoneId => ({ zoneId, outcome: 'entered' as const })),
      ...retainedZoneIds.map(zoneId => ({ zoneId, outcome: 'retained' as const })),
    ].flatMap(({ zoneId, outcome }) => {
      const terrain = byId.get(zoneId)
      return terrain ? [traceEntry({
        interaction: 'movement',
        terrainKind: terrain.kind,
        zoneId,
        placementId: query.placementId,
        outcome,
        reasonCode: `terrain.${terrain.kind}.movement-${outcome}`,
        value: true,
      })] : []
    })
    return deepFreeze({
      placementId: query.placementId,
      enteredZoneIds,
      leftZoneIds,
      retainedZoneIds,
      trace: movementTrace,
    })
  }

  const damage = (query: {
    readonly placementId: string
    readonly moveType: string
    readonly targetImmune?: boolean
  }): TerrainDamageResolution => {
    const resolvedMembership = membership({ placementId: query.placementId })
    const modifiers: MoveDamageModifier[] = []
    const trace: TerrainMechanicsTraceEntry[] = []
    const effectiveIds = new Set(resolvedMembership.terrains.map(terrain => terrain.zoneId))

    for (const membershipTrace of resolvedMembership.trace) {
      if (!isElectricGrassyTerrain(membershipTrace.terrainKind)) continue
      if (!effectiveIds.has(membershipTrace.zoneId)) {
        trace.push(traceEntry({ ...membershipTrace, interaction: 'damage' }))
      }
    }
    for (const terrain of resolvedMembership.terrains) {
      if (!isElectricGrassyTerrain(terrain.kind)) continue
      const policy = electricGrassyTerrainDamagePolicy(terrain.kind, query.moveType)
      if (!policy) {
        trace.push(traceEntry({
          interaction: 'damage',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: query.placementId,
          outcome: 'not-applicable',
          reasonCode: `terrain.${terrain.kind}.damage-type-not-applicable`,
          value: null,
        }))
        continue
      }
      if (query.targetImmune === true) {
        trace.push(traceEntry({
          interaction: 'damage',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: query.placementId,
          outcome: 'prevented',
          reasonCode: 'terrain.damage.target-immune',
          value: null,
        }))
        continue
      }
      modifiers.push({
        id: `damage.terrain.${terrain.kind}.${policy.typeId}`,
        stage: 'pre-type-modifiers',
        priority: 220,
        source: { kind: 'field', id: terrain.zoneId },
        stackingGroup: `terrain.${terrain.kind}.damage-roll`,
        reasonCode: policy.reasonCode,
        operation: 'add',
        value: policy.value,
      })
      trace.push(traceEntry({
        interaction: 'damage',
        terrainKind: terrain.kind,
        zoneId: terrain.zoneId,
        placementId: query.placementId,
        outcome: 'applied',
        reasonCode: policy.reasonCode,
        value: policy.value,
      }))
    }
    return deepFreeze({ modifiers, trace })
  }

  const condition = (query: {
    readonly placementId: string
    readonly conditionId: string
  }): TerrainConditionResolution => {
    if ((normalizeConditionName(query.conditionId) ?? query.conditionId) !== 'Sleep') {
      return deepFreeze({ blockedBy: null, trace: [] })
    }
    const resolvedMembership = membership({ placementId: query.placementId })
    const electric = resolvedMembership.terrains.find(terrain => terrain.kind === 'electric') ?? null
    const trace = resolvedMembership.trace
      .filter(entry => entry.terrainKind === 'electric')
      .map(entry => traceEntry({ ...entry, interaction: 'condition' }))
    if (!electric) return deepFreeze({ blockedBy: null, trace })
    const reasonCode = 'terrain.electric.sleep-prevention'
    return deepFreeze({
      blockedBy: `${terrainLabel(electric.kind)} (${electric.zoneId})`,
      trace: [traceEntry({
        interaction: 'condition',
        terrainKind: electric.kind,
        zoneId: electric.zoneId,
        placementId: query.placementId,
        outcome: 'prevented',
        reasonCode,
        value: 'sleep',
      })],
    })
  }

  const turnHealing = (query: {
    readonly placementId: string
  }): TerrainHealingResolution => {
    const resolvedMembership = membership({ placementId: query.placementId })
    const grassy = resolvedMembership.terrains.find(terrain => terrain.kind === 'grassy') ?? null
    const trace = resolvedMembership.trace
      .filter(entry => entry.terrainKind === 'grassy')
      .map(entry => traceEntry({ ...entry, interaction: 'healing' }))
    if (!grassy) {
      return deepFreeze({ applies: false, percent: null, zoneId: null, trace })
    }
    return deepFreeze({
      applies: true,
      percent: GRASSY_TERRAIN_TURN_HEAL_PERCENT,
      zoneId: grassy.zoneId,
      trace: [traceEntry({
        interaction: 'healing',
        terrainKind: grassy.kind,
        zoneId: grassy.zoneId,
        placementId: query.placementId,
        outcome: 'applied',
        reasonCode: 'terrain.grassy.turn-start-healing',
        value: GRASSY_TERRAIN_TURN_HEAL_PERCENT,
      })],
    })
  }

  return Object.freeze({
    active: () => active,
    membership,
    movement,
    damage,
    condition,
    turnHealing,
    projectFieldEffects: (
      placementId: string,
      base: MapFieldEffects | null = input.map.fieldEffects ?? null,
    ) => {
      const projected = cloneMapFieldEffects(base)
      const retained = projected.terrains.filter(terrain => !isElectricGrassyTerrain(terrain.kind))
      const effective = membership({ placementId }).terrains
        .filter((terrain): terrain is AuthoritativeTerrainInstance & {
          readonly kind: ElectricGrassyTerrainKind
        } => isElectricGrassyTerrain(terrain.kind))
        .map(terrain => ({
          kind: terrain.kind,
          scope: terrain.geometry.kind === 'battlefield' ? 'field' as const : 'area' as const,
          source: terrain.zoneId,
        }))
      projected.terrains = [...retained, ...effective]
      return deepFreeze(projected)
    },
  })
}
