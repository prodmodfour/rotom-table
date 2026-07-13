import { createHash } from 'node:crypto'
import type {
  MovementMode,
  MovementSemiInvulnerableState,
} from '~/types/movement'
import { stableJsonStringify } from './stableJson'

export const MOVE_SEMI_INVULNERABLE_PROGRAM_VERSION = 1 as const

export const MOVE_SEMI_INVULNERABLE_CANONICAL_IDS = [
  'Dig',
  'Dive',
  'Fly',
  'Bounce',
  'Sky Drop',
  'Phantom Force',
  'Shadow Force',
] as const

export const MOVE_SEMI_INVULNERABLE_FAMILY_IDS = [
  'dig',
  'dive',
  'fly',
  'bounce',
  'sky-drop',
  'phantom-force',
  'shadow-force',
] as const

export type MoveSemiInvulnerableCanonicalId =
  (typeof MOVE_SEMI_INVULNERABLE_CANONICAL_IDS)[number]
export type MoveSemiInvulnerableFamilyId =
  (typeof MOVE_SEMI_INVULNERABLE_FAMILY_IDS)[number]
export type MoveSemiInvulnerableEffectRole = 'user' | 'carried-target'

export type MoveSemiInvulnerableResolutionMovementKind =
  | 'surface'
  | 'land-adjacent'
  | 'lower-carried-pair'
  | 'appear-adjacent'

export type MoveSemiInvulnerableTargetingTiming = 'ordinary' | 'interrupt'

/** Reviewed rule changes attached to one otherwise-targetability exception. */
export interface MoveSemiInvulnerableTargetingException {
  readonly canonicalMoveId: string
  readonly timing: MoveSemiInvulnerableTargetingTiming
  readonly ignoresRange: boolean
  readonly accuracy: 'normal' | 'automatic'
  readonly damageBaseOverride: number | null
  /** A successful interrupt cancels the setup before its resolution movement. */
  readonly cancelsSetupOnHit: boolean
}

export interface MoveSemiInvulnerableResolutionMovementPolicy {
  readonly kind: MoveSemiInvulnerableResolutionMovementKind
  /** Empty only when the move appears without traversing intermediate cells. */
  readonly allowedModes: readonly MovementMode[]
  readonly speedMultiplier: 1 | 2
  readonly speedBonus: number
  readonly traversesIntermediateCells: boolean
  readonly requiresTargetAdjacency: boolean
  readonly movesCarriedTarget: boolean
  readonly ignoresMovementCapabilities: boolean
}

export interface MoveSemiInvulnerableDefinition {
  readonly version: typeof MOVE_SEMI_INVULNERABLE_PROGRAM_VERSION
  readonly canonicalId: MoveSemiInvulnerableCanonicalId
  readonly familyId: MoveSemiInvulnerableFamilyId
  readonly userState: Exclude<MovementSemiInvulnerableState, 'none' | 'carried' | 'phased'>
  readonly carriedTargetState: Extract<MovementSemiInvulnerableState, 'carried'> | null
  readonly setupEndsTurn: boolean
  readonly resolutionMovement: MoveSemiInvulnerableResolutionMovementPolicy
  readonly userTargetingExceptions: readonly MoveSemiInvulnerableTargetingException[]
  readonly carriedTargetingExceptions: readonly MoveSemiInvulnerableTargetingException[]
}

const exception = (
  value: MoveSemiInvulnerableTargetingException,
): MoveSemiInvulnerableTargetingException => Object.freeze(value)

const UNDERGROUND_EXCEPTIONS = Object.freeze([
  exception({
    canonicalMoveId: 'Earthquake',
    timing: 'ordinary',
    ignoresRange: false,
    accuracy: 'normal',
    damageBaseOverride: null,
    cancelsSetupOnHit: false,
  }),
  exception({
    canonicalMoveId: 'Magnitude',
    timing: 'ordinary',
    ignoresRange: false,
    accuracy: 'normal',
    damageBaseOverride: null,
    cancelsSetupOnHit: false,
  }),
])

