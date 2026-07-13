import {
  isLivePlayBaseRevision,
  isLivePlayMapSlug,
  isLivePlayOpId,
} from '../livePlayCommands'
import {
  parseLivePlayMoveSheetChangeRefs,
  parseLivePlayMoveStatePatchChanges,
  type LivePlayMoveSheetChangeRef,
  type LivePlayMoveStatePatchChanges,
  type LivePlayMoveStatePatchPayloadValidationIssue,
} from '../livePlayMoveState'
import { isSlug } from '../paths'
import { nextRevision } from '../sessionRevisions'
import type { SheetKind } from '~/types/map'

/**
 * A GM correction command carries durable identities only. The accepted move's
 * private compensation record remains the sole source of inverse mechanics.
 */
export const MOVE_CORRECTION_COMMAND_SCHEMA_VERSION = 1 as const
export const GM_MOVE_CORRECTION_COMMAND_TYPE = 'gm-move-correction' as const
export const MOVE_CORRECTION_PATCH_SCHEMA_VERSION = 1 as const

export const MOVE_CORRECTION_LIMITS = Object.freeze({
  operationCount: 256,
  identifierChars: 200,
})

export interface GmMoveCorrectionPayload {
  readonly originOperationId: string
  readonly operationIds: readonly string[]
}

export interface GmMoveCorrectionCommand {
  readonly schemaVersion: typeof MOVE_CORRECTION_COMMAND_SCHEMA_VERSION
  readonly opId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly type: typeof GM_MOVE_CORRECTION_COMMAND_TYPE
  readonly payload: GmMoveCorrectionPayload
}

export const MOVE_CORRECTION_COMMAND_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'unknown-field',
  'forbidden-field',
  'invalid-schema-version',
  'invalid-op-id',
  'invalid-map-slug',
  'invalid-base-revision',
  'unsupported-command-type',
  'invalid-identifier',
  'invalid-operation-list',
  'duplicate-operation',
  'limit-exceeded',
] as const

export type MoveCorrectionCommandValidationCode =
  (typeof MOVE_CORRECTION_COMMAND_VALIDATION_CODES)[number]

export interface MoveCorrectionCommandValidationIssue {
  readonly path: string
  readonly code: MoveCorrectionCommandValidationCode
  readonly message: string
}

export type MoveCorrectionCommandValidationResult =
  | {
      readonly valid: true
      readonly command: GmMoveCorrectionCommand
      readonly issues: readonly []
    }
  | {
      readonly valid: false
      readonly issues: readonly MoveCorrectionCommandValidationIssue[]
    }

export class MoveCorrectionCommandValidationError extends Error {
  readonly issues: readonly MoveCorrectionCommandValidationIssue[]

  constructor(issues: readonly MoveCorrectionCommandValidationIssue[]) {
    super(`Invalid GM move correction command: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`)
    this.name = 'MoveCorrectionCommandValidationError'
    this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
  }
}

export interface LivePlayMoveCorrectionMapResourceChange {
  readonly kind: 'map'
  readonly mapSlug: string
  readonly expectedRevision: number
  readonly revision: number
}

export interface LivePlayMoveCorrectionSheetResourceChange {
  readonly kind: 'sheet'
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly expectedRevision: number
  readonly revision: number
}

export type LivePlayMoveCorrectionResourceChange =
  | LivePlayMoveCorrectionMapResourceChange
  | LivePlayMoveCorrectionSheetResourceChange

/** Public, mechanics-free audit projection carried by the accepted patch. */
export interface LivePlayMoveCorrectionPatchPayload {
  readonly schemaVersion: typeof MOVE_CORRECTION_PATCH_SCHEMA_VERSION
  readonly command: typeof GM_MOVE_CORRECTION_COMMAND_TYPE
  readonly originOperationId: string
  readonly correctionOperationId: string
  readonly operationIds: readonly string[]
  readonly updatedAt: number
  readonly resources: readonly LivePlayMoveCorrectionResourceChange[]
  readonly sheets: readonly LivePlayMoveSheetChangeRef[]
  readonly changes: LivePlayMoveStatePatchChanges
}

