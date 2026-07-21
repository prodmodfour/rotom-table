import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import {
  ABILITY_COMBAT_PROVIDER_TYPE_IDS,
  type AbilityCombatProviderNumericOperation,
  type AbilityCombatProviderRelation,
  type AbilityCombatProviderSubject,
  type AbilityCombatProviderTypeId,
} from './combatProviders'

export const ABILITY_HP_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_HP_PROVIDER_EFFECT_KINDS = [
  'damage-reduction', 'damage-prevention', 'healing', 'temporary-hp',
  'drain', 'recoil', 'injury', 'hp-floor',
] as const
export const ABILITY_HP_DAMAGE_KINDS = ['normal', 'direct-hp-loss', 'recoil', 'indirect'] as const
export const ABILITY_HP_STACKING_POLICIES = ['stack', 'highest', 'lowest', 'priority', 'exclusive', 'union'] as const
export type AbilityHpProviderEffectKind = (typeof ABILITY_HP_PROVIDER_EFFECT_KINDS)[number]
export type AbilityHpDamageKind = (typeof ABILITY_HP_DAMAGE_KINDS)[number]
export type AbilityHpStackingPolicy = (typeof ABILITY_HP_STACKING_POLICIES)[number]
export interface AbilityHpProviderPredicate {
  readonly damageKinds: readonly AbilityHpDamageKind[]
  readonly moveTypes: readonly AbilityCombatProviderTypeId[]
  readonly requiredKeywords: readonly string[]
  readonly excludedKeywords: readonly string[]
  readonly requiresCritical: boolean | null
}
export type AbilityHpProviderEffect =
  | {
      readonly kind: 'damage-reduction'
      readonly operation: Exclude<AbilityCombatProviderNumericOperation, 'multiply'>
      readonly value: number
      readonly minimumDamage: number
    }
  | { readonly kind: 'damage-prevention' }
  | {
      readonly kind: 'healing' | 'temporary-hp'
      readonly operation: AbilityCombatProviderNumericOperation
      readonly value: number
    }
  | {
      readonly kind: 'drain'
      readonly basis: 'hp-damage' | 'total-damage'
      readonly numerator: number
      readonly denominator: number
      readonly minimum: number
      readonly trigger: 'on-hit' | 'on-damage' | 'always'
    }
  | {
      readonly kind: 'recoil'
      readonly basis: 'hp-damage' | 'total-damage' | 'source-max-hp'
      readonly numerator: number
      readonly denominator: number
      readonly minimum: number
      readonly temporaryHpPolicy: 'absorb' | 'bypass'
      readonly trigger: 'on-hit' | 'on-damage' | 'always'
    }
  | {
      readonly kind: 'injury'
      readonly operation: 'add' | 'prevent'
      readonly value: number
      readonly trigger: 'always' | 'fainted' | 'massive-damage'
    }
  | { readonly kind: 'hp-floor'; readonly floor: number }
