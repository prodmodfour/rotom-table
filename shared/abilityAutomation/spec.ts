import {
  cloneStrictJson,
  deepFreezeStrictJson,
  isPlainJsonObject,
  type StrictJsonObject,
  type StrictJsonValue,
} from '../automation/strictJson'

export const ABILITY_SPEC_SCHEMA_VERSION = 1 as const

export const ABILITY_SPEC_MODE_KINDS = ['static', 'activated', 'triggered'] as const
export const ABILITY_SPEC_TRIGGER_RESPONSES = ['mandatory', 'optional'] as const
export const ABILITY_SPEC_PHASES = [
  'eligibility',
  'reserve',
  'pay',
  'target',
  'pre-effect',
  'effect',
  'after-effect',
  'schedule',
  'cleanup',
] as const
export const ABILITY_SPEC_TARGETING_KINDS = [
  'none',
  'self',
  'token',
  'side',
  'area',
  'field',
  'cell',
  'direction',
  'type',
  'stat',
  'move',
  'ability',
  'item',
  'branch',
] as const

export type AbilitySpecModeKind = (typeof ABILITY_SPEC_MODE_KINDS)[number]
export type AbilitySpecTriggerResponse = (typeof ABILITY_SPEC_TRIGGER_RESPONSES)[number]
export type AbilitySpecPhase = (typeof ABILITY_SPEC_PHASES)[number]
export type AbilitySpecTargetingKind = (typeof ABILITY_SPEC_TARGETING_KINDS)[number]
export type AbilitySpecJsonValue = StrictJsonValue
export type AbilitySpecJsonObject = StrictJsonObject

/** Syntax-only extension points; dedicated closed parsers own their semantics. */
export type AbilitySpecSelector = AbilitySpecJsonObject
export type AbilitySpecPredicate = AbilitySpecJsonObject
export type AbilitySpecCost = AbilitySpecJsonObject
export type AbilitySpecEffectOperation = AbilitySpecJsonObject

export interface AbilitySpecModeDeclaration {
  readonly id: string
  readonly kind: AbilitySpecModeKind
}

export interface AbilitySpecSubscription {
  readonly id: string
  readonly modeId: string
  readonly eventKind: string
  readonly checkpoint: string
  readonly response: AbilitySpecTriggerResponse
  readonly priority: number
  readonly predicate: AbilitySpecPredicate | null
}

export interface AbilitySpecTargetingDeclaration {
  readonly id: string
  readonly modeId: string
  readonly kind: AbilitySpecTargetingKind
  readonly minSelections: number
  readonly maxSelections: number
  readonly selector: AbilitySpecSelector | null
  readonly predicate: AbilitySpecPredicate | null
}

export interface AbilitySpecPrecondition {
  readonly id: string
  readonly modeId: string
  readonly predicate: AbilitySpecPredicate
  readonly failureReasonCode: string
}

export interface AbilitySpecCostDeclaration {
  readonly id: string
  readonly modeId: string
  readonly phase: AbilitySpecPhase
  readonly cost: AbilitySpecCost
}

export interface AbilitySpecPhaseBlock {
  readonly modeId: string
  readonly phase: AbilitySpecPhase
  readonly operations: readonly AbilitySpecEffectOperation[]
}

export interface AbilitySpecPresentationMetadata {
  readonly displayName: string
  /** Authorized presentation lookup; never executable mechanics or automatic disclosure. */
  readonly summaryKey: string
  readonly vfxKey: string | null
  readonly tags: readonly string[]
}

export interface AbilitySpecV1 {
  readonly schemaVersion: typeof ABILITY_SPEC_SCHEMA_VERSION
  readonly canonicalId: string
  readonly version: number
  readonly modes: readonly AbilitySpecModeDeclaration[]
  readonly subscriptions: readonly AbilitySpecSubscription[]
  readonly targeting: readonly AbilitySpecTargetingDeclaration[]
  readonly preconditions: readonly AbilitySpecPrecondition[]
  readonly costs: readonly AbilitySpecCostDeclaration[]
  readonly phases: readonly AbilitySpecPhaseBlock[]
  readonly registeredHandlerId: string | null
  readonly presentation: AbilitySpecPresentationMetadata
}

export type AbilitySpec = AbilitySpecV1

export const ABILITY_SPEC_LIMITS = Object.freeze({
  identifierLength: 160,
  displayNameLength: 160,
  modes: 8,
  subscriptions: 128,
  targetingDeclarations: 64,
  selections: 32,
  preconditions: 128,
  costs: 64,
  phaseBlocks: 72,
  operationsPerPhase: 128,
  totalOperations: 512,
  totalDeclarations: 512,
  presentationTags: 32,
  triggerPriorityMagnitude: 10_000,
  jsonDepth: 24,
  jsonNodes: 16_384,
  jsonObjectFields: 128,
  jsonArrayEntries: 512,
  jsonStringLength: 1_000,
})

