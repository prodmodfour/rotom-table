import {
  parseAbilityCheckDefinition,
  type AbilityCheckDefinition,
  type AbilityCheckResolution,
} from './checks'
import type { AbilityCombatProviderRelation, AbilityCombatProviderSubject } from './combatProviders'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_CONDITION_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_CONDITION_OPERATIONS = ['apply', 'cure', 'transfer'] as const
export const ABILITY_CONDITION_EFFECT_KINDS = ['condition', 'save', 'prevention', 'cure', 'reflection', 'transfer'] as const
export const ABILITY_CONDITION_STACKING_POLICIES = ['stack', 'union', 'priority', 'exclusive'] as const
export type AbilityConditionOperation = (typeof ABILITY_CONDITION_OPERATIONS)[number]
export type AbilityConditionEffectKind = (typeof ABILITY_CONDITION_EFFECT_KINDS)[number]
export type AbilityConditionStackingPolicy = (typeof ABILITY_CONDITION_STACKING_POLICIES)[number]
export interface AbilityConditionProviderPredicate {
  readonly operations: readonly AbilityConditionOperation[]
  readonly conditionIds: readonly string[]
  readonly requiredSourceTags: readonly string[]
  readonly excludedSourceTags: readonly string[]
}
export type AbilityConditionProviderEffect =
  | { readonly kind: 'condition'; readonly action: 'add' | 'remove'; readonly conditionIds: readonly string[] }
  | { readonly kind: 'save'; readonly definition: AbilityCheckDefinition }
  | { readonly kind: 'prevention'; readonly conditionIds: readonly string[] }
  | { readonly kind: 'cure'; readonly conditionIds: readonly string[] }
  | {
      readonly kind: 'reflection'
      readonly conditionIds: readonly string[]
      readonly destination: 'actor'
      readonly targetPolicy: 'prevent' | 'retain'
    }
  | {
      readonly kind: 'transfer'
      readonly conditionIds: readonly string[]
      readonly direction: 'target-to-actor' | 'actor-to-target'
    }
