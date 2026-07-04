import type {
  MapHazardKind,
  MapHazardV2,
  MapRoomKind,
  MapTerrainKind,
  MapVoxelV2,
  MapWeatherKind,
} from '~/types/map'

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
  'invalid-action',
  'invalid-kind',
  'duplicate-kind',
  'invalid-array',
  'empty-array',
  'too-many-items',
  'invalid-cell',
  'invalid-voxel',
  'invalid-material-id',
  'invalid-color',
  'invalid-layer',
  'invalid-owner',
  'invalid-boolean',
  'invalid-tags',
  'duplicate-cell',
  'contradictory-cell-operation',
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

export const LIVE_PLAY_EDIT_HAZARD_ACTIONS = ['upsert', 'remove'] as const
export type EditHazardAction = (typeof LIVE_PLAY_EDIT_HAZARD_ACTIONS)[number]

export interface EditHazardUpsertOperation {
  readonly action: 'upsert'
  readonly hazard: MapHazardV2
}

export interface EditHazardRemoveCell extends LivePlayBatchGridCell {
  readonly kind?: MapHazardKind
}

export interface EditHazardRemoveOperation {
  readonly action: 'remove'
  readonly cell: EditHazardRemoveCell
}

export type EditHazardOperation = EditHazardUpsertOperation | EditHazardRemoveOperation

export interface EditHazardsPayload {
  readonly operations: readonly EditHazardOperation[]
}

export const LIVE_PLAY_FIELD_EFFECT_CATEGORIES = ['weather', 'terrain', 'room'] as const
export type LivePlayFieldEffectCategory = (typeof LIVE_PLAY_FIELD_EFFECT_CATEGORIES)[number]

export const LIVE_PLAY_CLEAR_FIELD_EFFECT_CATEGORIES = [
  ...LIVE_PLAY_FIELD_EFFECT_CATEGORIES,
  'all',
] as const
export type ClearFieldEffectsCategory = (typeof LIVE_PLAY_CLEAR_FIELD_EFFECT_CATEGORIES)[number]

export type LivePlayFieldEffectKind = MapWeatherKind | MapTerrainKind | MapRoomKind

export const LIVE_PLAY_WEATHER_KIND_VALUES = [
  'sunny',
  'rainy',
  'hail',
  'sandstorm',
] as const satisfies readonly MapWeatherKind[]

export const LIVE_PLAY_TERRAIN_KIND_VALUES = [
  'electric',
  'grassy',
  'misty',
  'psychic',
] as const satisfies readonly MapTerrainKind[]

export const LIVE_PLAY_ROOM_KIND_VALUES = [
  'magic',
  'trick',
  'wonder',
] as const satisfies readonly MapRoomKind[]

export const LIVE_PLAY_FIELD_EFFECT_KIND_VALUES = [
  ...LIVE_PLAY_WEATHER_KIND_VALUES,
  ...LIVE_PLAY_TERRAIN_KIND_VALUES,
  ...LIVE_PLAY_ROOM_KIND_VALUES,
] as const satisfies readonly LivePlayFieldEffectKind[]

export interface ClearFieldEffectsAllPayload {
  readonly category: 'all'
}

export interface ClearWeatherEffectsPayload {
  readonly category: 'weather'
  readonly kinds?: readonly MapWeatherKind[]
}

export interface ClearTerrainEffectsPayload {
  readonly category: 'terrain'
  readonly kinds?: readonly MapTerrainKind[]
}

export interface ClearRoomEffectsPayload {
  readonly category: 'room'
  readonly kinds?: readonly MapRoomKind[]
}

export type ClearFieldEffectsPayload =
  | ClearFieldEffectsAllPayload
  | ClearWeatherEffectsPayload
  | ClearTerrainEffectsPayload
  | ClearRoomEffectsPayload

export const LIVE_PLAY_EDIT_TERRAIN_VOXEL_ACTIONS = ['upsert', 'remove'] as const
export type EditTerrainVoxelAction = (typeof LIVE_PLAY_EDIT_TERRAIN_VOXEL_ACTIONS)[number]

export interface EditTerrainVoxelUpsertOperation {
  readonly action: 'upsert'
  readonly voxel: MapVoxelV2
}

