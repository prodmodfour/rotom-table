import { createHash, randomInt } from 'node:crypto'
import initializedSheetContractJson from '../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { AuthRole } from '#shared/auth'
import type { BreedingActorAuthorityV1 } from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  parseBreedingHatchWorkflowRequestV1,
  type BreedingHatchWorkflowGmReviewV1,
  type BreedingHatchWorkflowProjectionV1,
  type BreedingHatchWorkflowRequestV1,
  type BreedingHatchWorkflowSpecialV1,
  type BreedingHatchWorkflowTransitionKind,
} from '#shared/breeding/hatchWorkflow'
import type { BreedingDependencyEvidenceV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { breedingDependencyEvidenceKey } from '#shared/breeding/readSets'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import type { EffectiveCapabilitySet } from '#shared/capabilityAutomation/effective'
import { parseCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import type { CharacterSheet } from '~/types/characterSheet'
import { pokemonHasActiveBabyTemplate } from '~/utils/sheets/pokemonDerived'
import { createBreedingActorAuthorityV1, createBreedingTrainerControlEvidenceV1 } from '../domain/breeding/authorization'
import {
  DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
  parseBreedingCampaignOptionSnapshotV1,
  type BreedingCampaignOptionSnapshotV1,
} from '../domain/breeding/campaignOptions'
import { planPokemonEggChildSheetConstructionV1 } from '../domain/breeding/childSheetConstruction'
import { canonicalBreedingAbilityIdentity, canonicalBreedingSpeciesIdentity } from '../domain/breeding/canonicalIds'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/currentReferences'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from '../domain/breeding/eggLifecyclePolicy'
import {
  authorizeBreedingCompleteHatchV1,
  BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256,
  BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_COMPLETION_PROVIDER_ID,
} from '../domain/breeding/hatchCompletion'
import {
  createPokemonEggHatchOwnerTrainerFactV1,
  projectPokemonEggHatchOfferV1,
} from '../domain/breeding/hatchOffers'
import {
  BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_PROVIDER_ID,
  deriveBreedingHatchSpecialAdjudicationIdV1,
  deriveBreedingHatchSpecialOfferIdV1,
  projectPokemonEggHatchSpecialV1,
} from '../domain/breeding/hatchSpecial'
import { authorizeBreedingBeginHatchV1, authorizeBreedingResolveHatchSpecialV1 } from '../domain/breeding/hatchSpecialAuthorization'
import { createBreedingHatchWorkflowProjectionV1 } from '../domain/breeding/hatchWorkflow'
import {
  createBreedingMarsupialHandoffV1,
  createBreedingParentalBondHandoffV1,
} from '../domain/breeding/modifierProviderHandoff'
import { breedingNature } from '../domain/breeding/natures'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import { createBreedingOperationReadSetV1 } from '../domain/breeding/readSets'
import { resolveEffectiveCapabilities as resolveCapabilityAutomation } from '../domain/capabilityAutomation/effectiveCapabilities'
import { createSqliteBreedingGmAdjudicationRepository } from '../storage/breedingGmAdjudicationRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../storage/breedingOptionOfferRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../storage/sheetRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../storage/trainerSpeciesAcquisitionRepository'
import { completePokemonEggHatch } from './completePokemonEggHatch'
import { beginPokemonEggHatchSpecial, resolvePokemonEggHatchSpecial } from './managePokemonEggHatchSpecial'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ManageBreedingHatchWorkflowError extends UseCaseHttpError<400 | 403 | 409> {}

export interface ManageBreedingHatchWorkflowInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly request: unknown
}
export interface ManageBreedingHatchWorkflowDependencies {
  readonly database?: RotomDatabase
  readonly resolveCurrentCampaignOptions?: () => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
  readonly resolveEffectiveCapabilities?: (input: {
    readonly sourcePokemonSheetSlug: string
    readonly sourcePokemonSheet: CharacterSheet
  }) => EffectiveCapabilitySet
  readonly drawHatchSpecialD100?: () => number
  readonly campaignProjectionKey?: Buffer | string
  readonly realtimeTimestamp?: number
  readonly sheetUpdatedAt?: number
}

const AUTHENTICATION_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-hatch-workflow-authentication-v1' as const,
  roleSource: 'authenticated-http-role' as const,
  playerSource: 'current-selected-Profile' as const,
  gmSource: 'current-campaign-role' as const,
})
const SPECIAL_OPTION_PRESENTATION = Object.freeze({
  'breeding.hatch-special.outcome.campaign-significance': Object.freeze({
    label: 'Campaign significance',
    description: 'Record a distinctive story consequence without an automatic mechanical change.',
  }),
  'breeding.hatch-special.outcome.distinctive-appearance': Object.freeze({
    label: 'Distinctive appearance',
    description: 'Describe a memorable appearance without automatically making the child Shiny.',
  }),
  'breeding.hatch-special.outcome.distinctive-temperament': Object.freeze({
    label: 'Distinctive temperament',
    description: 'Describe a memorable temperament without changing the resolved Nature.',
  }),
})
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const AUTHENTICATION_POLICY_DEFINITION_SHA256 = sha256(AUTHENTICATION_POLICY)
const fail = (status: 400 | 403 | 409, message: string): never => {
  throw new ManageBreedingHatchWorkflowError(status, message)
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
const strictInput = (input: unknown): ManageBreedingHatchWorkflowInput => {
  if (!plainRecord(input)
    || Object.keys(input).sort(compare).join('\0') !== ['playerProfile', 'request', 'role'].sort(compare).join('\0')) {
    return fail(400, 'Hatch workflow request is malformed')
  }
  if (input.role !== 'gm' && input.role !== 'player') return fail(403, 'Hatch workflow requires an authenticated campaign role')
  return input as unknown as ManageBreedingHatchWorkflowInput
}
const strictProfile = (value: unknown): PlayerProfile => {
  if (!plainRecord(value)
    || Object.keys(value).sort(compare).join('\0') !== ['displayName', 'id', 'linkedCharacters', 'schemaVersion'].sort(compare).join('\0')
    || !Array.isArray(value.linkedCharacters)
    || Object.getPrototypeOf(value.linkedCharacters) !== Array.prototype
    || value.linkedCharacters.length > 128
    || Object.getOwnPropertySymbols(value.linkedCharacters).length > 0
    || Object.getOwnPropertyNames(value.linkedCharacters).length !== value.linkedCharacters.length + 1) {
    return fail(400, 'Selected player Profile authority is malformed')
  }
  for (let index = 0; index < value.linkedCharacters.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.linkedCharacters, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor) || !plainRecord(descriptor.value)
      || Object.keys(descriptor.value).sort(compare).join('\0') !== ['sheetKind', 'sheetSlug'].sort(compare).join('\0')) {
      return fail(400, 'Selected player Profile authority is malformed')
    }
  }
  try { return normalizePlayerProfile(value) }
  catch { return fail(400, 'Selected player Profile authority is malformed') }
}
const currentOptions = (dependencies: ManageBreedingHatchWorkflowDependencies): BreedingCampaignOptionSnapshotV1 => {
  if (!dependencies.resolveCurrentCampaignOptions) return DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT
  let value: unknown
  try { value = dependencies.resolveCurrentCampaignOptions() }
  catch { return fail(409, 'Current Breeding campaign options are unavailable') }
  if (promiseLike(value)) return fail(409, 'Current Breeding campaign options must resolve synchronously')
  try { return parseBreedingCampaignOptionSnapshotV1(value) }
  catch { return fail(409, 'Current Breeding campaign options are malformed') }
}
const operationId = (kind: string, material: unknown): `breeding-operation:v1:${string}` => (
  `breeding-operation:v1:${sha256({ kind, material }).slice(0, 32)}`
)
const readSetId = (operation: string): `breeding-read-set:v1:${string}` => (
  `breeding-read-set:v1:${sha256({ kind: 'breeding-hatch-workflow-read-set-v1', operation }).slice(0, 32)}`
)
const originId = (operation: string, eggId: string): `pokemon-breeding-origin:v1:${string}` => (
  `pokemon-breeding-origin:v1:${sha256({ kind: 'breeding-hatch-workflow-origin-v1', operation, eggId }).slice(0, 32)}`
)
const actorKey = (role: AuthRole, profile: PlayerProfile | null): string => role === 'gm' ? 'campaign-gm' : profile!.id
const actorCommandFields = (role: AuthRole, profile: PlayerProfile | null, trainerSheetSlug: string) => ({
  profileId: role === 'gm' ? 'campaign-gm' : profile!.id,
  selectedTrainerSlug: role === 'gm' ? null : trainerSheetSlug,
})
const createActor = (input: {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly command: BreedingOperationCommandV1
  readonly campaignMinute: number
}): BreedingActorAuthorityV1 => createBreedingActorAuthorityV1({
  role: input.role,
  command: input.command,
  authenticatedPrincipalSha256: sha256({
    role: input.role,
    profileId: input.profile?.id ?? null,
    authenticationPolicyDefinitionSha256: AUTHENTICATION_POLICY_DEFINITION_SHA256,
  }),
  authenticationPolicyDefinitionSha256: AUTHENTICATION_POLICY_DEFINITION_SHA256,
  profile: input.profile,
  evaluatedAtCampaignMinute: input.campaignMinute,
})
const systemDependency = (input: {
  readonly providerId: string
  readonly egg: PokemonEggDocumentV1
  readonly checkpoint: 'begin-hatch' | 'hatch-transaction'
  readonly providerDefinitionSha256: string
  readonly effectiveEvidenceSha256: string
}): BreedingDependencyEvidenceV1 => ({
  providerKind: 'system',
  providerId: input.providerId,
  subjectKind: 'pokemon-egg',
  subjectId: input.egg.eggId,
  subjectRevision: input.egg.revision,
  checkpoint: input.checkpoint,
  providerDefinitionSha256: input.providerDefinitionSha256,
  effectiveEvidenceSha256: input.effectiveEvidenceSha256,
})
const dependenciesWithAttestation = (values: readonly BreedingDependencyEvidenceV1[]): readonly BreedingDependencyEvidenceV1[] => {
  const effective = [...values].sort((left, right) => compare(breedingDependencyEvidenceKey(left), breedingDependencyEvidenceKey(right)))
  const attestation: BreedingDependencyEvidenceV1 = {
    providerKind: 'system',
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign',
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization',
    providerDefinitionSha256: sha256('breeding-effective-dependency-set-v1'),
    effectiveEvidenceSha256: sha256(effective),
  }
  return Object.freeze([...effective, attestation].sort((left, right) => compare(
    breedingDependencyEvidenceKey(left), breedingDependencyEvidenceKey(right),
  )))
}
const clockResource = (clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): BreedingReadResourceV1 => ({
  resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present', revision: clock.revision,
  definitionSha256: sha256(clock), observedCampaignMinute: clock.campaignMinute, purposes: ['campaign-time'],
})
const eggResource = (egg: PokemonEggDocumentV1): BreedingReadResourceV1 => ({
  resourceKind: 'pokemon-egg', resourceId: egg.eggId, existence: 'present', revision: egg.revision,
  definitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg), observedCampaignMinute: null,
  purposes: ['conflict', 'mechanics'],
})
const trainerDocument = (value: StoredSheetDocument<Record<string, unknown>>, expectedSlug: string): StoredSheetDocument<Record<string, unknown>> => {
  if (value.kind !== 'trainer' || value.slug !== expectedSlug || !plainRecord(value.document)
    || value.document.slug !== value.slug || value.document.revision !== value.revision
    || value.document.updatedAt !== value.updatedAt || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    return fail(409, 'Current hatch owner Trainer authority is malformed')
  }
  return value
}
const ownerFactAndControl = (input: {
  readonly trainer: StoredSheetDocument<Record<string, unknown>>
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly campaignMinute: number
}) => {
  const fact = createPokemonEggHatchOwnerTrainerFactV1({
    trainerSheetSlug: input.trainer.slug,
    trainerSheetRevision: input.trainer.revision,
    trainerSheetDocument: input.trainer.document,
  })
  const control = input.role === 'gm' ? null : createBreedingTrainerControlEvidenceV1({
    profile: input.profile!,
    trainerSheetSlug: input.trainer.slug,
    trainerSheetRevision: input.trainer.revision,
    trainerSheetDefinitionSha256: fact.trainerSheetDefinitionSha256,
    evaluatedAtCampaignMinute: input.campaignMinute,
  })
  return Object.freeze({ fact, control })
}
const verifyGm = (input: ManageBreedingHatchWorkflowInput, dependencies: ManageBreedingHatchWorkflowDependencies) => (
  (actor: BreedingActorAuthorityV1): boolean => {
    if (input.role !== 'gm') return false
    if (!dependencies.validateCurrentGmAuthority) return true
    let result: unknown
    try { result = dependencies.validateCurrentGmAuthority(actor) }
    catch { return false }
    return !promiseLike(result) && result === true
  }
)
const defaultCapabilityResolver = (input: {
  readonly sourcePokemonSheetSlug: string
  readonly sourcePokemonSheet: CharacterSheet
}): EffectiveCapabilitySet => {
  const placement = {
    id: `breeding-source:${input.sourcePokemonSheetSlug}`,
    sheetKind: 'pokemon' as const,
    sheetSlug: input.sourcePokemonSheetSlug,
    position: { x: 0, y: 0, z: 0 },
  }
  return resolveCapabilityAutomation({
    map: {
      schemaVersion: 2,
      slug: 'breeding-workshop-authority',
      name: 'Breeding Workshop authority',
      dimensions: { width: 1, height: 1, depth: 1 },
      voxels: [],
      placements: [placement],
    } as never,
    placement,
    sheet: input.sourcePokemonSheet,
  })
}
const exactAcceptedReplay = (input: {
  readonly record: BreedingOperationLedgerRecord | null
  readonly request: BreedingHatchWorkflowRequestV1
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly egg: PokemonEggDocumentV1
}): boolean => {
  const record = input.record
  if (!record || record.status !== 'accepted' || !record.result?.ok) return false
  const command = record.command
  if (command.actor.profileId !== (input.role === 'gm' ? 'campaign-gm' : input.profile!.id)
    || command.actor.selectedTrainerSlug !== (input.role === 'gm' ? null : input.request.trainerSheetSlug)) return false
  if (input.request.intent === 'begin') {
    return command.commandKind === 'begin-hatch' && command.payload.eggId === input.egg.eggId
      && input.egg.hatchOperationId === command.operationId
  }
  if (input.request.intent === 'resolve-special') {
    return command.commandKind === 'resolve-hatch-special' && command.payload.eggId === input.egg.eggId
      && command.payload.adjudicationOptionId === input.request.selectedOptionId
      && input.egg.lastOperationId === command.operationId
  }
  if (input.request.intent === 'complete') {
    return command.commandKind === 'complete-hatch' && command.payload.eggId === input.egg.eggId
      && input.egg.status === 'hatched' && input.egg.lastOperationId === command.operationId
  }
  return false
}
const relevantPending = (
  database: RotomDatabase,
  eggId: string,
): BreedingOperationLedgerRecord | null => {
  const records = createSqliteBreedingOperationRepository(database).listPending(100)
    .filter(record => record.command.scopes.some(scope => scope.kind === 'pokemon-egg' && scope.eggId === eggId))
  if (records.length > 1) return fail(409, 'Hatch recovery authority is contradictory')
  return records[0] ?? null
}
const speciesName = (egg: PokemonEggDocumentV1): string => canonicalBreedingSpeciesIdentity(egg.offspring.speciesId)?.sourceName
  ?? fail(409, 'Current Egg Species authority is unavailable')
