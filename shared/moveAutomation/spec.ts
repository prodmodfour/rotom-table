export const MOVE_SPEC_SCHEMA_VERSION = 2 as const

/** Canonical interpreter order. Specs may omit phases they do not use. */
export const MOVE_SPEC_PHASES = [
  'declare',
  'precondition',
  'pay',
  'target',
  'pre-hit',
  'accuracy',
  'hit',
  'miss',
  'damage',
  'after-damage',
  'ko',
  'movement',
  'schedule',
  'usage',
  'cleanup',
] as const

export const MOVE_SPEC_TARGETING_KINDS = [
  'none',
  'self',
  'single-target',
  'multi-target',
  'area',
  'field',
  'hazard',
] as const

export type MoveSpecPhase = (typeof MOVE_SPEC_PHASES)[number]
export type MoveSpecTargetingKind = (typeof MOVE_SPEC_TARGETING_KINDS)[number]

export type MoveSpecJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MoveSpecJsonValue[]
  | MoveSpecJsonObject

export type MoveSpecJsonObject = {
  readonly [key: string]: MoveSpecJsonValue
}

/**
 * Syntax-only JSON extension points. Their bounded tagged unions are owned by
 * the dedicated selector, predicate, expression, and effect-operation
 * contracts. The MoveSpec envelope never executes these objects directly.
 */
export type MoveSpecSelector = MoveSpecJsonObject
export type MoveSpecPredicate = MoveSpecJsonObject
export type MoveSpecCost = MoveSpecJsonObject
export type MoveSpecEffectOperation = MoveSpecJsonObject

export interface MoveSpecTargetingDeclaration {
  readonly kind: MoveSpecTargetingKind
  /** Number of placement IDs selected by intent, not the number ultimately affected. */
  readonly minTargets: number
  readonly maxTargets: number
  readonly selector: MoveSpecSelector | null
  /** Optional server-evaluated relation/state declaration for geometric area candidates. */
  readonly predicate?: MoveSpecPredicate | null
}

export interface MoveSpecPrecondition {
  readonly id: string
  readonly predicate: MoveSpecPredicate
  readonly failureReasonCode: string
}

export interface MoveSpecCostDeclaration {
  readonly id: string
  readonly phase: MoveSpecPhase
  readonly cost: MoveSpecCost
}

export interface MoveSpecPhaseBlock {
  readonly phase: MoveSpecPhase
  readonly operations: readonly MoveSpecEffectOperation[]
}

export interface MoveSpecPresentationMetadata {
  readonly displayName: string
  /** Optional generic VFX lookup only; it never changes mechanics. */
  readonly vfxKey: string | null
  readonly tags: readonly string[]
}

export interface MoveSpec {
  readonly schemaVersion: typeof MOVE_SPEC_SCHEMA_VERSION
  readonly canonicalId: string
  /** Reviewed behavior revision for manifest linkage and hashing. */
  readonly version: number
  readonly targeting: MoveSpecTargetingDeclaration
  readonly preconditions: readonly MoveSpecPrecondition[]
  readonly costs: readonly MoveSpecCostDeclaration[]
  /** A canonically ordered subset of MOVE_SPEC_PHASES. */
  readonly phases: readonly MoveSpecPhaseBlock[]
  readonly registeredHandlerId: string | null
  readonly presentation: MoveSpecPresentationMetadata
}

export const MOVE_SPEC_LIMITS = Object.freeze({
  identifierLength: 160,
  displayNameLength: 160,
  targetCount: 32,
  preconditions: 64,
  costs: 32,
  phaseBlocks: MOVE_SPEC_PHASES.length,
  operationsPerPhase: 128,
  presentationTags: 32,
  jsonDepth: 24,
  jsonNodes: 8_192,
  jsonObjectFields: 128,
  jsonArrayEntries: 256,
  jsonStringLength: 1_000,
})

export type MoveSpecValidationCode =
  | 'invalid-spec'
  | 'unsupported-schema-version'
  | 'not-json'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'invalid-phase-order'

export class MoveSpecValidationError extends Error {
  readonly code: MoveSpecValidationCode
  readonly path: string