export interface EditTerrainVoxelRemoveOperation {
  readonly action: 'remove'
  readonly cell: LivePlayBatchGridCell
}

export type EditTerrainVoxelOperation =
  | EditTerrainVoxelUpsertOperation
  | EditTerrainVoxelRemoveOperation

export interface EditTerrainVoxelsPayload {
  readonly operations: readonly EditTerrainVoxelOperation[]
}

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
const EXPECTED_BOOLEAN = 'boolean'
const EXPECTED_TAGS = 'array of non-empty strings'

const BATCH_VALIDATION_CODE_SET = new Set<unknown>(LIVE_PLAY_BATCH_VALIDATION_CODES)
const LIVE_PLAY_CLEAR_HAZARDS_MODE_SET = new Set<unknown>(LIVE_PLAY_CLEAR_HAZARDS_MODES)
const LIVE_PLAY_HAZARD_KIND_SET = new Set<unknown>(LIVE_PLAY_HAZARD_KIND_VALUES)
const LIVE_PLAY_EDIT_HAZARD_ACTION_SET = new Set<unknown>(LIVE_PLAY_EDIT_HAZARD_ACTIONS)
const LIVE_PLAY_FIELD_EFFECT_CATEGORY_SET = new Set<unknown>(LIVE_PLAY_FIELD_EFFECT_CATEGORIES)
const LIVE_PLAY_CLEAR_FIELD_EFFECT_CATEGORY_SET = new Set<unknown>(LIVE_PLAY_CLEAR_FIELD_EFFECT_CATEGORIES)
const LIVE_PLAY_FIELD_EFFECT_KIND_SET = new Set<unknown>(LIVE_PLAY_FIELD_EFFECT_KIND_VALUES)
const LIVE_PLAY_EDIT_TERRAIN_VOXEL_ACTION_SET = new Set<unknown>(LIVE_PLAY_EDIT_TERRAIN_VOXEL_ACTIONS)
const LIVE_PLAY_WEATHER_KIND_SET = new Set<unknown>(LIVE_PLAY_WEATHER_KIND_VALUES)
const LIVE_PLAY_TERRAIN_KIND_SET = new Set<unknown>(LIVE_PLAY_TERRAIN_KIND_VALUES)
const LIVE_PLAY_ROOM_KIND_SET = new Set<unknown>(LIVE_PLAY_ROOM_KIND_VALUES)
const GRID_CELL_FIELDS = ['x', 'y', 'z'] as const
const HAZARD_FIELDS = ['kind', 'x', 'y', 'z', 'layer', 'owner'] as const
const HAZARD_REMOVE_CELL_FIELDS = ['x', 'y', 'z', 'kind'] as const
const TERRAIN_VOXEL_FIELDS = [
  'x',
  'y',
  'z',
  'materialId',
  'color',
  'ghost',
  'blocksMovement',
  'blocksSight',
  'tags',
] as const
const CLEAR_HAZARDS_PAYLOAD_FIELDS = ['mode', 'cells', 'kind'] as const
const EDIT_HAZARDS_PAYLOAD_FIELDS = ['operations'] as const
const EDIT_HAZARD_OPERATION_FIELDS = ['action', 'hazard', 'cell'] as const
const CLEAR_FIELD_EFFECTS_PAYLOAD_FIELDS = ['category', 'kinds'] as const
const EDIT_TERRAIN_VOXELS_PAYLOAD_FIELDS = ['operations'] as const
const EDIT_TERRAIN_VOXEL_OPERATION_FIELDS = ['action', 'voxel', 'cell'] as const

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

export const isEditHazardAction = (value: unknown): value is EditHazardAction =>
  LIVE_PLAY_EDIT_HAZARD_ACTION_SET.has(value)

export const isLivePlayFieldEffectCategory = (
  value: unknown,
): value is LivePlayFieldEffectCategory => LIVE_PLAY_FIELD_EFFECT_CATEGORY_SET.has(value)

export const isClearFieldEffectsCategory = (
  value: unknown,
): value is ClearFieldEffectsCategory => LIVE_PLAY_CLEAR_FIELD_EFFECT_CATEGORY_SET.has(value)

