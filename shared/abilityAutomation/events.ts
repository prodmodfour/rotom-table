import { POKEMON_TYPE_IDS, type PokemonTypeId } from '../pokemonTypes'
import {
  ENCOUNTER_ZONE_KINDS,
  type EncounterZoneKind,
} from '../moveAutomation/encounterZones'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_ENCOUNTER_EVENT_SCHEMA_VERSION = 1 as const
export const ABILITY_ENCOUNTER_EVENT_KINDS = [
  'action',
  'move',
  'strike',
  'hp',
  'condition',
  'combat-stage',
  'stat',
  'movement',
  'presence',
  'initiative',
  'item',
  'field',
  'lifecycle',
] as const
export type AbilityEncounterEventKind = (typeof ABILITY_ENCOUNTER_EVENT_KINDS)[number]
export const ABILITY_EVENT_CHECKPOINTS = [
  'declaration',
  'pre-effect',
  'post-effect',
  'after-commit',
  'lifecycle',
] as const
export type AbilityEventCheckpoint = (typeof ABILITY_EVENT_CHECKPOINTS)[number]

export const ABILITY_ACTION_EVENT_KINDS = ['move', 'ability', 'item', 'maneuver', 'shift', 'other'] as const
export const ABILITY_ACTION_EVENT_TIMINGS = ['declared', 'started', 'completed', 'cancelled'] as const
export const ABILITY_ACTION_EVENT_OUTCOMES = ['applied', 'prevented', 'no-op', 'failed'] as const
export const ABILITY_MOVE_EVENT_TIMINGS = [
  'declared',
  'use-started',
  'accuracy-resolved',
  'effects-resolved',
  'completed',
  'cancelled',
] as const
export const ABILITY_MOVE_DAMAGE_CLASSES = ['physical', 'special', 'status'] as const
export const ABILITY_MOVE_RANGE_KINDS = ['self', 'melee', 'ranged', 'area', 'field', 'other'] as const
export const ABILITY_STRIKE_EVENT_TIMINGS = ['accuracy-resolved', 'damage-resolved'] as const
export const ABILITY_STRIKE_ACCURACY_OUTCOMES = ['hit', 'automatic-hit', 'miss', 'prevented'] as const
export const ABILITY_STRIKE_RANGE_CONTEXTS = ['melee', 'ranged', 'area', 'other'] as const
export const ABILITY_STRIKE_DIRECTNESS = ['direct', 'indirect'] as const
export const ABILITY_STRIKE_EFFECTIVENESS = [
  'immune', 'double-resisted', 'resisted', 'neutral', 'super-effective', 'double-super-effective',
] as const
export const ABILITY_MOVE_KEYWORDS = [
  'aura', 'berry', 'blessing', 'coat', 'dash', 'double-strike', 'exhaust', 'execute',
  'field', 'five-strike', 'fling', 'friendly', 'groundsource', 'hazard', 'healing',
  'illusion', 'interrupt', 'pass', 'pledge', 'powder', 'priority', 'priority-limited',
  'push', 'reaction', 'reckless', 'recoil', 'set-up', 'shield', 'smite', 'social',
  'sonic', 'spirit-surge', 'trigger', 'weather',
] as const
export const ABILITY_HP_CHANGE_KINDS = [
  'damage', 'healing', 'drain', 'recoil', 'cost', 'set',
  'temporary-gain', 'temporary-loss', 'injury', 'revive',
] as const
export const ABILITY_FAINT_TRANSITIONS = ['none', 'fainted', 'revived'] as const
export const ABILITY_CONDITION_OPERATIONS = ['apply', 'remove', 'save', 'cure', 'reset', 'transfer'] as const
export const ABILITY_CONDITION_OUTCOMES = [
  'applied', 'prevented', 'no-op', 'succeeded', 'failed', 'transferred',
] as const
export const ABILITY_CHANGE_OUTCOMES = ['applied', 'capped', 'prevented', 'reset', 'transferred'] as const
export const ABILITY_COMBAT_STAGE_STATS = [
  'attack', 'defense', 'special-attack', 'special-defense', 'speed', 'accuracy',
] as const
export const ABILITY_STAT_KINDS = [
  'hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed',
] as const
export const ABILITY_STAT_LAYERS = ['base', 'derived', 'temporary'] as const
export const ABILITY_MOVEMENT_CHECKPOINTS = ['pre-step', 'post-step'] as const
export const ABILITY_MOVEMENT_MODES = ['voluntary', 'forced', 'teleport', 'swap'] as const
export const ABILITY_MOVEMENT_ZONE_TRANSITIONS = ['entered', 'exited'] as const
export const ABILITY_PRESENCE_OPERATIONS = ['send-out', 'recall', 'switch'] as const
export const ABILITY_INITIATIVE_CHANGES = [
  'rolled', 'inserted', 'removed', 'reordered', 'delayed', 'advanced', 'reset',
] as const
export const ABILITY_ITEM_CHANGES = [
  'added', 'removed', 'used', 'consumed', 'equipped', 'unequipped',
  'transferred', 'dropped', 'picked-up', 'digestion-traded',
] as const
export const ABILITY_ITEM_RESOURCE_KINDS = ['inventory', 'held-item'] as const
export const ABILITY_ITEM_OUTCOMES = ['applied', 'partial', 'prevented', 'no-op'] as const
export const ABILITY_FIELD_KINDS = ['weather', 'terrain', 'room', 'hazard'] as const
export const ABILITY_FIELD_CHANGES = ['applied', 'refreshed', 'removed', 'expired'] as const
export const ABILITY_FIELD_OUTCOMES = ['applied', 'prevented', 'no-op'] as const
export const ABILITY_LIFECYCLE_BOUNDARIES = ['scene', 'round', 'turn', 'presence', 'effective-ability', 'form'] as const
export const ABILITY_LIFECYCLE_TRANSITIONS = [
  'started', 'ended', 'entered', 'left', 'became-effective', 'became-ineffective', 'changed',
] as const

export type AbilityActionEventKind = (typeof ABILITY_ACTION_EVENT_KINDS)[number]
export type AbilityActionEventTiming = (typeof ABILITY_ACTION_EVENT_TIMINGS)[number]
export type AbilityActionEventOutcome = (typeof ABILITY_ACTION_EVENT_OUTCOMES)[number]
export type AbilityMoveEventTiming = (typeof ABILITY_MOVE_EVENT_TIMINGS)[number]
export type AbilityMoveDamageClass = (typeof ABILITY_MOVE_DAMAGE_CLASSES)[number]
export type AbilityMoveRangeKind = (typeof ABILITY_MOVE_RANGE_KINDS)[number]
export type AbilityMoveKeyword = (typeof ABILITY_MOVE_KEYWORDS)[number]
export type AbilityStrikeEventTiming = (typeof ABILITY_STRIKE_EVENT_TIMINGS)[number]
export type AbilityStrikeAccuracyOutcome = (typeof ABILITY_STRIKE_ACCURACY_OUTCOMES)[number]
export type AbilityStrikeRangeContext = (typeof ABILITY_STRIKE_RANGE_CONTEXTS)[number]
export type AbilityStrikeDirectness = (typeof ABILITY_STRIKE_DIRECTNESS)[number]
export type AbilityStrikeEffectiveness = (typeof ABILITY_STRIKE_EFFECTIVENESS)[number]
export type AbilityHpChangeKind = (typeof ABILITY_HP_CHANGE_KINDS)[number]
export type AbilityFaintTransition = (typeof ABILITY_FAINT_TRANSITIONS)[number]
export type AbilityConditionOperation = (typeof ABILITY_CONDITION_OPERATIONS)[number]
export type AbilityConditionOutcome = (typeof ABILITY_CONDITION_OUTCOMES)[number]
export type AbilityChangeOutcome = (typeof ABILITY_CHANGE_OUTCOMES)[number]
export type AbilityCombatStageStat = (typeof ABILITY_COMBAT_STAGE_STATS)[number]
export type AbilityStatKind = (typeof ABILITY_STAT_KINDS)[number]
export type AbilityStatLayer = (typeof ABILITY_STAT_LAYERS)[number]
export type AbilityMovementCheckpoint = (typeof ABILITY_MOVEMENT_CHECKPOINTS)[number]
export type AbilityMovementMode = (typeof ABILITY_MOVEMENT_MODES)[number]
export type AbilityMovementZoneTransition = (typeof ABILITY_MOVEMENT_ZONE_TRANSITIONS)[number]
export type AbilityPresenceOperation = (typeof ABILITY_PRESENCE_OPERATIONS)[number]
export type AbilityInitiativeChange = (typeof ABILITY_INITIATIVE_CHANGES)[number]
export type AbilityItemChange = (typeof ABILITY_ITEM_CHANGES)[number]
export type AbilityItemResourceKind = (typeof ABILITY_ITEM_RESOURCE_KINDS)[number]
export type AbilityItemOutcome = (typeof ABILITY_ITEM_OUTCOMES)[number]
export type AbilityFieldKind = (typeof ABILITY_FIELD_KINDS)[number]
export type AbilityFieldChange = (typeof ABILITY_FIELD_CHANGES)[number]
export type AbilityFieldOutcome = (typeof ABILITY_FIELD_OUTCOMES)[number]
export type AbilityLifecycleBoundary = (typeof ABILITY_LIFECYCLE_BOUNDARIES)[number]
export type AbilityLifecycleTransition = (typeof ABILITY_LIFECYCLE_TRANSITIONS)[number]

interface AbilityEncounterEventEnvelope<Kind extends AbilityEncounterEventKind> {
  readonly schemaVersion: typeof ABILITY_ENCOUNTER_EVENT_SCHEMA_VERSION
  readonly eventId: string
  readonly kind: Kind
  readonly sequence: number
  readonly mapSlug: string
  readonly mapRevision: number
  readonly sceneId: string | null
  readonly occurredAt: number
  readonly actorPlacementId: string | null
  readonly sourceResolutionId: string | null
  readonly parentEventId: string | null
}

export interface AbilityActionEncounterEvent extends AbilityEncounterEventEnvelope<'action'> {
  readonly payload: {
    readonly actionKind: AbilityActionEventKind
    readonly actionId: string
    readonly timing: AbilityActionEventTiming
    readonly outcome: AbilityActionEventOutcome | null
    readonly targetPlacementIds: readonly string[]
    readonly tags: readonly string[]
  }
}