export interface AbilityConditionProvider {
  readonly schemaVersion: typeof ABILITY_CONDITION_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly subject: AbilityCombatProviderSubject
  readonly relation: AbilityCombatProviderRelation
  readonly predicate: AbilityConditionProviderPredicate
  readonly effect: AbilityConditionProviderEffect
  readonly stackingGroup: string
  readonly stackingPolicy: AbilityConditionStackingPolicy
  readonly priority: number
  readonly reasonCode: string
}
export interface AbilityConditionFact {
  readonly operationId: string
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly operation: AbilityConditionOperation
  readonly conditionId: string
  readonly sourceTags: readonly string[]
  readonly actorConditions: readonly string[]
  readonly targetConditions: readonly string[]
  readonly saveResolutions: readonly {
    readonly providerId: string
    readonly resolution: AbilityCheckResolution
  }[]
}
export interface AbilityConditionTraceEntry {
  readonly providerId: string
  readonly effectKind: AbilityConditionEffectKind
  readonly status: 'applied' | 'scope-false' | 'predicate-false' | 'shadowed'
  readonly reasonCode: string
  readonly conditionId: string | null
  readonly detail: string
}
export interface AbilityConditionEmission {
  readonly providerId: string
  readonly kind: 'reflected' | 'transferred' | 'added' | 'removed'
  readonly conditionId: string
  readonly fromPlacementId: string | null
  readonly toPlacementId: string | null
}
export interface AbilityConditionResolution {
  readonly operation: AbilityConditionOperation
  readonly conditionId: string
  readonly outcome: 'applied' | 'cured' | 'transferred' | 'prevented' | 'saved' | 'reflected' | 'no-op'
  readonly actorConditions: readonly string[]
  readonly targetConditions: readonly string[]
  readonly preventionProviderIds: readonly string[]
  readonly saveProviderIds: readonly string[]
  readonly emissions: readonly AbilityConditionEmission[]
  readonly trace: readonly AbilityConditionTraceEntry[]
}
export const ABILITY_CONDITION_PROVIDER_LIMITS = Object.freeze({
  providers: 1_024, list: 128, identifier: 200, priority: 1_000,
})
export class AbilityConditionProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'stacking-conflict' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityConditionProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'subject', 'relation', 'predicate', 'effect', 'stackingGroup', 'stackingPolicy', 'priority', 'reasonCode',
] as const
const PREDICATE_FIELDS = ['operations', 'conditionIds', 'requiredSourceTags', 'excludedSourceTags'] as const
const EFFECT_FIELDS: Readonly<Record<AbilityConditionEffectKind, readonly string[]>> = {
  condition: ['kind', 'action', 'conditionIds'], save: ['kind', 'definition'],
  prevention: ['kind', 'conditionIds'], cure: ['kind', 'conditionIds'],
  reflection: ['kind', 'conditionIds', 'destination', 'targetPolicy'],
  transfer: ['kind', 'conditionIds', 'direction'],
}
const OPERATION_SET = new Set<string>(ABILITY_CONDITION_OPERATIONS)
const EFFECT_SET = new Set<string>(ABILITY_CONDITION_EFFECT_KINDS)
const POLICY_SET = new Set<string>(ABILITY_CONDITION_STACKING_POLICIES)
const SUBJECT_SET = new Set<string>(['actor', 'target'])
const RELATION_SET = new Set<string>(['self', 'ally', 'enemy', 'any'])
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityConditionProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityConditionProviderValidationError(code, path, detail)
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
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_CONDITION_PROVIDER_LIMITS.identifier || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_CONDITION_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
const enumValue = <Value extends string>(value: unknown, path: string, set: ReadonlySet<string>): Value => (
  typeof value === 'string' && set.has(value) ? value as Value : fail('invalid-provider', path, 'is unsupported.')
)
const ordered = <Value extends string>(value: unknown, path: string, parser: (value: unknown, path: string) => Value): readonly Value[] => {
  if (!Array.isArray(value) || value.length > ABILITY_CONDITION_PROVIDER_LIMITS.list) fail('limit-exceeded', path, 'must be bounded.')
  const result = (value as unknown[]).map((entry, index) => parser(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && entry <= result[index - 1]!)) {
    fail('duplicate-id', path, 'must be unique in code-point order.')
  }
  return Object.freeze(result)
}
const conditionIds = (value: unknown, path: string): readonly string[] => ordered(value, path, stableId)
const parsePredicate = (value: unknown, path: string): AbilityConditionProviderPredicate => {
  const input = record(value, path)
  exact(input, PREDICATE_FIELDS, path)
  const requiredSourceTags = ordered(input.requiredSourceTags, `${path}.requiredSourceTags`, stableId)
  const excludedSourceTags = ordered(input.excludedSourceTags, `${path}.excludedSourceTags`, stableId)
  if (requiredSourceTags.some(tag => excludedSourceTags.includes(tag))) fail('invalid-provider', path, 'source-tag predicates conflict.')
  return Object.freeze({
    operations: ordered<AbilityConditionOperation>(input.operations, `${path}.operations`, (entry, entryPath) => enumValue(entry, entryPath, OPERATION_SET)),
    conditionIds: conditionIds(input.conditionIds, `${path}.conditionIds`),
    requiredSourceTags, excludedSourceTags,
  })
}
const parseEffect = (value: unknown, path: string): AbilityConditionProviderEffect => {
  const input = record(value, path)
  const kind = enumValue<AbilityConditionEffectKind>(input.kind, `${path}.kind`, EFFECT_SET)
  exact(input, EFFECT_FIELDS[kind], path)
  if (kind === 'save') {
    const definition = parseAbilityCheckDefinition(input.definition)
    if (definition.checkKind !== 'save' || definition.threshold === null) {
      fail('invalid-provider', `${path}.definition`, 'must be a threshold-bearing save definition.')
    }
    return Object.freeze({ kind, definition })
  }
  const ids = conditionIds(input.conditionIds, `${path}.conditionIds`)
  if (ids.length === 0) fail('invalid-provider', `${path}.conditionIds`, 'must not be empty.')
  if (kind === 'condition') {
    const action = enumValue<'add' | 'remove'>(input.action, `${path}.action`, new Set(['add', 'remove']))
    return Object.freeze({ kind, action, conditionIds: ids })
  }
  if (kind === 'prevention' || kind === 'cure') return Object.freeze({ kind, conditionIds: ids })
  if (kind === 'reflection') {
    if (input.destination !== 'actor' || (input.targetPolicy !== 'prevent' && input.targetPolicy !== 'retain')) {
      fail('invalid-provider', path, 'reflection destination or target policy is unsupported.')
    }
    return Object.freeze({
      kind,
      conditionIds: ids,
      destination: 'actor' as const,
      targetPolicy: input.targetPolicy as 'prevent' | 'retain',
    })
  }
  const direction = enumValue<'target-to-actor' | 'actor-to-target'>(input.direction, `${path}.direction`, new Set(['target-to-actor', 'actor-to-target']))
  return Object.freeze({ kind, conditionIds: ids, direction })
}
export const parseAbilityConditionProviders = (value: unknown): readonly AbilityConditionProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityConditionProviders', {
    limits: { depth: 12, nodes: 65_536, objectFields: 20, arrayEntries: ABILITY_CONDITION_PROVIDER_LIMITS.providers, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability condition providers', valueLabel: 'ability condition provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_CONDITION_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityConditionProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityConditionProvider => {
    const path = `abilityConditionProviders[${index}]`
    const input = record(entry, path)
    exact(input, PROVIDER_FIELDS, path)
    if (input.schemaVersion !== 1) fail('invalid-provider', `${path}.schemaVersion`, 'is unsupported.')
    const effect = parseEffect(input.effect, `${path}.effect`)
    const stackingPolicy = enumValue<AbilityConditionStackingPolicy>(input.stackingPolicy, `${path}.stackingPolicy`, POLICY_SET)
    if (!Number.isSafeInteger(input.priority) || Math.abs(Number(input.priority)) > ABILITY_CONDITION_PROVIDER_LIMITS.priority) {
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
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length) fail('duplicate-id', 'abilityConditionProviders', 'must not repeat provider IDs.')
  return deepFreezeStrictJson(providers)
}
const compare = (left: AbilityConditionProvider, right: AbilityConditionProvider): number => left.priority - right.priority
  || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
  || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
  || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0)
