import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_TIMING_LEDGER_SCHEMA_VERSION = 1 as const
export const ABILITY_TIMING_LIMITS = Object.freeze({
  usesPerWindow: 512,
  cooldowns: 512,
  receipts: 2_048,
  identifierLength: 200,
  canonicalIdLength: 160,
  usesPerConstraint: 10,
  sequence: 10_000_000,
  cooldownDelay: 10_000,
})

export type AbilityTimingWindowKind = 'round' | 'turn'
export type AbilityCooldownUnit = AbilityTimingWindowKind

export interface AbilityTimingIdentity {
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly constraintId: string
}

export interface AbilityTimingUse extends AbilityTimingIdentity {
  readonly limit: number
  readonly spent: number
}

export interface AbilityTimingWindow {
  readonly windowId: string | null
  readonly sequence: number | null
  readonly uses: readonly AbilityTimingUse[]
}

export interface AbilityCooldown extends AbilityTimingIdentity {
  readonly unit: AbilityCooldownUnit
  readonly readySequence: number
}

export interface AbilityTimingReceipt extends AbilityTimingIdentity {
  readonly operationId: string
  readonly kind: 'round' | 'turn' | 'cooldown'
  readonly spentAtSequence: number
  readonly spent: number | null
  readonly limit: number | null
  readonly readySequence: number | null
}

export interface AbilityTimingLedger {
  readonly schemaVersion: typeof ABILITY_TIMING_LEDGER_SCHEMA_VERSION
  readonly sceneId: string | null
  readonly round: AbilityTimingWindow
  readonly turn: AbilityTimingWindow
  readonly cooldowns: readonly AbilityCooldown[]
  readonly receipts: readonly AbilityTimingReceipt[]
}

export interface AbilityTimingCursor {
  readonly sceneId: string
  readonly roundId: string
  readonly roundSequence: number
  readonly turnId: string | null
  readonly turnSequence: number | null
}

export type AbilityTimingValidationCode =
  | 'invalid-ledger'
  | 'invalid-cursor'
  | 'regressive-cursor'
  | 'limit-exceeded'
  | 'duplicate-resource'
  | 'duplicate-receipt'
  | 'not-json'

export class AbilityTimingValidationError extends Error {
  readonly code: AbilityTimingValidationCode
  readonly path: string

  constructor(code: AbilityTimingValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityTimingValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sceneId', 'round', 'turn', 'cooldowns', 'receipts'] as const
const WINDOW_FIELDS = ['windowId', 'sequence', 'uses'] as const
const IDENTITY_FIELDS = ['ownerId', 'abilityInstanceId', 'canonicalId', 'constraintId'] as const
const USE_FIELDS = [...IDENTITY_FIELDS, 'limit', 'spent'] as const
const COOLDOWN_FIELDS = [...IDENTITY_FIELDS, 'unit', 'readySequence'] as const
const RECEIPT_FIELDS = [
  ...IDENTITY_FIELDS,
  'operationId',
  'kind',
  'spentAtSequence',
  'spent',
  'limit',
  'readySequence',
] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const WINDOW_KIND_SET = new Set(['round', 'turn'])
const RECEIPT_KIND_SET = new Set(['round', 'turn', 'cooldown'])

const fail = (code: AbilityTimingValidationCode, path: string, detail: string): never => {
  throw new AbilityTimingValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 7,
    nodes: 32_768,
    objectFields: 16,
    arrayEntries: ABILITY_TIMING_LIMITS.receipts,
    stringLength: ABILITY_TIMING_LIMITS.identifierLength,
    objectKeyLength: ABILITY_TIMING_LIMITS.identifierLength,
  },
  rootLabel: 'ability timing ledger',
  valueLabel: 'ability timing state',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-ledger', path, 'must be an object.')
  return value
}

const exact = (input: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
  ) fail('invalid-ledger', path, 'has an invalid shape.')
}

const text = (
  value: unknown,
  path: string,
  maximum: number = ABILITY_TIMING_LIMITS.identifierLength,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-ledger', path, 'must be bounded non-empty text.')
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-ledger', path, 'must be a stable identifier.')
  return id
}

const sequence = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > ABILITY_TIMING_LIMITS.sequence) {
    return fail('invalid-ledger', path, 'must be a bounded non-negative sequence.')
  }
  return Number(value)
}

const parseIdentity = (input: UnknownRecord, path: string): AbilityTimingIdentity => ({
  ownerId: text(input.ownerId, `${path}.ownerId`),
  abilityInstanceId: text(input.abilityInstanceId, `${path}.abilityInstanceId`),
  canonicalId: text(input.canonicalId, `${path}.canonicalId`, ABILITY_TIMING_LIMITS.canonicalIdLength),
  constraintId: stableId(input.constraintId, `${path}.constraintId`),
})