export interface AbilityMoveEncounterEvent extends AbilityEncounterEventEnvelope<'move'> {
  readonly payload: {
    readonly resolutionId: string
    readonly canonicalMoveId: string
    readonly moveDefinitionHash: string
    readonly userPlacementId: string
    readonly timing: AbilityMoveEventTiming
    readonly outcome: AbilityActionEventOutcome | null
    readonly moveType: PokemonTypeId
    readonly damageClass: AbilityMoveDamageClass
    readonly rangeKind: AbilityMoveRangeKind
    readonly minimumRange: number | null
    readonly maximumRange: number | null
    readonly keywords: readonly AbilityMoveKeyword[]
    readonly semanticBranchIds: readonly string[]
    readonly declaredTargetIds: readonly string[]
    readonly attackedTargetIds: readonly string[]
    readonly hitTargetIds: readonly string[]
    readonly missedTargetIds: readonly string[]
    readonly criticalTargetIds: readonly string[]
    readonly parentMoveResolutionId: string | null
  }
}

export interface AbilityStrikeEncounterEvent extends AbilityEncounterEventEnvelope<'strike'> {
  readonly payload: {
    readonly moveResolutionId: string
    readonly canonicalMoveId: string
    readonly moveDefinitionHash: string
    readonly sourceOperationId: string
    readonly strikeIndex: number
    readonly strikeCount: number
    readonly attackerPlacementId: string
    readonly defenderPlacementId: string
    readonly timing: AbilityStrikeEventTiming
    readonly accuracyOutcome: AbilityStrikeAccuracyOutcome
    readonly rangeContext: AbilityStrikeRangeContext
    readonly makesContact: boolean
    readonly directness: AbilityStrikeDirectness
    readonly moveType: PokemonTypeId
    readonly damageClass: AbilityMoveDamageClass
    readonly critical: boolean
    readonly effectiveness: AbilityStrikeEffectiveness | null
    readonly effectivenessMultiplier: number | null
    readonly rolledDamage: number | null
    readonly postDefenseDamage: number | null
    readonly damageReduction: number | null
    readonly preventedDamage: number | null
    readonly temporaryHpLoss: number | null
    readonly hpLoss: number | null
    readonly totalLoss: number | null
    readonly preventionReasonCodes: readonly string[]
  }
}

export interface AbilityHpEncounterEvent extends AbilityEncounterEventEnvelope<'hp'> {
  readonly payload: {
    readonly placementId: string
    readonly changeKind: AbilityHpChangeKind
    readonly before: number
    readonly after: number
    readonly maximumBefore: number
    readonly maximumAfter: number
    readonly fullMaximum: number
    readonly temporaryBefore: number
    readonly temporaryAfter: number
    readonly requestedAmount: number
    readonly appliedAmount: number
    readonly crossedZero: boolean
    readonly crossedInjuryThreshold: boolean
    readonly injuriesBefore: number
    readonly injuriesAfter: number
    readonly massiveDamage: boolean
    readonly massiveDamageThreshold: number
    readonly massiveDamageAmount: number
    readonly massiveDamageInjuryApplied: boolean
    readonly faintedBefore: boolean
    readonly faintedAfter: boolean
    readonly faintTransition: AbilityFaintTransition
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly reasonCode: string
  }
}

export interface AbilityConditionEncounterEvent extends AbilityEncounterEventEnvelope<'condition'> {
  readonly payload: {
    readonly placementId: string
    readonly conditionId: string
    readonly operation: AbilityConditionOperation
    readonly outcome: AbilityConditionOutcome
    readonly before: boolean
    readonly after: boolean
    readonly saveRollId: string | null
    readonly transferPlacementId: string | null
    readonly sourcePlacementId: string | null
    readonly sourceAbilityInstanceId: string | null
    readonly sourceEffectId: string | null
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly preventionReasonCodes: readonly string[]
    readonly reasonCode: string
  }
}

export interface AbilityCombatStageEncounterEvent extends AbilityEncounterEventEnvelope<'combat-stage'> {
  readonly payload: {
    readonly placementId: string
    readonly stat: AbilityCombatStageStat
    readonly before: number
    readonly requestedDelta: number
    readonly appliedDelta: number
    readonly after: number
    readonly minimum: number
    readonly maximum: number
    readonly outcome: AbilityChangeOutcome
    readonly transferPlacementId: string | null
    readonly sourcePlacementId: string | null
    readonly sourceAbilityInstanceId: string | null
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly preventionReasonCodes: readonly string[]
    readonly reasonCode: string
  }
}

export interface AbilityStatEncounterEvent extends AbilityEncounterEventEnvelope<'stat'> {
  readonly payload: {
    readonly placementId: string
    readonly stat: AbilityStatKind
    readonly layer: AbilityStatLayer
    readonly before: number
    readonly requestedDelta: number
    readonly appliedDelta: number
    readonly after: number
    readonly minimum: number
    readonly maximum: number
    readonly outcome: AbilityChangeOutcome
    readonly transferPlacementId: string | null
    readonly sourcePlacementId: string | null
    readonly sourceAbilityInstanceId: string | null
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly preventionReasonCodes: readonly string[]
    readonly reasonCode: string
  }
}

export interface AbilityMovementCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface AbilityMovementZoneFact {
  readonly zoneId: string
  readonly zoneKind: EncounterZoneKind
  readonly transition: AbilityMovementZoneTransition
  readonly sourcePlacementId: string | null
  readonly sourceAbilityInstanceId: string | null
  readonly sourceOperationId: string | null
}

export interface AbilityMovementEncounterEvent extends AbilityEncounterEventEnvelope<'movement'> {
  readonly payload: {
    readonly placementId: string
    readonly movementId: string
    readonly checkpoint: AbilityMovementCheckpoint
    readonly mode: AbilityMovementMode
    readonly step: number
    readonly stepCount: number
    readonly pathCells: readonly AbilityMovementCell[]
    readonly from: AbilityMovementCell
    readonly to: AbilityMovementCell
    readonly distanceBefore: number
    readonly distanceAfter: number
    readonly totalDistance: number
    readonly groundedBefore: boolean
    readonly groundedAfter: boolean
    readonly adjacentPlacementIdsBefore: readonly string[]
    readonly adjacentPlacementIdsAfter: readonly string[]
    readonly terrainIdsBefore: readonly string[]
    readonly terrainIdsAfter: readonly string[]
    readonly zoneTransitions: readonly AbilityMovementZoneFact[]
    readonly sourcePlacementId: string | null
    readonly sourceAbilityInstanceId: string | null
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly reasonCode: string
  }
}

export interface AbilityPresenceEncounterEvent extends AbilityEncounterEventEnvelope<'presence'> {
  readonly payload: {
    readonly operation: AbilityPresenceOperation
    readonly outgoingPlacementId: string | null
    readonly incomingPlacementId: string | null
    readonly sideId: string | null
    readonly outgoingCell: AbilityMovementCell | null
    readonly incomingCell: AbilityMovementCell | null
    readonly initiativeRevision: number
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly reasonCode: string
  }
}

export interface AbilityInitiativeEncounterEvent extends AbilityEncounterEventEnvelope<'initiative'> {
  readonly payload: {
    readonly change: AbilityInitiativeChange
    readonly placementId: string | null
    readonly orderBefore: readonly string[]
    readonly orderAfter: readonly string[]
    readonly activePlacementIdBefore: string | null
    readonly activePlacementIdAfter: string | null
    readonly roundBefore: number
    readonly roundAfter: number
    readonly turnBefore: number
    readonly turnAfter: number
    readonly initiativeRevisionBefore: number
    readonly initiativeRevisionAfter: number
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly reasonCode: string
  }
}

export interface AbilityItemEncounterEvent extends AbilityEncounterEventEnvelope<'item'> {
  readonly payload: {
    readonly change: AbilityItemChange
    readonly outcome: AbilityItemOutcome
    readonly resourceKind: AbilityItemResourceKind
    readonly itemId: string
    readonly itemResourceId: string
    readonly quantityRequested: number
    readonly quantityApplied: number
    readonly ownerIdBefore: string | null
    readonly ownerIdAfter: string | null
    readonly slotIdBefore: string | null
    readonly slotIdAfter: string | null
    readonly resourceRevisionBefore: number
    readonly resourceRevisionAfter: number
    readonly sourcePlacementId: string | null
    readonly sourceAbilityInstanceId: string | null
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly preventionReasonCodes: readonly string[]
    readonly reasonCode: string
  }
}

export interface AbilityFieldEncounterEvent extends AbilityEncounterEventEnvelope<'field'> {
  readonly payload: {
    readonly fieldKind: AbilityFieldKind
    readonly fieldId: string
    readonly zoneId: string
    readonly change: AbilityFieldChange
    readonly outcome: AbilityFieldOutcome
    readonly presentBefore: boolean
    readonly presentAfter: boolean
    readonly layerBefore: number
    readonly layerAfter: number
    readonly remainingRoundsBefore: number | null
    readonly remainingRoundsAfter: number | null
    readonly fieldRevisionBefore: number
    readonly fieldRevisionAfter: number
    readonly sourcePlacementId: string | null
    readonly sourceAbilityInstanceId: string | null
    readonly sourceOperationId: string
    readonly applicationId: string
    readonly preventionReasonCodes: readonly string[]
    readonly reasonCode: string
  }
}

export interface AbilityLifecycleEncounterEvent extends AbilityEncounterEventEnvelope<'lifecycle'> {
  readonly payload: {
    readonly boundary: AbilityLifecycleBoundary
    readonly transition: AbilityLifecycleTransition
    readonly subjectPlacementId: string | null
    readonly abilityInstanceId: string | null
    readonly ordinal: number | null
    readonly reasonCode: string
  }
}

export type AbilityEncounterEvent =
  | AbilityActionEncounterEvent
  | AbilityMoveEncounterEvent
  | AbilityStrikeEncounterEvent
  | AbilityHpEncounterEvent
  | AbilityConditionEncounterEvent
  | AbilityCombatStageEncounterEvent
  | AbilityStatEncounterEvent
  | AbilityMovementEncounterEvent
  | AbilityPresenceEncounterEvent
  | AbilityInitiativeEncounterEvent
  | AbilityItemEncounterEvent
  | AbilityFieldEncounterEvent
  | AbilityLifecycleEncounterEvent

