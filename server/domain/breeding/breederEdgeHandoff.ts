import { createHash } from 'node:crypto'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, type StrictJsonObject } from '#shared/automation/strictJson'
import {
  BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
  BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID,
  BREEDING_BREEDER_EDGE_HANDOFF_CHECKPOINTS,
  BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID,
  parseBreedingBreederEdgeHandoffV1,
  type BreedingBreederEdgeHandoffCheckpoint,
  type BreedingBreederEdgeHandoffV1,
  type BreedingBreederSkillApplicationV1,
} from '#shared/breeding/breederEdgeHandoff'
import { parseBreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import {
  CANONICAL_TRAINER_EDGE_REFERENCE,
  normalizedEdgeIdentityKey,
} from '#shared/edgeAutomation/catalog'
import type { EffectiveEdgeSet } from '#shared/edgeAutomation/effective'
import { EDGE_AUTOMATION_MANIFEST } from '#shared/edgeAutomation/manifest'
import { isSlug } from '#shared/paths'
import type { TrainerSheet, SkillRank } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import {
  createBreedingBreederAuthorityEvidenceV1,
  parseAuthoritativeBreedingBreederAuthorityEvidenceV1,
} from './authorization'
import {
  planTrainerEdgeCampaignOperation,
  type EdgeCampaignOperationPlan,
} from '../edgeAutomation/campaignOperations'
import { resolveEffectiveEdges } from '../edgeAutomation/effectiveEdges'
import { EDGE_AUTOMATION_RUNTIME_REGISTRY } from '../edgeAutomation/registry'

export const BREEDING_BREEDER_EDGE_HANDOFF_POLICY_ID = 'breeding-breeder-edge-handoff-v1' as const
export const BREEDING_BREEDER_EDGE_RECORD_SHA256 = 'd303cbe8c377ec9bb2a305ee5626e3c80f9c1ebd77975623c985bce741a321f4' as const
export const BREEDING_BREEDER_EDGE_MECHANIC_FIELDS_SHA256 = 'c3c1c4f33bd0fb640a484f7bedddc0b2fe09839f34b06ae6d599986859ddd592' as const
export const BREEDING_BREEDER_EDGE_SOURCE_EFFECT_SHA256 = '5d6d96630ea0d15492a4bfda68720612bb98c9b29f5da6b9ee0e085e985d6bd8' as const

export type BreedingBreederEdgeHandoffAuthorityErrorCode =
  | 'breeding.breeder-edge-handoff.invalid-request'
  | 'breeding.breeder-edge-handoff.stale-trainer'
  | 'breeding.breeder-edge-handoff.stale-access'
  | 'breeding.breeder-edge-handoff.edge-unavailable'
  | 'breeding.breeder-edge-handoff.edge-ambiguous'
  | 'breeding.breeder-edge-handoff.prerequisite-not-met'
  | 'breeding.breeder-edge-handoff.unsupported-provider'
  | 'breeding.breeder-edge-handoff.contract-drift'
  | 'breeding.breeder-edge-handoff.provider-failure'

export class BreedingBreederEdgeHandoffAuthorityError extends Error {
  readonly code: BreedingBreederEdgeHandoffAuthorityErrorCode

  constructor(code: BreedingBreederEdgeHandoffAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingBreederEdgeHandoffAuthorityError'
    this.code = code
  }
}

export interface CreateBreedingBreederEdgeHandoffInputV1 {
  readonly trainerSheet: {
    readonly slug: unknown
    readonly revision: unknown
    readonly document: unknown
  }
  readonly accessMode: 'profile-control' | 'gm-authority' | 'campaign-shared-service'
  readonly accessEvidenceDefinitionSha256: unknown
  readonly evaluatedAtCampaignMinute: unknown
  readonly checkpoint: unknown
}

export interface BreedingBreederEdgeHandoffDependencies {
  readonly resolveEffectiveEdges?: (input: Parameters<typeof resolveEffectiveEdges>[0]) => EffectiveEdgeSet
  readonly resolveTrainerSkills?: typeof resolveTrainerSkills
  readonly planTrainerEdgeCampaignOperation?: typeof planTrainerEdgeCampaignOperation
  /** BR-061 server-owned proof and command-bound mandated-Skill choice for a current effective Dilettante grant. */
  readonly validateFeatureGrantedBreeder?: (input: {
    readonly sourceFeatureInstanceId: string
    readonly trainerSheetSlug: string
    readonly trainerSheetRevision: number
    readonly evaluatedAtCampaignMinute: number
  }) => {
    readonly sourceFeatureContributionDefinitionSha256: unknown
    readonly selectedSkillKey: unknown
  }
}

const CHECKPOINTS = new Set<string>(BREEDING_BREEDER_EDGE_HANDOFF_CHECKPOINTS)
const RANKS = new Set<SkillRank>(['Pathetic', 'Untrained', 'Novice', 'Adept', 'Expert', 'Master'])
const DILETTANTE_SKILL_KEYS = new Set(['generalEd', 'perception'])
const SHA256 = /^[0-9a-f]{64}$/u
const fail = (code: BreedingBreederEdgeHandoffAuthorityErrorCode, message: string): never => {
  throw new BreedingBreederEdgeHandoffAuthorityError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const sha256Text = (value: string): string => createHash('sha256').update(value).digest('hex')
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.breeder-edge-handoff.invalid-request', `${label} must be a plain data object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.breeder-edge-handoff.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.breeder-edge-handoff.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const strictTrainerDocument = (value: unknown): StrictJsonObject => {
  const cloned = cloneStrictJson(value, 'trainerSheet.document', {
    limits: {
      depth: 24,
      nodes: 200_000,
      objectFields: 10_000,
      arrayEntries: 10_000,
      stringLength: 100_000,
      objectKeyLength: 240,
    },
    rootLabel: 'Trainer sheet document',
    valueLabel: 'Trainer sheet document',
    failNotJson: (_path, detail) => fail('breeding.breeder-edge-handoff.invalid-request', `Trainer sheet document ${detail}`),
    failLimit: (_path, detail) => fail('breeding.breeder-edge-handoff.invalid-request', detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    return fail('breeding.breeder-edge-handoff.invalid-request', 'Trainer sheet document must be one plain JSON object.')
  }
  return cloned as StrictJsonObject
}
const mechanicFields = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  ['prerequisites', 'frequency', 'trigger', 'target', 'condition', 'effect', 'effects', 'text']
    .filter(field => Object.hasOwn(record, field))
    .map(field => [field, record[field]]),
)

const breederInventory = (() => {
  const inventory = modifierInventoryJson as {
    readonly definitionSha256: string
    readonly definition: {
      readonly entries: ReadonlyArray<{
        readonly id: string
        readonly recordSha256: string
        readonly mechanicFieldsSha256: string
        readonly contributionIds: readonly string[]
        readonly authorityOwner: string
        readonly integrationStatus: string
        readonly clientAuthority: string
      }>
    }
  }
  return Object.freeze({
    definitionSha256: inventory.definitionSha256,
    entry: inventory.definition.entries.find(entry => entry.id === 'trainer-edge:Breeder') ?? null,
  })
})()

const validateStaticBoundary = (): void => {
  const record = CANONICAL_TRAINER_EDGE_REFERENCE.Breeder as unknown as Record<string, unknown> | undefined
  const manifest = EDGE_AUTOMATION_MANIFEST.entries.find(entry => entry.family === 'trainer' && entry.canonicalId === 'Breeder')
  const runtime = EDGE_AUTOMATION_RUNTIME_REGISTRY.require('trainer', 'Breeder')
  if (!record || sha256(record) !== BREEDING_BREEDER_EDGE_RECORD_SHA256
    || sha256(mechanicFields(record)) !== BREEDING_BREEDER_EDGE_MECHANIC_FIELDS_SHA256
    || typeof record.effect !== 'string' || sha256Text(record.effect) !== BREEDING_BREEDER_EDGE_SOURCE_EFFECT_SHA256
    || record.prerequisites !== 'Novice Pokémon Education'
    || !manifest || manifest.status !== 'delegated-complete'
    || manifest.sourceEffectSha256 !== BREEDING_BREEDER_EDGE_SOURCE_EFFECT_SHA256
    || manifest.delegation?.capabilityId !== BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID
    || manifest.delegation.requestContract !== BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID
    || manifest.delegation.unavailableReason !== 'downstream-capability-unavailable'
    || runtime.spec.sourceEffectSha256 !== BREEDING_BREEDER_EDGE_SOURCE_EFFECT_SHA256
    || runtime.spec.mechanics.length !== 1
    || runtime.spec.mechanics[0]?.mechanicId !== 'breeding-handoff'
    || runtime.spec.mechanics[0]?.kind !== 'delegated-operation'
    || runtime.spec.mechanics[0]?.propertyId !== 'campaign.breeding.v1'
    || runtime.spec.mechanics[0]?.parameters.contractId !== BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID
    || !breederInventory.entry
    || breederInventory.entry.recordSha256 !== BREEDING_BREEDER_EDGE_RECORD_SHA256
    || breederInventory.entry.mechanicFieldsSha256 !== BREEDING_BREEDER_EDGE_MECHANIC_FIELDS_SHA256
    || stableJsonStringify(breederInventory.entry.contributionIds) !== stableJsonStringify(BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS)
    || breederInventory.entry.authorityOwner !== 'edge-automation'
    || breederInventory.entry.integrationStatus !== 'delegated-to-breeding'
    || breederInventory.entry.clientAuthority !== 'none') {
    return fail('breeding.breeder-edge-handoff.contract-drift', 'The canonical Breeder Edge, manifest, runtime declaration, or modifier inventory drifted from the reviewed handoff.')
  }
}

const invoke = <Value>(label: string, callback: () => Value): Value => {
  let value: Value
  try { value = callback() }
  catch (error) {
    if (error instanceof BreedingBreederEdgeHandoffAuthorityError) throw error
    return fail('breeding.breeder-edge-handoff.provider-failure', `${label} failed closed.`)
  }
  if (promiseLike(value)) {
    return fail('breeding.breeder-edge-handoff.provider-failure', `${label} must be synchronous.`)
  }
  return value
}

const validateFeatureResolution = (value: unknown): { readonly sourceFeatureContributionDefinitionSha256: string, readonly selectedSkillKey: 'generalEd' | 'perception' } => {
  const row = exact(value, ['sourceFeatureContributionDefinitionSha256','selectedSkillKey'], 'featureGrantedBreederResolution')
  if (typeof row.sourceFeatureContributionDefinitionSha256 !== 'string' || !SHA256.test(row.sourceFeatureContributionDefinitionSha256)
    || typeof row.selectedSkillKey !== 'string' || !DILETTANTE_SKILL_KEYS.has(row.selectedSkillKey)) return fail('breeding.breeder-edge-handoff.unsupported-provider', 'Dilettante Breeder authority requires one exact current Feature contribution and a closed mandated-Skill choice.')
  return Object.freeze({ sourceFeatureContributionDefinitionSha256: row.sourceFeatureContributionDefinitionSha256, selectedSkillKey: row.selectedSkillKey as 'generalEd' | 'perception' })
}
const validateDelegatedPlan = (plan: EdgeCampaignOperationPlan): void => {
  if (!plan || typeof plan !== 'object' || plan.ok !== true || plan.sourceEdge !== 'Breeder'
    || plan.actionId !== 'begin-breeding' || plan.reasonCode !== null
    || plan.moneyDelta !== 0 || Object.keys(plan.itemDeltas).length !== 0
    || Object.keys(plan.dailyUseDeltas).length !== 0 || plan.permissionFacts.length !== 0
    || plan.delegatedRequest?.capabilityId !== BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID
    || plan.delegatedRequest.contractId !== BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID) {
    return fail('breeding.breeder-edge-handoff.contract-drift', 'Edge automation did not return the exact closed Breeder delegation request.')
  }
}

export const parseAuthoritativeBreedingBreederEdgeHandoffV1 = (
  value: unknown,
  path = 'breederEdgeHandoff',
): BreedingBreederEdgeHandoffV1 => {
  const parsed = parseBreedingBreederEdgeHandoffV1(value, path)
  const { definitionSha256: _definitionSha256, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) {
    return fail('breeding.breeder-edge-handoff.invalid-request', `${path} definition hash is not authoritative.`)
  }
  parseAuthoritativeBreedingBreederAuthorityEvidenceV1(parsed.breederAuthority, `${path}.breederAuthority`)
  const { definitionSha256: _skillHash, ...skillDefinition } = parsed.skillApplication
  if (parsed.skillApplication.definitionSha256 !== sha256(skillDefinition)) return fail('breeding.breeder-edge-handoff.invalid-request', `${path}.skillApplication definition hash is not authoritative.`)
  return parsed
}

export const createBreedingBreederEdgeHandoffV1 = (
  inputValue: CreateBreedingBreederEdgeHandoffInputV1,
  dependencies: BreedingBreederEdgeHandoffDependencies = {},
): BreedingBreederEdgeHandoffV1 => {
  validateStaticBoundary()
  const input = exact(inputValue, [
    'trainerSheet',
    'accessMode',
    'accessEvidenceDefinitionSha256',
    'evaluatedAtCampaignMinute',
    'checkpoint',
  ], 'breederEdgeHandoffInput')
  const trainer = exact(input.trainerSheet, ['slug', 'revision', 'document'], 'breederEdgeHandoffInput.trainerSheet')
  if (!isSlug(trainer.slug) || (trainer.slug as string).length > 160
    || !Number.isSafeInteger(trainer.revision) || (trainer.revision as number) < 0
    || (trainer.revision as number) > 2_147_483_647
    || (input.accessMode !== 'profile-control' && input.accessMode !== 'gm-authority' && input.accessMode !== 'campaign-shared-service')
    || typeof input.accessEvidenceDefinitionSha256 !== 'string' || !SHA256.test(input.accessEvidenceDefinitionSha256)
    || !Number.isSafeInteger(input.evaluatedAtCampaignMinute) || (input.evaluatedAtCampaignMinute as number) < 0
    || typeof input.checkpoint !== 'string' || !CHECKPOINTS.has(input.checkpoint)) {
    return fail('breeding.breeder-edge-handoff.invalid-request', 'Breeder handoff identity, access, campaign minute, and checkpoint must be canonical bounded values.')
  }
  if (input.accessMode === 'campaign-shared-service') {
    return fail('breeding.breeder-edge-handoff.unsupported-provider', 'Campaign-shared Breeder service authority is unavailable because v1 has no canonical shared-service provider registry.')
  }
  const document = strictTrainerDocument(trainer.document)
  if (document.slug !== trainer.slug || document.revision !== trainer.revision) {
    return fail('breeding.breeder-edge-handoff.stale-trainer', 'Stored Trainer identity and revision must match the current document exactly.')
  }
  const trainerSheet = document as unknown as TrainerSheet
  const edgeResolver = dependencies.resolveEffectiveEdges ?? resolveEffectiveEdges
  const effectiveSet = invoke('Effective Edge resolution', () => edgeResolver({
    ownerId: trainer.slug as string,
    family: 'trainer',
    sheet: trainerSheet,
  }))
  if (!effectiveSet || typeof effectiveSet !== 'object'
    || effectiveSet.ownerId !== trainer.slug || effectiveSet.family !== 'trainer'
    || !Array.isArray(effectiveSet.instances) || !Array.isArray(effectiveSet.unresolved)) {
    return fail('breeding.breeder-edge-handoff.provider-failure', 'Effective Edge resolution returned an invalid Trainer projection.')
  }
  const unresolvedBreeder = effectiveSet.unresolved.some(entry => (
    typeof entry?.rawName === 'string' && normalizedEdgeIdentityKey(entry.rawName) === normalizedEdgeIdentityKey('Breeder')
  ))
  const candidates = effectiveSet.instances.filter(entry => entry?.family === 'trainer' && entry.canonicalId === 'Breeder')
  if (unresolvedBreeder || candidates.length > 1) {
    return fail('breeding.breeder-edge-handoff.edge-ambiguous', 'Breeder Edge identity must resolve exactly once without unresolved duplicate authority.')
  }
  const candidate = candidates[0]
  if (!candidate || !candidate.effective || candidate.parameterStatus !== 'ready') {
    return fail('breeding.breeder-edge-handoff.edge-unavailable', 'One current effective Breeder Trainer Edge is required.')
  }
  if (candidate.sources.length !== 1) {
    return fail('breeding.breeder-edge-handoff.edge-ambiguous', 'Breeder Edge authority must retain exactly one current acquisition source.')
  }
  const featureSource = candidate.sources[0]?.kind === 'feature-grant' ? candidate.sources[0] : null
  let featureResolution: { readonly sourceFeatureContributionDefinitionSha256: string, readonly selectedSkillKey: 'generalEd' | 'perception' } | null = null
  if (featureSource) {
    if (!dependencies.validateFeatureGrantedBreeder) {
      return fail('breeding.breeder-edge-handoff.unsupported-provider', 'Feature-granted Breeder authority requires the BR-061 current Feature handoff and mandated-Skill choice.')
    }
    featureResolution = validateFeatureResolution(invoke('Feature-granted Breeder validation', () => dependencies.validateFeatureGrantedBreeder!({
      sourceFeatureInstanceId: featureSource.sourceId,
      trainerSheetSlug: trainer.slug as string,
      trainerSheetRevision: trainer.revision as number,
      evaluatedAtCampaignMinute: input.evaluatedAtCampaignMinute as number,
    })))
  }
  const runtime = EDGE_AUTOMATION_RUNTIME_REGISTRY.require('trainer', 'Breeder')
  if (candidate.definitionHash !== runtime.definitionHash
    || stableJsonStringify(candidate.mechanics) !== stableJsonStringify(runtime.spec.mechanics)
    || stableJsonStringify(candidate.actions) !== stableJsonStringify(runtime.spec.actions)) {
    return fail('breeding.breeder-edge-handoff.contract-drift', 'Effective Breeder projection does not match the reviewed Edge runtime definition.')
  }
  const skillResolver = dependencies.resolveTrainerSkills ?? resolveTrainerSkills
  const skills = invoke('Trainer skill resolution', () => skillResolver(trainerSheet))
  if (!Array.isArray(skills)) {
    return fail('breeding.breeder-edge-handoff.provider-failure', 'Trainer skill resolution returned an invalid projection.')
  }
  const pokemonEducation = skills.find(skill => skill?.key === 'pokeEd')
  const mandatedSkill = featureResolution ? skills.find(skill => skill?.key === featureResolution!.selectedSkillKey) : pokemonEducation
  if (!pokemonEducation || !mandatedSkill || !RANKS.has(mandatedSkill.rank)
    || mandatedSkill.rank === 'Pathetic'
    || !Number.isSafeInteger(mandatedSkill.rankValue)
    || !Number.isSafeInteger(mandatedSkill.modifier)) {
    return fail('breeding.breeder-edge-handoff.provider-failure', 'The current mandated Breeder Skill rank and check contribution must resolve to bounded integers.')
  }
  if (!featureResolution && (pokemonEducation.rank === 'Pathetic' || pokemonEducation.rank === 'Untrained')) {
    return fail('breeding.breeder-edge-handoff.prerequisite-not-met', 'A directly acquired Breeder requires at least Novice Pokémon Education at the handoff checkpoint.')
  }
  const canonicalRank = mandatedSkill.rank as BreedingBreederSkillApplicationV1['rank']
  const skillTotal = mandatedSkill.rankValue + mandatedSkill.modifier
  if (!Number.isSafeInteger(skillTotal) || skillTotal < -30 || skillTotal > 100) {
    return fail('breeding.breeder-edge-handoff.provider-failure', 'The mandated Breeder Skill check contribution is outside the authority bounds.')
  }
  const campaignPlanner = dependencies.planTrainerEdgeCampaignOperation ?? planTrainerEdgeCampaignOperation
  const delegatedPlan = invoke('Edge campaign delegation', () => campaignPlanner(
    trainerSheet,
    { actionId: 'begin-breeding' },
    { money: 0, items: Object.freeze({}), tools: new Set(), dailyUses: Object.freeze({}) },
    { breedingCapabilityAvailable: true, effectiveEdgeSet: effectiveSet },
  ))
  validateDelegatedPlan(delegatedPlan)
  const mandatedSkillId: BreedingBreederSkillApplicationV1['mandatedSkillId'] = featureResolution
    ? (featureResolution.selectedSkillKey === 'generalEd' ? 'general-education' : 'perception')
    : 'pokemon-education'
  const effectiveEvidence = featureResolution ? Object.freeze({
    schemaVersion: 1 as const,
    effectiveEdgeSet: effectiveSet,
    mandatedSkillSubstitution: Object.freeze({
      sourceFeatureInstanceId: featureSource!.sourceId,
      sourceFeatureContributionDefinitionSha256: featureResolution.sourceFeatureContributionDefinitionSha256,
      mandatedSkillId,
    }),
  }) : effectiveSet
  const skillApplicationDefinition = {
    schemaVersion: 1 as const,
    mandatedSkillId,
    sourceKind: featureResolution ? 'dilettante-substitution' as const : 'canonical-edge' as const,
    sourceFeatureInstanceId: featureResolution ? featureSource!.sourceId : null,
    sourceFeatureContributionDefinitionSha256: featureResolution?.sourceFeatureContributionDefinitionSha256 ?? null,
    rank: canonicalRank,
    skillTotal,
  }
  const skillApplication: BreedingBreederSkillApplicationV1 = Object.freeze({
    ...skillApplicationDefinition,
    definitionSha256: sha256(skillApplicationDefinition),
  })
  const breederAuthority = createBreedingBreederAuthorityEvidenceV1({
    breederTrainerSlug: trainer.slug as string,
    breederTrainerRevision: trainer.revision as number,
    breederTrainerDefinitionSha256: sha256(document),
    accessMode: input.accessMode,
    accessEvidenceDefinitionSha256: input.accessEvidenceDefinitionSha256,
    edgeCanonicalId: 'Breeder',
    edgeInstanceId: candidate.instanceId,
    edgeRecordSha256: BREEDING_BREEDER_EDGE_RECORD_SHA256,
    effectiveEdgeProjectionSha256: sha256(effectiveEvidence),
    ...(featureResolution ? { mandatedSkillId } : {}),
    pokemonEducationRank: canonicalRank,
    pokemonEducationSkillTotal: skillTotal,
    evaluatedAtCampaignMinute: input.evaluatedAtCampaignMinute as number,
  })
  const dependencyEvidence = parseBreedingDependencyEvidenceV1({
    providerKind: 'edge',
    providerId: 'Breeder',
    subjectKind: 'trainer-sheet',
    subjectId: breederAuthority.breederTrainerSlug,
    subjectRevision: breederAuthority.breederTrainerRevision,
    checkpoint: input.checkpoint,
    providerDefinitionSha256: breederAuthority.edgeRecordSha256,
    effectiveEvidenceSha256: breederAuthority.effectiveEdgeProjectionSha256,
  })
  const definition = {
    schemaVersion: 1 as const,
    capabilityId: BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID,
    requestContractId: BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID,
    sourceContributionIds: BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
    checkpoint: input.checkpoint as BreedingBreederEdgeHandoffCheckpoint,
    breederAuthority,
    skillApplication,
    dependencyEvidence,
  }
  return parseAuthoritativeBreedingBreederEdgeHandoffV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export const assertBreedingBreederEdgeHandoffMatchesCurrentTrainerV1 = (inputValue: {
  readonly authority: unknown
  readonly trainerSheet: CreateBreedingBreederEdgeHandoffInputV1['trainerSheet']
  readonly checkpoint: unknown
  readonly evaluatedAtCampaignMinute: unknown
}, dependencies: BreedingBreederEdgeHandoffDependencies = {}): BreedingBreederEdgeHandoffV1 => {
  const input = exact(inputValue, ['authority', 'trainerSheet', 'checkpoint', 'evaluatedAtCampaignMinute'], 'currentBreederEdgeHandoffInput')
  let authority
  try { authority = parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.authority) }
  catch { return fail('breeding.breeder-edge-handoff.invalid-request', 'Supplied Breeder authority must be one exact self-hashed document.') }
  const current = createBreedingBreederEdgeHandoffV1({
    trainerSheet: input.trainerSheet as CreateBreedingBreederEdgeHandoffInputV1['trainerSheet'],
    accessMode: authority.accessMode,
    accessEvidenceDefinitionSha256: authority.accessEvidenceDefinitionSha256,
    evaluatedAtCampaignMinute: input.evaluatedAtCampaignMinute,
    checkpoint: input.checkpoint,
  }, dependencies)
  if (stableJsonStringify(current.breederAuthority) !== stableJsonStringify(authority)) {
    return fail('breeding.breeder-edge-handoff.stale-trainer', 'Supplied Breeder authority does not exactly match the current Edge and Pokémon Education projection.')
  }
  return current
}

export const BREEDING_BREEDER_EDGE_MODIFIER_INVENTORY_DEFINITION_SHA256 = breederInventory.definitionSha256
