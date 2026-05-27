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
  stale: 'Stale session map',
  conflict: 'Conflict',
}

const REASON_TITLES: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Action could not be sent safely',
  unauthorized: 'Action not allowed in this session',
  stale: 'Action needs the latest session map',
  conflict: 'Action could not apply',
}

const REASON_SUMMARIES: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'The server rejected the session command shape before changing the session map.',
  unauthorized: 'The server kept the session map unchanged because this session identity does not control that resource.',
  stale: 'The server kept the authoritative session map unchanged because the target changed after your last known revision.',
  conflict: 'The server kept the authoritative session map unchanged because the target is blocked, missing, already changed, or otherwise conflicts with the current session map.',
}

const NON_RETRYABLE_GUIDANCE: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Refresh the session map and try once more. If this repeats, ask the GM to reload the live session.',
  unauthorized: 'Ask the GM to assign the relevant sheet or token before trying again.',
  stale: 'Refresh the session map before trying again.',
  conflict: 'Review the current session map with the GM before trying again.',
}

const RETRYABLE_GUIDANCE: Readonly<Record<SessionCommandRejectionReason, string>> = {
  invalid: 'Refresh the session map and try once more. If this repeats, ask the GM to reload the live session.',
  unauthorized: 'Ask the GM to assign the relevant sheet or token before trying again.',
  stale: 'Refresh the session map, check the latest token or sheet state, then try the action again.',
  conflict: 'Refresh the session map, choose a valid target or value, then try the action again.',
}

export type SessionCommandRejectionNoticeKind =
  | 'invalid-command'
  | 'stale-session-map'
  | 'unauthorized-token'
  | 'unauthorized-resource'
  | 'missing-session-map'
  | 'session-map-unavailable'
  | 'missing-token'
  | 'conflict'

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
  readonly kind: SessionCommandRejectionNoticeKind
}