export type AbilitySpecEnvelopeValidationCode =
  | 'invalid-spec'
  | 'unsupported-schema-version'
  | 'not-json'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'unknown-mode-reference'

export class AbilitySpecEnvelopeValidationError extends Error {
  readonly code: AbilitySpecEnvelopeValidationCode
  readonly path: string

  constructor(code: AbilitySpecEnvelopeValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilitySpecEnvelopeValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = [
  'schemaVersion',
  'canonicalId',
  'version',
  'modes',
  'subscriptions',
  'targeting',
  'preconditions',
  'costs',
  'phases',
  'registeredHandlerId',
  'presentation',
] as const
const MODE_FIELDS = ['id', 'kind'] as const
const SUBSCRIPTION_FIELDS = [
  'id',
  'modeId',
  'eventKind',
  'checkpoint',
  'response',
  'priority',
  'predicate',
] as const
const TARGETING_FIELDS = [
  'id',
  'modeId',
  'kind',
  'minSelections',
  'maxSelections',
  'selector',
  'predicate',
] as const
const PRECONDITION_FIELDS = ['id', 'modeId', 'predicate', 'failureReasonCode'] as const
const COST_FIELDS = ['id', 'modeId', 'phase', 'cost'] as const
const PHASE_FIELDS = ['modeId', 'phase', 'operations'] as const
const PRESENTATION_FIELDS = ['displayName', 'summaryKey', 'vfxKey', 'tags'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const MODE_SET = new Set<string>(ABILITY_SPEC_MODE_KINDS)
const RESPONSE_SET = new Set<string>(ABILITY_SPEC_TRIGGER_RESPONSES)
const PHASE_SET = new Set<string>(ABILITY_SPEC_PHASES)
const TARGETING_SET = new Set<string>(ABILITY_SPEC_TARGETING_KINDS)

const fail = (
  code: AbilitySpecEnvelopeValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilitySpecEnvelopeValidationError(code, path, detail)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-spec', path, 'must be a plain object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    fail(
      'invalid-spec',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const boundedText = (value: unknown, path: string, maximum: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail('invalid-spec', path, 'must be a non-empty trimmed single-line string.')
  }
  if (value.length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = boundedText(value, path, ABILITY_SPEC_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-spec', path, 'must be a lowercase stable identifier.')
  return id
}

const positiveVersion = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('invalid-spec', path, 'must be a positive safe integer.')
  }
  return Number(value)
}

const boundedArray = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-spec', path, 'must be an array.')
  if (value.length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return value
}

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must contain unique IDs.')
}

const enumValue = <Value extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
): Value => {
  if (typeof value !== 'string' || !allowed.has(value)) {
    return fail('invalid-spec', path, 'contains an unsupported value.')
  }
  return value as Value
}

const dataObject = (value: unknown, path: string): AbilitySpecJsonObject => (
  record(value, path) as AbilitySpecJsonObject
)

const modeReference = (value: unknown, path: string, modeIds: ReadonlySet<string>): string => {
  const modeId = stableId(value, path)
  if (!modeIds.has(modeId)) fail('unknown-mode-reference', path, `references unknown mode ${modeId}.`)
  return modeId
}

const selectionCount = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > ABILITY_SPEC_LIMITS.selections
  ) {
    return fail(
      'invalid-spec',
      path,
      `must be a safe integer from 0 through ${ABILITY_SPEC_LIMITS.selections}.`,
    )
  }
  return Number(value)
}

const parseModes = (value: unknown): readonly AbilitySpecModeDeclaration[] => {
  const path = 'abilitySpec.modes'
  const modes = boundedArray(value, path, ABILITY_SPEC_LIMITS.modes)
    .map((value, index): AbilitySpecModeDeclaration => {
      const entryPath = `${path}[${index}]`
      const input = record(value, entryPath)
      exact(input, MODE_FIELDS, entryPath)
      return {
        id: stableId(input.id, `${entryPath}.id`),
        kind: enumValue<AbilitySpecModeKind>(input.kind, MODE_SET, `${entryPath}.kind`),
      }
    })
  if (modes.length === 0) fail('invalid-spec', path, 'must contain at least one mode.')
  unique(modes.map(mode => mode.id), `${path}.id`)
  return modes
}

