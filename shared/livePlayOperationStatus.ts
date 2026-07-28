import {
  isLivePlayMapSlug,
  isLivePlayOpId,
  type LivePlayCommandAccepted,
  type LivePlayCommandRejected,
} from './livePlayCommands'
import { validateTerminalLivePlayCommandResponse } from './livePlayCommandResults'

export const LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION = 1 as const

export interface LivePlayOperationUnknownStatus {
  readonly schemaVersion: typeof LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION
  readonly status: 'unknown'
  readonly mapSlug: string
  readonly opId: string
}

export interface LivePlayOperationTerminalStatus {
  readonly schemaVersion: typeof LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION
  readonly status: 'terminal'
  readonly mapSlug: string
  readonly opId: string
  readonly result: LivePlayCommandAccepted | LivePlayCommandRejected
}

export type LivePlayOperationStatusResponse =
  | LivePlayOperationUnknownStatus
  | LivePlayOperationTerminalStatus

export interface LivePlayOperationStatusValidationIssue {
  readonly path: string
  readonly message: string
}

export interface LivePlayOperationStatusValidationSuccess {
  readonly valid: true
  readonly response: LivePlayOperationStatusResponse
  readonly issues: readonly []
}

export interface LivePlayOperationStatusValidationFailure {
  readonly valid: false
  readonly issues: readonly LivePlayOperationStatusValidationIssue[]
}

export type LivePlayOperationStatusValidationResult =
  | LivePlayOperationStatusValidationSuccess
  | LivePlayOperationStatusValidationFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayOperationStatusValidationIssue[]

const UNKNOWN_RESPONSE_KEYS = new Set(['schemaVersion', 'status', 'mapSlug', 'opId'])
const TERMINAL_RESPONSE_KEYS = new Set([...UNKNOWN_RESPONSE_KEYS, 'result'])
const ACCEPTED_RESULT_KEYS = new Set(['ok', 'opId', 'mapSlug', 'previousRevision', 'revision', 'patches', 'presentation'])
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
      addIssue(issues, `${path}.${key}`, `${path}.${key} is not allowed on live-play operation-status responses.`)
    }
  }
}

const validateCommonFields = (record: UnknownRecord, issues: MutableIssueList): void => {
  if (record.schemaVersion !== LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION) {
    addIssue(
      issues,
      '$.schemaVersion',
      `$.schemaVersion must be ${LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION}.`,
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
    addIssue(issues, '$.result.opId', '$.result.opId must match the outer operation-status opId.')
  }

  if (typeof outer.mapSlug === 'string' && result.mapSlug !== outer.mapSlug) {
    addIssue(issues, '$.result.mapSlug', '$.result.mapSlug must match the outer operation-status mapSlug.')
  }
}

const validateTerminalResult = (
  result: unknown,
  outer: UnknownRecord,
  issues: MutableIssueList,
): void => {
  if (!isRecord(result)) {
    addIssue(issues, '$.result', `$.result must be an object; received ${describeValue(result)}.`)
    return
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
    return
  }

  if (validation.response.ok === true && 'duplicate' in validation.response) {
    addIssue(issues, '$.result.duplicate', '$.result must not use the duplicate-result shape.')
    return
  }

  validateResultIdentity(validation.response as LivePlayCommandAccepted | LivePlayCommandRejected, outer, issues)
}

const detachResponse = (
  value: LivePlayOperationStatusResponse,
  issues: MutableIssueList,
): LivePlayOperationStatusResponse | null => {
  try {
    return JSON.parse(JSON.stringify(value)) as LivePlayOperationStatusResponse
  } catch (error) {
    addIssue(
      issues,
      '$',
      `Operation-status response must be detachable JSON data: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

export const validateLivePlayOperationStatusResponse = (
  value: unknown,
): LivePlayOperationStatusValidationResult => {
  const issues: MutableIssueList = []

  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '$', message: `Response must be an object; received ${describeValue(value)}.` }],
    }
  }

  validateCommonFields(value, issues)

  if (value.status === 'unknown') {
    validateAllowedKeys(value, UNKNOWN_RESPONSE_KEYS, '$', issues)
  } else if (value.status === 'terminal') {
    validateAllowedKeys(value, TERMINAL_RESPONSE_KEYS, '$', issues)
    validateTerminalResult(value.result, value, issues)
  } else {
    addIssue(issues, '$.status', '$.status must be unknown or terminal.')
  }

  if (issues.length > 0) return { valid: false, issues }

  const detached = detachResponse(value as unknown as LivePlayOperationStatusResponse, issues)
  if (!detached || issues.length > 0) return { valid: false, issues }

  return { valid: true, response: detached, issues: [] }
}

export const parseLivePlayOperationStatusResponse = (
  value: unknown,
): LivePlayOperationStatusResponse => {
  const validation = validateLivePlayOperationStatusResponse(value)
  if (validation.valid) return validation.response

  const summary = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`Invalid live-play operation-status response: ${summary}`)
}
