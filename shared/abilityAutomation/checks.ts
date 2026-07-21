import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_CHECK_OPERATION_KIND = 'ability-check' as const
export const ABILITY_CHECK_KINDS = ['check', 'save', 'contest'] as const
export const ABILITY_CHECK_COMPARISONS = ['at-least', 'at-most'] as const
export const ABILITY_CHECK_REROLL_TRIGGERS = ['always', 'on-failure', 'on-success'] as const
export const ABILITY_CHECK_REROLL_SELECTIONS = ['replace', 'highest', 'lowest'] as const
export const ABILITY_CONTEST_TIE_POLICIES = ['initiator', 'defender', 'no-winner'] as const

export type AbilityCheckKind = (typeof ABILITY_CHECK_KINDS)[number]
export type AbilityCheckComparison = (typeof ABILITY_CHECK_COMPARISONS)[number]
export type AbilityCheckRerollTrigger = (typeof ABILITY_CHECK_REROLL_TRIGGERS)[number]
export type AbilityCheckRerollSelection = (typeof ABILITY_CHECK_REROLL_SELECTIONS)[number]
export type AbilityContestTiePolicy = (typeof ABILITY_CONTEST_TIE_POLICIES)[number]

export interface AbilityCheckModifier extends AbilitySpecJsonObject {
  readonly sourceId: string
  readonly reason: string
  readonly value: number
}
export interface AbilityCheckRerollSource extends AbilitySpecJsonObject {
  readonly id: string
  readonly maximumUses: number
}
export interface AbilityCheckFormula extends AbilitySpecJsonObject {
  readonly kind: 'dice'
  readonly count: number
  readonly sides: number
  readonly modifier: number
}
export interface AbilityCheckThreshold extends AbilitySpecJsonObject {
  readonly comparison: AbilityCheckComparison
  readonly value: number
}
export interface AbilityCheckRerollPolicy extends AbilitySpecJsonObject {
  readonly trigger: AbilityCheckRerollTrigger
  readonly selection: AbilityCheckRerollSelection
  readonly maximumRerolls: number
  readonly sources: readonly AbilityCheckRerollSource[]
}
export interface AbilityCheckDefinition extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_CHECK_OPERATION_KIND
  readonly checkId: string
  readonly checkKind: AbilityCheckKind
  readonly parentEffectId: string
  readonly formula: AbilityCheckFormula
  readonly modifiers: readonly AbilityCheckModifier[]
  readonly threshold: AbilityCheckThreshold | null
  readonly reroll: AbilityCheckRerollPolicy
}

export interface AbilityCheckAttempt {
  readonly attempt: number
  readonly rollId: string
  readonly parentRollId: string | null
  readonly rerollSourceId: string | null
  readonly naturalResults: readonly number[]
  readonly naturalResult: number
  readonly modifiedResult: number
  readonly finalValue: number
  readonly success: boolean | null
}
export interface AbilityCheckResolution {
  readonly schemaVersion: 1
  readonly resolutionId: string
  readonly checkId: string
  readonly checkKind: AbilityCheckKind
  readonly attempts: readonly AbilityCheckAttempt[]
  readonly selectedAttempt: number
  readonly finalValue: number
  readonly success: boolean | null
}
export interface AbilityContestResolution {
  readonly schemaVersion: 1
  readonly contestId: string
  readonly initiator: AbilityCheckResolution
  readonly defender: AbilityCheckResolution
  readonly tiePolicy: AbilityContestTiePolicy
  readonly winner: 'initiator' | 'defender' | null
}

export class AbilityCheckValidationError extends Error {
  constructor(readonly code: 'invalid-check' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityCheckValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['kind', 'checkId', 'checkKind', 'parentEffectId', 'formula', 'modifiers', 'threshold', 'reroll'] as const
const FORMULA_FIELDS = ['kind', 'count', 'sides', 'modifier'] as const
const MODIFIER_FIELDS = ['sourceId', 'reason', 'value'] as const
const THRESHOLD_FIELDS = ['comparison', 'value'] as const
const REROLL_FIELDS = ['trigger', 'selection', 'maximumRerolls', 'sources'] as const
const SOURCE_FIELDS = ['id', 'maximumUses'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityCheckValidationError['code'], path: string, detail: string): never => {
  throw new AbilityCheckValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-check', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-check', path, 'has invalid shape.')
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-check', path, 'must be a stable ID.')
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('invalid-check', path, 'must be bounded text.')
  }
  return value as string
}
const boundedInteger = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('invalid-check', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value) ? value as Value : fail('invalid-check', path, 'is unsupported.')
)