export const ABILITY_ENCOUNTER_EVENT_LIMITS = Object.freeze({
  eventsPerBatch: 1_024,
  targets: 64,
  tags: 32,
  identifierLength: 200,
  hp: 10_000_000,
  itemQuantity: 1_000_000,
  movementPathCells: 256,
  movementZoneTransitions: 256,
  coordinate: 1_000_000,
  distance: 1_000_000,
  sequence: 10_000_000,
  revision: Number.MAX_SAFE_INTEGER,
})

export type AbilityEncounterEventValidationCode =
  | 'invalid-event'
  | 'unknown-event-kind'
  | 'duplicate-event-id'
  | 'invalid-sequence'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityEncounterEventValidationError extends Error {
  readonly code: AbilityEncounterEventValidationCode
  readonly path: string

  constructor(code: AbilityEncounterEventValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityEncounterEventValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ENVELOPE_FIELDS = [
  'schemaVersion', 'eventId', 'kind', 'sequence', 'mapSlug', 'mapRevision', 'sceneId',
  'occurredAt', 'actorPlacementId', 'sourceResolutionId', 'parentEventId', 'payload',
] as const
const PAYLOAD_FIELDS: Record<AbilityEncounterEventKind, readonly string[]> = {
  action: ['actionKind', 'actionId', 'timing', 'outcome', 'targetPlacementIds', 'tags'],
  move: [
    'resolutionId', 'canonicalMoveId', 'moveDefinitionHash', 'userPlacementId', 'timing',
    'outcome', 'moveType', 'damageClass', 'rangeKind', 'minimumRange', 'maximumRange',
    'keywords', 'semanticBranchIds', 'declaredTargetIds', 'attackedTargetIds', 'hitTargetIds', 'missedTargetIds', 'criticalTargetIds',
    'parentMoveResolutionId',
  ],
  strike: [
    'moveResolutionId', 'canonicalMoveId', 'moveDefinitionHash', 'sourceOperationId',
    'strikeIndex', 'strikeCount', 'attackerPlacementId', 'defenderPlacementId', 'timing',
    'accuracyOutcome', 'rangeContext', 'makesContact', 'directness', 'moveType',
    'damageClass', 'critical', 'effectiveness', 'effectivenessMultiplier', 'rolledDamage',
    'postDefenseDamage', 'damageReduction', 'preventedDamage', 'temporaryHpLoss',
    'hpLoss', 'totalLoss', 'preventionReasonCodes',
  ],
  hp: [
    'placementId', 'changeKind', 'before', 'after', 'maximumBefore', 'maximumAfter', 'fullMaximum',
    'temporaryBefore', 'temporaryAfter', 'requestedAmount', 'appliedAmount', 'crossedZero',
    'crossedInjuryThreshold', 'injuriesBefore', 'injuriesAfter', 'massiveDamage',
    'massiveDamageThreshold', 'massiveDamageAmount', 'massiveDamageInjuryApplied',
    'faintedBefore', 'faintedAfter', 'faintTransition', 'sourceOperationId',
    'applicationId', 'reasonCode',
  ],
  condition: [
    'placementId', 'conditionId', 'operation', 'outcome', 'before', 'after', 'saveRollId',
    'transferPlacementId', 'sourcePlacementId', 'sourceAbilityInstanceId', 'sourceEffectId',
    'sourceOperationId', 'applicationId', 'preventionReasonCodes', 'reasonCode',
  ],
  'combat-stage': [
    'placementId', 'stat', 'before', 'requestedDelta', 'appliedDelta', 'after', 'minimum',
    'maximum', 'outcome', 'transferPlacementId', 'sourcePlacementId',
    'sourceAbilityInstanceId', 'sourceOperationId', 'applicationId',
    'preventionReasonCodes', 'reasonCode',
  ],
  stat: [
    'placementId', 'stat', 'layer', 'before', 'requestedDelta', 'appliedDelta', 'after',
    'minimum', 'maximum', 'outcome', 'transferPlacementId', 'sourcePlacementId',
    'sourceAbilityInstanceId', 'sourceOperationId', 'applicationId',
    'preventionReasonCodes', 'reasonCode',
  ],
  movement: [
    'placementId', 'movementId', 'checkpoint', 'mode', 'step', 'stepCount', 'pathCells',
    'from', 'to', 'distanceBefore', 'distanceAfter', 'totalDistance', 'groundedBefore',
    'groundedAfter', 'adjacentPlacementIdsBefore', 'adjacentPlacementIdsAfter',
    'terrainIdsBefore', 'terrainIdsAfter', 'zoneTransitions', 'sourcePlacementId',
    'sourceAbilityInstanceId', 'sourceOperationId', 'applicationId', 'reasonCode',
  ],
  presence: [
    'operation', 'outgoingPlacementId', 'incomingPlacementId', 'sideId', 'outgoingCell',
    'incomingCell', 'initiativeRevision', 'sourceOperationId', 'applicationId', 'reasonCode',
  ],
  initiative: [
    'change', 'placementId', 'orderBefore', 'orderAfter', 'activePlacementIdBefore',
    'activePlacementIdAfter', 'roundBefore', 'roundAfter', 'turnBefore', 'turnAfter',
    'initiativeRevisionBefore', 'initiativeRevisionAfter', 'sourceOperationId',
    'applicationId', 'reasonCode',
  ],
  item: [
    'change', 'outcome', 'resourceKind', 'itemId', 'itemResourceId', 'quantityRequested',
    'quantityApplied', 'ownerIdBefore', 'ownerIdAfter', 'slotIdBefore', 'slotIdAfter',
    'resourceRevisionBefore', 'resourceRevisionAfter', 'sourcePlacementId',
    'sourceAbilityInstanceId', 'sourceOperationId', 'applicationId',
    'preventionReasonCodes', 'reasonCode',
  ],
  field: [
    'fieldKind', 'fieldId', 'zoneId', 'change', 'outcome', 'presentBefore', 'presentAfter',
    'layerBefore', 'layerAfter', 'remainingRoundsBefore', 'remainingRoundsAfter',
    'fieldRevisionBefore', 'fieldRevisionAfter', 'sourcePlacementId',
    'sourceAbilityInstanceId', 'sourceOperationId', 'applicationId',
    'preventionReasonCodes', 'reasonCode',
  ],
  lifecycle: [
    'boundary', 'transition', 'subjectPlacementId', 'abilityInstanceId', 'ordinal', 'reasonCode',
  ],
}
const EVENT_KIND_SET = new Set<string>(ABILITY_ENCOUNTER_EVENT_KINDS)
const ACTION_KIND_SET = new Set<string>(ABILITY_ACTION_EVENT_KINDS)
const ACTION_TIMING_SET = new Set<string>(ABILITY_ACTION_EVENT_TIMINGS)
const ACTION_OUTCOME_SET = new Set<string>(ABILITY_ACTION_EVENT_OUTCOMES)
const MOVE_TIMING_SET = new Set<string>(ABILITY_MOVE_EVENT_TIMINGS)
const MOVE_DAMAGE_CLASS_SET = new Set<string>(ABILITY_MOVE_DAMAGE_CLASSES)
const MOVE_RANGE_KIND_SET = new Set<string>(ABILITY_MOVE_RANGE_KINDS)
const MOVE_KEYWORD_SET = new Set<string>(ABILITY_MOVE_KEYWORDS)
const MOVE_TYPE_SET = new Set<string>(POKEMON_TYPE_IDS)
const STRIKE_TIMING_SET = new Set<string>(ABILITY_STRIKE_EVENT_TIMINGS)
const STRIKE_ACCURACY_SET = new Set<string>(ABILITY_STRIKE_ACCURACY_OUTCOMES)
const STRIKE_RANGE_SET = new Set<string>(ABILITY_STRIKE_RANGE_CONTEXTS)
const STRIKE_DIRECTNESS_SET = new Set<string>(ABILITY_STRIKE_DIRECTNESS)
const STRIKE_EFFECTIVENESS_SET = new Set<string>(ABILITY_STRIKE_EFFECTIVENESS)
const STRIKE_EFFECTIVENESS_MULTIPLIER: Readonly<Record<AbilityStrikeEffectiveness, number>> = Object.freeze({
  immune: 0,
  'double-resisted': 0.25,
  resisted: 0.5,
  neutral: 1,
  'super-effective': 2,
  'double-super-effective': 4,
})
const HP_KIND_SET = new Set<string>(ABILITY_HP_CHANGE_KINDS)
const FAINT_TRANSITION_SET = new Set<string>(ABILITY_FAINT_TRANSITIONS)
const CONDITION_OPERATION_SET = new Set<string>(ABILITY_CONDITION_OPERATIONS)
const CONDITION_OUTCOME_SET = new Set<string>(ABILITY_CONDITION_OUTCOMES)
const CHANGE_OUTCOME_SET = new Set<string>(ABILITY_CHANGE_OUTCOMES)
const STAGE_STAT_SET = new Set<string>(ABILITY_COMBAT_STAGE_STATS)
const STAT_KIND_SET = new Set<string>(ABILITY_STAT_KINDS)
const STAT_LAYER_SET = new Set<string>(ABILITY_STAT_LAYERS)
const MOVEMENT_CHECKPOINT_SET = new Set<string>(ABILITY_MOVEMENT_CHECKPOINTS)
const MOVEMENT_MODE_SET = new Set<string>(ABILITY_MOVEMENT_MODES)
const MOVEMENT_ZONE_TRANSITION_SET = new Set<string>(ABILITY_MOVEMENT_ZONE_TRANSITIONS)
const ZONE_KIND_SET = new Set<string>(ENCOUNTER_ZONE_KINDS)
const PRESENCE_OPERATION_SET = new Set<string>(ABILITY_PRESENCE_OPERATIONS)
const INITIATIVE_CHANGE_SET = new Set<string>(ABILITY_INITIATIVE_CHANGES)
const ITEM_CHANGE_SET = new Set<string>(ABILITY_ITEM_CHANGES)
const ITEM_RESOURCE_KIND_SET = new Set<string>(ABILITY_ITEM_RESOURCE_KINDS)
const ITEM_OUTCOME_SET = new Set<string>(ABILITY_ITEM_OUTCOMES)
const FIELD_KIND_SET = new Set<string>(ABILITY_FIELD_KINDS)
const FIELD_CHANGE_SET = new Set<string>(ABILITY_FIELD_CHANGES)
const FIELD_OUTCOME_SET = new Set<string>(ABILITY_FIELD_OUTCOMES)
const LIFECYCLE_BOUNDARY_SET = new Set<string>(ABILITY_LIFECYCLE_BOUNDARIES)
const LIFECYCLE_TRANSITION_SET = new Set<string>(ABILITY_LIFECYCLE_TRANSITIONS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: AbilityEncounterEventValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityEncounterEventValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 6,
    nodes: 32_768,
    objectFields: 32,
    arrayEntries: ABILITY_ENCOUNTER_EVENT_LIMITS.eventsPerBatch,
    stringLength: ABILITY_ENCOUNTER_EVENT_LIMITS.identifierLength,
    objectKeyLength: ABILITY_ENCOUNTER_EVENT_LIMITS.identifierLength,
  },
  rootLabel: 'ability encounter event',
  valueLabel: 'ability encounter events',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-event', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) fail('invalid-event', path, 'has an invalid shape.')
}

const text = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_ENCOUNTER_EVENT_LIMITS.identifierLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-event', path, 'must be bounded trimmed text.')
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-event', path, 'must be a stable identifier.')
  return id
}

