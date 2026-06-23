import { conditionSaveDc } from './conditionAutomation'

export const START_TURN_MODAL_METADATA_KEY = 'startTurnModal' as const
export const START_TURN_MODAL_STATE_SCHEMA_VERSION = 2 as const

export interface StartTurnModalTurnRef {
  readonly activeId: string
  readonly round: number
}

export interface StartTurnModalDismissal extends StartTurnModalTurnRef {
  readonly dismissedAt?: number
}

export const START_TURN_MODAL_CONDITION_RESOLUTION_ACTIONS = ['roll', 'skip', 'remove'] as const
export type StartTurnModalConditionResolutionAction = (typeof START_TURN_MODAL_CONDITION_RESOLUTION_ACTIONS)[number]

export interface StartTurnModalConditionResolution extends StartTurnModalTurnRef {
  readonly condition: string
  readonly occurrence: number
  readonly resolution: StartTurnModalConditionResolutionAction
  readonly roll: number | null
  readonly dc: number | null
  readonly success: boolean | null
  readonly resolvedAt?: number
}

export interface StartTurnModalState {
  readonly schemaVersion: typeof START_TURN_MODAL_STATE_SCHEMA_VERSION
  readonly dismissedTurn: StartTurnModalDismissal | null
  readonly conditionResolutions: readonly StartTurnModalConditionResolution[]
}

export interface DismissStartTurnModalStateUpdatePayload extends StartTurnModalTurnRef {
  readonly action: 'dismiss'
}

export interface ResolveStartTurnConditionStateUpdatePayload extends StartTurnModalTurnRef {
  readonly action: 'resolveCondition'
  readonly condition: string
  readonly occurrence: number
  readonly resolution: StartTurnModalConditionResolutionAction
}

export type StartTurnModalStateUpdatePayload =
  | DismissStartTurnModalStateUpdatePayload
  | ResolveStartTurnConditionStateUpdatePayload

export interface ApplyStartTurnModalStateUpdateOptions {
  readonly dismissedAt?: number
  readonly resolvedAt?: number
  readonly conditionRoll?: number
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const normalizeTrimmedString = (value: unknown): string | null => (
  nonEmptyString(value) ? value.trim() : null
)

const normalizeRound = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
)

const normalizeOccurrence = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
)

const normalizePayloadOccurrence = (value: unknown): number | null => (
  value === undefined ? 0 : normalizeOccurrence(value)
)

const normalizeTimestamp = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
)

const normalizeD20Roll = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 20 ? value : null
)

const normalizePositiveInteger = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
)

const normalizeBooleanOrNull = (value: unknown): boolean | null => (
  typeof value === 'boolean' ? value : null
)

const isConditionResolutionAction = (value: unknown): value is StartTurnModalConditionResolutionAction => (
  START_TURN_MODAL_CONDITION_RESOLUTION_ACTIONS.includes(value as StartTurnModalConditionResolutionAction)
)

export const startTurnModalConditionSaveDc = conditionSaveDc

const randomD20 = (): number => Math.floor(Math.random() * 20) + 1

export const emptyStartTurnModalState = (): StartTurnModalState => ({
  schemaVersion: START_TURN_MODAL_STATE_SCHEMA_VERSION,
  dismissedTurn: null,
  conditionResolutions: [],
})

export const normalizeStartTurnModalDismissal = (
  value: unknown,
): StartTurnModalDismissal | null => {
  if (!isRecord(value)) return null
  const activeId = normalizeTrimmedString(value.activeId)
  if (!activeId) return null
  const round = normalizeRound(value.round)
  if (round === null) return null
  return {
    activeId,
    round,
    ...(normalizeTimestamp(value.dismissedAt) === undefined ? {} : { dismissedAt: normalizeTimestamp(value.dismissedAt) }),
  }
}

export const normalizeStartTurnModalConditionResolution = (
  value: unknown,
): StartTurnModalConditionResolution | null => {
  if (!isRecord(value)) return null
  const activeId = normalizeTrimmedString(value.activeId)
  if (!activeId) return null
  const round = normalizeRound(value.round)
  if (round === null) return null
  const condition = normalizeTrimmedString(value.condition)
  if (!condition) return null
  const occurrence = normalizePayloadOccurrence(value.occurrence)
  if (occurrence === null) return null
  if (!isConditionResolutionAction(value.resolution)) return null

  const roll = value.resolution === 'roll' ? normalizeD20Roll(value.roll) : null
  if (value.resolution === 'roll' && roll === null) return null
  const dc = value.resolution === 'roll'
    ? (value.dc === null || value.dc === undefined ? null : normalizePositiveInteger(value.dc))
    : null
  if (value.resolution === 'roll' && value.dc !== null && value.dc !== undefined && dc === null) return null
  const success = value.resolution === 'roll'
    ? (value.success === null || value.success === undefined
        ? (roll !== null && dc !== null ? roll >= dc : null)
        : normalizeBooleanOrNull(value.success))
    : null
  if (value.resolution === 'roll' && value.success !== null && value.success !== undefined && success === null) return null

  return {
    activeId,
    round,
    condition,
    occurrence,
    resolution: value.resolution,
    roll,
    dc,
    success,
    ...(normalizeTimestamp(value.resolvedAt) === undefined ? {} : { resolvedAt: normalizeTimestamp(value.resolvedAt) }),
  }
}

const normalizeStartTurnModalConditionResolutions = (
  value: unknown,
): StartTurnModalConditionResolution[] => {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeStartTurnModalConditionResolution)
    .filter((resolution): resolution is StartTurnModalConditionResolution => resolution !== null)
}

