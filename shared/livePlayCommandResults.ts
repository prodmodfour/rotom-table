import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  LIVE_PLAY_PATCH_TYPE_VALUES,
  isLivePlayCommandRejectionReason,
  isLivePlayGroupInventoryScopeField,
  isLivePlayMapScopeLane,
  isLivePlayMapSlug,
  isLivePlayOpId,
  isLivePlayPatchType,
  isLivePlayTokenScopeField,
  validateLivePlayCommandEnvelope,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayCommandRejected,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayScope,
} from './livePlayCommands'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import { isSheetKind } from './sheets'

export interface LivePlayTerminalResponseValidationIssue {
  readonly path: string
  readonly message: string
}

export interface LivePlayTerminalResponseValidationSuccess {
  readonly valid: true
  readonly response: LivePlayCommandResult
  readonly issues: readonly []
}

export interface LivePlayTerminalResponseValidationFailure {
  readonly valid: false
  readonly issues: readonly LivePlayTerminalResponseValidationIssue[]
}

export type LivePlayTerminalResponseValidationResult =
  | LivePlayTerminalResponseValidationSuccess
  | LivePlayTerminalResponseValidationFailure

export interface LivePlayTerminalResponseForCommandValidationSuccess
  extends LivePlayTerminalResponseValidationSuccess {
  readonly command: LivePlayCommandEnvelope
}

export type LivePlayTerminalResponseForCommandValidationResult =
  | LivePlayTerminalResponseForCommandValidationSuccess
  | LivePlayTerminalResponseValidationFailure

interface ValidateTerminalResponseForCommandInput {
  readonly response: unknown
  readonly command: unknown
}

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayTerminalResponseValidationIssue[]

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const describeValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (issues: MutableIssueList, path: string, message: string): void => {
  issues.push({ path, message })
}

const validateRevision = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isSafeNonNegativeInteger(value)) {
    addIssue(issues, path, `${path} must be a safe non-negative integer revision.`)
  }
}

const validateMapScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isLivePlayMapScopeLane(scope.lane)) {
    addIssue(issues, `${path}.lane`, `${path}.lane must be a supported live-play map scope lane.`)
  }
}

const validateTokenScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isNonEmptyString(scope.placementId)) {
    addIssue(issues, `${path}.placementId`, `${path}.placementId must be a non-empty string.`)
  }
  if (!isLivePlayTokenScopeField(scope.field)) {
    addIssue(issues, `${path}.field`, `${path}.field must be a supported live-play token scope field.`)
  }
}

const validateSheetScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isSheetKind(scope.sheetKind)) {
    addIssue(issues, `${path}.sheetKind`, `${path}.sheetKind must be pokemon or trainer.`)
  }
  if (!isSlug(scope.sheetSlug)) {
    addIssue(
      issues,
      `${path}.sheetSlug`,
      `${path}.sheetSlug must match ${SLUG_PATTERN_DESCRIPTION}.`,
    )
  }
  if (!isNonEmptyString(scope.field)) {
    addIssue(issues, `${path}.field`, `${path}.field must be a non-empty string.`)
  }
}

const validateGroupInventoryScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isSlug(scope.slug)) {
    addIssue(
      issues,
      `${path}.slug`,
      `${path}.slug must match ${SLUG_PATTERN_DESCRIPTION}.`,
    )
  }
  if (!isLivePlayGroupInventoryScopeField(scope.field)) {
    addIssue(
      issues,
      `${path}.field`,
      `${path}.field must be a supported group inventory scope field.`,
    )
  }
}

const validateScope = (
  scope: unknown,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isRecord(scope)) {
    addIssue(issues, path, `${path} must be an object.`)
    return
  }

  if (scope.kind === 'map') {
    validateMapScope(scope, path, issues)
    return
  }

  if (scope.kind === 'token') {
    validateTokenScope(scope, path, issues)
    return
  }

  if (scope.kind === 'sheet') {
    validateSheetScope(scope, path, issues)
    return
  }

  if (scope.kind === 'groupInventory') {
    validateGroupInventoryScope(scope, path, issues)
    return
  }

  addIssue(
    issues,
    `${path}.kind`,
    `${path}.kind must be map, token, sheet, or groupInventory.`,
  )
}

