import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveEffectDiceRollFormula,
  type MoveEffectRollFormula,
  type MoveEffectTableRollFormula,
  type MoveEffectUniformIntegerRollFormula,
} from './effects'

export const MOVE_AUTOMATION_ROLL_LEDGER_LIMITS = Object.freeze({
  entries: 512,
  tableEntries: 256,
  modifiers: 32,
  naturalResults: MOVE_EFFECT_OPERATION_LIMITS.diceCount,
  identifierLength: MOVE_EFFECT_OPERATION_LIMITS.identifierLength,
  reasonLength: MOVE_EFFECT_OPERATION_LIMITS.textLength,
  numericMagnitude: 1_000_000_000,
})

export type MoveAutomationRandomDrawFormula =
  | MoveEffectDiceRollFormula
  | MoveEffectUniformIntegerRollFormula

export interface MoveAutomationRollModifier {
  readonly sourceId: string
  readonly reason: string
  readonly value: number
}

export interface MoveAutomationRollLedgerEntry {
  readonly rollId: string
  readonly parentEffectId: string
  readonly formula: MoveEffectRollFormula
  readonly reason: string
  /** Individual natural dice, or the single uniform/table draw, before modifiers. */
  readonly naturalResults: readonly number[]
  /** Sum of `naturalResults`, before formula and contextual modifiers. */
  readonly naturalResult: number
  readonly modifiers: readonly MoveAutomationRollModifier[]
  /** Modified roll total, or the reviewed numeric result selected by a table. */
  readonly finalValue: number
}

export interface MoveAutomationRollRequestMetadata {
  /** V2 callers provide their reviewed roll ID; compatibility callers may use deterministic sequence IDs. */
  readonly rollId?: string
  readonly parentEffectId: string
  readonly reason: string
  readonly modifiers?: readonly MoveAutomationRollModifier[]
}

export interface MoveAutomationRandomRollRequest extends MoveAutomationRollRequestMetadata {
  readonly formula: MoveAutomationRandomDrawFormula
}

export interface MoveAutomationRandomTableEntry {
  readonly minimum: number
  readonly maximum: number
  readonly value: number
}

export interface MoveAutomationRandomTableRollRequest extends MoveAutomationRollRequestMetadata {
  readonly formula: MoveEffectTableRollFormula
  readonly drawFormula: MoveAutomationRandomDrawFormula
  readonly entries: readonly MoveAutomationRandomTableEntry[]
}

export interface MoveAutomationRandomRollResult {
  readonly naturalResults: readonly number[]
  readonly naturalResult: number
  /** Natural result after formula and contextual modifiers, before any table lookup. */
  readonly modifiedResult: number
  readonly finalValue: number
}

/** Narrow randomness dependency consumed by legacy adapters and the future phased interpreter. */
export interface MoveAutomationRandomRoller {
  roll(request: MoveAutomationRandomRollRequest): MoveAutomationRandomRollResult
  rollTable(request: MoveAutomationRandomTableRollRequest): MoveAutomationRandomRollResult
}

export type MoveAutomationRollLedgerValidationCode =
  | 'invalid-roll-ledger'
  | 'limit-exceeded'
  | 'duplicate-roll-id'

export class MoveAutomationRollLedgerValidationError extends Error {
  readonly code: MoveAutomationRollLedgerValidationCode
  readonly path: string

  constructor(code: MoveAutomationRollLedgerValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveAutomationRollLedgerValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const ENTRY_FIELDS = new Set([
  'rollId',
  'parentEffectId',
  'formula',
  'reason',
  'naturalResults',
  'naturalResult',
  'modifiers',
  'finalValue',
])
const MODIFIER_FIELDS = new Set(['sourceId', 'reason', 'value'])
const DICE_FORMULA_FIELDS = new Set(['kind', 'count', 'sides', 'modifier'])
const UNIFORM_FORMULA_FIELDS = new Set(['kind', 'minimum', 'maximum'])
const TABLE_FORMULA_FIELDS = new Set(['kind', 'tableId'])

const fail = (
  code: MoveAutomationRollLedgerValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveAutomationRollLedgerValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-roll-ledger', path, 'must be an object.')
  return value
}

const assertExactFields = (
  value: UnknownRecord,
  fields: ReadonlySet<string>,
  path: string,
): void => {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail('invalid-roll-ledger', `${path}.${field}`, 'is required.')
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) {
      fail('invalid-roll-ledger', `${path}.${field}`, 'is not a supported field.')
    }
  }
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  if (typeof value !== 'string') return fail('invalid-roll-ledger', path, 'must be a string.')
  const normalized = value.trim()
  if (!normalized) fail('invalid-roll-ledger', path, 'must not be empty.')
  if (normalized.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('invalid-roll-ledger', path, 'must not contain control characters.')
  }
  return normalized
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(
    value,
    path,
    MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.identifierLength,
  )
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-roll-ledger', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseFiniteNumber = (value: unknown, path: string): number => {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || Math.abs(value) > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.numericMagnitude
  ) {
    return fail(
      'invalid-roll-ledger',
      path,
      `must be finite and within ±${MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.numericMagnitude}.`,
    )
  }
  return value
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = parseFiniteNumber(value, path)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail('invalid-roll-ledger', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseFormula = (value: unknown, path: string): MoveEffectRollFormula => {
  const input = parseRecord(value, path)
  if (input.kind === 'dice') {
    assertExactFields(input, DICE_FORMULA_FIELDS, path)
    return {
      kind: 'dice',
      count: parseInteger(
        input.count,
        `${path}.count`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.diceCount,
      ),
      sides: parseInteger(
        input.sides,
        `${path}.sides`,
        2,
        MOVE_EFFECT_OPERATION_LIMITS.diceSides,
      ),
      modifier: parseInteger(
        input.modifier,
        `${path}.modifier`,
        -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
        MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      ),
    }
  }
  if (input.kind === 'uniform-integer') {
    assertExactFields(input, UNIFORM_FORMULA_FIELDS, path)
    const minimum = parseInteger(
      input.minimum,
      `${path}.minimum`,
      -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
    const maximum = parseInteger(
      input.maximum,
      `${path}.maximum`,
      -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
    if (minimum > maximum) {
      fail('invalid-roll-ledger', path, 'minimum cannot exceed maximum.')
    }
    return { kind: 'uniform-integer', minimum, maximum }
  }
  if (input.kind === 'table') {
    assertExactFields(input, TABLE_FORMULA_FIELDS, path)
    return {
      kind: 'table',
      tableId: parseStableId(input.tableId, `${path}.tableId`),
    }
  }
  return fail('invalid-roll-ledger', `${path}.kind`, 'must be dice, uniform-integer, or table.')
}

const parseNaturalResults = (
  value: unknown,
  formula: MoveEffectRollFormula,
  path: string,
): number[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('invalid-roll-ledger', path, 'must be a non-empty array of natural integer results.')
  }
  if (value.length > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.naturalResults) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.naturalResults} results.`,
    )
  }

  const results = value.map((item, index) => parseInteger(
    item,
    `${path}.${index}`,
    -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  ))
  if (formula.kind === 'dice') {
    if (results.length !== formula.count) {
      fail('invalid-roll-ledger', path, `must contain exactly ${formula.count} dice results.`)
    }
    results.forEach((result, index) => {
      if (result < 1 || result > formula.sides) {
        fail('invalid-roll-ledger', `${path}.${index}`, `must be from 1 through ${formula.sides}.`)
      }
    })
  }
  if (formula.kind === 'uniform-integer') {
    if (results.length !== 1) {
      fail('invalid-roll-ledger', path, 'must contain exactly one uniform result.')
    }
    const result = results[0]!
    if (result < formula.minimum || result > formula.maximum) {
      fail(
        'invalid-roll-ledger',
        `${path}.0`,
        `must be from ${formula.minimum} through ${formula.maximum}.`,
      )
    }
  }
  return results
}

const parseModifiers = (value: unknown, path: string): MoveAutomationRollModifier[] => {
  if (!Array.isArray(value)) return fail('invalid-roll-ledger', path, 'must be an array.')
  if (value.length > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.modifiers) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.modifiers} modifiers.`,
    )
  }

  const sourceIds = new Set<string>()
  return value.map((item, index) => {
    const itemPath = `${path}.${index}`
    const input = parseRecord(item, itemPath)
    assertExactFields(input, MODIFIER_FIELDS, itemPath)
    const sourceId = parseStableId(input.sourceId, `${itemPath}.sourceId`)
    if (sourceIds.has(sourceId)) {
      fail('invalid-roll-ledger', `${itemPath}.sourceId`, `duplicates modifier source ${sourceId}.`)
    }
    sourceIds.add(sourceId)
    return {
      sourceId,
      reason: parseBoundedText(
        input.reason,
        `${itemPath}.reason`,
        MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.reasonLength,
      ),
      value: parseFiniteNumber(input.value, `${itemPath}.value`),
    }
  })
}

