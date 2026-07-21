import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_PASSIVE_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_PASSIVE_PROVIDER_DOMAINS = [
  'stat',
  'damage',
  'accuracy',
  'evasion',
  'immunity',
  'movement',
  'side',
  'field',
] as const
export const ABILITY_PASSIVE_PROVIDER_ATTRIBUTES = [
  'stat.attack', 'stat.special-attack', 'stat.defense', 'stat.special-defense', 'stat.speed', 'stat.hp',
  'stat.combat-stage.attack', 'stat.combat-stage.special-attack',
  'stat.combat-stage.defense', 'stat.combat-stage.special-defense',
  'stat.combat-stage.speed', 'stat.combat-stage.accuracy', 'stat.initiative',
  'damage.outgoing', 'damage.incoming', 'damage.reduction', 'damage.resistance',
  'accuracy.attack', 'accuracy.effect',
  'evasion.physical', 'evasion.special', 'evasion.speed',
  'immunity.move', 'immunity.type', 'immunity.keyword', 'immunity.condition', 'immunity.damage',
  'movement.overland', 'movement.swim', 'movement.sky', 'movement.levitate', 'movement.burrow',
  'movement.teleport', 'movement.phasing', 'movement.terrain-cost',
  'side.condition', 'side.damage', 'side.accuracy', 'side.evasion', 'side.immunity',
  'field.weather', 'field.terrain', 'field.room', 'field.hazard', 'field.modifier',
] as const
export const ABILITY_PASSIVE_STACKING_GROUPS = [
  'stat.base', 'stat.derived', 'stat.combat-stage',
  'damage.outgoing', 'damage.incoming', 'damage.reduction',
  'accuracy.roll', 'evasion.value',
  'immunity.absolute', 'immunity.conditional',
  'movement.speed', 'movement.capability',
  'side.condition', 'side.modifier',
  'field.condition', 'field.modifier',
] as const
export const ABILITY_PASSIVE_PROVIDER_OPERATIONS = [
  'add', 'multiply', 'set', 'minimum', 'maximum', 'grant', 'deny',
] as const
export const ABILITY_PASSIVE_STACKING_POLICIES = [
  'stack', 'highest', 'lowest', 'priority', 'union', 'exclusive',
] as const

export type AbilityPassiveProviderDomain = (typeof ABILITY_PASSIVE_PROVIDER_DOMAINS)[number]
export type AbilityPassiveProviderAttribute = (typeof ABILITY_PASSIVE_PROVIDER_ATTRIBUTES)[number]
export type AbilityPassiveStackingGroup = (typeof ABILITY_PASSIVE_STACKING_GROUPS)[number]
export type AbilityPassiveProviderOperation = (typeof ABILITY_PASSIVE_PROVIDER_OPERATIONS)[number]
export type AbilityPassiveStackingPolicy = (typeof ABILITY_PASSIVE_STACKING_POLICIES)[number]
export type AbilityPassiveProviderValue = number | string | boolean | readonly string[]

export interface AbilityPassiveProvider {
  readonly schemaVersion: typeof ABILITY_PASSIVE_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly scopeKey: string
  readonly domain: AbilityPassiveProviderDomain
  readonly attribute: AbilityPassiveProviderAttribute
  readonly operation: AbilityPassiveProviderOperation
  readonly value: AbilityPassiveProviderValue
  readonly priority: number
  readonly stackingGroup: AbilityPassiveStackingGroup
  readonly stackingPolicy: AbilityPassiveStackingPolicy
  readonly reasonCode: string
}

export interface ResolvedAbilityPassiveProviderGroup {
  readonly key: string
  readonly domain: AbilityPassiveProviderDomain
  readonly attribute: AbilityPassiveProviderAttribute
  readonly scopeKey: string
  readonly stackingGroup: AbilityPassiveStackingGroup
  readonly stackingPolicy: AbilityPassiveStackingPolicy
  readonly providers: readonly AbilityPassiveProvider[]
  readonly unionValues: readonly string[] | null
}

export const ABILITY_PASSIVE_PROVIDER_LIMITS = Object.freeze({
  providers: 1_024,
  groups: 256,
  valuesPerUnion: 256,
  textLength: 200,
  priorityMagnitude: 1_000,
  numericMagnitude: 1_000_000,
})