export const isLivePlayFieldEffectKind = (
  value: unknown,
): value is LivePlayFieldEffectKind => LIVE_PLAY_FIELD_EFFECT_KIND_SET.has(value)

export const isEditTerrainVoxelAction = (value: unknown): value is EditTerrainVoxelAction =>
  LIVE_PLAY_EDIT_TERRAIN_VOXEL_ACTION_SET.has(value)

export const isLivePlayFieldEffectKindForCategory = (
  category: LivePlayFieldEffectCategory,
  value: unknown,
): value is LivePlayFieldEffectKind => {
  if (category === 'weather') return LIVE_PLAY_WEATHER_KIND_SET.has(value)
  if (category === 'terrain') return LIVE_PLAY_TERRAIN_KIND_SET.has(value)
  return LIVE_PLAY_ROOM_KIND_SET.has(value)
}

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

const parseOptionalHazardLayer = (
  kind: MapHazardKind,
  record: Readonly<Record<string, unknown>>,
  path: string,
): LivePlayBatchValidationResult<number | undefined> => {
  if (kind !== 'toxic-spikes') return success(undefined)
  if (!hasOwn(record, 'layer') || record.layer === undefined) return success(1)
  if (typeof record.layer === 'number' && Number.isSafeInteger(record.layer) && record.layer >= 1 && record.layer <= 2) {
    return success(record.layer)
  }
  return failure([{
    path,
    code: 'invalid-layer',
    message: `${path} must be 1 or 2 for toxic-spikes hazards.`,
    expected: '1 | 2',
    received: describeReceived(record.layer),
  }])
}

const parseOptionalHazardOwner = (
  record: Readonly<Record<string, unknown>>,
  path: string,
): LivePlayBatchValidationResult<string | undefined> => {
  if (!hasOwn(record, 'owner') || record.owner === undefined) return success(undefined)
  if (isNonEmptyString(record.owner)) return success(record.owner.trim())
  return failure([{
    path,
    code: 'invalid-owner',
    message: `${path} must be a non-empty hazard owner string when provided.`,
    expected: EXPECTED_NON_EMPTY_STRING,
    received: describeReceived(record.owner),
  }])
}

export const parseLivePlayBatchHazard = (
  value: unknown,
  path = 'payload.hazard',
): LivePlayBatchValidationResult<MapHazardV2> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: HAZARD_FIELDS,
    requiredFields: ['kind', 'x', 'y', 'z'],
    description: 'hazard cell',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  const kindResult = parseClearHazardsKind(record.kind, appendPath(path, 'kind'))
  const cellResult = parseLivePlayBatchGridCell({ x: record.x, y: record.y, z: record.z }, path)
  if (!kindResult.valid || !cellResult.valid) {
    return failure([
      ...(kindResult.valid ? [] : kindResult.issues),
      ...(cellResult.valid ? [] : cellResult.issues),
    ])
  }

  const layerResult = parseOptionalHazardLayer(kindResult.value, record, appendPath(path, 'layer'))
  const ownerResult = parseOptionalHazardOwner(record, appendPath(path, 'owner'))
  if (!layerResult.valid || !ownerResult.valid) {
    return failure([
      ...(layerResult.valid ? [] : layerResult.issues),
      ...(ownerResult.valid ? [] : ownerResult.issues),
    ])
  }

  return success({
    kind: kindResult.value,
    ...cloneBatchGridCell(cellResult.value),
    ...(layerResult.value === undefined ? {} : { layer: layerResult.value }),
    ...(ownerResult.value === undefined ? {} : { owner: ownerResult.value }),
  })
}

const parseEditHazardRemoveCell = (
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<EditHazardRemoveCell> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: HAZARD_REMOVE_CELL_FIELDS,
    requiredFields: ['x', 'y', 'z'],
    description: 'editHazards remove cell',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  const cellResult = parseLivePlayBatchGridCell({ x: record.x, y: record.y, z: record.z }, path)
  const kindResult = parseOptionalClearHazardsKind(record, path)
  if (!cellResult.valid || !kindResult.valid) {
    return failure([
      ...(cellResult.valid ? [] : cellResult.issues),
      ...(kindResult.valid ? [] : kindResult.issues),
    ])
  }

  return success({
    ...cloneBatchGridCell(cellResult.value),
    ...(kindResult.value === undefined ? {} : { kind: kindResult.value }),
  })
}

