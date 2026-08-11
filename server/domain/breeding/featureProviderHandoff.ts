import { createHash } from 'node:crypto'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, type StrictJsonObject } from '#shared/automation/strictJson'
import {
  BREEDING_FEATURE_PROVIDER_POLICIES,
  BREEDING_PLAYING_GOD_SPECIES_IDS,
  breedingFeatureProviderDependencyId,
  parseBreedingFeatureProviderContributionEvidenceV1,
  parseBreedingFeatureProviderHandoffV1,
  type BreedingFeatureProviderCanonicalId,
  type BreedingFeatureProviderCheckpoint,
  type BreedingFeatureProviderContributionEvidenceV1,
  type BreedingFeatureProviderContributionValueV1,
  type BreedingFeatureProviderHandoffV1,
} from '#shared/breeding/featureProviderHandoff'
import { parseBreedingDependencyEvidenceV1, type BreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import type { BreedingProviderContributionSnapshotV1 } from '#shared/breeding/productionSnapshots'
import { CANONICAL_FEATURE_REFERENCE, normalizedFeatureIdentityKey } from '#shared/featureAutomation/catalog'
import { featureChoiceValues } from '#shared/featureAutomation/instances'
import type { EffectiveFeatureSet, FeatureSuppressionInput } from '#shared/featureAutomation/effective'
import { resolveFeatureGrants } from '#shared/featureAutomation/grants'
import { isSlug } from '#shared/paths'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { BREEDING_CANONICAL_MOVES, BREEDING_CANONICAL_SPECIES } from './canonicalIds'
import { createBreedingProviderContributionSnapshotV1 } from './productionSnapshots'
import { FEATURE_CAMPAIGN_DEFINITIONS } from '../featureAutomation/campaignOperations'
import { resolveEffectiveFeatures } from '../featureAutomation/effectiveFeatures'
import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from '../featureAutomation/registry'

export const BREEDING_FEATURE_PROVIDER_HANDOFF_POLICY_ID = 'breeding-feature-provider-handoff-v1' as const
export const BREEDING_FEATURE_PROVIDER_INVENTORY_DEFINITION_SHA256 = '24bb20a9d61003f540f6b410df3b0919ee49233012e45ec2dd14bfc9ed5c2dd9' as const
export const BREEDING_FEATURE_PROVIDER_FACILITY_REGISTRY_STATE = 'empty-no-authority' as const

export type BreedingFeatureProviderHandoffAuthorityErrorCode =
  | 'breeding.feature-provider-handoff.invalid-request'
  | 'breeding.feature-provider-handoff.stale-trainer'
  | 'breeding.feature-provider-handoff.provider-ambiguous'
  | 'breeding.feature-provider-handoff.contract-drift'
  | 'breeding.feature-provider-handoff.provider-failure'
  | 'breeding.feature-provider-handoff.provider-unavailable'
  | 'breeding.feature-provider-handoff.facility-unavailable'

export class BreedingFeatureProviderHandoffAuthorityError extends Error {
  readonly code: BreedingFeatureProviderHandoffAuthorityErrorCode
  constructor(code: BreedingFeatureProviderHandoffAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingFeatureProviderHandoffAuthorityError'
    this.code = code
  }
}

export interface CreateBreedingFeatureProviderHandoffInputV1 {
  readonly trainerSheet: { readonly slug: unknown, readonly revision: unknown, readonly document: unknown }
  readonly accessMode: 'profile-control' | 'gm-authority'
  readonly accessEvidenceDefinitionSha256: unknown
  readonly checkpoint: unknown
  readonly capturedAtCampaignMinute: unknown
  readonly facilityClaims: unknown
}
export interface BreedingFeatureProviderHandoffDependencies {
  readonly resolveEffectiveFeatures?: (input: {
    readonly ownerId: string
    readonly sheet: TrainerSheet
    readonly suppressions?: readonly FeatureSuppressionInput[]
  }) => EffectiveFeatureSet
  readonly featureSuppressions?: readonly FeatureSuppressionInput[]
  readonly resolveTrainerSkills?: typeof resolveTrainerSkills
}

const SHA256 = /^[0-9a-f]{64}$/u
const CHECKPOINTS = new Set<string>(BREEDING_FEATURE_PROVIDER_POLICIES.map(policy => policy.checkpoint))
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const fail = (code: BreedingFeatureProviderHandoffAuthorityErrorCode, message: string): never => { throw new BreedingFeatureProviderHandoffAuthorityError(code, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const promiseLike = (value: unknown): value is PromiseLike<unknown> => ((typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function')
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.feature-provider-handoff.invalid-request', `${label} must be a plain data object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.feature-provider-handoff.invalid-request', `${label} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.feature-provider-handoff.invalid-request', `${label}.${field} must be an enumerable data field.`) }
  return row
}
const strictTrainerDocument = (value: unknown): StrictJsonObject => {
  const cloned = cloneStrictJson(value, 'trainerSheet.document', {
    limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
    rootLabel: 'Trainer sheet document', valueLabel: 'Trainer sheet document',
    failNotJson: (_path, detail) => fail('breeding.feature-provider-handoff.invalid-request', `Trainer sheet document ${detail}`),
    failLimit: (_path, detail) => fail('breeding.feature-provider-handoff.invalid-request', detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return fail('breeding.feature-provider-handoff.invalid-request', 'Trainer sheet document must be one plain JSON object.')
  return cloned as StrictJsonObject
}
const strictEffectiveProjection = (value: unknown): EffectiveFeatureSet => cloneStrictJson(value, 'effectiveFeatureSet', {
  limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
  rootLabel: 'Effective Feature projection', valueLabel: 'Effective Feature projection',
  failNotJson: (_path, detail) => fail('breeding.feature-provider-handoff.provider-failure', `Effective Feature projection ${detail}`),
  failLimit: (_path, detail) => fail('breeding.feature-provider-handoff.provider-failure', detail),
}) as unknown as EffectiveFeatureSet
const strictSkillProjection = (value: unknown): ReturnType<typeof resolveTrainerSkills> => {
  const cloned = cloneStrictJson(value, 'trainerSkills', {
    limits: { depth: 8, nodes: 2_000, objectFields: 100, arrayEntries: 100, stringLength: 1_000, objectKeyLength: 120 },
    rootLabel: 'Trainer Skill projection', valueLabel: 'Trainer Skill projection',
    failNotJson: (_path, detail) => fail('breeding.feature-provider-handoff.provider-failure', `Trainer Skill projection ${detail}`),
    failLimit: (_path, detail) => fail('breeding.feature-provider-handoff.provider-failure', detail),
  })
  if (!Array.isArray(cloned)) return fail('breeding.feature-provider-handoff.provider-failure', 'Trainer Skill projection must be one bounded array.')
  return cloned as unknown as ReturnType<typeof resolveTrainerSkills>
}
const strictEmptyFacilities = (value: unknown): void => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.feature-provider-handoff.invalid-request', 'Facility claims must be one strict array.')
  if (value.length !== 0) return fail('breeding.feature-provider-handoff.facility-unavailable', 'No app-owned canonical breeding facility exists; facility claims grant no authority.')
}
const mechanicFields = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  ['prerequisites', 'frequency', 'trigger', 'target', 'condition', 'effect', 'effects', 'text'].filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]),
)
type InventoryEntry = {
  readonly id: string
  readonly sourceKind: string
  readonly canonicalId: string
  readonly recordSha256: string
  readonly mechanicFieldsSha256: string
  readonly contributionIds: readonly string[]
  readonly snapshotCheckpoint: string
  readonly authorityOwner: string
  readonly integrationStatus: string
  readonly clientAuthority: string
}
const inventory = modifierInventoryJson as unknown as {
  readonly definitionSha256: string
  readonly definition: { readonly entries: readonly InventoryEntry[], readonly resourceGaps: ReadonlyArray<{ readonly id: string, readonly status: string }> }
}
const inventoryById = new Map(inventory.definition.entries.map(entry => [entry.id, entry]))

const validateStaticBoundary = (): void => {
  const facilityGap = inventory.definition.resourceGaps.find(gap => gap.id === 'breeding.resource.facility-registry')
  if (inventory.definitionSha256 !== BREEDING_FEATURE_PROVIDER_INVENTORY_DEFINITION_SHA256 || facilityGap?.status !== 'missing') return fail('breeding.feature-provider-handoff.contract-drift', 'Breeding modifier inventory or empty facility policy drifted.')
  for (const policy of BREEDING_FEATURE_PROVIDER_POLICIES) {
    const inventoryEntry = inventoryById.get(`feature:${policy.canonicalId}`)
    const record = CANONICAL_FEATURE_REFERENCE[policy.canonicalId] as unknown as Record<string, unknown> | undefined
    const runtime = FEATURE_AUTOMATION_RUNTIME_REGISTRY.resolve(policy.canonicalId)
    if (!inventoryEntry || !record || !runtime || inventoryEntry.sourceKind !== 'feature'
      || inventoryEntry.canonicalId !== policy.canonicalId
      || inventoryEntry.recordSha256 !== sha256(record)
      || inventoryEntry.mechanicFieldsSha256 !== sha256(mechanicFields(record))
      || stableJsonStringify(inventoryEntry.contributionIds) !== stableJsonStringify(policy.contributionIds)
      || inventoryEntry.snapshotCheckpoint !== policy.checkpoint
      || inventoryEntry.authorityOwner !== 'feature-automation'
      || inventoryEntry.clientAuthority !== 'none'
      || runtime.spec.sourceEffectSha256 !== createHash('sha256').update(String(record.effect)).digest('hex')) return fail('breeding.feature-provider-handoff.contract-drift', `Feature provider ${policy.canonicalId} drifted from canonical reference, runtime, or modifier inventory authority.`)
  }
  const campaignProviderIds = new Set(['Ancient Heritage', 'Dilettante', 'Egg Tutor', 'Fossil Restoration', 'Genetic Memory', 'Playing God', 'Tutoring'])
  for (const canonicalId of campaignProviderIds) {
    const definition = FEATURE_CAMPAIGN_DEFINITIONS.find(entry => entry.canonicalId === canonicalId)
    const runtime = FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
    if (!definition || definition.sourceEffectSha256 !== runtime.spec.sourceEffectSha256) return fail('breeding.feature-provider-handoff.contract-drift', `Feature campaign-operation provider ${canonicalId} drifted.`)
  }
}
const invoke = <Value>(label: string, callback: () => Value): Value => {
  let value: Value
  try { value = callback() }
  catch (error) { if (error instanceof BreedingFeatureProviderHandoffAuthorityError) throw error; return fail('breeding.feature-provider-handoff.provider-failure', `${label} failed closed.`) }
  if (promiseLike(value)) return fail('breeding.feature-provider-handoff.provider-failure', `${label} must be synchronous.`)
  return value
}
const isDilettanteBreederGrant = (instance: EffectiveFeatureSet['instances'][number]): boolean => resolveFeatureGrants(instance.instance).some(grant => grant.kind === 'edge' && grant.targetPolicy === 'trainer' && grant.duration === 'permanent' && grant.canonicalId === 'Breeder')
const normalized = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[’‘]/gu, "'").trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
const speciesByName = new Map(BREEDING_CANONICAL_SPECIES.map(entry => [normalized(entry.sourceName), entry.id]))
const movesByName = new Map(BREEDING_CANONICAL_MOVES.map(entry => [normalized(entry.sourceName), entry.id]))
const PLAYING_GOD_SPECIES = new Set<string>(BREEDING_PLAYING_GOD_SPECIES_IDS)
const typedValues = (input: {
  readonly candidate: EffectiveFeatureSet['instances'][number]
  readonly trainerSheet: TrainerSheet
  readonly resolveSkills: typeof resolveTrainerSkills
}): readonly BreedingFeatureProviderContributionValueV1[] => {
  const policy = BREEDING_FEATURE_PROVIDER_POLICIES.find(entry => entry.canonicalId === input.candidate.canonicalId)!
  const values = new Map<string, BreedingFeatureProviderContributionValueV1['value']>()
  for (const id of policy.contributionIds) values.set(id, Object.freeze({ kind: 'evidence-only' }))
  if (policy.canonicalId === 'Dilettante') values.set('effective-breeder-edge-grant', Object.freeze({ kind: 'flag', enabled: true }))
  if (policy.canonicalId === 'Playing God') {
    const speciesChoices = featureChoiceValues(input.candidate.instance, 'species')
    const selected = speciesChoices.length === 1 ? speciesByName.get(normalized(speciesChoices[0]!)) : undefined
    const skills = strictSkillProjection(invoke('Playing God skill resolution', () => input.resolveSkills(input.trainerSheet)))
    const technology = skills.find(skill => skill.key === 'techEd')
    if (!selected || !PLAYING_GOD_SPECIES.has(selected) || !technology || technology.rankValue < 5) return fail('breeding.feature-provider-handoff.provider-unavailable', 'Playing God requires one reviewed artificial Species choice and current Expert Technology Education.')
    values.set('artificial-egg-source', Object.freeze({ kind: 'flag', enabled: true }))
    values.set('artificial-species-options', Object.freeze({ kind: 'canonical-id-set', values: Object.freeze([selected]) }))
    values.set('hatch-within-one-day', Object.freeze({ kind: 'integer', value: 1_440 }))
    values.set('starting-level-5', Object.freeze({ kind: 'integer', value: 5 }))
    values.set('nature-choice', Object.freeze({ kind: 'flag', enabled: true }))
    values.set('basic-ability-choice', Object.freeze({ kind: 'flag', enabled: true }))
    values.set('bounded-artificial-upgrades', Object.freeze({ kind: 'integer', value: technology.rankValue }))
  }
  if (policy.canonicalId === 'Fossil Restoration') {
    values.set('fossil-tutor-point-delta-minus-2', Object.freeze({ kind: 'integer', value: -2 }))
    values.set('fossil-extra-basic-or-advanced-ability', Object.freeze({ kind: 'flag', enabled: true }))
  }
  if (policy.canonicalId === 'Ancient Heritage') values.set('fossil-ancient-power-learning', Object.freeze({ kind: 'flag', enabled: true }))
  if (policy.canonicalId === 'Genetic Memory') values.set('fossil-egg-or-tutor-move-learning', Object.freeze({ kind: 'flag', enabled: true }))
  if (policy.canonicalId === 'Prehistoric Bond') values.set('fossil-remnant-held-item', Object.freeze({ kind: 'flag', enabled: true }))
  if (policy.canonicalId === 'This One’s Special, I Know It') {
    const skills = strictSkillProjection(invoke('Hatch-special Feature skill resolution', () => input.resolveSkills(input.trainerSheet)))
    const pokemonEducation = skills.find(skill => skill.key === 'pokeEd')
    if (!pokemonEducation) return fail('breeding.feature-provider-handoff.provider-failure', 'Pokémon Education rank is unavailable for the hatch-special Feature.')
    values.set('force-bounded-special-outcome', Object.freeze({ kind: 'integer', value: Math.max(0, pokemonEducation.rankValue - 2) }))
  }
  if (policy.canonicalId === 'Egg Tutor') values.set('egg-list-move-learning', Object.freeze({ kind: 'flag', enabled: true }))
  if (policy.canonicalId === 'Tutoring') {
    const choices = featureChoiceValues(input.candidate.instance, 'move')
    const selected = choices.length === 1 ? movesByName.get(normalized(choices[0]!)) : undefined
    if (!selected) return fail('breeding.feature-provider-handoff.provider-unavailable', 'Tutoring requires one current canonical mastered Move choice.')
    values.set('compatible-egg-move-learning', Object.freeze({ kind: 'canonical-id-set', values: Object.freeze([selected]) }))
  }
  return Object.freeze(policy.contributionIds.map(contributionId => Object.freeze({ contributionId, value: values.get(contributionId)! })))
}

export const parseAuthoritativeBreedingFeatureProviderContributionEvidenceV1 = (value: unknown, path = 'featureContribution'): BreedingFeatureProviderContributionEvidenceV1 => {
  const parsed = parseBreedingFeatureProviderContributionEvidenceV1(value, path)
  const { definitionSha256: _definitionSha256, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.feature-provider-handoff.invalid-request', `${path} definition hash is not authoritative.`)
  return parsed
}
export const parseAuthoritativeBreedingFeatureProviderHandoffV1 = (value: unknown, path = 'featureProviderHandoff'): BreedingFeatureProviderHandoffV1 => {
  const parsed = parseBreedingFeatureProviderHandoffV1(value, path)
  parsed.contributions.forEach((entry, index) => parseAuthoritativeBreedingFeatureProviderContributionEvidenceV1(entry, `${path}.contributions[${index}]`))
  const { definitionSha256: _definitionSha256, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.feature-provider-handoff.invalid-request', `${path} definition hash is not authoritative.`)
  return parsed
}

export const createBreedingFeatureProviderHandoffV1 = (
  inputValue: CreateBreedingFeatureProviderHandoffInputV1,
  dependencies: BreedingFeatureProviderHandoffDependencies = {},
): BreedingFeatureProviderHandoffV1 => {
  validateStaticBoundary()
  const input = exact(inputValue, ['trainerSheet','accessMode','accessEvidenceDefinitionSha256','checkpoint','capturedAtCampaignMinute','facilityClaims'], 'featureProviderHandoffInput')
  const trainer = exact(input.trainerSheet, ['slug','revision','document'], 'featureProviderHandoffInput.trainerSheet')
  if (!isSlug(trainer.slug) || (trainer.slug as string).length > 160 || !Number.isSafeInteger(trainer.revision) || (trainer.revision as number) < 0 || (trainer.revision as number) > 2_147_483_647
    || (input.accessMode !== 'profile-control' && input.accessMode !== 'gm-authority') || typeof input.accessEvidenceDefinitionSha256 !== 'string' || !SHA256.test(input.accessEvidenceDefinitionSha256)
    || typeof input.checkpoint !== 'string' || !CHECKPOINTS.has(input.checkpoint) || !Number.isSafeInteger(input.capturedAtCampaignMinute) || (input.capturedAtCampaignMinute as number) < 0) return fail('breeding.feature-provider-handoff.invalid-request', 'Feature handoff identity, access, checkpoint, and campaign minute must be canonical bounded values.')
  strictEmptyFacilities(input.facilityClaims)
  const document = strictTrainerDocument(trainer.document)
  if (document.slug !== trainer.slug || document.revision !== trainer.revision) return fail('breeding.feature-provider-handoff.stale-trainer', 'Stored Trainer identity and revision must match the current document exactly.')
  const trainerSheet = document as unknown as TrainerSheet
  const resolver = dependencies.resolveEffectiveFeatures ?? resolveEffectiveFeatures
  const effectiveSet = strictEffectiveProjection(invoke('Effective Feature resolution', () => resolver({ ownerId: trainer.slug as string, sheet: trainerSheet, suppressions: dependencies.featureSuppressions })))
  if (!effectiveSet || typeof effectiveSet !== 'object' || effectiveSet.schemaVersion !== 1 || effectiveSet.ownerId !== trainer.slug || !Array.isArray(effectiveSet.instances) || !Array.isArray(effectiveSet.unresolved)) return fail('breeding.feature-provider-handoff.provider-failure', 'Effective Feature resolution returned an invalid current projection.')
  const policies = BREEDING_FEATURE_PROVIDER_POLICIES.filter(policy => policy.checkpoint === input.checkpoint)
  const policyIds = new Set<string>(policies.map(policy => policy.canonicalId))
  if (effectiveSet.unresolved.some(entry => typeof entry?.rawName === 'string' && policies.some(policy => normalizedFeatureIdentityKey(entry.rawName) === normalizedFeatureIdentityKey(policy.canonicalId)))) return fail('breeding.feature-provider-handoff.provider-ambiguous', 'A relevant Feature provider has unresolved or malformed identity authority.')
  const effectiveHash = sha256(effectiveSet)
  const trainerHash = sha256(document)
  const contributions: BreedingFeatureProviderContributionEvidenceV1[] = []
  for (const candidate of effectiveSet.instances) {
    if (!candidate.effective || !policyIds.has(candidate.canonicalId)) continue
    if (candidate.parameterStatus !== 'ready') return fail('breeding.feature-provider-handoff.provider-ambiguous', `Effective Feature ${candidate.canonicalId} has unresolved required provider parameters.`)
    const policy = policies.find(entry => entry.canonicalId === candidate.canonicalId)!
    if (policy.canonicalId === 'Dilettante' && !isDilettanteBreederGrant(candidate)) continue
    const runtime = FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(candidate.canonicalId)
    const inventoryEntry = inventoryById.get(`feature:${candidate.canonicalId}`)!
    if (candidate.definitionHash !== runtime.definitionHash || stableJsonStringify(candidate.mechanics) !== stableJsonStringify(runtime.spec.mechanics) || stableJsonStringify(candidate.actions) !== stableJsonStringify(runtime.spec.actions)) return fail('breeding.feature-provider-handoff.contract-drift', `Effective Feature ${candidate.canonicalId} does not match its reviewed runtime definition.`)
    const definition = {
      schemaVersion: 1 as const,
      inventoryEntryId: inventoryEntry.id,
      providerCanonicalId: policy.canonicalId,
      providerInstanceId: candidate.instanceId,
      providerRecordSha256: inventoryEntry.recordSha256,
      runtimeDefinitionSha256: runtime.definitionHash,
      effectiveFeatureProjectionSha256: effectiveHash,
      trainerSheetSlug: trainer.slug as string,
      trainerSheetRevision: trainer.revision as number,
      trainerSheetDefinitionSha256: trainerHash,
      checkpoint: policy.checkpoint,
      readSetCheckpoint: policy.readSetCheckpoint,
      contributionIds: policy.contributionIds,
      values: typedValues({ candidate, trainerSheet, resolveSkills: dependencies.resolveTrainerSkills ?? resolveTrainerSkills }),
      disposition: policy.disposition,
      capturedAtCampaignMinute: input.capturedAtCampaignMinute as number,
    }
    contributions.push(parseAuthoritativeBreedingFeatureProviderContributionEvidenceV1({ ...definition, definitionSha256: sha256(definition) }))
  }
  contributions.sort((left, right) => compare(`${left.providerCanonicalId}\u0000${left.providerInstanceId}`, `${right.providerCanonicalId}\u0000${right.providerInstanceId}`))
  const dependencyEvidence: BreedingDependencyEvidenceV1[] = []
  for (const canonicalId of [...new Set(contributions.map(entry => entry.providerCanonicalId))].sort(compare)) {
    const contribution = contributions.find(entry => entry.providerCanonicalId === canonicalId)!
    dependencyEvidence.push(parseBreedingDependencyEvidenceV1({
      providerKind: 'feature', providerId: breedingFeatureProviderDependencyId(canonicalId), subjectKind: 'trainer-sheet', subjectId: contribution.trainerSheetSlug,
      subjectRevision: contribution.trainerSheetRevision, checkpoint: contribution.readSetCheckpoint,
      providerDefinitionSha256: contribution.providerRecordSha256, effectiveEvidenceSha256: contribution.effectiveFeatureProjectionSha256,
    }))
  }
  const definition = {
    schemaVersion: 1 as const,
    trainerSheetSlug: trainer.slug as string,
    trainerSheetRevision: trainer.revision as number,
    trainerSheetDefinitionSha256: trainerHash,
    accessMode: input.accessMode,
    accessEvidenceDefinitionSha256: input.accessEvidenceDefinitionSha256,
    checkpoint: input.checkpoint as BreedingFeatureProviderCheckpoint,
    effectiveFeatureProjectionSha256: effectiveHash,
    contributions: Object.freeze(contributions),
    dependencyEvidence: Object.freeze(dependencyEvidence),
    facilityRegistryState: BREEDING_FEATURE_PROVIDER_FACILITY_REGISTRY_STATE,
    capturedAtCampaignMinute: input.capturedAtCampaignMinute as number,
  }
  return parseAuthoritativeBreedingFeatureProviderHandoffV1({ ...definition, definitionSha256: sha256(definition) })
}

export const createBreedingProviderContributionSnapshotsFromFeatureHandoffV1 = (handoffValue: unknown): readonly BreedingProviderContributionSnapshotV1[] => {
  const handoff = parseAuthoritativeBreedingFeatureProviderHandoffV1(handoffValue)
  return Object.freeze(handoff.contributions.flatMap(contribution => contribution.values.map(entry => createBreedingProviderContributionSnapshotV1({
    inventoryEntryId: contribution.inventoryEntryId,
    contributionId: entry.contributionId,
    providerKind: 'feature',
    providerId: breedingFeatureProviderDependencyId(contribution.providerCanonicalId),
    subjectKind: 'trainer-sheet',
    subjectId: contribution.trainerSheetSlug,
    subjectRevision: contribution.trainerSheetRevision,
    checkpoint: contribution.readSetCheckpoint,
    value: entry.value,
    providerDefinitionSha256: contribution.providerRecordSha256,
    effectiveEvidenceSha256: contribution.effectiveFeatureProjectionSha256,
  }))))
}

export const breedingFeatureProviderContribution = (input: {
  readonly handoff: unknown
  readonly canonicalId: BreedingFeatureProviderCanonicalId
  readonly contributionId: string
}): BreedingFeatureProviderContributionEvidenceV1 | null => {
  const row = exact(input, ['handoff','canonicalId','contributionId'], 'featureProviderContributionLookup')
  const handoff = parseAuthoritativeBreedingFeatureProviderHandoffV1(row.handoff)
  if (typeof row.canonicalId !== 'string' || typeof row.contributionId !== 'string') return fail('breeding.feature-provider-handoff.invalid-request', 'Feature contribution lookup identities must be strings.')
  return handoff.contributions.find(entry => entry.providerCanonicalId === row.canonicalId && entry.contributionIds.includes(row.contributionId as string)) ?? null
}