export type AbilityPassiveProviderValidationCode =
  | 'invalid-provider'
  | 'duplicate-provider-id'
  | 'stacking-policy-conflict'
  | 'exclusive-provider-conflict'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityPassiveProviderValidationError extends Error {
  readonly code: AbilityPassiveProviderValidationCode
  readonly path: string

  constructor(code: AbilityPassiveProviderValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityPassiveProviderValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'scopeKey', 'domain', 'attribute', 'operation', 'value', 'priority', 'stackingGroup',
  'stackingPolicy', 'reasonCode',
] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const DOMAIN_SET = new Set<string>(ABILITY_PASSIVE_PROVIDER_DOMAINS)
const ATTRIBUTE_SET = new Set<string>(ABILITY_PASSIVE_PROVIDER_ATTRIBUTES)
const GROUP_SET = new Set<string>(ABILITY_PASSIVE_STACKING_GROUPS)
const OPERATION_SET = new Set<string>(ABILITY_PASSIVE_PROVIDER_OPERATIONS)
const POLICY_SET = new Set<string>(ABILITY_PASSIVE_STACKING_POLICIES)
const GROUP_ORDER = new Map(ABILITY_PASSIVE_STACKING_GROUPS.map((group, index) => [group, index]))

const fail = (
  code: AbilityPassiveProviderValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityPassiveProviderValidationError(code, path, detail)
}

const clone = (value: unknown) => cloneStrictJson(value, 'passiveProviders', {
  limits: {
    depth: 5,
    nodes: 16_384,
    objectFields: 20,
    arrayEntries: ABILITY_PASSIVE_PROVIDER_LIMITS.providers,
    stringLength: ABILITY_PASSIVE_PROVIDER_LIMITS.textLength,
    objectKeyLength: ABILITY_PASSIVE_PROVIDER_LIMITS.textLength,
  },
  rootLabel: 'ability passive providers',
  valueLabel: 'ability passive providers',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-provider', path, 'must be an object.')
  return value
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_PASSIVE_PROVIDER_LIMITS.textLength
    || !STABLE_ID_PATTERN.test(value)
  ) return fail('invalid-provider', path, 'must be a bounded stable identifier.')
  return value
}

const text = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_PASSIVE_PROVIDER_LIMITS.textLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-provider', path, 'must be bounded trimmed text.')
  return value
}

const parseValue = (
  value: unknown,
  operation: AbilityPassiveProviderOperation,
  path: string,
): AbilityPassiveProviderValue => {
  if (['add', 'multiply', 'set', 'minimum', 'maximum'].includes(operation)) {
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || Math.abs(value) > ABILITY_PASSIVE_PROVIDER_LIMITS.numericMagnitude
    ) return fail('invalid-provider', path, 'must be a bounded finite number for a numeric operation.')
    return value
  }
  if (typeof value === 'string') return text(value, path)
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (value.length > ABILITY_PASSIVE_PROVIDER_LIMITS.valuesPerUnion) {
      fail('limit-exceeded', path, 'contains too many values.')
    }
    const values = value.map((entry, index) => text(entry, `${path}[${index}]`))
    if (new Set(values).size !== values.length) {
      fail('invalid-provider', path, 'must not repeat values.')
    }
    return Object.freeze(values)
  }
  return fail('invalid-provider', path, 'must be a string, boolean, or string list for grant/deny.')
}

