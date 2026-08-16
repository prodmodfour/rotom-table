import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ITEM_EVOLUTION_SCHEMA_VERSION = 1 as const

export interface ItemEvolutionAbilityMappingV1 {
  readonly rowIndex: number
  readonly tier: 'basic' | 'advanced' | 'high'
  readonly slotIndex: number
  readonly fromAbilityId: string
  readonly toAbilityId: string
}

export interface ItemEvolutionApplicationV1 {
  readonly sourceOperationId: string
  readonly sourceInstanceId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly ruleRecordSha256: string
  readonly pokedexCatalogSha256: string
  readonly fromSpeciesId: string
  readonly fromSpeciesRecordSha256: string
  readonly toSpeciesId: string
  readonly toSpeciesRecordSha256: string
  readonly minimumLevel: number
  readonly requiredGender: 'Male' | 'Female' | null
  readonly targetRevisionBefore: number
  readonly requiredStatPoints: number
  readonly moveOpportunityIds: readonly string[]
  readonly abilityMappings: readonly ItemEvolutionAbilityMappingV1[]
  readonly inactiveEquipmentItemIds: readonly string[]
  readonly appliedAt: number
}

export interface ItemEvolutionStatResolutionV1 {
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly allocatedStatPoints: number
  readonly resolvedAt: number
}

export interface ItemEvolutionStateV1 {
  readonly schemaVersion: typeof ITEM_EVOLUTION_SCHEMA_VERSION
  readonly applications: readonly ItemEvolutionApplicationV1[]
  readonly statResolutions: readonly ItemEvolutionStatResolutionV1[]
}

export interface ItemEvolutionAttentionProjectionV1 {
  readonly schemaVersion: typeof ITEM_EVOLUTION_SCHEMA_VERSION
  readonly fromSpecies: string
  readonly toSpecies: string
  readonly canonicalItemName: string
  readonly appliedAt: number
  readonly statAllocation: {
    readonly status: 'open' | 'resolved'
    readonly required: number
    readonly allocated: number
  }
  readonly moveOpportunities: readonly string[]
  readonly abilityChanges: readonly { readonly from: string, readonly to: string }[]
  readonly inactiveEquipmentItems: readonly string[]
}

export class ItemEvolutionStateValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ItemEvolutionStateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const APPLICATION_FIELDS = [
  'sourceOperationId', 'sourceInstanceId', 'canonicalItemId', 'canonicalDefinitionSha256',
  'ruleRecordSha256', 'pokedexCatalogSha256', 'fromSpeciesId', 'fromSpeciesRecordSha256',
  'toSpeciesId', 'toSpeciesRecordSha256', 'minimumLevel', 'requiredGender',
  'targetRevisionBefore', 'requiredStatPoints', 'moveOpportunityIds', 'abilityMappings',
  'inactiveEquipmentItemIds', 'appliedAt',
] as const
const ABILITY_MAPPING_FIELDS = [
  'rowIndex', 'tier', 'slotIndex', 'fromAbilityId', 'toAbilityId',
] as const
const RESOLUTION_FIELDS = [
  'sourceOperationId', 'resolutionId', 'allocatedStatPoints', 'resolvedAt',
] as const