const natureName = (egg: PokemonEggDocumentV1): string => breedingNature(egg.offspring.nature.valueId)?.label
  ?? fail(409, 'Current Egg Nature authority is unavailable')
const abilityName = (egg: PokemonEggDocumentV1): string => canonicalBreedingAbilityIdentity(egg.offspring.ability.valueId)?.sourceName
  ?? fail(409, 'Current Egg Ability authority is unavailable')

interface WorkflowContext {
  readonly input: ManageBreedingHatchWorkflowInput
  readonly request: BreedingHatchWorkflowRequestV1
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly database: RotomDatabase
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly references: ReturnType<typeof createCurrentBreedingReferenceVersionSnapshotV1>
  readonly clock: ReturnType<ReturnType<typeof createSqliteCampaignClockRepository>['get']>
  readonly trainer: StoredSheetDocument<Record<string, unknown>>
  readonly egg: PokemonEggDocumentV1
  readonly fact: ReturnType<typeof createPokemonEggHatchOwnerTrainerFactV1>
  readonly control: ReturnType<typeof createBreedingTrainerControlEvidenceV1> | null
  readonly dependencies: ManageBreedingHatchWorkflowDependencies
}
const context = (inputValue: ManageBreedingHatchWorkflowInput, dependencies: ManageBreedingHatchWorkflowDependencies): WorkflowContext => {
  const input = strictInput(inputValue)
  let request: BreedingHatchWorkflowRequestV1
  try { request = parseBreedingHatchWorkflowRequestV1(input.request) }
  catch { return fail(400, 'Hatch workflow request is malformed') }
  const profile = input.role === 'player' ? strictProfile(input.playerProfile) : null
  if (input.role === 'player') {
    if (!profile || request.profileId !== profile.id) return fail(403, 'Hatch workflow requires the exact selected player Profile')
    const links = profile.linkedCharacters.filter(link => link.sheetKind === 'trainer' && link.sheetSlug === request.trainerSheetSlug)
    if (links.length !== 1) return fail(403, 'Selected Profile does not control this hatch owner Trainer')
  }
  else if (input.playerProfile !== null || request.profileId !== null) {
    return fail(400, 'GM hatch workflow requests cannot adopt a player Profile')
  }
  const database = dependencies.database ?? getRotomDatabase()
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const trainerValue = sheets.get('trainer', request.trainerSheetSlug)
  if (!trainerValue) return fail(409, 'Current hatch owner Trainer is unavailable')
  const trainer = trainerDocument(trainerValue, request.trainerSheetSlug)
  const egg = createSqlitePokemonEggRepository(database).get(request.eggId)
  if (!egg || egg.ownerTrainerSlug !== trainer.slug) return fail(403, 'Requested Egg is unavailable in this Trainer context')
  const clock = createSqliteCampaignClockRepository(database).get()
  const options = currentOptions(dependencies)
  const references = createCurrentBreedingReferenceVersionSnapshotV1(options)
  if (egg.ruleset.rulesetId !== references.rulesetId || egg.ruleset.definitionSha256 !== references.rulesetDefinitionSha256) {
    return fail(409, 'Current Egg ruleset authority is stale')
  }
  const owner = ownerFactAndControl({ trainer, role: input.role, profile, campaignMinute: clock.campaignMinute })
  return Object.freeze({ input, request, role: input.role, profile, database, options, references, clock, trainer, egg, ...owner, dependencies })
}
const beginOperationId = (ctx: WorkflowContext, expectedRevision = ctx.request.expectedEggRevision) => operationId('breeding-hatch-workflow-begin-v1', {
  actor: actorKey(ctx.role, ctx.profile), eggId: ctx.egg.eggId, eggRevision: expectedRevision,
  trainerSheetSlug: ctx.trainer.slug, destinationKind: 'box',
})
const resolveOperationId = (ctx: WorkflowContext) => operationId('breeding-hatch-workflow-special-resolution-v1', {
  actor: actorKey(ctx.role, ctx.profile), eggId: ctx.egg.eggId, hatchOperationId: ctx.egg.hatchOperationId,
  selectedOptionId: ctx.request.selectedOptionId,
})
const completeOperationId = (ctx: WorkflowContext, expectedRevision = ctx.request.expectedEggRevision) => operationId('breeding-hatch-workflow-completion-v1', {
  actor: actorKey(ctx.role, ctx.profile), eggId: ctx.egg.eggId, hatchOperationId: ctx.egg.hatchOperationId,
  eggRevision: expectedRevision,
})
const expectedActionOperationId = (ctx: WorkflowContext): string | null => ctx.request.intent === 'begin'
  ? beginOperationId(ctx)
  : ctx.request.intent === 'resolve-special'
    ? resolveOperationId(ctx)
    : ctx.request.intent === 'complete'
      ? completeOperationId(ctx)
      : null

