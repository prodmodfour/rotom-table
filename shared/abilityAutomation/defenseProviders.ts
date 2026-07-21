import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import {
  ABILITY_COMBAT_PROVIDER_TYPE_IDS,
  type AbilityCombatProviderDamageStage,
  type AbilityCombatProviderRelation,
  type AbilityCombatProviderSubject,
  type AbilityCombatProviderTypeId,
} from './combatProviders'

export const ABILITY_DEFENSE_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_DEFENSE_EFFECT_KINDS = ['immunity', 'resistance', 'vulnerability', 'protection', 'bypass'] as const
export const ABILITY_DEFENSE_MATCH_CATEGORIES = ['all-damage', 'move-id', 'move-type', 'keyword', 'damage-class'] as const
export const ABILITY_DEFENSE_PROTECTION_CATEGORIES = [
  'damage', 'condition', 'combat-stage', 'critical', 'forced-movement', 'item', 'ability', 'targeting',
] as const
export const ABILITY_DEFENSE_STACKING_POLICIES = ['stack', 'highest', 'lowest', 'priority', 'exclusive', 'union'] as const
export type AbilityDefenseEffectKind = (typeof ABILITY_DEFENSE_EFFECT_KINDS)[number]
export type AbilityDefenseMatchCategory = (typeof ABILITY_DEFENSE_MATCH_CATEGORIES)[number]
export type AbilityDefenseProtectionCategory = (typeof ABILITY_DEFENSE_PROTECTION_CATEGORIES)[number]
export type AbilityDefenseStackingPolicy = (typeof ABILITY_DEFENSE_STACKING_POLICIES)[number]
export interface AbilityDefensePredicate {
  readonly moveIds: readonly string[]
  readonly moveTypes: readonly AbilityCombatProviderTypeId[]
  readonly damageClasses: readonly ('physical' | 'special' | 'status')[]
  readonly requiredKeywords: readonly string[]
  readonly excludedKeywords: readonly string[]
}
export type AbilityDefenseProviderEffect =
  | {
      readonly kind: 'immunity'
      readonly category: AbilityDefenseMatchCategory
      readonly value: string | null
      readonly protectionTag: string
    }
  | {
      readonly kind: 'resistance' | 'vulnerability'
      readonly category: AbilityDefenseMatchCategory
      readonly value: string | null
      readonly steps: number
      readonly protectionTag: string
    }
  | {
      readonly kind: 'protection'
      readonly categories: readonly AbilityDefenseProtectionCategory[]
      readonly protectionTag: string
    }
  | {
      readonly kind: 'bypass'
      readonly bypassKinds: readonly ('immunity' | 'resistance' | 'protection')[]
      readonly protectionTags: readonly string[]
    }
