import type { MapHazardKind } from '~/types/map'

export const LIVE_PLAY_BATCH_MAX_HAZARD_CELLS = 128 as const
export const LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS = 256 as const
export const LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS = 16 as const
export const LIVE_PLAY_BATCH_MAX_AFFECTED_TOKEN_IDS = 64 as const

export const LIVE_PLAY_BATCH_LIMITS = {
  hazardCells: LIVE_PLAY_BATCH_MAX_HAZARD_CELLS,
  terrainVoxels: LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
  fieldEffectOperations: LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS,
  affectedTokenIds: LIVE_PLAY_BATCH_MAX_AFFECTED_TOKEN_IDS,
} as const

export type LivePlayBatchLimitName = keyof typeof LIVE_PLAY_BATCH_LIMITS

export const LIVE_PLAY_BATCH_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'unknown-field',
  'invalid-mode',
  'invalid-kind',
  'invalid-array',
  'empty-array',
  'too-many-items',
  'invalid-cell',
  'duplicate-cell',
  'invalid-token-id',
  'duplicate-token-id',
] as const

export type LivePlayBatchValidationCode = (typeof LIVE_PLAY_BATCH_VALIDATION_CODES)[number]

export interface LivePlayBatchValidationIssue {
  readonly path: string
  readonly code: LivePlayBatchValidationCode
  readonly message: string
  readonly expected?: string
  readonly received?: string
}

export interface LivePlayBatchValidationSuccess<TValue> {
  readonly valid: true
  readonly value: TValue
  readonly issues: readonly []
}

export interface LivePlayBatchValidationFailure {
  readonly valid: false
  readonly issues: readonly LivePlayBatchValidationIssue[]
}

export type LivePlayBatchValidationResult<TValue> =
  | LivePlayBatchValidationSuccess<TValue>
  | LivePlayBatchValidationFailure

export interface LivePlayBatchGridCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const LIVE_PLAY_HAZARD_KIND_VALUES = [
  'spikes',
  'toxic-spikes',
  'sticky-web',
  'stealth-rock',
  'fire',
] as const satisfies readonly MapHazardKind[]
export type LivePlayHazardKind = (typeof LIVE_PLAY_HAZARD_KIND_VALUES)[number]

export const LIVE_PLAY_CLEAR_HAZARDS_MODES = ['all', 'cells', 'kind'] as const
export type ClearHazardsMode = (typeof LIVE_PLAY_CLEAR_HAZARDS_MODES)[number]

export interface ClearHazardsAllPayload {
  readonly mode: 'all'
}

export interface ClearHazardsCellsPayload {
  readonly mode: 'cells'
  readonly cells: readonly LivePlayBatchGridCell[]
  readonly kind?: MapHazardKind
}

export interface ClearHazardsKindPayload {
  readonly mode: 'kind'
  readonly kind: MapHazardKind
}

export type ClearHazardsPayload =
  | ClearHazardsAllPayload
  | ClearHazardsCellsPayload
  | ClearHazardsKindPayload

/**
 * Duplicate cells reject by default. Use `normalize` only for idempotent batch modes
 * such as clear-by-cell, where repeated cells can safely collapse to the first one.
 */
export type LivePlayBatchDuplicatePolicy = 'reject' | 'normalize'

export type LivePlayBatchItemParser<TValue> = (
  item: unknown,
  path: string,
  index: number,
) => LivePlayBatchValidationResult<TValue>

export interface LivePlayBatchStrictObjectOptions {
  readonly path?: string
  readonly allowedFields: readonly string[]
  readonly requiredFields?: readonly string[]
  readonly description?: string
}

export interface LivePlayBatchBoundedArrayOptions<TValue = unknown> {
  readonly path?: string
  readonly maxItems: number
  readonly minItems?: number
  readonly itemName?: string
  readonly parseItem?: LivePlayBatchItemParser<TValue>
}

