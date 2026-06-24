export const LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION = 1 as const

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

export type ResolveMoveSelection =
  | ResolveSelfMoveSelection
  | ResolveSingleTargetMoveSelection
  | ResolveTargetCountMoveSelection

export interface ResolveMoveIntent {
  readonly schemaVersion: typeof LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION
  readonly placementId: string
  readonly moveName: string
  readonly targetBranchId?: string
  readonly selection: ResolveMoveSelection
}

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

const FORBIDDEN_CLIENT_AUTHORITY_FIELDS = new Set([
  'accuracyRoll',
  'accuracyRolls',
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
  'transaction',
  'resolvedTransaction',
  'hpUpdates',
  'conditionUpdates',
  'combatStageUpdates',
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
  if (!Array.isArray(selection.targetPlacementIds)) {
    addIssue(issues, 'selection.targetPlacementIds', 'invalid-field', 'selection.targetPlacementIds must be an array.')
    return null
  }

  if (selection.targetPlacementIds.length === 0) {
    addIssue(
      issues,
      'selection.targetPlacementIds',
      'invalid-field',
      'selection.targetPlacementIds must contain at least one target.',
    )
  }
  if (selection.targetPlacementIds.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS) {
    addIssue(
      issues,
      'selection.targetPlacementIds',
      'too-many-targets',
      `selection.targetPlacementIds must contain at most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS} targets.`,
    )
  }

  const targetPlacementIds: string[] = []
  const seen = new Set<string>()
  selection.targetPlacementIds.forEach((item, index) => {
    const path = `selection.targetPlacementIds.${index}`
    const parsed = parseBoundedText(item, path, issues)
    if (!parsed) return
    if (seen.has(parsed)) {
      addIssue(issues, path, 'duplicate-target', `${path} duplicates target placement ${parsed}.`)
      return
    }
    seen.add(parsed)
    targetPlacementIds.push(parsed)
  })

  return issues.length === 0 ? { kind: 'target-count', targetPlacementIds } : null
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

  addIssue(
    issues,
    'selection.kind',
    'invalid-field',
    'selection.kind must be self, single-target, or target-count.',
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
