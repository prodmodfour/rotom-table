import {
  isLivePlayMapSlug,
  isLivePlayOpId,
  type LivePlayCommandAccepted,
  type LivePlayCommandRejected,
} from './livePlayCommands'
import { validateTerminalLivePlayCommandResponse } from './livePlayCommandResults'

export const LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION = 1 as const

export interface LivePlayOperationAbandonedResponse {
  readonly schemaVersion: typeof LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION
  readonly disposition: 'abandoned'
  readonly mapSlug: string
  readonly opId: string
  readonly result: LivePlayCommandRejected & {
    readonly reason: 'abandoned'
  }
}

export interface LivePlayOperationAlreadyTerminalResponse {
  readonly schemaVersion: typeof LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION
  readonly disposition: 'already-terminal'
  readonly mapSlug: string
  readonly opId: string
  readonly result: LivePlayCommandAccepted | LivePlayCommandRejected
}

export type LivePlayOperationAbandonmentResponse =
  | LivePlayOperationAbandonedResponse
  | LivePlayOperationAlreadyTerminalResponse

export interface LivePlayOperationAbandonmentValidationIssue {
  readonly path: string
  readonly message: string
}

export interface LivePlayOperationAbandonmentValidationSuccess {
  readonly valid: true
  readonly response: LivePlayOperationAbandonmentResponse
  readonly issues: readonly []
}

export interface LivePlayOperationAbandonmentValidationFailure {
  readonly valid: false
  readonly issues: readonly LivePlayOperationAbandonmentValidationIssue[]
}

export type LivePlayOperationAbandonmentValidationResult =
  | LivePlayOperationAbandonmentValidationSuccess
  | LivePlayOperationAbandonmentValidationFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayOperationAbandonmentValidationIssue[]

const RESPONSE_KEYS = new Set(['schemaVersion', 'disposition', 'mapSlug', 'opId', 'result'])
const ACCEPTED_RESULT_KEYS = new Set(['ok', 'opId', 'mapSlug', 'previousRevision', 'revision', 'patches'])
const REJECTED_RESULT_KEYS = new Set(['ok', 'opId', 'mapSlug', 'reason', 'message', 'currentRevision', 'currentState'])

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const describeValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (issues: MutableIssueList, path: string, message: string): void => {
  issues.push({ path, message })
}

const validateAllowedKeys = (
  record: UnknownRecord,
  allowedKeys: ReadonlySet<string>,
  path: string,
  issues: MutableIssueList,
): void => {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      addIssue(issues, `${path}.${key}`, `${path}.${key} is not allowed on live-play operation-abandonment responses.`)
    }
  }
}

const validateCommonFields = (record: UnknownRecord, issues: MutableIssueList): void => {
  if (record.schemaVersion !== LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION) {
    addIssue(
      issues,
      '$.schemaVersion',
      `$.schemaVersion must be ${LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION}.`,
    )
  }

  if (!isLivePlayMapSlug(record.mapSlug)) {
    addIssue(issues, '$.mapSlug', '$.mapSlug must be a valid live-play map slug.')
  }

  if (!isLivePlayOpId(record.opId)) {
    addIssue(issues, '$.opId', '$.opId must be a valid live-play operation ID.')
  }
}

const validateResultIdentity = (
  result: LivePlayCommandAccepted | LivePlayCommandRejected,
  outer: UnknownRecord,
  issues: MutableIssueList,
): void => {
  if (typeof outer.opId === 'string' && result.opId !== outer.opId) {
    addIssue(issues, '$.result.opId', '$.result.opId must match the outer operation-abandonment opId.')
  }

  if (typeof outer.mapSlug === 'string' && result.mapSlug !== outer.mapSlug) {
    addIssue(issues, '$.result.mapSlug', '$.result.mapSlug must match the outer operation-abandonment mapSlug.')
  }
}

const validateTerminalResult = (
  result: unknown,
  outer: UnknownRecord,
  issues: MutableIssueList,
): LivePlayCommandAccepted | LivePlayCommandRejected | null => {
  if (!isRecord(result)) {
    addIssue(issues, '$.result', `$.result must be an object; received ${describeValue(result)}.`)
    return null
  }

  if (hasOwn(result, 'duplicate')) {
    addIssue(issues, '$.result.duplicate', '$.result must be the original accepted or rejected result, not a duplicate-result wrapper.')
  }

  if (result.ok === true) validateAllowedKeys(result, ACCEPTED_RESULT_KEYS, '$.result', issues)
  else if (result.ok === false) validateAllowedKeys(result, REJECTED_RESULT_KEYS, '$.result', issues)

  const validation = validateTerminalLivePlayCommandResponse(result)
  if (!validation.valid) {
    for (const issue of validation.issues) {
      addIssue(
        issues,
        `$.result${issue.path === '$' ? '' : issue.path.slice(1)}`,
        issue.message,
      )
    }
    return null
  }

  if (validation.response.ok === true && 'duplicate' in validation.response) {
    addIssue(issues, '$.result.duplicate', '$.result must not use the duplicate-result shape.')
    return null
  }

  const terminalResult = validation.response as LivePlayCommandAccepted | LivePlayCommandRejected
  validateResultIdentity(terminalResult, outer, issues)
  return terminalResult
}

const validateDisposition = (
  disposition: unknown,
  terminalResult: LivePlayCommandAccepted | LivePlayCommandRejected | null,
  issues: MutableIssueList,
): void => {
  if (disposition === 'abandoned') {
    if (!terminalResult || terminalResult.ok !== false || terminalResult.reason !== 'abandoned') {
      addIssue(
        issues,
        '$.result.reason',
        '$.result.reason must be abandoned when disposition is abandoned.',
      )
    }
    return
  }

  if (disposition === 'already-terminal') {
    if (!terminalResult) addIssue(issues, '$.result', '$.result must be an accepted or rejected terminal result.')
    return
  }

  addIssue(issues, '$.disposition', '$.disposition must be abandoned or already-terminal.')
}

const detachResponse = (
  value: LivePlayOperationAbandonmentResponse,
  issues: MutableIssueList,
): LivePlayOperationAbandonmentResponse | null => {
  try {
    return JSON.parse(JSON.stringify(value)) as LivePlayOperationAbandonmentResponse
  } catch (error) {
    addIssue(
      issues,
      '$',
      `Operation-abandonment response must be detachable JSON data: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

export const validateLivePlayOperationAbandonmentResponse = (
  value: unknown,
): LivePlayOperationAbandonmentValidationResult => {
  const issues: MutableIssueList = []

  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '$', message: `Response must be an object; received ${describeValue(value)}.` }],
    }
  }

  validateAllowedKeys(value, RESPONSE_KEYS, '$', issues)
  validateCommonFields(value, issues)
  const terminalResult = validateTerminalResult(value.result, value, issues)
  validateDisposition(value.disposition, terminalResult, issues)

  if (issues.length > 0) return { valid: false, issues }

  const detached = detachResponse(value as unknown as LivePlayOperationAbandonmentResponse, issues)
  if (!detached || issues.length > 0) return { valid: false, issues }

  return { valid: true, response: detached, issues: [] }
}

export const parseLivePlayOperationAbandonmentResponse = (
  value: unknown,
): LivePlayOperationAbandonmentResponse => {
  const validation = validateLivePlayOperationAbandonmentResponse(value)
  if (validation.valid) return validation.response

  const summary = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`Invalid live-play operation-abandonment response: ${summary}`)
}
