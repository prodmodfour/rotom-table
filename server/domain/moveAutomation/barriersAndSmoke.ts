import type { MoveAutomationRollModifier } from '#shared/moveAutomation/random'
import {
  ENCOUNTER_BARRIER_CANONICAL_PROFILE,
  ENCOUNTER_SMOKESCREEN_ACCURACY_PENALTY,
  type EncounterBarrierZone,
  type EncounterSideId,
  type EncounterSmokeZone,
  type EncounterZoneCell,
  type EncounterZoneSource,
  type EncounterZoneTargetingModifier,
} from '#shared/moveAutomation/encounterState'
import type { GridAnchor, GridDimensions, TabletopMap } from '~/types/map'
import {
  resolveMoveDamagePipeline,
  type MoveDamageModifier,
  type MoveDamagePipelineResult,
} from '~/utils/moveAutomationDamagePipeline'
import { computeMultiplier, POKEMON_TYPES, type PokemonType } from '~/utils/typeChart'
import { canonicalBattlefieldZoneComponents } from './battlefieldZoneDefinitions'
import { projectBattlefieldZones } from './battlefieldZones'

export const MOVE_AUTOMATION_SMOKESCREEN_ACCURACY_PENALTY =
  ENCOUNTER_SMOKESCREEN_ACCURACY_PENALTY
export const MOVE_AUTOMATION_BARRIER_HIT_POINTS =
  ENCOUNTER_BARRIER_CANONICAL_PROFILE.maximumHitPoints
export const MOVE_AUTOMATION_BARRIER_DAMAGE_REDUCTION =
  ENCOUNTER_BARRIER_CANONICAL_PROFILE.damageReduction
export const MOVE_AUTOMATION_BARRIER_HEIGHT =
  ENCOUNTER_BARRIER_CANONICAL_PROFILE.height
export const MOVE_AUTOMATION_BARRIER_TYPE_ID =
  ENCOUNTER_BARRIER_CANONICAL_PROFILE.typeIds[0]

export const MOVE_AUTOMATION_OBSCURATION_LIMITS = Object.freeze({
  identifierChars: 160,
  placements: 512,
  footprintExtent: 32,
  footprintCells: 512,
  areaCells: 512,
  incomingDamage: 1_000_000_000,
})

export interface MoveAutomationObscurationPlacement {
  readonly id: string
  readonly sideId?: EncounterSideId
  readonly position: GridAnchor
  readonly base: number
  readonly clearance?: number
}

export interface AuthoritativeSmokeZone {
  readonly zoneId: string
  readonly smokeId: string
  readonly source: EncounterZoneSource
  readonly sideId: EncounterSideId | null
  readonly cells: readonly EncounterZoneCell[]
  readonly targetingModifiers: readonly EncounterZoneTargetingModifier[]
}

export interface AuthoritativeBarrierZone {
  readonly zoneId: string
  readonly barrierId: string
  readonly source: EncounterZoneSource
  readonly sideId: EncounterSideId | null
  /** One exact ground/anchor cell for this independently destructible segment. */
  readonly cell: EncounterZoneCell
  /** Complete vertical Blocking Terrain occupied by the segment. */
  readonly occupiedCells: readonly EncounterZoneCell[]
  readonly currentHitPoints: number
  readonly maximumHitPoints: number
  readonly damageReduction: number
  readonly typeIds: readonly string[]
}

export interface MoveAutomationBarrierSightCell {
  readonly zoneId: string
  readonly source: EncounterZoneSource
  readonly sideId: EncounterSideId | null
  readonly cell: EncounterZoneCell
}

export type BattlefieldSmokeAccuracyTarget =
  | { readonly kind: 'placement'; readonly placementId: string }
  | { readonly kind: 'area'; readonly cells: readonly EncounterZoneCell[] }

export type BattlefieldSmokeAccuracyOutcome =
  | 'applied'
  | 'outside-zone'
  | 'superseded'

