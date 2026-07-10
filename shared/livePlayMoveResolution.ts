import {
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRollLedgerEntry,
} from './moveAutomation/random'
import {
  MoveResolutionTraceValidationError,
  parseMoveResolutionTraceSummary,
  type MoveResolutionTraceSummary,
} from './moveAutomation/trace'
import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
  type MoveAutomationAreaTemplate,
  type MoveAutomationFeedbackState,
  type MoveAutomationScript,
  type MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'

export const LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION = 1 as const
export const LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION = 1 as const

export const LIVE_PLAY_MOVE_RESOLUTION_MAX_TEXT_LENGTH = 120 as const
export const LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS = 32 as const

export interface ResolveSelfMoveSelection {
  readonly kind: 'self'
}

export interface ResolveSingleTargetMoveSelection {
  readonly kind: 'single-target'
  readonly targetPlacementId: string
}

export interface ResolveTargetCountMoveSelection {
  readonly kind: 'target-count'
  readonly targetPlacementIds: readonly string[]
}

export interface ResolveAreaMoveSelection {
  readonly kind: 'area'
  readonly areaTemplateId: string
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
  readonly excludedTargetPlacementIds?: readonly string[]
}

export type ResolveMoveSelection =
  | ResolveSelfMoveSelection
  | ResolveSingleTargetMoveSelection
  | ResolveTargetCountMoveSelection
  | ResolveAreaMoveSelection

export interface ResolveMoveIntent {
  readonly schemaVersion: typeof LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION
  readonly placementId: string
  readonly moveName: string
  readonly targetBranchId?: string
  readonly selection: ResolveMoveSelection
}

export interface LivePlayResolvedMoveArea {
  readonly areaTemplateId: string
  readonly template: MoveAutomationAreaTemplate
  readonly cells: readonly GridAnchor[]
  /** Predicate-eligible targets plus explicit Friendly exclusions; private rule exclusions are omitted. */
  readonly candidateTargetIds: readonly string[]
  readonly excludedTargetIds: readonly string[]
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
}

export interface LivePlayResolvedMovePassMovement {
  readonly kind: 'pass'
  readonly from: GridAnchor
  readonly destination: GridAnchor
  readonly direction: MoveAutomationAreaDirection
  readonly pathCells: readonly GridAnchor[]
}

export interface LivePlayResolvedMoveResult {
  readonly schemaVersion: typeof LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION
  readonly actorPlacementId: string
  readonly moveName: string
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly targetBranchId?: string
  readonly selectedTargetIds: readonly string[]
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  /** New accepted results always include this; historical stored results remain readable without it. */
  readonly trace?: MoveResolutionTraceSummary
  readonly script: MoveAutomationScript
  readonly transaction: MoveAutomationTransaction
  readonly feedback?: MoveAutomationFeedbackState
  readonly desiredFacing?: TokenFacingDirection
  readonly area?: LivePlayResolvedMoveArea
  readonly movement?: LivePlayResolvedMovePassMovement
}

export type LivePlayResolvedMoveResultValidationCode =
  | 'not-object'
  | 'invalid-schema-version'
  | 'missing-field'
  | 'invalid-field'

export interface LivePlayResolvedMoveResultValidationIssue {
  readonly path: string
  readonly code: LivePlayResolvedMoveResultValidationCode
  readonly message: string
}

export interface ParseLivePlayResolvedMoveResultSuccess {
  readonly valid: true
  readonly move: LivePlayResolvedMoveResult
  readonly issues: readonly []
}

export interface ParseLivePlayResolvedMoveResultFailure {
  readonly valid: false
  readonly issues: readonly LivePlayResolvedMoveResultValidationIssue[]
}

export type ParseLivePlayResolvedMoveResultResult =
  | ParseLivePlayResolvedMoveResultSuccess
  | ParseLivePlayResolvedMoveResultFailure

export type ResolveMoveIntentValidationCode =
  | 'not-object'
  | 'missing-field'
  | 'invalid-schema-version'
  | 'invalid-field'
  | 'duplicate-target'
  | 'too-many-targets'
  | 'unknown-field'
  | 'forbidden-field'