export const parseAbilityCheckDefinition = (
  value: unknown,
  path = 'abilityCheck',
): AbilityCheckDefinition => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 7, nodes: 2_048, objectFields: 16, arrayEntries: 128, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability check definition', valueLabel: 'ability check definitions',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.kind !== ABILITY_CHECK_OPERATION_KIND) fail('invalid-check', `${path}.kind`, 'is unsupported.')
  const checkKind = oneOf(input.checkKind, `${path}.checkKind`, ABILITY_CHECK_KINDS)
  const formulaInput = record(input.formula, `${path}.formula`)
  exact(formulaInput, FORMULA_FIELDS, `${path}.formula`)
  if (formulaInput.kind !== 'dice') fail('invalid-check', `${path}.formula.kind`, 'must be dice.')
  if (!Array.isArray(input.modifiers) || input.modifiers.length > 64) {
    fail('limit-exceeded', `${path}.modifiers`, 'must be bounded.')
  }
  const modifiers = (input.modifiers as readonly unknown[]).map((entry, index): AbilityCheckModifier => {
    const entryPath = `${path}.modifiers[${index}]`
    const modifier = record(entry, entryPath)
    exact(modifier, MODIFIER_FIELDS, entryPath)
    return Object.freeze({
      sourceId: stableId(modifier.sourceId, `${entryPath}.sourceId`),
      reason: text(modifier.reason, `${entryPath}.reason`),
      value: boundedInteger(modifier.value, `${entryPath}.value`, -1_000_000, 1_000_000),
    })
  })
  if (new Set(modifiers.map(modifier => modifier.sourceId)).size !== modifiers.length) {
    fail('duplicate-id', `${path}.modifiers`, 'must not repeat source IDs.')
  }
  let threshold: AbilityCheckDefinition['threshold'] = null
  if (input.threshold !== null) {
    const thresholdInput = record(input.threshold, `${path}.threshold`)
    exact(thresholdInput, THRESHOLD_FIELDS, `${path}.threshold`)
    threshold = Object.freeze({
      comparison: oneOf(thresholdInput.comparison, `${path}.threshold.comparison`, ABILITY_CHECK_COMPARISONS),
      value: boundedInteger(thresholdInput.value, `${path}.threshold.value`, -1_000_000, 1_000_000),
    })
  }
  if ((checkKind === 'contest') !== (threshold === null)) {
    fail('invalid-check', `${path}.threshold`, 'contest checks alone omit a threshold.')
  }
  const rerollInput = record(input.reroll, `${path}.reroll`)
  exact(rerollInput, REROLL_FIELDS, `${path}.reroll`)
  if (!Array.isArray(rerollInput.sources) || rerollInput.sources.length > 32) {
    fail('limit-exceeded', `${path}.reroll.sources`, 'must be bounded.')
  }
  const sources = (rerollInput.sources as readonly unknown[]).map((entry, index): AbilityCheckRerollSource => {
    const entryPath = `${path}.reroll.sources[${index}]`
    const source = record(entry, entryPath)
    exact(source, SOURCE_FIELDS, entryPath)
    return Object.freeze({
      id: stableId(source.id, `${entryPath}.id`),
      maximumUses: boundedInteger(source.maximumUses, `${entryPath}.maximumUses`, 1, 16),
    })
  })
  if (new Set(sources.map(source => source.id)).size !== sources.length) {
    fail('duplicate-id', `${path}.reroll.sources`, 'must not repeat source IDs.')
  }
  const maximumRerolls = boundedInteger(
    rerollInput.maximumRerolls,
    `${path}.reroll.maximumRerolls`,
    0,
    32,
  )
  if ((maximumRerolls === 0) !== (sources.length === 0)
    || sources.reduce((sum, source) => sum + source.maximumUses, 0) < maximumRerolls) {
    fail('invalid-check', `${path}.reroll`, 'sources must cover the reviewed reroll maximum exactly or more.')
  }
  if (checkKind === 'contest' && rerollInput.trigger !== 'always') {
    fail('invalid-check', `${path}.reroll.trigger`, 'contest rerolls must use always.')
  }
  return deepFreezeStrictJson({
    kind: ABILITY_CHECK_OPERATION_KIND,
    checkId: stableId(input.checkId, `${path}.checkId`),
    checkKind,
    parentEffectId: stableId(input.parentEffectId, `${path}.parentEffectId`),
    formula: {
      kind: 'dice',
      count: boundedInteger(formulaInput.count, `${path}.formula.count`, 1, 100),
      sides: boundedInteger(formulaInput.sides, `${path}.formula.sides`, 2, 10_000),
      modifier: boundedInteger(formulaInput.modifier, `${path}.formula.modifier`, -1_000_000, 1_000_000),
    },
    modifiers: Object.freeze(modifiers),
    threshold,
    reroll: {
      trigger: oneOf(rerollInput.trigger, `${path}.reroll.trigger`, ABILITY_CHECK_REROLL_TRIGGERS),
      selection: oneOf(rerollInput.selection, `${path}.reroll.selection`, ABILITY_CHECK_REROLL_SELECTIONS),
      maximumRerolls,
      sources: Object.freeze(sources),
    },
  }) as AbilityCheckDefinition
}