export type MoveCorrectionPatchValidationResult =
  | {
      readonly valid: true
      readonly payload: LivePlayMoveCorrectionPatchPayload
      readonly issues: readonly []
    }
  | {
      readonly valid: false
      readonly issues: readonly LivePlayMoveStatePatchPayloadValidationIssue[]
    }

type UnknownRecord = Record<string, unknown>
type MutableCommandIssues = MoveCorrectionCommandValidationIssue[]
type MutablePatchIssues = LivePlayMoveStatePatchPayloadValidationIssue[]

const ROOT_FIELDS = [
  'schemaVersion',
  'opId',
  'mapSlug',
  'baseRevision',
  'type',
  'payload',
] as const
const PAYLOAD_FIELDS = ['originOperationId', 'operationIds'] as const
const PATCH_FIELDS = [
  'schemaVersion',
  'command',
  'originOperationId',
  'correctionOperationId',
  'operationIds',
  'updatedAt',
  'resources',
  'sheets',
  'changes',
] as const
const RESOURCE_COMMON_FIELDS = ['kind', 'expectedRevision', 'revision'] as const

const FORBIDDEN_MECHANICS_FIELDS = new Set([
  'after',
  'before',
  'changes',
  'current',
  'damage',
  'effectOperations',
  'expectedCurrent',
  'finalState',
  'inverse',
  'mapPatch',
  'mechanics',
  'patch',
  'patches',
  'recipients',
  'resource',
  'resourcePatch',
  'resourcePatches',
  'resources',
  'restore',
  'rng',
  'roll',
  'rollLedger',
  'scopes',
  'sheetPatch',
  'sheetPatches',
  'sheetUpdates',
  'trace',
])
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/

const hasOwn = (value: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
)

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const cloneJson = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const addCommandIssue = (
  issues: MutableCommandIssues,
  path: string,
  code: MoveCorrectionCommandValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const collectExactCommandFields = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
  issues: MutableCommandIssues,
): void => {
  const allowed = new Set(fields)
  for (const field of fields) {
    if (!hasOwn(value, field)) addCommandIssue(issues, `${path}.${field}`, 'missing-field', `${path}.${field} is required.`)
  }
  for (const field of Object.keys(value)) {
    if (allowed.has(field)) continue
    const fieldPath = `${path}.${field}`
    const forbidden = FORBIDDEN_MECHANICS_FIELDS.has(field)
    addCommandIssue(
      issues,
      fieldPath,
      forbidden ? 'forbidden-field' : 'unknown-field',
      forbidden
        ? `${fieldPath} is server-owned mechanics data and must not be submitted.`
        : `${fieldPath} is not supported.`,
    )
  }
}

const parseOperationIdentifier = (
  value: unknown,
  path: string,
  issues: MutableCommandIssues,
): string | null => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_CORRECTION_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !OPERATION_ID_PATTERN.test(value)
  ) {
    addCommandIssue(
      issues,
      path,
      'invalid-identifier',
      `${path} must be a bounded stable operation identifier.`,
    )
    return null
  }
  return value
}

const parseOperationIds = (
  value: unknown,
  path: string,
  issues: MutableCommandIssues,
): readonly string[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    addCommandIssue(issues, path, 'invalid-operation-list', `${path} must be a non-empty array.`)
    return null
  }
  if (value.length > MOVE_CORRECTION_LIMITS.operationCount) {
    addCommandIssue(
      issues,
      path,
      'limit-exceeded',
      `${path} must contain at most ${MOVE_CORRECTION_LIMITS.operationCount} operation IDs.`,
    )
    return null
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const operationId = parseOperationIdentifier(item, `${path}[${index}]`, issues)
    if (operationId === null) continue
    if (seen.has(operationId)) {
      addCommandIssue(
        issues,
        `${path}[${index}]`,
        'duplicate-operation',
        `${path} must not contain duplicate operation ID ${operationId}.`,
      )
      continue
    }
    seen.add(operationId)
    result.push(operationId)
  }
  return result
}