export interface BattlefieldSmokeAccuracyTraceEntry {
  readonly interaction: 'accuracy'
  readonly zoneId: string
  readonly smokeId: string
  readonly source: EncounterZoneSource
  readonly sideId: EncounterSideId | null
  readonly sourcePlacementId: string
  readonly targetKind: BattlefieldSmokeAccuracyTarget['kind']
  readonly targetPlacementId: string | null
  readonly sourceInside: boolean
  readonly targetInside: boolean
  readonly outcome: BattlefieldSmokeAccuracyOutcome
  readonly reasonCode: string
  readonly modifierId: string | null
  readonly value: number | null
}

export interface BattlefieldSmokeAccuracyResolution {
  readonly sourcePlacementId: string
  readonly target: BattlefieldSmokeAccuracyTarget
  readonly baseValue: number
  readonly value: number
  readonly modifierTotal: number
  readonly affectingZoneIds: readonly string[]
  readonly modifiers: readonly MoveAutomationRollModifier[]
  readonly trace: readonly BattlefieldSmokeAccuracyTraceEntry[]
}

export type BattlefieldBarrierDamageOutcome = 'no-damage' | 'damaged' | 'destroyed'

export interface BattlefieldBarrierDamageResolution {
  readonly zoneId: string
  readonly barrierId: string
  readonly source: EncounterZoneSource
  readonly sideId: EncounterSideId | null
  readonly moveType: PokemonType
  readonly defenderTypes: readonly PokemonType[]
  readonly incomingDamage: number
  readonly damageReduction: number
  readonly damageAfterReduction: number
  readonly effectivenessMultiplier: number
  readonly hitPointLoss: number
  readonly damagePipeline: MoveDamagePipelineResult
  readonly previousHitPoints: number
  readonly currentHitPoints: number
  readonly outcome: BattlefieldBarrierDamageOutcome
  /** Exact typed target accepted by the existing map-zone removal reducer. */
  readonly removalTarget: {
    readonly kind: 'zone-id'
    readonly zoneId: string
  } | null
  /** Null when destroyed; otherwise a detached next durable zone value. */
  readonly updatedZone: EncounterBarrierZone | null
}

export interface MoveAutomationBarriersAndSmokeResolver {
  smoke(): readonly AuthoritativeSmokeZone[]
  barriers(): readonly AuthoritativeBarrierZone[]
  barrierSightCells(): readonly MoveAutomationBarrierSightCell[]
  accuracy(input: {
    readonly sourcePlacementId: string
    readonly target: BattlefieldSmokeAccuracyTarget
    /** Current authoritative Accuracy before smoke operations, for set/multiply policies. */
    readonly baseValue: number
  }): BattlefieldSmokeAccuracyResolution
  damageBarrier(input: {
    readonly zoneId: string
    /** Damage after the attack roll and attacking stat, before object DR and type. */
    readonly incomingDamage: number
    readonly moveType: string
  }): BattlefieldBarrierDamageResolution
}

export type MoveAutomationBarriersAndSmokeErrorCode =
  | 'invalid-map'
  | 'invalid-placement'
  | 'duplicate-placement-id'
  | 'placement-missing'
  | 'invalid-area-cells'
  | 'barrier-missing'
  | 'invalid-damage'
  | 'invalid-type'

export class MoveAutomationBarriersAndSmokeError extends Error {
  readonly code: MoveAutomationBarriersAndSmokeErrorCode

  constructor(code: MoveAutomationBarriersAndSmokeErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationBarriersAndSmokeError'
    this.code = code
  }
}

type PlacementSnapshot = Readonly<{
  id: string
  cells: readonly EncounterZoneCell[]
}>

const fail = (
  code: MoveAutomationBarriersAndSmokeErrorCode,
  message: string,
): never => {
  throw new MoveAutomationBarriersAndSmokeError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const validId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MOVE_AUTOMATION_OBSCURATION_LIMITS.identifierChars
  && value.trim() === value
)

const validDimensions = (value: GridDimensions): boolean => (
  Number.isSafeInteger(value.x) && value.x > 0
  && Number.isSafeInteger(value.y) && value.y > 0
  && Number.isSafeInteger(value.z) && value.z > 0
)

const cellKey = (cell: EncounterZoneCell): string => `${cell.x}:${cell.y}:${cell.z}`

