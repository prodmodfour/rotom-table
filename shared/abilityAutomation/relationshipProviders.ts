import { ABILITY_COMBAT_PROVIDER_TYPE_IDS, type AbilityCombatProviderTypeId } from './combatProviders'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_RELATIONSHIP_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_RELATIONSHIP_EFFECT_KINDS = ['scope', 'interception', 'redirection'] as const
export type AbilityRelationshipEffectKind = (typeof ABILITY_RELATIONSHIP_EFFECT_KINDS)[number]
export type AbilityRelationship = 'self' | 'ally' | 'enemy' | 'unknown'
export interface AbilityRelationshipMovePredicate {
  readonly moveTypes: readonly AbilityCombatProviderTypeId[]
  readonly requiredKeywords: readonly string[]
  readonly excludedKeywords: readonly string[]
  readonly areaPolicy: 'any' | 'single-target-only' | 'area-only'
}
export type AbilityRelationshipProviderEffect =
  | {
      readonly kind: 'scope'
      readonly scopeId: string
      readonly geometry: 'all' | 'side' | 'adjacent' | 'aura'
      readonly relations: readonly ('self' | 'ally' | 'enemy' | 'unknown')[]
      readonly minimumRange: number
      readonly maximumRange: number | null
      readonly cardinalOnly: boolean
      readonly requiresLineOfSight: boolean
      readonly tags: readonly string[]
    }
  | {
      readonly kind: 'interception'
      readonly protectedRelations: readonly ('ally' | 'self')[]
      readonly maximumDistanceToProtected: number
      readonly maximumDistanceToActor: number | null
      readonly cardinalOnly: boolean
      readonly requiresLineOfSight: boolean
      readonly predicate: AbilityRelationshipMovePredicate
    }
  | {
      readonly kind: 'redirection'
      readonly mode: 'mandatory' | 'optional'
      readonly maximumDistanceToActor: number
      readonly requiresLineOfSight: boolean
      readonly predicate: AbilityRelationshipMovePredicate
    }
export interface AbilityRelationshipProvider {
  readonly schemaVersion: typeof ABILITY_RELATIONSHIP_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly priority: number
  readonly reasonCode: string
  readonly effect: AbilityRelationshipProviderEffect
}
export interface AbilityRelationshipFact {
  readonly actorPlacementId: string
  readonly targetPlacementIds: readonly string[]
  readonly moveType: AbilityCombatProviderTypeId | null
  readonly keywords: readonly string[]
  readonly area: boolean
}
export interface AbilityScopeProjection {
  readonly providerId: string
  readonly scopeId: string
  readonly sourcePlacementId: string
  readonly placementIds: readonly string[]
  readonly sideIds: readonly string[]
  readonly tags: readonly string[]
}
export interface AbilityInterceptionOffer {
  readonly providerId: string
  readonly responderPlacementId: string
  readonly protectedPlacementId: string
  readonly actorPlacementId: string
  readonly priority: number
}
export interface AbilityRedirectionOffer {
  readonly providerId: string
  readonly responderPlacementId: string
  readonly originalTargetPlacementIds: readonly string[]
  readonly redirectedTargetPlacementIds: readonly string[]
  readonly priority: number
}
export interface AbilityRelationshipTraceEntry {
  readonly providerId: string
  readonly effectKind: AbilityRelationshipEffectKind
  readonly status: 'applied' | 'predicate-false' | 'geometry-false' | 'shadowed'
  readonly placementIds: readonly string[]
  readonly reasonCode: string
}
export interface AbilityRelationshipResolution {
  readonly scopes: readonly AbilityScopeProjection[]
  readonly interceptionOffers: readonly AbilityInterceptionOffer[]
  readonly redirectionOffers: readonly AbilityRedirectionOffer[]
  readonly targetPlacementIds: readonly string[]
  readonly trace: readonly AbilityRelationshipTraceEntry[]
}
export interface AbilityRelationshipPublicView {
  readonly scopes: readonly AbilityScopeProjection[]
  readonly targetPlacementIds: readonly string[]
}
export interface AbilityRelationshipResponderView extends AbilityRelationshipPublicView {
  readonly interceptionOffers: readonly AbilityInterceptionOffer[]
  readonly redirectionOffers: readonly AbilityRedirectionOffer[]
}
/** Default-deny view: offer ownership and provider identity are responder/GM-only. */
export const projectAbilityRelationshipResolution = (input: {
  readonly resolution: AbilityRelationshipResolution
  readonly authorization: 'public' | 'responder' | 'gm'
  readonly responderPlacementId?: string | null
}): AbilityRelationshipPublicView | AbilityRelationshipResponderView => {
  const base = {
    scopes: input.resolution.scopes,
    targetPlacementIds: input.resolution.targetPlacementIds,
  }
  if (input.authorization === 'public') return deepFreezeStrictJson(base)
  const interceptionOffers = input.authorization === 'gm'
    ? input.resolution.interceptionOffers
    : input.resolution.interceptionOffers.filter(offer => offer.responderPlacementId === input.responderPlacementId)
  const redirectionOffers = input.authorization === 'gm'
    ? input.resolution.redirectionOffers
    : input.resolution.redirectionOffers.filter(offer => offer.responderPlacementId === input.responderPlacementId)
  return deepFreezeStrictJson({ ...base, interceptionOffers, redirectionOffers })
}

