import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_COMBAT_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_COMBAT_PROVIDER_EFFECT_KINDS = [
  'move-type', 'stab', 'damage-base', 'damage', 'accuracy', 'critical',
] as const
export const ABILITY_COMBAT_PROVIDER_SUBJECTS = ['actor', 'target'] as const
export const ABILITY_COMBAT_PROVIDER_RELATIONS = ['self', 'ally', 'enemy', 'any'] as const
export const ABILITY_COMBAT_PROVIDER_STACKING_POLICIES = ['stack', 'highest', 'lowest', 'priority', 'exclusive'] as const
export const ABILITY_COMBAT_PROVIDER_DAMAGE_STAGES = ['pre-type', 'post-type', 'final'] as const
export const ABILITY_COMBAT_PROVIDER_NUMERIC_OPERATIONS = ['add', 'multiply', 'set', 'minimum', 'maximum'] as const
export const ABILITY_COMBAT_PROVIDER_TYPE_IDS = [
  'bug', 'dark', 'dragon', 'electric', 'fairy', 'fighting', 'fire', 'flying', 'ghost',
  'grass', 'ground', 'ice', 'normal', 'poison', 'psychic', 'rock', 'steel', 'water',
] as const
export type AbilityCombatProviderEffectKind = (typeof ABILITY_COMBAT_PROVIDER_EFFECT_KINDS)[number]
export type AbilityCombatProviderSubject = (typeof ABILITY_COMBAT_PROVIDER_SUBJECTS)[number]
export type AbilityCombatProviderRelation = (typeof ABILITY_COMBAT_PROVIDER_RELATIONS)[number]
export type AbilityCombatProviderStackingPolicy = (typeof ABILITY_COMBAT_PROVIDER_STACKING_POLICIES)[number]
export type AbilityCombatProviderDamageStage = (typeof ABILITY_COMBAT_PROVIDER_DAMAGE_STAGES)[number]
export type AbilityCombatProviderNumericOperation = (typeof ABILITY_COMBAT_PROVIDER_NUMERIC_OPERATIONS)[number]
export type AbilityCombatProviderTypeId = (typeof ABILITY_COMBAT_PROVIDER_TYPE_IDS)[number]

export interface AbilityCombatProviderPredicate {
  readonly moveIds: readonly string[]
  readonly moveTypes: readonly AbilityCombatProviderTypeId[]
  readonly damageClasses: readonly ('physical' | 'special' | 'status')[]
  readonly requiredKeywords: readonly string[]
  readonly excludedKeywords: readonly string[]
  readonly requiresStab: boolean | null
}
export type AbilityCombatProviderEffect =
  | { readonly kind: 'move-type'; readonly typeId: AbilityCombatProviderTypeId }
  | { readonly kind: 'stab'; readonly operation: 'grant' | 'suppress' | 'bonus'; readonly value: number | null }
  | { readonly kind: 'damage-base'; readonly operation: AbilityCombatProviderNumericOperation; readonly value: number }
  | { readonly kind: 'damage'; readonly stage: AbilityCombatProviderDamageStage; readonly operation: AbilityCombatProviderNumericOperation; readonly value: number }
  | { readonly kind: 'accuracy'; readonly operation: AbilityCombatProviderNumericOperation | 'automatic-hit'; readonly value: number | null }
  | { readonly kind: 'critical'; readonly operation: 'widen' | 'set-minimum' | 'always' | 'never'; readonly value: number | null }