const cloneCell = (cell: EncounterZoneCell): EncounterZoneCell => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cellInBounds = (cell: EncounterZoneCell, dimensions: GridDimensions): boolean => (
  Number.isSafeInteger(cell.x)
  && Number.isSafeInteger(cell.y)
  && Number.isSafeInteger(cell.z)
  && cell.x >= 0 && cell.x < dimensions.x
  && cell.y >= 0 && cell.y < dimensions.y
  && cell.z >= 0 && cell.z < dimensions.z
)

const assertCells = (
  cells: readonly EncounterZoneCell[],
  dimensions: GridDimensions,
  label: string,
  maximum: number,
): readonly EncounterZoneCell[] => {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > maximum) {
    return fail('invalid-area-cells', `${label} must be a bounded non-empty cell array.`)
  }
  if (cells.some(cell => !cellInBounds(cell, dimensions))) {
    return fail('invalid-area-cells', `${label} contains an out-of-bounds or malformed cell.`)
  }
  if (new Set(cells.map(cellKey)).size !== cells.length) {
    return fail('invalid-area-cells', `${label} must not contain duplicate cells.`)
  }
  return cells.map(cloneCell)
}

const placementSnapshot = (
  placement: MoveAutomationObscurationPlacement,
  dimensions: GridDimensions,
): PlacementSnapshot => {
  const clearance = placement.clearance ?? 1
  if (
    !validId(placement.id)
    || !placement.position
    || !Number.isSafeInteger(placement.position.x)
    || !Number.isSafeInteger(placement.position.y)
    || !Number.isSafeInteger(placement.position.z)
    || !Number.isSafeInteger(placement.base)
    || placement.base < 1
    || placement.base > MOVE_AUTOMATION_OBSCURATION_LIMITS.footprintExtent
    || !Number.isSafeInteger(clearance)
    || clearance < 1
    || clearance > MOVE_AUTOMATION_OBSCURATION_LIMITS.footprintExtent
  ) {
    return fail('invalid-placement', 'Obscuration placements require bounded IDs and footprints.')
  }
  const count = placement.base * placement.base * clearance
  if (count > MOVE_AUTOMATION_OBSCURATION_LIMITS.footprintCells) {
    return fail('invalid-placement', `Placement ${placement.id} exceeds the footprint-cell limit.`)
  }
  const cells: EncounterZoneCell[] = []
  for (let x = placement.position.x; x < placement.position.x + placement.base; x += 1) {
    for (let y = placement.position.y; y < placement.position.y + clearance; y += 1) {
      for (let z = placement.position.z; z < placement.position.z + placement.base; z += 1) {
        const cell = { x, y, z }
        if (!cellInBounds(cell, dimensions)) {
          return fail('invalid-placement', `Placement ${placement.id} footprint is outside map bounds.`)
        }
        cells.push(cell)
      }
    }
  }
  return deepFreeze({ id: placement.id, cells })
}

const canonicalTargetingModifiers = (
  zone: EncounterSmokeZone | EncounterBarrierZone,
): readonly EncounterZoneTargetingModifier[] => canonicalBattlefieldZoneComponents({
  kind: zone.kind,
  effectId: zone.kind === 'smoke' ? zone.payload.smokeId : zone.payload.barrierId,
}).modifiers.targeting

const mergedTargetingModifiers = (
  zone: EncounterSmokeZone | EncounterBarrierZone,
): readonly EncounterZoneTargetingModifier[] => {
  const byId = new Map(zone.modifiers.targeting.map(modifier => [modifier.id, modifier]))
  for (const modifier of canonicalTargetingModifiers(zone)) {
    if (!byId.has(modifier.id)) byId.set(modifier.id, modifier)
  }
  return [...byId.values()]
}

const exactZoneCells = (
  zone: EncounterSmokeZone | EncounterBarrierZone,
): readonly EncounterZoneCell[] => zone.geometry.kind === 'cells'
  ? zone.geometry.cells
  : fail('invalid-map', `${zone.kind} zone ${zone.id} has non-cell geometry.`)

const authoritativeSmokeZone = (zone: EncounterSmokeZone): AuthoritativeSmokeZone => ({
  zoneId: zone.id,
  smokeId: zone.payload.smokeId,
  source: zone.source,
  sideId: zone.sideId,
  cells: exactZoneCells(zone).map(cloneCell),
  targetingModifiers: mergedTargetingModifiers(zone),
})