export interface AbilityHpProvider {
  readonly schemaVersion: typeof ABILITY_HP_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly subject: AbilityCombatProviderSubject
  readonly relation: AbilityCombatProviderRelation
  readonly predicate: AbilityHpProviderPredicate
  readonly effect: AbilityHpProviderEffect
  readonly stackingGroup: string
  readonly stackingPolicy: AbilityHpStackingPolicy
  readonly priority: number
  readonly reasonCode: string
}
export interface AbilityHpPool {
  readonly placementId: string
  readonly currentHp: number
  readonly maximumHp: number
  readonly temporaryHp: number
  readonly injuries: number
}
export interface AbilityHpDamageFact {
  readonly actor: AbilityHpPool
  readonly target: AbilityHpPool
  readonly attemptedDamage: number
  readonly damageKind: AbilityHpDamageKind
  readonly moveType: AbilityCombatProviderTypeId | null
  readonly keywords: readonly string[]
  readonly critical: boolean
  readonly hit: boolean
  readonly externalPrevented: boolean
  readonly temporaryHpPolicy: 'absorb' | 'bypass'
  readonly baseTargetInjuryDelta: number
}
export interface AbilityHpPoolTransition extends AbilityHpPool {
  readonly beforeCurrentHp: number
  readonly beforeTemporaryHp: number
  readonly beforeInjuries: number
  readonly hpDelta: number
  readonly temporaryHpDelta: number
  readonly injuryDelta: number
  readonly fainted: boolean
}
export interface AbilityHpProviderTraceEntry {
  readonly providerId: string
  readonly effectKind: AbilityHpProviderEffectKind
  readonly status: 'applied' | 'scope-false' | 'predicate-false' | 'shadowed'
  readonly reasonCode: string
  readonly before: number | boolean | null
  readonly after: number | boolean | null
}
export interface AbilityHpDamageResolution {
  readonly attemptedDamage: number
  readonly prevented: boolean
  readonly reduction: number
  readonly damageAfterReduction: number
  readonly temporaryHpAbsorbed: number
  readonly hpDamage: number
  readonly drainHealing: number
  readonly recoilDamage: number
  readonly target: AbilityHpPoolTransition
  readonly actor: AbilityHpPoolTransition
  readonly trace: readonly AbilityHpProviderTraceEntry[]
}
export interface AbilityHpRecoveryResolution {
  readonly placementId: string
  readonly baseHealing: number
  readonly effectiveHealing: number
  readonly appliedHealing: number
  readonly baseTemporaryHpGrant: number
  readonly effectiveTemporaryHpGrant: number
  readonly resultingTemporaryHp: number
  readonly pool: AbilityHpPoolTransition
  readonly trace: readonly AbilityHpProviderTraceEntry[]
}
export const ABILITY_HP_PROVIDER_LIMITS = Object.freeze({
  providers: 1_024, list: 128, identifier: 200, magnitude: 1_000_000,
  priority: 1_000, denominator: 1_000_000, injuries: 1_000,
})
export class AbilityHpProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'stacking-conflict' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityHpProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'subject', 'relation', 'predicate', 'effect', 'stackingGroup', 'stackingPolicy', 'priority', 'reasonCode',
] as const
const PREDICATE_FIELDS = ['damageKinds', 'moveTypes', 'requiredKeywords', 'excludedKeywords', 'requiresCritical'] as const
const EFFECT_FIELDS: Readonly<Record<AbilityHpProviderEffectKind, readonly string[]>> = {
  'damage-reduction': ['kind', 'operation', 'value', 'minimumDamage'],
  'damage-prevention': ['kind'],
  healing: ['kind', 'operation', 'value'],
  'temporary-hp': ['kind', 'operation', 'value'],
  drain: ['kind', 'basis', 'numerator', 'denominator', 'minimum', 'trigger'],
  recoil: ['kind', 'basis', 'numerator', 'denominator', 'minimum', 'temporaryHpPolicy', 'trigger'],
  injury: ['kind', 'operation', 'value', 'trigger'],
  'hp-floor': ['kind', 'floor'],
}
const EFFECT_SET = new Set<string>(ABILITY_HP_PROVIDER_EFFECT_KINDS)
const DAMAGE_KIND_SET = new Set<string>(ABILITY_HP_DAMAGE_KINDS)
const POLICY_SET = new Set<string>(ABILITY_HP_STACKING_POLICIES)
const SUBJECT_SET = new Set<string>(['actor', 'target'])
const RELATION_SET = new Set<string>(['self', 'ally', 'enemy', 'any'])
const TYPE_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_TYPE_IDS)
const NUMERIC_SET = new Set<string>(['add', 'multiply', 'set', 'minimum', 'maximum'])
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityHpProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityHpProviderValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-provider', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-provider', path, 'has invalid shape.')
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_HP_PROVIDER_LIMITS.identifier || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_HP_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
const enumValue = <Value extends string>(value: unknown, path: string, set: ReadonlySet<string>): Value => (
  typeof value === 'string' && set.has(value) ? value as Value : fail('invalid-provider', path, 'is unsupported.')
)
const integer = (
  value: unknown,
  path: string,
  minimum: number = 0,
  maximum: number = ABILITY_HP_PROVIDER_LIMITS.magnitude,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('invalid-provider', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const finite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > ABILITY_HP_PROVIDER_LIMITS.magnitude) {
    fail('invalid-provider', path, 'must be a bounded finite number.')
  }
  return value as number
}
const ordered = <Value extends string>(value: unknown, path: string, parser: (entry: unknown, path: string) => Value): readonly Value[] => {
  if (!Array.isArray(value) || value.length > ABILITY_HP_PROVIDER_LIMITS.list) fail('limit-exceeded', path, 'must be bounded.')
  const result = (value as unknown[]).map((entry, index) => parser(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && entry <= result[index - 1]!)) {
    fail('duplicate-id', path, 'must be unique in code-point order.')
  }
  return Object.freeze(result)
}
const parsePredicate = (value: unknown, path: string): AbilityHpProviderPredicate => {
  const input = record(value, path)
  exact(input, PREDICATE_FIELDS, path)
  const requiredKeywords = ordered(input.requiredKeywords, `${path}.requiredKeywords`, stableId)
  const excludedKeywords = ordered(input.excludedKeywords, `${path}.excludedKeywords`, stableId)
  if (requiredKeywords.some(entry => excludedKeywords.includes(entry))) fail('invalid-provider', path, 'keyword predicates conflict.')
  return Object.freeze({
    damageKinds: ordered<AbilityHpDamageKind>(input.damageKinds, `${path}.damageKinds`, (entry, entryPath) => enumValue(entry, entryPath, DAMAGE_KIND_SET)),
    moveTypes: ordered<AbilityCombatProviderTypeId>(input.moveTypes, `${path}.moveTypes`, (entry, entryPath) => enumValue(entry, entryPath, TYPE_SET)),
    requiredKeywords, excludedKeywords,
    requiresCritical: input.requiresCritical === null || typeof input.requiresCritical === 'boolean'
      ? input.requiresCritical as boolean | null
      : fail('invalid-provider', `${path}.requiresCritical`, 'must be boolean or null.'),
  })
}
const parseEffect = (value: unknown, path: string): AbilityHpProviderEffect => {
  const input = record(value, path)
  const kind = enumValue<AbilityHpProviderEffectKind>(input.kind, `${path}.kind`, EFFECT_SET)
  exact(input, EFFECT_FIELDS[kind], path)
  if (kind === 'damage-prevention') return Object.freeze({ kind })
  if (kind === 'damage-reduction') {
    const operation = enumValue<Exclude<AbilityCombatProviderNumericOperation, 'multiply'>>(
      input.operation, `${path}.operation`, new Set(['add', 'set', 'minimum', 'maximum']),
    )
    return Object.freeze({
      kind, operation, value: integer(input.value, `${path}.value`),
      minimumDamage: integer(input.minimumDamage, `${path}.minimumDamage`),
    })
  }
  if (kind === 'healing' || kind === 'temporary-hp') return Object.freeze({
    kind,
    operation: enumValue<AbilityCombatProviderNumericOperation>(input.operation, `${path}.operation`, NUMERIC_SET),
    value: finite(input.value, `${path}.value`),
  })
  if (kind === 'hp-floor') return Object.freeze({ kind, floor: integer(input.floor, `${path}.floor`) })
  if (kind === 'injury') {
    const operation = enumValue<'add' | 'prevent'>(input.operation, `${path}.operation`, new Set(['add', 'prevent']))
    const trigger = enumValue<'always' | 'fainted' | 'massive-damage'>(input.trigger, `${path}.trigger`, new Set(['always', 'fainted', 'massive-damage']))
    return Object.freeze({ kind, operation, value: integer(input.value, `${path}.value`, 1, ABILITY_HP_PROVIDER_LIMITS.injuries), trigger })
  }
  const numerator = integer(input.numerator, `${path}.numerator`, 1)
  const denominator = integer(input.denominator, `${path}.denominator`, 1, ABILITY_HP_PROVIDER_LIMITS.denominator)
  const minimum = integer(input.minimum, `${path}.minimum`)
  const trigger = enumValue<'on-hit' | 'on-damage' | 'always'>(
    input.trigger,
    `${path}.trigger`,
    new Set(['on-hit', 'on-damage', 'always']),
  )
  if (kind === 'drain') {
    const basis = enumValue<'hp-damage' | 'total-damage'>(input.basis, `${path}.basis`, new Set(['hp-damage', 'total-damage']))
    return Object.freeze({ kind, basis, numerator, denominator, minimum, trigger })
  }
  const basis = enumValue<'hp-damage' | 'total-damage' | 'source-max-hp'>(input.basis, `${path}.basis`, new Set(['hp-damage', 'total-damage', 'source-max-hp']))
  const temporaryHpPolicy = enumValue<'absorb' | 'bypass'>(input.temporaryHpPolicy, `${path}.temporaryHpPolicy`, new Set(['absorb', 'bypass']))
  return Object.freeze({ kind, basis, numerator, denominator, minimum, temporaryHpPolicy, trigger })
}
export const parseAbilityHpProviders = (value: unknown): readonly AbilityHpProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityHpProviders', {
    limits: { depth: 8, nodes: 65_536, objectFields: 20, arrayEntries: ABILITY_HP_PROVIDER_LIMITS.providers, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability HP providers', valueLabel: 'ability HP provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_HP_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityHpProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityHpProvider => {
    const path = `abilityHpProviders[${index}]`
    const input = record(entry, path)
    exact(input, PROVIDER_FIELDS, path)
    if (input.schemaVersion !== 1) fail('invalid-provider', `${path}.schemaVersion`, 'is unsupported.')
    const effect = parseEffect(input.effect, `${path}.effect`)
    const stackingPolicy = enumValue<AbilityHpStackingPolicy>(input.stackingPolicy, `${path}.stackingPolicy`, POLICY_SET)
    if (['damage-prevention', 'drain', 'recoil', 'injury'].includes(effect.kind)
      && !['stack', 'union', 'priority', 'exclusive'].includes(stackingPolicy)) {
      fail('invalid-provider', path, `${effect.kind} has incompatible stacking.`)
    }
    if (!Number.isSafeInteger(input.priority) || Math.abs(Number(input.priority)) > ABILITY_HP_PROVIDER_LIMITS.priority) {
      fail('invalid-provider', `${path}.priority`, 'must be bounded.')
    }
    return Object.freeze({
      schemaVersion: 1, providerId: stableId(input.providerId, `${path}.providerId`),
      abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
      canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      sourcePlacementId: stableId(input.sourcePlacementId, `${path}.sourcePlacementId`),
      subject: enumValue<AbilityCombatProviderSubject>(input.subject, `${path}.subject`, SUBJECT_SET),
      relation: enumValue<AbilityCombatProviderRelation>(input.relation, `${path}.relation`, RELATION_SET),
      predicate: parsePredicate(input.predicate, `${path}.predicate`), effect,
      stackingGroup: stableId(input.stackingGroup, `${path}.stackingGroup`), stackingPolicy,
      priority: Number(input.priority), reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
    })
  })
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length) fail('duplicate-id', 'abilityHpProviders', 'must not repeat provider IDs.')
  return deepFreezeStrictJson(providers)
}
const compare = (left: AbilityHpProvider, right: AbilityHpProvider): number => left.priority - right.priority
  || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
  || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
  || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0)
