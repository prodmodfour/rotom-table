/**
 * Bounded map-owned authoritative action economy for one encounter.
 *
 * Compatibility observations remain readable, while reviewed command paths
 * validate budgets and atomically persist spends through the cost planner.
 */
export const ENCOUNTER_ACTION_TYPES = [
  'standard',
  'shift',
  'swift',
  'free',
  'full',
  'interrupt',
  'reaction',
] as const

export const ENCOUNTER_RESOURCE_RESET_TIMINGS = [
  'scene-start',
  'scene-end',
  'round-start',
  'round-end',
  'turn-start',
  'turn-end',
  'recall',
  'send-out',
  'knockout',
  'manual',
] as const

export const ENCOUNTER_SETUP_EXECUTE_STATUSES = [
  'setting-up',
  'ready-to-execute',
] as const

export const ENCOUNTER_RESOURCE_LIMITS = Object.freeze({
  placementLedgers: 256,
  flagsPerPlacement: 64,
  identifierChars: 160,
  placementIdChars: 200,
  canonicalMoveChars: 160,
  amount: 1_000_000_000,
  round: 1_000_000,
  turn: 1_000_000,
})

export type EncounterActionType = (typeof ENCOUNTER_ACTION_TYPES)[number]
export type EncounterResourceResetTiming =
  (typeof ENCOUNTER_RESOURCE_RESET_TIMINGS)[number]
export type EncounterSetupExecuteStatus =
  (typeof ENCOUNTER_SETUP_EXECUTE_STATUSES)[number]

export interface EncounterActionResource {
  readonly type: EncounterActionType
  /** Null means the action is not numerically capped by this base ledger. */
  readonly budget: number | null
  /** Accepted spends; legacy observations may predate strict enforcement. */
  readonly spent: number
  readonly resetOn: readonly EncounterResourceResetTiming[]
}

export type EncounterActionResourceDirectory = Readonly<
  Record<EncounterActionType, EncounterActionResource>
>

export interface EncounterReactionAvailability {
  readonly available: boolean
  readonly resetOn: readonly EncounterResourceResetTiming[]
}

export interface EncounterMovementResource {
  /** Null until an authoritative movement capability has been observed. */
  readonly budget: number | null
  /** Accepted movement distance spent in the current reset window. */
  readonly spent: number
  readonly resetOn: readonly EncounterResourceResetTiming[]
}

export interface EncounterOncePerTurnFlag {
  readonly id: string
  readonly sourceOperationId: string
  readonly resetOn: readonly EncounterResourceResetTiming[]
}

export interface EncounterSetupExecuteState {
  readonly canonicalMoveId: string
  readonly resolutionId: string
  readonly sourceOperationId: string
  readonly status: EncounterSetupExecuteStatus
  readonly createdRound: number | null
  readonly createdTurn: number | null
  readonly resetOn: readonly EncounterResourceResetTiming[]
}

export interface EncounterTurnResourceLedger {
  /** Must match the owning directory key. */
  readonly placementId: string
  /** Current authoritative reset window, or null before initiative begins. */
  readonly round: number | null
  readonly turn: number | null
  readonly actions: EncounterActionResourceDirectory
  readonly reaction: EncounterReactionAvailability
  readonly movement: EncounterMovementResource
  readonly oncePerTurnFlags: readonly EncounterOncePerTurnFlag[]
  readonly setupExecute: EncounterSetupExecuteState | null
}

export type EncounterTurnResourceDirectory = Readonly<
  Record<string, EncounterTurnResourceLedger>
>

export type EncounterResourceValidationCode =
  | 'invalid-encounter-resources'
  | 'limit-exceeded'
  | 'duplicate-id'