/** Expand one exact segment anchor through its authoritative vertical height. */
export const barrierOccupiedCells = (
  zone: EncounterBarrierZone,
  dimensions: GridDimensions,
): readonly EncounterZoneCell[] => {
  const anchor = exactZoneCells(zone)[0]
    ?? fail('invalid-map', `Barrier ${zone.id} has no exact segment cell.`)
  const cells = Array.from({ length: zone.payload.height }, (_, offset) => ({
    x: anchor.x,
    y: anchor.y + offset,
    z: anchor.z,
  }))
  if (cells.some(cell => !cellInBounds(cell, dimensions))) {
    return fail('invalid-map', `Barrier ${zone.id} extends outside the authoritative map.`)
  }
  return deepFreeze(cells)
}

const authoritativeBarrierZone = (
  zone: EncounterBarrierZone,
  dimensions: GridDimensions,
): AuthoritativeBarrierZone => ({
  zoneId: zone.id,
  barrierId: zone.payload.barrierId,
  source: zone.source,
  sideId: zone.sideId,
  cell: cloneCell(exactZoneCells(zone)[0]!),
  occupiedCells: barrierOccupiedCells(zone, dimensions),
  currentHitPoints: zone.payload.currentHitPoints,
  maximumHitPoints: zone.payload.maximumHitPoints,
  damageReduction: zone.payload.damageReduction,
  typeIds: [...zone.payload.typeIds],
})

const intersects = (
  left: readonly EncounterZoneCell[],
  rightKeys: ReadonlySet<string>,
): boolean => left.some(cell => rightKeys.has(cellKey(cell)))

const canonicalType = (value: string): PokemonType | null => {
  const normalized = value.trim().toLowerCase()
  return POKEMON_TYPES.find(type => type.toLowerCase() === normalized) ?? null
}

const resolveBarrierDamage = (input: {
  readonly zone: EncounterBarrierZone
  readonly incomingDamage: number
  readonly moveType: string
}): BattlefieldBarrierDamageResolution => {
  if (
    !Number.isSafeInteger(input.incomingDamage)
    || input.incomingDamage < 0
    || input.incomingDamage > MOVE_AUTOMATION_OBSCURATION_LIMITS.incomingDamage
  ) {
    return fail('invalid-damage', 'Barrier incoming damage must be a bounded non-negative integer.')
  }
  const moveType = canonicalType(input.moveType)
  if (!moveType) return fail('invalid-type', `Barrier damage type ${input.moveType} is unknown.`)
  const defenderTypes = input.zone.payload.typeIds.map((typeId) => {
    const type = canonicalType(typeId)
    return type ?? fail('invalid-type', `Barrier defender type ${typeId} is unknown.`)
  })
  const effectivenessMultiplier = computeMultiplier(moveType, defenderTypes)
  const source = { kind: 'field', id: input.zone.id }
  const modifiers: MoveDamageModifier[] = [
    {
      id: 'barrier.damage.incoming',
      stage: 'base-damage-base',
      priority: 0,
      source,
      stackingGroup: 'barrier.incoming-damage',
      reasonCode: 'barrier.incoming-damage',
      operation: 'set',
      value: input.incomingDamage,
    },
    {
      id: 'barrier.damage.reduction',
      stage: 'pre-type-modifiers',
      priority: 0,
      source,
      stackingGroup: 'barrier.damage-reduction',
      reasonCode: 'barrier.damage-reduction',
      operation: 'subtract',
      value: input.zone.payload.damageReduction,
    },
    {
      id: 'barrier.damage.nonnegative',
      stage: 'pre-type-modifiers',
      priority: 1,
      source,
      stackingGroup: 'barrier.nonnegative-damage',
      reasonCode: 'barrier.nonnegative-damage',
      operation: 'floor-at-least',
      value: 0,
    },
    ...(input.incomingDamage === 0 ? [] : [{
      id: 'barrier.damage.minimum',
      stage: 'pre-type-modifiers' as const,
      priority: 2,
      source,
      stackingGroup: 'barrier.minimum-damage',
      reasonCode: 'barrier.minimum-damage',
      operation: 'floor-at-least' as const,
      value: 1,
    }]),
    {
      id: 'barrier.damage.effectiveness',
      stage: 'type-effectiveness',
      priority: 0,
      source,
      stackingGroup: 'barrier.type-effectiveness',
      reasonCode: 'barrier.type-effectiveness',
      operation: 'multiply-floor',
      value: effectivenessMultiplier,
    },
  ]
  const damagePipeline = resolveMoveDamagePipeline({ damageBase: null, modifiers })
  const damageAfterReduction = damagePipeline.preTypeDamage
  const hitPointLoss = damagePipeline.hpLoss
  const currentHitPoints = Math.max(0, input.zone.payload.currentHitPoints - hitPointLoss)
  const destroyed = currentHitPoints === 0
  const updatedZone: EncounterBarrierZone | null = destroyed
    ? null
    : deepFreeze({
        ...structuredClone(input.zone),
        payload: {
          ...structuredClone(input.zone.payload),
          currentHitPoints,
        },
      })
  return deepFreeze({
    zoneId: input.zone.id,
    barrierId: input.zone.payload.barrierId,
    source: input.zone.source,
    sideId: input.zone.sideId,
    moveType,
    defenderTypes,
    incomingDamage: input.incomingDamage,
    damageReduction: input.zone.payload.damageReduction,
    damageAfterReduction,
    effectivenessMultiplier,
    hitPointLoss,
    damagePipeline,
    previousHitPoints: input.zone.payload.currentHitPoints,
    currentHitPoints,
    outcome: destroyed ? 'destroyed' : hitPointLoss > 0 ? 'damaged' : 'no-damage',
    removalTarget: destroyed ? { kind: 'zone-id', zoneId: input.zone.id } : null,
    updatedZone,
  })
}