const parseProvider = (value: unknown, index: number): AbilityPassiveProvider => {
  const path = `passiveProviders[${index}]`
  const input = record(value, path)
  const expected = new Set<string>(PROVIDER_FIELDS)
  if (
    PROVIDER_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
  ) fail('invalid-provider', path, 'has an invalid shape.')
  if (input.schemaVersion !== ABILITY_PASSIVE_PROVIDER_SCHEMA_VERSION) {
    fail('invalid-provider', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (typeof input.domain !== 'string' || !DOMAIN_SET.has(input.domain)) {
    fail('invalid-provider', `${path}.domain`, 'is unsupported.')
  }
  if (typeof input.attribute !== 'string' || !ATTRIBUTE_SET.has(input.attribute)) {
    fail('invalid-provider', `${path}.attribute`, 'is unsupported.')
  }
  if (typeof input.stackingGroup !== 'string' || !GROUP_SET.has(input.stackingGroup)) {
    fail('invalid-provider', `${path}.stackingGroup`, 'is unsupported.')
  }
  const domain = input.domain as AbilityPassiveProviderDomain
  const attribute = input.attribute as AbilityPassiveProviderAttribute
  const stackingGroup = input.stackingGroup as AbilityPassiveStackingGroup
  if (!attribute.startsWith(`${domain}.`) || !stackingGroup.startsWith(`${domain}.`)) {
    fail('invalid-provider', path, 'attribute and stacking group must belong to the provider domain.')
  }
  if (typeof input.operation !== 'string' || !OPERATION_SET.has(input.operation)) {
    fail('invalid-provider', `${path}.operation`, 'is unsupported.')
  }
  if (typeof input.stackingPolicy !== 'string' || !POLICY_SET.has(input.stackingPolicy)) {
    fail('invalid-provider', `${path}.stackingPolicy`, 'is unsupported.')
  }
  const operation = input.operation as AbilityPassiveProviderOperation
  const stackingPolicy = input.stackingPolicy as AbilityPassiveStackingPolicy
  const numericOperation = ['add', 'multiply', 'set', 'minimum', 'maximum'].includes(operation)
  if (
    (stackingPolicy === 'stack' && !numericOperation)
    || ((stackingPolicy === 'highest' || stackingPolicy === 'lowest') && !numericOperation)
    || (stackingPolicy === 'union' && operation !== 'grant' && operation !== 'deny')
  ) fail('invalid-provider', path, 'operation is incompatible with its stacking policy.')
  if (
    !Number.isSafeInteger(input.priority)
    || Math.abs(Number(input.priority)) > ABILITY_PASSIVE_PROVIDER_LIMITS.priorityMagnitude
  ) fail('invalid-provider', `${path}.priority`, 'must be a bounded integer.')
  const parsedValue = parseValue(input.value, operation, `${path}.value`)
  if (
    stackingPolicy === 'union'
    && typeof parsedValue !== 'string'
    && !Array.isArray(parsedValue)
  ) fail('invalid-provider', `${path}.value`, 'union policy requires string values.')
  return Object.freeze({
    schemaVersion: ABILITY_PASSIVE_PROVIDER_SCHEMA_VERSION,
    providerId: stableId(input.providerId, `${path}.providerId`),
    abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
    canonicalId: text(input.canonicalId, `${path}.canonicalId`),
    sourcePlacementId: text(input.sourcePlacementId, `${path}.sourcePlacementId`),
    scopeKey: stableId(input.scopeKey, `${path}.scopeKey`),
    domain,
    attribute,
    operation,
    value: parsedValue,
    priority: Number(input.priority),
    stackingGroup,
    stackingPolicy,
    reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
  })
}

export const parseAbilityPassiveProviders = (
  value: unknown,
): readonly AbilityPassiveProvider[] => {
  const cloned = clone(value)
  if (!Array.isArray(cloned) || cloned.length > ABILITY_PASSIVE_PROVIDER_LIMITS.providers) {
    return fail('limit-exceeded', 'passiveProviders', 'must be a bounded array.')
  }
  const providers = cloned.map(parseProvider)
  if (new Set(providers.map(provider => provider.providerId)).size !== providers.length) {
    fail('duplicate-provider-id', 'passiveProviders', 'must not repeat provider IDs.')
  }
  return deepFreezeStrictJson(providers)
}

const compareText = (left: string, right: string): number => (
  left === right ? 0 : left < right ? -1 : 1
)

const compareProviders = (left: AbilityPassiveProvider, right: AbilityPassiveProvider): number => (
  left.priority - right.priority
  || compareText(left.canonicalId, right.canonicalId)
  || compareText(left.abilityInstanceId, right.abilityInstanceId)
  || compareText(left.providerId, right.providerId)
)

const groupKey = (provider: AbilityPassiveProvider): string => (
  `${provider.scopeKey}|${provider.domain}|${provider.attribute}|${provider.stackingGroup}`
)

const valuesForUnion = (providers: readonly AbilityPassiveProvider[]): readonly string[] => {
  const values = new Set<string>()
  for (const provider of providers) {
    if (typeof provider.value === 'string') values.add(provider.value)
    else if (Array.isArray(provider.value)) provider.value.forEach(value => values.add(value))
    else values.add(String(provider.value))
  }
  return Object.freeze([...values].sort(compareText))
}

export const aggregateAbilityPassiveProviders = (
  value: unknown,
): readonly ResolvedAbilityPassiveProviderGroup[] => {
  const providers = [...parseAbilityPassiveProviders(value)].sort(compareProviders)
  const grouped = new Map<string, AbilityPassiveProvider[]>()
  for (const provider of providers) {
    const key = groupKey(provider)
    const group = grouped.get(key) ?? []
    group.push(provider)
    grouped.set(key, group)
  }
  if (grouped.size > ABILITY_PASSIVE_PROVIDER_LIMITS.groups) {
    fail('limit-exceeded', 'passiveProviders', 'creates too many stacking groups.')
  }
  const result = [...grouped.entries()].map(([key, candidates]): ResolvedAbilityPassiveProviderGroup => {
    const first = candidates[0]!
    if (candidates.some(candidate => candidate.stackingPolicy !== first.stackingPolicy)) {
      fail('stacking-policy-conflict', key, 'providers in one group must agree on policy.')
    }
    let selected: readonly AbilityPassiveProvider[]
    if (first.stackingPolicy === 'highest' || first.stackingPolicy === 'lowest') {
      const ordered = [...candidates].sort((left, right) => (
        (left.value as number) - (right.value as number) || compareProviders(left, right)
      ))
      selected = [first.stackingPolicy === 'highest' ? ordered.at(-1)! : ordered[0]!]
    }
    else if (first.stackingPolicy === 'priority') selected = [candidates.at(-1)!]
    else if (first.stackingPolicy === 'exclusive') {
      if (candidates.length !== 1) {
        fail('exclusive-provider-conflict', key, 'exclusive group has more than one provider.')
      }
      selected = candidates
    }
    else selected = candidates
    return Object.freeze({
      key,
      domain: first.domain,
      attribute: first.attribute,
      scopeKey: first.scopeKey,
      stackingGroup: first.stackingGroup,
      stackingPolicy: first.stackingPolicy,
      providers: Object.freeze([...selected]),
      unionValues: first.stackingPolicy === 'union' ? valuesForUnion(selected) : null,
    })
  })
  result.sort((left, right) => (
    compareText(left.scopeKey, right.scopeKey)
    || GROUP_ORDER.get(left.stackingGroup)! - GROUP_ORDER.get(right.stackingGroup)!
    || compareText(left.attribute, right.attribute)
  ))
  return Object.freeze(result)
}

/** Apply a resolved numeric group in its stable provider order. */
export const applyNumericAbilityPassiveProviderGroup = (
  base: number,
  group: ResolvedAbilityPassiveProviderGroup,
): number => {
  if (!Number.isFinite(base)) fail('invalid-provider', group.key, 'numeric base must be finite.')
  let value = base
  for (const provider of group.providers) {
    if (typeof provider.value !== 'number') {
      return fail('invalid-provider', group.key, 'contains a non-numeric provider.')
    }
    if (provider.operation === 'add') value += provider.value
    else if (provider.operation === 'multiply') value *= provider.value
    else if (provider.operation === 'set') value = provider.value
    else if (provider.operation === 'minimum') value = Math.max(value, provider.value)
    else if (provider.operation === 'maximum') value = Math.min(value, provider.value)
    else return fail('invalid-provider', group.key, 'contains a non-numeric operation.')
    if (!Number.isFinite(value) || Math.abs(value) > ABILITY_PASSIVE_PROVIDER_LIMITS.numericMagnitude) {
      fail('limit-exceeded', group.key, 'numeric aggregation exceeded its bound.')
    }
  }
  return Object.is(value, -0) ? 0 : value
}