export interface ResolveMoveIntentValidationIssue {
  readonly path: string
  readonly code: ResolveMoveIntentValidationCode
  readonly message: string
}

export interface ParseResolveMoveIntentSuccess {
  readonly valid: true
  readonly intent: ResolveMoveIntent
  readonly issues: readonly []
}

export interface ParseResolveMoveIntentFailure {
  readonly valid: false
  readonly issues: readonly ResolveMoveIntentValidationIssue[]
}

export type ParseResolveMoveIntentResult = ParseResolveMoveIntentSuccess | ParseResolveMoveIntentFailure

type UnknownRecord = Record<string, unknown>

const TOP_LEVEL_FIELDS = new Set(['schemaVersion', 'placementId', 'moveName', 'targetBranchId', 'selection'])
const SELF_SELECTION_FIELDS = new Set(['kind'])
const SINGLE_TARGET_SELECTION_FIELDS = new Set(['kind', 'targetPlacementId'])
const TARGET_COUNT_SELECTION_FIELDS = new Set(['kind', 'targetPlacementIds'])
const AREA_SELECTION_FIELDS = new Set(['kind', 'areaTemplateId', 'direction', 'aimCell', 'excludedTargetPlacementIds'])

const FORBIDDEN_CLIENT_AUTHORITY_FIELDS = new Set([
  'roll',
  'rolls',
  'rollLedger',
  'trace',
  'auditTrace',
  'resolutionTrace',
  'accuracyRoll',
  'accuracyRolls',
  'damage',
  'damageFormula',
  'damageRoll',
  'damageRolls',
  'criticalRoll',
  'critRoll',
  'success',
  'failure',
  'hit',
  'miss',
  'script',
  'automationScript',
  'runtime',
  'runtimeKind',
  'runtimeVersion',
  'spec',
  'specHash',
  'transaction',
  'resolvedTransaction',
  'hpUpdates',
  'conditionUpdates',
  'combatStageUpdates',
  'cells',
  'areaCells',
  'pathCells',
  'movement',
  'movementDistance',
  'moveDistance',
  'from',
  'to',
  'targetIds',
  'targetPlacementIds',
  'candidateIds',
  'candidateTargetIds',
  'selectedTargetIds',
  'excludedTargetIds',
  'affectedIds',
  'destination',
  'passDestination',
  'sheetRevisions',
  'sheetRevision',
  'mapEffects',
  'fieldEffects',
  'facing',
  'desiredFacing',
  'logs',
  'logLines',
  'targetCount',
  'range',
  'distance',
  'hitChance',
])

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const MOVE_AUTOMATION_AREA_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)

const isMoveAutomationAreaDirection = (value: unknown): value is MoveAutomationAreaDirection =>
  typeof value === 'string' && MOVE_AUTOMATION_AREA_DIRECTION_SET.has(value)

const addIssue = (
  issues: ResolveMoveIntentValidationIssue[],
  path: string,
  code: ResolveMoveIntentValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const addUnknownFieldIssues = (
  issues: ResolveMoveIntentValidationIssue[],
  record: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
): void => {
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue
    const fieldPath = path ? `${path}.${key}` : key
    addIssue(
      issues,
      fieldPath,
      FORBIDDEN_CLIENT_AUTHORITY_FIELDS.has(key) ? 'forbidden-field' : 'unknown-field',
      FORBIDDEN_CLIENT_AUTHORITY_FIELDS.has(key)
        ? `${fieldPath} is resolved by the server and must not be submitted by the client.`
        : `${fieldPath} is not a recognised move-resolution intent field.`,
    )
  }
}

const requireField = (record: UnknownRecord, key: string, issues: ResolveMoveIntentValidationIssue[], path = key): boolean => {
  if (hasOwn(record, key)) return true
  addIssue(issues, path, 'missing-field', `${path} is required.`)
  return false
}