const unexpectedEditHazardOperationFieldIssue = (
  path: string,
  field: 'hazard' | 'cell',
  action: EditHazardAction,
  received: unknown,
): LivePlayBatchValidationIssue => ({
  path: appendPath(path, field),
  code: 'unknown-field',
  message: `${appendPath(path, field)} is not supported for editHazards ${action} operations.`,
  expected: action === 'upsert' ? 'action | hazard' : 'action | cell',
  received: describeReceived(received),
})

const parseEditHazardOperation = (
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<EditHazardOperation> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: EDIT_HAZARD_OPERATION_FIELDS,
    requiredFields: ['action'],
    description: 'editHazards operation',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  if (!isEditHazardAction(record.action)) {
    return failure([{
      path: appendPath(path, 'action'),
      code: 'invalid-action',
      message: `${appendPath(path, 'action')} must be a supported editHazards action.`,
      expected: LIVE_PLAY_EDIT_HAZARD_ACTIONS.join(' | '),
      received: describeReceived(record.action),
    }])
  }

  if (record.action === 'upsert') {
    const issues: MutableIssueList = []
    if (!hasOwn(record, 'hazard')) {
      addIssue(
        issues,
        appendPath(path, 'hazard'),
        'missing-field',
        'editHazards upsert operations must include hazard.',
      )
    }
    if (hasOwn(record, 'cell')) {
      issues.push(unexpectedEditHazardOperationFieldIssue(path, 'cell', record.action, record.cell))
    }
    if (issues.length > 0) return failure(issues)

    const hazardResult = parseLivePlayBatchHazard(record.hazard, appendPath(path, 'hazard'))
    if (!hazardResult.valid) return failure(hazardResult.issues)
    return success({ action: record.action, hazard: hazardResult.value })
  }

  const issues: MutableIssueList = []
  if (!hasOwn(record, 'cell')) {
    addIssue(
      issues,
      appendPath(path, 'cell'),
      'missing-field',
      'editHazards remove operations must include cell.',
    )
  }
  if (hasOwn(record, 'hazard')) {
    issues.push(unexpectedEditHazardOperationFieldIssue(path, 'hazard', record.action, record.hazard))
  }
  if (issues.length > 0) return failure(issues)

  const cellResult = parseEditHazardRemoveCell(record.cell, appendPath(path, 'cell'))
  if (!cellResult.valid) return failure(cellResult.issues)
  return success({ action: record.action, cell: cellResult.value })
}

const editHazardOperationCell = (operation: EditHazardOperation): LivePlayBatchGridCell => (
  operation.action === 'upsert' ? operation.hazard : operation.cell
)

const editHazardOperationKind = (operation: EditHazardOperation): MapHazardKind | undefined => (
  operation.action === 'upsert' ? operation.hazard.kind : operation.cell.kind
)

const editHazardOperationRemovesWholeCell = (operation: EditHazardOperation): boolean => (
  operation.action === 'remove' && operation.cell.kind === undefined
)

const hazardOperationConflictCode = (
  left: EditHazardOperation,
  right: EditHazardOperation,
): 'duplicate-cell' | 'contradictory-cell-operation' => {
  const leftWholeCell = editHazardOperationRemovesWholeCell(left)
  const rightWholeCell = editHazardOperationRemovesWholeCell(right)
  if (leftWholeCell && rightWholeCell) return 'duplicate-cell'
  if (leftWholeCell || rightWholeCell) return 'contradictory-cell-operation'
  return left.action === right.action ? 'duplicate-cell' : 'contradictory-cell-operation'
}

