import { isSlug } from '../paths'
import { parseBreedingMoveIdSyntax, parseBreedingSpeciesIdSyntax } from './ids'
import {
  parseBreedingDependencyEvidenceV1,
  type BreedingDependencyCheckpoint,
  type BreedingDependencyEvidenceV1,
} from './readSets'

export const BREEDING_FEATURE_PROVIDER_HANDOFF_SCHEMA_VERSION = 1 as const
export const BREEDING_FEATURE_PROVIDER_CHECKPOINTS = Object.freeze([
  'project-creation',
  'egg-acceptance',
  'begin-hatch',
  'hatch-transaction',
  'post-hatch-operation',
] as const)
export type BreedingFeatureProviderCheckpoint = typeof BREEDING_FEATURE_PROVIDER_CHECKPOINTS[number]
export const BREEDING_FEATURE_PROVIDER_DISPOSITIONS = Object.freeze([
  'active-upstream-effective-provider',
  'active-provider-evidence',
  'reserved-br-062',
  'reserved-br-065',
  'reserved-br-068',
] as const)
export type BreedingFeatureProviderDisposition = typeof BREEDING_FEATURE_PROVIDER_DISPOSITIONS[number]

export const BREEDING_FEATURE_PROVIDER_POLICIES = Object.freeze([
  Object.freeze({ canonicalId: 'Ancient Heritage', checkpoint: 'post-hatch-operation', readSetCheckpoint: 'inheritance-learning', contributionIds: Object.freeze(['fossil-ancient-power-learning']), disposition: 'reserved-br-068' }),
  Object.freeze({ canonicalId: 'Dilettante', checkpoint: 'project-creation', readSetCheckpoint: 'project-creation', contributionIds: Object.freeze(['effective-breeder-edge-grant']), disposition: 'active-upstream-effective-provider' }),
  Object.freeze({ canonicalId: 'Egg Tutor', checkpoint: 'post-hatch-operation', readSetCheckpoint: 'inheritance-learning', contributionIds: Object.freeze(['egg-list-move-learning']), disposition: 'reserved-br-068' }),
  Object.freeze({ canonicalId: 'Fossil Restoration', checkpoint: 'hatch-transaction', readSetCheckpoint: 'hatch-transaction', contributionIds: Object.freeze(['fossil-tutor-point-delta-minus-2', 'fossil-extra-basic-or-advanced-ability']), disposition: 'reserved-br-065' }),
  Object.freeze({ canonicalId: 'Genetic Memory', checkpoint: 'post-hatch-operation', readSetCheckpoint: 'inheritance-learning', contributionIds: Object.freeze(['fossil-egg-or-tutor-move-learning']), disposition: 'reserved-br-068' }),
  Object.freeze({ canonicalId: 'Playing God', checkpoint: 'egg-acceptance', readSetCheckpoint: 'egg-acceptance', contributionIds: Object.freeze(['artificial-egg-source', 'artificial-species-options', 'hatch-within-one-day', 'starting-level-5', 'nature-choice', 'basic-ability-choice', 'bounded-artificial-upgrades']), disposition: 'active-provider-evidence' }),
  Object.freeze({ canonicalId: 'Prehistoric Bond', checkpoint: 'hatch-transaction', readSetCheckpoint: 'hatch-transaction', contributionIds: Object.freeze(['fossil-remnant-held-item']), disposition: 'reserved-br-065' }),
  Object.freeze({ canonicalId: 'This One’s Special, I Know It', checkpoint: 'begin-hatch', readSetCheckpoint: 'begin-hatch', contributionIds: Object.freeze(['force-bounded-special-outcome']), disposition: 'reserved-br-062' }),
  Object.freeze({ canonicalId: 'Tutoring', checkpoint: 'post-hatch-operation', readSetCheckpoint: 'inheritance-learning', contributionIds: Object.freeze(['compatible-egg-move-learning']), disposition: 'reserved-br-068' }),
] as const)
export type BreedingFeatureProviderCanonicalId = typeof BREEDING_FEATURE_PROVIDER_POLICIES[number]['canonicalId']
export const BREEDING_PLAYING_GOD_SPECIES_IDS = Object.freeze(['castform','grimer','koffing','magnemite','porygon','solosis','trubbish','voltorb'] as const)
const FEATURE_DEPENDENCY_IDS: Readonly<Record<BreedingFeatureProviderCanonicalId, string>> = Object.freeze({
  'Ancient Heritage': 'feature.ancient-heritage',
  Dilettante: 'feature.dilettante',
  'Egg Tutor': 'feature.egg-tutor',
  'Fossil Restoration': 'feature.fossil-restoration',
  'Genetic Memory': 'feature.genetic-memory',
  'Playing God': 'feature.playing-god',
  'Prehistoric Bond': 'feature.prehistoric-bond',
  'This One’s Special, I Know It': 'feature.this-ones-special-i-know-it',
  Tutoring: 'feature.tutoring',
})
export const breedingFeatureProviderDependencyId = (canonicalId: BreedingFeatureProviderCanonicalId): string => FEATURE_DEPENDENCY_IDS[canonicalId]