  constructor(code: MoveSpecValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveSpecValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
type JsonCloneState = {
  readonly ancestors: WeakSet<object>
  nodes: number
}

const ROOT_FIELDS = [
  'schemaVersion',
  'canonicalId',
  'version',
  'targeting',
  'preconditions',
  'costs',
  'phases',
  'registeredHandlerId',
  'presentation',
] as const
const TARGETING_REQUIRED_FIELDS = ['kind', 'minTargets', 'maxTargets', 'selector'] as const
const TARGETING_OPTIONAL_FIELDS = ['predicate'] as const
const PRECONDITION_FIELDS = ['id', 'predicate', 'failureReasonCode'] as const
const COST_FIELDS = ['id', 'phase', 'cost'] as const
const PHASE_BLOCK_FIELDS = ['phase', 'operations'] as const
const PRESENTATION_FIELDS = ['displayName', 'vfxKey', 'tags'] as const

const PHASE_INDEX = new Map<string, number>(MOVE_SPEC_PHASES.map((phase, index) => [phase, index]))
const TARGETING_KIND_SET = new Set<string>(MOVE_SPEC_TARGETING_KINDS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

const fail = (code: MoveSpecValidationCode, path: string, message: string): never => {
  throw new MoveSpecValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const propertyPath = (path: string, key: string): string => `${path}.${key}`

const countJsonNode = (state: JsonCloneState, path: string): void => {
  state.nodes += 1
  if (state.nodes > MOVE_SPEC_LIMITS.jsonNodes) {
    fail('limit-exceeded', path, `spec data must contain at most ${MOVE_SPEC_LIMITS.jsonNodes} JSON nodes.`)
  }
}

/**
 * Detach untrusted input without invoking getters or toJSON methods. This is
 * deliberately stricter than JSON.stringify so callbacks, class instances,
 * sparse arrays, hidden fields, and lossy values cannot enter a MoveSpec.
 */
const clonePlainJson = (
  value: unknown,
  path: string,
  depth: number,
  state: JsonCloneState,
): MoveSpecJsonValue => {
  countJsonNode(state, path)
  if (depth > MOVE_SPEC_LIMITS.jsonDepth) {
    fail('limit-exceeded', path, `spec data must be at most ${MOVE_SPEC_LIMITS.jsonDepth} levels deep.`)
  }

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.length > MOVE_SPEC_LIMITS.jsonStringLength) {
      fail('limit-exceeded', path, `must contain at most ${MOVE_SPEC_LIMITS.jsonStringLength} characters.`)
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('not-json', path, 'non-finite numbers are not JSON values.')
    return value
  }
  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return fail('not-json', path, `${typeof value} values are not allowed in MoveSpecs.`)
  }

  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) fail('not-json', path, 'circular references are not allowed.')
    if (value.length > MOVE_SPEC_LIMITS.jsonArrayEntries) {
      fail('limit-exceeded', path, `must contain at most ${MOVE_SPEC_LIMITS.jsonArrayEntries} entries.`)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail('not-json', path, 'symbol properties are not allowed.')
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'length') continue
      const index = Number(key)
      if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
        fail('not-json', propertyPath(path, key), 'arrays cannot contain named properties.')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        fail('not-json', `${path}[${key}]`, 'array entries must be enumerable data properties.')
      }
    }

    state.ancestors.add(value)
    const clone: MoveSpecJsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail('not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
      }
      clone.push(clonePlainJson(value[index], `${path}[${index}]`, depth + 1, state))
    }
    state.ancestors.delete(value)
    return clone
  }

  if (!isPlainRecord(value)) {
    return fail('not-json', path, 'only plain JSON objects are allowed.')
  }
  if (state.ancestors.has(value)) fail('not-json', path, 'circular references are not allowed.')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }

  const keys = Object.getOwnPropertyNames(value)
  if (keys.length > MOVE_SPEC_LIMITS.jsonObjectFields) {
    fail('limit-exceeded', path, `must contain at most ${MOVE_SPEC_LIMITS.jsonObjectFields} fields.`)
  }

  state.ancestors.add(value)
  const clone: Record<string, MoveSpecJsonValue> = {}
  for (const key of keys) {
    const keyPath = propertyPath(path, key)
    if (
      key.length === 0
      || key.length > MOVE_SPEC_LIMITS.identifierLength
      || CONTROL_CHARACTER_PATTERN.test(key)
    ) {
      fail('not-json', keyPath, 'object keys must be non-empty, bounded, and free of control characters.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', keyPath, 'object fields must have property descriptors.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', keyPath, 'object fields must be enumerable data properties.')
    }
    const descriptorValue = (descriptor as PropertyDescriptor & { value: unknown }).value
    Object.defineProperty(clone, key, {
      value: clonePlainJson(descriptorValue, keyPath, depth + 1, state),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  state.ancestors.delete(value)
  return clone
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) return fail('invalid-spec', path, 'must be an object.')
  return value
}

const assertExactKeys = (
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
  optionalKeys: readonly string[] = [],
): void => {
  const expected = new Set([...expectedKeys, ...optionalKeys])
  const missing = expectedKeys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  const unknown = Object.keys(record).filter(key => !expected.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-spec',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail('invalid-spec', path, 'must be a non-empty, trimmed, single-line string.')
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path, MOVE_SPEC_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-spec', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parsePositiveVersion = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('invalid-spec', path, 'must be a positive safe integer.')
  }
  return Number(value)
}

const parseTargetCount = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > MOVE_SPEC_LIMITS.targetCount
  ) {
    return fail(
      'invalid-spec',
      path,
      `must be a safe integer from 0 through ${MOVE_SPEC_LIMITS.targetCount}.`,
    )
  }
  return Number(value)
}

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-spec', path, 'must be an array.')
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  return value
}