const parseSubscriptions = (
  value: unknown,
  modeIds: ReadonlySet<string>,
): readonly AbilitySpecSubscription[] => {
  const path = 'abilitySpec.subscriptions'
  const subscriptions = boundedArray(value, path, ABILITY_SPEC_LIMITS.subscriptions)
    .map((value, index): AbilitySpecSubscription => {
      const entryPath = `${path}[${index}]`
      const input = record(value, entryPath)
      exact(input, SUBSCRIPTION_FIELDS, entryPath)
      if (
        !Number.isSafeInteger(input.priority)
        || Math.abs(Number(input.priority)) > ABILITY_SPEC_LIMITS.triggerPriorityMagnitude
      ) {
        fail('invalid-spec', `${entryPath}.priority`, 'must be a bounded safe integer.')
      }
      return {
        id: stableId(input.id, `${entryPath}.id`),
        modeId: modeReference(input.modeId, `${entryPath}.modeId`, modeIds),
        eventKind: stableId(input.eventKind, `${entryPath}.eventKind`),
        checkpoint: stableId(input.checkpoint, `${entryPath}.checkpoint`),
        response: enumValue<AbilitySpecTriggerResponse>(
          input.response,
          RESPONSE_SET,
          `${entryPath}.response`,
        ),
        priority: Number(input.priority),
        predicate: input.predicate === null
          ? null
          : dataObject(input.predicate, `${entryPath}.predicate`),
      }
    })
  unique(subscriptions.map(subscription => subscription.id), `${path}.id`)
  return subscriptions
}

const parseTargeting = (
  value: unknown,
  modeIds: ReadonlySet<string>,
): readonly AbilitySpecTargetingDeclaration[] => {
  const path = 'abilitySpec.targeting'
  const declarations = boundedArray(value, path, ABILITY_SPEC_LIMITS.targetingDeclarations)
    .map((value, index): AbilitySpecTargetingDeclaration => {
      const entryPath = `${path}[${index}]`
      const input = record(value, entryPath)
      exact(input, TARGETING_FIELDS, entryPath)
      const minSelections = selectionCount(input.minSelections, `${entryPath}.minSelections`)
      const maxSelections = selectionCount(input.maxSelections, `${entryPath}.maxSelections`)
      if (minSelections > maxSelections) {
        fail('invalid-spec', entryPath, 'minSelections cannot exceed maxSelections.')
      }
      return {
        id: stableId(input.id, `${entryPath}.id`),
        modeId: modeReference(input.modeId, `${entryPath}.modeId`, modeIds),
        kind: enumValue<AbilitySpecTargetingKind>(input.kind, TARGETING_SET, `${entryPath}.kind`),
        minSelections,
        maxSelections,
        selector: input.selector === null ? null : dataObject(input.selector, `${entryPath}.selector`),
        predicate: input.predicate === null ? null : dataObject(input.predicate, `${entryPath}.predicate`),
      }
    })
  unique(declarations.map(declaration => declaration.id), `${path}.id`)
  return declarations
}

const parsePreconditions = (
  value: unknown,
  modeIds: ReadonlySet<string>,
): readonly AbilitySpecPrecondition[] => {
  const path = 'abilitySpec.preconditions'
  const preconditions = boundedArray(value, path, ABILITY_SPEC_LIMITS.preconditions)
    .map((value, index): AbilitySpecPrecondition => {
      const entryPath = `${path}[${index}]`
      const input = record(value, entryPath)
      exact(input, PRECONDITION_FIELDS, entryPath)
      return {
        id: stableId(input.id, `${entryPath}.id`),
        modeId: modeReference(input.modeId, `${entryPath}.modeId`, modeIds),
        predicate: dataObject(input.predicate, `${entryPath}.predicate`),
        failureReasonCode: stableId(input.failureReasonCode, `${entryPath}.failureReasonCode`),
      }
    })
  unique(preconditions.map(precondition => precondition.id), `${path}.id`)
  return preconditions
}

const parseCosts = (
  value: unknown,
  modeIds: ReadonlySet<string>,
): readonly AbilitySpecCostDeclaration[] => {
  const path = 'abilitySpec.costs'
  const costs = boundedArray(value, path, ABILITY_SPEC_LIMITS.costs)
    .map((value, index): AbilitySpecCostDeclaration => {
      const entryPath = `${path}[${index}]`
      const input = record(value, entryPath)
      exact(input, COST_FIELDS, entryPath)
      return {
        id: stableId(input.id, `${entryPath}.id`),
        modeId: modeReference(input.modeId, `${entryPath}.modeId`, modeIds),
        phase: enumValue<AbilitySpecPhase>(input.phase, PHASE_SET, `${entryPath}.phase`),
        cost: dataObject(input.cost, `${entryPath}.cost`),
      }
    })
  unique(costs.map(cost => cost.id), `${path}.id`)
  return costs
}

