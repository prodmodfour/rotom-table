export const MOVE_RULE_AST_LIMITS = Object.freeze({
  nodes: 256,
  depth: 16,
  stringLength: 160,
  listSize: 32,
  numericMagnitude: 1_000_000_000,
})

export type MoveRuleAstValidationCode =
  | 'invalid-expression'
  | 'invalid-selector'
  | 'invalid-predicate'
  | 'unknown-expression-kind'
  | 'unknown-selector-kind'
  | 'unknown-predicate-kind'
  | 'limit-exceeded'
  | 'not-json'
  | 'duplicate-key'

export interface MoveRuleAstParseContext {
  readonly invalidCode:
    | 'invalid-expression'
    | 'invalid-selector'
    | 'invalid-predicate'
  readonly createError: (
    code: MoveRuleAstValidationCode,
    path: string,
    message: string,
  ) => Error
  nodes: number
}

export type MoveRuleAstRecord = Record<string, unknown>
export type MoveRuleScalar = string | number | boolean | null

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

export const createMoveRuleAstParseContext = (
  invalidCode: MoveRuleAstParseContext['invalidCode'],
  createError: MoveRuleAstParseContext['createError'],
): MoveRuleAstParseContext => ({ invalidCode, createError, nodes: 0 })

export const failMoveRuleAst = (
  context: MoveRuleAstParseContext,
  code: MoveRuleAstValidationCode,
  path: string,
  message: string,
): never => {
  throw context.createError(code, path, message)
}

export const enterMoveRuleAstNode = (
  context: MoveRuleAstParseContext,
  path: string,
  depth: number,
): void => {
  if (depth > MOVE_RULE_AST_LIMITS.depth) {
    failMoveRuleAst(
      context,
      'limit-exceeded',
      path,
      `AST nodes must be at most ${MOVE_RULE_AST_LIMITS.depth} levels deep.`,
    )
  }
  context.nodes += 1
  if (context.nodes > MOVE_RULE_AST_LIMITS.nodes) {
    failMoveRuleAst(
      context,
      'limit-exceeded',
      path,
      `ASTs must contain at most ${MOVE_RULE_AST_LIMITS.nodes} nodes.`,
    )
  }
}

const propertyPath = (path: string, key: string): string => `${path}.${key}`

const isPlainRecord = (value: unknown): value is MoveRuleAstRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Validate object descriptors without invoking getters or other executable hooks. */
export const parseMoveRuleAstRecord = (
  value: unknown,
  path: string,
  context: MoveRuleAstParseContext,
): MoveRuleAstRecord => {
  if (!isPlainRecord(value)) {
    return failMoveRuleAst(context, 'not-json', path, 'must be a plain JSON object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    failMoveRuleAst(context, 'not-json', path, 'symbol properties are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? failMoveRuleAst(context, 'not-json', propertyPath(path, key), 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      failMoveRuleAst(
        context,
        'not-json',
        propertyPath(path, key),
        'fields must be enumerable data properties.',
      )
    }
  }
  return value
}

export const readMoveRuleAstOwnValue = (
  record: MoveRuleAstRecord,
  key: string,
  path: string,
  context: MoveRuleAstParseContext,
): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
    ?? failMoveRuleAst(context, context.invalidCode, propertyPath(path, key), 'is required.')
  if (!descriptor.enumerable || !('value' in descriptor)) {
    return failMoveRuleAst(
      context,
      'not-json',
      propertyPath(path, key),
      'must be an enumerable data property.',
    )
  }
  return (descriptor as PropertyDescriptor & { value: unknown }).value
}