const parsePhase = (value: unknown, path: string): MoveSpecPhase => {
  if (typeof value !== 'string' || !PHASE_INDEX.has(value)) {
    return fail('invalid-spec', path, 'must be a supported MoveSpec phase.')
  }
  return value as MoveSpecPhase
}

const parseDataObject = (value: unknown, path: string): MoveSpecJsonObject =>
  parseRecord(value, path) as MoveSpecJsonObject

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate identifiers.')
  }
}

const parseTargeting = (value: unknown): MoveSpecTargetingDeclaration => {
  const path = 'spec.targeting'
  const input = parseRecord(value, path)
  assertExactKeys(input, TARGETING_REQUIRED_FIELDS, path, TARGETING_OPTIONAL_FIELDS)
  if (typeof input.kind !== 'string' || !TARGETING_KIND_SET.has(input.kind)) {
    fail('invalid-spec', `${path}.kind`, 'must be a supported targeting kind.')
  }
  const minTargets = parseTargetCount(input.minTargets, `${path}.minTargets`)
  const maxTargets = parseTargetCount(input.maxTargets, `${path}.maxTargets`)
  if (minTargets > maxTargets) {
    fail('invalid-spec', path, 'minTargets cannot exceed maxTargets.')
  }
  const hasPredicate = Object.prototype.hasOwnProperty.call(input, 'predicate')
  return {
    kind: input.kind as MoveSpecTargetingKind,
    minTargets,
    maxTargets,
    selector: input.selector === null
      ? null
      : parseDataObject(input.selector, `${path}.selector`),
    ...(hasPredicate
      ? {
          predicate: input.predicate === null
            ? null
            : parseDataObject(input.predicate, `${path}.predicate`),
        }
      : {}),
  }
}

const parsePreconditions = (value: unknown): readonly MoveSpecPrecondition[] => {
  const path = 'spec.preconditions'
  const preconditions = parseBoundedArray(value, path, MOVE_SPEC_LIMITS.preconditions)
    .map((entry, index): MoveSpecPrecondition => {
      const entryPath = `${path}[${index}]`
      const input = parseRecord(entry, entryPath)
      assertExactKeys(input, PRECONDITION_FIELDS, entryPath)
      return {
        id: parseStableId(input.id, `${entryPath}.id`),
        predicate: parseDataObject(input.predicate, `${entryPath}.predicate`),
        failureReasonCode: parseStableId(
          input.failureReasonCode,
          `${entryPath}.failureReasonCode`,
        ),
      }
    })
  assertUnique(preconditions.map(({ id }) => id), `${path}.id`)
  return preconditions
}

