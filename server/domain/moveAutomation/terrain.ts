import type {
  EncounterZoneGeometry,
  EncounterZoneSource,
} from '#shared/moveAutomation/encounterZones'
import {
  GRASSY_TERRAIN_TURN_HEAL_PERCENT,
  MOVE_AUTOMATION_TERRAIN_KINDS,
  terrainDamagePolicy,
  type ElectricGrassyTerrainKind,
  type MistyTerrainConditionProtection,
  type MoveAutomationTerrainKind,
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
import {
  isStatusAfflictionCondition,
  normalizeConditionName,
} from '~/utils/statusConditions'
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
  | 'action'

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
  readonly firstTurnProtection: MistyTerrainConditionProtection | null
  readonly trace: readonly TerrainMechanicsTraceEntry[]
}

export type TerrainActionTiming = 'ordinary' | 'priority' | 'interrupt' | 'reaction'

export interface TerrainActionResolution {
  readonly allowed: boolean
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
    /** Authoritative move user. */
    readonly placementId: string
    /** Required for target-sensitive Misty Terrain and local terrain geometry. */
    readonly targetPlacementId?: string
    readonly moveType: string
    readonly targetImmune?: boolean
  }): TerrainDamageResolution
  condition(input: {
    readonly placementId: string
    readonly conditionId: string
  }): TerrainConditionResolution
  action(input: {
    readonly placementId: string
    readonly timing: TerrainActionTiming
  }): TerrainActionResolution
  turnHealing(input: {
    readonly placementId: string
  }): TerrainHealingResolution
  /** Project exact authoritative terrain rows for legacy damage compatibility. */
  projectFieldEffects(
    placementId: string,
    base?: MapFieldEffects | null,
    targetPlacementId?: string,
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

const isMoveAutomationTerrain = (
  kind: MapTerrainKind,
): kind is MoveAutomationTerrainKind => (
  (MOVE_AUTOMATION_TERRAIN_KINDS as readonly string[]).includes(kind)
)

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
  readonly map: Pick<
    TabletopMap,
    'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState' | 'initiative'
  >
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

  const spatialMembership = (query: {
    readonly placementId: string
    readonly position?: GridAnchor
  }): {
    readonly available: boolean
    readonly matchedIds: ReadonlySet<string>
  } => {
    const placement = placements.get(query.placementId) ?? null
    const token = tokens.get(query.placementId) ?? null
    if (!placement || !token) {
      return { available: false, matchedIds: new Set<string>() }
    }
    const position = query.position ?? token.position
    return {
      available: true,
      matchedIds: new Set(queryBattlefieldZones(input.map, {
        kind: 'placement',
        placementId: placement.id,
        sideId: placement.sideId ?? null,
        occupiedCells: gridFootprintCells(position, token),
      }, { kinds: ['terrain'] }).map(zone => zone.id)),
    }
  }

  const membership = (query: {
    readonly placementId: string
    readonly position?: GridAnchor
  }): TerrainMembershipResolution => {
    const placement = placements.get(query.placementId) ?? null
    const token = tokens.get(query.placementId) ?? null
    const state = input.targetStates.resolve(query.placementId)
    const spatial = spatialMembership(query)
    if (!placement || !token || !state || !spatial.available) {
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

    const matchedIds = spatial.matchedIds
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

  const damageTerrainMembership = (query: {
    readonly placementId: string
    readonly targetPlacementId?: string
  }): {
    readonly terrains: readonly AuthoritativeTerrainInstance[]
    readonly qualifyingZoneIds: ReadonlySet<string>
    readonly sourcePlacementByZoneId: ReadonlyMap<string, string>
    readonly actorMembership: TerrainMembershipResolution
    readonly targetMembership: TerrainMembershipResolution | null
    readonly actorSpatial: ReturnType<typeof spatialMembership>
    readonly targetSpatial: ReturnType<typeof spatialMembership> | null
  } => {
    const actorMembership = membership({ placementId: query.placementId })
    const targetMembership = query.targetPlacementId
      ? membership({ placementId: query.targetPlacementId })
      : null
    const actorSpatial = spatialMembership({ placementId: query.placementId })
    const targetSpatial = query.targetPlacementId
      ? spatialMembership({ placementId: query.targetPlacementId })
      : null
    const actorGroundedIds = new Set(actorMembership.terrains.map(terrain => terrain.zoneId))
    const targetGroundedIds = new Set(
      targetMembership?.terrains.map(terrain => terrain.zoneId) ?? [],
    )
    const selectedKinds = new Set<MoveAutomationTerrainKind>()
    const terrains: AuthoritativeTerrainInstance[] = []
    const qualifyingZoneIds = new Set<string>()
    const sourcePlacementByZoneId = new Map<string, string>()

    for (const terrain of active) {
      if (!isMoveAutomationTerrain(terrain.kind)) continue
      const actorQualifies = terrain.kind === 'psychic'
        ? actorSpatial.matchedIds.has(terrain.zoneId)
        : actorGroundedIds.has(terrain.zoneId)
      const targetQualifies = terrain.kind === 'misty'
        ? targetGroundedIds.has(terrain.zoneId)
        : terrain.kind === 'psychic'
          ? Boolean(targetSpatial?.matchedIds.has(terrain.zoneId))
          : false
      if (!actorQualifies && !targetQualifies) continue
      qualifyingZoneIds.add(terrain.zoneId)
      sourcePlacementByZoneId.set(
        terrain.zoneId,
        actorQualifies ? query.placementId : query.targetPlacementId!,
      )
      if (selectedKinds.has(terrain.kind)) continue
      selectedKinds.add(terrain.kind)
      terrains.push(terrain)
    }
    return {
      terrains,
      qualifyingZoneIds,
      sourcePlacementByZoneId,
      actorMembership,
      targetMembership,
      actorSpatial,
      targetSpatial,
    }
  }

  const damage = (query: {
    readonly placementId: string
    readonly targetPlacementId?: string
    readonly moveType: string
    readonly targetImmune?: boolean
  }): TerrainDamageResolution => {
    const resolved = damageTerrainMembership(query)
    const effectiveIds = new Set(resolved.terrains.map(terrain => terrain.zoneId))
    const modifiers: MoveDamageModifier[] = []
    const trace: TerrainMechanicsTraceEntry[] = []
    const traceKeys = new Set<string>()
    const appendTrace = (entry: TerrainMechanicsTraceEntry): void => {
      const key = `${entry.interaction}:${entry.terrainKind}:${entry.zoneId}:${entry.placementId}:${entry.outcome}`
      if (traceKeys.has(key)) return
      traceKeys.add(key)
      trace.push(traceEntry(entry))
    }

    const appendGroundingEvidence = (
      terrain: AuthoritativeTerrainInstance,
      resolution: TerrainMembershipResolution | null,
    ): void => {
      for (const entry of resolution?.trace ?? []) {
        if (entry.zoneId !== terrain.zoneId || entry.outcome === 'applied') continue
        appendTrace({ ...entry, interaction: 'damage' })
      }
    }

    for (const terrain of active) {
      if (!isMoveAutomationTerrain(terrain.kind)) continue
      const qualifies = resolved.qualifyingZoneIds.has(terrain.zoneId)
      const effective = effectiveIds.has(terrain.zoneId)
      if (isElectricGrassyTerrain(terrain.kind)) {
        if (!qualifies) appendGroundingEvidence(terrain, resolved.actorMembership)
      }
      else if (terrain.kind === 'misty') {
        appendGroundingEvidence(terrain, resolved.actorMembership)
        appendGroundingEvidence(terrain, resolved.targetMembership)
      }
      else if (!qualifies) {
        const spatialAvailable = resolved.actorSpatial.available
          || Boolean(resolved.targetSpatial?.available)
        appendTrace({
          interaction: 'damage',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: query.placementId,
          outcome: spatialAvailable ? 'outside-zone' : 'unavailable',
          reasonCode: membershipFailureReason(
            terrain,
            spatialAvailable ? 'outside-zone' : 'unavailable',
          ),
          value: spatialAvailable ? false : null,
        })
      }
      if (!qualifies) continue

      const selected = resolved.terrains.find(candidate => candidate.kind === terrain.kind)
      if (!effective || selected?.zoneId !== terrain.zoneId) {
        appendTrace({
          interaction: 'damage',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: resolved.sourcePlacementByZoneId.get(terrain.zoneId) ?? query.placementId,
          outcome: 'superseded',
          reasonCode: membershipFailureReason(terrain, 'superseded'),
          value: selected?.zoneId ?? null,
        })
        continue
      }

      const policy = terrainDamagePolicy(terrain.kind, query.moveType)
      const sourcePlacementId = resolved.sourcePlacementByZoneId.get(terrain.zoneId)
        ?? query.placementId
      if (!policy) {
        appendTrace({
          interaction: 'damage',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: sourcePlacementId,
          outcome: 'not-applicable',
          reasonCode: `terrain.${terrain.kind}.damage-type-not-applicable`,
          value: null,
        })
        continue
      }
      if (query.targetImmune === true) {
        appendTrace({
          interaction: 'damage',
          terrainKind: terrain.kind,
          zoneId: terrain.zoneId,
          placementId: sourcePlacementId,
          outcome: 'prevented',
          reasonCode: 'terrain.damage.target-immune',
          value: null,
        })
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
      appendTrace({
        interaction: 'damage',
        terrainKind: terrain.kind,
        zoneId: terrain.zoneId,
        placementId: sourcePlacementId,
        outcome: 'applied',
        reasonCode: policy.reasonCode,
        value: policy.value,
      })
    }
    return deepFreeze({ modifiers, trace })
  }

  const condition = (query: {
    readonly placementId: string
    readonly conditionId: string
  }): TerrainConditionResolution => {
    const canonical = normalizeConditionName(query.conditionId) ?? query.conditionId
    const isSleep = canonical === 'Sleep'
    const isStatusAffliction = isStatusAfflictionCondition(canonical)
    if (!isSleep && !isStatusAffliction) {
      return deepFreeze({ blockedBy: null, firstTurnProtection: null, trace: [] })
    }
    const resolvedMembership = membership({ placementId: query.placementId })
    const electric = isSleep
      ? resolvedMembership.terrains.find(terrain => terrain.kind === 'electric') ?? null
      : null
    const misty = isStatusAffliction
      ? resolvedMembership.terrains.find(terrain => terrain.kind === 'misty') ?? null
      : null
    const relevantKinds = new Set<MapTerrainKind>([
      ...(isSleep ? ['electric' as const] : []),
      ...(isStatusAffliction ? ['misty' as const] : []),
    ])
    const membershipTrace = resolvedMembership.trace
      .filter(entry => relevantKinds.has(entry.terrainKind))
      .filter(entry => entry.outcome !== 'applied')
      .map(entry => traceEntry({ ...entry, interaction: 'condition' }))
    if (electric) {
      const reasonCode = 'terrain.electric.sleep-prevention'
      return deepFreeze({
        blockedBy: `${terrainLabel(electric.kind)} (${electric.zoneId})`,
        firstTurnProtection: null,
        trace: [
          ...membershipTrace,
          traceEntry({
            interaction: 'condition',
            terrainKind: electric.kind,
            zoneId: electric.zoneId,
            placementId: query.placementId,
            outcome: 'prevented',
            reasonCode,
            value: 'sleep',
          }),
        ],
      })
    }
    if (!misty) {
      return deepFreeze({
        blockedBy: null,
        firstTurnProtection: null,
        trace: membershipTrace,
      })
    }
    const protection: MistyTerrainConditionProtection = {
      kind: 'ignore-first-turn',
      terrainKind: 'misty',
      zoneId: misty.zoneId,
      sourceLabel: `${terrainLabel(misty.kind)} (${misty.zoneId})`,
      reasonCode: 'terrain.misty.first-turn-status-protection',
    }
    return deepFreeze({
      blockedBy: null,
      firstTurnProtection: protection,
      trace: [
        ...membershipTrace,
        traceEntry({
          interaction: 'condition',
          terrainKind: misty.kind,
          zoneId: misty.zoneId,
          placementId: query.placementId,
          outcome: 'applied',
          reasonCode: protection.reasonCode,
          value: canonical,
        }),
      ],
    })
  }

  const action = (query: {
    readonly placementId: string
    readonly timing: TerrainActionTiming
  }): TerrainActionResolution => {
    if (query.timing === 'ordinary') {
      return deepFreeze({ allowed: true, blockedBy: null, trace: [] })
    }
    const resolvedMembership = membership({ placementId: query.placementId })
    const psychic = resolvedMembership.terrains.find(terrain => terrain.kind === 'psychic') ?? null
    const trace = resolvedMembership.trace
      .filter(entry => entry.terrainKind === 'psychic' && entry.outcome !== 'applied')
      .map(entry => traceEntry({ ...entry, interaction: 'action' }))
    if (!psychic) return deepFreeze({ allowed: true, blockedBy: null, trace })
    const decision = (result: {
      readonly allowed: boolean
      readonly outcome: Extract<TerrainMechanicsTraceOutcome, 'not-applicable' | 'prevented'>
      readonly reasonCode: string
    }): TerrainActionResolution => deepFreeze({
      allowed: result.allowed,
      blockedBy: result.allowed ? null : `${terrainLabel(psychic.kind)} (${psychic.zoneId})`,
      trace: [
        ...trace,
        traceEntry({
          interaction: 'action',
          terrainKind: psychic.kind,
          zoneId: psychic.zoneId,
          placementId: query.placementId,
          outcome: result.outcome,
          reasonCode: result.reasonCode,
          value: query.timing,
        }),
      ],
    })
    if (placements.get(query.placementId)?.sheetKind !== 'pokemon') {
      return decision({
        allowed: true,
        outcome: 'not-applicable',
        reasonCode: 'terrain.psychic.non-pokemon-action-unrestricted',
      })
    }
    if (input.map.initiative?.activeId === query.placementId) {
      return decision({
        allowed: true,
        outcome: 'not-applicable',
        reasonCode: 'terrain.psychic.action-on-own-initiative',
      })
    }
    return decision({
      allowed: false,
      outcome: 'prevented',
      reasonCode: 'terrain.psychic.off-turn-priority-interrupt-prevention',
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
    action,
    turnHealing,
    projectFieldEffects: (
      placementId: string,
      base: MapFieldEffects | null = input.map.fieldEffects ?? null,
      targetPlacementId?: string,
    ) => {
      const projected = cloneMapFieldEffects(base)
      const retained = projected.terrains.filter(terrain => !isMoveAutomationTerrain(terrain.kind))
      const effective = damageTerrainMembership({
        placementId,
        ...(targetPlacementId ? { targetPlacementId } : {}),
      }).terrains.map(terrain => ({
        kind: terrain.kind,
        scope: terrain.geometry.kind === 'battlefield' ? 'field' as const : 'area' as const,
        source: terrain.zoneId,
      }))
      projected.terrains = [...retained, ...effective]
      return deepFreeze(projected)
    },
  })
}