export class EncounterResourceValidationError extends Error {
  readonly code: EncounterResourceValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: EncounterResourceValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterResourceValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const LEDGER_FIELDS = [
  'placementId',
  'round',
  'turn',
  'actions',
  'reaction',
  'movement',
  'oncePerTurnFlags',
  'setupExecute',
] as const
const ACTION_FIELDS = ['type', 'budget', 'spent', 'resetOn'] as const
const REACTION_FIELDS = ['available', 'resetOn'] as const
const MOVEMENT_FIELDS = ['budget', 'spent', 'resetOn'] as const
const FLAG_FIELDS = ['id', 'sourceOperationId', 'resetOn'] as const
const SETUP_FIELDS = [
  'canonicalMoveId',
  'resolutionId',
  'sourceOperationId',
  'status',
  'createdRound',
  'createdTurn',
  'resetOn',
] as const

const ACTION_TYPE_SET = new Set<string>(ENCOUNTER_ACTION_TYPES)
const RESET_TIMING_SET = new Set<string>(ENCOUNTER_RESOURCE_RESET_TIMINGS)
const SETUP_STATUS_SET = new Set<string>(ENCOUNTER_SETUP_EXECUTE_STATUSES)
const RESET_TIMING_ORDER = new Map<string, number>(
  ENCOUNTER_RESOURCE_RESET_TIMINGS.map((timing, index) => [timing, index]),
)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const DEFAULT_ACTION_POLICY: Readonly<Record<
  EncounterActionType,
  Pick<EncounterActionResource, 'budget' | 'resetOn'>
>> = Object.freeze({
  standard: Object.freeze({ budget: 1, resetOn: Object.freeze(['turn-start'] as const) }),
  shift: Object.freeze({ budget: 1, resetOn: Object.freeze(['turn-start'] as const) }),
  swift: Object.freeze({ budget: 1, resetOn: Object.freeze(['round-start'] as const) }),
  free: Object.freeze({ budget: null, resetOn: Object.freeze(['turn-start'] as const) }),
  full: Object.freeze({ budget: 1, resetOn: Object.freeze(['turn-start'] as const) }),
  interrupt: Object.freeze({ budget: 1, resetOn: Object.freeze(['round-start'] as const) }),
  reaction: Object.freeze({ budget: 1, resetOn: Object.freeze(['round-start'] as const) }),
})

const fail = (
  code: EncounterResourceValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterResourceValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-resources', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-encounter-resources',
    path,
    `must contain exactly the supported fields (${details}).`,
  )
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactFields(record, fields, path)
  return record
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximum: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-resources',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path, ENCOUNTER_RESOURCE_LIMITS.identifierChars)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-encounter-resources', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parsePlacementId = (value: unknown, path: string): string => (
  parseBoundedText(value, path, ENCOUNTER_RESOURCE_LIMITS.placementIdChars)
)

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-encounter-resources', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseNullableInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | null => value === null
  ? null
  : parseInteger(value, path, minimum, maximum)

const parseResetTimings = (
  value: unknown,
  path: string,
): readonly EncounterResourceResetTiming[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return fail(
      'invalid-encounter-resources',
      path,
      'must be a non-empty array of reset timings.',
    )
  }
  if (value.length > ENCOUNTER_RESOURCE_RESET_TIMINGS.length) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${ENCOUNTER_RESOURCE_RESET_TIMINGS.length} entries.`,
    )
  }
  const timings = value.map((entry, index) => {
    if (typeof entry !== 'string' || !RESET_TIMING_SET.has(entry)) {
      return fail(
        'invalid-encounter-resources',
        `${path}[${index}]`,
        'must be a supported encounter-resource reset timing.',
      )
    }
    return entry as EncounterResourceResetTiming
  })
  if (new Set(timings).size !== timings.length) {
    fail('duplicate-id', path, 'must not contain duplicate reset timings.')
  }
  return [...timings].sort((left, right) => (
    (RESET_TIMING_ORDER.get(left) ?? 0) - (RESET_TIMING_ORDER.get(right) ?? 0)
  ))
}

const parseAction = (
  value: unknown,
  expectedType: EncounterActionType,
  path: string,
): EncounterActionResource => {
  const action = parseExactRecord(value, ACTION_FIELDS, path)
  if (action.type !== expectedType) {
    fail('invalid-encounter-resources', `${path}.type`, `must match directory key ${expectedType}.`)
  }
  return {
    type: expectedType,
    budget: parseNullableInteger(
      action.budget,
      `${path}.budget`,
      0,
      ENCOUNTER_RESOURCE_LIMITS.amount,
    ),
    spent: parseInteger(
      action.spent,
      `${path}.spent`,
      0,
      ENCOUNTER_RESOURCE_LIMITS.amount,
    ),
    resetOn: parseResetTimings(action.resetOn, `${path}.resetOn`),
  }
}

const parseActions = (
  value: unknown,
  path: string,
): EncounterActionResourceDirectory => {
  const actions = parseRecord(value, path)
  const keys = Object.keys(actions)
  const missing = ENCOUNTER_ACTION_TYPES.filter(type => !Object.prototype.hasOwnProperty.call(actions, type))
  const unknown = keys.filter(type => !ACTION_TYPE_SET.has(type))
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    fail(
      'invalid-encounter-resources',
      path,
      `must contain every supported action type exactly once (${details}).`,
    )
  }
  return Object.fromEntries(ENCOUNTER_ACTION_TYPES.map(type => [
    type,
    parseAction(actions[type], type, `${path}.${type}`),
  ])) as unknown as EncounterActionResourceDirectory
}

const parseReaction = (
  value: unknown,
  path: string,
): EncounterReactionAvailability => {
  const reaction = parseExactRecord(value, REACTION_FIELDS, path)
  if (typeof reaction.available !== 'boolean') {
    fail('invalid-encounter-resources', `${path}.available`, 'must be boolean.')
  }
  return {
    available: reaction.available as boolean,
    resetOn: parseResetTimings(reaction.resetOn, `${path}.resetOn`),
  }
}

const parseMovement = (
  value: unknown,
  path: string,
): EncounterMovementResource => {
  const movement = parseExactRecord(value, MOVEMENT_FIELDS, path)
  return {
    budget: parseNullableInteger(
      movement.budget,
      `${path}.budget`,
      0,
      ENCOUNTER_RESOURCE_LIMITS.amount,
    ),
    spent: parseInteger(
      movement.spent,
      `${path}.spent`,
      0,
      ENCOUNTER_RESOURCE_LIMITS.amount,
    ),
    resetOn: parseResetTimings(movement.resetOn, `${path}.resetOn`),
  }
}

const parseFlag = (
  value: unknown,
  path: string,
): EncounterOncePerTurnFlag => {
  const flag = parseExactRecord(value, FLAG_FIELDS, path)
  return {
    id: parseStableId(flag.id, `${path}.id`),
    sourceOperationId: parseBoundedText(
      flag.sourceOperationId,
      `${path}.sourceOperationId`,
      ENCOUNTER_RESOURCE_LIMITS.identifierChars,
    ),
    resetOn: parseResetTimings(flag.resetOn, `${path}.resetOn`),
  }
}

const parseFlags = (
  value: unknown,
  path: string,
): readonly EncounterOncePerTurnFlag[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-resources', path, 'must be an array.')
  }
  if (value.length > ENCOUNTER_RESOURCE_LIMITS.flagsPerPlacement) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${ENCOUNTER_RESOURCE_LIMITS.flagsPerPlacement} entries.`,
    )
  }
  const flags = value.map((entry, index) => parseFlag(entry, `${path}[${index}]`))
  if (new Set(flags.map(flag => flag.id)).size !== flags.length) {
    fail('duplicate-id', path, 'must not contain duplicate flag IDs.')
  }
  return [...flags].sort((left, right) => left.id.localeCompare(right.id))
}

