import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1 } from '#shared/breeding/authorization'
import type { BreedingBreederEdgeHandoffV1 } from '#shared/breeding/breederEdgeHandoff'
import type { BreedingFeatureProviderContributionEvidenceV1, BreedingFeatureProviderHandoffV1 } from '#shared/breeding/featureProviderHandoff'
import { isSlug } from '#shared/paths'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  createBreedingFeatureProviderHandoffV1,
  type BreedingFeatureProviderHandoffDependencies,
} from '../domain/breeding/featureProviderHandoff'
import { resolveEffectiveEdges } from '../domain/edgeAutomation/effectiveEdges'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import {
  resolveCurrentBreedingBreederEdgeHandoff,
  type ResolveCurrentBreedingBreederEdgeHandoffInputV1,
  type ResolveCurrentBreedingBreederEdgeHandoffOptions,
} from './resolveBreedingBreederEdgeHandoff'

export interface ResolveCurrentBreedingFeatureProviderHandoffInputV1 {
  readonly trainerSheetSlug: unknown
  readonly expectedTrainerSheetRevision: unknown
  readonly checkpoint: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly facilityClaims: unknown
}
export interface ResolveCurrentBreedingFeatureProviderHandoffOptions extends BreedingFeatureProviderHandoffDependencies {
  readonly database?: RotomDatabase
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}
export interface ResolveCurrentFeatureGrantedBreederHandoffResultV1 {
  readonly featureHandoff: BreedingFeatureProviderHandoffV1
  readonly breederHandoff: BreedingBreederEdgeHandoffV1
}
export interface ResolveCurrentFeatureGrantedBreederHandoffOptions
  extends ResolveCurrentBreedingFeatureProviderHandoffOptions,
  Omit<ResolveCurrentBreedingBreederEdgeHandoffOptions, 'database' | 'validateCurrentGmAuthority' | 'validateFeatureGrantedBreeder'> {
  /** Server-owned resolution of a command-bound Dilettante choice; raw client labels never reach this callback. */
  readonly selectDilettanteMandatedSkill?: (input: {
    readonly handoff: BreedingFeatureProviderHandoffV1
    readonly contribution: BreedingFeatureProviderContributionEvidenceV1
  }) => 'generalEd' | 'perception'
}

export type ResolveCurrentBreedingFeatureProviderHandoffErrorCode =
  | 'breeding.feature-provider-handoff-use-case.invalid-request'
  | 'breeding.feature-provider-handoff-use-case.invalid-authority'
  | 'breeding.feature-provider-handoff-use-case.stale-authority'
  | 'breeding.feature-provider-handoff-use-case.unavailable'