export type BreedingFeatureProviderValueV1 =
  | { readonly kind: 'evidence-only' }
  | { readonly kind: 'flag', readonly enabled: true }
  | { readonly kind: 'integer', readonly value: number }
  | { readonly kind: 'ratio', readonly numerator: number, readonly denominator: number }
  | { readonly kind: 'canonical-id-set', readonly values: readonly string[] }
export interface BreedingFeatureProviderContributionValueV1 {
  readonly contributionId: string
  readonly value: BreedingFeatureProviderValueV1
}

export interface BreedingFeatureProviderContributionEvidenceV1 {
  readonly schemaVersion: 1
  readonly inventoryEntryId: string
  readonly providerCanonicalId: BreedingFeatureProviderCanonicalId
  readonly providerInstanceId: string
  readonly providerRecordSha256: string
  readonly runtimeDefinitionSha256: string
  readonly effectiveFeatureProjectionSha256: string
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly trainerSheetDefinitionSha256: string
  readonly checkpoint: BreedingFeatureProviderCheckpoint
  readonly readSetCheckpoint: BreedingDependencyCheckpoint
  readonly contributionIds: readonly string[]
  readonly values: readonly BreedingFeatureProviderContributionValueV1[]
  readonly disposition: BreedingFeatureProviderDisposition
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}

export interface BreedingFeatureProviderHandoffV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly trainerSheetDefinitionSha256: string
  readonly accessMode: 'profile-control' | 'gm-authority'
  readonly accessEvidenceDefinitionSha256: string
  readonly checkpoint: BreedingFeatureProviderCheckpoint
  readonly effectiveFeatureProjectionSha256: string
  readonly contributions: readonly BreedingFeatureProviderContributionEvidenceV1[]
  readonly dependencyEvidence: readonly BreedingDependencyEvidenceV1[]
  readonly facilityRegistryState: 'empty-no-authority'
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}

export type BreedingFeatureProviderHandoffValidationCode =
  | 'breeding.feature-provider-handoff.invalid-document'
  | 'breeding.feature-provider-handoff.unknown-field'
  | 'breeding.feature-provider-handoff.invalid-invariant'
export class BreedingFeatureProviderHandoffValidationError extends Error {
  readonly code: BreedingFeatureProviderHandoffValidationCode
  readonly path: string
  constructor(code: BreedingFeatureProviderHandoffValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingFeatureProviderHandoffValidationError'
    this.code = code
    this.path = path
  }
}