const FLY_AIRBORNE_EXCEPTIONS = Object.freeze([
  exception({
    canonicalMoveId: 'Gust',
    timing: 'ordinary',
    ignoresRange: true,
    accuracy: 'normal',
    damageBaseOverride: 8,
    cancelsSetupOnHit: false,
  }),
  exception({
    canonicalMoveId: 'Hurricane',
    timing: 'ordinary',
    ignoresRange: false,
    accuracy: 'automatic',
    damageBaseOverride: null,
    cancelsSetupOnHit: false,
  }),
  exception({
    canonicalMoveId: 'Twister',
    timing: 'ordinary',
    ignoresRange: true,
    accuracy: 'normal',
    damageBaseOverride: 8,
    cancelsSetupOnHit: false,
  }),
  exception({
    canonicalMoveId: 'Sky Uppercut',
    timing: 'interrupt',
    ignoresRange: true,
    accuracy: 'normal',
    damageBaseOverride: null,
    cancelsSetupOnHit: true,
  }),
])

const SKY_DROP_TARGET_EXCEPTIONS = Object.freeze(
  FLY_AIRBORNE_EXCEPTIONS.filter(entry => entry.canonicalMoveId !== 'Sky Uppercut'),
)

const BOUNCE_EXCEPTIONS = Object.freeze([
  exception({
    canonicalMoveId: 'Sky Uppercut',
    timing: 'interrupt',
    ignoresRange: true,
    accuracy: 'normal',
    damageBaseOverride: null,
    cancelsSetupOnHit: true,
  }),
])

const complete = (
  definition: Omit<MoveSemiInvulnerableDefinition, 'version'>,
): MoveSemiInvulnerableDefinition => Object.freeze({
  ...definition,
  version: MOVE_SEMI_INVULNERABLE_PROGRAM_VERSION,
  resolutionMovement: Object.freeze({ ...definition.resolutionMovement }),
  userTargetingExceptions: Object.freeze([...definition.userTargetingExceptions]),
  carriedTargetingExceptions: Object.freeze([...definition.carriedTargetingExceptions]),
})

/**
 * Reviewed engine definitions only. Phase 9 owns production registration and
 * semantic promotion for these moves.
 */