const parseEntry = (value: unknown, path: string): MoveAutomationRollLedgerEntry => {
  const input = parseRecord(value, path)
  assertExactFields(input, ENTRY_FIELDS, path)
  const formula = parseFormula(input.formula, `${path}.formula`)
  const naturalResults = parseNaturalResults(input.naturalResults, formula, `${path}.naturalResults`)
  const naturalResult = parseFiniteNumber(input.naturalResult, `${path}.naturalResult`)
  const expectedNaturalResult = naturalResults.reduce((sum, result) => sum + result, 0)
  if (naturalResult !== expectedNaturalResult) {
    fail(
      'invalid-roll-ledger',
      `${path}.naturalResult`,
      `must equal the natural-results sum ${expectedNaturalResult}.`,
    )
  }
  const modifiers = parseModifiers(input.modifiers, `${path}.modifiers`)
  const finalValue = parseFiniteNumber(input.finalValue, `${path}.finalValue`)
  if (formula.kind !== 'table') {
    const formulaModifier = formula.kind === 'dice' ? formula.modifier : 0
    const expectedFinalValue = naturalResult
      + formulaModifier
      + modifiers.reduce((sum, modifier) => sum + modifier.value, 0)
    if (finalValue !== expectedFinalValue) {
      fail(
        'invalid-roll-ledger',
        `${path}.finalValue`,
        `must equal the natural result plus modifiers (${expectedFinalValue}).`,
      )
    }
  }

  return {
    rollId: parseStableId(input.rollId, `${path}.rollId`),
    parentEffectId: parseStableId(input.parentEffectId, `${path}.parentEffectId`),
    formula,
    reason: parseBoundedText(
      input.reason,
      `${path}.reason`,
      MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.reasonLength,
    ),
    naturalResults,
    naturalResult,
    modifiers,
    finalValue,
  }
}

/** Strictly parse and detach a bounded wire-format roll ledger. */
export const parseMoveAutomationRollLedger = (
  value: unknown,
  path = 'rollLedger',
): MoveAutomationRollLedgerEntry[] => {
  if (!Array.isArray(value)) return fail('invalid-roll-ledger', path, 'must be an array.')
  if (value.length > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.entries) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.entries} entries.`,
    )
  }

  const rollIds = new Set<string>()
  return value.map((item, index) => {
    const entry = parseEntry(item, `${path}.${index}`)
    if (rollIds.has(entry.rollId)) {
      fail('duplicate-roll-id', `${path}.${index}.rollId`, `duplicates roll ID ${entry.rollId}.`)
    }
    rollIds.add(entry.rollId)
    return entry
  })
}