const specialProjection = (ctx: WorkflowContext): BreedingHatchWorkflowSpecialV1 => {
  const egg = ctx.egg
  if (egg.special.state === 'not-rolled') return Object.freeze({ state: 'not-rolled', outcomeId: null, gmReview: null })
  const adjudication = egg.hatchOperationId && (egg.special.state === 'pending-adjudication' || egg.special.state === 'resolved')
    ? createSqliteBreedingGmAdjudicationRepository(ctx.database).get(deriveBreedingHatchSpecialAdjudicationIdV1(egg.hatchOperationId, egg.eggId))
    : null
  const offer = egg.hatchOperationId && (egg.special.state === 'pending-adjudication' || egg.special.state === 'resolved')
    ? createSqliteBreedingOptionOfferRepository(ctx.database).get(deriveBreedingHatchSpecialOfferIdV1(egg.hatchOperationId, egg.eggId))
    : null
  let projected
  try {
    projected = projectPokemonEggHatchSpecialV1({
      egg,
      audience: ctx.role === 'gm' ? 'gm' : 'owner',
      adjudication,
      offer,
      generatedAtCampaignMinute: ctx.clock.campaignMinute,
    })
  }
  catch { return fail(409, 'Current hatch-special presentation authority is unavailable') }
  let gmReview: BreedingHatchWorkflowGmReviewV1 | null = null
  if (projected.audience === 'gm' && projected.specialState === 'pending-adjudication') {
    gmReview = Object.freeze({
      rollTotal: projected.rollTotal,
      triggerIds: projected.triggerIds,
      options: Object.freeze(projected.options.map(option => {
        const presentation = SPECIAL_OPTION_PRESENTATION[option.outcomeId]
        return Object.freeze({ optionId: option.optionId, outcomeId: option.outcomeId, ...presentation })
      })),
    })
  }
  return Object.freeze({ state: projected.specialState, outcomeId: projected.outcomeId, gmReview })
}
const childReveal = (ctx: WorkflowContext) => {
  if (ctx.egg.status !== 'hatched' || !ctx.egg.childSheetSlug) return null
  const operation = createSqliteBreedingOperationRepository(ctx.database).get(ctx.egg.lastOperationId)
  if (!operation || operation.status !== 'accepted' || !operation.result?.ok || operation.command.commandKind !== 'complete-hatch'
    || operation.command.payload.eggId !== ctx.egg.eggId || operation.command.payload.destination.trainerSheetSlug !== ctx.trainer.slug) {
    return fail(409, 'Accepted child reveal authority is unavailable')
  }
  const child = createSqliteSheetRepository<Record<string, unknown>>(ctx.database).get('pokemon', ctx.egg.childSheetSlug)
  if (!child || !plainRecord(child.document) || child.document.slug !== child.slug) {
    return fail(409, 'Accepted child sheet is unavailable')
  }
  const rosterField = operation.command.payload.destination.kind === 'team' ? 'currentTeam' : 'boxedPokemon'
  const roster = ctx.trainer.document[rosterField]
  if (!Array.isArray(roster) || roster.filter(value => value === child.slug).length !== 1) {
    return fail(409, 'Accepted child destination linkage is unavailable')
  }
  return Object.freeze({
    childSheetSlug: child.slug,
    speciesName: speciesName(ctx.egg),
    natureName: natureName(ctx.egg),
    abilityName: abilityName(ctx.egg),
    genderId: ctx.egg.offspring.gender.valueId,
    startingLevel: ctx.egg.offspring.startingLevel,
    destinationKind: operation.command.payload.destination.kind,
    hatchedAtCampaignMinute: ctx.egg.updatedAtCampaignMinute,
  })
}
const workflowProjection = (
  ctx: WorkflowContext,
  transition: BreedingHatchWorkflowTransitionKind,
  pending: BreedingOperationLedgerRecord | null = relevantPending(ctx.database, ctx.egg.eggId),
): BreedingHatchWorkflowProjectionV1 => {
  const recovery = pending
    ? { state: 'pending' as const, pendingSinceCampaignMinute: pending.createdAtCampaignMinute }
    : { state: 'none' as const, pendingSinceCampaignMinute: null }
  const stage = recovery.state === 'pending' ? 'recovery' as const
    : ctx.egg.status === 'incubating' ? 'not-ready' as const
      : ctx.egg.status === 'ready' ? 'ready' as const
        : ctx.egg.status === 'awaiting-special-adjudication' ? 'awaiting-gm' as const
          : ctx.egg.status === 'hatching' ? 'ready-to-complete' as const
            : ctx.egg.status === 'hatched' ? 'hatched' as const : 'ended' as const
  const decisionKind = stage === 'ready' ? 'begin-hatch' as const
    : stage === 'awaiting-gm' && ctx.role === 'gm' ? 'resolve-special' as const
      : stage === 'ready-to-complete' ? 'complete-hatch' as const : 'none' as const
  const reasonId = stage === 'recovery' ? 'breeding.hatch.recovery-required' as const
    : stage === 'not-ready' ? 'breeding.hatch.not-ready' as const
      : stage === 'ended' ? 'breeding.hatch.lifecycle-ended' as const
        : stage === 'awaiting-gm' && ctx.role === 'player' ? 'breeding.hatch.awaiting-gm' as const
          : decisionKind === 'none' ? 'breeding.hatch.current-authority-unavailable' as const : null
  return createBreedingHatchWorkflowProjectionV1({
    audience: ctx.role === 'gm' ? 'gm' : 'owner',
    trainerSheetSlug: ctx.trainer.slug,
    stage,
    egg: {
      eggId: ctx.egg.eggId,
      revision: ctx.egg.revision,
      status: ctx.egg.status,
      speciesName: speciesName(ctx.egg),
      updatedAtCampaignMinute: ctx.egg.updatedAtCampaignMinute,
    },
    decision: {
      kind: decisionKind,
      canSubmit: decisionKind !== 'none',
      requiresConfirmation: decisionKind !== 'none',
      reasonId,
    },
    special: specialProjection(ctx),
    childReveal: childReveal(ctx),
    recovery,
    transition,
    generatedAtCampaignMinute: ctx.clock.campaignMinute,
  })
}
const refreshedContext = (ctx: WorkflowContext): WorkflowContext => context(ctx.input, ctx.dependencies)