export const assertMoveRuleAstExactKeys = (
  record: MoveRuleAstRecord,
  expectedKeys: readonly string[],
  path: string,
  context: MoveRuleAstParseContext,
): void => {
  const expected = new Set(expectedKeys)
  const actual = Object.getOwnPropertyNames(record)
  const missing = expectedKeys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  const unknown = actual.filter(key => !expected.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    failMoveRuleAst(
      context,
      context.invalidCode,
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

export const parseMoveRuleAstExactRecord = (
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
  context: MoveRuleAstParseContext,
): MoveRuleAstRecord => {
  const record = parseMoveRuleAstRecord(value, path, context)
  assertMoveRuleAstExactKeys(record, expectedKeys, path, context)
  return record
}

export const parseMoveRuleAstArray = (
  value: unknown,
  path: string,
  context: MoveRuleAstParseContext,
  options: { readonly minimum?: number; readonly maximum?: number } = {},
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return failMoveRuleAst(context, context.invalidCode, path, 'must be an array.')
  }
  const minimum = options.minimum ?? 0
  const maximum = options.maximum ?? MOVE_RULE_AST_LIMITS.listSize
  if (value.length < minimum) {
    failMoveRuleAst(context, context.invalidCode, path, `must contain at least ${minimum} entries.`)
  }
  if (value.length > maximum) {
    failMoveRuleAst(context, 'limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    failMoveRuleAst(context, 'not-json', path, 'symbol properties are not allowed on arrays.')
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
      failMoveRuleAst(context, 'not-json', propertyPath(path, key), 'arrays cannot contain named properties.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? failMoveRuleAst(context, 'not-json', `${path}[${key}]`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      failMoveRuleAst(
        context,
        'not-json',
        `${path}[${key}]`,
        'entries must be enumerable data properties.',
      )
    }
  }

  const entries: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      ?? failMoveRuleAst(context, 'not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      failMoveRuleAst(
        context,
        'not-json',
        `${path}[${index}]`,
        'entries must be enumerable data properties.',
      )
    }
    entries.push((descriptor as PropertyDescriptor & { value: unknown }).value)
  }
  return entries
}

export const parseMoveRuleAstEnum = <Value extends string>(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  description: string,
  context: MoveRuleAstParseContext,
): Value => {
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    return failMoveRuleAst(context, context.invalidCode, path, `must be ${description}.`)
  }
  return value as Value
}

export const parseMoveRuleAstString = (
  value: unknown,
  path: string,
  context: MoveRuleAstParseContext,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return failMoveRuleAst(
      context,
      context.invalidCode,
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > MOVE_RULE_AST_LIMITS.stringLength) {
    failMoveRuleAst(
      context,
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_RULE_AST_LIMITS.stringLength} characters.`,
    )
  }
  return value
}

export const parseMoveRuleAstNumber = (
  value: unknown,
  path: string,
  context: MoveRuleAstParseContext,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return failMoveRuleAst(context, 'not-json', path, 'must be a finite number.')
  }
  if (
    value < -MOVE_RULE_AST_LIMITS.numericMagnitude
    || value > MOVE_RULE_AST_LIMITS.numericMagnitude
  ) {
    failMoveRuleAst(
      context,
      'limit-exceeded',
      path,
      `must be from ${-MOVE_RULE_AST_LIMITS.numericMagnitude} through ${MOVE_RULE_AST_LIMITS.numericMagnitude}.`,
    )
  }
  return value
}

export const parseMoveRuleScalar = (
  value: unknown,
  path: string,
  context: MoveRuleAstParseContext,
): MoveRuleScalar => {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return parseMoveRuleAstNumber(value, path, context)
  if (typeof value === 'string') return parseMoveRuleAstString(value, path, context)
  return failMoveRuleAst(
    context,
    'not-json',
    path,
    'must be a bounded string, finite number, boolean, or null.',
  )
}

export const moveRuleScalarIdentity = (value: MoveRuleScalar): string => {
  if (value === null) return 'null'
  if (typeof value === 'number' && Object.is(value, -0)) return 'number:0'
  return `${typeof value}:${String(value)}`
}

export const deepFreezeMoveRuleAst = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreezeMoveRuleAst((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}