const parseBoundedText = (
  value: unknown,
  path: string,
  issues: ResolveMoveIntentValidationIssue[],
): string | null => {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    addIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }
  if (normalized.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TEXT_LENGTH) {
    addIssue(
      issues,
      path,
      'invalid-field',
      `${path} must be at most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TEXT_LENGTH} characters.`,
    )
    return null
  }
  return normalized
}

const parseBoundedTextArray = (
  value: unknown,
  path: string,
  issues: ResolveMoveIntentValidationIssue[],
  options: { readonly requireNonEmpty: boolean },
): string[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }

  if (options.requireNonEmpty && value.length === 0) {
    addIssue(issues, path, 'invalid-field', `${path} must contain at least one target.`)
  }
  if (value.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS) {
    addIssue(
      issues,
      path,
      'too-many-targets',
      `${path} must contain at most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS} targets.`,
    )
  }

  const parsedItems: string[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const itemPath = `${path}.${index}`
    const parsed = parseBoundedText(item, itemPath, issues)
    if (!parsed) return
    if (seen.has(parsed)) {
      addIssue(issues, itemPath, 'duplicate-target', `${itemPath} duplicates target placement ${parsed}.`)
      return
    }
    seen.add(parsed)
    parsedItems.push(parsed)
  })

  return parsedItems
}

const parseAreaDirection = (
  value: unknown,
  path: string,
  issues: ResolveMoveIntentValidationIssue[],
): MoveAutomationAreaDirection | null => {
  if (isMoveAutomationAreaDirection(value)) return value
  addIssue(
    issues,
    path,
    'invalid-field',
    `${path} must be one of: ${MOVE_AUTOMATION_AREA_DIRECTIONS.join(', ')}.`,
  )
  return null
}

const AIM_CELL_FIELDS = new Set(['x', 'y', 'z'])

const parseAimCellCoordinate = (
  value: unknown,
  path: string,
  issues: ResolveMoveIntentValidationIssue[],
): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  addIssue(issues, path, 'invalid-field', `${path} must be a safe integer.`)
  return null
}