const parseCosts = (value: unknown): readonly MoveSpecCostDeclaration[] => {
  const path = 'spec.costs'
  const costs = parseBoundedArray(value, path, MOVE_SPEC_LIMITS.costs)
    .map((entry, index): MoveSpecCostDeclaration => {
      const entryPath = `${path}[${index}]`
      const input = parseRecord(entry, entryPath)
      assertExactKeys(input, COST_FIELDS, entryPath)
      return {
        id: parseStableId(input.id, `${entryPath}.id`),
        phase: parsePhase(input.phase, `${entryPath}.phase`),
        cost: parseDataObject(input.cost, `${entryPath}.cost`),
      }
    })
  assertUnique(costs.map(({ id }) => id), `${path}.id`)
  return costs
}

const parsePhaseBlocks = (value: unknown): readonly MoveSpecPhaseBlock[] => {
  const path = 'spec.phases'
  let previousPhaseIndex = -1
  const blocks = parseBoundedArray(value, path, MOVE_SPEC_LIMITS.phaseBlocks)
    .map((entry, index): MoveSpecPhaseBlock => {
      const entryPath = `${path}[${index}]`
      const input = parseRecord(entry, entryPath)
      assertExactKeys(input, PHASE_BLOCK_FIELDS, entryPath)
      const phase = parsePhase(input.phase, `${entryPath}.phase`)
      const phaseIndex = PHASE_INDEX.get(phase) ?? -1
      if (phaseIndex <= previousPhaseIndex) {
        fail(
          'invalid-phase-order',
          `${entryPath}.phase`,
          'phase blocks must be unique and follow canonical interpreter order.',
        )
      }
      previousPhaseIndex = phaseIndex
      const operations = parseBoundedArray(
        input.operations,
        `${entryPath}.operations`,
        MOVE_SPEC_LIMITS.operationsPerPhase,
      ).map((operation, operationIndex) =>
        parseDataObject(operation, `${entryPath}.operations[${operationIndex}]`),
      )
      return { phase, operations }
    })
  return blocks
}

const parsePresentation = (value: unknown): MoveSpecPresentationMetadata => {
  const path = 'spec.presentation'
  const input = parseRecord(value, path)
  assertExactKeys(input, PRESENTATION_FIELDS, path)
  const tags = parseBoundedArray(input.tags, `${path}.tags`, MOVE_SPEC_LIMITS.presentationTags)
    .map((tag, index) => parseStableId(tag, `${path}.tags[${index}]`))
  assertUnique(tags, `${path}.tags`)
  return {
    displayName: parseBoundedText(
      input.displayName,
      `${path}.displayName`,
      MOVE_SPEC_LIMITS.displayNameLength,
    ),
    vfxKey: input.vfxKey === null ? null : parseStableId(input.vfxKey, `${path}.vfxKey`),
    tags,
  }
}

/**
 * Parse, detach, and deeply freeze a MoveSpec v2 envelope.
 *
 * This parser establishes data shape and JSON safety. Dedicated operation,
 * selector, predicate, and expression parsers own the semantics of their
 * tagged nodes before a spec can be registered or executed.
 */
export const parseMoveSpec = (value: unknown): MoveSpec => {
  const detached = clonePlainJson(value, 'spec', 0, {
    ancestors: new WeakSet<object>(),
    nodes: 0,
  })
  const root = parseRecord(detached, 'spec')
  assertExactKeys(root, ROOT_FIELDS, 'spec')
  if (root.schemaVersion !== MOVE_SPEC_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      'spec.schemaVersion',
      `must be ${MOVE_SPEC_SCHEMA_VERSION}.`,
    )
  }

  const spec: MoveSpec = {
    schemaVersion: MOVE_SPEC_SCHEMA_VERSION,
    canonicalId: parseBoundedText(
      root.canonicalId,
      'spec.canonicalId',
      MOVE_SPEC_LIMITS.identifierLength,
    ),
    version: parsePositiveVersion(root.version, 'spec.version'),
    targeting: parseTargeting(root.targeting),
    preconditions: parsePreconditions(root.preconditions),
    costs: parseCosts(root.costs),
    phases: parsePhaseBlocks(root.phases),
    registeredHandlerId: root.registeredHandlerId === null
      ? null
      : parseStableId(root.registeredHandlerId, 'spec.registeredHandlerId'),
    presentation: parsePresentation(root.presentation),
  }

  return deepFreeze(spec)
}
