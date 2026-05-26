import type { SessionCommandRejectionReason } from '#shared/sessionCommandResults'
import type { SessionCommandType, OpId } from '#shared/sessionCommands'
import type { SessionCommandRejectMessage } from '#shared/sessionMessages'
import type { Revision } from '#shared/sessionRevisions'

const MAX_SAFE_MESSAGE_LENGTH = 220

const COMMAND_LABELS: Readonly<Record<string, string>> = {
  moveToken: 'Move token',
  turnToken: 'Turn token',
  spawnToken: 'Spawn token',
  deleteToken: 'Delete token',
  sendOutPokemon: 'Send out Pokémon',
  modifyHp: 'Modify HP',
  modifyCombatStages: 'Modify combat stages',
  modifyConditions: 'Modify conditions',
  useMove: 'Use move',
  useManeuver: 'Use maneuver',
  useAbility: 'Use ability',
  useOrder: 'Use order',
  setInitiative: 'Set initiative',
  nextInitiative: 'Advance initiative',
  previousInitiative: 'Rewind initiative',
  placeHazard: 'Place hazard',
  removeHazard: 'Remove hazard',
  setFieldEffect: 'Set field effect',
  removeFieldEffect: 'Remove field effect',
  tickFieldEffectDurations: 'Tick field effects',
  buildTerrainVoxel: 'Build terrain',
  removeTerrainVoxel: 'Remove terrain',
}

const REASON_LABELS: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Invalid command',
  unauthorized: 'Not allowed',
  stale: 'Stale table state',
  conflict: 'Conflict',
}

const REASON_TITLES: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Action could not be sent safely',
  unauthorized: 'Action not allowed in this session',
  stale: 'Action needs the latest table state',
  conflict: 'Action could not apply',
}

const REASON_SUMMARIES: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'The server rejected the command shape before changing the table.',
  unauthorized: 'The server kept the table unchanged because this session identity does not control that resource.',
  stale: 'The server kept the authoritative table unchanged because the target changed after your last known revision.',
  conflict: 'The server kept the authoritative table unchanged because the target is blocked, missing, already changed, or otherwise conflicts with the current table.',
}

const NON_RETRYABLE_GUIDANCE: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Refresh the session view and try once more. If this repeats, ask the GM to reload the table session.',
  unauthorized: 'Ask the GM to assign the relevant sheet or token before trying again.',
  stale: 'Refresh the session view before trying again.',
  conflict: 'Review the current table state with the GM before trying again.',
}

const RETRYABLE_GUIDANCE: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Refresh the session view and try once more. If this repeats, ask the GM to reload the table session.',
  unauthorized: 'Ask the GM to assign the relevant sheet or token before trying again.',
  stale: 'Refresh the session view, check the latest token or sheet state, then try the action again.',
  conflict: 'Refresh the session view, choose a valid target or value, then try the action again.',
}

export interface SessionCommandRejectionNotice {
  readonly opId: OpId
  readonly commandType: SessionCommandType
  readonly commandLabel: string
  readonly reason: SessionCommandRejectionReason
  readonly reasonLabel: string
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly guidance: string
  readonly retryable: boolean
  readonly currentRevision: Revision
  readonly baseRevision?: Revision
  readonly refreshLabel: string
  readonly dismissLabel: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const sanitizeSessionCommandRejectionText = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length <= MAX_SAFE_MESSAGE_LENGTH) return normalized
  return `${normalized.slice(0, MAX_SAFE_MESSAGE_LENGTH - 1).trimEnd()}…`
}

export const labelForSessionCommandType = (commandType: SessionCommandType): string => {
  const known = COMMAND_LABELS[commandType]
  if (known !== undefined) return known

  const humanized = commandType
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (humanized.length === 0) return 'Session action'
  return humanized.charAt(0).toUpperCase() + humanized.slice(1)
}

const baseRevisionFromResult = (result: SessionCommandRejectMessage['result']): Revision | undefined => {
  if (!isRecord(result)) return undefined
  return 'baseRevision' in result ? result.baseRevision as Revision : undefined
}

export const formatSessionCommandRejectionNotice = (
  message: SessionCommandRejectMessage | null | undefined,
): SessionCommandRejectionNotice | null => {
  if (message === null || message === undefined) return null

  const result = message.result
  const reason = result.reason
  const commandLabel = labelForSessionCommandType(result.commandType)
  const safeDetail = sanitizeSessionCommandRejectionText(result.message)
  const detail = reason === 'invalid'
    ? `${commandLabel} was rejected because the request was incomplete or malformed.`
    : safeDetail.length > 0
      ? safeDetail
      : `${commandLabel} was rejected by the session host.`

  return {
    opId: result.opId,
    commandType: result.commandType,
    commandLabel,
    reason,
    reasonLabel: REASON_LABELS[reason],
    title: REASON_TITLES[reason],
    summary: REASON_SUMMARIES[reason],
    detail,
    guidance: result.retryable ? RETRYABLE_GUIDANCE[reason] : NON_RETRYABLE_GUIDANCE[reason],
    retryable: result.retryable,
    currentRevision: result.currentRevision,
    ...(baseRevisionFromResult(result) === undefined ? {} : { baseRevision: baseRevisionFromResult(result) }),
    refreshLabel: 'Refresh session view',
    dismissLabel: 'Dismiss',
  }
}