const parseAimCell = (
  value: unknown,
  path: string,
  issues: ResolveMoveIntentValidationIssue[],
): GridAnchor | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an object with x, y, and z.`)
    return null
  }

  addUnknownFieldIssues(issues, value, AIM_CELL_FIELDS, path)
  requireField(value, 'x', issues, `${path}.x`)
  requireField(value, 'y', issues, `${path}.y`)
  requireField(value, 'z', issues, `${path}.z`)

  const x = parseAimCellCoordinate(value.x, `${path}.x`, issues)
  const y = parseAimCellCoordinate(value.y, `${path}.y`, issues)
  const z = parseAimCellCoordinate(value.z, `${path}.z`, issues)
  return x == null || y == null || z == null ? null : { x, y, z }
}

const parseSelfSelection = (
  selection: UnknownRecord,
  issues: ResolveMoveIntentValidationIssue[],
): ResolveSelfMoveSelection | null => {
  addUnknownFieldIssues(issues, selection, SELF_SELECTION_FIELDS, 'selection')
  return issues.length === 0 ? { kind: 'self' } : null
}

const parseSingleTargetSelection = (
  selection: UnknownRecord,
  issues: ResolveMoveIntentValidationIssue[],
): ResolveSingleTargetMoveSelection | null => {
  addUnknownFieldIssues(issues, selection, SINGLE_TARGET_SELECTION_FIELDS, 'selection')
  requireField(selection, 'targetPlacementId', issues, 'selection.targetPlacementId')
  const targetPlacementId = parseBoundedText(selection.targetPlacementId, 'selection.targetPlacementId', issues)
  return issues.length === 0 && targetPlacementId ? { kind: 'single-target', targetPlacementId } : null
}

const parseTargetCountSelection = (
  selection: UnknownRecord,
  issues: ResolveMoveIntentValidationIssue[],
): ResolveTargetCountMoveSelection | null => {
  addUnknownFieldIssues(issues, selection, TARGET_COUNT_SELECTION_FIELDS, 'selection')
  requireField(selection, 'targetPlacementIds', issues, 'selection.targetPlacementIds')
  const targetPlacementIds = parseBoundedTextArray(selection.targetPlacementIds, 'selection.targetPlacementIds', issues, {
    requireNonEmpty: true,
  })

  return issues.length === 0 && targetPlacementIds ? { kind: 'target-count', targetPlacementIds } : null
}

const parseAreaSelection = (
  selection: UnknownRecord,
  issues: ResolveMoveIntentValidationIssue[],
): ResolveAreaMoveSelection | null => {
  addUnknownFieldIssues(issues, selection, AREA_SELECTION_FIELDS, 'selection')
  requireField(selection, 'areaTemplateId', issues, 'selection.areaTemplateId')

  const areaTemplateId = parseBoundedText(selection.areaTemplateId, 'selection.areaTemplateId', issues)
  const direction = hasOwn(selection, 'direction')
    ? parseAreaDirection(selection.direction, 'selection.direction', issues)
    : null
  const aimCell = hasOwn(selection, 'aimCell')
    ? parseAimCell(selection.aimCell, 'selection.aimCell', issues)
    : null
  const excludedTargetPlacementIds = hasOwn(selection, 'excludedTargetPlacementIds')
    ? parseBoundedTextArray(selection.excludedTargetPlacementIds, 'selection.excludedTargetPlacementIds', issues, {
        requireNonEmpty: false,
      })
    : null

  if (hasOwn(selection, 'direction') && hasOwn(selection, 'aimCell')) {
    addIssue(
      issues,
      'selection.aimCell',
      'invalid-field',
      'selection.direction and selection.aimCell may not both be supplied.',
    )
  }

  if (issues.length > 0 || !areaTemplateId) return null

  return {
    kind: 'area',
    areaTemplateId,
    ...(direction ? { direction } : {}),
    ...(aimCell ? { aimCell: { ...aimCell } } : {}),
    ...(excludedTargetPlacementIds ? { excludedTargetPlacementIds: [...excludedTargetPlacementIds] } : {}),
  }
}

const parseSelection = (
  value: unknown,
  issues: ResolveMoveIntentValidationIssue[],
): ResolveMoveSelection | null => {
  if (!isRecord(value)) {
    addIssue(issues, 'selection', 'invalid-field', 'selection must be an object.')
    return null
  }

  requireField(value, 'kind', issues, 'selection.kind')
  if (value.kind === 'self') return parseSelfSelection(value, issues)
  if (value.kind === 'single-target') return parseSingleTargetSelection(value, issues)
  if (value.kind === 'target-count') return parseTargetCountSelection(value, issues)
  if (value.kind === 'area') return parseAreaSelection(value, issues)

  addIssue(
    issues,
    'selection.kind',
    'invalid-field',
    'selection.kind must be self, single-target, target-count, or area.',
  )
  return null
}

export const parseResolveMoveIntent = (value: unknown): ParseResolveMoveIntentResult => {
  const issues: ResolveMoveIntentValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '', code: 'not-object', message: 'Move-resolution intent must be an object.' }],
    }
  }

  addUnknownFieldIssues(issues, value, TOP_LEVEL_FIELDS, '')
  requireField(value, 'schemaVersion', issues)
  requireField(value, 'placementId', issues)
  requireField(value, 'moveName', issues)
  requireField(value, 'selection', issues)

  if (value.schemaVersion !== LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION) {
    addIssue(
      issues,
      'schemaVersion',
      'invalid-schema-version',
      `schemaVersion must be ${LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION}.`,
    )
  }

  const placementId = parseBoundedText(value.placementId, 'placementId', issues)
  const moveName = parseBoundedText(value.moveName, 'moveName', issues)
  const targetBranchId = hasOwn(value, 'targetBranchId')
    ? parseBoundedText(value.targetBranchId, 'targetBranchId', issues)
    : null
  const selection = parseSelection(value.selection, issues)

  if (issues.length > 0 || !placementId || !moveName || !selection) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId,
      moveName,
      ...(targetBranchId ? { targetBranchId } : {}),
      selection,
    },
    issues: [],
  }
}

export const isResolveMoveIntent = (value: unknown): value is ResolveMoveIntent =>
  parseResolveMoveIntent(value).valid

const TOKEN_FACING_DIRECTIONS = new Set<unknown>([
  'north-east',
  'south-east',
  'south-west',
  'north-west',
])

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const addResolvedMoveIssue = (
  issues: LivePlayResolvedMoveResultValidationIssue[],
  path: string,
  code: LivePlayResolvedMoveResultValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const requireResolvedMoveField = (
  record: UnknownRecord,
  key: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
  path = key,
): boolean => {
  if (hasOwn(record, key)) return true
  addResolvedMoveIssue(issues, path, 'missing-field', `${path} is required.`)
  return false
}

const parseResolvedMoveText = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): string | null => {
  if (typeof value !== 'string') {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }
  const normalized = value.trim()
  if (!normalized) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }
  return normalized
}

const parseResolvedMoveNullableText = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): string | null => {
  if (value === null) return null
  return parseResolvedMoveText(value, path, issues)
}

const parseResolvedMoveStringArray = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): string[] | null => {
  if (!Array.isArray(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }

  const parsed: string[] = []
  value.forEach((item, index) => {
    const text = parseResolvedMoveText(item, `${path}.${index}`, issues)
    if (text) parsed.push(text)
  })
  return parsed
}

const parseResolvedMoveRollLedger = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): MoveAutomationRollLedgerEntry[] | null => {
  try {
    return parseMoveAutomationRollLedger(value, path)
  }
  catch (error) {
    if (error instanceof MoveAutomationRollLedgerValidationError) {
      addResolvedMoveIssue(issues, error.path, 'invalid-field', error.message)
      return null
    }
    throw error
  }
}

const parseResolvedMoveTrace = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): MoveResolutionTraceSummary | null => {
  try {
    return parseMoveResolutionTraceSummary(value, path)
  }
  catch (error) {
    if (error instanceof MoveResolutionTraceValidationError) {
      addResolvedMoveIssue(issues, error.path, 'invalid-field', error.message)
      return null
    }
    throw error
  }
}

const parseResolvedMoveRecordArray = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): Record<string, unknown>[] | null => {
  if (!Array.isArray(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }

  const parsed: Record<string, unknown>[] = []
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      addResolvedMoveIssue(issues, `${path}.${index}`, 'invalid-field', `${path}.${index} must be an object.`)
      return
    }
    parsed.push(cloneJson(item))
  })
  return parsed
}

const parseResolvedMoveGridAnchor = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): GridAnchor | null => {
  if (!isRecord(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an object with x, y, and z.`)
    return null
  }
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) || !Number.isSafeInteger(value.z)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must contain safe integer x, y, and z coordinates.`)
    return null
  }
  return { x: value.x as number, y: value.y as number, z: value.z as number }
}

const parseResolvedMoveGridAnchorArray = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): GridAnchor[] | null => {
  if (!Array.isArray(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }

  const parsed: GridAnchor[] = []
  value.forEach((item, index) => {
    const anchor = parseResolvedMoveGridAnchor(item, `${path}.${index}`, issues)
    if (anchor) parsed.push(anchor)
  })
  return parsed
}

const parseResolvedMoveDirection = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): MoveAutomationAreaDirection | null => {
  if (isMoveAutomationAreaDirection(value)) return value
  addResolvedMoveIssue(
    issues,
    path,
    'invalid-field',
    `${path} must be one of: ${MOVE_AUTOMATION_AREA_DIRECTIONS.join(', ')}.`,
  )
  return null
}

const parseResolvedMoveFacing = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): TokenFacingDirection | null => {
  if (TOKEN_FACING_DIRECTIONS.has(value)) return value as TokenFacingDirection
  addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be a token-facing direction.`)
  return null
}