const optionalStableId = (value: unknown, path: string): string | null => (
  value === null ? null : stableId(value, path)
)

const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail('invalid-event', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const enumValue = <Value extends string>(
  value: unknown,
  path: string,
  supported: ReadonlySet<string>,
): Value => {
  if (typeof value !== 'string' || !supported.has(value)) {
    return fail('invalid-event', path, 'is unsupported.')
  }
  return value as Value
}

const stableIds = (value: unknown, path: string, maximum: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('limit-exceeded', path, 'must be a bounded array.')
  }
  const values = (value as readonly unknown[]).map((entry, index) => (
    stableId(entry, `${path}[${index}]`)
  ))
  if (new Set(values).size !== values.length) fail('invalid-event', path, 'must not repeat IDs.')
  return Object.freeze(values)
}

const canonicalStableIds = (value: unknown, path: string, maximum: number): readonly string[] => {
  const values = stableIds(value, path, maximum)
  if (values.some((entry, index) => index > 0 && entry <= values[index - 1]!)) {
    fail('invalid-event', path, 'must use unique Unicode code-point order.')
  }
  return values
}

const parseMovementCell = (value: unknown, path: string): AbilityMovementCell => {
  const cell = record(value, path)
  exact(cell, ['x', 'y', 'z'], path)
  return Object.freeze({
    x: integer(cell.x, `${path}.x`, -ABILITY_ENCOUNTER_EVENT_LIMITS.coordinate, ABILITY_ENCOUNTER_EVENT_LIMITS.coordinate),
    y: integer(cell.y, `${path}.y`, -ABILITY_ENCOUNTER_EVENT_LIMITS.coordinate, ABILITY_ENCOUNTER_EVENT_LIMITS.coordinate),
    z: integer(cell.z, `${path}.z`, -ABILITY_ENCOUNTER_EVENT_LIMITS.coordinate, ABILITY_ENCOUNTER_EVENT_LIMITS.coordinate),
  })
}

const movementCellsEqual = (left: AbilityMovementCell, right: AbilityMovementCell): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const parseMovementZoneFacts = (value: unknown, path: string): readonly AbilityMovementZoneFact[] => {
  if (!Array.isArray(value) || value.length > ABILITY_ENCOUNTER_EVENT_LIMITS.movementZoneTransitions) {
    fail('limit-exceeded', path, 'must be a bounded zone-transition array.')
  }
  const facts = (value as readonly unknown[]).map((entry, index) => {
    const entryPath = `${path}[${index}]`
    const fact = record(entry, entryPath)
    exact(fact, [
      'zoneId', 'zoneKind', 'transition', 'sourcePlacementId',
      'sourceAbilityInstanceId', 'sourceOperationId',
    ], entryPath)
    const sourcePlacementId = optionalStableId(fact.sourcePlacementId, `${entryPath}.sourcePlacementId`)
    const sourceAbilityInstanceId = optionalStableId(
      fact.sourceAbilityInstanceId,
      `${entryPath}.sourceAbilityInstanceId`,
    )
    if (sourceAbilityInstanceId !== null && sourcePlacementId === null) {
      fail('invalid-event', entryPath, 'an ability zone source requires its source placement.')
    }
    return Object.freeze({
      zoneId: stableId(fact.zoneId, `${entryPath}.zoneId`),
      zoneKind: enumValue<EncounterZoneKind>(fact.zoneKind, `${entryPath}.zoneKind`, ZONE_KIND_SET),
      transition: enumValue<AbilityMovementZoneTransition>(
        fact.transition,
        `${entryPath}.transition`,
        MOVEMENT_ZONE_TRANSITION_SET,
      ),
      sourcePlacementId,
      sourceAbilityInstanceId,
      sourceOperationId: optionalStableId(fact.sourceOperationId, `${entryPath}.sourceOperationId`),
    })
  })
  if (new Set(facts.map(fact => `${fact.transition}:${fact.zoneId}`)).size !== facts.length) {
    fail('invalid-event', path, 'must not repeat a zone transition.')
  }
  return Object.freeze(facts)
}

