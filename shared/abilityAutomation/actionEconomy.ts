import type { CanonicalAbilityCatalog } from './ruleset'
import type { AbilityFrequencyDeclaration } from './frequency'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_ACTION_EXCEPTION_SCHEMA_VERSION = 1 as const
export const ABILITY_ACTION_COSTS = [
  'none',
  'standard',
  'shift',
  'swift',
  'free',
  'full',
  'extended',
  'special',
] as const
export const ABILITY_ACTION_TIMINGS = [
  'passive',
  'normal',
  'priority',
  'interrupt',
  'reaction',
  'triggered',
] as const
export const ABILITY_ACTION_AVAILABILITY_POOLS = ['interrupt-reaction'] as const

export type AbilityActionCost = (typeof ABILITY_ACTION_COSTS)[number]
export type AbilityActionTiming = (typeof ABILITY_ACTION_TIMINGS)[number]
export type AbilityActionAvailabilityPool =
  (typeof ABILITY_ACTION_AVAILABILITY_POOLS)[number]

export interface AbilityActionVariant {
  readonly id: string
  readonly cost: AbilityActionCost
  readonly timing: AbilityActionTiming
  readonly availabilityPool: AbilityActionAvailabilityPool | null
}

export interface AbilityActionException {
  readonly canonicalId: string
  readonly rawActionText: string | null
  readonly exceptionId: string
  readonly variants: readonly AbilityActionVariant[]
}

export interface AbilityActionExceptionCatalog {
  readonly schemaVersion: typeof ABILITY_ACTION_EXCEPTION_SCHEMA_VERSION
  readonly sourceDataSha256: string
  readonly entries: readonly AbilityActionException[]
}

export interface AbilityActionDeclaration {
  readonly kind: 'passive' | 'action'
  readonly rawActionText: string | null
  readonly exceptionId: string | null
  readonly variants: readonly AbilityActionVariant[]
}

export type AbilityActionValidationCode =
  | 'invalid-action'
  | 'invalid-exception-catalog'
  | 'unknown-ability'
  | 'source-mismatch'
  | 'duplicate-id'
  | 'missing-exception'
  | 'unexpected-exception'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityActionValidationError extends Error {
  readonly code: AbilityActionValidationCode
  readonly path: string

  constructor(code: AbilityActionValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityActionValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sourceDataSha256', 'entries'] as const
const ENTRY_FIELDS = ['canonicalId', 'rawActionText', 'exceptionId', 'variants'] as const
const VARIANT_FIELDS = ['id', 'cost', 'timing', 'availabilityPool'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COST_SET = new Set<string>(ABILITY_ACTION_COSTS)
const TIMING_SET = new Set<string>(ABILITY_ACTION_TIMINGS)
const POOL_SET = new Set<string>(ABILITY_ACTION_AVAILABILITY_POOLS)
const ACTION_PATTERN = /^(Standard|Shift|Swift|Free|Full|Extended) Action(?:, (Priority|Interrupt|Reaction))?$/

const fail = (code: AbilityActionValidationCode, path: string, detail: string): never => {
  throw new AbilityActionValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 6,
    nodes: 2_048,
    objectFields: 8,
    arrayEntries: 64,
    stringLength: 500,
    objectKeyLength: 160,
  },
  rootLabel: 'ability action data',
  valueLabel: 'ability action declarations',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-exception-catalog', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) {
    fail('invalid-exception-catalog', path, 'has an invalid shape.')
  }
}

const text = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 500
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail('invalid-exception-catalog', path, 'must be bounded trimmed text.')
  }
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (id.length > 160 || !STABLE_ID_PATTERN.test(id)) {
    fail('invalid-exception-catalog', path, 'must be a stable identifier.')
  }
  return id
}

