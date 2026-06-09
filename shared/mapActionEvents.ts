import type { RealtimeEvent } from './realtime'
import type { MoveAnimationEvent } from '../src/types/moveAnimation'
import type { MoveAutomationFeedbackState } from '../src/types/moveAutomation'
import type { PokeballCaptureAttemptResult } from '../src/utils/pokeballCapture'

export const MAP_ACTION_REALTIME_EVENT_TYPE = 'map-action' as const
export const MAP_ACTION_EVENT_SCHEMA_VERSION = 1 as const

export const MAP_ACTION_EVENT_KINDS = [
  'action-splash',
  'move-animations',
  'move-feedback',
  'pokeball-feedback',
  'pokeball-result',
] as const

export type MapActionEventKind = (typeof MAP_ACTION_EVENT_KINDS)[number]

/**
 * Payload for the map action splash banner. The receiving client resolves the
 * actor placement against its current map state; this payload is only display
 * copy for the transient splash and is not saved as map, sheet, log, campaign,
 * or session state.
 */
export interface MapActionSplashPayload {
  actionName: string
  verb?: string
}

/** Batch of existing move VFX queue events for visual-only remote replay. */
export interface MapActionMoveAnimationsPayload {
  events: readonly MoveAnimationEvent[]
}

/** Move roll/outcome feedback snapshot for visual-only remote replay. */
export interface MapActionMoveFeedbackPayload {
  feedback: MoveAutomationFeedbackState
}

/** Poké Ball accuracy/capture feedback snapshot for visual-only remote replay. */
export interface MapActionPokeballFeedbackPayload {
  feedback: MoveAutomationFeedbackState
}

/** Poké Ball result modal or error copy for visual-only remote replay. */
export interface MapActionPokeballResultPayload {
  result: PokeballCaptureAttemptResult | null
  error?: string | null
}

export interface MapActionEventPayloadByKind {
  'action-splash': MapActionSplashPayload
  'move-animations': MapActionMoveAnimationsPayload
  'move-feedback': MapActionMoveFeedbackPayload
  'pokeball-feedback': MapActionPokeballFeedbackPayload
  'pokeball-result': MapActionPokeballResultPayload
}

export type MapActionEventPayload = MapActionEventPayloadByKind[MapActionEventKind]

/**
 * Shared transient map action event envelope.
 *
 * Map action events are realtime visual cues only. They must never be persisted
 * in map JSON, sheet JSON, campaign/session state, action logs, metadata, or
 * saved sessions, and receiving clients must not apply mechanics such as HP,
 * conditions, combat stages, hazards, inventory, capture deletion, token
 * placement, or map saves from this envelope. Existing map and sheet API flows
 * remain authoritative for saved state.
 */
export interface MapActionEventBase<
  Kind extends MapActionEventKind = MapActionEventKind,
  Payload extends MapActionEventPayload = MapActionEventPayloadByKind[Kind],
> {
  schemaVersion: typeof MAP_ACTION_EVENT_SCHEMA_VERSION
  /** Unique transient event id used by clients to suppress duplicate replays. */
  id: string
  kind: Kind
  /** Map placement id for the token that initiated the visual action. */
  actorPlacementId: string
  /** Originating browser client id used for local echo suppression. */
  sourceClientId: string
  /** Sender wall-clock timestamp in epoch milliseconds. */
  createdAt: number
  payload: Payload
}

export type MapActionEventEnvelope = {
  [Kind in MapActionEventKind]: MapActionEventBase<Kind, MapActionEventPayloadByKind[Kind]>
}[MapActionEventKind]

export interface MapActionRealtimeEvent extends RealtimeEvent<MapActionEventEnvelope> {
  type: typeof MAP_ACTION_REALTIME_EVENT_TYPE
}

export interface MapActionEventPublishRequest {
  slug: string
  event: MapActionEventEnvelope
  /** Selected player profile id used by player requests for token-control checks. */
  profileId?: string | null
}