const enforceNonContradictoryHazardOperations = (
  operations: readonly EditHazardOperation[],
  path: string,
): LivePlayBatchValidationResult<readonly EditHazardOperation[]> => {
  const issues: MutableIssueList = []
  const seenByCell = new Map<string, { readonly index: number; readonly operation: EditHazardOperation }[]>()

  operations.forEach((operation, index) => {
    const cell = editHazardOperationCell(operation)
    const key = formatLivePlayBatchGridCellKey(cell)
    const seenAtCell = seenByCell.get(key) ?? []
    const operationKind = editHazardOperationKind(operation)
    const wholeCellRemove = editHazardOperationRemovesWholeCell(operation)
    const conflicting = seenAtCell.find((seen) => {
      if (wholeCellRemove || editHazardOperationRemovesWholeCell(seen.operation)) return true
      return operationKind !== undefined && operationKind === editHazardOperationKind(seen.operation)
    })

    if (conflicting !== undefined) {
      const code = hazardOperationConflictCode(conflicting.operation, operation)
      addIssue(
        issues,
        `${path}[${index}]`,
        code,
        code === 'duplicate-cell'
          ? `${path}[${index}] duplicates ${path}[${conflicting.index}] at hazard cell ${key}.`
          : `${path}[${index}] contradicts ${path}[${conflicting.index}] at hazard cell ${key}.`,
        code === 'duplicate-cell' ? 'unique hazard operation target' : 'only non-contradictory hazard actions per cell',
        operation,
      )
      return
    }

    seenByCell.set(key, [...seenAtCell, { index, operation }])
  })

  if (issues.length > 0) return failure(issues)
  return success([...operations])
}

export const parseEditHazardsPayload = (
  value: unknown,
  path = 'payload',
): LivePlayBatchValidationResult<EditHazardsPayload> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: EDIT_HAZARDS_PAYLOAD_FIELDS,
    requiredFields: ['operations'],
    description: 'editHazards payload',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const operationsPath = appendPath(path, 'operations')
  const operationsResult = parseLivePlayBatchBoundedArray<EditHazardOperation>(
    recordResult.value.operations,
    {
      path: operationsPath,
      minItems: 1,
      maxItems: LIVE_PLAY_BATCH_MAX_HAZARD_CELLS,
      itemName: 'hazard cell operations',
      parseItem: (item, itemPath) => parseEditHazardOperation(item, itemPath),
    },
  )
  if (!operationsResult.valid) return failure(operationsResult.issues)

  const uniqueResult = enforceNonContradictoryHazardOperations(operationsResult.value, operationsPath)
  if (!uniqueResult.valid) return failure(uniqueResult.issues)
  return success({ operations: uniqueResult.value })
}

const fieldEffectKindLabel = (category: LivePlayFieldEffectCategory): string => {
  if (category === 'weather') return 'weather'
  if (category === 'terrain') return 'terrain'
  return 'room'
}

const fieldEffectKindValuesForCategory = (
  category: LivePlayFieldEffectCategory,
): readonly LivePlayFieldEffectKind[] => {
  if (category === 'weather') return LIVE_PLAY_WEATHER_KIND_VALUES
  if (category === 'terrain') return LIVE_PLAY_TERRAIN_KIND_VALUES
  return LIVE_PLAY_ROOM_KIND_VALUES
}

const unexpectedClearFieldEffectsCategoryFieldIssue = (
  path: string,
  field: string,
  category: ClearFieldEffectsCategory,
  received: unknown,
): LivePlayBatchValidationIssue => ({
  path: appendPath(path, field),
  code: 'unknown-field',
  message: `${appendPath(path, field)} is not supported for clearFieldEffects ${category} category.`,
  expected: 'category',
  received: describeReceived(received),
})