export interface LivePlayBatchUniqueGridCellsOptions {
  readonly path?: string
  readonly maxCells: number
  readonly duplicatePolicy?: LivePlayBatchDuplicatePolicy
  readonly itemName?: string
}

export type LivePlayBatchGuardrailOptions<TOptionName extends string> = Omit<
  LivePlayBatchUniqueGridCellsOptions,
  TOptionName
> & {
  readonly [K in TOptionName]?: number
}

export type LivePlayBatchHazardCellsOptions = LivePlayBatchGuardrailOptions<'maxCells'>
export type LivePlayBatchTerrainVoxelCellsOptions = LivePlayBatchGuardrailOptions<'maxCells'>

export interface LivePlayBatchUniqueCellItemsOptions<TItem extends LivePlayBatchGridCell> {
  readonly path?: string
  readonly maxItems: number
  readonly duplicatePolicy?: LivePlayBatchDuplicatePolicy
  readonly itemName?: string
  readonly parseItem: LivePlayBatchItemParser<TItem>
}

export type LivePlayBatchTerrainVoxelsOptions<TVoxel extends LivePlayBatchGridCell> = Omit<
  LivePlayBatchUniqueCellItemsOptions<TVoxel>,
  'maxItems' | 'parseItem'
> & {
  readonly maxItems?: number
  readonly parseVoxel: LivePlayBatchItemParser<TVoxel>
}

export interface LivePlayBatchFieldEffectOperationsOptions<TOperation> {
  readonly path?: string
  readonly maxItems?: number
  readonly itemName?: string
  readonly parseOperation: LivePlayBatchItemParser<TOperation>
}

export interface LivePlayBatchAffectedTokenIdsOptions {
  readonly path?: string
  readonly maxIds?: number
  readonly duplicatePolicy?: LivePlayBatchDuplicatePolicy
}

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayBatchValidationIssue[]

const EXPECTED_OBJECT = 'object'
const EXPECTED_ARRAY = 'array'
const EXPECTED_NON_EMPTY_ARRAY = 'non-empty array'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_GRID_COORDINATE = 'safe non-negative integer grid coordinate'

const BATCH_VALIDATION_CODE_SET = new Set<unknown>(LIVE_PLAY_BATCH_VALIDATION_CODES)
const LIVE_PLAY_CLEAR_HAZARDS_MODE_SET = new Set<unknown>(LIVE_PLAY_CLEAR_HAZARDS_MODES)
const LIVE_PLAY_HAZARD_KIND_SET = new Set<unknown>(LIVE_PLAY_HAZARD_KIND_VALUES)
const GRID_CELL_FIELDS = ['x', 'y', 'z'] as const
const CLEAR_HAZARDS_PAYLOAD_FIELDS = ['mode', 'cells', 'kind'] as const

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const appendPath = (path: string, field: string): string => `${path}.${field}`

const describeReceived = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: LivePlayBatchValidationCode,
  message: string,
  expected?: string,
  received?: unknown,
): void => {
  issues.push({
    path,
    code,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received: describeReceived(received) }),
  })
}

const failure = <TValue>(
  issues: readonly LivePlayBatchValidationIssue[],
): LivePlayBatchValidationResult<TValue> => ({
  valid: false,
  issues: [...issues],
})

const success = <TValue>(value: TValue): LivePlayBatchValidationResult<TValue> => ({
  valid: true,
  value,
  issues: [],
})