const mapActionEventKindSet: ReadonlySet<string> = new Set(MAP_ACTION_EVENT_KINDS)
const feedbackPhases = new Set(['rolling', 'hit-roll', 'outcome', 'effectiveness', 'damage'])
const feedbackEffectivenessValues = new Set(['super-effective', 'resisted'])
const hitChanceToneValues = new Set(['low', 'medium', 'high'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0
const isOptionalNonEmptyString = (value: unknown): value is string | undefined =>
  value === undefined || isNonEmptyString(value)
const isNullableString = (value: unknown): value is string | null => value === null || isString(value)
const isOptionalNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || isNullableString(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNonNegativeNumber = (value: unknown): value is number => isFiniteNumber(value) && value >= 0
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const isNullableFiniteNumber = (value: unknown): value is number | null => value === null || isFiniteNumber(value)

export const isMapActionEventKind = (value: unknown): value is MapActionEventKind =>
  isString(value) && mapActionEventKindSet.has(value)

const isActionSplashPayload = (payload: unknown): payload is MapActionSplashPayload =>
  isRecord(payload)
  && isNonEmptyString(payload.actionName)
  && isOptionalNonEmptyString(payload.verb)

const isMoveAnimationEventEnvelope = (value: unknown): value is MoveAnimationEvent =>
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.kind)
  && isNonEmptyString(value.userId)
  && isNonEmptyString(value.moveName)
  && isNonNegativeNumber(value.createdAtMs)
  && isNonNegativeNumber(value.durationMs)
  && (value.startOffsetMs === undefined || isNonNegativeNumber(value.startOffsetMs))

const isMoveAnimationsPayload = (payload: unknown): payload is MapActionMoveAnimationsPayload =>
  isRecord(payload)
  && Array.isArray(payload.events)
  && payload.events.every(isMoveAnimationEventEnvelope)

const isFeedbackCondition = (value: unknown): value is MoveAutomationFeedbackState['conditions'][number] =>
  isRecord(value)
  && isNonEmptyString(value.condition)
  && isBoolean(value.applied)
  && (value.blockedBy === undefined || isString(value.blockedBy))

const isFeedbackPhase = (value: unknown): value is MoveAutomationFeedbackState['phase'] =>
  isString(value) && feedbackPhases.has(value)

const isFeedbackEffectiveness = (value: unknown): value is MoveAutomationFeedbackState['effectiveness'] =>
  value === null || (isString(value) && feedbackEffectivenessValues.has(value))

const isMoveAutomationFeedback = (value: unknown): value is MoveAutomationFeedbackState =>
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.userId)
  && isNonEmptyString(value.targetId)
  && isNonEmptyString(value.moveName)
  && isFeedbackPhase(value.phase)
  && isFiniteNumber(value.naturalRoll)
  && isFiniteNumber(value.modifiedRoll)
  && isNullableFiniteNumber(value.accuracyCheck)
  && isFiniteNumber(value.userAccuracy)
  && isFiniteNumber(value.targetEvasion)
  && isString(value.targetEvasionLabel)
  && isBoolean(value.hit)
  && isBoolean(value.crit)
  && isFeedbackEffectiveness(value.effectiveness)
  && isBoolean(value.damageResolved)
  && isFiniteNumber(value.damageLoss)
  && Array.isArray(value.conditions)
  && value.conditions.every(isFeedbackCondition)

const isMoveFeedbackPayload = (payload: unknown): payload is MapActionMoveFeedbackPayload =>
  isRecord(payload) && isMoveAutomationFeedback(payload.feedback)

const isPokeballFeedbackPayload = (payload: unknown): payload is MapActionPokeballFeedbackPayload =>
  isRecord(payload) && isMoveAutomationFeedback(payload.feedback)

const isBreakdownLine = (value: unknown): value is PokeballCaptureAttemptResult['breakdown']['captureRateLines'][number] =>
  isRecord(value)
  && isString(value.label)
  && isFiniteNumber(value.value)
  && (value.detail === undefined || isString(value.detail))

const isHitChance = (value: unknown): value is PokeballCaptureAttemptResult['breakdown']['hitChance'] =>
  isRecord(value)
  && isNonEmptyString(value.targetId)
  && isFiniteNumber(value.percent)
  && isString(value.label)
  && isString(value.tone)
  && hitChanceToneValues.has(value.tone)
  && isString(value.title)

const isPokeballCaptureBreakdown = (value: unknown): value is PokeballCaptureAttemptResult['breakdown'] =>
  isRecord(value)
  && isFiniteNumber(value.captureRate)
  && Array.isArray(value.captureRateLines)
  && value.captureRateLines.every(isBreakdownLine)
  && isFiniteNumber(value.rollModifier)
  && Array.isArray(value.rollModifierLines)
  && value.rollModifierLines.every(isBreakdownLine)
  && isHitChance(value.hitChance)
  && isFiniteNumber(value.captureChance)
  && isString(value.captureChanceLabel)
  && isFiniteNumber(value.naturalTwentyCaptureChance)
  && isString(value.naturalTwentyCaptureChanceLabel)
  && isFiniteNumber(value.combinedChance)
  && isString(value.combinedChanceLabel)
  && isBoolean(value.capturable)
  && isNullableString(value.uncatchableReason)
  && isStringArray(value.notes)

const isPokeballCaptureAttemptResult = (value: unknown): value is PokeballCaptureAttemptResult =>
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.trainerId)
  && isString(value.trainerName)
  && isNonEmptyString(value.targetId)
  && isString(value.targetName)
  && isString(value.targetSpecies)
  && isNullableString(value.targetSpriteUrl)
  && isNonEmptyString(value.pokeballName)
  && isBoolean(value.success)
  && isBoolean(value.hit)
  && isNonNegativeNumber(value.shakeCount)
  && isFiniteNumber(value.accuracyRoll)
  && isFiniteNumber(value.modifiedAccuracyRoll)
  && isNullableFiniteNumber(value.accuracyCheck)
  && isFiniteNumber(value.userAccuracy)
  && isFiniteNumber(value.targetEvasion)
  && isString(value.targetEvasionLabel)
  && isNullableFiniteNumber(value.captureRoll)
  && isNullableFiniteNumber(value.adjustedCaptureRoll)
  && isFiniteNumber(value.captureRate)
  && isFiniteNumber(value.naturalTwentyCaptureBonus)
  && isBoolean(value.naturalCaptureSuccess)
  && isNullableString(value.failureReason)
  && isPokeballCaptureBreakdown(value.breakdown)