const select = (providers: readonly AbilityConditionProvider[], trace: AbilityConditionTraceEntry[]) => {
  if (providers.length === 0) return []
  const policy = providers[0]!.stackingPolicy
  if (providers.some(provider => provider.stackingPolicy !== policy)) fail('stacking-conflict', providers[0]!.stackingGroup, 'providers disagree on stacking policy.')
  if (policy === 'exclusive' && providers.length !== 1) fail('stacking-conflict', providers[0]!.stackingGroup, 'exclusive group has multiple providers.')
  if (policy === 'stack' || policy === 'union' || policy === 'exclusive') return [...providers]
  const selected = [...providers].sort(compare).at(-1)!
  providers.filter(provider => provider !== selected).forEach(provider => trace.push({
    providerId: provider.providerId, effectKind: provider.effect.kind, status: 'shadowed',
    reasonCode: provider.reasonCode, conditionId: null, detail: 'lower-priority-provider',
  }))
  return [selected]
}
const matches = (predicate: AbilityConditionProviderPredicate, fact: AbilityConditionFact): boolean => (
  (predicate.operations.length === 0 || predicate.operations.includes(fact.operation))
  && (predicate.conditionIds.length === 0 || predicate.conditionIds.includes(fact.conditionId))
  && predicate.requiredSourceTags.every(tag => fact.sourceTags.includes(tag))
  && predicate.excludedSourceTags.every(tag => !fact.sourceTags.includes(tag))
)
const validFact = (fact: AbilityConditionFact): void => {
  const lists = [fact.sourceTags, fact.actorConditions, fact.targetConditions]
  if (!ID.test(fact.operationId) || !ID.test(fact.actorPlacementId) || !ID.test(fact.targetPlacementId)
    || fact.actorPlacementId === fact.targetPlacementId || !OPERATION_SET.has(fact.operation)
    || !ID.test(fact.conditionId) || lists.some(list => list.some(value => !ID.test(value)) || new Set(list).size !== list.length)
    || new Set(fact.saveResolutions.map(entry => entry.providerId)).size !== fact.saveResolutions.length) {
    fail('invalid-provider', 'abilityConditionFact', 'contains invalid condition facts.')
  }
}
const add = (set: Set<string>, conditionId: string): boolean => {
  const before = set.size; set.add(conditionId); return set.size !== before
}
const remove = (set: Set<string>, conditionId: string): boolean => set.delete(conditionId)
export interface AbilityConditionSaveRequest {
  readonly providerId: string
  readonly definition: AbilityCheckDefinition
}
/** Determine exactly which reviewed saves may consume server entropy for this fact. */
export const requiredAbilityConditionSaves = (input: {
  readonly providers: unknown
  readonly fact: AbilityConditionFact
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
}): readonly AbilityConditionSaveRequest[] => {
  validFact(input.fact)
  const trace: AbilityConditionTraceEntry[] = []
  const eligible = [...parseAbilityConditionProviders(input.providers)].sort(compare).filter((provider) => {
    if (provider.effect.kind !== 'save') return false
    const subjectId = provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId
    const relation = input.relation(provider.sourcePlacementId, subjectId)
    return (provider.relation === 'any' || provider.relation === relation) && matches(provider.predicate, input.fact)
  })
  const groups = new Map<string, AbilityConditionProvider[]>()
  eligible.forEach(provider => groups.set(provider.stackingGroup, [...(groups.get(provider.stackingGroup) ?? []), provider]))
  return deepFreezeStrictJson([...groups.values()].flatMap(group => select(group, trace)).sort(compare).map(provider => ({
    providerId: provider.providerId,
    definition: (provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'save' }>).definition,
  })))
}