export const abilityTimingResourceKey = (identity: AbilityTimingIdentity): string => (
  `${identity.ownerId}\u0000${identity.abilityInstanceId}\u0000${identity.canonicalId}\u0000${identity.constraintId}`
)

const parseUse = (value: unknown, path: string): AbilityTimingUse => {
  const input = record(value, path)
  exact(input, USE_FIELDS, path)
  const limit = Number.isSafeInteger(input.limit) && Number(input.limit) >= 1
    && Number(input.limit) <= ABILITY_TIMING_LIMITS.usesPerConstraint
    ? Number(input.limit)
    : fail('invalid-ledger', `${path}.limit`, 'must be 1 through 10.')
  const spent = Number.isSafeInteger(input.spent) && Number(input.spent) >= 1
    && Number(input.spent) <= limit
    ? Number(input.spent)
    : fail('invalid-ledger', `${path}.spent`, 'must be 1 through limit.')
  return Object.freeze({ ...parseIdentity(input, path), limit, spent })
}

const parseWindow = (value: unknown, path: string): AbilityTimingWindow => {
  const input = record(value, path)
  exact(input, WINDOW_FIELDS, path)
  const windowId = input.windowId === null ? null : stableId(input.windowId, `${path}.windowId`)
  const windowSequence = input.sequence === null ? null : sequence(input.sequence, `${path}.sequence`)
  if ((windowId === null) !== (windowSequence === null)) {
    fail('invalid-ledger', path, 'window ID and sequence must both be null or both be present.')
  }
  if (!Array.isArray(input.uses) || input.uses.length > ABILITY_TIMING_LIMITS.usesPerWindow) {
    fail('limit-exceeded', `${path}.uses`, 'must be a bounded array.')
  }
  const uses = (input.uses as readonly unknown[]).map((use, index) => parseUse(use, `${path}.uses[${index}]`))
  if (new Set(uses.map(abilityTimingResourceKey)).size !== uses.length) {
    fail('duplicate-resource', `${path}.uses`, 'must not repeat resources.')
  }
  if (windowId === null && uses.length > 0) fail('invalid-ledger', path, 'empty cursor cannot retain uses.')
  return Object.freeze({ windowId, sequence: windowSequence, uses: Object.freeze(uses) })
}

const parseCooldown = (value: unknown, path: string): AbilityCooldown => {
  const input = record(value, path)
  exact(input, COOLDOWN_FIELDS, path)
  if (typeof input.unit !== 'string' || !WINDOW_KIND_SET.has(input.unit)) {
    fail('invalid-ledger', `${path}.unit`, 'must be round or turn.')
  }
  return Object.freeze({
    ...parseIdentity(input, path),
    unit: input.unit as AbilityCooldownUnit,
    readySequence: sequence(input.readySequence, `${path}.readySequence`),
  })
}

const parseReceipt = (value: unknown, path: string): AbilityTimingReceipt => {
  const input = record(value, path)
  exact(input, RECEIPT_FIELDS, path)
  if (typeof input.kind !== 'string' || !RECEIPT_KIND_SET.has(input.kind)) {
    fail('invalid-ledger', `${path}.kind`, 'is unsupported.')
  }
  const kind = input.kind as AbilityTimingReceipt['kind']
  const isCooldown = kind === 'cooldown'
  const spent = input.spent === null ? null : sequence(input.spent, `${path}.spent`)
  const limit = input.limit === null ? null : sequence(input.limit, `${path}.limit`)
  const readySequence = input.readySequence === null
    ? null
    : sequence(input.readySequence, `${path}.readySequence`)
  if (
    isCooldown
      ? spent !== null || limit !== null || readySequence === null
      : spent === null || limit === null || spent < 1 || spent > limit
        || limit > ABILITY_TIMING_LIMITS.usesPerConstraint || readySequence !== null
  ) fail('invalid-ledger', path, 'receipt outcome does not match its constraint kind.')
  return Object.freeze({
    ...parseIdentity(input, path),
    operationId: stableId(input.operationId, `${path}.operationId`),
    kind,
    spentAtSequence: sequence(input.spentAtSequence, `${path}.spentAtSequence`),
    spent,
    limit,
    readySequence,
  })
}

export const createEmptyAbilityTimingLedger = (): AbilityTimingLedger => ({
  schemaVersion: ABILITY_TIMING_LEDGER_SCHEMA_VERSION,
  sceneId: null,
  round: { windowId: null, sequence: null, uses: [] },
  turn: { windowId: null, sequence: null, uses: [] },
  cooldowns: [],
  receipts: [],
})