export interface AbilityCombatProvider {
  readonly schemaVersion: typeof ABILITY_COMBAT_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly subject: AbilityCombatProviderSubject
  readonly relation: AbilityCombatProviderRelation
  readonly predicate: AbilityCombatProviderPredicate
  readonly effect: AbilityCombatProviderEffect
  readonly stackingGroup: string
  readonly stackingPolicy: AbilityCombatProviderStackingPolicy
  readonly priority: number
  readonly reasonCode: string
}
export interface AbilityCombatProviderFact {
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly moveId: string
  readonly moveType: AbilityCombatProviderTypeId
  readonly actorTypeIds: readonly AbilityCombatProviderTypeId[]
  readonly damageClass: 'physical' | 'special' | 'status'
  readonly keywords: readonly string[]
  readonly baseDamageBase: number | null
  readonly baseHasStab: boolean
  readonly standardStabDamageBaseBonus: number
  readonly baseAccuracyModifier: number
  readonly baseCriticalMinimum: number | null
  readonly naturalAccuracyRoll: number | null
  readonly naturalCriticalRoll: number | null
}
export interface AbilityCombatProviderTraceEntry {
  readonly providerId: string
  readonly effectKind: AbilityCombatProviderEffectKind
  readonly status: 'applied' | 'scope-false' | 'predicate-false' | 'shadowed'
  readonly reasonCode: string
  readonly before: number | string | boolean | null
  readonly after: number | string | boolean | null
}
export interface AbilityCombatDamageModifier {
  readonly providerId: string
  readonly stage: AbilityCombatProviderDamageStage
  readonly operation: AbilityCombatProviderNumericOperation
  readonly value: number
  readonly reasonCode: string
}
export interface AbilityCombatProviderResolution {
  readonly moveType: AbilityCombatProviderTypeId
  readonly stab: {
    readonly base: boolean
    readonly effective: boolean
    readonly damageBaseBonus: number
  }
  readonly damageBase: number | null
  readonly damageModifiers: readonly AbilityCombatDamageModifier[]
  readonly accuracy: {
    readonly modifier: number
    readonly automaticHit: boolean
    readonly naturalRoll: number | null
  }
  readonly critical: {
    readonly minimum: number | null
    readonly automatic: 'always' | 'never' | null
    readonly naturalRoll: number | null
    readonly candidate: boolean
  }
  readonly trace: readonly AbilityCombatProviderTraceEntry[]
}
export interface AppliedAbilityCombatDamage {
  readonly baseDamage: number
  readonly preTypeDamage: number
  readonly typeMultiplier: number
  readonly typedDamage: number
  readonly postTypeDamage: number
  readonly finalDamage: number
  readonly modifiers: readonly AbilityCombatDamageModifier[]
}
export const ABILITY_COMBAT_PROVIDER_LIMITS = Object.freeze({
  providers: 1_024, identifiers: 200, list: 128, priority: 1_000,
  magnitude: 1_000_000, damageBase: 100, criticalMinimum: 20,
})
export class AbilityCombatProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'stacking-conflict' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityCombatProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'subject', 'relation', 'predicate', 'effect', 'stackingGroup', 'stackingPolicy', 'priority', 'reasonCode',
] as const
const PREDICATE_FIELDS = ['moveIds', 'moveTypes', 'damageClasses', 'requiredKeywords', 'excludedKeywords', 'requiresStab'] as const
const EFFECT_FIELDS: Readonly<Record<AbilityCombatProviderEffectKind, readonly string[]>> = {
  'move-type': ['kind', 'typeId'], stab: ['kind', 'operation', 'value'],
  'damage-base': ['kind', 'operation', 'value'], damage: ['kind', 'stage', 'operation', 'value'],
  accuracy: ['kind', 'operation', 'value'], critical: ['kind', 'operation', 'value'],
}
const EFFECT_KIND_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_EFFECT_KINDS)
const SUBJECT_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_SUBJECTS)
const RELATION_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_RELATIONS)
const POLICY_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_STACKING_POLICIES)
const STAGE_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_DAMAGE_STAGES)
const NUMERIC_OPERATION_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_NUMERIC_OPERATIONS)
const TYPE_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_TYPE_IDS)
const DAMAGE_CLASS_SET = new Set<string>(['physical', 'special', 'status'])
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityCombatProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityCombatProviderValidationError(code, path, detail)
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
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_COMBAT_PROVIDER_LIMITS.identifiers || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_COMBAT_PROVIDER_LIMITS.identifiers
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
const number = (value: unknown, path: string, magnitude: number = ABILITY_COMBAT_PROVIDER_LIMITS.magnitude): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > magnitude) {
    fail('invalid-provider', path, 'must be a bounded finite number.')
  }
  return value as number
}
const orderedList = <Value extends string>(
  value: unknown,
  path: string,
  parse: (entry: unknown, path: string) => Value,
): readonly Value[] => {
  if (!Array.isArray(value) || value.length > ABILITY_COMBAT_PROVIDER_LIMITS.list) fail('limit-exceeded', path, 'must be a bounded array.')
  const result = (value as unknown[]).map((entry, index) => parse(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && entry <= result[index - 1]!)) {
    fail('duplicate-id', path, 'must be unique in code-point order.')
  }
  return Object.freeze(result)
}
const enumValue = <Value extends string>(value: unknown, path: string, set: ReadonlySet<string>): Value => (
  typeof value === 'string' && set.has(value) ? value as Value : fail('invalid-provider', path, 'is unsupported.')
)
const parsePredicate = (value: unknown, path: string): AbilityCombatProviderPredicate => {
  const input = record(value, path)
  exact(input, PREDICATE_FIELDS, path)
  const requiredKeywords = orderedList(input.requiredKeywords, `${path}.requiredKeywords`, stableId)
  const excludedKeywords = orderedList(input.excludedKeywords, `${path}.excludedKeywords`, stableId)
  if (requiredKeywords.some(keyword => excludedKeywords.includes(keyword))) {
    fail('invalid-provider', path, 'cannot both require and exclude one keyword.')
  }
  return Object.freeze({
    moveIds: orderedList(input.moveIds, `${path}.moveIds`, (entry, entryPath) => text(entry, entryPath)),
    moveTypes: orderedList<AbilityCombatProviderTypeId>(input.moveTypes, `${path}.moveTypes`, (entry, entryPath) => enumValue<AbilityCombatProviderTypeId>(entry, entryPath, TYPE_SET)),
    damageClasses: orderedList<'physical' | 'special' | 'status'>(input.damageClasses, `${path}.damageClasses`, (entry, entryPath) => enumValue<'physical' | 'special' | 'status'>(entry, entryPath, DAMAGE_CLASS_SET)),
    requiredKeywords, excludedKeywords,
    requiresStab: input.requiresStab === null || typeof input.requiresStab === 'boolean'
      ? input.requiresStab as boolean | null
      : fail('invalid-provider', `${path}.requiresStab`, 'must be boolean or null.'),
  })
}
const parseEffect = (value: unknown, path: string): AbilityCombatProviderEffect => {
  const input = record(value, path)
  const kind = enumValue<AbilityCombatProviderEffectKind>(input.kind, `${path}.kind`, EFFECT_KIND_SET)
  exact(input, EFFECT_FIELDS[kind], path)
  if (kind === 'move-type') return Object.freeze({ kind, typeId: enumValue<AbilityCombatProviderTypeId>(input.typeId, `${path}.typeId`, TYPE_SET) })
  if (kind === 'stab') {
    const operation = enumValue<'grant' | 'suppress' | 'bonus'>(input.operation, `${path}.operation`, new Set(['grant', 'suppress', 'bonus']))
    if ((operation === 'bonus') !== (typeof input.value === 'number')) fail('invalid-provider', path, 'STAB bonus alone requires a numeric value.')
    return Object.freeze({ kind, operation, value: operation === 'bonus' ? number(input.value, `${path}.value`, 100) : null })
  }
  if (kind === 'damage-base') return Object.freeze({
    kind, operation: enumValue<AbilityCombatProviderNumericOperation>(input.operation, `${path}.operation`, NUMERIC_OPERATION_SET),
    value: number(input.value, `${path}.value`, ABILITY_COMBAT_PROVIDER_LIMITS.damageBase),
  })
  if (kind === 'damage') return Object.freeze({
    kind, stage: enumValue<AbilityCombatProviderDamageStage>(input.stage, `${path}.stage`, STAGE_SET),
    operation: enumValue<AbilityCombatProviderNumericOperation>(input.operation, `${path}.operation`, NUMERIC_OPERATION_SET),
    value: number(input.value, `${path}.value`),
  })
  if (kind === 'accuracy') {
    const operation = enumValue<AbilityCombatProviderNumericOperation | 'automatic-hit'>(
      input.operation, `${path}.operation`, new Set([...ABILITY_COMBAT_PROVIDER_NUMERIC_OPERATIONS, 'automatic-hit']),
    )
    if ((operation === 'automatic-hit') !== (input.value === null)) fail('invalid-provider', path, 'automatic hit alone has a null value.')
    return Object.freeze({ kind, operation, value: operation === 'automatic-hit' ? null : number(input.value, `${path}.value`, 100) })
  }
  const operation = enumValue<'widen' | 'set-minimum' | 'always' | 'never'>(
    input.operation, `${path}.operation`, new Set(['widen', 'set-minimum', 'always', 'never']),
  )
  if ((operation === 'widen' || operation === 'set-minimum') !== (typeof input.value === 'number')) {
    fail('invalid-provider', path, 'numeric critical operations alone require a value.')
  }
  const parsed = typeof input.value === 'number'
    ? number(input.value, `${path}.value`, ABILITY_COMBAT_PROVIDER_LIMITS.criticalMinimum)
    : null
  if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed < 1)) fail('invalid-provider', `${path}.value`, 'must be a positive integer.')
  return Object.freeze({ kind, operation, value: parsed })
}
export const parseAbilityCombatProviders = (value: unknown): readonly AbilityCombatProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityCombatProviders', {
    limits: { depth: 8, nodes: 65_536, objectFields: 20, arrayEntries: ABILITY_COMBAT_PROVIDER_LIMITS.providers, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability combat providers', valueLabel: 'ability combat provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_COMBAT_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityCombatProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityCombatProvider => {
    const path = `abilityCombatProviders[${index}]`
    const input = record(entry, path)
    exact(input, PROVIDER_FIELDS, path)
    if (input.schemaVersion !== ABILITY_COMBAT_PROVIDER_SCHEMA_VERSION) fail('invalid-provider', `${path}.schemaVersion`, 'is unsupported.')
    const effect = parseEffect(input.effect, `${path}.effect`)
    const stackingPolicy = enumValue<AbilityCombatProviderStackingPolicy>(input.stackingPolicy, `${path}.stackingPolicy`, POLICY_SET)
    if (stackingPolicy === 'stack' && ['move-type', 'critical'].includes(effect.kind)) {
      fail('invalid-provider', path, 'move-type and critical providers cannot use stack policy.')
    }
    if (!Number.isSafeInteger(input.priority) || Math.abs(Number(input.priority)) > ABILITY_COMBAT_PROVIDER_LIMITS.priority) {
      fail('invalid-provider', `${path}.priority`, 'must be a bounded integer.')
    }
    return Object.freeze({
      schemaVersion: 1,
      providerId: stableId(input.providerId, `${path}.providerId`),
      abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
      canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      sourcePlacementId: stableId(input.sourcePlacementId, `${path}.sourcePlacementId`),
      subject: enumValue<AbilityCombatProviderSubject>(input.subject, `${path}.subject`, SUBJECT_SET),
      relation: enumValue<AbilityCombatProviderRelation>(input.relation, `${path}.relation`, RELATION_SET),
      predicate: parsePredicate(input.predicate, `${path}.predicate`), effect,
      stackingGroup: stableId(input.stackingGroup, `${path}.stackingGroup`),
      stackingPolicy,
      priority: Number(input.priority),
      reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
    })
  })
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length) fail('duplicate-id', 'abilityCombatProviders', 'must not repeat provider IDs.')
  return deepFreezeStrictJson(providers)
}
const compare = (left: AbilityCombatProvider, right: AbilityCombatProvider): number => left.priority - right.priority
  || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
  || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
  || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0)