const validateVariant = (
  value: unknown,
  path: string,
): AbilityActionVariant => {
  const input = record(value, path)
  exact(input, VARIANT_FIELDS, path)
  if (typeof input.cost !== 'string' || !COST_SET.has(input.cost)) {
    fail('invalid-exception-catalog', `${path}.cost`, 'is unsupported.')
  }
  if (typeof input.timing !== 'string' || !TIMING_SET.has(input.timing)) {
    fail('invalid-exception-catalog', `${path}.timing`, 'is unsupported.')
  }
  const availabilityPool = input.availabilityPool === null
    ? null
    : typeof input.availabilityPool === 'string' && POOL_SET.has(input.availabilityPool)
      ? input.availabilityPool as AbilityActionAvailabilityPool
      : fail('invalid-exception-catalog', `${path}.availabilityPool`, 'is unsupported.')
  const reactive = input.timing === 'interrupt' || input.timing === 'reaction'
  if (reactive !== (availabilityPool === 'interrupt-reaction')) {
    fail(
      'invalid-exception-catalog',
      path,
      'Interrupt and Reaction variants must use the shared interrupt-reaction pool.',
    )
  }
  if ((input.timing === 'triggered') !== (input.cost === 'none')) {
    fail('invalid-exception-catalog', path, 'only no-cost triggered variants use triggered timing.')
  }
  return Object.freeze({
    id: stableId(input.id, `${path}.id`),
    cost: input.cost as AbilityActionCost,
    timing: input.timing as AbilityActionTiming,
    availabilityPool,
  })
}

export const parseAbilityActionExceptionCatalog = (
  value: unknown,
  catalog: CanonicalAbilityCatalog,
  frequencies: ReadonlyMap<string, AbilityFrequencyDeclaration>,
): AbilityActionExceptionCatalog => {
  const root = record(clone(value, 'actionExceptions'), 'actionExceptions')
  exact(root, ROOT_FIELDS, 'actionExceptions')
  if (root.schemaVersion !== ABILITY_ACTION_EXCEPTION_SCHEMA_VERSION) {
    fail('invalid-exception-catalog', 'actionExceptions.schemaVersion', 'is unsupported.')
  }
  if (
    typeof root.sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(root.sourceDataSha256)
    || root.sourceDataSha256 !== catalog.sourceDataSha256
  ) {
    fail('source-mismatch', 'actionExceptions.sourceDataSha256', 'must match canonical rules data.')
  }
  if (!Array.isArray(root.entries) || root.entries.length > 32) {
    fail('limit-exceeded', 'actionExceptions.entries', 'must be a bounded array.')
  }
  const canonicalOrder = new Map(catalog.abilities.map((ability, index) => [ability.canonicalId, index]))
  const entries = (root.entries as readonly unknown[]).map((value, index): AbilityActionException => {
    const path = `actionExceptions.entries[${index}]`
    const input = record(value, path)
    exact(input, ENTRY_FIELDS, path)
    const canonicalId = text(input.canonicalId, `${path}.canonicalId`)
    if (!canonicalOrder.has(canonicalId)) {
      fail('unknown-ability', `${path}.canonicalId`, 'does not identify a canonical ability.')
    }
    const rawActionText = input.rawActionText === null
      ? null
      : text(input.rawActionText, `${path}.rawActionText`)
    if (frequencies.get(canonicalId)?.actionText !== rawActionText) {
      fail('source-mismatch', `${path}.rawActionText`, 'must match parsed canonical action text.')
    }
    if (!Array.isArray(input.variants) || input.variants.length === 0 || input.variants.length > 16) {
      fail('limit-exceeded', `${path}.variants`, 'must be a bounded non-empty array.')
    }
    const variants = (input.variants as readonly unknown[]).map((variant, variantIndex) => (
      validateVariant(variant, `${path}.variants[${variantIndex}]`)
    ))
    if (new Set(variants.map(variant => variant.id)).size !== variants.length) {
      fail('duplicate-id', `${path}.variants`, 'must not repeat variant IDs.')
    }
    return Object.freeze({
      canonicalId,
      rawActionText,
      exceptionId: stableId(input.exceptionId, `${path}.exceptionId`),
      variants: Object.freeze(variants),
    })
  })
  if (new Set(entries.map(entry => entry.canonicalId)).size !== entries.length) {
    fail('duplicate-id', 'actionExceptions.entries', 'must not repeat abilities.')
  }
  if (entries.some((entry, index) => (
    index > 0
    && canonicalOrder.get(entry.canonicalId)! <= canonicalOrder.get(entries[index - 1]!.canonicalId)!
  ))) {
    fail('invalid-exception-catalog', 'actionExceptions.entries', 'must use canonical order.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_ACTION_EXCEPTION_SCHEMA_VERSION,
    sourceDataSha256: root.sourceDataSha256 as string,
    entries,
  })
}