const parseResolvedMoveTransaction = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): MoveAutomationTransaction | null => {
  if (!isRecord(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an object.`)
    return null
  }

  requireResolvedMoveField(value, 'userId', issues, `${path}.userId`)
  requireResolvedMoveField(value, 'userName', issues, `${path}.userName`)
  requireResolvedMoveField(value, 'moveName', issues, `${path}.moveName`)
  requireResolvedMoveField(value, 'scriptKind', issues, `${path}.scriptKind`)
  requireResolvedMoveField(value, 'scriptVersion', issues, `${path}.scriptVersion`)
  requireResolvedMoveField(value, 'hpUpdates', issues, `${path}.hpUpdates`)
  requireResolvedMoveField(value, 'conditionUpdates', issues, `${path}.conditionUpdates`)
  requireResolvedMoveField(value, 'combatStageUpdates', issues, `${path}.combatStageUpdates`)
  requireResolvedMoveField(value, 'hazardsToAdd', issues, `${path}.hazardsToAdd`)
  requireResolvedMoveField(value, 'fieldEffectsToApply', issues, `${path}.fieldEffectsToApply`)
  requireResolvedMoveField(value, 'logLines', issues, `${path}.logLines`)

  const userId = parseResolvedMoveText(value.userId, `${path}.userId`, issues)
  const userName = parseResolvedMoveText(value.userName, `${path}.userName`, issues)
  const moveName = parseResolvedMoveText(value.moveName, `${path}.moveName`, issues)
  const scriptKind = parseResolvedMoveText(value.scriptKind, `${path}.scriptKind`, issues)
  if (typeof value.scriptVersion !== 'number' || !Number.isSafeInteger(value.scriptVersion)) {
    addResolvedMoveIssue(issues, `${path}.scriptVersion`, 'invalid-field', `${path}.scriptVersion must be a safe integer.`)
  }

  const attackedTargetIds = hasOwn(value, 'attackedTargetIds')
    ? parseResolvedMoveStringArray(value.attackedTargetIds, `${path}.attackedTargetIds`, issues)
    : []
  const hitTargetIds = hasOwn(value, 'hitTargetIds')
    ? parseResolvedMoveStringArray(value.hitTargetIds, `${path}.hitTargetIds`, issues)
    : []
  const hpUpdates = parseResolvedMoveRecordArray(value.hpUpdates, `${path}.hpUpdates`, issues)
  const conditionUpdates = parseResolvedMoveRecordArray(value.conditionUpdates, `${path}.conditionUpdates`, issues)
  const combatStageUpdates = parseResolvedMoveRecordArray(value.combatStageUpdates, `${path}.combatStageUpdates`, issues)
  const hazardsToAdd = parseResolvedMoveRecordArray(value.hazardsToAdd, `${path}.hazardsToAdd`, issues)
  const fieldEffectsToApply = parseResolvedMoveRecordArray(value.fieldEffectsToApply, `${path}.fieldEffectsToApply`, issues)
  const logLines = parseResolvedMoveStringArray(value.logLines, `${path}.logLines`, issues)

  if (
    issues.length > 0
    || !userId
    || !userName
    || !moveName
    || !scriptKind
    || typeof value.scriptVersion !== 'number'
    || !Number.isSafeInteger(value.scriptVersion)
    || !attackedTargetIds
    || !hitTargetIds
    || !hpUpdates
    || !conditionUpdates
    || !combatStageUpdates
    || !hazardsToAdd
    || !fieldEffectsToApply
    || !logLines
  ) {
    return null
  }

  return {
    userId,
    userName,
    moveName,
    scriptKind: scriptKind as MoveAutomationTransaction['scriptKind'],
    scriptVersion: value.scriptVersion,
    attackedTargetIds,
    hitTargetIds,
    hpUpdates: hpUpdates as unknown as MoveAutomationTransaction['hpUpdates'],
    conditionUpdates: conditionUpdates as unknown as MoveAutomationTransaction['conditionUpdates'],
    combatStageUpdates: combatStageUpdates as unknown as MoveAutomationTransaction['combatStageUpdates'],
    hazardsToAdd: hazardsToAdd as unknown as MoveAutomationTransaction['hazardsToAdd'],
    fieldEffectsToApply: fieldEffectsToApply as unknown as MoveAutomationTransaction['fieldEffectsToApply'],
    logLines,
  }
}

const parseResolvedMoveArea = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): LivePlayResolvedMoveArea | null => {
  if (!isRecord(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an object.`)
    return null
  }

  requireResolvedMoveField(value, 'areaTemplateId', issues, `${path}.areaTemplateId`)
  requireResolvedMoveField(value, 'template', issues, `${path}.template`)
  requireResolvedMoveField(value, 'cells', issues, `${path}.cells`)
  requireResolvedMoveField(value, 'candidateTargetIds', issues, `${path}.candidateTargetIds`)
  requireResolvedMoveField(value, 'excludedTargetIds', issues, `${path}.excludedTargetIds`)

  const areaTemplateId = parseResolvedMoveText(value.areaTemplateId, `${path}.areaTemplateId`, issues)
  if (!isRecord(value.template)) {
    addResolvedMoveIssue(issues, `${path}.template`, 'invalid-field', `${path}.template must be an object.`)
  }
  const cells = parseResolvedMoveGridAnchorArray(value.cells, `${path}.cells`, issues)
  const candidateTargetIds = parseResolvedMoveStringArray(value.candidateTargetIds, `${path}.candidateTargetIds`, issues)
  const excludedTargetIds = parseResolvedMoveStringArray(value.excludedTargetIds, `${path}.excludedTargetIds`, issues)
  const direction = hasOwn(value, 'direction')
    ? parseResolvedMoveDirection(value.direction, `${path}.direction`, issues)
    : null
  const aimCell = hasOwn(value, 'aimCell')
    ? parseResolvedMoveGridAnchor(value.aimCell, `${path}.aimCell`, issues)
    : null

  if (issues.length > 0 || !areaTemplateId || !isRecord(value.template) || !cells || !candidateTargetIds || !excludedTargetIds) {
    return null
  }

  return {
    areaTemplateId,
    template: cloneJson(value.template) as unknown as MoveAutomationAreaTemplate,
    cells,
    candidateTargetIds,
    excludedTargetIds,
    ...(direction ? { direction } : {}),
    ...(aimCell ? { aimCell } : {}),
  }
}