const assertSafeItemLimit = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer batch limit`)
  }
}

const assertSafeMinItems = (value: number, maxItems: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maxItems) {
    throw new Error('minItems must be a safe integer between 0 and maxItems')
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const isLivePlayBatchValidationCode = (
  value: unknown,
): value is LivePlayBatchValidationCode => BATCH_VALIDATION_CODE_SET.has(value)

export const isClearHazardsMode = (value: unknown): value is ClearHazardsMode =>
  LIVE_PLAY_CLEAR_HAZARDS_MODE_SET.has(value)

export const isLivePlayHazardKind = (value: unknown): value is MapHazardKind =>
  LIVE_PLAY_HAZARD_KIND_SET.has(value)

export const isLivePlayBatchRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isLivePlayBatchGridCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const isLivePlayBatchGridCell = (value: unknown): value is LivePlayBatchGridCell => {
  if (!isLivePlayBatchRecord(value)) return false
  if (!GRID_CELL_FIELDS.every((field) => isLivePlayBatchGridCoordinate(value[field]))) return false
  return Object.keys(value).every((field) => (GRID_CELL_FIELDS as readonly string[]).includes(field))
}

export const formatLivePlayBatchGridCellKey = (cell: LivePlayBatchGridCell): string =>
  `${cell.x},${cell.y},${cell.z}`

export const livePlayBatchGridCellsEqual = (
  left: LivePlayBatchGridCell,
  right: LivePlayBatchGridCell,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

export const parseLivePlayBatchStrictObject = (
  value: unknown,
  options: LivePlayBatchStrictObjectOptions,
): LivePlayBatchValidationResult<Readonly<Record<string, unknown>>> => {
  const path = options.path ?? '$'
  const description = options.description ?? 'live-play batch object'
  const issues: MutableIssueList = []

  if (!isLivePlayBatchRecord(value)) {
    addIssue(
      issues,
      path,
      'not-object',
      `${description} must be an object.`,
      EXPECTED_OBJECT,
      value,
    )
    return failure(issues)
  }

  const allowedFields = new Set(options.allowedFields)
  for (const field of options.requiredFields ?? []) {
    if (!hasOwn(value, field)) {
      addIssue(
        issues,
        appendPath(path, field),
        'missing-field',
        `${description} must include ${field}.`,
      )
    }
  }

  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      addIssue(
        issues,
        appendPath(path, field),
        'unknown-field',
        `${appendPath(path, field)} is not a supported live-play batch field.`,
        options.allowedFields.join(' | '),
        value[field],
      )
    }
  }

  if (issues.length > 0) return failure(issues)

  const parsed: UnknownRecord = {}
  for (const field of options.allowedFields) {
    if (hasOwn(value, field)) parsed[field] = value[field]
  }
  return success(parsed)
}

export const parseLivePlayBatchBoundedArray = <TValue = unknown>(
  value: unknown,
  options: LivePlayBatchBoundedArrayOptions<TValue>,
): LivePlayBatchValidationResult<readonly TValue[]> => {
  const path = options.path ?? '$'
  const itemName = options.itemName ?? 'items'
  const minItems = options.minItems ?? 0
  const issues: MutableIssueList = []

  assertSafeItemLimit(options.maxItems, 'maxItems')
  assertSafeMinItems(minItems, options.maxItems)

  if (!Array.isArray(value)) {
    addIssue(
      issues,
      path,
      'invalid-array',
      `${path} must be an array of ${itemName}.`,
      EXPECTED_ARRAY,
      value,
    )
    return failure(issues)
  }

  if (value.length < minItems) {
    addIssue(
      issues,
      path,
      'empty-array',
      `${path} must contain at least ${minItems} ${itemName}.`,
      minItems === 1 ? EXPECTED_NON_EMPTY_ARRAY : `array with at least ${minItems} items`,
      value,
    )
    return failure(issues)
  }

  if (value.length > options.maxItems) {
    addIssue(
      issues,
      path,
      'too-many-items',
      `${path} must contain at most ${options.maxItems} ${itemName}.`,
      `array with at most ${options.maxItems} items`,
      value,
    )
    return failure(issues)
  }

  if (options.parseItem === undefined) {
    return success([...(value as unknown[])] as TValue[])
  }

  const parsed: TValue[] = []
  value.forEach((item, index) => {
    const itemResult = options.parseItem?.(item, `${path}[${index}]`, index)
    if (itemResult === undefined) return
    if (itemResult.valid) {
      parsed.push(itemResult.value)
      return
    }
    issues.push(...itemResult.issues)
  })

  if (issues.length > 0) return failure(issues)
  return success(parsed)
}

export const parseLivePlayBatchGridCell = (
  value: unknown,
  path = '$',
): LivePlayBatchValidationResult<LivePlayBatchGridCell> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: GRID_CELL_FIELDS,
    requiredFields: GRID_CELL_FIELDS,
    description: 'live-play batch grid cell',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const issues: MutableIssueList = []
  const record = recordResult.value
  for (const coordinate of GRID_CELL_FIELDS) {
    if (!isLivePlayBatchGridCoordinate(record[coordinate])) {
      addIssue(
        issues,
        appendPath(path, coordinate),
        'invalid-cell',
        `${appendPath(path, coordinate)} must be a safe non-negative integer grid coordinate.`,
        EXPECTED_GRID_COORDINATE,
        record[coordinate],
      )
    }
  }

  if (issues.length > 0) return failure(issues)
  return success({
    x: record.x as number,
    y: record.y as number,
    z: record.z as number,
  })
}

const enforceUniqueCellItems = <TItem extends LivePlayBatchGridCell>(
  items: readonly TItem[],
  path: string,
  duplicatePolicy: LivePlayBatchDuplicatePolicy,
): LivePlayBatchValidationResult<readonly TItem[]> => {
  const issues: MutableIssueList = []
  const seen = new Map<string, number>()
  const uniqueItems: TItem[] = []

  items.forEach((item, index) => {
    const key = formatLivePlayBatchGridCellKey(item)
    const firstIndex = seen.get(key)
    if (firstIndex !== undefined) {
      if (duplicatePolicy === 'reject') {
        addIssue(
          issues,
          `${path}[${index}]`,
          'duplicate-cell',
          `${path}[${index}] duplicates ${path}[${firstIndex}] at grid cell ${key}.`,
          'unique grid cell',
          item,
        )
      }
      return
    }
    seen.set(key, index)
    uniqueItems.push(item)
  })

  if (issues.length > 0) return failure(issues)
  return success(uniqueItems)
}

export const parseLivePlayBatchUniqueGridCells = (
  value: unknown,
  options: LivePlayBatchUniqueGridCellsOptions,
): LivePlayBatchValidationResult<readonly LivePlayBatchGridCell[]> => {
  const path = options.path ?? 'payload.cells'
  const duplicatePolicy = options.duplicatePolicy ?? 'reject'
  const cellsResult = parseLivePlayBatchBoundedArray<LivePlayBatchGridCell>(value, {
    path,
    minItems: 1,
    maxItems: options.maxCells,
    itemName: options.itemName ?? 'grid cells',
    parseItem: (item, itemPath) => parseLivePlayBatchGridCell(item, itemPath),
  })
  if (!cellsResult.valid) return failure(cellsResult.issues)
  return enforceUniqueCellItems(cellsResult.value, path, duplicatePolicy)
}

export const parseLivePlayBatchHazardCells = (
  value: unknown,
  options: LivePlayBatchHazardCellsOptions = {},
): LivePlayBatchValidationResult<readonly LivePlayBatchGridCell[]> => parseLivePlayBatchUniqueGridCells(value, {
  path: options.path ?? 'payload.cells',
  maxCells: options.maxCells ?? LIVE_PLAY_BATCH_MAX_HAZARD_CELLS,
  duplicatePolicy: options.duplicatePolicy ?? 'reject',
  itemName: options.itemName ?? 'hazard cells',
})

const unexpectedClearHazardsModeFieldIssue = (
  path: string,
  field: string,
  mode: ClearHazardsMode,
  received: unknown,
): LivePlayBatchValidationIssue => ({
  path: appendPath(path, field),
  code: 'unknown-field',
  message: `${appendPath(path, field)} is not supported for clearHazards ${mode} mode.`,
  expected: mode === 'cells'
    ? CLEAR_HAZARDS_PAYLOAD_FIELDS.join(' | ')
    : mode === 'kind'
      ? 'mode | kind'
      : 'mode',
  received: describeReceived(received),
})

const parseClearHazardsKind = (
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<MapHazardKind> => {
  if (isLivePlayHazardKind(value)) return success(value)
  return failure([{
    path,
    code: 'invalid-kind',
    message: `${path} must be a supported hazard kind.`,
    expected: LIVE_PLAY_HAZARD_KIND_VALUES.join(' | '),
    received: describeReceived(value),
  }])
}

const parseOptionalClearHazardsKind = (
  record: Readonly<Record<string, unknown>>,
  path: string,
): LivePlayBatchValidationResult<MapHazardKind | undefined> => {
  if (!hasOwn(record, 'kind')) return success(undefined)
  return parseClearHazardsKind(record.kind, appendPath(path, 'kind'))
}

export const parseClearHazardsPayload = (
  value: unknown,
  path = 'payload',
): LivePlayBatchValidationResult<ClearHazardsPayload> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: CLEAR_HAZARDS_PAYLOAD_FIELDS,
    requiredFields: ['mode'],
    description: 'clearHazards payload',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  const mode = record.mode
  if (!isClearHazardsMode(mode)) {
    return failure([{
      path: appendPath(path, 'mode'),
      code: 'invalid-mode',
      message: `${appendPath(path, 'mode')} must be a supported clearHazards mode.`,
      expected: LIVE_PLAY_CLEAR_HAZARDS_MODES.join(' | '),
      received: describeReceived(mode),
    }])
  }

  if (mode === 'all') {
    const issues: MutableIssueList = []
    if (hasOwn(record, 'cells')) {
      issues.push(unexpectedClearHazardsModeFieldIssue(path, 'cells', mode, record.cells))
    }
    if (hasOwn(record, 'kind')) {
      issues.push(unexpectedClearHazardsModeFieldIssue(path, 'kind', mode, record.kind))
    }
    if (issues.length > 0) return failure(issues)
    return success({ mode })
  }

  if (mode === 'kind') {
    const issues: MutableIssueList = []
    if (hasOwn(record, 'cells')) {
      issues.push(unexpectedClearHazardsModeFieldIssue(path, 'cells', mode, record.cells))
    }
    if (!hasOwn(record, 'kind')) {
      addIssue(
        issues,
        appendPath(path, 'kind'),
        'missing-field',
        'clearHazards kind mode must include kind.',
      )
    }
    if (issues.length > 0) return failure(issues)

    const kindResult = parseClearHazardsKind(record.kind, appendPath(path, 'kind'))
    if (!kindResult.valid) return failure(kindResult.issues)
    return success({ mode, kind: kindResult.value })
  }

  const issues: MutableIssueList = []
  if (!hasOwn(record, 'cells')) {
    addIssue(
      issues,
      appendPath(path, 'cells'),
      'missing-field',
      'clearHazards cells mode must include cells.',
    )
  }
  if (issues.length > 0) return failure(issues)

  const cellsResult = parseLivePlayBatchHazardCells(record.cells, {
    path: appendPath(path, 'cells'),
    duplicatePolicy: 'normalize',
  })
  const kindResult = parseOptionalClearHazardsKind(record, path)
  if (!cellsResult.valid || !kindResult.valid) {
    return failure([
      ...(cellsResult.valid ? [] : cellsResult.issues),
      ...(kindResult.valid ? [] : kindResult.issues),
    ])
  }

  return success({
    mode,
    cells: cellsResult.value,
    ...(kindResult.value === undefined ? {} : { kind: kindResult.value }),
  })
}

export const parseLivePlayBatchTerrainVoxelCells = (
  value: unknown,
  options: LivePlayBatchTerrainVoxelCellsOptions = {},
): LivePlayBatchValidationResult<readonly LivePlayBatchGridCell[]> => parseLivePlayBatchUniqueGridCells(value, {
  path: options.path ?? 'payload.cells',
  maxCells: options.maxCells ?? LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
  duplicatePolicy: options.duplicatePolicy ?? 'reject',
  itemName: options.itemName ?? 'terrain voxel cells',
})

export const parseLivePlayBatchUniqueCellItems = <TItem extends LivePlayBatchGridCell>(
  value: unknown,
  options: LivePlayBatchUniqueCellItemsOptions<TItem>,
): LivePlayBatchValidationResult<readonly TItem[]> => {
  const path = options.path ?? 'payload.items'
  const duplicatePolicy = options.duplicatePolicy ?? 'reject'
  const itemsResult = parseLivePlayBatchBoundedArray<TItem>(value, {
    path,
    minItems: 1,
    maxItems: options.maxItems,
    itemName: options.itemName ?? 'cell items',
    parseItem: options.parseItem,
  })
  if (!itemsResult.valid) return failure(itemsResult.issues)
  return enforceUniqueCellItems(itemsResult.value, path, duplicatePolicy)
}

export const parseLivePlayBatchTerrainVoxels = <TVoxel extends LivePlayBatchGridCell>(
  value: unknown,
  options: LivePlayBatchTerrainVoxelsOptions<TVoxel>,
): LivePlayBatchValidationResult<readonly TVoxel[]> => parseLivePlayBatchUniqueCellItems(value, {
  path: options.path ?? 'payload.voxels',
  maxItems: options.maxItems ?? LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
  duplicatePolicy: options.duplicatePolicy ?? 'reject',
  itemName: options.itemName ?? 'terrain voxels',
  parseItem: options.parseVoxel,
})

export const parseLivePlayBatchFieldEffectOperations = <TOperation>(
  value: unknown,
  options: LivePlayBatchFieldEffectOperationsOptions<TOperation>,
): LivePlayBatchValidationResult<readonly TOperation[]> => parseLivePlayBatchBoundedArray(value, {
  path: options.path ?? 'payload.operations',
  minItems: 1,
  maxItems: options.maxItems ?? LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS,
  itemName: options.itemName ?? 'field-effect operations',
  parseItem: options.parseOperation,
})

const parseAffectedTokenId = (
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<string> => {
  if (!isNonEmptyString(value)) {
    return failure([{
      path,
      code: 'invalid-token-id',
      message: `${path} must be a non-empty token id string.`,
      expected: EXPECTED_NON_EMPTY_STRING,
      received: describeReceived(value),
    }])
  }
  return success(value.trim())
}

export const parseLivePlayBatchAffectedTokenIds = (
  value: unknown,
  options: LivePlayBatchAffectedTokenIdsOptions = {},
): LivePlayBatchValidationResult<readonly string[]> => {
  const path = options.path ?? 'payload.tokenIds'
  const duplicatePolicy = options.duplicatePolicy ?? 'reject'
  const tokenIdsResult = parseLivePlayBatchBoundedArray<string>(value, {
    path,
    minItems: 1,
    maxItems: options.maxIds ?? LIVE_PLAY_BATCH_MAX_AFFECTED_TOKEN_IDS,
    itemName: 'token ids',
    parseItem: (item, itemPath) => parseAffectedTokenId(item, itemPath),
  })
  if (!tokenIdsResult.valid) return failure(tokenIdsResult.issues)

  const issues: MutableIssueList = []
  const seen = new Map<string, number>()
  const uniqueTokenIds: string[] = []
  tokenIdsResult.value.forEach((tokenId, index) => {
    const firstIndex = seen.get(tokenId)
    if (firstIndex !== undefined) {
      if (duplicatePolicy === 'reject') {
        addIssue(
          issues,
          `${path}[${index}]`,
          'duplicate-token-id',
          `${path}[${index}] duplicates ${path}[${firstIndex}] for token id ${tokenId}.`,
          'unique token id',
          tokenId,
        )
      }
      return
    }
    seen.set(tokenId, index)
    uniqueTokenIds.push(tokenId)
  })

  if (issues.length > 0) return failure(issues)
  return success(uniqueTokenIds)
}