const parseClearFieldEffectsKind = (
  category: LivePlayFieldEffectCategory,
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<LivePlayFieldEffectKind> => {
  if (isLivePlayFieldEffectKindForCategory(category, value)) return success(value)
  return failure([{
    path,
    code: 'invalid-kind',
    message: `${path} must be a supported ${fieldEffectKindLabel(category)} effect kind.`,
    expected: fieldEffectKindValuesForCategory(category).join(' | '),
    received: describeReceived(value),
  }])
}

const parseClearFieldEffectsKinds = (
  category: LivePlayFieldEffectCategory,
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<readonly LivePlayFieldEffectKind[]> => {
  const kindsResult = parseLivePlayBatchBoundedArray<LivePlayFieldEffectKind>(value, {
    path,
    minItems: 1,
    maxItems: LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS,
    itemName: `${fieldEffectKindLabel(category)} effect kinds`,
    parseItem: (item, itemPath) => parseClearFieldEffectsKind(category, item, itemPath),
  })
  if (!kindsResult.valid) return failure(kindsResult.issues)

  const issues: MutableIssueList = []
  const seen = new Map<string, number>()
  const uniqueKinds: LivePlayFieldEffectKind[] = []

  kindsResult.value.forEach((kind, index) => {
    const firstIndex = seen.get(kind)
    if (firstIndex !== undefined) {
      addIssue(
        issues,
        `${path}[${index}]`,
        'duplicate-kind',
        `${path}[${index}] duplicates ${path}[${firstIndex}] for ${fieldEffectKindLabel(category)} effect kind ${kind}.`,
        'unique field-effect kind',
        kind,
      )
      return
    }
    seen.set(kind, index)
    uniqueKinds.push(kind)
  })

  if (issues.length > 0) return failure(issues)
  return success(uniqueKinds)
}

export const parseClearFieldEffectsPayload = (
  value: unknown,
  path = 'payload',
): LivePlayBatchValidationResult<ClearFieldEffectsPayload> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: CLEAR_FIELD_EFFECTS_PAYLOAD_FIELDS,
    requiredFields: ['category'],
    description: 'clearFieldEffects payload',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  const category = record.category
  if (!isClearFieldEffectsCategory(category)) {
    return failure([{
      path: appendPath(path, 'category'),
      code: 'invalid-mode',
      message: `${appendPath(path, 'category')} must be a supported clearFieldEffects category.`,
      expected: LIVE_PLAY_CLEAR_FIELD_EFFECT_CATEGORIES.join(' | '),
      received: describeReceived(category),
    }])
  }

  if (category === 'all') {
    if (hasOwn(record, 'kinds')) {
      return failure([unexpectedClearFieldEffectsCategoryFieldIssue(path, 'kinds', category, record.kinds)])
    }
    return success({ category })
  }

  if (!hasOwn(record, 'kinds')) return success({ category }) as LivePlayBatchValidationResult<ClearFieldEffectsPayload>

  const kindsResult = parseClearFieldEffectsKinds(category, record.kinds, appendPath(path, 'kinds'))
  if (!kindsResult.valid) return failure(kindsResult.issues)

  return success({ category, kinds: kindsResult.value } as ClearFieldEffectsPayload)
}

const cloneBatchGridCell = (cell: LivePlayBatchGridCell): LivePlayBatchGridCell => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const parseTerrainVoxelMaterialId = (
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<string> => {
  if (isNonEmptyString(value)) return success(value.trim())
  return failure([{
    path,
    code: 'invalid-material-id',
    message: `${path} must be a non-empty terrain material id string.`,
    expected: EXPECTED_NON_EMPTY_STRING,
    received: describeReceived(value),
  }])
}

const parseOptionalTerrainVoxelColor = (
  record: Readonly<Record<string, unknown>>,
  path: string,
): LivePlayBatchValidationResult<string | undefined> => {
  if (!hasOwn(record, 'color') || record.color === undefined) return success(undefined)
  if (isNonEmptyString(record.color)) return success(record.color.trim())
  return failure([{
    path,
    code: 'invalid-color',
    message: `${path} must be a non-empty color string when provided.`,
    expected: EXPECTED_NON_EMPTY_STRING,
    received: describeReceived(record.color),
  }])
}

const parseOptionalTerrainVoxelBoolean = (
  record: Readonly<Record<string, unknown>>,
  field: 'ghost' | 'blocksMovement' | 'blocksSight',
  path: string,
): LivePlayBatchValidationResult<boolean | undefined> => {
  if (!hasOwn(record, field) || record[field] === undefined) return success(undefined)
  if (typeof record[field] === 'boolean') return success(record[field])
  return failure([{
    path,
    code: 'invalid-boolean',
    message: `${path} must be a boolean when provided.`,
    expected: EXPECTED_BOOLEAN,
    received: describeReceived(record[field]),
  }])
}

const parseOptionalTerrainVoxelTags = (
  record: Readonly<Record<string, unknown>>,
  path: string,
): LivePlayBatchValidationResult<readonly string[] | undefined> => {
  if (!hasOwn(record, 'tags') || record.tags === undefined) return success(undefined)
  if (!Array.isArray(record.tags)) {
    return failure([{
      path,
      code: 'invalid-tags',
      message: `${path} must be an array of non-empty strings when provided.`,
      expected: EXPECTED_TAGS,
      received: describeReceived(record.tags),
    }])
  }

  const issues: MutableIssueList = []
  const tags: string[] = []
  record.tags.forEach((tag, index) => {
    if (!isNonEmptyString(tag)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        'invalid-tags',
        `${path}[${index}] must be a non-empty string.`,
        EXPECTED_NON_EMPTY_STRING,
        tag,
      )
      return
    }
    tags.push(tag.trim())
  })

  if (issues.length > 0) return failure(issues)
  return success(tags)
}

export const parseLivePlayBatchTerrainVoxel = (
  value: unknown,
  path = 'payload.voxel',
): LivePlayBatchValidationResult<MapVoxelV2> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: TERRAIN_VOXEL_FIELDS,
    requiredFields: ['x', 'y', 'z', 'materialId'],
    description: 'terrain voxel',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  const cellResult = parseLivePlayBatchGridCell({
    x: record.x,
    y: record.y,
    z: record.z,
  }, path)
  const materialIdResult = parseTerrainVoxelMaterialId(record.materialId, appendPath(path, 'materialId'))
  const colorResult = parseOptionalTerrainVoxelColor(record, appendPath(path, 'color'))
  const ghostResult = parseOptionalTerrainVoxelBoolean(record, 'ghost', appendPath(path, 'ghost'))
  const blocksMovementResult = parseOptionalTerrainVoxelBoolean(
    record,
    'blocksMovement',
    appendPath(path, 'blocksMovement'),
  )
  const blocksSightResult = parseOptionalTerrainVoxelBoolean(
    record,
    'blocksSight',
    appendPath(path, 'blocksSight'),
  )
  const tagsResult = parseOptionalTerrainVoxelTags(record, appendPath(path, 'tags'))

  if (
    !cellResult.valid ||
    !materialIdResult.valid ||
    !colorResult.valid ||
    !ghostResult.valid ||
    !blocksMovementResult.valid ||
    !blocksSightResult.valid ||
    !tagsResult.valid
  ) {
    return failure([
      ...(cellResult.valid ? [] : cellResult.issues),
      ...(materialIdResult.valid ? [] : materialIdResult.issues),
      ...(colorResult.valid ? [] : colorResult.issues),
      ...(ghostResult.valid ? [] : ghostResult.issues),
      ...(blocksMovementResult.valid ? [] : blocksMovementResult.issues),
      ...(blocksSightResult.valid ? [] : blocksSightResult.issues),
      ...(tagsResult.valid ? [] : tagsResult.issues),
    ])
  }

  return success({
    ...cloneBatchGridCell(cellResult.value),
    materialId: materialIdResult.value,
    ...(colorResult.value === undefined ? {} : { color: colorResult.value }),
    ...(ghostResult.value === undefined ? {} : { ghost: ghostResult.value }),
    ...(blocksMovementResult.value === undefined ? {} : { blocksMovement: blocksMovementResult.value }),
    ...(blocksSightResult.value === undefined ? {} : { blocksSight: blocksSightResult.value }),
    ...(tagsResult.value === undefined ? {} : { tags: [...tagsResult.value] }),
  })
}