const parseResolvedMoveMovement = (
  value: unknown,
  path: string,
  issues: LivePlayResolvedMoveResultValidationIssue[],
): LivePlayResolvedMovePassMovement | null => {
  if (!isRecord(value)) {
    addResolvedMoveIssue(issues, path, 'invalid-field', `${path} must be an object.`)
    return null
  }
  if (value.kind !== 'pass') {
    addResolvedMoveIssue(issues, `${path}.kind`, 'invalid-field', `${path}.kind must be pass.`)
  }
  requireResolvedMoveField(value, 'from', issues, `${path}.from`)
  requireResolvedMoveField(value, 'destination', issues, `${path}.destination`)
  requireResolvedMoveField(value, 'direction', issues, `${path}.direction`)
  requireResolvedMoveField(value, 'pathCells', issues, `${path}.pathCells`)

  const from = parseResolvedMoveGridAnchor(value.from, `${path}.from`, issues)
  const destination = parseResolvedMoveGridAnchor(value.destination, `${path}.destination`, issues)
  const direction = parseResolvedMoveDirection(value.direction, `${path}.direction`, issues)
  const pathCells = parseResolvedMoveGridAnchorArray(value.pathCells, `${path}.pathCells`, issues)

  if (issues.length > 0 || value.kind !== 'pass' || !from || !destination || !direction || !pathCells) return null
  return { kind: 'pass', from, destination, direction, pathCells }
}