const numericEffectValue = (provider: AbilityCombatProvider): number | null => {
  const effect = provider.effect
  if ('value' in effect && typeof effect.value === 'number') return effect.value
  return null
}
const selectedProviders = (
  providers: readonly AbilityCombatProvider[],
): { readonly selected: readonly AbilityCombatProvider[]; readonly shadowed: readonly AbilityCombatProvider[] } => {
  if (providers.length === 0) return { selected: [], shadowed: [] }
  const policy = providers[0]!.stackingPolicy
  if (providers.some(provider => provider.stackingPolicy !== policy)) fail('stacking-conflict', providers[0]!.stackingGroup, 'providers disagree on stacking policy.')
  if (policy === 'exclusive') {
    if (providers.length !== 1) fail('stacking-conflict', providers[0]!.stackingGroup, 'exclusive group has multiple providers.')
    return { selected: providers, shadowed: [] }
  }
  if (policy === 'stack') return { selected: providers, shadowed: [] }
  let selected: AbilityCombatProvider
  if (policy === 'priority') selected = [...providers].sort(compare).at(-1)!
  else {
    if (providers.some(provider => numericEffectValue(provider) === null)) fail('stacking-conflict', providers[0]!.stackingGroup, 'highest/lowest requires numeric effects.')
    selected = [...providers].sort((left, right) => (
      numericEffectValue(left)! - numericEffectValue(right)! || compare(left, right)
    ))[policy === 'highest' ? providers.length - 1 : 0]!
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
const predicateMatches = (
  predicate: AbilityCombatProviderPredicate,
  fact: AbilityCombatProviderFact,
  moveType: AbilityCombatProviderTypeId,
  hasStab: boolean,
): boolean => (predicate.moveIds.length === 0 || predicate.moveIds.includes(fact.moveId))
  && (predicate.moveTypes.length === 0 || predicate.moveTypes.includes(moveType))
  && (predicate.damageClasses.length === 0 || predicate.damageClasses.includes(fact.damageClass))
  && predicate.requiredKeywords.every(keyword => fact.keywords.includes(keyword))
  && predicate.excludedKeywords.every(keyword => !fact.keywords.includes(keyword))
  && (predicate.requiresStab === null || predicate.requiresStab === hasStab)
const groupKey = (provider: AbilityCombatProvider): string => {
  const effect = provider.effect
  return `${effect.kind}|${effect.kind === 'damage' ? effect.stage : '-'}|${provider.stackingGroup}`
}
const validFact = (fact: AbilityCombatProviderFact): void => {
  if (!TYPE_SET.has(fact.moveType) || !DAMAGE_CLASS_SET.has(fact.damageClass)
    || !Number.isFinite(fact.baseAccuracyModifier)
    || !Number.isSafeInteger(fact.standardStabDamageBaseBonus)
    || fact.standardStabDamageBaseBonus < 0
    || (fact.baseDamageBase !== null && (!Number.isSafeInteger(fact.baseDamageBase) || fact.baseDamageBase < 0 || fact.baseDamageBase > 100))
    || (fact.baseCriticalMinimum !== null && (!Number.isSafeInteger(fact.baseCriticalMinimum) || fact.baseCriticalMinimum < 1 || fact.baseCriticalMinimum > 20))
    || (fact.naturalAccuracyRoll !== null && (!Number.isSafeInteger(fact.naturalAccuracyRoll) || fact.naturalAccuracyRoll < 1 || fact.naturalAccuracyRoll > 20))
    || (fact.naturalCriticalRoll !== null && (!Number.isSafeInteger(fact.naturalCriticalRoll) || fact.naturalCriticalRoll < 1 || fact.naturalCriticalRoll > 20))
    || fact.actorTypeIds.some(typeId => !TYPE_SET.has(typeId))) {
    fail('invalid-provider', 'abilityCombatProviderFact', 'contains invalid combat facts.')
  }
  if (new Set(fact.actorTypeIds).size !== fact.actorTypeIds.length
    || new Set(fact.keywords).size !== fact.keywords.length
    || fact.keywords.some(keyword => !ID.test(keyword))) {
    fail('duplicate-id', 'abilityCombatProviderFact', 'type IDs and keywords must be unique stable values.')
  }
}
/** Resolve authorized providers in fixed type → STAB → DB → damage → accuracy → critical order. */
export const resolveAbilityCombatProviders = (input: {
  readonly providers: unknown
  readonly fact: AbilityCombatProviderFact
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
}): AbilityCombatProviderResolution => {
  validFact(input.fact)
  const providers = [...parseAbilityCombatProviders(input.providers)].sort(compare)
  const trace: AbilityCombatProviderTraceEntry[] = []
  let moveType = input.fact.moveType
  let hasStab = input.fact.baseHasStab
  let stabBonus = input.fact.standardStabDamageBaseBonus
  let damageBase = input.fact.baseDamageBase
  let accuracy = input.fact.baseAccuracyModifier
  let automaticHit = false
  let criticalMinimum = input.fact.baseCriticalMinimum
  let criticalAutomatic: 'always' | 'never' | null = null
  const damageModifiers: AbilityCombatDamageModifier[] = []
  const phases: readonly AbilityCombatProviderEffectKind[] = ['move-type', 'stab', 'damage-base', 'damage', 'accuracy', 'critical']
  for (const phase of phases) {
    const phaseCandidates: AbilityCombatProvider[] = []
    for (const provider of providers.filter(entry => entry.effect.kind === phase)) {
      const subjectId = provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId
      const relation = input.relation(provider.sourcePlacementId, subjectId)
      if (provider.relation !== 'any' && provider.relation !== relation) {
        trace.push({ providerId: provider.providerId, effectKind: phase, status: 'scope-false', reasonCode: provider.reasonCode, before: null, after: null })
        continue
      }
      if (!predicateMatches(provider.predicate, input.fact, moveType, hasStab)) {
        trace.push({ providerId: provider.providerId, effectKind: phase, status: 'predicate-false', reasonCode: provider.reasonCode, before: null, after: null })
        continue
      }
      phaseCandidates.push(provider)
    }
    if (phase === 'damage') {
      const stageOrder = new Map(ABILITY_COMBAT_PROVIDER_DAMAGE_STAGES.map((stage, index) => [stage, index]))
      phaseCandidates.sort((left, right) => (
        stageOrder.get((left.effect as Extract<AbilityCombatProviderEffect, { kind: 'damage' }>).stage)!
        - stageOrder.get((right.effect as Extract<AbilityCombatProviderEffect, { kind: 'damage' }>).stage)!
        || compare(left, right)
      ))
    }
    const groups = new Map<string, AbilityCombatProvider[]>()
    for (const provider of phaseCandidates) groups.set(groupKey(provider), [...(groups.get(groupKey(provider)) ?? []), provider])
    for (const candidates of groups.values()) {
      const selection = selectedProviders(candidates)
      for (const provider of selection.shadowed) trace.push({
        providerId: provider.providerId, effectKind: phase, status: 'shadowed', reasonCode: provider.reasonCode, before: null, after: null,
      })
      for (const provider of selection.selected) {
        const effect = provider.effect
        let before: number | string | boolean | null = null
        let after: number | string | boolean | null = null
        if (effect.kind === 'move-type') { before = moveType; moveType = effect.typeId; after = moveType }
        else if (effect.kind === 'stab') {
          before = effect.operation === 'bonus' ? stabBonus : hasStab
          if (effect.operation === 'grant') hasStab = true
          else if (effect.operation === 'suppress') hasStab = false
          else stabBonus += effect.value!
          after = effect.operation === 'bonus' ? stabBonus : hasStab
        }
        else if (effect.kind === 'damage-base') {
          before = damageBase
          if (damageBase !== null) damageBase = numeric(damageBase, effect.operation, effect.value)
          after = damageBase
        }
        else if (effect.kind === 'damage') {
          damageModifiers.push({
            providerId: provider.providerId, stage: effect.stage, operation: effect.operation,
            value: effect.value, reasonCode: provider.reasonCode,
          })
          before = null; after = effect.value
        }
        else if (effect.kind === 'accuracy') {
          before = effect.operation === 'automatic-hit' ? automaticHit : accuracy
          if (effect.operation === 'automatic-hit') automaticHit = true
          else accuracy = numeric(accuracy, effect.operation, effect.value!)
          after = effect.operation === 'automatic-hit' ? automaticHit : accuracy
        }
        else {
          before = criticalAutomatic ?? criticalMinimum
          if (effect.operation === 'always' || effect.operation === 'never') criticalAutomatic = effect.operation
          else if (effect.operation === 'set-minimum') criticalMinimum = effect.value
          else if (criticalMinimum !== null) criticalMinimum = Math.max(1, criticalMinimum - effect.value!)
          after = criticalAutomatic ?? criticalMinimum
        }
        trace.push({ providerId: provider.providerId, effectKind: phase, status: 'applied', reasonCode: provider.reasonCode, before, after })
      }
    }
    if (phase === 'move-type') {
      hasStab = input.fact.baseHasStab || input.fact.actorTypeIds.includes(moveType)
    }
    if (phase === 'stab' && damageBase !== null && hasStab) damageBase += stabBonus
  }
  if (damageBase !== null) damageBase = Math.max(0, Math.min(100, Math.trunc(damageBase)))
  const natural = input.fact.naturalCriticalRoll
  const criticalCandidate = criticalAutomatic === 'always'
    || (criticalAutomatic !== 'never' && criticalMinimum !== null && natural !== null && natural >= criticalMinimum)
  return deepFreezeStrictJson({
    moveType,
    stab: { base: input.fact.baseHasStab, effective: hasStab, damageBaseBonus: hasStab ? stabBonus : 0 },
    damageBase,
    damageModifiers: Object.freeze(damageModifiers),
    accuracy: { modifier: accuracy, automaticHit, naturalRoll: input.fact.naturalAccuracyRoll },
    critical: { minimum: criticalMinimum, automatic: criticalAutomatic, naturalRoll: natural, candidate: criticalCandidate },
    trace: Object.freeze(trace),
  })
}
const applyModifiers = (
  value: number,
  modifiers: readonly AbilityCombatDamageModifier[],
): number => modifiers.reduce((current, modifier) => numeric(current, modifier.operation, modifier.value), value)
/** Apply staged provider damage with one explicit authoritative effectiveness multiplier. */
export const applyAbilityCombatDamageProviders = (input: {
  readonly baseDamage: number
  readonly typeMultiplier: number
  readonly resolution: AbilityCombatProviderResolution
}): AppliedAbilityCombatDamage => {
  if (!Number.isFinite(input.baseDamage) || input.baseDamage < 0
    || !Number.isFinite(input.typeMultiplier) || input.typeMultiplier < 0) {
    fail('invalid-provider', 'abilityCombatDamage', 'damage and type multiplier must be non-negative finite values.')
  }
  const pre = input.resolution.damageModifiers.filter(entry => entry.stage === 'pre-type')
  const post = input.resolution.damageModifiers.filter(entry => entry.stage === 'post-type')
  const final = input.resolution.damageModifiers.filter(entry => entry.stage === 'final')
  const preTypeDamage = applyModifiers(input.baseDamage, pre)
  const typedDamage = preTypeDamage * input.typeMultiplier
  const postTypeDamage = applyModifiers(typedDamage, post)
  const finalDamage = Math.max(0, Math.floor(applyModifiers(postTypeDamage, final)))
  return deepFreezeStrictJson({
    baseDamage: input.baseDamage, preTypeDamage, typeMultiplier: input.typeMultiplier,
    typedDamage, postTypeDamage, finalDamage,
    modifiers: input.resolution.damageModifiers,
  })
}