export const normalizeStartTurnModalState = (value: unknown): StartTurnModalState => {
  if (!isRecord(value)) return emptyStartTurnModalState()
  return {
    schemaVersion: START_TURN_MODAL_STATE_SCHEMA_VERSION,
    dismissedTurn: normalizeStartTurnModalDismissal(value.dismissedTurn),
    conditionResolutions: normalizeStartTurnModalConditionResolutions(value.conditionResolutions),
  }
}

export const readStartTurnModalState = (
  metadata: Record<string, unknown> | null | undefined,
): StartTurnModalState => normalizeStartTurnModalState(metadata?.[START_TURN_MODAL_METADATA_KEY])

const startTurnModalStateIsEmpty = (state: StartTurnModalState): boolean => (
  state.dismissedTurn === null && state.conditionResolutions.length === 0
)

export const writeStartTurnModalState = (
  metadata: Record<string, unknown> | null | undefined,
  state: StartTurnModalState,
): Record<string, unknown> => {
  const normalized = normalizeStartTurnModalState(state)
  const next = { ...(metadata ?? {}) }
  if (startTurnModalStateIsEmpty(normalized)) delete next[START_TURN_MODAL_METADATA_KEY]
  else next[START_TURN_MODAL_METADATA_KEY] = normalized
  return next
}

export const startTurnModalStatesEqual = (
  left: StartTurnModalState,
  right: StartTurnModalState,
): boolean => JSON.stringify(normalizeStartTurnModalState(left)) === JSON.stringify(normalizeStartTurnModalState(right))

export const normalizeStartTurnModalStateUpdatePayload = (
  payload: unknown,
): StartTurnModalStateUpdatePayload | null => {
  if (!isRecord(payload)) return null
  const activeId = normalizeTrimmedString(payload.activeId)
  if (!activeId) return null
  const round = normalizeRound(payload.round)
  if (round === null) return null

  if (payload.action === 'dismiss') {
    return {
      action: 'dismiss',
      activeId,
      round,
    }
  }

  if (payload.action !== 'resolveCondition') return null
  const condition = normalizeTrimmedString(payload.condition)
  if (!condition) return null
  const occurrence = normalizePayloadOccurrence(payload.occurrence)
  if (occurrence === null) return null
  if (!isConditionResolutionAction(payload.resolution)) return null
  return {
    action: 'resolveCondition',
    activeId,
    round,
    condition,
    occurrence,
    resolution: payload.resolution,
  }
}

const conditionResolutionMatches = (
  left: Pick<StartTurnModalConditionResolution, 'activeId' | 'round' | 'condition' | 'occurrence'>,
  right: Pick<StartTurnModalConditionResolution, 'activeId' | 'round' | 'condition' | 'occurrence'>,
): boolean => (
  left.activeId === right.activeId
  && left.round === right.round
  && left.condition === right.condition
  && left.occurrence === right.occurrence
)

const turnRefMatches = (
  left: Pick<StartTurnModalTurnRef, 'activeId' | 'round'>,
  right: Pick<StartTurnModalTurnRef, 'activeId' | 'round'>,
): boolean => left.activeId === right.activeId && left.round === right.round

const applyConditionResolutionUpdate = (
  state: StartTurnModalState,
  payload: ResolveStartTurnConditionStateUpdatePayload,
  options: ApplyStartTurnModalStateUpdateOptions,
): StartTurnModalState => {
  const roll = payload.resolution === 'roll'
    ? (normalizeD20Roll(options.conditionRoll) ?? randomD20())
    : null
  const dc = payload.resolution === 'roll' ? startTurnModalConditionSaveDc(payload.condition) : null
  const nextResolution: StartTurnModalConditionResolution = {
    activeId: payload.activeId,
    round: payload.round,
    condition: payload.condition,
    occurrence: payload.occurrence,
    resolution: payload.resolution,
    roll,
    dc,
    success: roll !== null && dc !== null ? roll >= dc : null,
    ...(options.resolvedAt === undefined ? {} : { resolvedAt: options.resolvedAt }),
  }

  return {
    ...state,
    conditionResolutions: [
      ...state.conditionResolutions.filter((resolution) => (
        turnRefMatches(resolution, payload)
        && !conditionResolutionMatches(resolution, nextResolution)
      )),
      nextResolution,
    ],
  }
}

export const applyStartTurnModalStateUpdate = (
  state: StartTurnModalState,
  payload: StartTurnModalStateUpdatePayload,
  options: ApplyStartTurnModalStateUpdateOptions = {},
): StartTurnModalState => {
  const normalizedState = normalizeStartTurnModalState(state)
  if (payload.action === 'resolveCondition') {
    return applyConditionResolutionUpdate(normalizedState, payload, options)
  }

  return {
    ...normalizedState,
    conditionResolutions: normalizedState.conditionResolutions.filter((resolution) => turnRefMatches(resolution, payload)),
    dismissedTurn: {
      activeId: payload.activeId,
      round: payload.round,
      ...(options.dismissedAt === undefined ? {} : { dismissedAt: options.dismissedAt }),
    },
  }
}

export const startTurnModalDismissalMatches = (
  dismissal: StartTurnModalDismissal | null | undefined,
  turn: StartTurnModalTurnRef,
): boolean => Boolean(
  dismissal
  && dismissal.activeId === turn.activeId
  && dismissal.round === turn.round,
)

export const startTurnModalIsDismissed = (
  metadata: Record<string, unknown> | null | undefined,
  turn: StartTurnModalTurnRef,
): boolean => startTurnModalDismissalMatches(readStartTurnModalState(metadata).dismissedTurn, turn)