export interface SessionCommandRejectionRefreshActionCallbacks<TResult = unknown> {
  resetDismissal(): void
  refreshSessionSnapshot(): TResult
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

const safeInlineValue = (value: unknown): string | undefined => {
  const safe = sanitizeSessionCommandRejectionText(value)
  return safe.length > 0 ? safe : undefined
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

export const runSessionCommandRejectionRefreshAction = <TResult>(
  callbacks: SessionCommandRejectionRefreshActionCallbacks<TResult>,
): TResult => {
  callbacks.resetDismissal()
  return callbacks.refreshSessionSnapshot()
}

const baseRevisionFromResult = (result: SessionCommandRejectMessage['result']): Revision | undefined => {
  if (!isRecord(result)) return undefined
  return 'baseRevision' in result ? result.baseRevision as Revision : undefined
}

const resourceFromResult = (result: SessionCommandRejectMessage['result']): Record<string, unknown> | null => (
  isRecord(result) && isRecord(result.resource) ? result.resource : null
)

const permissionFromResult = (result: SessionCommandRejectMessage['result']): Record<string, unknown> | null => (
  isRecord(result) && isRecord(result.permission) ? result.permission : null
)

const currentStateFromResult = (result: SessionCommandRejectMessage['result']): Record<string, unknown> | null => (
  isRecord(result) && isRecord(result.currentState) ? result.currentState : null
)

const scopedMapSlugFromResult = (result: SessionCommandRejectMessage['result']): string | undefined => {
  const resource = resourceFromResult(result)
  const resourceMapSlug = safeInlineValue(resource?.mapSlug)
  if (resourceMapSlug !== undefined) return resourceMapSlug

  const currentState = currentStateFromResult(result)
  const stateMapSlug = safeInlineValue(currentState?.mapSlug)
  if (stateMapSlug !== undefined) return stateMapSlug

  const scope = result.scopes.find((candidate) => safeInlineValue(candidate.mapSlug) !== undefined)
  return safeInlineValue(scope?.mapSlug)
}

const extractMapSlugFromUnavailableDetail = (detail: string): string | undefined => {
  const match = detail.match(/^Map\s+(.+?)\s+is not available in the authoritative session state\.$/i)
  return safeInlineValue(match?.[1])
}

const extractMapSlugFromMissingTokenDetail = (detail: string): string | undefined => {
  const match = detail.match(/^Token\s+.+?\s+is not present on map\s+(.+?)\.$/i)
  return safeInlineValue(match?.[1])
}

const mapReference = (mapSlug: string | undefined): string => (
  mapSlug === undefined ? 'this map' : `map "${mapSlug}"`
)

const isGmActor = (result: SessionCommandRejectMessage['result']): boolean => result.actor.role === 'gm'

interface RejectionCopy {
  readonly kind: SessionCommandRejectionNoticeKind
  readonly reasonLabel: string
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly guidance: string
}

const isMissingSelectedMapDetail = (detail: string): boolean => (
  /must identify a map/i.test(detail) || /session must have a selected map/i.test(detail)
)

const isMissingTokenDetail = (detail: string): boolean => /^Token\s+.+?\s+is not present on map\s+.+?\.$/i.test(detail)

const buildUnavailableSessionMapCopy = (
  result: SessionCommandRejectMessage['result'],
  mapSlug: string | undefined,
): RejectionCopy => {
  const mapText = mapReference(mapSlug)
  const gm = isGmActor(result)
  return {
    kind: 'session-map-unavailable',
    reasonLabel: 'Map unavailable',
    title: gm
      ? 'Select an available session map before sending live session commands'
      : 'This session map is not available yet',
    summary: 'Session hosting kept the session map unchanged because the active live session does not have an available copy of this map.',
    detail: `This command targeted ${mapText}, but the active live session does not have that map available.`,
    guidance: gm
      ? 'Verify the map is available in the active live session, then refresh the session map before trying again.'
      : 'Ask the GM to verify this map is available in the live session, then use Refresh session map before trying again.',
  }
}

const buildMissingSessionMapCopy = (result: SessionCommandRejectMessage['result']): RejectionCopy => {
  const gm = isGmActor(result)
  return {
    kind: 'missing-session-map',
    reasonLabel: 'No session map',
    title: gm
      ? 'Select a session map before sending commands'
      : 'The live session needs an available map',
    summary: 'Session hosting kept the session map unchanged because no selected session map is available for this command.',
    detail: 'The command did not identify a session map, and the live session has no selected map yet.',
    guidance: gm
      ? 'Select an available session map, then refresh before trying again.'
      : 'Ask the GM to select an available session map, then use Refresh session map before trying again.',
  }
}

const buildMissingTokenCopy = (
  result: SessionCommandRejectMessage['result'],
  safeDetail: string,
): RejectionCopy => {
  const mapSlug = extractMapSlugFromMissingTokenDetail(safeDetail) ?? scopedMapSlugFromResult(result)
  return {
    kind: 'missing-token',
    reasonLabel: 'Token missing',
    title: 'Token is no longer on this session map',
    summary: 'Session hosting kept the session map unchanged because the command targeted a token that is not present on the current session map.',
    detail: safeDetail.length > 0
      ? safeDetail
      : `The selected token is not present on ${mapReference(mapSlug)}.`,
    guidance: 'Refresh the session map to see the current token list. If the token should be available, ask the GM to verify map state or update assignments.',
  }
}

const unauthorizedTokenLabel = (permissionReason: unknown): string => {
  if (permissionReason === 'resource-not-visible') return 'Token not visible'
  if (permissionReason === 'resource-not-controllable') return 'Token visible only'
  return 'Token not assigned'
}

const buildUnauthorizedTokenCopy = (
  result: SessionCommandRejectMessage['result'],
  commandLabel: string,
  safeDetail: string,
): RejectionCopy => {
  const permission = permissionFromResult(result)
  const gm = isGmActor(result)
  return {
    kind: 'unauthorized-token',
    reasonLabel: unauthorizedTokenLabel(permission?.reason),
    title: 'This token is not assigned for control',
    summary: 'Session hosting kept the session map unchanged because this session identity cannot control the targeted token.',
    detail: safeDetail.length > 0
      ? safeDetail
      : `${commandLabel} needs a token assignment before it can change the session map.`,
    guidance: gm
      ? 'Review player token assignments in the live session controls, then refresh the session map after making changes.'
      : 'Ask the GM to assign this token to you for control, then use Refresh session map before trying again.',
  }
}

const buildUnauthorizedResourceCopy = (
  result: SessionCommandRejectMessage['result'],
  commandLabel: string,
  safeDetail: string,
): RejectionCopy => {
  const gm = isGmActor(result)
  return {
    kind: 'unauthorized-resource',
    reasonLabel: REASON_LABELS.unauthorized,
    title: REASON_TITLES.unauthorized,
    summary: REASON_SUMMARIES.unauthorized,
    detail: safeDetail.length > 0
      ? safeDetail
      : `${commandLabel} needs an assignment before it can change the session map.`,
    guidance: gm
      ? 'Review live session assignments, then refresh the session map before trying again.'
      : NON_RETRYABLE_GUIDANCE.unauthorized,
  }
}

const buildStaleMapCopy = (
  commandLabel: string,
  safeDetail: string,
  retryable: boolean,
): RejectionCopy => ({
  kind: 'stale-session-map',
  reasonLabel: REASON_LABELS.stale,
  title: REASON_TITLES.stale,
  summary: REASON_SUMMARIES.stale,
  detail: safeDetail.length > 0
    ? safeDetail
    : `${commandLabel} used an older session map revision.`,
  guidance: retryable
    ? RETRYABLE_GUIDANCE.stale
    : NON_RETRYABLE_GUIDANCE.stale,
})

const buildDefaultCopy = (
  result: SessionCommandRejectMessage['result'],
  commandLabel: string,
  safeDetail: string,
): RejectionCopy => {
  const reason = result.reason
  const detail = reason === 'invalid'
    ? `${commandLabel} was rejected because the request was incomplete or malformed.`
    : safeDetail.length > 0
      ? safeDetail
      : `${commandLabel} was rejected by session hosting.`

  return {
    kind: reason === 'invalid' ? 'invalid-command' : 'conflict',
    reasonLabel: REASON_LABELS[reason],
    title: REASON_TITLES[reason],
    summary: REASON_SUMMARIES[reason],
    detail,
    guidance: result.retryable ? RETRYABLE_GUIDANCE[reason] : NON_RETRYABLE_GUIDANCE[reason],
  }
}

const buildRejectionCopy = (
  result: SessionCommandRejectMessage['result'],
  commandLabel: string,
  safeDetail: string,
): RejectionCopy => {
  if (result.reason === 'stale') return buildStaleMapCopy(commandLabel, safeDetail, result.retryable)

  if (result.reason === 'unauthorized') {
    const permission = permissionFromResult(result)
    const permissionResource = isRecord(permission?.resource) ? permission.resource : null
    const resource = resourceFromResult(result) ?? permissionResource
    return resource?.kind === 'token'
      ? buildUnauthorizedTokenCopy(result, commandLabel, safeDetail)
      : buildUnauthorizedResourceCopy(result, commandLabel, safeDetail)
  }

  if (result.reason === 'conflict') {
    const unavailableMapSlug = extractMapSlugFromUnavailableDetail(safeDetail)
    if (unavailableMapSlug !== undefined || /not available in the authoritative session state/i.test(safeDetail)) {
      return buildUnavailableSessionMapCopy(result, unavailableMapSlug ?? scopedMapSlugFromResult(result))
    }
    if (isMissingSelectedMapDetail(safeDetail)) return buildMissingSessionMapCopy(result)
    if (isMissingTokenDetail(safeDetail)) return buildMissingTokenCopy(result, safeDetail)
  }

  return buildDefaultCopy(result, commandLabel, safeDetail)
}

export const formatSessionCommandRejectionNotice = (
  message: SessionCommandRejectMessage | null | undefined,
): SessionCommandRejectionNotice | null => {
  if (message === null || message === undefined) return null

  const result = message.result
  const reason = result.reason
  const commandLabel = labelForSessionCommandType(result.commandType)
  const safeDetail = sanitizeSessionCommandRejectionText(result.message)
  const copy = buildRejectionCopy(result, commandLabel, safeDetail)
  const baseRevision = baseRevisionFromResult(result)

  return {
    opId: result.opId,
    commandType: result.commandType,
    commandLabel,
    reason,
    reasonLabel: copy.reasonLabel,
    title: copy.title,
    summary: copy.summary,
    detail: copy.detail,
    guidance: copy.guidance,
    retryable: result.retryable,
    currentRevision: result.currentRevision,
    ...(baseRevision === undefined ? {} : { baseRevision }),
    refreshLabel: 'Refresh session map',
    dismissLabel: 'Dismiss',
    kind: copy.kind,
  }
}
