import {
  ABILITY_DECLARATION_STAT_IDS,
  type AbilityDeclarationStatId,
} from './declarationIntent'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_STAT_OPTIONS_PREDICATE_KIND = 'ability-stat-options' as const

export interface AbilityStatOptionsPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_STAT_OPTIONS_PREDICATE_KIND
  readonly statIds: readonly AbilityDeclarationStatId[]
}

export class AbilityStatOptionsPredicateValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityStatOptionsPredicateValidationError'
  }
}

const fail = (path: string, detail: string): never => {
  throw new AbilityStatOptionsPredicateValidationError(path, detail)
}

/** Strictly parse the reviewed subset offered by a stat declaration. */
export const parseAbilityStatOptionsPredicate = (
  value: unknown,
  path = 'abilityStatOptionsPredicate',
): AbilityStatOptionsPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 3, nodes: 64, objectFields: 2, arrayEntries: 8, stringLength: 32, objectKeyLength: 32 },
    rootLabel: 'ability stat option predicate', valueLabel: 'ability stat option predicates',
    failNotJson: (failurePath, detail) => fail(failurePath, detail),
    failLimit: (failurePath, detail) => fail(failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail(path, 'must be an object.')
  const input = cloned as Record<string, unknown>
  if (Object.keys(input).length !== 2
    || input.kind !== ABILITY_STAT_OPTIONS_PREDICATE_KIND
    || !Object.prototype.hasOwnProperty.call(input, 'statIds')
    || !Array.isArray(input.statIds)
    || input.statIds.length === 0
    || input.statIds.length > ABILITY_DECLARATION_STAT_IDS.length) {
    fail(path, 'has an invalid bounded shape.')
  }
  const statIds = (input.statIds as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || !ABILITY_DECLARATION_STAT_IDS.includes(entry as AbilityDeclarationStatId)) {
      return fail(`${path}.statIds[${index}]`, 'is not a supported stat ID.')
    }
    return entry as AbilityDeclarationStatId
  })
  const indexes = statIds.map(statId => ABILITY_DECLARATION_STAT_IDS.indexOf(statId))
  if (new Set(statIds).size !== statIds.length
    || indexes.some((entry, index) => index > 0 && entry <= indexes[index - 1]!)) {
    fail(`${path}.statIds`, 'must contain unique canonical-order IDs.')
  }
  return deepFreezeStrictJson({
    kind: ABILITY_STAT_OPTIONS_PREDICATE_KIND,
    statIds,
  }) as AbilityStatOptionsPredicate
}