const beginHatch = (ctx: WorkflowContext): BreedingHatchWorkflowProjectionV1 => {
  if (ctx.egg.status !== 'ready' || ctx.egg.revision !== ctx.request.expectedEggRevision) return fail(409, 'Ready Egg authority changed before hatch')
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: beginOperationId(ctx),
    commandKind: 'begin-hatch',
    actor: actorCommandFields(ctx.role, ctx.profile, ctx.trainer.slug),
    ruleset: ctx.egg.ruleset,
    scopes: [{ kind: 'pokemon-egg', eggId: ctx.egg.eggId, expectedRevision: ctx.egg.revision }],
    payload: {
      eggId: ctx.egg.eggId,
      destination: { kind: 'box', trainerSheetSlug: ctx.trainer.slug },
      requestSpecialRoll: true,
    },
  })
  const actor = createActor({ role: ctx.role, profile: ctx.profile, command, campaignMinute: ctx.clock.campaignMinute })
  let hatchOfferAuthority
  try {
    hatchOfferAuthority = projectPokemonEggHatchOfferV1({
      command,
      egg: ctx.egg,
      ownerTrainerFact: ctx.fact,
      actorAuthority: actor,
      ownerTrainerControl: ctx.control,
      referenceVersions: ctx.references,
      atCampaignMinute: ctx.clock.campaignMinute,
      securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
    })
  }
  catch { return fail(409, 'Current hatch offer is unavailable') }
  if (hatchOfferAuthority.offer.availability.status !== 'available') return fail(409, 'Current hatch offer is unavailable')
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(command.operationId),
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: ctx.clock.campaignMinute,
    resources: [
      clockResource(ctx.clock),
      eggResource(ctx.egg),
      {
        resourceKind: 'trainer-sheet', resourceId: ctx.trainer.slug, existence: 'present', revision: ctx.trainer.revision,
        definitionSha256: ctx.fact.trainerSheetDefinitionSha256, observedCampaignMinute: null,
        purposes: ctx.role === 'gm' ? ['write-destination'] : ['authorization', 'write-destination'],
      },
    ],
    referenceVersions: ctx.references,
    dependencyEvidence: dependenciesWithAttestation([systemDependency({
      providerId: BREEDING_HATCH_SPECIAL_PROVIDER_ID,
      egg: ctx.egg,
      checkpoint: 'begin-hatch',
      providerDefinitionSha256: BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
      effectiveEvidenceSha256: BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
    })]),
    writeExpectations: command.scopes,
  })
  const receipt = authorizeBreedingBeginHatchV1({
    command,
    readSet,
    actorAuthority: actor,
    ownerTrainerControl: ctx.control,
    egg: ctx.egg,
    ownerTrainerFact: ctx.fact,
    hatchOfferAuthority,
    campaignOptionSnapshot: ctx.options,
    currentClock: ctx.clock,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current actor cannot begin this hatch')
  const result = beginPokemonEggHatchSpecial({
    command,
    readSet,
    authorizationReceipt: receipt,
    actorAuthority: actor,
    ownerTrainerControl: ctx.control,
    referenceVersions: ctx.references,
    campaignOptionSnapshot: ctx.options,
    declaration: {
      schemaVersion: 1,
      offerId: hatchOfferAuthority.offer.offerId,
      offerDefinitionSha256: hatchOfferAuthority.offer.offerDefinitionSha256,
      operationId: command.operationId,
    },
    hatchOfferAuthority,
    audience: ctx.role === 'gm' ? 'gm' : 'owner',
  }, {
    database: ctx.database,
    campaignProjectionKey: ctx.dependencies.campaignProjectionKey ?? securityPolicyJson.definitionSha256,
    realtimeTimestamp: ctx.dependencies.realtimeTimestamp ?? Date.now(),
    resolveCurrentReferenceVersions: () => ctx.references,
    ...(ctx.role === 'gm' ? { validateCurrentGmAuthority: verifyGm(ctx.input, ctx.dependencies) } : {}),
    drawHatchSpecialD100: ctx.dependencies.drawHatchSpecialD100 ?? (() => randomInt(1, 101)),
  })
  if (result.execution.record.status !== 'accepted' || !result.egg) return fail(409, 'Hatch start was not accepted')
  const next = refreshedContext(ctx)
  return workflowProjection(next, next.egg.status === 'awaiting-special-adjudication'
    ? 'special-review-required' : 'hatch-started', null)
}

const resolveSpecial = (ctx: WorkflowContext): BreedingHatchWorkflowProjectionV1 => {
  if (ctx.role !== 'gm') return fail(403, 'Hatch-special resolution requires current GM authority')
  if (ctx.egg.status !== 'awaiting-special-adjudication' || ctx.egg.special.state !== 'pending-adjudication'
    || ctx.egg.revision !== ctx.request.expectedEggRevision || !ctx.egg.hatchOperationId || !ctx.request.selectedOptionId) {
    return fail(409, 'Pending hatch-special authority changed before resolution')
  }
  const adjudication = createSqliteBreedingGmAdjudicationRepository(ctx.database).get(
    deriveBreedingHatchSpecialAdjudicationIdV1(ctx.egg.hatchOperationId, ctx.egg.eggId),
  )
  const offer = createSqliteBreedingOptionOfferRepository(ctx.database).get(
    deriveBreedingHatchSpecialOfferIdV1(ctx.egg.hatchOperationId, ctx.egg.eggId),
  )
  if (!adjudication || !offer || !offer.options.some(option => option.optionId === ctx.request.selectedOptionId)) {
    return fail(409, 'Selected hatch-special option is unavailable')
  }
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: resolveOperationId(ctx),
    commandKind: 'resolve-hatch-special',
    actor: actorCommandFields(ctx.role, ctx.profile, ctx.trainer.slug),
    ruleset: ctx.egg.ruleset,
    scopes: [{ kind: 'pokemon-egg', eggId: ctx.egg.eggId, expectedRevision: ctx.egg.revision }],
    payload: { eggId: ctx.egg.eggId, adjudicationOptionId: ctx.request.selectedOptionId },
  })
  const actor = createActor({ role: ctx.role, profile: ctx.profile, command, campaignMinute: ctx.clock.campaignMinute })
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(command.operationId), operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
    capturedAtCampaignMinute: ctx.clock.campaignMinute,
    resources: [
      { resourceKind: 'breeding-adjudication', resourceId: adjudication.adjudicationId, existence: 'present', revision: adjudication.revision, definitionSha256: adjudication.definitionSha256, observedCampaignMinute: null, purposes: ['authorization', 'mechanics'] },
      { resourceKind: 'breeding-offer', resourceId: offer.offerId, existence: 'present', revision: offer.revision, definitionSha256: offer.definitionSha256, observedCampaignMinute: null, purposes: ['authorization', 'mechanics'] },
      clockResource(ctx.clock),
      eggResource(ctx.egg),
    ],
    referenceVersions: ctx.references,
    dependencyEvidence: dependenciesWithAttestation([systemDependency({
      providerId: BREEDING_HATCH_SPECIAL_PROVIDER_ID,
      egg: ctx.egg,
      checkpoint: 'hatch-transaction',
      providerDefinitionSha256: BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
      effectiveEvidenceSha256: BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
    })]),
    writeExpectations: command.scopes,
  })
  const receipt = authorizeBreedingResolveHatchSpecialV1({
    command, readSet, actorAuthority: actor, egg: ctx.egg, adjudication, offer,
    currentClock: ctx.clock, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current GM cannot resolve this hatch-special decision')
  const result = resolvePokemonEggHatchSpecial({
    command, readSet, authorizationReceipt: receipt, actorAuthority: actor,
    referenceVersions: ctx.references, audience: 'gm',
  }, {
    database: ctx.database,
    campaignProjectionKey: ctx.dependencies.campaignProjectionKey ?? securityPolicyJson.definitionSha256,
    realtimeTimestamp: ctx.dependencies.realtimeTimestamp ?? Date.now(),
    resolveCurrentReferenceVersions: () => ctx.references,
    validateCurrentGmAuthority: verifyGm(ctx.input, ctx.dependencies),
  })
  if (result.execution.record.status !== 'accepted' || !result.egg) return fail(409, 'Hatch-special resolution was not accepted')
  return workflowProjection(refreshedContext(ctx), 'special-resolved', null)
}

const normalizedProviderName = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
  .replace(/[’‘]/gu, "'").trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
const marsupialMother = (ctx: WorkflowContext): StoredSheetDocument<Record<string, unknown>> | null => {
  if (!(ctx.egg.offspring.providerTraits.marsupial ?? null)) return null
  const team = Array.isArray(ctx.trainer.document.currentTeam) ? ctx.trainer.document.currentTeam : []
  const boxed = Array.isArray(ctx.trainer.document.boxedPokemon) ? ctx.trainer.document.boxedPokemon : []
  if ([...team, ...boxed].some(value => typeof value !== 'string')) return fail(409, 'Marsupial owner roster is malformed')
  const roster = [...team, ...boxed] as string[]
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(ctx.database)
  const preferredSlugs = ctx.egg.parents
    .filter(parent => parent.roleId === 'female-parent' && parent.speciesId === 'kangaskhan'
      && parent.ownerTrainerSlug === ctx.trainer.slug && roster.includes(parent.pokemonSheetSlug))
    .map(parent => parent.pokemonSheetSlug)
  const candidateSlugs = preferredSlugs.length === 1 ? preferredSlugs : roster
  const candidates = candidateSlugs.flatMap((slug) => {
    const sheet = sheets.get('pokemon', slug)
    if (!sheet || !plainRecord(sheet.document)) return []
    let state
    try { state = parseCapabilityCampaignState((sheet.document as CharacterSheet).capabilityCampaignState) }
    catch { return [] }
    const document = sheet.document as unknown as CharacterSheet
    return document.species === 'Kangaskhan' && Number.isSafeInteger(document.level) && Number(document.level) >= 25
      && !pokemonHasActiveBabyTemplate(document) && state.marsupialPouch === null ? [sheet] : []
  })
  if (candidates.length !== 1) return fail(409, 'Exactly one current eligible Marsupial mother is required to complete this hatch')
  return candidates[0]!
}
const completionAuthority = (ctx: WorkflowContext) => {
  if (ctx.egg.status !== 'hatching' || (ctx.egg.special.state !== 'normal' && ctx.egg.special.state !== 'resolved')
    || ctx.egg.revision !== ctx.request.expectedEggRevision || !ctx.egg.hatchOperationId) {
    return fail(409, 'Hatching Egg authority changed before completion')
  }
  const operations = createSqliteBreedingOperationRepository(ctx.database)
  const begin = operations.get(ctx.egg.hatchOperationId)
  if (!begin || begin.status !== 'accepted' || !begin.result?.ok || begin.command.commandKind !== 'begin-hatch'
    || begin.command.payload.eggId !== ctx.egg.eggId || begin.command.payload.destination.trainerSheetSlug !== ctx.trainer.slug) {
    return fail(409, 'Accepted hatch-start authority is unavailable')
  }
  const destination = begin.command.payload.destination
  const mother = marsupialMother(ctx)
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: completeOperationId(ctx),
    commandKind: 'complete-hatch',
    actor: actorCommandFields(ctx.role, ctx.profile, ctx.trainer.slug),
    ruleset: ctx.egg.ruleset,
    scopes: [
      { kind: 'pokemon-egg', eggId: ctx.egg.eggId, expectedRevision: ctx.egg.revision },
      { kind: 'trainer-sheet', sheetSlug: ctx.trainer.slug, expectedRevision: ctx.trainer.revision, fields: ['experience', 'roster'] },
      ...(mother ? [{ kind: 'pokemon-sheet' as const, sheetSlug: mother.slug, expectedRevision: mother.revision, fields: ['marsupial-pouch'] as const }] : []),
      { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
      { kind: 'species-acquisition', trainerSheetSlug: ctx.trainer.slug, speciesId: ctx.egg.offspring.speciesId },
    ],
    payload: {
      eggId: ctx.egg.eggId,
      originId: originId(completeOperationId(ctx), ctx.egg.eggId),
      destination,
    },
  })
  const actor = createActor({ role: ctx.role, profile: ctx.profile, command, campaignMinute: ctx.clock.campaignMinute })
  const capabilityResolver = ctx.dependencies.resolveEffectiveCapabilities ?? defaultCapabilityResolver
  const providerDependencies: BreedingDependencyEvidenceV1[] = []
  if (mother) {
    const handoff = createBreedingMarsupialHandoffV1({
      sourcePokemonSheet: { slug: mother.slug, revision: mother.revision, document: mother.document },
      capturedAtCampaignMinute: ctx.clock.campaignMinute,
    }, { resolveEffectiveCapabilities: capabilityResolver })
    providerDependencies.push(...handoff.dependencyEvidence)
    const abilities = Array.isArray((mother.document as unknown as CharacterSheet).abilities)
      ? (mother.document as unknown as CharacterSheet).abilities : []
    if (abilities.some(entry => typeof entry?.name === 'string'
      && normalizedProviderName(entry.name) === normalizedProviderName('Parental Bond'))) {
      providerDependencies.push(...createBreedingParentalBondHandoffV1({
        sourcePokemonSheet: { slug: mother.slug, revision: mother.revision, document: mother.document },
        capturedAtCampaignMinute: ctx.clock.campaignMinute,
      }).dependencyEvidence)
    }
  }
  const acquisition = createSqliteTrainerSpeciesAcquisitionRepository(ctx.database).get(ctx.trainer.slug, ctx.egg.offspring.speciesId)
  const resources: BreedingReadResourceV1[] = [
    { resourceKind: 'breeding-operation', resourceId: begin.operationId, existence: 'present', revision: null, definitionSha256: createBreedingOperationCommandHash(begin.command), observedCampaignMinute: null, purposes: ['idempotency'] },
    clockResource(ctx.clock),
    eggResource(ctx.egg),
    ...(mother ? [{ resourceKind: 'pokemon-sheet' as const, resourceId: mother.slug, existence: 'present' as const, revision: mother.revision, definitionSha256: sha256(mother.document), observedCampaignMinute: null, purposes: ['conflict', 'mechanics'] as const }] : []),
    { resourceKind: 'pokemon-sheet-allocation', resourceId: 'pokemon', existence: 'present', revision: 0, definitionSha256: initializedSheetContractJson.definitionSha256, observedCampaignMinute: null, purposes: ['conflict', 'write-destination'] },
    { resourceKind: 'species-acquisition', resourceId: `${ctx.trainer.slug}/${ctx.egg.offspring.speciesId}`, existence: acquisition ? 'present' : 'absent', revision: null, definitionSha256: acquisition?.definitionSha256 ?? null, observedCampaignMinute: null, purposes: ['conflict'] },
    { resourceKind: 'trainer-sheet', resourceId: ctx.trainer.slug, existence: 'present', revision: ctx.trainer.revision, definitionSha256: ctx.fact.trainerSheetDefinitionSha256, observedCampaignMinute: null, purposes: ctx.role === 'gm' ? ['conflict', 'write-destination'] : ['authorization', 'conflict', 'write-destination'] },
  ]
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(command.operationId), operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
    capturedAtCampaignMinute: ctx.clock.campaignMinute,
    resources,
    referenceVersions: ctx.references,
    dependencyEvidence: dependenciesWithAttestation([
      systemDependency({
        providerId: BREEDING_HATCH_COMPLETION_PROVIDER_ID,
        egg: ctx.egg,
        checkpoint: 'hatch-transaction',
        providerDefinitionSha256: BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
        effectiveEvidenceSha256: BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256,
      }),
      ...providerDependencies,
    ]),
    writeExpectations: command.scopes,
  })
  const childPlan = planPokemonEggChildSheetConstructionV1({ egg: ctx.egg, command })
  const receipt = authorizeBreedingCompleteHatchV1({
    command, readSet, actorAuthority: actor, ownerTrainerControl: ctx.control,
    egg: ctx.egg, ownerTrainerFact: ctx.fact, currentClock: ctx.clock,
    beginHatchCommand: begin.command,
    currentSpeciesAcquisitionDefinitionSha256: acquisition?.definitionSha256 ?? null,
    childPlanDefinitionSha256: childPlan.definitionSha256,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current actor cannot complete this hatch')
  return Object.freeze({ command, actor, readSet, childPlan, receipt, capabilityResolver })
}
const completeHatch = (ctx: WorkflowContext): BreedingHatchWorkflowProjectionV1 => {
  const authority = completionAuthority(ctx)
  const timestamp = ctx.dependencies.realtimeTimestamp ?? Date.now()
  const result = completePokemonEggHatch({
    command: authority.command,
    readSet: authority.readSet,
    authorizationReceipt: authority.receipt,
    actorAuthority: authority.actor,
    ownerTrainerControl: ctx.control,
    currentOwnerTrainerControl: ctx.control,
    referenceVersions: ctx.references,
    childPlan: authority.childPlan,
    audience: ctx.role === 'gm' ? 'gm' : 'owner',
  }, {
    database: ctx.database,
    campaignProjectionKey: ctx.dependencies.campaignProjectionKey ?? securityPolicyJson.definitionSha256,
    realtimeTimestamp: timestamp,
    sheetUpdatedAt: ctx.dependencies.sheetUpdatedAt ?? timestamp,
    resolveCurrentReferenceVersions: () => ctx.references,
    ...(ctx.role === 'gm' ? { validateCurrentGmAuthority: verifyGm(ctx.input, ctx.dependencies) } : {}),
    ...(ctx.egg.offspring.providerTraits.marsupial ? { resolveEffectiveCapabilities: authority.capabilityResolver } : {}),
  })
  if (result.execution.record.status !== 'accepted' || !result.egg || !result.projection) {
    return fail(409, 'Hatch completion was not accepted')
  }
  return workflowProjection(refreshedContext(ctx), 'child-revealed', null)
}

/**
 * Rebuilds the exact authenticated Trainer, Egg, campaign time, campaign
 * options, app-owned references, offers, read sets, and receipts for one hatch
 * step. Browser input contains selectors and explicit confirmation only.
 */
export const manageBreedingHatchWorkflow = (
  input: ManageBreedingHatchWorkflowInput,
  dependencies: ManageBreedingHatchWorkflowDependencies = {},
): BreedingHatchWorkflowProjectionV1 => {
  const ctx = context(input, dependencies)
  const pending = relevantPending(ctx.database, ctx.egg.eggId)
  if (pending) return workflowProjection(ctx, 'none', pending)
  if (ctx.request.intent === 'inspect') {
    if (ctx.egg.revision !== ctx.request.expectedEggRevision) return fail(409, 'Egg changed before hatch workflow inspection')
    // Projecting these stages also verifies their current durable authority.
    if (ctx.egg.status === 'ready') {
      const command = parseBreedingOperationCommandV1({
        schemaVersion: 1, operationId: beginOperationId(ctx), commandKind: 'begin-hatch',
        actor: actorCommandFields(ctx.role, ctx.profile, ctx.trainer.slug), ruleset: ctx.egg.ruleset,
        scopes: [{ kind: 'pokemon-egg', eggId: ctx.egg.eggId, expectedRevision: ctx.egg.revision }],
        payload: { eggId: ctx.egg.eggId, destination: { kind: 'box', trainerSheetSlug: ctx.trainer.slug }, requestSpecialRoll: true },
      })
      const actor = createActor({ role: ctx.role, profile: ctx.profile, command, campaignMinute: ctx.clock.campaignMinute })
      try {
        const authority = projectPokemonEggHatchOfferV1({ command, egg: ctx.egg, ownerTrainerFact: ctx.fact,
          actorAuthority: actor, ownerTrainerControl: ctx.control, referenceVersions: ctx.references,
          atCampaignMinute: ctx.clock.campaignMinute, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })
        if (authority.offer.availability.status !== 'available') return fail(409, 'Current hatch offer is unavailable')
      }
      catch { return fail(409, 'Current hatch offer is unavailable') }
    }
    else if (ctx.egg.status === 'hatching') completionAuthority(ctx)
    return workflowProjection(ctx, 'none', null)
  }

  const expectedId = expectedActionOperationId(ctx)
  const existing = expectedId ? createSqliteBreedingOperationRepository(ctx.database).get(expectedId) : null
  if (ctx.egg.revision !== ctx.request.expectedEggRevision) {
    if (exactAcceptedReplay({ record: existing, request: ctx.request, role: ctx.role, profile: ctx.profile, egg: ctx.egg })) {
      return workflowProjection(ctx, 'exact-replay', null)
    }
    return fail(409, 'Egg changed before the confirmed hatch action')
  }
  if (ctx.request.intent === 'begin') return beginHatch(ctx)
  if (ctx.request.intent === 'resolve-special') return resolveSpecial(ctx)
  return completeHatch(ctx)
}
