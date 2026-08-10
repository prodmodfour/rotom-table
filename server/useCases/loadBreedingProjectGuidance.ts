import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { AuthRole } from '#shared/auth'
import { BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS } from '#shared/breeding/breederEdgeHandoff'
import {
  BREEDING_PROJECT_GUIDANCE_CUSTOM_REASON_IDS,
  type BreedingProjectGuidanceCustomReasonId,
  type BreedingProjectGuidanceProjectionV1,
  type BreedingProjectGuidanceReasonId,
  type BreedingProjectGuidanceSourceContributionV1,
} from '#shared/breeding/projectGuidance'
import {
  createBreedingTrainerControlEvidenceV1,
  type BreedingActorAuthorityV1,
} from '../domain/breeding/authorization'
import {
  BreedingBreederEdgeHandoffAuthorityError,
  parseAuthoritativeBreedingBreederEdgeHandoffV1,
} from '../domain/breeding/breederEdgeHandoff'
import {
  parseAuthoritativeBreedingFeatureProviderHandoffV1,
} from '../domain/breeding/featureProviderHandoff'
import { createBreedingProjectGuidanceProjectionV1 } from '../domain/breeding/projectGuidance'
import {
  ResolveCurrentBreedingBreederEdgeHandoffError,
  resolveCurrentBreedingBreederEdgeHandoff,
} from './resolveBreedingBreederEdgeHandoff'
import {
  ResolveCurrentBreedingFeatureProviderHandoffError,
  resolveCurrentBreedingFeatureProviderHandoff,
} from './resolveBreedingFeatureProviderHandoff'
import {
  loadBreedingProjectWizardAuthority,
  type LoadBreedingProjectWizardDependencies,
} from './loadBreedingProjectWizard'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadBreedingProjectGuidanceError extends UseCaseHttpError<400 | 403 | 409> {}

export interface LoadBreedingProjectGuidanceInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly request: unknown
}
export interface LoadBreedingProjectGuidanceDependencies extends LoadBreedingProjectWizardDependencies {
  readonly resolveCurrentFeatureProviderHandoff?: typeof resolveCurrentBreedingFeatureProviderHandoff
  readonly resolveCurrentBreederEdgeHandoff?: typeof resolveCurrentBreedingBreederEdgeHandoff
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}

const CUSTOM_REASONS = new Set<string>(BREEDING_PROJECT_GUIDANCE_CUSTOM_REASON_IDS)
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const sourceReason = (error: unknown): BreedingProjectGuidanceCustomReasonId => {
  const code = error instanceof BreedingBreederEdgeHandoffAuthorityError
    || error instanceof ResolveCurrentBreedingBreederEdgeHandoffError
    ? error.code
    : error instanceof ResolveCurrentBreedingFeatureProviderHandoffError
      ? error.code
      : ''
  if (code.includes('ambiguous')) return 'breeding.project-guidance.breeder-edge-ambiguous'
  if (code.includes('prerequisite-not-met')) {
    return 'breeding.project-guidance.breeder-prerequisite-not-met'
  }
  if (code.includes('edge-unavailable') || code.endsWith('.unavailable')) {
    return 'breeding.project-guidance.breeder-edge-unavailable'
  }
  return 'breeding.project-guidance.breeder-provider-unavailable'
}
const unavailableBreeder = (
  reasonId: BreedingProjectGuidanceCustomReasonId,
): BreedingProjectGuidanceSourceContributionV1 => Object.freeze({
  sourceKind: 'trainer-edge',
  sourceCanonicalId: 'Breeder',
  status: 'unavailable',
  contributionIds: BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
  skillApplication: null,
  reasonId,
})
const gmVerifier = (
  inputRole: AuthRole,
  dependency: LoadBreedingProjectGuidanceDependencies['validateCurrentGmAuthority'],
): ((actor: BreedingActorAuthorityV1) => boolean) => dependency ?? ((actor) => (
  inputRole === 'gm' && actor.role === 'gm'
))