const validatePatch = (
  patch: unknown,
  path: string,
  resultMapSlug: string,
  issues: MutableIssueList,
): void => {
  if (!isRecord(patch)) {
    addIssue(issues, path, `${path} must be an object.`)
    return
  }

  if (patch.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) {
    addIssue(
      issues,
      `${path}.schemaVersion`,
      `${path}.schemaVersion must be ${LIVE_PLAY_COMMAND_SCHEMA_VERSION}.`,
    )
  }

  if (!isLivePlayPatchType(patch.type)) {
    addIssue(
      issues,
      `${path}.type`,
      `${path}.type must be one of ${LIVE_PLAY_PATCH_TYPE_VALUES.join(', ')}.`,
    )
  }

  if (!isLivePlayMapSlug(patch.mapSlug)) {
    addIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must be a valid live-play map slug.`)
  } else if (patch.mapSlug !== resultMapSlug) {
    addIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must match the accepted result mapSlug.`)
  }

  validateRevision(patch.revision, `${path}.revision`, issues)

  if (!Array.isArray(patch.scopes)) {
    addIssue(issues, `${path}.scopes`, `${path}.scopes must be an array.`)
  } else {
    patch.scopes.forEach((scope, index) => validateScope(scope, `${path}.scopes[${index}]`, issues))
  }

  if (!hasOwn(patch, 'payload') || patch.payload === undefined) {
    addIssue(issues, `${path}.payload`, `${path}.payload must be present.`)
  }
}

const validateAcceptedResult = (
  record: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (record.ok !== true) {
    addIssue(issues, `${path}.ok`, `${path}.ok must be true for accepted live-play command results.`)
  }

  if (!isLivePlayOpId(record.opId)) {
    addIssue(issues, `${path}.opId`, `${path}.opId must be a valid live-play operation ID.`)
  }

  if (!isLivePlayMapSlug(record.mapSlug)) {
    addIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must be a valid live-play map slug.`)
  }

  validateRevision(record.previousRevision, `${path}.previousRevision`, issues)
  validateRevision(record.revision, `${path}.revision`, issues)

  if (!Array.isArray(record.patches)) {
    addIssue(issues, `${path}.patches`, `${path}.patches must be an array.`)
    return
  }

  const mapSlug = typeof record.mapSlug === 'string' ? record.mapSlug : ''
  record.patches.forEach((patch, index) => {
    validatePatch(patch, `${path}.patches[${index}]`, mapSlug, issues)
  })
}

const validateRejectedResult = (
  record: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (record.ok !== false) {
    addIssue(issues, `${path}.ok`, `${path}.ok must be false for rejected live-play command results.`)
  }

  if (!isLivePlayOpId(record.opId)) {
    addIssue(issues, `${path}.opId`, `${path}.opId must be a valid live-play operation ID.`)
  }

  if (!isLivePlayMapSlug(record.mapSlug)) {
    addIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must be a valid live-play map slug.`)
  }

  if (!isLivePlayCommandRejectionReason(record.reason)) {
    addIssue(issues, `${path}.reason`, `${path}.reason must be a supported live-play rejection reason.`)
  }

  if (typeof record.message !== 'string' || record.message.trim().length === 0) {
    addIssue(issues, `${path}.message`, `${path}.message must be a non-empty string.`)
  }

  if (hasOwn(record, 'currentRevision') && record.currentRevision !== undefined) {
    validateRevision(record.currentRevision, `${path}.currentRevision`, issues)
  }
}

const validateAcceptedOrRejectedResult = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isRecord(value)) {
    addIssue(issues, path, `${path} must be an object.`)
    return
  }

  if (value.ok === true) {
    if (hasOwn(value, 'duplicate')) {
      addIssue(issues, `${path}.duplicate`, `${path}.duplicate is not allowed on nested original results.`)
      return
    }
    validateAcceptedResult(value, path, issues)
    return
  }

  if (value.ok === false) {
    validateRejectedResult(value, path, issues)
    return
  }

  addIssue(issues, `${path}.ok`, `${path}.ok must be true or false.`)
}

const validateDuplicateResult = (
  record: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (record.ok !== true) {
    addIssue(issues, `${path}.ok`, `${path}.ok must be true for duplicate live-play command results.`)
  }

  if (record.duplicate !== true) {
    addIssue(issues, `${path}.duplicate`, `${path}.duplicate must be true for duplicate results.`)
  }

  if (!isLivePlayOpId(record.opId)) {
    addIssue(issues, `${path}.opId`, `${path}.opId must be a valid live-play operation ID.`)
  }

  validateAcceptedOrRejectedResult(record.original, `${path}.original`, issues)

  if (
    isRecord(record.original) &&
    isLivePlayOpId(record.opId) &&
    isLivePlayOpId(record.original.opId) &&
    record.original.opId !== record.opId
  ) {
    addIssue(
      issues,
      `${path}.original.opId`,
      `${path}.original.opId must match the duplicate result operation ID.`,
    )
  }
}