export const parseLivePlayResolvedMoveResult = (value: unknown): ParseLivePlayResolvedMoveResultResult => {
  const issues: LivePlayResolvedMoveResultValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '', code: 'not-object', message: 'Resolved move result must be an object.' }],
    }
  }

  if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION) {
    addResolvedMoveIssue(
      issues,
      'schemaVersion',
      'invalid-schema-version',
      `schemaVersion must be ${LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION}.`,
    )
  }
  requireResolvedMoveField(value, 'actorPlacementId', issues)
  requireResolvedMoveField(value, 'moveName', issues)
  requireResolvedMoveField(value, 'canonicalMoveName', issues)
  requireResolvedMoveField(value, 'moveKey', issues)
  requireResolvedMoveField(value, 'frequency', issues)
  requireResolvedMoveField(value, 'damageFormula', issues)
  requireResolvedMoveField(value, 'selectedTargetIds', issues)
  requireResolvedMoveField(value, 'script', issues)
  requireResolvedMoveField(value, 'transaction', issues)

  const actorPlacementId = parseResolvedMoveText(value.actorPlacementId, 'actorPlacementId', issues)
  const moveName = parseResolvedMoveText(value.moveName, 'moveName', issues)
  const canonicalMoveName = parseResolvedMoveText(value.canonicalMoveName, 'canonicalMoveName', issues)
  const moveKey = parseResolvedMoveText(value.moveKey, 'moveKey', issues)
  const frequency = parseResolvedMoveNullableText(value.frequency, 'frequency', issues)
  const damageFormula = parseResolvedMoveNullableText(value.damageFormula, 'damageFormula', issues)
  const targetBranchId = hasOwn(value, 'targetBranchId')
    ? parseResolvedMoveText(value.targetBranchId, 'targetBranchId', issues)
    : null
  const selectedTargetIds = parseResolvedMoveStringArray(value.selectedTargetIds, 'selectedTargetIds', issues)
  // Results stored before the ledger shipped remain readable as an empty legacy ledger.
  const rollLedger = hasOwn(value, 'rollLedger')
    ? parseResolvedMoveRollLedger(value.rollLedger, 'rollLedger', issues)
    : []
  const trace = hasOwn(value, 'trace')
    ? parseResolvedMoveTrace(value.trace, 'trace', issues)
    : null
  if (!isRecord(value.script)) {
    addResolvedMoveIssue(issues, 'script', 'invalid-field', 'script must be an object.')
  }
  const transaction = parseResolvedMoveTransaction(value.transaction, 'transaction', issues)
  const feedback = hasOwn(value, 'feedback')
    ? isRecord(value.feedback)
      ? cloneJson(value.feedback) as unknown as MoveAutomationFeedbackState
      : (addResolvedMoveIssue(issues, 'feedback', 'invalid-field', 'feedback must be an object.'), null)
    : null
  const desiredFacing = hasOwn(value, 'desiredFacing')
    ? parseResolvedMoveFacing(value.desiredFacing, 'desiredFacing', issues)
    : null
  const area = hasOwn(value, 'area') ? parseResolvedMoveArea(value.area, 'area', issues) : null
  const movement = hasOwn(value, 'movement') ? parseResolvedMoveMovement(value.movement, 'movement', issues) : null

  if (
    issues.length > 0
    || !actorPlacementId
    || !moveName
    || !canonicalMoveName
    || !moveKey
    || !selectedTargetIds
    || !rollLedger
    || !isRecord(value.script)
    || !transaction
  ) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    move: {
      schemaVersion: LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
      actorPlacementId,
      moveName,
      canonicalMoveName,
      moveKey,
      frequency,
      damageFormula,
      ...(targetBranchId ? { targetBranchId } : {}),
      selectedTargetIds,
      rollLedger,
      ...(trace ? { trace } : {}),
      script: cloneJson(value.script) as unknown as MoveAutomationScript,
      transaction,
      ...(feedback ? { feedback } : {}),
      ...(desiredFacing ? { desiredFacing } : {}),
      ...(area ? { area } : {}),
      ...(movement ? { movement } : {}),
    },
    issues: [],
  }
}

export const isLivePlayResolvedMoveResult = (value: unknown): value is LivePlayResolvedMoveResult =>
  parseLivePlayResolvedMoveResult(value).valid