const fail = (path: string, message: string): never => {
  throw new ItemEvolutionStateValidationError(path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail(path, 'must be a plain object.')
  return value
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail(path, 'has an invalid shape.')
}
const text = (value: unknown, path: string, maximum = 500): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) {
    return fail(path, 'must be bounded non-empty safe text.')
  }
  return value
}
const sha256 = (value: unknown, path: string): string => {
  const parsed = text(value, path, 64)
  return SHA256_PATTERN.test(parsed) ? parsed : fail(path, 'must be a lowercase SHA-256 digest.')
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail(path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const stringArray = (value: unknown, path: string, maximum: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) return fail(path, 'must be a bounded array.')
  const result = value.map((entry, index) => text(entry, `${path}[${index}]`, 200))
  if (new Set(result).size !== result.length) fail(path, 'must contain unique identities.')
  return result
}

const parseAbilityMapping = (value: unknown, index: number): ItemEvolutionAbilityMappingV1 => {
  const path = `itemEvolution.applications[].abilityMappings[${index}]`
  const input = record(value, path)
  exact(input, ABILITY_MAPPING_FIELDS, path)
  const tier = text(input.tier, `${path}.tier`, 8)
  if (tier !== 'basic' && tier !== 'advanced' && tier !== 'high') fail(`${path}.tier`, 'must be a canonical Ability tier.')
  return {
    rowIndex: integer(input.rowIndex, `${path}.rowIndex`, 0, 63),
    tier: tier as ItemEvolutionAbilityMappingV1['tier'],
    slotIndex: integer(input.slotIndex, `${path}.slotIndex`, 0, 7),
    fromAbilityId: text(input.fromAbilityId, `${path}.fromAbilityId`, 200),
    toAbilityId: text(input.toAbilityId, `${path}.toAbilityId`, 200),
  }
}

const parseApplication = (value: unknown, index: number): ItemEvolutionApplicationV1 => {
  const path = `itemEvolution.applications[${index}]`
  const input = record(value, path)
  exact(input, APPLICATION_FIELDS, path)
  const fromSpeciesId = text(input.fromSpeciesId, `${path}.fromSpeciesId`, 200)
  const toSpeciesId = text(input.toSpeciesId, `${path}.toSpeciesId`, 200)
  if (fromSpeciesId === toSpeciesId) fail(path, 'must change species.')
  const requiredGender = input.requiredGender === null
    ? null
    : text(input.requiredGender, `${path}.requiredGender`, 6)
  if (requiredGender !== null && requiredGender !== 'Male' && requiredGender !== 'Female') {
    fail(`${path}.requiredGender`, 'must be Male, Female, or null.')
  }
  const rawAbilityMappings = input.abilityMappings
  if (!Array.isArray(rawAbilityMappings)) fail(`${path}.abilityMappings`, 'must be a bounded array.')
  const abilityMappingRows = rawAbilityMappings as unknown[]
  if (abilityMappingRows.length > 64) fail(`${path}.abilityMappings`, 'must be a bounded array.')
  const abilityMappings = abilityMappingRows.map(parseAbilityMapping)
  if (new Set(abilityMappings.map(mapping => mapping.rowIndex)).size !== abilityMappings.length) {
    fail(`${path}.abilityMappings`, 'must map each current Ability row at most once.')
  }
  return {
    sourceOperationId: text(input.sourceOperationId, `${path}.sourceOperationId`, 200),
    sourceInstanceId: text(input.sourceInstanceId, `${path}.sourceInstanceId`, 1_024),
    canonicalItemId: text(input.canonicalItemId, `${path}.canonicalItemId`, 200),
    canonicalDefinitionSha256: sha256(input.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
    ruleRecordSha256: sha256(input.ruleRecordSha256, `${path}.ruleRecordSha256`),
    pokedexCatalogSha256: sha256(input.pokedexCatalogSha256, `${path}.pokedexCatalogSha256`),
    fromSpeciesId,
    fromSpeciesRecordSha256: sha256(input.fromSpeciesRecordSha256, `${path}.fromSpeciesRecordSha256`),
    toSpeciesId,
    toSpeciesRecordSha256: sha256(input.toSpeciesRecordSha256, `${path}.toSpeciesRecordSha256`),
    minimumLevel: integer(input.minimumLevel, `${path}.minimumLevel`, 0, 100),
    requiredGender: requiredGender as 'Male' | 'Female' | null,
    targetRevisionBefore: integer(input.targetRevisionBefore, `${path}.targetRevisionBefore`),
    requiredStatPoints: integer(input.requiredStatPoints, `${path}.requiredStatPoints`, 0, 110),
    moveOpportunityIds: stringArray(input.moveOpportunityIds, `${path}.moveOpportunityIds`, 64),
    abilityMappings,
    inactiveEquipmentItemIds: stringArray(input.inactiveEquipmentItemIds, `${path}.inactiveEquipmentItemIds`, 64),
    appliedAt: integer(input.appliedAt, `${path}.appliedAt`),
  }
}

const parseResolution = (value: unknown, index: number): ItemEvolutionStatResolutionV1 => {
  const path = `itemEvolution.statResolutions[${index}]`
  const input = record(value, path)
  exact(input, RESOLUTION_FIELDS, path)
  return {
    sourceOperationId: text(input.sourceOperationId, `${path}.sourceOperationId`, 200),
    resolutionId: text(input.resolutionId, `${path}.resolutionId`, 300),
    allocatedStatPoints: integer(input.allocatedStatPoints, `${path}.allocatedStatPoints`, 0, 110),
    resolvedAt: integer(input.resolvedAt, `${path}.resolvedAt`),
  }
}

const cloneState = (value: unknown): unknown => cloneStrictJson(value, 'itemEvolution', {
  limits: { depth: 9, nodes: 16_384, objectFields: 32, arrayEntries: 512, stringLength: 1_024, objectKeyLength: 100 },
  rootLabel: 'itemEvolution',
  valueLabel: 'itemEvolution',
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

export const emptyItemEvolutionState = (): ItemEvolutionStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_EVOLUTION_SCHEMA_VERSION,
  applications: [],
  statResolutions: [],
})

export const parseItemEvolutionState = (value: unknown): ItemEvolutionStateV1 => {
  if (value === undefined) return emptyItemEvolutionState()
  const root = record(cloneState(value), 'itemEvolution')
  exact(root, ['schemaVersion', 'applications', 'statResolutions'], 'itemEvolution')
  const rawApplications = root.applications
  const rawStatResolutions = root.statResolutions
  if (root.schemaVersion !== ITEM_EVOLUTION_SCHEMA_VERSION
    || !Array.isArray(rawApplications) || !Array.isArray(rawStatResolutions)) {
    fail('itemEvolution', 'uses an unsupported schema or entry count.')
  }
  const applicationRows = rawApplications as unknown[]
  const resolutionRows = rawStatResolutions as unknown[]
  if (applicationRows.length > 256 || resolutionRows.length > 256) {
    fail('itemEvolution', 'uses an unsupported schema or entry count.')
  }
  const applications = applicationRows.map(parseApplication)
  const statResolutions = resolutionRows.map(parseResolution)
  if (new Set(applications.map(row => row.sourceOperationId)).size !== applications.length
    || new Set(statResolutions.map(row => row.sourceOperationId)).size !== statResolutions.length
    || new Set(statResolutions.map(row => row.resolutionId)).size !== statResolutions.length) {
    fail('itemEvolution', 'must have unique application and resolution identities.')
  }
  const byOperation = new Map(applications.map(row => [row.sourceOperationId, row]))
  for (const resolution of statResolutions) {
    const application = byOperation.get(resolution.sourceOperationId)
    if (!application || resolution.allocatedStatPoints !== application.requiredStatPoints
      || resolution.resolvedAt < application.appliedAt) {
      fail('itemEvolution.statResolutions', 'must resolve one existing application with its exact Stat Point budget.')
    }
  }
  return deepFreezeStrictJson({ schemaVersion: ITEM_EVOLUTION_SCHEMA_VERSION, applications, statResolutions })
}

export const appendItemEvolutionApplication = (input: {
  readonly current: unknown
  readonly application: ItemEvolutionApplicationV1
}): ItemEvolutionStateV1 => {
  const current = parseItemEvolutionState(input.current)
  const application = parseApplication(input.application, current.applications.length)
  if (current.applications.some(row => row.sourceOperationId === application.sourceOperationId)) {
    fail('itemEvolution.applications', 'already contains this source operation identity.')
  }
  return parseItemEvolutionState({
    schemaVersion: ITEM_EVOLUTION_SCHEMA_VERSION,
    applications: [...current.applications, application],
    statResolutions: current.statResolutions,
  })
}

export const resolveItemEvolutionStatAttention = (input: {
  readonly current: unknown
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly allocatedStatPoints: number
  readonly resolvedAt: number
}): ItemEvolutionStateV1 => {
  const current = parseItemEvolutionState(input.current)
  if (current.statResolutions.some(row => row.sourceOperationId === input.sourceOperationId)) {
    fail('itemEvolution.statResolutions', 'already resolves this evolution application.')
  }
  return parseItemEvolutionState({
    schemaVersion: ITEM_EVOLUTION_SCHEMA_VERSION,
    applications: current.applications,
    statResolutions: [...current.statResolutions, {
      sourceOperationId: input.sourceOperationId,
      resolutionId: input.resolutionId,
      allocatedStatPoints: input.allocatedStatPoints,
      resolvedAt: input.resolvedAt,
    }],
  })
}

export const latestItemEvolutionApplication = (value: unknown): ItemEvolutionApplicationV1 | null => {
  const state = parseItemEvolutionState(value)
  return state.applications.at(-1) ?? null
}

export const itemEvolutionAttentionProjection = (value: unknown): ItemEvolutionAttentionProjectionV1 | null => {
  const state = parseItemEvolutionState(value)
  const application = state.applications.at(-1)
  if (!application) return null
  const resolution = state.statResolutions.find(row => row.sourceOperationId === application.sourceOperationId)
  return deepFreezeStrictJson({
    schemaVersion: ITEM_EVOLUTION_SCHEMA_VERSION,
    fromSpecies: application.fromSpeciesId,
    toSpecies: application.toSpeciesId,
    canonicalItemName: application.canonicalItemId,
    appliedAt: application.appliedAt,
    statAllocation: {
      status: resolution ? 'resolved' : 'open',
      required: application.requiredStatPoints,
      allocated: resolution?.allocatedStatPoints ?? 0,
    },
    moveOpportunities: application.moveOpportunityIds,
    abilityChanges: application.abilityMappings.map(row => ({ from: row.fromAbilityId, to: row.toAbilityId })),
    inactiveEquipmentItems: application.inactiveEquipmentItemIds,
  })
}