export const validateGmMoveCorrectionCommand = (
  value: unknown,
): MoveCorrectionCommandValidationResult => {
  const issues: MutableCommandIssues = []
  if (!isPlainRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '$', code: 'not-object', message: 'GM move correction command must be a plain object.' }],
    }
  }
  collectExactCommandFields(value, ROOT_FIELDS, '$', issues)
  if (value.schemaVersion !== MOVE_CORRECTION_COMMAND_SCHEMA_VERSION) {
    addCommandIssue(issues, '$.schemaVersion', 'invalid-schema-version', `$.schemaVersion must be ${MOVE_CORRECTION_COMMAND_SCHEMA_VERSION}.`)
  }
  if (!isLivePlayOpId(value.opId)) {
    addCommandIssue(issues, '$.opId', 'invalid-op-id', '$.opId must be a valid live-play operation ID.')
  }
  if (!isLivePlayMapSlug(value.mapSlug)) {
    addCommandIssue(issues, '$.mapSlug', 'invalid-map-slug', '$.mapSlug must be a valid live-play map slug.')
  }
  if (!isLivePlayBaseRevision(value.baseRevision)) {
    addCommandIssue(issues, '$.baseRevision', 'invalid-base-revision', '$.baseRevision must be a safe non-negative revision.')
  }
  if (value.type !== GM_MOVE_CORRECTION_COMMAND_TYPE) {
    addCommandIssue(issues, '$.type', 'unsupported-command-type', `$.type must be ${GM_MOVE_CORRECTION_COMMAND_TYPE}.`)
  }

  let originOperationId: string | null = null
  let operationIds: readonly string[] | null = null
  if (!isPlainRecord(value.payload)) {
    addCommandIssue(issues, '$.payload', 'not-object', '$.payload must be a plain object.')
  }
  else {
    collectExactCommandFields(value.payload, PAYLOAD_FIELDS, '$.payload', issues)
    if (!isLivePlayOpId(value.payload.originOperationId)) {
      addCommandIssue(
        issues,
        '$.payload.originOperationId',
        'invalid-op-id',
        '$.payload.originOperationId must be a valid accepted live-play operation ID.',
      )
    }
    else {
      originOperationId = value.payload.originOperationId
    }
    operationIds = parseOperationIds(value.payload.operationIds, '$.payload.operationIds', issues)
  }

  if (isLivePlayOpId(value.opId) && originOperationId === value.opId) {
    addCommandIssue(
      issues,
      '$.payload.originOperationId',
      'invalid-op-id',
      'A correction operation cannot reference itself as its origin.',
    )
  }

  if (
    issues.length > 0
    || !isLivePlayOpId(value.opId)
    || !isLivePlayMapSlug(value.mapSlug)
    || !isLivePlayBaseRevision(value.baseRevision)
    || originOperationId === null
    || operationIds === null
  ) return { valid: false, issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))) }

  return {
    valid: true,
    command: deepFreeze({
      schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
      opId: value.opId,
      mapSlug: value.mapSlug,
      baseRevision: value.baseRevision,
      type: GM_MOVE_CORRECTION_COMMAND_TYPE,
      payload: { originOperationId, operationIds: [...operationIds] },
    }),
    issues: [],
  }
}

export const parseGmMoveCorrectionCommand = (
  value: unknown,
): GmMoveCorrectionCommand => {
  const result = validateGmMoveCorrectionCommand(value)
  if (result.valid) return result.command
  throw new MoveCorrectionCommandValidationError(result.issues)
}