const unexpectedEditTerrainOperationFieldIssue = (
  path: string,
  field: 'voxel' | 'cell',
  action: EditTerrainVoxelAction,
  received: unknown,
): LivePlayBatchValidationIssue => ({
  path: appendPath(path, field),
  code: 'unknown-field',
  message: `${appendPath(path, field)} is not supported for editTerrainVoxels ${action} operations.`,
  expected: action === 'upsert' ? 'action | voxel' : 'action | cell',
  received: describeReceived(received),
})

const parseEditTerrainVoxelOperation = (
  value: unknown,
  path: string,
): LivePlayBatchValidationResult<EditTerrainVoxelOperation> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: EDIT_TERRAIN_VOXEL_OPERATION_FIELDS,
    requiredFields: ['action'],
    description: 'editTerrainVoxels operation',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const record = recordResult.value
  if (!isEditTerrainVoxelAction(record.action)) {
    return failure([{
      path: appendPath(path, 'action'),
      code: 'invalid-action',
      message: `${appendPath(path, 'action')} must be a supported editTerrainVoxels action.`,
      expected: LIVE_PLAY_EDIT_TERRAIN_VOXEL_ACTIONS.join(' | '),
      received: describeReceived(record.action),
    }])
  }

  if (record.action === 'upsert') {
    const issues: MutableIssueList = []
    if (!hasOwn(record, 'voxel')) {
      addIssue(
        issues,
        appendPath(path, 'voxel'),
        'missing-field',
        'editTerrainVoxels upsert operations must include voxel.',
      )
    }
    if (hasOwn(record, 'cell')) {
      issues.push(unexpectedEditTerrainOperationFieldIssue(path, 'cell', record.action, record.cell))
    }
    if (issues.length > 0) return failure(issues)

    const voxelResult = parseLivePlayBatchTerrainVoxel(record.voxel, appendPath(path, 'voxel'))
    if (!voxelResult.valid) return failure(voxelResult.issues)
    return success({ action: record.action, voxel: voxelResult.value })
  }

  const issues: MutableIssueList = []
  if (!hasOwn(record, 'cell')) {
    addIssue(
      issues,
      appendPath(path, 'cell'),
      'missing-field',
      'editTerrainVoxels remove operations must include cell.',
    )
  }
  if (hasOwn(record, 'voxel')) {
    issues.push(unexpectedEditTerrainOperationFieldIssue(path, 'voxel', record.action, record.voxel))
  }
  if (issues.length > 0) return failure(issues)

  const cellResult = parseLivePlayBatchGridCell(record.cell, appendPath(path, 'cell'))
  if (!cellResult.valid) return failure(cellResult.issues)
  return success({ action: record.action, cell: cloneBatchGridCell(cellResult.value) })
}