const parseSetupExecute = (
  value: unknown,
  path: string,
): EncounterSetupExecuteState | null => {
  if (value === null) return null
  const setup = parseExactRecord(value, SETUP_FIELDS, path)
  if (typeof setup.status !== 'string' || !SETUP_STATUS_SET.has(setup.status)) {
    fail(
      'invalid-encounter-resources',
      `${path}.status`,
      'must be setting-up or ready-to-execute.',
    )
  }
  const createdRound = parseNullableInteger(
    setup.createdRound,
    `${path}.createdRound`,
    1,
    ENCOUNTER_RESOURCE_LIMITS.round,
  )
  const createdTurn = parseNullableInteger(
    setup.createdTurn,
    `${path}.createdTurn`,
    0,
    ENCOUNTER_RESOURCE_LIMITS.turn,
  )
  if (createdTurn !== null && createdRound === null) {
    fail(
      'invalid-encounter-resources',
      `${path}.createdTurn`,
      'requires a non-null createdRound.',
    )
  }
  return {
    canonicalMoveId: parseBoundedText(
      setup.canonicalMoveId,
      `${path}.canonicalMoveId`,
      ENCOUNTER_RESOURCE_LIMITS.canonicalMoveChars,
    ),
    resolutionId: parseBoundedText(
      setup.resolutionId,
      `${path}.resolutionId`,
      ENCOUNTER_RESOURCE_LIMITS.identifierChars,
    ),
    sourceOperationId: parseBoundedText(
      setup.sourceOperationId,
      `${path}.sourceOperationId`,
      ENCOUNTER_RESOURCE_LIMITS.identifierChars,
    ),
    status: setup.status as EncounterSetupExecuteStatus,
    createdRound,
    createdTurn,
    resetOn: parseResetTimings(setup.resetOn, `${path}.resetOn`),
  }
}