export const validateTerminalLivePlayCommandResponse = (
  response: unknown,
): LivePlayTerminalResponseValidationResult => {
  const issues: MutableIssueList = []

  if (!isRecord(response)) {
    return {
      valid: false,
      issues: [{ path: '$', message: `Response must be an object; received ${describeValue(response)}.` }],
    }
  }

  if (response.ok === true) {
    if (hasOwn(response, 'duplicate')) {
      if (response.duplicate === true) validateDuplicateResult(response, '$', issues)
      else addIssue(issues, '$.duplicate', '$.duplicate must be true when present.')
    } else {
      validateAcceptedResult(response, '$', issues)
    }
  } else if (response.ok === false) {
    validateRejectedResult(response, '$', issues)
  } else {
    addIssue(issues, '$.ok', '$.ok must be true or false.')
  }

  if (issues.length > 0) return { valid: false, issues }
  return { valid: true, response: response as unknown as LivePlayCommandResult, issues: [] }
}

const acceptedOrRejectedMapSlug = (
  response: LivePlayCommandAccepted | LivePlayCommandRejected,
): string => response.mapSlug

const acceptedResultExpectedPatchTypesForCommand = (
  command: LivePlayCommandEnvelope,
): readonly string[] => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS) return [LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS]
  if (command.type === LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS) return [LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS]
  if (command.type === LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS) return [LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS]
  if (command.type === LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS) return [LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN]
  return []
}

const scopeCell = (scope: UnknownRecord): UnknownRecord | null => {
  if (!hasOwn(scope, 'cell')) return null
  return isRecord(scope.cell) ? scope.cell : null
}

const scopeCellsEqual = (left: UnknownRecord, right: UnknownRecord): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const mapScopesCompatible = (
  commandScope: UnknownRecord,
  patchScope: UnknownRecord,
): boolean => {
  if (commandScope.lane !== patchScope.lane) return false

  const commandCell = scopeCell(commandScope)
  const patchCell = scopeCell(patchScope)
  if (!commandCell || !patchCell) return true
  return scopeCellsEqual(commandCell, patchCell)
}

const tokenScopesCompatible = (
  commandScope: UnknownRecord,
  patchScope: UnknownRecord,
): boolean => (
  commandScope.placementId === patchScope.placementId
  && commandScope.field === patchScope.field
)

const sheetScopesCompatible = (
  commandScope: UnknownRecord,
  patchScope: UnknownRecord,
): boolean => (
  commandScope.sheetKind === patchScope.sheetKind
  && commandScope.sheetSlug === patchScope.sheetSlug
  && commandScope.field === patchScope.field
)

const groupInventoryScopesCompatible = (
  commandScope: UnknownRecord,
  patchScope: UnknownRecord,
): boolean => (
  commandScope.slug === patchScope.slug
  && commandScope.field === patchScope.field
)

const scopesCompatible = (
  commandScope: LivePlayScope,
  patchScope: LivePlayScope,
): boolean => {
  const commandRecord = commandScope as unknown as UnknownRecord
  const patchRecord = patchScope as unknown as UnknownRecord
  if (commandRecord.kind !== patchRecord.kind) return false
  if (commandRecord.kind === 'map') return mapScopesCompatible(commandRecord, patchRecord)
  if (commandRecord.kind === 'token') return tokenScopesCompatible(commandRecord, patchRecord)
  if (commandRecord.kind === 'sheet') return sheetScopesCompatible(commandRecord, patchRecord)
  if (commandRecord.kind === 'groupInventory') {
    return groupInventoryScopesCompatible(commandRecord, patchRecord)
  }
  return false
}

const patchScopeMatchesCommand = (
  command: LivePlayCommandEnvelope,
  patchScope: LivePlayScope,
): boolean => command.scopes.some((commandScope) => scopesCompatible(commandScope, patchScope))

const patchPayloadCommand = (patch: LivePlayPatch): unknown => (
  isRecord(patch.payload) && hasOwn(patch.payload, 'command') ? patch.payload.command : undefined
)