const editTerrainOperationCell = (operation: EditTerrainVoxelOperation): LivePlayBatchGridCell => (
  operation.action === 'upsert' ? operation.voxel : operation.cell
)

const enforceNonContradictoryTerrainOperations = (
  operations: readonly EditTerrainVoxelOperation[],
  path: string,
): LivePlayBatchValidationResult<readonly EditTerrainVoxelOperation[]> => {
  const issues: MutableIssueList = []
  const seen = new Map<string, { readonly index: number; readonly action: EditTerrainVoxelAction }>()

  operations.forEach((operation, index) => {
    const key = formatLivePlayBatchGridCellKey(editTerrainOperationCell(operation))
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, { index, action: operation.action })
      return
    }

    const sameAction = first.action === operation.action
    addIssue(
      issues,
      `${path}[${index}]`,
      sameAction ? 'duplicate-cell' : 'contradictory-cell-operation',
      sameAction
        ? `${path}[${index}] duplicates ${path}[${first.index}] at terrain cell ${key}.`
        : `${path}[${index}] contradicts ${path}[${first.index}] at terrain cell ${key}.`,
      sameAction ? 'unique terrain operation cell' : 'only one terrain action per cell',
      operation,
    )
  })

  if (issues.length > 0) return failure(issues)
  return success([...operations])
}

export const parseEditTerrainVoxelsPayload = (
  value: unknown,
  path = 'payload',
): LivePlayBatchValidationResult<EditTerrainVoxelsPayload> => {
  const recordResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: EDIT_TERRAIN_VOXELS_PAYLOAD_FIELDS,
    requiredFields: ['operations'],
    description: 'editTerrainVoxels payload',
  })
  if (!recordResult.valid) return failure(recordResult.issues)

  const operationsPath = appendPath(path, 'operations')
  const operationsResult = parseLivePlayBatchBoundedArray<EditTerrainVoxelOperation>(
    recordResult.value.operations,
    {
      path: operationsPath,
      minItems: 1,
      maxItems: LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
      itemName: 'terrain voxel operations',
      parseItem: (item, itemPath) => parseEditTerrainVoxelOperation(item, itemPath),
    },
  )
  if (!operationsResult.valid) return failure(operationsResult.issues)

  const uniqueResult = enforceNonContradictoryTerrainOperations(operationsResult.value, operationsPath)
  if (!uniqueResult.valid) return failure(uniqueResult.issues)
  return success({ operations: uniqueResult.value })
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