const parseLedger = (
  value: unknown,
  directoryPlacementId: string,
  path: string,
): EncounterTurnResourceLedger => {
  const ledger = parseExactRecord(value, LEDGER_FIELDS, path)
  const placementId = parsePlacementId(ledger.placementId, `${path}.placementId`)
  if (placementId !== directoryPlacementId) {
    fail(
      'invalid-encounter-resources',
      `${path}.placementId`,
      `must match directory key ${directoryPlacementId}.`,
    )
  }
  const round = parseNullableInteger(
    ledger.round,
    `${path}.round`,
    1,
    ENCOUNTER_RESOURCE_LIMITS.round,
  )
  const turn = parseNullableInteger(
    ledger.turn,
    `${path}.turn`,
    0,
    ENCOUNTER_RESOURCE_LIMITS.turn,
  )
  if (turn !== null && round === null) {
    fail('invalid-encounter-resources', `${path}.turn`, 'requires a non-null round.')
  }
  return {
    placementId,
    round,
    turn,
    actions: parseActions(ledger.actions, `${path}.actions`),
    reaction: parseReaction(ledger.reaction, `${path}.reaction`),
    movement: parseMovement(ledger.movement, `${path}.movement`),
    oncePerTurnFlags: parseFlags(
      ledger.oncePerTurnFlags,
      `${path}.oncePerTurnFlags`,
    ),
    setupExecute: parseSetupExecute(ledger.setupExecute, `${path}.setupExecute`),
  }
}

const createDefaultActionResources = (): EncounterActionResourceDirectory => (
  Object.fromEntries(ENCOUNTER_ACTION_TYPES.map(type => [
    type,
    {
      type,
      budget: DEFAULT_ACTION_POLICY[type].budget,
      spent: 0,
      resetOn: [...DEFAULT_ACTION_POLICY[type].resetOn],
    },
  ])) as unknown as EncounterActionResourceDirectory
)

export const createEmptyEncounterTurnResources = (): EncounterTurnResourceDirectory => ({})

export const createEncounterTurnResourceLedger = (input: {
  readonly placementId: string
  readonly round?: number | null
  readonly turn?: number | null
  readonly movementBudget?: number | null
}): EncounterTurnResourceLedger => parseLedger({
  placementId: input.placementId,
  round: input.round ?? null,
  turn: input.turn ?? null,
  actions: createDefaultActionResources(),
  reaction: { available: true, resetOn: ['round-start'] },
  movement: {
    budget: input.movementBudget ?? null,
    spent: 0,
    resetOn: ['turn-start'],
  },
  oncePerTurnFlags: [],
  setupExecute: null,
}, input.placementId, 'encounterTurnResourceLedger')

/** Parse, detach, bound, and canonically order a placement-ledger directory. */
export const parseEncounterTurnResources = (
  value: unknown,
  path = 'encounterState.turnResources',
): EncounterTurnResourceDirectory => {
  const directory = parseRecord(value, path)
  const placementIds = Object.keys(directory)
  if (placementIds.length > ENCOUNTER_RESOURCE_LIMITS.placementLedgers) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${ENCOUNTER_RESOURCE_LIMITS.placementLedgers} placement ledgers.`,
    )
  }

  const resources: Record<string, EncounterTurnResourceLedger> = {}
  for (const placementId of placementIds.sort((left, right) => left.localeCompare(right))) {
    parsePlacementId(placementId, `${path}.${placementId}`)
    resources[placementId] = parseLedger(
      directory[placementId],
      placementId,
      `${path}.${placementId}`,
    )
  }
  return resources
}