export const parseAbilityTimingLedger = (
  value: unknown,
  path = 'abilityTiming',
): AbilityTimingLedger => {
  const input = record(clone(value, path), path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_TIMING_LEDGER_SCHEMA_VERSION) {
    fail('invalid-ledger', `${path}.schemaVersion`, 'is unsupported.')
  }
  const sceneId = input.sceneId === null ? null : stableId(input.sceneId, `${path}.sceneId`)
  const round = parseWindow(input.round, `${path}.round`)
  const turn = parseWindow(input.turn, `${path}.turn`)
  if (!Array.isArray(input.cooldowns) || input.cooldowns.length > ABILITY_TIMING_LIMITS.cooldowns) {
    fail('limit-exceeded', `${path}.cooldowns`, 'must be a bounded array.')
  }
  const cooldowns = (input.cooldowns as readonly unknown[]).map((entry, index) => (
    parseCooldown(entry, `${path}.cooldowns[${index}]`)
  ))
  const cooldownKeys = cooldowns.map(entry => `${abilityTimingResourceKey(entry)}\u0000${entry.unit}`)
  if (new Set(cooldownKeys).size !== cooldowns.length) {
    fail('duplicate-resource', `${path}.cooldowns`, 'must not repeat resources.')
  }
  if (!Array.isArray(input.receipts) || input.receipts.length > ABILITY_TIMING_LIMITS.receipts) {
    fail('limit-exceeded', `${path}.receipts`, 'must be a bounded array.')
  }
  const receipts = (input.receipts as readonly unknown[]).map((entry, index) => (
    parseReceipt(entry, `${path}.receipts[${index}]`)
  ))
  const receiptKeys = receipts.map(entry => `${entry.operationId}\u0000${abilityTimingResourceKey(entry)}`)
  if (new Set(receiptKeys).size !== receipts.length) {
    fail('duplicate-receipt', `${path}.receipts`, 'must not repeat operation/resource receipts.')
  }
  if (sceneId === null && (
    round.windowId !== null || turn.windowId !== null || cooldowns.length > 0 || receipts.length > 0
  )) fail('invalid-ledger', path, 'empty scene cannot retain timing state.')
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_TIMING_LEDGER_SCHEMA_VERSION,
    sceneId,
    round,
    turn,
    cooldowns,
    receipts,
  })
}

const validateCursor = (cursor: AbilityTimingCursor): void => {
  stableId(cursor.sceneId, 'cursor.sceneId')
  stableId(cursor.roundId, 'cursor.roundId')
  sequence(cursor.roundSequence, 'cursor.roundSequence')
  if ((cursor.turnId === null) !== (cursor.turnSequence === null)) {
    fail('invalid-cursor', 'cursor.turn', 'turn ID and sequence must both be null or present.')
  }
  if (cursor.turnId !== null) stableId(cursor.turnId, 'cursor.turnId')
  if (cursor.turnSequence !== null) sequence(cursor.turnSequence, 'cursor.turnSequence')
}

export const beginAbilityTimingScene = (
  ledger: AbilityTimingLedger,
  sceneId: string,
): AbilityTimingLedger => {
  const current = parseAbilityTimingLedger(ledger)
  stableId(sceneId, 'sceneId')
  if (current.sceneId === sceneId) return current
  return parseAbilityTimingLedger({ ...createEmptyAbilityTimingLedger(), sceneId })
}

export const advanceAbilityTimingWindows = (
  ledger: AbilityTimingLedger,
  cursor: AbilityTimingCursor,
): AbilityTimingLedger => {
  validateCursor(cursor)
  const current = parseAbilityTimingLedger(ledger)
  if (current.sceneId !== cursor.sceneId) {
    fail('regressive-cursor', 'cursor.sceneId', 'requires an explicit authoritative scene transition.')
  }
  const advance = (
    previous: AbilityTimingWindow,
    id: string | null,
    nextSequence: number | null,
    kind: AbilityTimingWindowKind,
  ): AbilityTimingWindow => {
    if (id === null || nextSequence === null) return { windowId: null, sequence: null, uses: [] }
    if (previous.sequence !== null && nextSequence < previous.sequence) {
      fail('regressive-cursor', `cursor.${kind}Sequence`, 'must not move backwards.')
    }
    if (previous.sequence === nextSequence && previous.windowId !== id) {
      fail('invalid-cursor', `cursor.${kind}Id`, 'cannot change at the same sequence.')
    }
    return previous.sequence === nextSequence
      ? previous
      : { windowId: id, sequence: nextSequence, uses: [] }
  }
  return parseAbilityTimingLedger({
    ...current,
    round: advance(current.round, cursor.roundId, cursor.roundSequence, 'round'),
    turn: advance(current.turn, cursor.turnId, cursor.turnSequence, 'turn'),
  })
}

/** Strict restart/reconnect recovery: parse persisted state, then advance monotonically. */
export const recoverAbilityTimingLedger = (
  value: unknown,
  cursor: AbilityTimingCursor,
): AbilityTimingLedger => advanceAbilityTimingWindows(parseAbilityTimingLedger(value), cursor)