const addPatchIssue = (
  issues: MutablePatchIssues,
  path: string,
  message: string,
): void => {
  issues.push({ path, code: 'invalid-field', message })
}

const exactPatchFields = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
  issues: MutablePatchIssues,
): void => {
  const allowed = new Set(fields)
  for (const field of fields) {
    const fieldPath = path ? `${path}.${field}` : field
    if (!hasOwn(value, field)) issues.push({ path: fieldPath, code: 'missing-field', message: `${fieldPath} is required.` })
  }
  for (const field of Object.keys(value)) {
    const fieldPath = path ? `${path}.${field}` : field
    if (!allowed.has(field)) addPatchIssue(issues, fieldPath, `${fieldPath} is not supported.`)
  }
}

const parsePatchOperationIds = (
  value: unknown,
  path: string,
  issues: MutablePatchIssues,
): readonly string[] | null => {
  const commandIssues: MutableCommandIssues = []
  const parsed = parseOperationIds(value, path, commandIssues)
  for (const issue of commandIssues) addPatchIssue(issues, issue.path, issue.message)
  return parsed
}

const parseResourceChanges = (
  value: unknown,
  issues: MutablePatchIssues,
): readonly LivePlayMoveCorrectionResourceChange[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MOVE_CORRECTION_LIMITS.operationCount + 1) {
    addPatchIssue(issues, 'resources', 'resources must be a non-empty bounded array.')
    return null
  }
  const resources: LivePlayMoveCorrectionResourceChange[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const path = `resources[${index}]`
    if (!isPlainRecord(item)) {
      addPatchIssue(issues, path, `${path} must be an object.`)
      continue
    }
    const variantFields = item.kind === 'map'
      ? ['mapSlug']
      : item.kind === 'sheet'
        ? ['sheetKind', 'sheetSlug']
        : []
    exactPatchFields(item, [...RESOURCE_COMMON_FIELDS, ...variantFields], path, issues)
    if (!isLivePlayBaseRevision(item.expectedRevision) || item.revision !== nextRevision(item.expectedRevision)) {
      addPatchIssue(issues, `${path}.revision`, `${path} must advance exactly one safe revision.`)
      continue
    }
    if (item.kind === 'map') {
      if (!isLivePlayMapSlug(item.mapSlug)) {
        addPatchIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must be a valid map slug.`)
        continue
      }
      const key = `map:${item.mapSlug}`
      if (seen.has(key)) {
        addPatchIssue(issues, path, `${path} duplicates resource ${key}.`)
        continue
      }
      seen.add(key)
      resources.push({
        kind: 'map',
        mapSlug: item.mapSlug,
        expectedRevision: item.expectedRevision,
        revision: item.revision as number,
      })
      continue
    }
    if (item.kind !== 'sheet' || (item.sheetKind !== 'pokemon' && item.sheetKind !== 'trainer')) {
      addPatchIssue(issues, `${path}.kind`, `${path} must identify a map or sheet resource.`)
      continue
    }
    if (!isSlug(item.sheetSlug)) {
      addPatchIssue(issues, `${path}.sheetSlug`, `${path}.sheetSlug must be a valid sheet slug.`)
      continue
    }
    const key = `sheet:${item.sheetKind}:${item.sheetSlug}`
    if (seen.has(key)) {
      addPatchIssue(issues, path, `${path} duplicates resource ${key}.`)
      continue
    }
    seen.add(key)
    resources.push({
      kind: 'sheet',
      sheetKind: item.sheetKind,
      sheetSlug: item.sheetSlug,
      expectedRevision: item.expectedRevision,
      revision: item.revision as number,
    })
  }
  if (resources.filter(resource => resource.kind === 'map').length !== 1) {
    addPatchIssue(issues, 'resources', 'resources must include exactly one correction audit map revision.')
  }
  return resources
}

export const parseLivePlayMoveCorrectionPatchPayload = (
  value: unknown,
): MoveCorrectionPatchValidationResult => {
  const issues: MutablePatchIssues = []
  if (!isPlainRecord(value)) {
    return { valid: false, issues: [{ path: '', code: 'not-object', message: 'Move correction patch payload must be an object.' }] }
  }
  exactPatchFields(value, PATCH_FIELDS, '', issues)
  if (value.schemaVersion !== MOVE_CORRECTION_PATCH_SCHEMA_VERSION) {
    addPatchIssue(issues, 'schemaVersion', `schemaVersion must be ${MOVE_CORRECTION_PATCH_SCHEMA_VERSION}.`)
  }
  if (value.command !== GM_MOVE_CORRECTION_COMMAND_TYPE) {
    addPatchIssue(issues, 'command', `command must be ${GM_MOVE_CORRECTION_COMMAND_TYPE}.`)
  }
  if (!isLivePlayOpId(value.originOperationId)) {
    addPatchIssue(issues, 'originOperationId', 'originOperationId must be a valid live-play operation ID.')
  }
  if (!isLivePlayOpId(value.correctionOperationId)) {
    addPatchIssue(issues, 'correctionOperationId', 'correctionOperationId must be a valid live-play operation ID.')
  }
  if (value.originOperationId === value.correctionOperationId) {
    addPatchIssue(issues, 'correctionOperationId', 'Correction and origin operation IDs must be distinct.')
  }
  if (typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    addPatchIssue(issues, 'updatedAt', 'updatedAt must be a safe non-negative timestamp.')
  }
  const operationIds = parsePatchOperationIds(value.operationIds, 'operationIds', issues)
  const resources = parseResourceChanges(value.resources, issues)
  const sheetsResult = parseLivePlayMoveSheetChangeRefs(value.sheets)
  if (!sheetsResult.valid) issues.push(...sheetsResult.issues)
  const changesResult = parseLivePlayMoveStatePatchChanges(value.changes)
  if (!changesResult.valid) issues.push(...changesResult.issues)
  if (resources !== null && sheetsResult.valid) {
    const sheetResources = resources.filter(
      (resource): resource is LivePlayMoveCorrectionSheetResourceChange => resource.kind === 'sheet',
    )
    for (const sheet of sheetsResult.sheets) {
      const resource = sheetResources.find(candidate => (
        candidate.sheetKind === sheet.kind && candidate.sheetSlug === sheet.slug
      ))
      if (
        !resource
        || resource.expectedRevision !== sheet.expectedRevision
        || resource.revision !== sheet.revision
      ) {
        addPatchIssue(
          issues,
          'sheets',
          `Sheet ${sheet.kind}/${sheet.slug} must match one corrected resource revision.`,
        )
      }
    }
    for (const resource of sheetResources) {
      if (!sheetsResult.sheets.some(sheet => (
        sheet.kind === resource.sheetKind && sheet.slug === resource.sheetSlug
      ))) {
        addPatchIssue(
          issues,
          'resources',
          `Corrected sheet resource ${resource.sheetKind}/${resource.sheetSlug} requires a sheet reference.`,
        )
      }
    }
  }

  if (
    issues.length > 0
    || !isLivePlayOpId(value.originOperationId)
    || !isLivePlayOpId(value.correctionOperationId)
    || operationIds === null
    || resources === null
    || !sheetsResult.valid
    || !changesResult.valid
    || typeof value.updatedAt !== 'number'
  ) return { valid: false, issues }

  return {
    valid: true,
    payload: deepFreeze({
      schemaVersion: MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
      command: GM_MOVE_CORRECTION_COMMAND_TYPE,
      originOperationId: value.originOperationId,
      correctionOperationId: value.correctionOperationId,
      operationIds: [...operationIds],
      updatedAt: value.updatedAt,
      resources: cloneJson(resources),
      sheets: cloneJson(sheetsResult.sheets),
      changes: cloneJson(changesResult.changes),
    }),
    issues: [],
  }
}