/**
 * Adds safe explanations, current source status, and GM-only bounded
 * diagnostics to one current BR-071 wizard projection. It does not create
 * read sets, offers, consent, adjudications, rolls, Projects, or Eggs.
 */
export const loadBreedingProjectGuidance = (
  input: LoadBreedingProjectGuidanceInput,
  dependencies: LoadBreedingProjectGuidanceDependencies = {},
): BreedingProjectGuidanceProjectionV1 => {
  const authority = loadBreedingProjectWizardAuthority(input, dependencies)
  const { projection: wizard, request, actorAuthority: actor } = authority
  const trainer = authority.sheetRepository.get('trainer', request.breederTrainerSlug)
  if (!trainer || trainer.revision !== wizard.breeder.trainerRevision) {
    throw new LoadBreedingProjectGuidanceError(409, 'Current Breeder Trainer authority changed during guidance')
  }
  const trainerControl = input.role === 'player' && authority.playerProfile
    ? createBreedingTrainerControlEvidenceV1({
        profile: authority.playerProfile,
        trainerSheetSlug: trainer.slug,
        trainerSheetRevision: trainer.revision,
        trainerSheetDefinitionSha256: sha256(trainer.document),
        evaluatedAtCampaignMinute: wizard.generatedAtCampaignMinute,
      })
    : null
  const currentGmVerifier = gmVerifier(input.role, dependencies.validateCurrentGmAuthority)
  const sharedResolverOptions = input.role === 'gm'
    ? { database: authority.database, validateCurrentGmAuthority: currentGmVerifier }
    : { database: authority.database }

  const sourceContributions: BreedingProjectGuidanceSourceContributionV1[] = []
  let featureHandoff: ReturnType<typeof parseAuthoritativeBreedingFeatureProviderHandoffV1> | null = null
  let featureFailure: unknown = null
  try {
    const resolved = (dependencies.resolveCurrentFeatureProviderHandoff
      ?? resolveCurrentBreedingFeatureProviderHandoff)({
      trainerSheetSlug: trainer.slug,
      expectedTrainerSheetRevision: trainer.revision,
      checkpoint: 'project-creation',
      actorAuthority: actor,
      trainerControl,
      facilityClaims: [],
    }, sharedResolverOptions)
    if (promiseLike(resolved)) throw new Error('Feature provider resolution must be synchronous.')
    featureHandoff = parseAuthoritativeBreedingFeatureProviderHandoffV1(resolved)
  }
  catch (error) { featureFailure = error }

  const dilettante = featureHandoff?.contributions.filter(contribution => (
    contribution.providerCanonicalId === 'Dilettante'
    && contribution.contributionIds.includes('effective-breeder-edge-grant')
  )) ?? []
  if (featureFailure) {
    sourceContributions.push(unavailableBreeder(sourceReason(featureFailure)))
  }
  else if (dilettante.length > 1) {
    sourceContributions.push(unavailableBreeder('breeding.project-guidance.breeder-edge-ambiguous'))
  }
  else if (dilettante.length === 1) {
    sourceContributions.push(Object.freeze({
      sourceKind: 'trainer-edge',
      sourceCanonicalId: 'Breeder',
      status: 'choice-required',
      contributionIds: BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
      skillApplication: null,
      reasonId: 'breeding.project-guidance.dilettante-choice-required',
    }))
    sourceContributions.push(Object.freeze({
      sourceKind: 'trainer-feature',
      sourceCanonicalId: 'Dilettante',
      status: 'active',
      contributionIds: Object.freeze(['effective-breeder-edge-grant']),
      skillApplication: null,
      reasonId: null,
    }))
  }
  else {
    try {
      const resolved = (dependencies.resolveCurrentBreederEdgeHandoff
        ?? resolveCurrentBreedingBreederEdgeHandoff)({
        breederTrainerSlug: trainer.slug,
        expectedTrainerSheetRevision: trainer.revision,
        checkpoint: 'project-preview',
        actorAuthority: actor,
        breederTrainerControl: trainerControl,
      }, sharedResolverOptions)
      if (promiseLike(resolved)) throw new Error('Breeder Edge resolution must be synchronous.')
      const handoff = parseAuthoritativeBreedingBreederEdgeHandoffV1(resolved)
      sourceContributions.push(Object.freeze({
        sourceKind: 'trainer-edge',
        sourceCanonicalId: 'Breeder',
        status: 'active',
        contributionIds: BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
        skillApplication: Object.freeze({
          skillId: handoff.skillApplication.mandatedSkillId,
          rank: handoff.skillApplication.rank,
          skillTotal: handoff.skillApplication.skillTotal,
        }),
        reasonId: null,
      }))
    }
    catch (error) { sourceContributions.push(unavailableBreeder(sourceReason(error))) }
  }
  sourceContributions.sort((left, right) => {
    const leftKey = `${left.sourceKind}\u0000${left.sourceCanonicalId}`
    const rightKey = `${right.sourceKind}\u0000${right.sourceCanonicalId}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })

  const reasons = new Set<BreedingProjectGuidanceReasonId>()
  for (const source of sourceContributions) if (source.reasonId) reasons.add(source.reasonId)
  const selected = wizard.parentDiscovery.selectedParentRefs
  const preview = wizard.parentDiscovery.compatibilityPreview
  if (selected.length !== 2) reasons.add('breeding.project-guidance.parent-selection-incomplete')
  else if (preview?.status === 'unavailable') preview.reasonIds.forEach(reason => reasons.add(reason))
  else reasons.add('breeding.project-guidance.pair-requires-final-validation')
  if (wizard.consentStatus === 'review-required') {
    reasons.add('breeding.project-guidance.consent-review-required')
  }
  if (selected.length === 2
    && authority.campaignOptions.values['breeding.maturity-policy'] === 'gm-confirmed-per-parent') {
    reasons.add('breeding.project-guidance.maturity-confirmation-required')
  }
  const applicableReasonIds = [...reasons].sort()
  if (applicableReasonIds.some(reason => !CUSTOM_REASONS.has(reason)
    && !wizard.parentDiscovery.compatibilityPreview?.reasonIds.includes(reason as never))) {
    throw new LoadBreedingProjectGuidanceError(409, 'Project guidance reason authority is inconsistent')
  }

  const candidates = wizard.parentDiscovery.trainerSheets.flatMap(row => row.candidates)
  const selectedCandidates = new Map(candidates.map(candidate => [candidate.parentSheetSlug, candidate]))
  const ownerSlugs = selected.map(ref => selectedCandidates.get(ref.pokemonSheetSlug)?.ownerTrainerSlug)
  const ownershipTopology = selected.length !== 2
    ? 'incomplete' as const
    : ownerSlugs.every(owner => owner === wizard.destination.trainerSheetSlug)
      ? 'same-owner' as const
      : 'cross-owner' as const
  const breederSource = sourceContributions.find(source => source.sourceCanonicalId === 'Breeder')!
  const compatibilityPreviewStatus = preview?.status ?? 'not-evaluated'
  const maturityPolicy = authority.campaignOptions.values['breeding.maturity-policy']
  const gmDiagnostics = wizard.audience === 'gm' ? Object.freeze({
    candidateCount: candidates.length,
    selectableCandidateCount: candidates.filter(candidate => candidate.availability.status === 'selectable').length,
    unavailableCandidateCount: candidates.filter(candidate => candidate.availability.status === 'unavailable').length,
    selectedParentCount: selected.length,
    ownershipTopology,
    breederAuthorityStatus: breederSource.status,
    maturityPolicy,
    minimumMaturityLevel: maturityPolicy === 'minimum-level'
      ? authority.campaignOptions.values['breeding.minimum-maturity-level']
      : null,
    consentStatus: wizard.consentStatus,
    compatibilityPreviewStatus,
    locationPolicyId: 'campaign-workshop-off-map-v1' as const,
    facilityRegistryState: 'empty-no-authority' as const,
    finalValidationStatus: 'required-before-creation' as const,
  }) : null

  return createBreedingProjectGuidanceProjectionV1({
    wizard,
    applicableReasonIds,
    sourceContributions,
    gmDiagnostics,
  })
}