const isPokeballResultPayload = (payload: unknown): payload is MapActionPokeballResultPayload => {
  if (!isRecord(payload)) return false
  if (!('result' in payload)) return false
  if (!(payload.result === null || isPokeballCaptureAttemptResult(payload.result))) return false
  if (!isOptionalNullableString(payload.error)) return false
  return payload.result !== null || isNonEmptyString(payload.error)
}

export function isMapActionEventPayloadEnvelope<Kind extends MapActionEventKind>(
  kind: Kind,
  payload: unknown,
): payload is MapActionEventPayloadByKind[Kind]
export function isMapActionEventPayloadEnvelope(
  kind: MapActionEventKind,
  payload: unknown,
): payload is MapActionEventPayload {
  switch (kind) {
    case 'action-splash':
      return isActionSplashPayload(payload)
    case 'move-animations':
      return isMoveAnimationsPayload(payload)
    case 'move-feedback':
      return isMoveFeedbackPayload(payload)
    case 'pokeball-feedback':
      return isPokeballFeedbackPayload(payload)
    case 'pokeball-result':
      return isPokeballResultPayload(payload)
    default:
      return false
  }
}

export const isMapActionEventEnvelope = (value: unknown): value is MapActionEventEnvelope => {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== MAP_ACTION_EVENT_SCHEMA_VERSION) return false
  if (!isNonEmptyString(value.id)) return false
  if (!isMapActionEventKind(value.kind)) return false
  if (!isNonEmptyString(value.actorPlacementId)) return false
  if (!isNonEmptyString(value.sourceClientId)) return false
  if (!isNonNegativeNumber(value.createdAt)) return false
  return isMapActionEventPayloadEnvelope(value.kind, value.payload)
}