export class ResolveCurrentBreedingFeatureProviderHandoffError extends Error {
  readonly code: ResolveCurrentBreedingFeatureProviderHandoffErrorCode
  constructor(code: ResolveCurrentBreedingFeatureProviderHandoffErrorCode, message: string) {
    super(message)
    this.name = 'ResolveCurrentBreedingFeatureProviderHandoffError'
    this.code = code
  }
}
const fail = (code: ResolveCurrentBreedingFeatureProviderHandoffErrorCode, message: string): never => { throw new ResolveCurrentBreedingFeatureProviderHandoffError(code, message) }
const promiseLike = (value: unknown): value is PromiseLike<unknown> => ((typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function')
const exact = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.feature-provider-handoff-use-case.invalid-request', 'Feature provider handoff request must be a plain exact object.')
  const row = value as Record<string, unknown>; const fields = ['trainerSheetSlug','expectedTrainerSheetRevision','checkpoint','actorAuthority','trainerControl','facilityClaims']; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.feature-provider-handoff-use-case.invalid-request', 'Feature provider handoff request must contain exactly the declared fields.')
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.feature-provider-handoff-use-case.invalid-request', `Feature provider handoff request ${field} must be an enumerable data field.`) }
  return row
}

export const resolveCurrentBreedingFeatureProviderHandoff = (
  inputValue: ResolveCurrentBreedingFeatureProviderHandoffInputV1,
  options: ResolveCurrentBreedingFeatureProviderHandoffOptions = {},
): BreedingFeatureProviderHandoffV1 => {
  const input = exact(inputValue)
  if (!isSlug(input.trainerSheetSlug) || (input.trainerSheetSlug as string).length > 160 || !Number.isSafeInteger(input.expectedTrainerSheetRevision) || (input.expectedTrainerSheetRevision as number) < 0 || (input.expectedTrainerSheetRevision as number) > 2_147_483_647) return fail('breeding.feature-provider-handoff-use-case.invalid-request', 'Feature provider Trainer identity and expected revision must be canonical bounded values.')
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const database = options.database ?? getRotomDatabase()
  const clockRepository = createSqliteCampaignClockRepository(database)
  const sheetRepository = createSqliteSheetRepository(database)
  const clock = clockRepository.get()
  if (actor.evaluatedAtCampaignMinute !== clock.campaignMinute) return fail('breeding.feature-provider-handoff-use-case.stale-authority', 'Actor authority must use the exact current campaign minute.')
  let accessMode: 'profile-control' | 'gm-authority'
  let accessEvidenceDefinitionSha256: string
  if (actor.role === 'gm') {
    if (input.trainerControl !== null || typeof options.validateCurrentGmAuthority !== 'function') return fail('breeding.feature-provider-handoff-use-case.invalid-authority', 'GM Feature authority requires a current server verifier and rejects Profile control evidence.')
    let verified: unknown
    try { verified = options.validateCurrentGmAuthority(actor) }
    catch { return fail('breeding.feature-provider-handoff-use-case.invalid-authority', 'Current GM verification failed closed.') }
    if (promiseLike(verified) || verified !== true) return fail('breeding.feature-provider-handoff-use-case.invalid-authority', 'Current authenticated GM authority is required.')
    accessMode = 'gm-authority'; accessEvidenceDefinitionSha256 = actor.definitionSha256
  }
  else {
    if (options.validateCurrentGmAuthority !== undefined || input.trainerControl === null) return fail('breeding.feature-provider-handoff-use-case.invalid-authority', 'Player Feature authority requires Profile control and rejects GM verification callbacks.')
    const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
    if (actor.authenticatedProfileId === null || control.profileId !== actor.authenticatedProfileId || control.profileDefinitionSha256 !== actor.profileDefinitionSha256 || control.trainerSheetSlug !== input.trainerSheetSlug || control.evaluatedAtCampaignMinute !== clock.campaignMinute) return fail('breeding.feature-provider-handoff-use-case.invalid-authority', 'Feature provider Trainer control must match the current authenticated Profile and campaign minute.')
    accessMode = 'profile-control'; accessEvidenceDefinitionSha256 = control.definitionSha256
  }
  const trainer = sheetRepository.get('trainer', input.trainerSheetSlug as string)
  if (!trainer) return fail('breeding.feature-provider-handoff-use-case.unavailable', 'The current Feature provider Trainer is unavailable.')
  if (trainer.revision !== input.expectedTrainerSheetRevision) return fail('breeding.feature-provider-handoff-use-case.stale-authority', 'The Feature provider Trainer revision changed before handoff resolution.')
  const handoff = createBreedingFeatureProviderHandoffV1({
    trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
    accessMode,
    accessEvidenceDefinitionSha256,
    checkpoint: input.checkpoint,
    capturedAtCampaignMinute: clock.campaignMinute,
    facilityClaims: input.facilityClaims,
  }, {
    ...(options.resolveEffectiveFeatures ? { resolveEffectiveFeatures: options.resolveEffectiveFeatures } : {}),
    ...(options.featureSuppressions ? { featureSuppressions: options.featureSuppressions } : {}),
    ...(options.resolveTrainerSkills ? { resolveTrainerSkills: options.resolveTrainerSkills } : {}),
  })
  if (actor.role === 'player') {
    const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
    if (control.trainerSheetRevision !== handoff.trainerSheetRevision || control.trainerSheetDefinitionSha256 !== handoff.trainerSheetDefinitionSha256 || control.definitionSha256 !== handoff.accessEvidenceDefinitionSha256) return fail('breeding.feature-provider-handoff-use-case.stale-authority', 'Profile control does not bind the exact current Feature provider Trainer document.')
  }
  const currentClock = clockRepository.get(); const currentTrainer = sheetRepository.get('trainer', trainer.slug)
  if (currentClock.revision !== clock.revision || currentClock.campaignMinute !== clock.campaignMinute || !currentTrainer || currentTrainer.revision !== trainer.revision || stableJsonStringify(currentTrainer.document) !== stableJsonStringify(trainer.document)) return fail('breeding.feature-provider-handoff-use-case.stale-authority', 'Feature provider Trainer or campaign clock changed during handoff resolution.')
  return handoff
}

export const resolveCurrentFeatureGrantedBreederHandoff = (
  input: ResolveCurrentBreedingBreederEdgeHandoffInputV1,
  options: ResolveCurrentFeatureGrantedBreederHandoffOptions = {},
): ResolveCurrentFeatureGrantedBreederHandoffResultV1 => {
  const database = options.database ?? getRotomDatabase()
  const featureHandoff = resolveCurrentBreedingFeatureProviderHandoff({
    trainerSheetSlug: input.breederTrainerSlug,
    expectedTrainerSheetRevision: input.expectedTrainerSheetRevision,
    checkpoint: 'project-creation',
    actorAuthority: input.actorAuthority,
    trainerControl: input.breederTrainerControl,
    facilityClaims: [],
  }, {
    database,
    ...(options.validateCurrentGmAuthority ? { validateCurrentGmAuthority: options.validateCurrentGmAuthority } : {}),
    ...(options.resolveEffectiveFeatures ? { resolveEffectiveFeatures: options.resolveEffectiveFeatures } : {}),
    ...(options.featureSuppressions ? { featureSuppressions: options.featureSuppressions } : {}),
    ...(options.resolveTrainerSkills ? { resolveTrainerSkills: options.resolveTrainerSkills } : {}),
  })
  const grants = featureHandoff.contributions.filter(contribution => contribution.providerCanonicalId === 'Dilettante' && contribution.contributionIds.includes('effective-breeder-edge-grant'))
  if (grants.length !== 1 || typeof options.selectDilettanteMandatedSkill !== 'function') return fail('breeding.feature-provider-handoff-use-case.unavailable', 'Feature-granted Breeder authority requires one current Dilettante contribution and a server-owned mandated-Skill choice.')
  let selectedSkill: unknown
  try { selectedSkill = options.selectDilettanteMandatedSkill({ handoff: featureHandoff, contribution: grants[0]! }) }
  catch { return fail('breeding.feature-provider-handoff-use-case.unavailable', 'Dilettante mandated-Skill choice resolution failed closed.') }
  if (promiseLike(selectedSkill) || (selectedSkill !== 'generalEd' && selectedSkill !== 'perception')) return fail('breeding.feature-provider-handoff-use-case.unavailable', 'Dilettante mandated-Skill choice must synchronously resolve to General Education or Perception.')
  const breederHandoff = resolveCurrentBreedingBreederEdgeHandoff(input, {
    database,
    ...(options.validateCurrentGmAuthority ? { validateCurrentGmAuthority: options.validateCurrentGmAuthority } : {}),
    ...(options.resolveTrainerSkills ? { resolveTrainerSkills: options.resolveTrainerSkills } : {}),
    ...(options.planTrainerEdgeCampaignOperation ? { planTrainerEdgeCampaignOperation: options.planTrainerEdgeCampaignOperation } : {}),
    resolveEffectiveEdges: options.resolveEffectiveEdges ?? (edgeInput => resolveEffectiveEdges({ ...edgeInput, featureSuppressions: options.featureSuppressions })),
    validateFeatureGrantedBreeder: proof => {
      const grant = grants.find(entry => entry.providerInstanceId === proof.sourceFeatureInstanceId && entry.trainerSheetSlug === proof.trainerSheetSlug && entry.trainerSheetRevision === proof.trainerSheetRevision && entry.capturedAtCampaignMinute === proof.evaluatedAtCampaignMinute)
      return { sourceFeatureContributionDefinitionSha256: grant?.definitionSha256 ?? '', selectedSkillKey: selectedSkill }
    },
  })
  return Object.freeze({ featureHandoff, breederHandoff })
}