/** Resolve save/prevention, reflection, base mutation, cures, and transfers in exact order. */
export const resolveAbilityConditionProviders = (input: {
  readonly providers: unknown
  readonly fact: AbilityConditionFact
  readonly relation: (sourcePlacementId: string, subjectPlacementId: string) => 'self' | 'ally' | 'enemy' | 'unknown'
}): AbilityConditionResolution => {
  validFact(input.fact)
  const all = [...parseAbilityConditionProviders(input.providers)].sort(compare)
  const trace: AbilityConditionTraceEntry[] = []
  const eligible = all.filter((provider) => {
    const subjectId = provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId
    const relation = input.relation(provider.sourcePlacementId, subjectId)
    if (provider.relation !== 'any' && provider.relation !== relation) {
      trace.push({ providerId: provider.providerId, effectKind: provider.effect.kind, status: 'scope-false', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: 'relation-mismatch' })
      return false
    }
    if (!matches(provider.predicate, input.fact)) {
      trace.push({ providerId: provider.providerId, effectKind: provider.effect.kind, status: 'predicate-false', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: 'predicate-false' })
      return false
    }
    return true
  })
  const selectedCache = new Map<AbilityConditionEffectKind, readonly AbilityConditionProvider[]>()
  const selected = (kind: AbilityConditionEffectKind): readonly AbilityConditionProvider[] => {
    const cached = selectedCache.get(kind)
    if (cached) return cached
    const groups = new Map<string, AbilityConditionProvider[]>()
    eligible.filter(provider => provider.effect.kind === kind).forEach(provider => (
      groups.set(provider.stackingGroup, [...(groups.get(provider.stackingGroup) ?? []), provider])
    ))
    const result = [...groups.values()].flatMap(group => select(group, trace)).sort(compare)
    selectedCache.set(kind, result)
    return result
  }
  const actor = new Set(input.fact.actorConditions)
  const target = new Set(input.fact.targetConditions)
  const preventionProviderIds: string[] = []
  const saveProviderIds: string[] = []
  const emissions: AbilityConditionEmission[] = []
  let prevented = false
  let saved = false
  if (input.fact.operation === 'apply') {
    for (const provider of selected('prevention')) {
      const effect = provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'prevention' }>
      if (!effect.conditionIds.includes(input.fact.conditionId)) continue
      prevented = true
      preventionProviderIds.push(provider.providerId)
      trace.push({ providerId: provider.providerId, effectKind: 'prevention', status: 'applied', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: 'condition-prevented' })
    }
    const saveByProvider = new Map(input.fact.saveResolutions.map(entry => [entry.providerId, entry.resolution]))
    for (const provider of selected('save')) {
      const effect = provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'save' }>
      const resolution = saveByProvider.get(provider.providerId)
        ?? fail('invalid-provider', `abilityConditionFact.saveResolutions.${provider.providerId}`, 'is missing.')
      if (resolution.checkId !== effect.definition.checkId || resolution.checkKind !== 'save' || resolution.success === null) {
        fail('invalid-provider', `abilityConditionFact.saveResolutions.${provider.providerId}`, 'does not match its save definition.')
      }
      const success = resolution.success as boolean
      saveProviderIds.push(provider.providerId)
      saved ||= success
      trace.push({ providerId: provider.providerId, effectKind: 'save', status: 'applied', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: success ? 'save-passed' : 'save-failed' })
    }
    const expectedSaveIds = new Set(selected('save').map(provider => provider.providerId))
    if (input.fact.saveResolutions.some(entry => !expectedSaveIds.has(entry.providerId))) {
      fail('invalid-provider', 'abilityConditionFact.saveResolutions', 'contains an unrequested save result.')
    }
  }
  let reflected = false
  if (input.fact.operation === 'apply' && !prevented && !saved) {
    for (const provider of selected('reflection')) {
      const effect = provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'reflection' }>
      if (!effect.conditionIds.includes(input.fact.conditionId)) continue
      add(actor, input.fact.conditionId)
      reflected = true
      if (effect.targetPolicy === 'retain') add(target, input.fact.conditionId)
      emissions.push({ providerId: provider.providerId, kind: 'reflected', conditionId: input.fact.conditionId, fromPlacementId: input.fact.targetPlacementId, toPlacementId: input.fact.actorPlacementId })
      trace.push({ providerId: provider.providerId, effectKind: 'reflection', status: 'applied', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: effect.targetPolicy })
    }
  }
  let baseChanged = false
  if (!prevented && !saved && !reflected) {
    if (input.fact.operation === 'apply') baseChanged = add(target, input.fact.conditionId)
    else if (input.fact.operation === 'cure') baseChanged = remove(target, input.fact.conditionId)
    else if (remove(target, input.fact.conditionId)) {
      add(actor, input.fact.conditionId); baseChanged = true
      emissions.push({ providerId: 'base-operation', kind: 'transferred', conditionId: input.fact.conditionId, fromPlacementId: input.fact.targetPlacementId, toPlacementId: input.fact.actorPlacementId })
    }
  }
  for (const provider of selected('condition')) {
    const effect = provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'condition' }>
    const set = provider.subject === 'actor' ? actor : target
    effect.conditionIds.forEach((conditionId) => {
      const changed = effect.action === 'add' ? add(set, conditionId) : remove(set, conditionId)
      if (changed) emissions.push({ providerId: provider.providerId, kind: effect.action === 'add' ? 'added' : 'removed', conditionId, fromPlacementId: effect.action === 'remove' ? (provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId) : null, toPlacementId: effect.action === 'add' ? (provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId) : null })
    })
    trace.push({ providerId: provider.providerId, effectKind: 'condition', status: 'applied', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: effect.action })
  }
  for (const provider of selected('cure')) {
    const effect = provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'cure' }>
    const set = provider.subject === 'actor' ? actor : target
    effect.conditionIds.forEach(conditionId => {
      if (remove(set, conditionId)) emissions.push({ providerId: provider.providerId, kind: 'removed', conditionId, fromPlacementId: provider.subject === 'actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId, toPlacementId: null })
    })
    trace.push({ providerId: provider.providerId, effectKind: 'cure', status: 'applied', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: 'provider-cure' })
  }
  for (const provider of selected('transfer')) {
    const effect = provider.effect as Extract<AbilityConditionProviderEffect, { kind: 'transfer' }>
    const from = effect.direction === 'target-to-actor' ? target : actor
    const to = effect.direction === 'target-to-actor' ? actor : target
    const fromId = effect.direction === 'target-to-actor' ? input.fact.targetPlacementId : input.fact.actorPlacementId
    const toId = effect.direction === 'target-to-actor' ? input.fact.actorPlacementId : input.fact.targetPlacementId
    effect.conditionIds.forEach(conditionId => {
      if (remove(from, conditionId)) {
        add(to, conditionId)
        emissions.push({ providerId: provider.providerId, kind: 'transferred', conditionId, fromPlacementId: fromId, toPlacementId: toId })
      }
    })
    trace.push({ providerId: provider.providerId, effectKind: 'transfer', status: 'applied', reasonCode: provider.reasonCode, conditionId: input.fact.conditionId, detail: effect.direction })
  }
  const outcome: AbilityConditionResolution['outcome'] = prevented ? 'prevented'
    : saved ? 'saved'
      : reflected ? 'reflected'
        : input.fact.operation === 'cure' ? (baseChanged ? 'cured' : 'no-op')
          : input.fact.operation === 'transfer' ? (baseChanged ? 'transferred' : 'no-op')
            : baseChanged ? 'applied' : emissions.length > 0 ? 'applied' : 'no-op'
  return deepFreezeStrictJson({
    operation: input.fact.operation, conditionId: input.fact.conditionId, outcome,
    actorConditions: Object.freeze([...actor].sort()), targetConditions: Object.freeze([...target].sort()),
    preventionProviderIds: Object.freeze(preventionProviderIds), saveProviderIds: Object.freeze(saveProviderIds),
    emissions: Object.freeze(emissions), trace: Object.freeze(trace),
  })
}