const validatePatchPayloadCommandForCommand = (
  command: LivePlayCommandEnvelope,
  patch: LivePlayPatch,
  path: string,
  issues: MutableIssueList,
): void => {
  const payloadCommand = patchPayloadCommand(patch)
  if (payloadCommand === undefined) return
  if (payloadCommand === command.type) return

  addIssue(
    issues,
    `${path}.payload.command`,
    `${path}.payload.command must match the submitted command type ${command.type}.`,
  )
}

const validatePatchScopesForCommand = (
  command: LivePlayCommandEnvelope,
  patch: LivePlayPatch,
  path: string,
  issues: MutableIssueList,
): void => {
  if (patch.scopes.length === 0) {
    addIssue(issues, `${path}.scopes`, `${path}.scopes must include at least one command-compatible scope.`)
    return
  }

  patch.scopes.forEach((scope, index) => {
    if (patchScopeMatchesCommand(command, scope)) return
    addIssue(
      issues,
      `${path}.scopes[${index}]`,
      `${path}.scopes[${index}] must match or conservatively cover a submitted command scope.`,
    )
  })
}

const validateAcceptedResultForCommand = (
  command: LivePlayCommandEnvelope,
  result: LivePlayCommandAccepted,
  path: string,
  issues: MutableIssueList,
): void => {
  if (result.patches.length === 0) return

  const expectedPatchTypes = acceptedResultExpectedPatchTypesForCommand(command)
  let expectedPatchTypeFound = expectedPatchTypes.length === 0

  result.patches.forEach((patch, index) => {
    const patchPath = `${path}.patches[${index}]`
    validatePatchPayloadCommandForCommand(command, patch, patchPath, issues)

    const payloadCommand = patchPayloadCommand(patch)
    const patchMatchesExpectedType = expectedPatchTypes.includes(patch.type)
    if (expectedPatchTypes.length > 0) {
      if (patchMatchesExpectedType) expectedPatchTypeFound = true
      else {
        addIssue(
          issues,
          `${patchPath}.type`,
          `${patchPath}.type must be ${expectedPatchTypes.join(' or ')} for ${command.type} responses.`,
        )
      }
    }

    if (payloadCommand === command.type || patchMatchesExpectedType) {
      validatePatchScopesForCommand(command, patch, patchPath, issues)
    }
  })

  if (!expectedPatchTypeFound) {
    addIssue(
      issues,
      `${path}.patches`,
      `${path}.patches must include ${expectedPatchTypes.join(' or ')} for ${command.type} responses.`,
    )
  }
}

export const validateTerminalResponseForCommand = (
  input: ValidateTerminalResponseForCommandInput,
): LivePlayTerminalResponseForCommandValidationResult => {
  const issues: MutableIssueList = []
  const commandValidation = validateLivePlayCommandEnvelope(input.command)
  const responseValidation = validateTerminalLivePlayCommandResponse(input.response)

  if (!commandValidation.valid) {
    for (const issue of commandValidation.issues) {
      addIssue(issues, `command.${issue.path}`, issue.message)
    }
  }

  if (!responseValidation.valid) {
    for (const issue of responseValidation.issues) {
      addIssue(issues, `response${issue.path === '$' ? '' : issue.path.slice(1)}`, issue.message)
    }
  }

  if (!commandValidation.valid || !responseValidation.valid || issues.length > 0) {
    return { valid: false, issues }
  }

  const command = commandValidation.command
  const response = responseValidation.response

  if (response.opId !== command.opId) {
    addIssue(issues, 'response.opId', 'Response operation ID does not match the sent command operation ID.')
  }

  if (response.ok === true && 'duplicate' in response && response.duplicate === true) {
    if (response.original.opId !== command.opId) {
      addIssue(
        issues,
        'response.original.opId',
        'Duplicate original operation ID does not match the sent command operation ID.',
      )
    }
    if (acceptedOrRejectedMapSlug(response.original) !== command.mapSlug) {
      addIssue(
        issues,
        'response.original.mapSlug',
        'Duplicate original mapSlug does not match the sent command mapSlug.',
      )
    }
    if (response.original.ok) {
      validateAcceptedResultForCommand(command, response.original, 'response.original', issues)
    }
  } else {
    const terminalResponse = response as LivePlayCommandAccepted | LivePlayCommandRejected
    if (terminalResponse.mapSlug !== command.mapSlug) {
      addIssue(issues, 'response.mapSlug', 'Response mapSlug does not match the sent command mapSlug.')
    }
    if (terminalResponse.ok) {
      validateAcceptedResultForCommand(command, terminalResponse, 'response', issues)
    }
  }

  if (issues.length > 0) return { valid: false, issues }
  return { valid: true, response, command, issues: [] }
}