const parsePhases = (
  value: unknown,
  modeIds: ReadonlySet<string>,
): readonly AbilitySpecPhaseBlock[] => {
  const path = 'abilitySpec.phases'
  let totalOperations = 0
  return boundedArray(value, path, ABILITY_SPEC_LIMITS.phaseBlocks)
    .map((value, index): AbilitySpecPhaseBlock => {
      const entryPath = `${path}[${index}]`
      const input = record(value, entryPath)
      exact(input, PHASE_FIELDS, entryPath)
      const operations = boundedArray(
        input.operations,
        `${entryPath}.operations`,
        ABILITY_SPEC_LIMITS.operationsPerPhase,
      ).map((operation, operationIndex) => dataObject(
        operation,
        `${entryPath}.operations[${operationIndex}]`,
      ))
      totalOperations += operations.length
      if (totalOperations > ABILITY_SPEC_LIMITS.totalOperations) {
        fail('limit-exceeded', path, `must contain at most ${ABILITY_SPEC_LIMITS.totalOperations} operations.`)
      }
      return {
        modeId: modeReference(input.modeId, `${entryPath}.modeId`, modeIds),
        phase: enumValue<AbilitySpecPhase>(input.phase, PHASE_SET, `${entryPath}.phase`),
        operations,
      }
    })
}

const parsePresentation = (value: unknown): AbilitySpecPresentationMetadata => {
  const path = 'abilitySpec.presentation'
  const input = record(value, path)
  exact(input, PRESENTATION_FIELDS, path)
  const tags = boundedArray(input.tags, `${path}.tags`, ABILITY_SPEC_LIMITS.presentationTags)
    .map((tag, index) => stableId(tag, `${path}.tags[${index}]`))
  unique(tags, `${path}.tags`)
  return {
    displayName: boundedText(input.displayName, `${path}.displayName`, ABILITY_SPEC_LIMITS.displayNameLength),
    summaryKey: stableId(input.summaryKey, `${path}.summaryKey`),
    vfxKey: input.vfxKey === null ? null : stableId(input.vfxKey, `${path}.vfxKey`),
    tags,
  }
}

/**
 * Parse, detach, and deeply freeze the strict AbilitySpec v1 envelope.
 * Dedicated validators own extension-node semantics and cross-mode invariants.
 */
export const parseAbilitySpecEnvelope = (value: unknown): AbilitySpecV1 => {
  const detached = cloneStrictJson(value, 'abilitySpec', {
    limits: {
      depth: ABILITY_SPEC_LIMITS.jsonDepth,
      nodes: ABILITY_SPEC_LIMITS.jsonNodes,
      objectFields: ABILITY_SPEC_LIMITS.jsonObjectFields,
      arrayEntries: ABILITY_SPEC_LIMITS.jsonArrayEntries,
      stringLength: ABILITY_SPEC_LIMITS.jsonStringLength,
      objectKeyLength: ABILITY_SPEC_LIMITS.identifierLength,
    },
    rootLabel: 'ability spec data',
    valueLabel: 'AbilitySpecs',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  const root = record(detached, 'abilitySpec')
  exact(root, ROOT_FIELDS, 'abilitySpec')
  if (root.schemaVersion !== ABILITY_SPEC_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      'abilitySpec.schemaVersion',
      `must be ${ABILITY_SPEC_SCHEMA_VERSION}.`,
    )
  }

  const modes = parseModes(root.modes)
  const modeIds = new Set(modes.map(mode => mode.id))
  const subscriptions = parseSubscriptions(root.subscriptions, modeIds)
  const targeting = parseTargeting(root.targeting, modeIds)
  const preconditions = parsePreconditions(root.preconditions, modeIds)
  const costs = parseCosts(root.costs, modeIds)
  const phases = parsePhases(root.phases, modeIds)
  const declarationIds = [
    ...modes.map(mode => mode.id),
    ...subscriptions.map(subscription => subscription.id),
    ...targeting.map(declaration => declaration.id),
    ...preconditions.map(precondition => precondition.id),
    ...costs.map(cost => cost.id),
  ]
  if (declarationIds.length > ABILITY_SPEC_LIMITS.totalDeclarations) {
    fail(
      'limit-exceeded',
      'abilitySpec',
      `must contain at most ${ABILITY_SPEC_LIMITS.totalDeclarations} declarations.`,
    )
  }
  unique(declarationIds, 'abilitySpec.declarationIds')

  return deepFreezeStrictJson({
    schemaVersion: ABILITY_SPEC_SCHEMA_VERSION,
    canonicalId: boundedText(
      root.canonicalId,
      'abilitySpec.canonicalId',
      ABILITY_SPEC_LIMITS.identifierLength,
    ),
    version: positiveVersion(root.version, 'abilitySpec.version'),
    modes,
    subscriptions,
    targeting,
    preconditions,
    costs,
    phases,
    registeredHandlerId: root.registeredHandlerId === null
      ? null
      : stableId(root.registeredHandlerId, 'abilitySpec.registeredHandlerId'),
    presentation: parsePresentation(root.presentation),
  })
}