const effectNumericValue = (provider: AbilityHpProvider): number | null => {
  const effect = provider.effect
  if ('value' in effect && typeof effect.value === 'number') return effect.value
  if ('floor' in effect) return effect.floor
  return null
}
const select = (providers: readonly AbilityHpProvider[]) => {
  if (providers.length === 0) return { selected: [] as AbilityHpProvider[], shadowed: [] as AbilityHpProvider[] }
  const policy = providers[0]!.stackingPolicy
  if (providers.some(provider => provider.stackingPolicy !== policy)) fail('stacking-conflict', providers[0]!.stackingGroup, 'providers disagree on stacking policy.')
  if (policy === 'exclusive' && providers.length !== 1) fail('stacking-conflict', providers[0]!.stackingGroup, 'exclusive group has multiple providers.')
  if (policy === 'stack' || policy === 'union' || policy === 'exclusive') return { selected: [...providers], shadowed: [] }
  let selected: AbilityHpProvider
  if (policy === 'priority') selected = [...providers].sort(compare).at(-1)!
  else {
    if (providers.some(provider => effectNumericValue(provider) === null)) fail('stacking-conflict', providers[0]!.stackingGroup, 'highest/lowest requires numeric effects.')
    const sorted = [...providers].sort((left, right) => effectNumericValue(left)! - effectNumericValue(right)! || compare(left, right))
    selected = sorted[policy === 'highest' ? sorted.length - 1 : 0]!
  }
  return { selected: [selected], shadowed: providers.filter(provider => provider !== selected) }
}
const numeric = (base: number, operation: AbilityCombatProviderNumericOperation, value: number): number => {
  if (operation === 'add') return base + value
  if (operation === 'multiply') return base * value
  if (operation === 'set') return value
  if (operation === 'minimum') return Math.max(base, value)
  return Math.min(base, value)
}
const predicateMatches = (predicate: AbilityHpProviderPredicate, fact: AbilityHpDamageFact): boolean => (
  (predicate.damageKinds.length === 0 || predicate.damageKinds.includes(fact.damageKind))
  && (predicate.moveTypes.length === 0 || (fact.moveType !== null && predicate.moveTypes.includes(fact.moveType)))
  && predicate.requiredKeywords.every(entry => fact.keywords.includes(entry))
  && predicate.excludedKeywords.every(entry => !fact.keywords.includes(entry))
  && (predicate.requiresCritical === null || predicate.requiresCritical === fact.critical)
)
const eligibleProviders = (input: {
  readonly providers: unknown
  readonly fact: AbilityHpDamageFact
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
  readonly trace: AbilityHpProviderTraceEntry[]
}): readonly AbilityHpProvider[] => {
  const providers = [...parseAbilityHpProviders(input.providers)].sort(compare)
  return providers.filter((provider) => {
    const subjectId = provider.subject === 'actor' ? input.fact.actor.placementId : input.fact.target.placementId
    const relation = input.relation(provider.sourcePlacementId, subjectId)
    if (provider.relation !== 'any' && provider.relation !== relation) {
      input.trace.push({ providerId: provider.providerId, effectKind: provider.effect.kind, status: 'scope-false', reasonCode: provider.reasonCode, before: null, after: null })
      return false
    }
    if (!predicateMatches(provider.predicate, input.fact)) {
      input.trace.push({ providerId: provider.providerId, effectKind: provider.effect.kind, status: 'predicate-false', reasonCode: provider.reasonCode, before: null, after: null })
      return false
    }
    return true
  })
}
const selectedByKind = (
  providers: readonly AbilityHpProvider[],
  kind: AbilityHpProviderEffectKind,
  trace: AbilityHpProviderTraceEntry[],
  subject?: AbilityCombatProviderSubject,
): readonly AbilityHpProvider[] => {
  const candidates = providers.filter(provider => provider.effect.kind === kind && (subject === undefined || provider.subject === subject))
  const groups = new Map<string, AbilityHpProvider[]>()
  for (const provider of candidates) groups.set(provider.stackingGroup, [...(groups.get(provider.stackingGroup) ?? []), provider])
  const result: AbilityHpProvider[] = []
  for (const values of groups.values()) {
    const chosen = select(values)
    result.push(...chosen.selected)
    chosen.shadowed.forEach(provider => trace.push({
      providerId: provider.providerId, effectKind: provider.effect.kind, status: 'shadowed', reasonCode: provider.reasonCode, before: null, after: null,
    }))
  }
  return result.sort(compare)
}
const validPool = (pool: AbilityHpPool): void => {
  if (!ID.test(pool.placementId) || !Number.isSafeInteger(pool.maximumHp) || pool.maximumHp < 1
    || !Number.isSafeInteger(pool.currentHp) || pool.currentHp < 0 || pool.currentHp > pool.maximumHp
    || !Number.isSafeInteger(pool.temporaryHp) || pool.temporaryHp < 0
    || !Number.isSafeInteger(pool.injuries) || pool.injuries < 0) fail('invalid-provider', 'abilityHpPool', 'contains invalid HP facts.')
}
const transition = (
  before: AbilityHpPool,
  currentHp: number,
  temporaryHp: number,
  injuries: number,
): AbilityHpPoolTransition => ({
  placementId: before.placementId,
  currentHp,
  maximumHp: before.maximumHp,
  temporaryHp,
  injuries,
  beforeCurrentHp: before.currentHp,
  beforeTemporaryHp: before.temporaryHp,
  beforeInjuries: before.injuries,
  hpDelta: currentHp - before.currentHp,
  temporaryHpDelta: temporaryHp - before.temporaryHp,
  injuryDelta: injuries - before.injuries,
  fainted: currentHp === 0,
})
const fraction = (basis: number, numerator: number, denominator: number, minimum: number): number => (
  basis <= 0 ? 0 : Math.max(minimum, Math.floor((basis * numerator) / denominator))
)
const sideEffectTriggered = (
  trigger: 'on-hit' | 'on-damage' | 'always',
  hit: boolean,
  damage: number,
): boolean => trigger === 'always' || (trigger === 'on-hit' ? hit : damage > 0)
const applyHealingProviders = (
  base: number,
  providers: readonly AbilityHpProvider[],
  kind: 'healing' | 'temporary-hp',
  trace: AbilityHpProviderTraceEntry[],
  subject: AbilityCombatProviderSubject,
): number => {
  let value = base
  for (const provider of selectedByKind(providers, kind, trace, subject)) {
    const effect = provider.effect as Extract<AbilityHpProviderEffect, { kind: 'healing' | 'temporary-hp' }>
    const before = value
    value = numeric(value, effect.operation, effect.value)
    trace.push({ providerId: provider.providerId, effectKind: kind, status: 'applied', reasonCode: provider.reasonCode, before, after: value })
  }
  return Math.max(0, Math.floor(value))
}
const injuryDeltaFor = (input: {
  readonly providers: readonly AbilityHpProvider[]
  readonly subject: AbilityCombatProviderSubject
  readonly baseDelta: number
  readonly hpDamage: number
  readonly pool: AbilityHpPool
  readonly fainted: boolean
  readonly trace: AbilityHpProviderTraceEntry[]
}): number => {
  let delta = input.baseDelta
  for (const provider of selectedByKind(input.providers, 'injury', input.trace, input.subject)) {
    const effect = provider.effect as Extract<AbilityHpProviderEffect, { kind: 'injury' }>
    const triggered = effect.trigger === 'always' || (effect.trigger === 'fainted' && input.fainted)
      || (effect.trigger === 'massive-damage' && input.hpDamage >= Math.floor(input.pool.maximumHp / 2))
    if (!triggered) {
      input.trace.push({ providerId: provider.providerId, effectKind: 'injury', status: 'predicate-false', reasonCode: provider.reasonCode, before: delta, after: delta })
      continue
    }
    const before = delta
    delta = effect.operation === 'prevent' ? Math.max(0, delta - effect.value) : delta + effect.value
    input.trace.push({ providerId: provider.providerId, effectKind: 'injury', status: 'applied', reasonCode: provider.reasonCode, before, after: delta })
  }
  return delta
}
const validateDamageFact = (fact: AbilityHpDamageFact): void => {
  validPool(fact.actor); validPool(fact.target)
  if (fact.actor.placementId === fact.target.placementId
    || !Number.isSafeInteger(fact.attemptedDamage) || fact.attemptedDamage < 0
    || !DAMAGE_KIND_SET.has(fact.damageKind)
    || (fact.moveType !== null && !TYPE_SET.has(fact.moveType))
    || typeof fact.hit !== 'boolean'
    || !Number.isSafeInteger(fact.baseTargetInjuryDelta) || fact.baseTargetInjuryDelta < 0
    || new Set(fact.keywords).size !== fact.keywords.length || fact.keywords.some(entry => !ID.test(entry))) {
    fail('invalid-provider', 'abilityHpDamageFact', 'contains invalid damage facts.')
  }
}
/** Resolve one target damage packet, then drain, recoil, and Injury side effects. */
export const resolveAbilityHpDamageProviders = (input: {
  readonly providers: unknown
  readonly fact: AbilityHpDamageFact
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
}): AbilityHpDamageResolution => {
  validateDamageFact(input.fact)
  const trace: AbilityHpProviderTraceEntry[] = []
  const providers = eligibleProviders({ ...input, trace })
  const prevention = selectedByKind(providers, 'damage-prevention', trace, 'target')
  const prevented = input.fact.externalPrevented || prevention.length > 0
  prevention.forEach(provider => trace.push({
    providerId: provider.providerId, effectKind: 'damage-prevention', status: 'applied',
    reasonCode: provider.reasonCode, before: false, after: true,
  }))
  let reduction = 0
  let minimumDamage = 0
  if (!prevented && input.fact.damageKind !== 'direct-hp-loss') {
    for (const provider of selectedByKind(providers, 'damage-reduction', trace, 'target')) {
      const effect = provider.effect as Extract<AbilityHpProviderEffect, { kind: 'damage-reduction' }>
      const before = reduction
      reduction = numeric(reduction, effect.operation, effect.value)
      minimumDamage = Math.max(minimumDamage, effect.minimumDamage)
      trace.push({ providerId: provider.providerId, effectKind: 'damage-reduction', status: 'applied', reasonCode: provider.reasonCode, before, after: reduction })
    }
  }
  const damageAfterReduction = prevented || input.fact.attemptedDamage === 0
    ? 0
    : Math.max(minimumDamage, input.fact.attemptedDamage - Math.max(0, Math.floor(reduction)))
  let targetTemporaryHp = input.fact.target.temporaryHp
  const temporaryHpAbsorbed = input.fact.temporaryHpPolicy === 'absorb'
    ? Math.min(targetTemporaryHp, damageAfterReduction)
    : 0
  targetTemporaryHp -= temporaryHpAbsorbed
  let hpDamage = Math.min(input.fact.target.currentHp, damageAfterReduction - temporaryHpAbsorbed)
  let targetHp = input.fact.target.currentHp - hpDamage
  for (const provider of selectedByKind(providers, 'hp-floor', trace, 'target')) {
    const effect = provider.effect as Extract<AbilityHpProviderEffect, { kind: 'hp-floor' }>
    const before = targetHp
    if (input.fact.target.currentHp > effect.floor && targetHp < effect.floor) targetHp = effect.floor
    hpDamage = input.fact.target.currentHp - targetHp
    trace.push({ providerId: provider.providerId, effectKind: 'hp-floor', status: before === targetHp ? 'predicate-false' : 'applied', reasonCode: provider.reasonCode, before, after: targetHp })
  }
  const targetInjuryDelta = injuryDeltaFor({
    providers, subject: 'target', baseDelta: hpDamage > 0 ? input.fact.baseTargetInjuryDelta : 0,
    hpDamage, pool: input.fact.target, fainted: targetHp === 0, trace,
  })
  let actorHp = input.fact.actor.currentHp
  let actorTemporaryHp = input.fact.actor.temporaryHp
  let drainHealing = 0
  for (const provider of selectedByKind(providers, 'drain', trace, 'actor')) {
    const effect = provider.effect as Extract<AbilityHpProviderEffect, { kind: 'drain' }>
    const totalDamage = hpDamage + temporaryHpAbsorbed
    if (!sideEffectTriggered(effect.trigger, input.fact.hit, totalDamage)) {
      trace.push({ providerId: provider.providerId, effectKind: 'drain', status: 'predicate-false', reasonCode: provider.reasonCode, before: drainHealing, after: drainHealing })
      continue
    }
    const basis = effect.basis === 'hp-damage' ? hpDamage : totalDamage
    const before = drainHealing
    drainHealing += fraction(basis, effect.numerator, effect.denominator, effect.minimum)
    trace.push({ providerId: provider.providerId, effectKind: 'drain', status: 'applied', reasonCode: provider.reasonCode, before, after: drainHealing })
  }
  drainHealing = applyHealingProviders(drainHealing, providers, 'healing', trace, 'actor')
  const appliedDrain = Math.min(drainHealing, input.fact.actor.maximumHp - actorHp)
  actorHp += appliedDrain
  let recoilDamage = 0
  let recoilBypass = false
  for (const provider of selectedByKind(providers, 'recoil', trace, 'actor')) {
    const effect = provider.effect as Extract<AbilityHpProviderEffect, { kind: 'recoil' }>
    const totalDamage = hpDamage + temporaryHpAbsorbed
    if (!sideEffectTriggered(effect.trigger, input.fact.hit, totalDamage)) {
      trace.push({ providerId: provider.providerId, effectKind: 'recoil', status: 'predicate-false', reasonCode: provider.reasonCode, before: recoilDamage, after: recoilDamage })
      continue
    }
    const basis = effect.basis === 'hp-damage' ? hpDamage
      : effect.basis === 'total-damage' ? totalDamage
        : input.fact.actor.maximumHp
    const before = recoilDamage
    recoilDamage += fraction(basis, effect.numerator, effect.denominator, effect.minimum)
    recoilBypass ||= effect.temporaryHpPolicy === 'bypass'
    trace.push({ providerId: provider.providerId, effectKind: 'recoil', status: 'applied', reasonCode: provider.reasonCode, before, after: recoilDamage })
  }
  if (!recoilBypass) {
    const absorbed = Math.min(actorTemporaryHp, recoilDamage)
    actorTemporaryHp -= absorbed
    recoilDamage -= absorbed
  }
  const appliedRecoil = Math.min(actorHp, recoilDamage)
  actorHp -= appliedRecoil
  const actorInjuryDelta = injuryDeltaFor({
    providers, subject: 'actor', baseDelta: 0, hpDamage: appliedRecoil,
    pool: input.fact.actor, fainted: actorHp === 0, trace,
  })
  return deepFreezeStrictJson({
    attemptedDamage: input.fact.attemptedDamage, prevented,
    reduction: Math.max(0, Math.floor(reduction)), damageAfterReduction,
    temporaryHpAbsorbed, hpDamage, drainHealing: appliedDrain, recoilDamage: appliedRecoil,
    target: transition(input.fact.target, targetHp, targetTemporaryHp, Math.min(ABILITY_HP_PROVIDER_LIMITS.injuries, input.fact.target.injuries + targetInjuryDelta)),
    actor: transition(input.fact.actor, actorHp, actorTemporaryHp, Math.min(ABILITY_HP_PROVIDER_LIMITS.injuries, input.fact.actor.injuries + actorInjuryDelta)),
    trace: Object.freeze(trace),
  })
}
/** Resolve healing and non-stacking temporary HP for one authoritative pool. */
export const resolveAbilityHpRecoveryProviders = (input: {
  readonly providers: unknown
  readonly pool: AbilityHpPool
  readonly baseHealing: number
  readonly baseTemporaryHpGrant: number
  readonly fact: Omit<AbilityHpDamageFact, 'actor' | 'target' | 'attemptedDamage' | 'baseTargetInjuryDelta'>
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
}): AbilityHpRecoveryResolution => {
  validPool(input.pool)
  if (!Number.isSafeInteger(input.baseHealing) || input.baseHealing < 0
    || !Number.isSafeInteger(input.baseTemporaryHpGrant) || input.baseTemporaryHpGrant < 0) {
    fail('invalid-provider', 'abilityHpRecovery', 'base recovery values must be non-negative integers.')
  }
  const syntheticFact: AbilityHpDamageFact = {
    ...input.fact, actor: input.pool, target: input.pool, attemptedDamage: 0, baseTargetInjuryDelta: 0,
  }
  const trace: AbilityHpProviderTraceEntry[] = []
  const providers = eligibleProviders({ providers: input.providers, fact: syntheticFact, relation: input.relation, trace })
  const effectiveHealing = applyHealingProviders(input.baseHealing, providers, 'healing', trace, 'target')
  const appliedHealing = Math.min(effectiveHealing, input.pool.maximumHp - input.pool.currentHp)
  const effectiveTemporaryHpGrant = applyHealingProviders(input.baseTemporaryHpGrant, providers, 'temporary-hp', trace, 'target')
  const resultingTemporaryHp = Math.max(input.pool.temporaryHp, effectiveTemporaryHpGrant)
  return deepFreezeStrictJson({
    placementId: input.pool.placementId,
    baseHealing: input.baseHealing, effectiveHealing, appliedHealing,
    baseTemporaryHpGrant: input.baseTemporaryHpGrant, effectiveTemporaryHpGrant, resultingTemporaryHp,
    pool: transition(
      input.pool,
      input.pool.currentHp + appliedHealing,
      resultingTemporaryHp,
      input.pool.injuries,
    ),
    trace: Object.freeze(trace),
  })
}
