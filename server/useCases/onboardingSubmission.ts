import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import { canOwnerEditDraftContent } from '#shared/onboarding/lifecycle'
import { validateOnboardingPackage } from '#shared/onboarding/validate'
import type { OnboardingValidationSummary } from '#shared/onboarding/validation'
import {
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
  type OnboardingRepository,
} from '../storage/onboardingRepository'
import {
  publishOnboardingDraftChanged,
  publishOnboardingSlotChanged,
} from '../realtime/onboardingRealtime'
import { OnboardingUseCaseError } from './onboardingWorkflows'

export interface SubmitOnboardingDraftInput {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly draftId: unknown
  readonly expectedRevision: number
  readonly operationId: string
}

export interface SubmitOnboardingDraftResult {
  readonly ok: true
  readonly submissionRevision: number
  readonly draftRevision: number
  readonly state: 'submitted'
  readonly validation: OnboardingValidationSummary
}

export interface OnboardingSubmissionDependencies {
  readonly repository?: OnboardingRepository
  readonly now?: () => number
  readonly publishSlotChanged?: typeof publishOnboardingSlotChanged
  readonly publishDraftChanged?: typeof publishOnboardingDraftChanged
}

export const submitOnboardingDraftUseCase = (
  input: SubmitOnboardingDraftInput,
  dependencies: OnboardingSubmissionDependencies = {},
): SubmitOnboardingDraftResult => {
  const repository = dependencies.repository ?? createSqliteOnboardingRepository()

  const stored = (() => {
    try {
      return repository.getDraft(input.draftId)
    } catch {
      throw new OnboardingUseCaseError(400, 'draftId is invalid')
    }
  })()
  if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')

  const isOwner = input.role === 'player' && input.profile?.id === stored.draft.profileId
  if (!isOwner) {
    // GM submits nothing on a player's behalf; unrelated players see nothing.
    throw new OnboardingUseCaseError(input.role === 'gm' ? 403 : 404, input.role === 'gm'
      ? 'Submission belongs to the owning player'
      : 'Draft not found')
  }

  const payload = { draftId: stored.draft.draftId, expectedRevision: input.expectedRevision }
  const payloadHash = onboardingPayloadHash(payload)
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash === payloadHash) return existing.result as unknown as SubmitOnboardingDraftResult
    throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
  }

  if (!canOwnerEditDraftContent(stored.state)) {
    throw new OnboardingUseCaseError(409, `Draft is ${stored.state}; submit from draft or changes-requested`)
  }
  if (stored.revision !== input.expectedRevision) {
    throw new OnboardingUseCaseError(409, `Draft is at revision ${stored.revision}, not ${input.expectedRevision}`)
  }

  const policy = repository.getPolicy(stored.draft.policyId, stored.draft.policyVersion)
  if (!policy) throw new OnboardingUseCaseError(409, 'The policy version this draft is bound to is unavailable')

  const catalog = onboardingCreationCatalog()
  const validation = validateOnboardingPackage(
    {
      trainerBuild: stored.draft.trainerBuild,
      pokemonBuilds: stored.draft.pokemonBuilds,
      deferredDecisions: stored.draft.deferredDecisions,
    },
    policy.content,
    catalog,
    { draftCatalogFingerprint: stored.draft.catalogFingerprint, profileBound: true },
  )
  if (!validation.submittable) {
    throw new OnboardingUseCaseError(422, `Submission blocked by ${validation.blockingCount} issue(s); resolve them and try again`)
  }

  const result = repository.database.withTransaction((): SubmitOnboardingDraftResult => {
    const transitioned = repository.transitionDraft({
      draftId: stored.draft.draftId,
      expectedRevision: input.expectedRevision,
      to: 'submitted',
      actor: 'owner-player',
      now: dependencies.now?.(),
    })
    repository.createSubmission({
      draftId: stored.draft.draftId,
      submissionRevision: transitioned.draft.submissionRevision,
      snapshot: transitioned.draft,
      validation,
      policyContentHash: policy.identity.contentHash,
      catalogFingerprint: catalog.catalogFingerprint,
      now: dependencies.now?.(),
    })
    const submitResult: SubmitOnboardingDraftResult = {
      ok: true,
      submissionRevision: transitioned.draft.submissionRevision,
      draftRevision: transitioned.revision,
      state: 'submitted',
      validation,
    }
    repository.recordOperation({
      opId: input.operationId,
      scope: 'submit',
      payloadHash,
      result: submitResult as unknown as Record<string, unknown>,
      now: dependencies.now?.(),
    })
    return submitResult
  })

  const slot = repository.getSlot(stored.draft.slotId)
  if (slot) {
    ;(dependencies.publishSlotChanged ?? publishOnboardingSlotChanged)({
      schemaVersion: 1,
      slotId: slot.slotId,
      profileId: slot.profileId,
      state: 'submitted',
      policyVersion: slot.policyVersion,
      updatedAt: dependencies.now?.() ?? Date.now(),
    })
  }
  ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(stored.draft.profileId, {
    schemaVersion: 1,
    draftId: stored.draft.draftId,
    slotId: stored.draft.slotId,
    revision: result.draftRevision,
    state: 'submitted',
    updatedAt: dependencies.now?.() ?? Date.now(),
    clientId: null,
  })
  return result
}