type Row = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/’' -]{0,239}$/u
const CHECKPOINTS = new Set<string>(BREEDING_FEATURE_PROVIDER_CHECKPOINTS)
const DISPOSITIONS = new Set<string>(BREEDING_FEATURE_PROVIDER_DISPOSITIONS)
const POLICY_BY_ID = new Map<string, typeof BREEDING_FEATURE_PROVIDER_POLICIES[number]>(BREEDING_FEATURE_PROVIDER_POLICIES.map(value => [value.canonicalId, value]))
const fail = (code: BreedingFeatureProviderHandoffValidationCode, path: string, message: string): never => { throw new BreedingFeatureProviderHandoffValidationError(code, path, message) }
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a plain data object.')
  const row = value as Row; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.feature-provider-handoff.unknown-field', path, 'must contain exactly the declared fields.')
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.feature-provider-handoff.invalid-document', `${path}.${field}`, 'must be an enumerable data field.') }
  return row
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a lowercase SHA-256 value.')
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a bounded stable identifier.')
const revision = (value: unknown, path: string): number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2_147_483_647 ? value as number : fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a bounded revision.')
const minute = (value: unknown, path: string): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a nonnegative campaign minute.')
const strictArray = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.feature-provider-handoff.invalid-document', path, 'must be one strict bounded array.')
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.feature-provider-handoff.invalid-document', `${path}[${index}]`, 'must be an enumerable data element.') }
  return value
}
const exactStrings = (value: unknown, expected: readonly string[], path: string): readonly string[] => {
  const rows = strictArray(value, path, 16)
  if (rows.length !== expected.length || rows.some((entry, index) => entry !== expected[index])) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'must equal the reviewed contribution IDs in canonical order.')
  return Object.freeze([...expected])
}
const providerValue = (value: unknown, path: string): BreedingFeatureProviderValueV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a plain typed provider value.')
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind')
  if (!kindDescriptor?.enumerable || !('value' in kindDescriptor) || typeof kindDescriptor.value !== 'string') return fail('breeding.feature-provider-handoff.invalid-document', `${path}.kind`, 'must be an enumerable data field.')
  const kind = kindDescriptor.value
  const row = exact(value, kind === 'flag' ? ['kind','enabled'] : kind === 'integer' ? ['kind','value'] : kind === 'ratio' ? ['kind','numerator','denominator'] : kind === 'canonical-id-set' ? ['kind','values'] : ['kind'], path)
  if (row.kind === 'evidence-only') return Object.freeze({ kind: 'evidence-only' })
  if (row.kind === 'flag' && row.enabled === true) return Object.freeze({ kind: 'flag', enabled: true })
  if (row.kind === 'integer' && Number.isSafeInteger(row.value) && (row.value as number) >= -1_000_000 && (row.value as number) <= 1_000_000) return Object.freeze({ kind: 'integer', value: row.value as number })
  if (row.kind === 'ratio' && Number.isSafeInteger(row.numerator) && Number.isSafeInteger(row.denominator) && (row.numerator as number) > 0 && (row.denominator as number) > 0) return Object.freeze({ kind: 'ratio', numerator: row.numerator as number, denominator: row.denominator as number })
  if (row.kind === 'canonical-id-set') {
    const values = strictArray(row.values, `${path}.values`, 64).map((entry, index) => identifier(entry, `${path}.values[${index}]`))
    if (values.length < 1 || values.some((entry, index) => index > 0 && values[index - 1]! >= entry)) return fail('breeding.feature-provider-handoff.invalid-invariant', `${path}.values`, 'must be nonempty and unique in strict canonical order.')
    return Object.freeze({ kind: 'canonical-id-set', values: Object.freeze(values) })
  }
  return fail('breeding.feature-provider-handoff.invalid-document', path, 'must be a closed typed provider value.')
}
const exactValues = (value: unknown, contributionIds: readonly string[], path: string): readonly BreedingFeatureProviderContributionValueV1[] => {
  const rows = strictArray(value, path, 16).map((entry, index) => {
    const row = exact(entry, ['contributionId','value'], `${path}[${index}]`)
    if (row.contributionId !== contributionIds[index]) return fail('breeding.feature-provider-handoff.invalid-invariant', `${path}[${index}].contributionId`, 'must match contribution IDs in exact order.')
    return Object.freeze({ contributionId: row.contributionId, value: providerValue(row.value, `${path}[${index}].value`) }) as BreedingFeatureProviderContributionValueV1
  })
  if (rows.length !== contributionIds.length) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'must provide one typed value for every contribution.')
  return Object.freeze(rows)
}
const assertProviderValues = (canonicalId: BreedingFeatureProviderCanonicalId, values: readonly BreedingFeatureProviderContributionValueV1[], path: string): void => {
  const byId = new Map(values.map(entry => [entry.contributionId, entry.value]))
  const flag = (id: string): boolean => byId.get(id)?.kind === 'flag' && (byId.get(id) as { readonly enabled?: unknown }).enabled === true
  const integerValue = (id: string): number | null => byId.get(id)?.kind === 'integer' ? (byId.get(id) as { readonly value: number }).value : null
  if (canonicalId === 'Dilettante' && !flag('effective-breeder-edge-grant')) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Dilettante must contribute one effective Breeder grant flag.')
  if (canonicalId === 'Playing God') {
    const species = byId.get('artificial-species-options')
    const selected = species?.kind === 'canonical-id-set' && species.values.length === 1 ? species.values[0] : null
    const upgrades = integerValue('bounded-artificial-upgrades')
    if (!flag('artificial-egg-source') || !selected || !BREEDING_PLAYING_GOD_SPECIES_IDS.includes(selected as typeof BREEDING_PLAYING_GOD_SPECIES_IDS[number]) || !parseBreedingSpeciesIdSyntax(selected)
      || integerValue('hatch-within-one-day') !== 1_440 || integerValue('starting-level-5') !== 5
      || !flag('nature-choice') || !flag('basic-ability-choice') || upgrades === null || upgrades < 5 || upgrades > 6) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Playing God values must match the reviewed artificial-Egg bounds.')
  }
  if (canonicalId === 'Fossil Restoration' && (integerValue('fossil-tutor-point-delta-minus-2') !== -2 || !flag('fossil-extra-basic-or-advanced-ability'))) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Fossil Restoration values must match the reviewed hatch contribution.')
  if (canonicalId === 'Ancient Heritage' && !flag('fossil-ancient-power-learning')) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Ancient Heritage must contribute its reviewed learning permission.')
  if (canonicalId === 'Genetic Memory' && !flag('fossil-egg-or-tutor-move-learning')) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Genetic Memory must contribute its reviewed learning permission.')
  if (canonicalId === 'Prehistoric Bond' && !flag('fossil-remnant-held-item')) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Prehistoric Bond must contribute its reviewed held-item permission.')
  const specialUses = integerValue('force-bounded-special-outcome')
  if (canonicalId === 'This One’s Special, I Know It' && (specialUses === null || specialUses < 0 || specialUses > 4)) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'The hatch-special Feature must contribute zero through four rank-bound potential uses; BR-062 owns current resource authority.')
  if (canonicalId === 'Egg Tutor' && !flag('egg-list-move-learning')) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Egg Tutor must contribute its reviewed learning permission.')
  if (canonicalId === 'Tutoring') {
    const move = byId.get('compatible-egg-move-learning')
    if (move?.kind !== 'canonical-id-set' || move.values.length !== 1 || !parseBreedingMoveIdSyntax(move.values[0])) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'Tutoring must bind one canonical mastered Move.')
  }
}
const contributionKey = (value: BreedingFeatureProviderContributionEvidenceV1): string => `${value.providerCanonicalId}\u0000${value.providerInstanceId}`
const dependencyKey = (value: BreedingDependencyEvidenceV1): string => `${value.providerId}\u0000${value.subjectId}`