export const MOVE_SEMI_INVULNERABLE_DEFINITIONS: readonly MoveSemiInvulnerableDefinition[] = Object.freeze([
  complete({
    canonicalId: 'Dig',
    familyId: 'dig',
    userState: 'underground',
    carriedTargetState: null,
    setupEndsTurn: true,
    resolutionMovement: {
      kind: 'surface',
      allowedModes: ['burrow', 'overland'],
      speedMultiplier: 1,
      speedBonus: 0,
      traversesIntermediateCells: true,
      requiresTargetAdjacency: false,
      movesCarriedTarget: false,
      ignoresMovementCapabilities: false,
    },
    userTargetingExceptions: UNDERGROUND_EXCEPTIONS,
    carriedTargetingExceptions: [],
  }),
  complete({
    canonicalId: 'Dive',
    familyId: 'dive',
    userState: 'underwater',
    carriedTargetState: null,
    setupEndsTurn: true,
    resolutionMovement: {
      kind: 'surface',
      allowedModes: ['swim'],
      speedMultiplier: 1,
      speedBonus: 0,
      traversesIntermediateCells: true,
      requiresTargetAdjacency: false,
      movesCarriedTarget: false,
      ignoresMovementCapabilities: false,
    },
    userTargetingExceptions: [],
    carriedTargetingExceptions: [],
  }),
  complete({
    canonicalId: 'Fly',
    familyId: 'fly',
    userState: 'airborne',
    carriedTargetState: null,
    setupEndsTurn: true,
    resolutionMovement: {
      kind: 'land-adjacent',
      allowedModes: ['overland', 'sky'],
      speedMultiplier: 2,
      speedBonus: 0,
      traversesIntermediateCells: true,
      requiresTargetAdjacency: true,
      movesCarriedTarget: false,
      ignoresMovementCapabilities: false,
    },
    userTargetingExceptions: FLY_AIRBORNE_EXCEPTIONS,
    carriedTargetingExceptions: [],
  }),
  complete({
    canonicalId: 'Bounce',
    familyId: 'bounce',
    userState: 'airborne',
    carriedTargetState: null,
    setupEndsTurn: false,
    resolutionMovement: {
      kind: 'land-adjacent',
      allowedModes: ['overland', 'sky', 'jump'],
      speedMultiplier: 1,
      speedBonus: 1,
      traversesIntermediateCells: true,
      requiresTargetAdjacency: true,
      movesCarriedTarget: false,
      ignoresMovementCapabilities: false,
    },
    userTargetingExceptions: BOUNCE_EXCEPTIONS,
    carriedTargetingExceptions: [],
  }),
  complete({
    canonicalId: 'Sky Drop',
    familyId: 'sky-drop',
    userState: 'airborne',
    carriedTargetState: 'carried',
    setupEndsTurn: true,
    resolutionMovement: {
      kind: 'lower-carried-pair',
      allowedModes: ['overland', 'sky'],
      speedMultiplier: 1,
      speedBonus: 0,
      traversesIntermediateCells: true,
      requiresTargetAdjacency: false,
      movesCarriedTarget: true,
      ignoresMovementCapabilities: false,
    },
    userTargetingExceptions: FLY_AIRBORNE_EXCEPTIONS,
    carriedTargetingExceptions: SKY_DROP_TARGET_EXCEPTIONS,
  }),
  complete({
    canonicalId: 'Phantom Force',
    familyId: 'phantom-force',
    userState: 'vanished',
    carriedTargetState: null,
    setupEndsTurn: true,
    resolutionMovement: {
      kind: 'appear-adjacent',
      allowedModes: [],
      speedMultiplier: 1,
      speedBonus: 0,
      traversesIntermediateCells: false,
      requiresTargetAdjacency: true,
      movesCarriedTarget: false,
      ignoresMovementCapabilities: true,
    },
    userTargetingExceptions: [],
    carriedTargetingExceptions: [],
  }),
  complete({
    canonicalId: 'Shadow Force',
    familyId: 'shadow-force',
    userState: 'vanished',
    carriedTargetState: null,
    setupEndsTurn: true,
    resolutionMovement: {
      kind: 'appear-adjacent',
      allowedModes: [],
      speedMultiplier: 1,
      speedBonus: 0,
      traversesIntermediateCells: false,
      requiresTargetAdjacency: true,
      movesCarriedTarget: false,
      ignoresMovementCapabilities: true,
    },
    userTargetingExceptions: [],
    carriedTargetingExceptions: [],
  }),
])

const DEFINITION_BY_CANONICAL_ID = new Map(
  MOVE_SEMI_INVULNERABLE_DEFINITIONS.map(definition => [definition.canonicalId, definition]),
)
const DEFINITION_BY_FAMILY_ID = new Map(
  MOVE_SEMI_INVULNERABLE_DEFINITIONS.map(definition => [definition.familyId, definition]),
)

export const moveSemiInvulnerableDefinition = (
  canonicalId: MoveSemiInvulnerableCanonicalId,
): MoveSemiInvulnerableDefinition => DEFINITION_BY_CANONICAL_ID.get(canonicalId)
  ?? (() => { throw new Error(`Unknown semi-invulnerable move definition ${canonicalId}.`) })()

export const moveSemiInvulnerableDefinitionByFamily = (
  familyId: MoveSemiInvulnerableFamilyId,
): MoveSemiInvulnerableDefinition => DEFINITION_BY_FAMILY_ID.get(familyId)
  ?? (() => { throw new Error(`Unknown semi-invulnerable move family ${familyId}.`) })()

export const isMoveSemiInvulnerableFamilyId = (
  value: unknown,
): value is MoveSemiInvulnerableFamilyId => (
  typeof value === 'string' && DEFINITION_BY_FAMILY_ID.has(value as MoveSemiInvulnerableFamilyId)
)

export const MOVE_SEMI_INVULNERABLE_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify({
    version: MOVE_SEMI_INVULNERABLE_PROGRAM_VERSION,
    definitions: MOVE_SEMI_INVULNERABLE_DEFINITIONS,
  }))
  .digest('hex')
