import {
  ABILITY_MOVEMENT_CHECKPOINTS,
  ABILITY_MOVEMENT_MODES,
  ABILITY_MOVEMENT_ZONE_TRANSITIONS,
  type AbilityMovementCheckpoint,
  type AbilityMovementMode,
  type AbilityMovementZoneTransition,
} from './events'
import {
  ENCOUNTER_ZONE_KINDS,
  type EncounterZoneKind,
} from '../moveAutomation/encounterZones'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_MOVEMENT_EVENT_PREDICATE_KIND = 'ability-movement-fact' as const
export const ABILITY_MOVEMENT_OWNER_ROLES = ['mover', 'source', 'either', 'other'] as const
export const ABILITY_MOVEMENT_STEP_FILTERS = ['any', 'first', 'final'] as const
export const ABILITY_MOVEMENT_GROUNDING_FILTERS = [
  'any', 'grounded', 'airborne', 'became-grounded', 'became-airborne',
] as const
export const ABILITY_MOVEMENT_ADJACENCY_FILTERS = [
  'any', 'present-before', 'present-after', 'gained', 'lost',
] as const
export const ABILITY_MOVEMENT_TERRAIN_FILTERS = ['any', 'entered', 'exited', 'changed', 'unchanged'] as const

export interface AbilityMovementEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_MOVEMENT_EVENT_PREDICATE_KIND
  readonly checkpoints: readonly AbilityMovementCheckpoint[]
  readonly modes: readonly AbilityMovementMode[]
  readonly ownerRole: (typeof ABILITY_MOVEMENT_OWNER_ROLES)[number]
  readonly stepPosition: (typeof ABILITY_MOVEMENT_STEP_FILTERS)[number]
  readonly grounding: (typeof ABILITY_MOVEMENT_GROUNDING_FILTERS)[number]
  readonly ownerAdjacency: (typeof ABILITY_MOVEMENT_ADJACENCY_FILTERS)[number]
  readonly terrainChange: (typeof ABILITY_MOVEMENT_TERRAIN_FILTERS)[number]
  readonly zoneKinds: readonly EncounterZoneKind[]
  readonly zoneTransitions: readonly AbilityMovementZoneTransition[]
  readonly minimumStepDistance: number | null
}

export class AbilityMovementEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityMovementEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'checkpoints', 'modes', 'ownerRole', 'stepPosition', 'grounding',
  'ownerAdjacency', 'terrainChange', 'zoneKinds', 'zoneTransitions', 'minimumStepDistance',
] as const
const fail = (code: AbilityMovementEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityMovementEventPredicateValidationError(code, path, detail)
}
const ordered = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): readonly Value[] => {
  if (!Array.isArray(value) || value.length > supported.length) fail('limit-exceeded', path, 'must be bounded.')
  const parsed = (value as readonly unknown[]).map((entry, index) => {
    const order = supported.indexOf(entry as Value)
    if (order < 0) fail('invalid-predicate', `${path}[${index}]`, 'is unsupported.')
    return { value: entry as Value, order }
  })
  if (new Set(parsed.map(entry => entry.value)).size !== parsed.length
    || parsed.some((entry, index) => index > 0 && entry.order <= parsed[index - 1]!.order)) {
    fail('invalid-predicate', path, 'must contain unique canonical-order values.')
  }
  return Object.freeze(parsed.map(entry => entry.value))
}
const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value) ? value as Value : fail('invalid-predicate', path, 'is unsupported.')
)

export const parseAbilityMovementEventPredicate = (
  value: unknown,
  path = 'abilityMovementEventPredicate',
): AbilityMovementEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 512, objectFields: 16, arrayEntries: 64, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability movement-event predicate', valueLabel: 'ability movement-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_MOVEMENT_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  const minimumStepDistance = input.minimumStepDistance === null
    ? null
    : Number.isSafeInteger(input.minimumStepDistance) && Number(input.minimumStepDistance) >= 0
      && Number(input.minimumStepDistance) <= 1_000_000
      ? Number(input.minimumStepDistance)
      : fail('invalid-predicate', `${path}.minimumStepDistance`, 'is out of bounds.')
  const parsed = {
    kind: ABILITY_MOVEMENT_EVENT_PREDICATE_KIND,
    checkpoints: ordered(input.checkpoints, `${path}.checkpoints`, ABILITY_MOVEMENT_CHECKPOINTS),
    modes: ordered(input.modes, `${path}.modes`, ABILITY_MOVEMENT_MODES),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_MOVEMENT_OWNER_ROLES),
    stepPosition: oneOf(input.stepPosition, `${path}.stepPosition`, ABILITY_MOVEMENT_STEP_FILTERS),
    grounding: oneOf(input.grounding, `${path}.grounding`, ABILITY_MOVEMENT_GROUNDING_FILTERS),
    ownerAdjacency: oneOf(
      input.ownerAdjacency,
      `${path}.ownerAdjacency`,
      ABILITY_MOVEMENT_ADJACENCY_FILTERS,
    ),
    terrainChange: oneOf(input.terrainChange, `${path}.terrainChange`, ABILITY_MOVEMENT_TERRAIN_FILTERS),
    zoneKinds: ordered(input.zoneKinds, `${path}.zoneKinds`, ENCOUNTER_ZONE_KINDS),
    zoneTransitions: ordered(
      input.zoneTransitions,
      `${path}.zoneTransitions`,
      ABILITY_MOVEMENT_ZONE_TRANSITIONS,
    ),
    minimumStepDistance,
  }
  const constrained = parsed.checkpoints.length > 0 || parsed.modes.length > 0
    || parsed.ownerRole !== 'either' || parsed.stepPosition !== 'any' || parsed.grounding !== 'any'
    || parsed.ownerAdjacency !== 'any' || parsed.terrainChange !== 'any'
    || parsed.zoneKinds.length > 0 || parsed.zoneTransitions.length > 0
    || minimumStepDistance !== null
  if (!constrained) fail('invalid-predicate', path, 'must constrain at least one movement fact.')
  return deepFreezeStrictJson(parsed) as AbilityMovementEventPredicate
}