export const parseBreedingFeatureProviderContributionEvidenceV1 = (value: unknown, path = 'featureContribution'): BreedingFeatureProviderContributionEvidenceV1 => {
  const row = exact(value, ['schemaVersion','inventoryEntryId','providerCanonicalId','providerInstanceId','providerRecordSha256','runtimeDefinitionSha256','effectiveFeatureProjectionSha256','trainerSheetSlug','trainerSheetRevision','trainerSheetDefinitionSha256','checkpoint','readSetCheckpoint','contributionIds','values','disposition','capturedAtCampaignMinute','definitionSha256'], path)
  const policy = typeof row.providerCanonicalId === 'string' ? POLICY_BY_ID.get(row.providerCanonicalId) : undefined
  if (row.schemaVersion !== 1 || !policy || row.inventoryEntryId !== `feature:${policy.canonicalId}` || row.checkpoint !== policy.checkpoint || row.readSetCheckpoint !== policy.readSetCheckpoint || row.disposition !== policy.disposition || !DISPOSITIONS.has(String(row.disposition))) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'must match one closed Feature provider policy.')
  if (!isSlug(row.trainerSheetSlug) || (row.trainerSheetSlug as string).length > 160) return fail('breeding.feature-provider-handoff.invalid-document', `${path}.trainerSheetSlug`, 'must be a canonical Trainer slug.')
  const values = exactValues(row.values, policy.contributionIds, `${path}.values`)
  assertProviderValues(policy.canonicalId, values, `${path}.values`)
  return Object.freeze({
    schemaVersion: 1,
    inventoryEntryId: row.inventoryEntryId,
    providerCanonicalId: policy.canonicalId,
    providerInstanceId: identifier(row.providerInstanceId, `${path}.providerInstanceId`),
    providerRecordSha256: hash(row.providerRecordSha256, `${path}.providerRecordSha256`),
    runtimeDefinitionSha256: hash(row.runtimeDefinitionSha256, `${path}.runtimeDefinitionSha256`),
    effectiveFeatureProjectionSha256: hash(row.effectiveFeatureProjectionSha256, `${path}.effectiveFeatureProjectionSha256`),
    trainerSheetSlug: row.trainerSheetSlug,
    trainerSheetRevision: revision(row.trainerSheetRevision, `${path}.trainerSheetRevision`),
    trainerSheetDefinitionSha256: hash(row.trainerSheetDefinitionSha256, `${path}.trainerSheetDefinitionSha256`),
    checkpoint: policy.checkpoint,
    readSetCheckpoint: policy.readSetCheckpoint,
    contributionIds: exactStrings(row.contributionIds, policy.contributionIds, `${path}.contributionIds`),
    values,
    disposition: policy.disposition,
    capturedAtCampaignMinute: minute(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as BreedingFeatureProviderContributionEvidenceV1
}

export const parseBreedingFeatureProviderHandoffV1 = (value: unknown, path = 'featureProviderHandoff'): BreedingFeatureProviderHandoffV1 => {
  const row = exact(value, ['schemaVersion','trainerSheetSlug','trainerSheetRevision','trainerSheetDefinitionSha256','accessMode','accessEvidenceDefinitionSha256','checkpoint','effectiveFeatureProjectionSha256','contributions','dependencyEvidence','facilityRegistryState','capturedAtCampaignMinute','definitionSha256'], path)
  if (row.schemaVersion !== 1 || !isSlug(row.trainerSheetSlug) || (row.trainerSheetSlug as string).length > 160 || (row.accessMode !== 'profile-control' && row.accessMode !== 'gm-authority') || typeof row.checkpoint !== 'string' || !CHECKPOINTS.has(row.checkpoint) || row.facilityRegistryState !== 'empty-no-authority') return fail('breeding.feature-provider-handoff.invalid-document', path, 'must be one canonical schema-v1 Feature handoff.')
  const contributions = strictArray(row.contributions, `${path}.contributions`, 64).map((entry, index) => parseBreedingFeatureProviderContributionEvidenceV1(entry, `${path}.contributions[${index}]`))
  const dependencies = strictArray(row.dependencyEvidence, `${path}.dependencyEvidence`, 64).map((entry, index) => parseBreedingDependencyEvidenceV1(entry, `${path}.dependencyEvidence[${index}]`))
  const contributionKeys = contributions.map(contributionKey)
  const dependencyKeys = dependencies.map(dependencyKey)
  if (contributionKeys.some((key, index) => index > 0 && contributionKeys[index - 1]! >= key) || dependencyKeys.some((key, index) => index > 0 && dependencyKeys[index - 1]! >= key)) return fail('breeding.feature-provider-handoff.invalid-invariant', path, 'contributions and dependencies must be unique in strict canonical order.')
  const trainerRevision = revision(row.trainerSheetRevision, `${path}.trainerSheetRevision`)
  const trainerHash = hash(row.trainerSheetDefinitionSha256, `${path}.trainerSheetDefinitionSha256`)
  const effectiveHash = hash(row.effectiveFeatureProjectionSha256, `${path}.effectiveFeatureProjectionSha256`)
  const captured = minute(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`)
  if (contributions.some(contribution => contribution.trainerSheetSlug !== row.trainerSheetSlug || contribution.trainerSheetRevision !== trainerRevision || contribution.trainerSheetDefinitionSha256 !== trainerHash || contribution.effectiveFeatureProjectionSha256 !== effectiveHash || contribution.checkpoint !== row.checkpoint || contribution.capturedAtCampaignMinute !== captured)) return fail('breeding.feature-provider-handoff.invalid-invariant', `${path}.contributions`, 'must bind the exact handoff Trainer, Feature projection, checkpoint, and campaign minute.')
  for (const contribution of contributions) {
    const dependency = dependencies.find(entry => entry.providerKind === 'feature' && entry.providerId === breedingFeatureProviderDependencyId(contribution.providerCanonicalId) && entry.subjectKind === 'trainer-sheet' && entry.subjectId === contribution.trainerSheetSlug && entry.subjectRevision === contribution.trainerSheetRevision)
    if (!dependency || dependency.checkpoint !== contribution.readSetCheckpoint || dependency.providerDefinitionSha256 !== contribution.providerRecordSha256 || dependency.effectiveEvidenceSha256 !== contribution.effectiveFeatureProjectionSha256) return fail('breeding.feature-provider-handoff.invalid-invariant', `${path}.dependencyEvidence`, 'must exactly attest each effective Feature contribution.')
  }
  if (dependencies.length !== new Set(contributions.map(entry => entry.providerCanonicalId)).size) return fail('breeding.feature-provider-handoff.invalid-invariant', `${path}.dependencyEvidence`, 'cannot contain missing or extraneous Feature dependencies.')
  return Object.freeze({
    schemaVersion: 1,
    trainerSheetSlug: row.trainerSheetSlug,
    trainerSheetRevision: trainerRevision,
    trainerSheetDefinitionSha256: trainerHash,
    accessMode: row.accessMode,
    accessEvidenceDefinitionSha256: hash(row.accessEvidenceDefinitionSha256, `${path}.accessEvidenceDefinitionSha256`),
    checkpoint: row.checkpoint as BreedingFeatureProviderCheckpoint,
    effectiveFeatureProjectionSha256: effectiveHash,
    contributions: Object.freeze(contributions),
    dependencyEvidence: Object.freeze(dependencies),
    facilityRegistryState: 'empty-no-authority',
    capturedAtCampaignMinute: captured,
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