export const ABILITY_RELATIONSHIP_PROVIDER_LIMITS = Object.freeze({
  providers: 512, list: 128, identifier: 200, priority: 1_000, range: 1_000,
})
export class AbilityRelationshipProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityRelationshipProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = ['schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId', 'priority', 'reasonCode', 'effect'] as const
const EFFECT_FIELDS: Readonly<Record<AbilityRelationshipEffectKind, readonly string[]>> = {
  scope: ['kind', 'scopeId', 'geometry', 'relations', 'minimumRange', 'maximumRange', 'cardinalOnly', 'requiresLineOfSight', 'tags'],
  interception: ['kind', 'protectedRelations', 'maximumDistanceToProtected', 'maximumDistanceToActor', 'cardinalOnly', 'requiresLineOfSight', 'predicate'],
  redirection: ['kind', 'mode', 'maximumDistanceToActor', 'requiresLineOfSight', 'predicate'],
}
const PREDICATE_FIELDS = ['moveTypes', 'requiredKeywords', 'excludedKeywords', 'areaPolicy'] as const
const EFFECT_SET = new Set<string>(ABILITY_RELATIONSHIP_EFFECT_KINDS)
const TYPE_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_TYPE_IDS)
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityRelationshipProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityRelationshipProviderValidationError(code, path, detail)
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
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_RELATIONSHIP_PROVIDER_LIMITS.identifier || !ID.test(value)) fail('invalid-provider', path, 'must be a bounded stable ID.')
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_RELATIONSHIP_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > ABILITY_RELATIONSHIP_PROVIDER_LIMITS.range) fail('invalid-provider', path, 'must be a bounded non-negative integer.')
  return Number(value)
}
const enumValue = <Value extends string>(value: unknown, path: string, set: ReadonlySet<string>): Value => (
  typeof value === 'string' && set.has(value) ? value as Value : fail('invalid-provider', path, 'is unsupported.')
)
const ordered = <Value extends string>(value: unknown, path: string, parser: (value: unknown, path: string) => Value): readonly Value[] => {
  if (!Array.isArray(value) || value.length > ABILITY_RELATIONSHIP_PROVIDER_LIMITS.list) fail('limit-exceeded', path, 'must be bounded.')
  const result = (value as unknown[]).map((entry, index) => parser(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && entry <= result[index - 1]!)) fail('duplicate-id', path, 'must be unique in code-point order.')
  return Object.freeze(result)
}
const parsePredicate = (value: unknown, path: string): AbilityRelationshipMovePredicate => {
  const input = record(value, path)
  exact(input, PREDICATE_FIELDS, path)
  const requiredKeywords = ordered(input.requiredKeywords, `${path}.requiredKeywords`, stableId)
  const excludedKeywords = ordered(input.excludedKeywords, `${path}.excludedKeywords`, stableId)
  if (requiredKeywords.some(tag => excludedKeywords.includes(tag))) fail('invalid-provider', path, 'keyword predicates conflict.')
  return Object.freeze({
    moveTypes: ordered<AbilityCombatProviderTypeId>(input.moveTypes, `${path}.moveTypes`, (entry, entryPath) => enumValue(entry, entryPath, TYPE_SET)),
    requiredKeywords, excludedKeywords,
    areaPolicy: enumValue(input.areaPolicy, `${path}.areaPolicy`, new Set(['any', 'single-target-only', 'area-only'])),
  }) as AbilityRelationshipMovePredicate
}
const parseEffect = (value: unknown, path: string): AbilityRelationshipProviderEffect => {
  const input = record(value, path)
  const kind = enumValue<AbilityRelationshipEffectKind>(input.kind, `${path}.kind`, EFFECT_SET)
  exact(input, EFFECT_FIELDS[kind], path)
  if (kind === 'scope') {
    const minimumRange = integer(input.minimumRange, `${path}.minimumRange`)
    const maximumRange = input.maximumRange === null ? null : integer(input.maximumRange, `${path}.maximumRange`)
    if (maximumRange !== null && minimumRange > maximumRange) fail('invalid-provider', path, 'range bounds are inverted.')
    const geometry = enumValue<'all' | 'side' | 'adjacent' | 'aura'>(input.geometry, `${path}.geometry`, new Set(['all', 'side', 'adjacent', 'aura']))
    if (geometry === 'adjacent' && (minimumRange !== 1 || maximumRange !== 1)) fail('invalid-provider', path, 'adjacency requires exact range 1.')
    return Object.freeze({
      kind, scopeId: stableId(input.scopeId, `${path}.scopeId`), geometry,
      relations: ordered(input.relations, `${path}.relations`, (entry, entryPath) => enumValue(entry, entryPath, new Set(['self', 'ally', 'enemy', 'unknown']))),
      minimumRange, maximumRange,
      cardinalOnly: typeof input.cardinalOnly === 'boolean' ? input.cardinalOnly : fail('invalid-provider', `${path}.cardinalOnly`, 'must be boolean.'),
      requiresLineOfSight: typeof input.requiresLineOfSight === 'boolean' ? input.requiresLineOfSight : fail('invalid-provider', `${path}.requiresLineOfSight`, 'must be boolean.'),
      tags: ordered(input.tags, `${path}.tags`, stableId),
    }) as Extract<AbilityRelationshipProviderEffect, { kind: 'scope' }>
  }
  if (kind === 'interception') return Object.freeze({
    kind,
    protectedRelations: ordered(input.protectedRelations, `${path}.protectedRelations`, (entry, entryPath) => enumValue(entry, entryPath, new Set(['ally', 'self']))),
    maximumDistanceToProtected: integer(input.maximumDistanceToProtected, `${path}.maximumDistanceToProtected`),
    maximumDistanceToActor: input.maximumDistanceToActor === null ? null : integer(input.maximumDistanceToActor, `${path}.maximumDistanceToActor`),
    cardinalOnly: typeof input.cardinalOnly === 'boolean' ? input.cardinalOnly : fail('invalid-provider', `${path}.cardinalOnly`, 'must be boolean.'),
    requiresLineOfSight: typeof input.requiresLineOfSight === 'boolean' ? input.requiresLineOfSight : fail('invalid-provider', `${path}.requiresLineOfSight`, 'must be boolean.'),
    predicate: parsePredicate(input.predicate, `${path}.predicate`),
  }) as Extract<AbilityRelationshipProviderEffect, { kind: 'interception' }>
  return Object.freeze({
    kind,
    mode: enumValue(input.mode, `${path}.mode`, new Set(['mandatory', 'optional'])),
    maximumDistanceToActor: integer(input.maximumDistanceToActor, `${path}.maximumDistanceToActor`),
    requiresLineOfSight: typeof input.requiresLineOfSight === 'boolean' ? input.requiresLineOfSight : fail('invalid-provider', `${path}.requiresLineOfSight`, 'must be boolean.'),
    predicate: parsePredicate(input.predicate, `${path}.predicate`),
  }) as Extract<AbilityRelationshipProviderEffect, { kind: 'redirection' }>
}
export const parseAbilityRelationshipProviders = (value: unknown): readonly AbilityRelationshipProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityRelationshipProviders', {
    limits: { depth: 10, nodes: 65_536, objectFields: 20, arrayEntries: ABILITY_RELATIONSHIP_PROVIDER_LIMITS.providers, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability relationship providers', valueLabel: 'ability relationship provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail), failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_RELATIONSHIP_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityRelationshipProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityRelationshipProvider => {
    const path = `abilityRelationshipProviders[${index}]`
    const input = record(entry, path)
    exact(input, PROVIDER_FIELDS, path)
    if (input.schemaVersion !== 1 || !Number.isSafeInteger(input.priority)
      || Math.abs(Number(input.priority)) > ABILITY_RELATIONSHIP_PROVIDER_LIMITS.priority) fail('invalid-provider', path, 'has invalid version or priority.')
    return Object.freeze({
      schemaVersion: 1, providerId: stableId(input.providerId, `${path}.providerId`),
      abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`), canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      sourcePlacementId: stableId(input.sourcePlacementId, `${path}.sourcePlacementId`), priority: Number(input.priority),
      reasonCode: stableId(input.reasonCode, `${path}.reasonCode`), effect: parseEffect(input.effect, `${path}.effect`),
    })
  })
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length) fail('duplicate-id', 'abilityRelationshipProviders', 'must not repeat provider IDs.')
  providers.sort((left, right) => left.priority - right.priority
    || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
    || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
    || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0))
  return deepFreezeStrictJson(providers)
}
const moveMatches = (predicate: AbilityRelationshipMovePredicate, fact: AbilityRelationshipFact): boolean => (
  (predicate.moveTypes.length === 0 || (fact.moveType !== null && predicate.moveTypes.includes(fact.moveType)))
  && predicate.requiredKeywords.every(tag => fact.keywords.includes(tag))
  && predicate.excludedKeywords.every(tag => !fact.keywords.includes(tag))
  && (predicate.areaPolicy === 'any' || (predicate.areaPolicy === 'area-only') === fact.area)
)
/** Resolve relational scopes and create private interception/redirection offers. */
export const resolveAbilityRelationshipProviders = (input: {
  readonly providers: unknown
  readonly fact: AbilityRelationshipFact
  readonly placementIds: readonly string[]
  readonly sideId: (placementId: string) => string | null
  readonly relation: (leftPlacementId: string, rightPlacementId: string) => AbilityRelationship
  readonly distance: (leftPlacementId: string, rightPlacementId: string) => number | null
  readonly cardinallyAdjacent: (leftPlacementId: string, rightPlacementId: string) => boolean
  readonly lineOfSight: (leftPlacementId: string, rightPlacementId: string) => boolean
}): AbilityRelationshipResolution => {
  const providers = parseAbilityRelationshipProviders(input.providers)
  if (!ID.test(input.fact.actorPlacementId) || input.fact.targetPlacementIds.some(id => !input.placementIds.includes(id))
    || new Set(input.fact.targetPlacementIds).size !== input.fact.targetPlacementIds.length
    || new Set(input.fact.keywords).size !== input.fact.keywords.length) fail('invalid-provider', 'abilityRelationshipFact', 'contains invalid identities.')
  const trace: AbilityRelationshipTraceEntry[] = []
  const scopes: AbilityScopeProjection[] = []
  const interceptionOffers: AbilityInterceptionOffer[] = []
  const optionalRedirections: AbilityRedirectionOffer[] = []
  const mandatoryRedirections: AbilityRedirectionOffer[] = []
  for (const provider of providers) {
    const effect = provider.effect
    if (effect.kind === 'scope') {
      const sourceSideId = input.sideId(provider.sourcePlacementId)
      const placementIds = input.placementIds.filter((placementId) => {
        const relation = input.relation(provider.sourcePlacementId, placementId)
        const distance = input.distance(provider.sourcePlacementId, placementId)
        return effect.relations.includes(relation)
          && distance !== null && distance >= effect.minimumRange
          && (effect.maximumRange === null || distance <= effect.maximumRange)
          && (effect.geometry !== 'side' || (sourceSideId !== null && input.sideId(placementId) === sourceSideId))
          && (effect.geometry !== 'adjacent' || (!effect.cardinalOnly || input.cardinallyAdjacent(provider.sourcePlacementId, placementId)))
          && (!effect.requiresLineOfSight || input.lineOfSight(provider.sourcePlacementId, placementId))
      })
      scopes.push({
        providerId: provider.providerId, scopeId: effect.scopeId,
        sourcePlacementId: provider.sourcePlacementId,
        placementIds: Object.freeze(placementIds),
        sideIds: Object.freeze([...new Set(placementIds.flatMap(id => input.sideId(id) ?? []))].sort()),
        tags: effect.tags,
      })
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: placementIds.length > 0 ? 'applied' : 'geometry-false', placementIds, reasonCode: provider.reasonCode })
      continue
    }
    if (!moveMatches(effect.predicate, input.fact)) {
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: 'predicate-false', placementIds: [], reasonCode: provider.reasonCode })
      continue
    }
    if (effect.kind === 'interception') {
      for (const targetId of input.fact.targetPlacementIds) {
        const relation = input.relation(provider.sourcePlacementId, targetId)
        const targetDistance = input.distance(provider.sourcePlacementId, targetId)
        const actorDistance = input.distance(provider.sourcePlacementId, input.fact.actorPlacementId)
        const eligible = effect.protectedRelations.includes(relation as 'ally' | 'self')
          && targetDistance !== null && targetDistance <= effect.maximumDistanceToProtected
          && (effect.maximumDistanceToActor === null || (actorDistance !== null && actorDistance <= effect.maximumDistanceToActor))
          && (!effect.cardinalOnly || input.cardinallyAdjacent(provider.sourcePlacementId, targetId))
          && (!effect.requiresLineOfSight || input.lineOfSight(provider.sourcePlacementId, input.fact.actorPlacementId))
        if (eligible) interceptionOffers.push({
          providerId: provider.providerId, responderPlacementId: provider.sourcePlacementId,
          protectedPlacementId: targetId, actorPlacementId: input.fact.actorPlacementId,
          priority: provider.priority,
        })
      }
      const touched = interceptionOffers.filter(offer => offer.providerId === provider.providerId).map(offer => offer.protectedPlacementId)
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: touched.length > 0 ? 'applied' : 'geometry-false', placementIds: touched, reasonCode: provider.reasonCode })
      continue
    }
    const actorDistance = input.distance(provider.sourcePlacementId, input.fact.actorPlacementId)
    const eligible = input.fact.targetPlacementIds.length === 1
      && provider.sourcePlacementId !== input.fact.actorPlacementId
      && provider.sourcePlacementId !== input.fact.targetPlacementIds[0]
      && actorDistance !== null && actorDistance <= effect.maximumDistanceToActor
      && (!effect.requiresLineOfSight || input.lineOfSight(input.fact.actorPlacementId, provider.sourcePlacementId))
    if (!eligible) {
      trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: 'geometry-false', placementIds: [], reasonCode: provider.reasonCode })
      continue
    }
    const offer = {
      providerId: provider.providerId, responderPlacementId: provider.sourcePlacementId,
      originalTargetPlacementIds: input.fact.targetPlacementIds,
      redirectedTargetPlacementIds: [provider.sourcePlacementId], priority: provider.priority,
    }
    ;(effect.mode === 'mandatory' ? mandatoryRedirections : optionalRedirections).push(offer)
    trace.push({ providerId: provider.providerId, effectKind: effect.kind, status: 'applied', placementIds: [provider.sourcePlacementId], reasonCode: provider.reasonCode })
  }
  mandatoryRedirections.sort((left, right) => left.priority - right.priority || (left.providerId < right.providerId ? -1 : 1))
  const selectedMandatory = mandatoryRedirections.at(-1) ?? null
  mandatoryRedirections.slice(0, -1).forEach(offer => trace.push({
    providerId: offer.providerId, effectKind: 'redirection', status: 'shadowed', placementIds: offer.redirectedTargetPlacementIds,
    reasonCode: providers.find(provider => provider.providerId === offer.providerId)!.reasonCode,
  }))
  const redirectionOffers = [...optionalRedirections, ...(selectedMandatory ? [selectedMandatory] : [])]
  interceptionOffers.sort((left, right) => left.priority - right.priority
    || (left.responderPlacementId < right.responderPlacementId ? -1 : 1)
    || (left.protectedPlacementId < right.protectedPlacementId ? -1 : 1))
  redirectionOffers.sort((left, right) => left.priority - right.priority || (left.providerId < right.providerId ? -1 : 1))
  return deepFreezeStrictJson({
    scopes: Object.freeze(scopes), interceptionOffers: Object.freeze(interceptionOffers),
    redirectionOffers: Object.freeze(redirectionOffers),
    targetPlacementIds: Object.freeze(selectedMandatory?.redirectedTargetPlacementIds ?? input.fact.targetPlacementIds),
    trace: Object.freeze(trace),
  })
}