export interface AbilityDefenseProvider {
  readonly schemaVersion: typeof ABILITY_DEFENSE_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly subject: AbilityCombatProviderSubject
  readonly relation: AbilityCombatProviderRelation
  readonly predicate: AbilityDefensePredicate
  readonly effect: AbilityDefenseProviderEffect
  readonly stackingGroup: string
  readonly stackingPolicy: AbilityDefenseStackingPolicy
  readonly priority: number
  readonly reasonCode: string
}
export interface AbilityDefenseFact {
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly moveId: string
  readonly moveType: AbilityCombatProviderTypeId
  readonly damageClass: 'physical' | 'special' | 'status'
  readonly keywords: readonly string[]
  readonly effectCategory: AbilityDefenseProtectionCategory
  readonly baseTypeMultiplier: number
}
export interface AbilityDefenseTraceEntry {
  readonly providerId: string
  readonly effectKind: AbilityDefenseEffectKind
  readonly status: 'applied' | 'bypassed' | 'scope-false' | 'predicate-false' | 'shadowed'
  readonly reasonCode: string
  readonly protectionTag: string | null
  readonly before: number | boolean | null
  readonly after: number | boolean | null
}
export interface AbilityDefenseResolution {
  readonly protected: boolean
  readonly protectionProviderIds: readonly string[]
  readonly immune: boolean
  readonly immunityProviderIds: readonly string[]
  readonly bypassedProviderIds: readonly string[]
  readonly resistanceSteps: number
  readonly vulnerabilitySteps: number
  readonly baseTypeMultiplier: number
  readonly finalTypeMultiplier: number
  readonly damagePrevented: boolean
  readonly trace: readonly AbilityDefenseTraceEntry[]
}
export const ABILITY_DEFENSE_PROVIDER_LIMITS = Object.freeze({
  providers: 1_024, list: 128, identifier: 200, priority: 1_000, steps: 8,
})
export class AbilityDefenseProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'stacking-conflict' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityDefenseProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'subject', 'relation', 'predicate', 'effect', 'stackingGroup', 'stackingPolicy', 'priority', 'reasonCode',
] as const
const PREDICATE_FIELDS = ['moveIds', 'moveTypes', 'damageClasses', 'requiredKeywords', 'excludedKeywords'] as const
const EFFECT_FIELDS: Readonly<Record<AbilityDefenseEffectKind, readonly string[]>> = {
  immunity: ['kind', 'category', 'value', 'protectionTag'],
  resistance: ['kind', 'category', 'value', 'steps', 'protectionTag'],
  vulnerability: ['kind', 'category', 'value', 'steps', 'protectionTag'],
  protection: ['kind', 'categories', 'protectionTag'],
  bypass: ['kind', 'bypassKinds', 'protectionTags'],
}
const EFFECT_SET = new Set<string>(ABILITY_DEFENSE_EFFECT_KINDS)
const MATCH_SET = new Set<string>(ABILITY_DEFENSE_MATCH_CATEGORIES)
const PROTECTION_SET = new Set<string>(ABILITY_DEFENSE_PROTECTION_CATEGORIES)
const POLICY_SET = new Set<string>(ABILITY_DEFENSE_STACKING_POLICIES)
const SUBJECT_SET = new Set<string>(['actor', 'target'])
const RELATION_SET = new Set<string>(['self', 'ally', 'enemy', 'any'])
const TYPE_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_TYPE_IDS)
const CLASS_SET = new Set<string>(['physical', 'special', 'status'])
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityDefenseProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityDefenseProviderValidationError(code, path, detail)
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
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_DEFENSE_PROVIDER_LIMITS.identifier || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_DEFENSE_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
const enumValue = <Value extends string>(value: unknown, path: string, set: ReadonlySet<string>): Value => (
  typeof value === 'string' && set.has(value) ? value as Value : fail('invalid-provider', path, 'is unsupported.')
)
const ordered = <Value extends string>(value: unknown, path: string, parser: (value: unknown, path: string) => Value): readonly Value[] => {
  if (!Array.isArray(value) || value.length > ABILITY_DEFENSE_PROVIDER_LIMITS.list) fail('limit-exceeded', path, 'must be bounded.')
  const result = (value as unknown[]).map((entry, index) => parser(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && entry <= result[index - 1]!)) {
    fail('duplicate-id', path, 'must be unique in code-point order.')
  }
  return Object.freeze(result)
}
const parsePredicate = (value: unknown, path: string): AbilityDefensePredicate => {
  const input = record(value, path)
  exact(input, PREDICATE_FIELDS, path)
  const requiredKeywords = ordered(input.requiredKeywords, `${path}.requiredKeywords`, stableId)
  const excludedKeywords = ordered(input.excludedKeywords, `${path}.excludedKeywords`, stableId)
  if (requiredKeywords.some(entry => excludedKeywords.includes(entry))) fail('invalid-provider', path, 'keyword predicates conflict.')
  return Object.freeze({
    moveIds: ordered(input.moveIds, `${path}.moveIds`, text),
    moveTypes: ordered<AbilityCombatProviderTypeId>(input.moveTypes, `${path}.moveTypes`, (entry, entryPath) => enumValue(entry, entryPath, TYPE_SET)),
    damageClasses: ordered<'physical' | 'special' | 'status'>(input.damageClasses, `${path}.damageClasses`, (entry, entryPath) => enumValue(entry, entryPath, CLASS_SET)),
    requiredKeywords, excludedKeywords,
  })
}
const parseMatch = (input: UnknownRecord, path: string) => {
  const category = enumValue<AbilityDefenseMatchCategory>(input.category, `${path}.category`, MATCH_SET)
  const value = input.value === null ? null : text(input.value, `${path}.value`)
  if ((category === 'all-damage') !== (value === null)) fail('invalid-provider', path, 'all-damage alone has a null match value.')
  if (category === 'move-type' && value !== null && !TYPE_SET.has(value)) fail('invalid-provider', `${path}.value`, 'must be a canonical type ID.')
  if (category === 'damage-class' && value !== null && !CLASS_SET.has(value)) fail('invalid-provider', `${path}.value`, 'must be a damage class.')
  return { category, value }
}
const parseEffect = (value: unknown, path: string): AbilityDefenseProviderEffect => {
  const input = record(value, path)
  const kind = enumValue<AbilityDefenseEffectKind>(input.kind, `${path}.kind`, EFFECT_SET)
  exact(input, EFFECT_FIELDS[kind], path)
  if (kind === 'bypass') {
    const bypassKinds = ordered<'immunity' | 'resistance' | 'protection'>(input.bypassKinds, `${path}.bypassKinds`, (entry, entryPath) => enumValue(entry, entryPath, new Set(['immunity', 'resistance', 'protection'])))
    const protectionTags = ordered(input.protectionTags, `${path}.protectionTags`, stableId)
    if (bypassKinds.length === 0 || protectionTags.length === 0) fail('invalid-provider', path, 'bypass must explicitly name kinds and protection tags.')
    return Object.freeze({ kind, bypassKinds, protectionTags })
  }
  const protectionTag = stableId(input.protectionTag, `${path}.protectionTag`)
  if (kind === 'protection') {
    const categories = ordered<AbilityDefenseProtectionCategory>(input.categories, `${path}.categories`, (entry, entryPath) => enumValue(entry, entryPath, PROTECTION_SET))
    if (categories.length === 0) fail('invalid-provider', `${path}.categories`, 'must not be empty.')
    return Object.freeze({ kind, categories, protectionTag })
  }
  const match = parseMatch(input, path)
  if (kind === 'immunity') return Object.freeze({ kind, ...match, protectionTag })
  if (!Number.isSafeInteger(input.steps) || Number(input.steps) < 1 || Number(input.steps) > ABILITY_DEFENSE_PROVIDER_LIMITS.steps) {
    fail('invalid-provider', `${path}.steps`, 'must be a bounded positive integer.')
  }
  return Object.freeze({ kind, ...match, steps: Number(input.steps), protectionTag })
}
export const parseAbilityDefenseProviders = (value: unknown): readonly AbilityDefenseProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityDefenseProviders', {
    limits: { depth: 8, nodes: 65_536, objectFields: 20, arrayEntries: ABILITY_DEFENSE_PROVIDER_LIMITS.providers, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability defense providers', valueLabel: 'ability defense provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_DEFENSE_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityDefenseProviders', 'must be bounded.')
  const result = (cloned as unknown[]).map((entry, index): AbilityDefenseProvider => {
    const path = `abilityDefenseProviders[${index}]`
    const input = record(entry, path)
    exact(input, PROVIDER_FIELDS, path)
    if (input.schemaVersion !== 1) fail('invalid-provider', `${path}.schemaVersion`, 'is unsupported.')
    const effect = parseEffect(input.effect, `${path}.effect`)
    const stackingPolicy = enumValue<AbilityDefenseStackingPolicy>(input.stackingPolicy, `${path}.stackingPolicy`, POLICY_SET)
    if ((effect.kind === 'bypass' || effect.kind === 'protection' || effect.kind === 'immunity')
      && !['union', 'priority', 'exclusive'].includes(stackingPolicy)) {
      fail('invalid-provider', path, `${effect.kind} requires union, priority, or exclusive stacking.`)
    }
    if (!Number.isSafeInteger(input.priority) || Math.abs(Number(input.priority)) > ABILITY_DEFENSE_PROVIDER_LIMITS.priority) {
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
  if (new Set(result.map(entry => entry.providerId)).size !== result.length) fail('duplicate-id', 'abilityDefenseProviders', 'must not repeat provider IDs.')
  return deepFreezeStrictJson(result)
}
const compare = (left: AbilityDefenseProvider, right: AbilityDefenseProvider): number => left.priority - right.priority
  || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
  || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
  || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0)
const predicateMatches = (predicate: AbilityDefensePredicate, fact: AbilityDefenseFact): boolean => (
  (predicate.moveIds.length === 0 || predicate.moveIds.includes(fact.moveId))
  && (predicate.moveTypes.length === 0 || predicate.moveTypes.includes(fact.moveType))
  && (predicate.damageClasses.length === 0 || predicate.damageClasses.includes(fact.damageClass))
  && predicate.requiredKeywords.every(entry => fact.keywords.includes(entry))
  && predicate.excludedKeywords.every(entry => !fact.keywords.includes(entry))
)
const effectMatches = (
  effect: Extract<AbilityDefenseProviderEffect, { kind: 'immunity' | 'resistance' | 'vulnerability' }>,
  fact: AbilityDefenseFact,
): boolean => effect.category === 'all-damage'
  || (effect.category === 'move-id' && effect.value === fact.moveId)
  || (effect.category === 'move-type' && effect.value === fact.moveType)
  || (effect.category === 'keyword' && effect.value !== null && fact.keywords.includes(effect.value))
  || (effect.category === 'damage-class' && effect.value === fact.damageClass)
const selection = (providers: readonly AbilityDefenseProvider[]) => {
  if (providers.length === 0) return { selected: [] as AbilityDefenseProvider[], shadowed: [] as AbilityDefenseProvider[] }
  const policy = providers[0]!.stackingPolicy
  if (providers.some(provider => provider.stackingPolicy !== policy)) fail('stacking-conflict', providers[0]!.stackingGroup, 'providers disagree on stacking policy.')
  if (policy === 'exclusive' && providers.length !== 1) fail('stacking-conflict', providers[0]!.stackingGroup, 'exclusive group has multiple providers.')
  if (policy === 'stack' || policy === 'union' || policy === 'exclusive') return { selected: [...providers], shadowed: [] }
  let selected: AbilityDefenseProvider
  if (policy === 'priority') selected = [...providers].sort(compare).at(-1)!
  else {
    if (providers.some(provider => provider.effect.kind !== 'resistance' && provider.effect.kind !== 'vulnerability')) {
      fail('stacking-conflict', providers[0]!.stackingGroup, 'highest/lowest requires step effects.')
    }
    const sorted = [...providers].sort((left, right) => (
      (left.effect as Extract<AbilityDefenseProviderEffect, { kind: 'resistance' | 'vulnerability' }>).steps
      - (right.effect as Extract<AbilityDefenseProviderEffect, { kind: 'resistance' | 'vulnerability' }>).steps
      || compare(left, right)
    ))
    selected = sorted[policy === 'highest' ? sorted.length - 1 : 0]!
  }
  return { selected: [selected], shadowed: providers.filter(provider => provider !== selected) }
}
const stepsFromMultiplier = (value: number): number | null => {
  if (value === 0) return null
  if (value === 1) return 0
  if (value === 1.5) return 1
  if (value >= 2 && Number.isInteger(value)) return value
  if (value > 0 && value < 1) {
    const steps = Math.log2(1 / value)
    return Number.isInteger(steps) ? -steps : 0
  }
  return 0
}
const multiplierFromSteps = (steps: number): number => steps < 0 ? 1 / (2 ** Math.abs(steps)) : steps === 0 ? 1 : steps === 1 ? 1.5 : steps
const validFact = (fact: AbilityDefenseFact): void => {
  if (!TYPE_SET.has(fact.moveType) || !CLASS_SET.has(fact.damageClass) || !PROTECTION_SET.has(fact.effectCategory)
    || !Number.isFinite(fact.baseTypeMultiplier) || fact.baseTypeMultiplier < 0
    || new Set(fact.keywords).size !== fact.keywords.length || fact.keywords.some(entry => !ID.test(entry))) {
    fail('invalid-provider', 'abilityDefenseFact', 'contains invalid authoritative facts.')
  }
}
/** Resolve explicit bypass first, then protection, immunity, resistance, and vulnerability. */
export const resolveAbilityDefenseProviders = (input: {
  readonly providers: unknown
  readonly fact: AbilityDefenseFact
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
}): AbilityDefenseResolution => {
  validFact(input.fact)
  const providers = [...parseAbilityDefenseProviders(input.providers)].sort(compare)
  const trace: AbilityDefenseTraceEntry[] = []
  const eligible: AbilityDefenseProvider[] = []
  for (const provider of providers) {
    const subjectId = provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId
    const relation = input.relation(provider.sourcePlacementId, subjectId)
    if (provider.relation !== 'any' && provider.relation !== relation) {
      trace.push({ providerId: provider.providerId, effectKind: provider.effect.kind, status: 'scope-false', reasonCode: provider.reasonCode, protectionTag: null, before: null, after: null })
    }
    else if (!predicateMatches(provider.predicate, input.fact)) {
      trace.push({ providerId: provider.providerId, effectKind: provider.effect.kind, status: 'predicate-false', reasonCode: provider.reasonCode, protectionTag: null, before: null, after: null })
    }
    else eligible.push(provider)
  }
  const bypassTags = new Map<'immunity' | 'resistance' | 'protection', Set<string>>([
    ['immunity', new Set()], ['resistance', new Set()], ['protection', new Set()],
  ])
  const bypassGroups = new Map<string, AbilityDefenseProvider[]>()
  for (const provider of eligible.filter(provider => provider.effect.kind === 'bypass')) {
    bypassGroups.set(provider.stackingGroup, [...(bypassGroups.get(provider.stackingGroup) ?? []), provider])
  }
  for (const candidates of bypassGroups.values()) {
    const chosen = selection(candidates)
    chosen.shadowed.forEach(provider => trace.push({
      providerId: provider.providerId, effectKind: 'bypass', status: 'shadowed',
      reasonCode: provider.reasonCode, protectionTag: null, before: null, after: null,
    }))
    for (const provider of chosen.selected) {
      const effect = provider.effect as Extract<AbilityDefenseProviderEffect, { kind: 'bypass' }>
      effect.bypassKinds.forEach(kind => effect.protectionTags.forEach(tag => bypassTags.get(kind)!.add(tag)))
      trace.push({ providerId: provider.providerId, effectKind: 'bypass', status: 'applied', reasonCode: provider.reasonCode, protectionTag: null, before: false, after: true })
    }
  }
  const defensive = eligible.filter(provider => provider.effect.kind !== 'bypass')
  const groups = new Map<string, AbilityDefenseProvider[]>()
  for (const provider of defensive) {
    const key = `${provider.effect.kind}|${provider.stackingGroup}`
    groups.set(key, [...(groups.get(key) ?? []), provider])
  }
  const selected: AbilityDefenseProvider[] = []
  for (const candidates of groups.values()) {
    const chosen = selection(candidates)
    selected.push(...chosen.selected)
    chosen.shadowed.forEach(provider => trace.push({
      providerId: provider.providerId, effectKind: provider.effect.kind, status: 'shadowed',
      reasonCode: provider.reasonCode, protectionTag: 'protectionTag' in provider.effect ? provider.effect.protectionTag : null,
      before: null, after: null,
    }))
  }
  const protectionProviderIds: string[] = []
  const immunityProviderIds: string[] = []
  const bypassedProviderIds: string[] = []
  let resistanceSteps = 0
  let vulnerabilitySteps = 0
  for (const provider of selected.sort(compare)) {
    const effect = provider.effect
    if (effect.kind === 'bypass') continue
    const bypassKind = effect.kind === 'protection' ? 'protection'
      : effect.kind === 'immunity' ? 'immunity'
        : effect.kind === 'resistance' ? 'resistance' : null
    if (bypassKind !== null && bypassTags.get(bypassKind)!.has(effect.protectionTag)) {
      bypassedProviderIds.push(provider.providerId)
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: 'bypassed', reasonCode: provider.reasonCode, protectionTag: effect.protectionTag, before: true, after: false })
      continue
    }
    if (effect.kind === 'protection') {
      const applies = effect.categories.includes(input.fact.effectCategory)
      if (applies) protectionProviderIds.push(provider.providerId)
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: applies ? 'applied' : 'predicate-false', reasonCode: provider.reasonCode, protectionTag: effect.protectionTag, before: false, after: applies })
      continue
    }
    const applies = effectMatches(effect, input.fact)
    if (!applies) {
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: 'predicate-false', reasonCode: provider.reasonCode, protectionTag: effect.protectionTag, before: null, after: null })
      continue
    }
    if (effect.kind === 'immunity') immunityProviderIds.push(provider.providerId)
    else if (effect.kind === 'resistance') resistanceSteps += effect.steps
    else vulnerabilitySteps += effect.steps
    trace.push({
      providerId: provider.providerId, effectKind: effect.kind, status: 'applied', reasonCode: provider.reasonCode,
      protectionTag: effect.protectionTag,
      before: effect.kind === 'immunity' ? false : effect.kind === 'resistance' ? resistanceSteps - effect.steps : vulnerabilitySteps - effect.steps,
      after: effect.kind === 'immunity' ? true : effect.kind === 'resistance' ? resistanceSteps : vulnerabilitySteps,
    })
  }
  const protectedValue = protectionProviderIds.length > 0
  const immune = immunityProviderIds.length > 0
  const baseSteps = stepsFromMultiplier(input.fact.baseTypeMultiplier)
  const finalTypeMultiplier = immune ? 0 : baseSteps === null ? 0 : multiplierFromSteps(baseSteps - resistanceSteps + vulnerabilitySteps)
  return deepFreezeStrictJson({
    protected: protectedValue,
    protectionProviderIds: Object.freeze(protectionProviderIds),
    immune,
    immunityProviderIds: Object.freeze(immunityProviderIds),
    bypassedProviderIds: Object.freeze(bypassedProviderIds),
    resistanceSteps,
    vulnerabilitySteps,
    baseTypeMultiplier: input.fact.baseTypeMultiplier,
    finalTypeMultiplier,
    damagePrevented: input.fact.effectCategory === 'damage' && (protectedValue || immune || finalTypeMultiplier === 0),
    trace: Object.freeze(trace),
  })
}