const parsePayload = (
  value: unknown,
  kind: AbilityEncounterEventKind,
  path: string,
): AbilityEncounterEvent['payload'] => {
  const payload = record(value, path)
  exact(payload, PAYLOAD_FIELDS[kind], path)
  if (kind === 'action') {
    const timing = enumValue<AbilityActionEventTiming>(payload.timing, `${path}.timing`, ACTION_TIMING_SET)
    const outcome = payload.outcome === null
      ? null
      : enumValue<AbilityActionEventOutcome>(payload.outcome, `${path}.outcome`, ACTION_OUTCOME_SET)
    if ((timing === 'completed' || timing === 'cancelled') !== (outcome !== null)) {
      fail('invalid-event', path, 'terminal action timing alone requires an outcome.')
    }
    return Object.freeze({
      actionKind: enumValue<AbilityActionEventKind>(payload.actionKind, `${path}.actionKind`, ACTION_KIND_SET),
      actionId: stableId(payload.actionId, `${path}.actionId`),
      timing,
      outcome,
      targetPlacementIds: stableIds(payload.targetPlacementIds, `${path}.targetPlacementIds`, ABILITY_ENCOUNTER_EVENT_LIMITS.targets),
      tags: stableIds(payload.tags, `${path}.tags`, ABILITY_ENCOUNTER_EVENT_LIMITS.tags),
    })
  }
  if (kind === 'move') {
    const timing = enumValue<AbilityMoveEventTiming>(payload.timing, `${path}.timing`, MOVE_TIMING_SET)
    const outcome = payload.outcome === null
      ? null
      : enumValue<AbilityActionEventOutcome>(payload.outcome, `${path}.outcome`, ACTION_OUTCOME_SET)
    if ((timing === 'completed' || timing === 'cancelled') !== (outcome !== null)) {
      fail('invalid-event', path, 'terminal move timing alone requires an outcome.')
    }
    if (typeof payload.moveDefinitionHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.moveDefinitionHash)) {
      fail('invalid-event', `${path}.moveDefinitionHash`, 'must be SHA-256.')
    }
    const keywordValues = stableIds(payload.keywords, `${path}.keywords`, ABILITY_MOVE_KEYWORDS.length)
    const keywords = keywordValues.map((keyword, index) => {
      if (!MOVE_KEYWORD_SET.has(keyword)) fail('invalid-event', `${path}.keywords[${index}]`, 'is unsupported.')
      return keyword as AbilityMoveKeyword
    })
    const keywordIndexes = keywords.map(keyword => ABILITY_MOVE_KEYWORDS.indexOf(keyword))
    if (keywordIndexes.some((value, index) => index > 0 && value <= keywordIndexes[index - 1]!)) {
      fail('invalid-event', `${path}.keywords`, 'must use canonical keyword order.')
    }
    const rangeKind = enumValue<AbilityMoveRangeKind>(
      payload.rangeKind,
      `${path}.rangeKind`,
      MOVE_RANGE_KIND_SET,
    )
    const minimumRange = payload.minimumRange === null
      ? null
      : integer(payload.minimumRange, `${path}.minimumRange`, 0, 10_000)
    const maximumRange = payload.maximumRange === null
      ? null
      : integer(payload.maximumRange, `${path}.maximumRange`, 0, 10_000)
    if ((minimumRange === null) !== (maximumRange === null)
      || (minimumRange !== null && maximumRange !== null && minimumRange > maximumRange)
      || (rangeKind === 'self' && (minimumRange !== 0 || maximumRange !== 0))
      || (rangeKind === 'field' && minimumRange !== null)
      || (!['self', 'field', 'other'].includes(rangeKind) && maximumRange === null)) {
      fail('invalid-event', path, 'move range facts are inconsistent.')
    }
    const semanticBranchIds = stableIds(
      payload.semanticBranchIds,
      `${path}.semanticBranchIds`,
      64,
    )
    const declaredTargetIds = stableIds(payload.declaredTargetIds, `${path}.declaredTargetIds`, ABILITY_ENCOUNTER_EVENT_LIMITS.targets)
    const attackedTargetIds = stableIds(payload.attackedTargetIds, `${path}.attackedTargetIds`, ABILITY_ENCOUNTER_EVENT_LIMITS.targets)
    const hitTargetIds = stableIds(payload.hitTargetIds, `${path}.hitTargetIds`, ABILITY_ENCOUNTER_EVENT_LIMITS.targets)
    const missedTargetIds = stableIds(payload.missedTargetIds, `${path}.missedTargetIds`, ABILITY_ENCOUNTER_EVENT_LIMITS.targets)
    const criticalTargetIds = stableIds(payload.criticalTargetIds, `${path}.criticalTargetIds`, ABILITY_ENCOUNTER_EVENT_LIMITS.targets)
    const attacked = new Set(attackedTargetIds)
    const hit = new Set(hitTargetIds)
    if (hitTargetIds.some(id => !attacked.has(id))
      || missedTargetIds.some(id => !attacked.has(id) || hit.has(id))
      || criticalTargetIds.some(id => !hit.has(id))) {
      fail('invalid-event', path, 'move hit/miss/critical targets are inconsistent.')
    }
    if (timing === 'declared'
      && [attackedTargetIds, hitTargetIds, missedTargetIds, criticalTargetIds].some(ids => ids.length > 0)) {
      fail('invalid-event', path, 'declared move cannot contain resolved target outcomes.')
    }
    return Object.freeze({
      resolutionId: stableId(payload.resolutionId, `${path}.resolutionId`),
      canonicalMoveId: text(payload.canonicalMoveId, `${path}.canonicalMoveId`),
      moveDefinitionHash: payload.moveDefinitionHash as string,
      userPlacementId: stableId(payload.userPlacementId, `${path}.userPlacementId`),
      timing,
      outcome,
      moveType: enumValue<PokemonTypeId>(payload.moveType, `${path}.moveType`, MOVE_TYPE_SET),
      damageClass: enumValue<AbilityMoveDamageClass>(
        payload.damageClass,
        `${path}.damageClass`,
        MOVE_DAMAGE_CLASS_SET,
      ),
      rangeKind,
      minimumRange,
      maximumRange,
      keywords: Object.freeze(keywords),
      semanticBranchIds,
      declaredTargetIds,
      attackedTargetIds,
      hitTargetIds,
      missedTargetIds,
      criticalTargetIds,
      parentMoveResolutionId: optionalStableId(
        payload.parentMoveResolutionId,
        `${path}.parentMoveResolutionId`,
      ),
    })
  }
  if (kind === 'strike') {
    const timing = enumValue<AbilityStrikeEventTiming>(payload.timing, `${path}.timing`, STRIKE_TIMING_SET)
    const accuracyOutcome = enumValue<AbilityStrikeAccuracyOutcome>(
      payload.accuracyOutcome,
      `${path}.accuracyOutcome`,
      STRIKE_ACCURACY_SET,
    )
    const rangeContext = enumValue<AbilityStrikeRangeContext>(
      payload.rangeContext,
      `${path}.rangeContext`,
      STRIKE_RANGE_SET,
    )
    const directness = enumValue<AbilityStrikeDirectness>(
      payload.directness,
      `${path}.directness`,
      STRIKE_DIRECTNESS_SET,
    )
    if (typeof payload.moveDefinitionHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.moveDefinitionHash)) {
      fail('invalid-event', `${path}.moveDefinitionHash`, 'must be SHA-256.')
    }
    if (typeof payload.makesContact !== 'boolean' || typeof payload.critical !== 'boolean') {
      fail('invalid-event', path, 'contact and critical facts must be boolean.')
    }
    if (directness === 'indirect' && payload.makesContact) {
      fail('invalid-event', path, 'indirect damage cannot make contact.')
    }
    if ((accuracyOutcome === 'miss' || accuracyOutcome === 'prevented') && payload.critical) {
      fail('invalid-event', path, 'missed or prevented strikes cannot be critical.')
    }
    const effectiveness = payload.effectiveness === null
      ? null
      : enumValue<AbilityStrikeEffectiveness>(
          payload.effectiveness,
          `${path}.effectiveness`,
          STRIKE_EFFECTIVENESS_SET,
        )
    const effectivenessMultiplier = payload.effectivenessMultiplier === null
      ? null
      : typeof payload.effectivenessMultiplier === 'number'
        && Number.isFinite(payload.effectivenessMultiplier)
        ? payload.effectivenessMultiplier
        : fail('invalid-event', `${path}.effectivenessMultiplier`, 'must be finite or null.')
    if ((effectiveness === null) !== (effectivenessMultiplier === null)
      || (effectiveness !== null
        && effectivenessMultiplier !== STRIKE_EFFECTIVENESS_MULTIPLIER[effectiveness])) {
      fail('invalid-event', path, 'effectiveness label and multiplier disagree.')
    }
    const damageFieldNames = [
      'rolledDamage', 'postDefenseDamage', 'damageReduction', 'preventedDamage',
      'temporaryHpLoss', 'hpLoss', 'totalLoss',
    ] as const
    const damageValues = Object.fromEntries(damageFieldNames.map(field => [
      field,
      payload[field] === null
        ? null
        : integer(payload[field], `${path}.${field}`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.hp),
    ])) as Record<typeof damageFieldNames[number], number | null>
    const preventionReasonCodes = stableIds(
      payload.preventionReasonCodes,
      `${path}.preventionReasonCodes`,
      32,
    )
    if (timing === 'accuracy-resolved') {
      if (damageFieldNames.some(field => damageValues[field] !== null)) {
        fail('invalid-event', path, 'accuracy checkpoint cannot contain damage totals.')
      }
    }
    else {
      if (damageFieldNames.some(field => damageValues[field] === null) || effectiveness === null) {
        fail('invalid-event', path, 'damage checkpoint requires complete totals and effectiveness.')
      }
      const postDefenseDamage = damageValues.postDefenseDamage!
      const damageReduction = damageValues.damageReduction!
      const preventedDamage = damageValues.preventedDamage!
      const totalLoss = damageValues.totalLoss!
      if (damageReduction + preventedDamage > postDefenseDamage
        || postDefenseDamage - damageReduction - preventedDamage !== totalLoss
        || damageValues.temporaryHpLoss! + damageValues.hpLoss! !== totalLoss) {
        fail('invalid-event', path, 'damage prevention and actual loss arithmetic disagree.')
      }
      if ((accuracyOutcome === 'miss' || accuracyOutcome === 'prevented') && totalLoss !== 0) {
        fail('invalid-event', path, 'missed or prevented strikes cannot cause loss.')
      }
      if (payload.damageClass === 'status' && totalLoss !== 0) {
        fail('invalid-event', path, 'status strikes cannot report damage loss.')
      }
    }
    if ((accuracyOutcome === 'prevented'
      || effectiveness === 'immune'
      || (damageValues.preventedDamage ?? 0) > 0) && preventionReasonCodes.length === 0) {
      fail('invalid-event', path, 'prevented damage requires a reason code.')
    }
    const strikeCount = integer(payload.strikeCount, `${path}.strikeCount`, 1, 100)
    const strikeIndex = integer(payload.strikeIndex, `${path}.strikeIndex`, 1, strikeCount)
    return Object.freeze({
      moveResolutionId: stableId(payload.moveResolutionId, `${path}.moveResolutionId`),
      canonicalMoveId: text(payload.canonicalMoveId, `${path}.canonicalMoveId`),
      moveDefinitionHash: payload.moveDefinitionHash as string,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      strikeIndex,
      strikeCount,
      attackerPlacementId: stableId(payload.attackerPlacementId, `${path}.attackerPlacementId`),
      defenderPlacementId: stableId(payload.defenderPlacementId, `${path}.defenderPlacementId`),
      timing,
      accuracyOutcome,
      rangeContext,
      makesContact: payload.makesContact as boolean,
      directness,
      moveType: enumValue<PokemonTypeId>(payload.moveType, `${path}.moveType`, MOVE_TYPE_SET),
      damageClass: enumValue<AbilityMoveDamageClass>(
        payload.damageClass,
        `${path}.damageClass`,
        MOVE_DAMAGE_CLASS_SET,
      ),
      critical: payload.critical as boolean,
      effectiveness,
      effectivenessMultiplier,
      ...damageValues,
      preventionReasonCodes,
    })
  }
  if (kind === 'hp') {
    const changeKind = enumValue<AbilityHpChangeKind>(
      payload.changeKind,
      `${path}.changeKind`,
      HP_KIND_SET,
    )
    const fullMaximum = integer(
      payload.fullMaximum,
      `${path}.fullMaximum`,
      1,
      ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    const maximumBefore = integer(payload.maximumBefore, `${path}.maximumBefore`, 1, fullMaximum)
    const maximumAfter = integer(payload.maximumAfter, `${path}.maximumAfter`, 1, fullMaximum)
    const before = integer(payload.before, `${path}.before`, 0, maximumBefore)
    const after = integer(payload.after, `${path}.after`, 0, maximumAfter)
    const temporaryBefore = integer(payload.temporaryBefore, `${path}.temporaryBefore`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.hp)
    const temporaryAfter = integer(payload.temporaryAfter, `${path}.temporaryAfter`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.hp)
    const requestedAmount = integer(payload.requestedAmount, `${path}.requestedAmount`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.hp)
    const appliedAmount = integer(payload.appliedAmount, `${path}.appliedAmount`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.hp)
    const injuriesBefore = integer(payload.injuriesBefore, `${path}.injuriesBefore`, 0, 100)
    const injuriesAfter = integer(payload.injuriesAfter, `${path}.injuriesAfter`, 0, 100)
    const massiveDamageThreshold = integer(
      payload.massiveDamageThreshold,
      `${path}.massiveDamageThreshold`,
      1,
      ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    const massiveDamageAmount = integer(
      payload.massiveDamageAmount,
      `${path}.massiveDamageAmount`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    if (typeof payload.massiveDamage !== 'boolean'
      || typeof payload.massiveDamageInjuryApplied !== 'boolean'
      || typeof payload.faintedBefore !== 'boolean'
      || typeof payload.faintedAfter !== 'boolean'
      || typeof payload.crossedZero !== 'boolean'
      || typeof payload.crossedInjuryThreshold !== 'boolean') {
      fail('invalid-event', path, 'HP transition flags must be boolean.')
    }
    const faintTransition = enumValue<AbilityFaintTransition>(
      payload.faintTransition,
      `${path}.faintTransition`,
      FAINT_TRANSITION_SET,
    )
    const expectedFaintTransition: AbilityFaintTransition = before > 0 && after === 0
      ? 'fainted'
      : before === 0 && after > 0
        ? 'revived'
        : 'none'
    const lossKinds: readonly AbilityHpChangeKind[] = [
      'damage', 'drain', 'recoil', 'cost', 'temporary-loss',
    ]
    const gainKinds: readonly AbilityHpChangeKind[] = ['healing', 'temporary-gain', 'revive']
    const netDelta = (after + temporaryAfter) - (before + temporaryBefore)
    const massiveEligible = changeKind === 'damage' || changeKind === 'drain' || changeKind === 'recoil'
    const expectedMassive = massiveEligible && massiveDamageAmount >= massiveDamageThreshold
    if (massiveDamageThreshold !== Math.ceil(fullMaximum / 2)
      || appliedAmount > requestedAmount
      || (lossKinds.includes(changeKind) && appliedAmount !== Math.max(0, -netDelta))
      || (gainKinds.includes(changeKind) && appliedAmount !== Math.max(0, netDelta))
      || payload.crossedZero !== (before > 0 && after === 0)
      || payload.crossedInjuryThreshold !== (injuriesAfter > injuriesBefore)
      || payload.faintedBefore !== (before === 0)
      || payload.faintedAfter !== (after === 0)
      || faintTransition !== expectedFaintTransition
      || payload.massiveDamage !== expectedMassive
      || (payload.massiveDamageInjuryApplied
        && (!expectedMassive || injuriesAfter <= injuriesBefore))) {
      fail('invalid-event', path, 'has inconsistent HP, injury, massive-damage, or faint facts.')
    }
    return Object.freeze({
      placementId: stableId(payload.placementId, `${path}.placementId`),
      changeKind,
      before,
      after,
      maximumBefore,
      maximumAfter,
      fullMaximum,
      temporaryBefore,
      temporaryAfter,
      requestedAmount,
      appliedAmount,
      crossedZero: payload.crossedZero as boolean,
      crossedInjuryThreshold: payload.crossedInjuryThreshold as boolean,
      injuriesBefore,
      injuriesAfter,
      massiveDamage: payload.massiveDamage as boolean,
      massiveDamageThreshold,
      massiveDamageAmount,
      massiveDamageInjuryApplied: payload.massiveDamageInjuryApplied as boolean,
      faintedBefore: payload.faintedBefore as boolean,
      faintedAfter: payload.faintedAfter as boolean,
      faintTransition,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  if (kind === 'condition') {
    const operation = enumValue<AbilityConditionOperation>(
      payload.operation,
      `${path}.operation`,
      CONDITION_OPERATION_SET,
    )
    const outcome = enumValue<AbilityConditionOutcome>(
      payload.outcome,
      `${path}.outcome`,
      CONDITION_OUTCOME_SET,
    )
    if (typeof payload.before !== 'boolean' || typeof payload.after !== 'boolean') {
      fail('invalid-event', path, 'condition before/after facts must be boolean.')
    }
    const before = payload.before as boolean
    const after = payload.after as boolean
    const saveRollId = optionalStableId(payload.saveRollId, `${path}.saveRollId`)
    const transferPlacementId = optionalStableId(
      payload.transferPlacementId,
      `${path}.transferPlacementId`,
    )
    const sourcePlacementId = optionalStableId(payload.sourcePlacementId, `${path}.sourcePlacementId`)
    const sourceAbilityInstanceId = optionalStableId(
      payload.sourceAbilityInstanceId,
      `${path}.sourceAbilityInstanceId`,
    )
    const preventionReasonCodes = stableIds(
      payload.preventionReasonCodes,
      `${path}.preventionReasonCodes`,
      32,
    )
    const validTransition = operation === 'apply'
      ? outcome === 'applied' ? !before && after : after === before
      : operation === 'save'
        ? outcome === 'succeeded' ? before && !after : outcome === 'failed' && before === after
        : operation === 'transfer'
          ? outcome === 'transferred' && before && !after
          : outcome === 'applied' ? before && !after : after === before
    if (!validTransition
      || ((operation === 'save') !== (saveRollId !== null))
      || ((operation === 'transfer') !== (transferPlacementId !== null))
      || ((sourcePlacementId === null) !== (sourceAbilityInstanceId === null))
      || (outcome === 'prevented' && preventionReasonCodes.length === 0)) {
      fail('invalid-event', path, 'condition operation, outcome, or source facts are inconsistent.')
    }
    return Object.freeze({
      placementId: stableId(payload.placementId, `${path}.placementId`),
      conditionId: stableId(payload.conditionId, `${path}.conditionId`),
      operation,
      outcome,
      before,
      after,
      saveRollId,
      transferPlacementId,
      sourcePlacementId,
      sourceAbilityInstanceId,
      sourceEffectId: optionalStableId(payload.sourceEffectId, `${path}.sourceEffectId`),
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      preventionReasonCodes,
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  if (kind === 'combat-stage' || kind === 'stat') {
    const minimum = integer(
      payload.minimum,
      `${path}.minimum`,
      kind === 'combat-stage' ? -6 : -ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
      kind === 'combat-stage' ? 6 : ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    const maximum = integer(
      payload.maximum,
      `${path}.maximum`,
      kind === 'combat-stage' ? -6 : -ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
      kind === 'combat-stage' ? 6 : ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    if (minimum > maximum) fail('invalid-event', path, 'change bounds are inverted.')
    const before = integer(payload.before, `${path}.before`, minimum, maximum)
    const requestedDelta = integer(
      payload.requestedDelta,
      `${path}.requestedDelta`,
      -ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
      ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    const appliedDelta = integer(
      payload.appliedDelta,
      `${path}.appliedDelta`,
      -ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
      ABILITY_ENCOUNTER_EVENT_LIMITS.hp,
    )
    const after = integer(payload.after, `${path}.after`, minimum, maximum)
    const outcome = enumValue<AbilityChangeOutcome>(
      payload.outcome,
      `${path}.outcome`,
      CHANGE_OUTCOME_SET,
    )
    const transferPlacementId = optionalStableId(
      payload.transferPlacementId,
      `${path}.transferPlacementId`,
    )
    const sourcePlacementId = optionalStableId(payload.sourcePlacementId, `${path}.sourcePlacementId`)
    const sourceAbilityInstanceId = optionalStableId(
      payload.sourceAbilityInstanceId,
      `${path}.sourceAbilityInstanceId`,
    )
    const preventionReasonCodes = stableIds(
      payload.preventionReasonCodes,
      `${path}.preventionReasonCodes`,
      32,
    )
    const validOutcome = outcome === 'applied'
      ? appliedDelta === requestedDelta
      : outcome === 'capped'
        ? appliedDelta !== requestedDelta && (after === minimum || after === maximum)
        : outcome === 'prevented'
          ? appliedDelta === 0 && after === before
          : outcome === 'reset'
            ? after === 0 && appliedDelta === -before
            : transferPlacementId !== null
    if (before + appliedDelta !== after
      || !validOutcome
      || ((outcome === 'transferred') !== (transferPlacementId !== null))
      || ((sourcePlacementId === null) !== (sourceAbilityInstanceId === null))
      || ((outcome === 'prevented' || outcome === 'capped')
        && preventionReasonCodes.length === 0)) {
      fail('invalid-event', path, 'change arithmetic, outcome, or source facts are inconsistent.')
    }
    const common = {
      placementId: stableId(payload.placementId, `${path}.placementId`),
      before,
      requestedDelta,
      appliedDelta,
      after,
      minimum,
      maximum,
      outcome,
      transferPlacementId,
      sourcePlacementId,
      sourceAbilityInstanceId,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      preventionReasonCodes,
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    }
    return kind === 'combat-stage'
      ? Object.freeze({
          ...common,
          stat: enumValue<AbilityCombatStageStat>(payload.stat, `${path}.stat`, STAGE_STAT_SET),
        })
      : Object.freeze({
          ...common,
          stat: enumValue<AbilityStatKind>(payload.stat, `${path}.stat`, STAT_KIND_SET),
          layer: enumValue<AbilityStatLayer>(payload.layer, `${path}.layer`, STAT_LAYER_SET),
        })
  }
  if (kind === 'movement') {
    const checkpoint = enumValue<AbilityMovementCheckpoint>(
      payload.checkpoint,
      `${path}.checkpoint`,
      MOVEMENT_CHECKPOINT_SET,
    )
    const mode = enumValue<AbilityMovementMode>(payload.mode, `${path}.mode`, MOVEMENT_MODE_SET)
    if (!Array.isArray(payload.pathCells)
      || payload.pathCells.length < 2
      || payload.pathCells.length > ABILITY_ENCOUNTER_EVENT_LIMITS.movementPathCells) {
      fail('limit-exceeded', `${path}.pathCells`, 'must contain a bounded origin-first path.')
    }
    const pathCells = (payload.pathCells as readonly unknown[]).map((cell, index) => (
      parseMovementCell(cell, `${path}.pathCells[${index}]`)
    ))
    if (pathCells.some((cell, index) => index > 0 && movementCellsEqual(cell, pathCells[index - 1]!))) {
      fail('invalid-event', `${path}.pathCells`, 'must not contain consecutive duplicate cells.')
    }
    const stepCount = integer(payload.stepCount, `${path}.stepCount`, 1, pathCells.length - 1)
    if (stepCount !== pathCells.length - 1) {
      fail('invalid-event', `${path}.stepCount`, 'must match the immutable path.')
    }
    const step = integer(payload.step, `${path}.step`, 1, stepCount)
    const from = parseMovementCell(payload.from, `${path}.from`)
    const to = parseMovementCell(payload.to, `${path}.to`)
    if (!movementCellsEqual(from, pathCells[step - 1]!)
      || !movementCellsEqual(to, pathCells[step]!)) {
      fail('invalid-event', path, 'step cells must match the immutable path.')
    }
    const distanceBefore = integer(
      payload.distanceBefore,
      `${path}.distanceBefore`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.distance,
    )
    const distanceAfter = integer(
      payload.distanceAfter,
      `${path}.distanceAfter`,
      distanceBefore,
      ABILITY_ENCOUNTER_EVENT_LIMITS.distance,
    )
    const totalDistance = integer(
      payload.totalDistance,
      `${path}.totalDistance`,
      distanceAfter,
      ABILITY_ENCOUNTER_EVENT_LIMITS.distance,
    )
    if (step === stepCount && distanceAfter !== totalDistance) {
      fail('invalid-event', path, 'the final path step must reach total distance.')
    }
    if (typeof payload.groundedBefore !== 'boolean' || typeof payload.groundedAfter !== 'boolean') {
      fail('invalid-event', path, 'grounding facts must be boolean.')
    }
    const placementId = stableId(payload.placementId, `${path}.placementId`)
    const adjacentPlacementIdsBefore = canonicalStableIds(
      payload.adjacentPlacementIdsBefore,
      `${path}.adjacentPlacementIdsBefore`,
      ABILITY_ENCOUNTER_EVENT_LIMITS.targets,
    )
    const adjacentPlacementIdsAfter = canonicalStableIds(
      payload.adjacentPlacementIdsAfter,
      `${path}.adjacentPlacementIdsAfter`,
      ABILITY_ENCOUNTER_EVENT_LIMITS.targets,
    )
    if (adjacentPlacementIdsBefore.includes(placementId)
      || adjacentPlacementIdsAfter.includes(placementId)) {
      fail('invalid-event', path, 'a moving placement cannot be adjacent to itself.')
    }
    const sourcePlacementId = optionalStableId(payload.sourcePlacementId, `${path}.sourcePlacementId`)
    const sourceAbilityInstanceId = optionalStableId(
      payload.sourceAbilityInstanceId,
      `${path}.sourceAbilityInstanceId`,
    )
    if (sourceAbilityInstanceId !== null && sourcePlacementId === null) {
      fail('invalid-event', path, 'an ability movement source requires its source placement.')
    }
    return Object.freeze({
      placementId,
      movementId: stableId(payload.movementId, `${path}.movementId`),
      checkpoint,
      mode,
      step,
      stepCount,
      pathCells: Object.freeze(pathCells),
      from,
      to,
      distanceBefore,
      distanceAfter,
      totalDistance,
      groundedBefore: payload.groundedBefore as boolean,
      groundedAfter: payload.groundedAfter as boolean,
      adjacentPlacementIdsBefore,
      adjacentPlacementIdsAfter,
      terrainIdsBefore: canonicalStableIds(
        payload.terrainIdsBefore,
        `${path}.terrainIdsBefore`,
        64,
      ),
      terrainIdsAfter: canonicalStableIds(
        payload.terrainIdsAfter,
        `${path}.terrainIdsAfter`,
        64,
      ),
      zoneTransitions: parseMovementZoneFacts(payload.zoneTransitions, `${path}.zoneTransitions`),
      sourcePlacementId,
      sourceAbilityInstanceId,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  if (kind === 'presence') {
    const operation = enumValue<AbilityPresenceOperation>(
      payload.operation,
      `${path}.operation`,
      PRESENCE_OPERATION_SET,
    )
    const outgoingPlacementId = optionalStableId(
      payload.outgoingPlacementId,
      `${path}.outgoingPlacementId`,
    )
    const incomingPlacementId = optionalStableId(
      payload.incomingPlacementId,
      `${path}.incomingPlacementId`,
    )
    const outgoingCell = payload.outgoingCell === null
      ? null
      : parseMovementCell(payload.outgoingCell, `${path}.outgoingCell`)
    const incomingCell = payload.incomingCell === null
      ? null
      : parseMovementCell(payload.incomingCell, `${path}.incomingCell`)
    const validOperation = operation === 'send-out'
      ? outgoingPlacementId === null && outgoingCell === null
        && incomingPlacementId !== null && incomingCell !== null
      : operation === 'recall'
        ? outgoingPlacementId !== null && outgoingCell !== null
          && incomingPlacementId === null && incomingCell === null
        : outgoingPlacementId !== null && outgoingCell !== null
          && incomingPlacementId !== null && incomingCell !== null
          && outgoingPlacementId !== incomingPlacementId
    if (!validOperation) {
      fail('invalid-event', path, 'presence operation does not match its placements and cells.')
    }
    return Object.freeze({
      operation,
      outgoingPlacementId,
      incomingPlacementId,
      sideId: optionalStableId(payload.sideId, `${path}.sideId`),
      outgoingCell,
      incomingCell,
      initiativeRevision: integer(
        payload.initiativeRevision,
        `${path}.initiativeRevision`,
        0,
        ABILITY_ENCOUNTER_EVENT_LIMITS.revision,
      ),
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  if (kind === 'initiative') {
    const change = enumValue<AbilityInitiativeChange>(
      payload.change,
      `${path}.change`,
      INITIATIVE_CHANGE_SET,
    )
    const placementId = optionalStableId(payload.placementId, `${path}.placementId`)
    const orderBefore = stableIds(
      payload.orderBefore,
      `${path}.orderBefore`,
      ABILITY_ENCOUNTER_EVENT_LIMITS.targets,
    )
    const orderAfter = stableIds(
      payload.orderAfter,
      `${path}.orderAfter`,
      ABILITY_ENCOUNTER_EVENT_LIMITS.targets,
    )
    const activePlacementIdBefore = optionalStableId(
      payload.activePlacementIdBefore,
      `${path}.activePlacementIdBefore`,
    )
    const activePlacementIdAfter = optionalStableId(
      payload.activePlacementIdAfter,
      `${path}.activePlacementIdAfter`,
    )
    if ((activePlacementIdBefore !== null && !orderBefore.includes(activePlacementIdBefore))
      || (activePlacementIdAfter !== null && !orderAfter.includes(activePlacementIdAfter))) {
      fail('invalid-event', path, 'active initiative placements must occur in their order.')
    }
    const roundBefore = integer(payload.roundBefore, `${path}.roundBefore`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.sequence)
    const roundAfter = integer(payload.roundAfter, `${path}.roundAfter`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.sequence)
    const turnBefore = integer(payload.turnBefore, `${path}.turnBefore`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.sequence)
    const turnAfter = integer(payload.turnAfter, `${path}.turnAfter`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.sequence)
    const initiativeRevisionBefore = integer(
      payload.initiativeRevisionBefore,
      `${path}.initiativeRevisionBefore`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.revision - 1,
    )
    const initiativeRevisionAfter = integer(
      payload.initiativeRevisionAfter,
      `${path}.initiativeRevisionAfter`,
      1,
      ABILITY_ENCOUNTER_EVENT_LIMITS.revision,
    )
    const beforeSet = new Set(orderBefore)
    const afterSet = new Set(orderAfter)
    const added = orderAfter.filter(id => !beforeSet.has(id))
    const removed = orderBefore.filter(id => !afterSet.has(id))
    const sameMembers = added.length === 0 && removed.length === 0
    const sameOrder = orderBefore.length === orderAfter.length
      && orderBefore.every((id, index) => id === orderAfter[index])
    const validChange = change === 'rolled' || change === 'inserted'
      ? placementId !== null && added.length === 1 && added[0] === placementId && removed.length === 0
      : change === 'removed'
        ? placementId !== null && removed.length === 1 && removed[0] === placementId && added.length === 0
        : change === 'reordered'
          ? sameMembers && !sameOrder
          : change === 'delayed'
            ? placementId !== null && sameMembers && !sameOrder
            : change === 'advanced'
              ? placementId === null && sameOrder
              : placementId === null && sameOrder
    const validClock = change === 'advanced'
      ? roundAfter === roundBefore && turnAfter === turnBefore + 1
      : change === 'reset'
        ? roundAfter === roundBefore + 1 && turnAfter === 0
        : roundAfter === roundBefore && turnAfter === turnBefore
    if (initiativeRevisionAfter !== initiativeRevisionBefore + 1 || !validChange || !validClock) {
      fail('invalid-event', path, 'initiative membership, order, revision, or clock is inconsistent.')
    }
    return Object.freeze({
      change,
      placementId,
      orderBefore,
      orderAfter,
      activePlacementIdBefore,
      activePlacementIdAfter,
      roundBefore,
      roundAfter,
      turnBefore,
      turnAfter,
      initiativeRevisionBefore,
      initiativeRevisionAfter,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  if (kind === 'item') {
    const change = enumValue<AbilityItemChange>(payload.change, `${path}.change`, ITEM_CHANGE_SET)
    const outcome = enumValue<AbilityItemOutcome>(payload.outcome, `${path}.outcome`, ITEM_OUTCOME_SET)
    const resourceKind = enumValue<AbilityItemResourceKind>(
      payload.resourceKind,
      `${path}.resourceKind`,
      ITEM_RESOURCE_KIND_SET,
    )
    const quantityRequested = integer(
      payload.quantityRequested,
      `${path}.quantityRequested`,
      1,
      ABILITY_ENCOUNTER_EVENT_LIMITS.itemQuantity,
    )
    const quantityApplied = integer(
      payload.quantityApplied,
      `${path}.quantityApplied`,
      0,
      quantityRequested,
    )
    const ownerIdBefore = optionalStableId(payload.ownerIdBefore, `${path}.ownerIdBefore`)
    const ownerIdAfter = optionalStableId(payload.ownerIdAfter, `${path}.ownerIdAfter`)
    const slotIdBefore = optionalStableId(payload.slotIdBefore, `${path}.slotIdBefore`)
    const slotIdAfter = optionalStableId(payload.slotIdAfter, `${path}.slotIdAfter`)
    const resourceRevisionBefore = integer(
      payload.resourceRevisionBefore,
      `${path}.resourceRevisionBefore`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.revision - 1,
    )
    const resourceRevisionAfter = integer(
      payload.resourceRevisionAfter,
      `${path}.resourceRevisionAfter`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.revision,
    )
    const sourcePlacementId = optionalStableId(payload.sourcePlacementId, `${path}.sourcePlacementId`)
    const sourceAbilityInstanceId = optionalStableId(
      payload.sourceAbilityInstanceId,
      `${path}.sourceAbilityInstanceId`,
    )
    const preventionReasonCodes = stableIds(
      payload.preventionReasonCodes,
      `${path}.preventionReasonCodes`,
      32,
    )
    const changed = outcome === 'applied' || outcome === 'partial'
    const validQuantity = outcome === 'applied'
      ? quantityApplied === quantityRequested
      : outcome === 'partial'
        ? quantityApplied > 0 && quantityApplied < quantityRequested
        : quantityApplied === 0
    const validOwnership = change === 'transferred'
      ? ownerIdBefore !== null && ownerIdAfter !== null && ownerIdBefore !== ownerIdAfter
      : change === 'equipped'
        ? resourceKind === 'held-item' && ownerIdAfter !== null && slotIdAfter !== null
        : change === 'unequipped'
          ? resourceKind === 'held-item' && ownerIdBefore !== null && slotIdBefore !== null
          : change === 'added' || change === 'picked-up'
            ? ownerIdAfter !== null
            : change === 'removed' || change === 'used' || change === 'consumed' || change === 'dropped'
              ? ownerIdBefore !== null
              : ownerIdBefore !== null && ownerIdAfter !== null
    if (!validQuantity || !validOwnership
      || (resourceKind === 'inventory' && (slotIdBefore !== null || slotIdAfter !== null))
      || resourceRevisionAfter !== resourceRevisionBefore + (changed ? 1 : 0)
      || (sourceAbilityInstanceId !== null && sourcePlacementId === null)
      || (outcome === 'prevented' && preventionReasonCodes.length === 0)) {
      fail('invalid-event', path, 'item quantity, ownership, slot, revision, or source facts are inconsistent.')
    }
    return Object.freeze({
      change,
      outcome,
      resourceKind,
      itemId: stableId(payload.itemId, `${path}.itemId`),
      itemResourceId: stableId(payload.itemResourceId, `${path}.itemResourceId`),
      quantityRequested,
      quantityApplied,
      ownerIdBefore,
      ownerIdAfter,
      slotIdBefore,
      slotIdAfter,
      resourceRevisionBefore,
      resourceRevisionAfter,
      sourcePlacementId,
      sourceAbilityInstanceId,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      preventionReasonCodes,
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  if (kind === 'field') {
    const change = enumValue<AbilityFieldChange>(payload.change, `${path}.change`, FIELD_CHANGE_SET)
    const outcome = enumValue<AbilityFieldOutcome>(payload.outcome, `${path}.outcome`, FIELD_OUTCOME_SET)
    if (typeof payload.presentBefore !== 'boolean' || typeof payload.presentAfter !== 'boolean') {
      fail('invalid-event', path, 'field presence facts must be boolean.')
    }
    const presentBefore = payload.presentBefore as boolean
    const presentAfter = payload.presentAfter as boolean
    const layerBefore = integer(payload.layerBefore, `${path}.layerBefore`, 0, 64)
    const layerAfter = integer(payload.layerAfter, `${path}.layerAfter`, 0, 64)
    const remainingRoundsBefore = payload.remainingRoundsBefore === null
      ? null
      : integer(payload.remainingRoundsBefore, `${path}.remainingRoundsBefore`, 0, 10_000)
    const remainingRoundsAfter = payload.remainingRoundsAfter === null
      ? null
      : integer(payload.remainingRoundsAfter, `${path}.remainingRoundsAfter`, 0, 10_000)
    const fieldRevisionBefore = integer(
      payload.fieldRevisionBefore,
      `${path}.fieldRevisionBefore`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.revision - 1,
    )
    const fieldRevisionAfter = integer(
      payload.fieldRevisionAfter,
      `${path}.fieldRevisionAfter`,
      0,
      ABILITY_ENCOUNTER_EVENT_LIMITS.revision,
    )
    const sourcePlacementId = optionalStableId(payload.sourcePlacementId, `${path}.sourcePlacementId`)
    const sourceAbilityInstanceId = optionalStableId(
      payload.sourceAbilityInstanceId,
      `${path}.sourceAbilityInstanceId`,
    )
    const preventionReasonCodes = stableIds(
      payload.preventionReasonCodes,
      `${path}.preventionReasonCodes`,
      32,
    )
    const changed = outcome === 'applied'
    const validTransition = !changed
      ? presentBefore === presentAfter && layerBefore === layerAfter
        && remainingRoundsBefore === remainingRoundsAfter
      : change === 'applied'
        ? !presentBefore && presentAfter
        : change === 'refreshed'
          ? presentBefore && presentAfter
          : presentBefore && !presentAfter
    if (!validTransition
      || layerBefore !== (presentBefore ? Math.max(1, layerBefore) : 0)
      || layerAfter !== (presentAfter ? Math.max(1, layerAfter) : 0)
      || (!presentBefore && remainingRoundsBefore !== null)
      || (!presentAfter && remainingRoundsAfter !== null)
      || fieldRevisionAfter !== fieldRevisionBefore + (changed ? 1 : 0)
      || (sourceAbilityInstanceId !== null && sourcePlacementId === null)
      || (outcome === 'prevented' && preventionReasonCodes.length === 0)) {
      fail('invalid-event', path, 'field presence, layer, duration, revision, or source facts are inconsistent.')
    }
    return Object.freeze({
      fieldKind: enumValue<AbilityFieldKind>(payload.fieldKind, `${path}.fieldKind`, FIELD_KIND_SET),
      fieldId: stableId(payload.fieldId, `${path}.fieldId`),
      zoneId: stableId(payload.zoneId, `${path}.zoneId`),
      change,
      outcome,
      presentBefore,
      presentAfter,
      layerBefore,
      layerAfter,
      remainingRoundsBefore,
      remainingRoundsAfter,
      fieldRevisionBefore,
      fieldRevisionAfter,
      sourcePlacementId,
      sourceAbilityInstanceId,
      sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
      applicationId: stableId(payload.applicationId, `${path}.applicationId`),
      preventionReasonCodes,
      reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
    })
  }
  const boundary = enumValue<AbilityLifecycleBoundary>(
    payload.boundary,
    `${path}.boundary`,
    LIFECYCLE_BOUNDARY_SET,
  )
  const subjectPlacementId = optionalStableId(payload.subjectPlacementId, `${path}.subjectPlacementId`)
  const abilityInstanceId = optionalStableId(payload.abilityInstanceId, `${path}.abilityInstanceId`)
  const transition = enumValue<AbilityLifecycleTransition>(
    payload.transition,
    `${path}.transition`,
    LIFECYCLE_TRANSITION_SET,
  )
  const ordinal = payload.ordinal === null
    ? null
    : integer(payload.ordinal, `${path}.ordinal`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.sequence)
  const validShape = boundary === 'scene'
    ? (transition === 'started' || transition === 'ended')
      && subjectPlacementId === null && abilityInstanceId === null && ordinal === null
    : boundary === 'round'
      ? (transition === 'started' || transition === 'ended')
        && subjectPlacementId === null && abilityInstanceId === null && ordinal !== null
      : boundary === 'turn'
        ? (transition === 'started' || transition === 'ended')
          && subjectPlacementId !== null && abilityInstanceId === null && ordinal !== null
        : boundary === 'presence'
          ? (transition === 'entered' || transition === 'left')
            && subjectPlacementId !== null && abilityInstanceId === null && ordinal === null
          : boundary === 'effective-ability'
            ? (transition === 'became-effective' || transition === 'became-ineffective')
              && subjectPlacementId !== null && abilityInstanceId !== null && ordinal === null
            : transition === 'changed'
              && subjectPlacementId !== null && abilityInstanceId === null && ordinal === null
  if (!validShape) fail('invalid-event', path, 'lifecycle facts do not match their boundary.')
  return Object.freeze({
    boundary,
    transition,
    subjectPlacementId,
    abilityInstanceId,
    ordinal,
    reasonCode: stableId(payload.reasonCode, `${path}.reasonCode`),
  })
}

export const parseAbilityEncounterEvent = (
  value: unknown,
  path = 'abilityEncounterEvent',
): AbilityEncounterEvent => {
  const input = record(clone(value, path), path)
  exact(input, ENVELOPE_FIELDS, path)
  if (input.schemaVersion !== ABILITY_ENCOUNTER_EVENT_SCHEMA_VERSION) {
    fail('invalid-event', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (typeof input.kind !== 'string' || !EVENT_KIND_SET.has(input.kind)) {
    fail('unknown-event-kind', `${path}.kind`, 'is unsupported.')
  }
  const kind = input.kind as AbilityEncounterEventKind
  const eventId = stableId(input.eventId, `${path}.eventId`)
  const parentEventId = optionalStableId(input.parentEventId, `${path}.parentEventId`)
  if (parentEventId === eventId) fail('invalid-event', `${path}.parentEventId`, 'cannot reference itself.')
  const parsed = {
    schemaVersion: ABILITY_ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId,
    kind,
    sequence: integer(input.sequence, `${path}.sequence`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.sequence),
    mapSlug: text(input.mapSlug, `${path}.mapSlug`),
    mapRevision: integer(input.mapRevision, `${path}.mapRevision`, 0, ABILITY_ENCOUNTER_EVENT_LIMITS.revision),
    sceneId: optionalStableId(input.sceneId, `${path}.sceneId`),
    occurredAt: integer(input.occurredAt, `${path}.occurredAt`, 0, Number.MAX_SAFE_INTEGER),
    actorPlacementId: optionalStableId(input.actorPlacementId, `${path}.actorPlacementId`),
    sourceResolutionId: optionalStableId(input.sourceResolutionId, `${path}.sourceResolutionId`),
    parentEventId,
    payload: parsePayload(input.payload, kind, `${path}.payload`),
  }
  if (kind === 'move') {
    const move = parsed.payload as AbilityMoveEncounterEvent['payload']
    if (
      parsed.actorPlacementId !== move.userPlacementId
      || parsed.sourceResolutionId !== move.resolutionId
    ) fail('invalid-event', path, 'move envelope identity does not match its payload.')
  }
  if (kind === 'strike') {
    const strike = parsed.payload as AbilityStrikeEncounterEvent['payload']
    if (
      parsed.actorPlacementId !== strike.attackerPlacementId
      || parsed.sourceResolutionId !== strike.moveResolutionId
    ) fail('invalid-event', path, 'strike envelope identity does not match its payload.')
  }
  return deepFreezeStrictJson(parsed) as AbilityEncounterEvent
}

export const parseAbilityEncounterEventBatch = (
  value: unknown,
): readonly AbilityEncounterEvent[] => {
  const cloned = clone(value, 'abilityEncounterEvents')
  if (!Array.isArray(cloned) || cloned.length > ABILITY_ENCOUNTER_EVENT_LIMITS.eventsPerBatch) {
    fail('limit-exceeded', 'abilityEncounterEvents', 'must be a bounded array.')
  }
  const eventValues = cloned as readonly unknown[]
  const events = eventValues.map((event, index) => (
    parseAbilityEncounterEvent(event, `abilityEncounterEvents[${index}]`)
  ))
  if (new Set(events.map(event => event.eventId)).size !== events.length) {
    fail('duplicate-event-id', 'abilityEncounterEvents', 'must not repeat event IDs.')
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!
    const current = events[index]!
    if (current.sequence <= previous.sequence
      || current.mapRevision < previous.mapRevision
      || current.occurredAt < previous.occurredAt) {
      fail('invalid-sequence', `abilityEncounterEvents[${index}]`, 'must be causally monotonic.')
    }
  }
  return Object.freeze(events)
}