const applyAccuracyModifier = (
  current: number,
  modifier: Exclude<EncounterZoneTargetingModifier, { readonly operation: 'block' }>,
): number => {
  if (modifier.operation === 'add') return current + modifier.value
  if (modifier.operation === 'multiply') return current * modifier.value
  return modifier.value
}

/** Build one immutable query over exact active smoke and barrier zone geometry. */
export const createMoveAutomationBarriersAndSmokeResolver = (input: {
  readonly map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>
  readonly placements: readonly MoveAutomationObscurationPlacement[]
}): MoveAutomationBarriersAndSmokeResolver => {
  if (!validDimensions(input.map.dimensions)) {
    return fail('invalid-map', 'Obscuration queries require positive integer map dimensions.')
  }
  if (!Array.isArray(input.placements) || input.placements.length > MOVE_AUTOMATION_OBSCURATION_LIMITS.placements) {
    return fail('invalid-placement', 'Obscuration placements must be a bounded array.')
  }
  const placements = new Map<string, PlacementSnapshot>()
  for (const value of input.placements) {
    const placement = placementSnapshot(value, input.map.dimensions)
    if (placements.has(placement.id)) {
      return fail('duplicate-placement-id', `Obscuration placement ${placement.id} is duplicated.`)
    }
    placements.set(placement.id, placement)
  }

  const projected = projectBattlefieldZones(input.map).activeZones
  const smokeZones = deepFreeze(projected.flatMap(zone => (
    zone.kind === 'smoke' ? [authoritativeSmokeZone(zone)] : []
  )))
  const barrierZoneRecords = projected.flatMap(zone => (
    zone.kind === 'barrier' ? [zone] : []
  ))
  const barrierZones = deepFreeze(barrierZoneRecords.map(zone => (
    authoritativeBarrierZone(zone, input.map.dimensions)
  )))
  const barrierById = new Map(barrierZoneRecords.map(zone => [zone.id, zone]))
  const sightCells = deepFreeze(barrierZones.flatMap(zone => zone.occupiedCells.map(cell => ({
    zoneId: zone.zoneId,
    source: zone.source,
    sideId: zone.sideId,
    cell: cloneCell(cell),
  }))))

  const cellsForTarget = (target: BattlefieldSmokeAccuracyTarget): readonly EncounterZoneCell[] => {
    if (target.kind === 'placement') {
      return placements.get(target.placementId)?.cells
        ?? fail('placement-missing', `Smoke accuracy target ${target.placementId} is unavailable.`)
    }
    return assertCells(
      target.cells,
      input.map.dimensions,
      'Smoke accuracy area',
      MOVE_AUTOMATION_OBSCURATION_LIMITS.areaCells,
    )
  }

  return Object.freeze({
    smoke: () => smokeZones,
    barriers: () => barrierZones,
    barrierSightCells: () => sightCells,
    accuracy: (query: {
      readonly sourcePlacementId: string
      readonly target: BattlefieldSmokeAccuracyTarget
      readonly baseValue: number
    }): BattlefieldSmokeAccuracyResolution => {
      if (!Number.isFinite(query.baseValue)) {
        return fail('invalid-damage', 'Smoke accuracy base value must be finite.')
      }
      const source = placements.get(query.sourcePlacementId)
        ?? fail('placement-missing', `Smoke accuracy source ${query.sourcePlacementId} is unavailable.`)
      const targetCells = cellsForTarget(query.target)
      const sourceKeys = new Set(source.cells.map(cellKey))
      const targetKeys = new Set(targetCells.map(cellKey))
      const seenModifierIds = new Set<string>()
      const modifiers: MoveAutomationRollModifier[] = []
      const trace: BattlefieldSmokeAccuracyTraceEntry[] = []
      const affectingZoneIds: string[] = []
      let value = query.baseValue

      for (const zone of smokeZones) {
        const sourceInside = intersects(zone.cells, sourceKeys)
        const targetInside = intersects(zone.cells, targetKeys)
        if (!sourceInside && !targetInside) {
          trace.push({
            interaction: 'accuracy',
            zoneId: zone.zoneId,
            smokeId: zone.smokeId,
            source: zone.source,
            sideId: zone.sideId,
            sourcePlacementId: source.id,
            targetKind: query.target.kind,
            targetPlacementId: query.target.kind === 'placement' ? query.target.placementId : null,
            sourceInside,
            targetInside,
            outcome: 'outside-zone',
            reasonCode: 'zone.smoke.attack-outside',
            modifierId: null,
            value: null,
          })
          continue
        }
        affectingZoneIds.push(zone.zoneId)
        for (const modifier of zone.targetingModifiers) {
          if (modifier.attribute !== 'accuracy') continue
          if (seenModifierIds.has(modifier.id)) {
            trace.push({
              interaction: 'accuracy',
              zoneId: zone.zoneId,
              smokeId: zone.smokeId,
              source: zone.source,
              sideId: zone.sideId,
              sourcePlacementId: source.id,
              targetKind: query.target.kind,
              targetPlacementId: query.target.kind === 'placement' ? query.target.placementId : null,
              sourceInside,
              targetInside,
              outcome: 'superseded',
              reasonCode: 'zone.smoke.modifier-non-stacking',
              modifierId: modifier.id,
              value: null,
            })
            continue
          }
          seenModifierIds.add(modifier.id)
          const previous = value
          value = applyAccuracyModifier(value, modifier)
          const delta = value - previous
          modifiers.push({
            sourceId: zone.zoneId,
            reason: modifier.reasonCode,
            value: delta,
          })
          trace.push({
            interaction: 'accuracy',
            zoneId: zone.zoneId,
            smokeId: zone.smokeId,
            source: zone.source,
            sideId: zone.sideId,
            sourcePlacementId: source.id,
            targetKind: query.target.kind,
            targetPlacementId: query.target.kind === 'placement' ? query.target.placementId : null,
            sourceInside,
            targetInside,
            outcome: 'applied',
            reasonCode: modifier.reasonCode,
            modifierId: modifier.id,
            value: delta,
          })
        }
      }

      return deepFreeze({
        sourcePlacementId: source.id,
        target: query.target.kind === 'placement'
          ? { ...query.target }
          : { kind: 'area', cells: targetCells.map(cloneCell) },
        baseValue: query.baseValue,
        value,
        modifierTotal: value - query.baseValue,
        affectingZoneIds,
        modifiers,
        trace,
      })
    },
    damageBarrier: (query: {
      readonly zoneId: string
      readonly incomingDamage: number
      readonly moveType: string
    }): BattlefieldBarrierDamageResolution => {
      const zone = barrierById.get(query.zoneId)
        ?? fail('barrier-missing', `Barrier zone ${query.zoneId} is unavailable.`)
      return resolveBarrierDamage({ zone, ...query })
    },
  })
}