const normalVariant = (actionText: string): AbilityActionVariant | null => {
  const match = ACTION_PATTERN.exec(actionText)
  if (!match) return null
  const cost = match[1]!.toLowerCase() as Exclude<AbilityActionCost, 'none' | 'special'>
  const timing = (match[2]?.toLowerCase() ?? 'normal') as AbilityActionTiming
  return Object.freeze({
    id: 'use',
    cost,
    timing,
    availabilityPool: timing === 'interrupt' || timing === 'reaction'
      ? 'interrupt-reaction'
      : null,
  })
}

export const parseAbilityActionDeclaration = (
  canonicalId: string,
  frequency: AbilityFrequencyDeclaration,
  exceptions: AbilityActionExceptionCatalog,
): AbilityActionDeclaration => {
  const exception = exceptions.entries.find(entry => entry.canonicalId === canonicalId) ?? null
  if (frequency.kind === 'static') {
    if (exception) fail('unexpected-exception', `action.${canonicalId}`, 'Static cannot have an action exception.')
    return Object.freeze({
      kind: 'passive',
      rawActionText: null,
      exceptionId: null,
      variants: Object.freeze([{
        id: 'passive',
        cost: 'none',
        timing: 'passive',
        availabilityPool: null,
      } as const]),
    })
  }
  if (exception) {
    return Object.freeze({
      kind: 'action',
      rawActionText: frequency.actionText,
      exceptionId: exception.exceptionId,
      variants: exception.variants,
    })
  }
  if (frequency.actionText === null) {
    return fail('missing-exception', `action.${canonicalId}`, 'missing action text requires reviewed timing.')
  }
  if (frequency.actionText === 'Special' || frequency.actionText === 'Move Action') {
    return fail('missing-exception', `action.${canonicalId}`, 'special action text requires reviewed variants.')
  }
  const variant = normalVariant(frequency.actionText)
    ?? fail('invalid-action', `action.${canonicalId}`, 'has unsupported action syntax.')
  return Object.freeze({
    kind: 'action',
    rawActionText: frequency.actionText,
    exceptionId: null,
    variants: Object.freeze([variant]),
  })
}

export const parseCanonicalAbilityActions = (
  catalog: CanonicalAbilityCatalog,
  frequencies: ReadonlyMap<string, AbilityFrequencyDeclaration>,
  exceptions: AbilityActionExceptionCatalog,
): ReadonlyMap<string, AbilityActionDeclaration> => {
  const result = new Map<string, AbilityActionDeclaration>()
  for (const ability of catalog.abilities) {
    const frequency = frequencies.get(ability.canonicalId)
      ?? fail('invalid-action', `action.${ability.canonicalId}`, 'has no parsed frequency.')
    result.set(
      ability.canonicalId,
      parseAbilityActionDeclaration(ability.canonicalId, frequency, exceptions),
    )
  }
  for (const exception of exceptions.entries) {
    if (result.get(exception.canonicalId)?.exceptionId !== exception.exceptionId) {
      fail('unexpected-exception', `action.${exception.canonicalId}`, 'exception is not consumed.')
    }
  }
  return result
}
