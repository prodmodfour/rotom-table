export const START_TURN_MODAL_METADATA_KEY = 'startTurnModal' as const
export const START_TURN_MODAL_STATE_SCHEMA_VERSION = 1 as const

export interface StartTurnModalTurnRef {
  readonly activeId: string
  readonly round: number
}

export interface StartTurnModalDismissal extends StartTurnModalTurnRef {
  readonly dismissedAt?: number
}

export interface StartTurnModalState {
  readonly schemaVersion: typeof START_TURN_MODAL_STATE_SCHEMA_VERSION
  readonly dismissedTurn: StartTurnModalDismissal | null
}

export type StartTurnModalStateUpdatePayload = {
  readonly action: 'dismiss'
  readonly activeId: string
  readonly round: number
}

export interface ApplyStartTurnModalStateUpdateOptions {
  readonly dismissedAt?: number
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const normalizeRound = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
)

const normalizeTimestamp = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
)

export const emptyStartTurnModalState = (): StartTurnModalState => ({
  schemaVersion: START_TURN_MODAL_STATE_SCHEMA_VERSION,
  dismissedTurn: null,
})

export const normalizeStartTurnModalDismissal = (
  value: unknown,
): StartTurnModalDismissal | null => {
  if (!isRecord(value)) return null
  if (!nonEmptyString(value.activeId)) return null
  const round = normalizeRound(value.round)
  if (round === null) return null
  return {
    activeId: value.activeId.trim(),
    round,
    ...(normalizeTimestamp(value.dismissedAt) === undefined ? {} : { dismissedAt: normalizeTimestamp(value.dismissedAt) }),
  }
}

export const normalizeStartTurnModalState = (value: unknown): StartTurnModalState => {
  if (!isRecord(value)) return emptyStartTurnModalState()
  return {
    schemaVersion: START_TURN_MODAL_STATE_SCHEMA_VERSION,
    dismissedTurn: normalizeStartTurnModalDismissal(value.dismissedTurn),
  }
}

export const readStartTurnModalState = (
  metadata: Record<string, unknown> | null | undefined,
): StartTurnModalState => normalizeStartTurnModalState(metadata?.[START_TURN_MODAL_METADATA_KEY])

const startTurnModalStateIsEmpty = (state: StartTurnModalState): boolean => (
  state.dismissedTurn === null
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
  if (payload.action !== 'dismiss') return null
  if (!nonEmptyString(payload.activeId)) return null
  const round = normalizeRound(payload.round)
  if (round === null) return null
  return {
    action: 'dismiss',
    activeId: payload.activeId.trim(),
    round,
  }
}

export const applyStartTurnModalStateUpdate = (
  state: StartTurnModalState,
  payload: StartTurnModalStateUpdatePayload,
  options: ApplyStartTurnModalStateUpdateOptions = {},
): StartTurnModalState => ({
  ...normalizeStartTurnModalState(state),
  dismissedTurn: {
    activeId: payload.activeId,
    round: payload.round,
    ...(options.dismissedAt === undefined ? {} : { dismissedAt: options.dismissedAt }),
  },
})

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
