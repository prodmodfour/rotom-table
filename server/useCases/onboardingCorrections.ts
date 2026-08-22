import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import { parseOnboardingDraft, type OnboardingDraftV1 } from '#shared/onboarding/draft'
import { validateOnboardingPackage } from '#shared/onboarding/validate'
import {
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
  type OnboardingRepository,
  type OnboardingReviewEntryRecord,
} from '../storage/onboardingRepository'
import {
  publishOnboardingDraftChanged,
  publishOnboardingSlotChanged,
} from '../realtime/onboardingRealtime'
import { OnboardingUseCaseError } from './onboardingWorkflows'

/**
 * Bounded GM corrections (P9-055).
 *
 * A correction is an explicit, receipt-backed GM edit to a submitted package,
 * limited to reviewed presentation scopes. It runs the same canonical
 * validators (it may never introduce blocking issues), produces a NEW
 * immutable submission revision, and is always visible to the player. When
 * acknowledgement is required, approval stays blocked until the owner
 * acknowledges the correction.
 */

export const ONBOARDING_CORRECTION_SCOPES = Object.freeze([
  'trainer-name',
  'trainer-identity-text',
  'pokemon-nickname',
] as const)
export type OnboardingCorrectionScope = typeof ONBOARDING_CORRECTION_SCOPES[number]

export interface OnboardingCorrectionInput {
  readonly role: AuthRole
  readonly draftId: unknown
  readonly submissionRevision: number
  readonly scope: OnboardingCorrectionScope
  /** starter index for pokemon scopes. */
  readonly buildIndex?: number
  readonly value: string | null
  readonly rationale: string
  readonly requiresAcknowledgement: boolean
  readonly operationId: string
}

export interface OnboardingCorrectionDependencies {
  readonly repository?: OnboardingRepository
  readonly now?: () => number
  readonly publishSlotChanged?: typeof publishOnboardingSlotChanged
  readonly publishDraftChanged?: typeof publishOnboardingDraftChanged
}

const repositoryOf = (dependencies: OnboardingCorrectionDependencies): OnboardingRepository =>
  dependencies.repository ?? createSqliteOnboardingRepository()

const boundedText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new OnboardingUseCaseError(400, `${label} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value.trim()
}

const applyCorrectionScope = (
  draft: OnboardingDraftV1,
  input: OnboardingCorrectionInput,
): { corrected: OnboardingDraftV1, before: string | null, after: string | null } => {
  if (input.scope === 'trainer-name') {
    const after = input.value === null ? null : boundedText(input.value, 'value', 80)
    if (after === null) throw new OnboardingUseCaseError(400, 'A Trainer must keep a name; provide a replacement')
    return {
      corrected: { ...draft, trainerBuild: { ...draft.trainerBuild, name: after } },
      before: draft.trainerBuild.name,
      after,
    }
  }
  if (input.scope === 'trainer-identity-text') {
    const after = input.value === null ? null : boundedText(input.value, 'value', 4000)
    return {
      corrected: {
        ...draft,
        trainerBuild: {
          ...draft.trainerBuild,
          identity: { ...draft.trainerBuild.identity, background: after },
        },
      },
      before: draft.trainerBuild.identity.background,
      after,
    }
  }
  // pokemon-nickname
  const index = input.buildIndex
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= draft.pokemonBuilds.length) {
    throw new OnboardingUseCaseError(400, 'buildIndex must reference a starter in this draft')
  }
  const after = input.value === null ? null : boundedText(input.value, 'value', 80)
  const build = draft.pokemonBuilds[index]!
  return {
    corrected: {
      ...draft,
      pokemonBuilds: draft.pokemonBuilds.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, nickname: after } : entry),
    },
    before: build.nickname,
    after,
  }
}

export interface OnboardingCorrectionResult {
  readonly ok: true
  readonly submissionRevision: number
  readonly correctionEntryId: string
  readonly requiresAcknowledgement: boolean
}

export const applyOnboardingCorrectionUseCase = (
  input: OnboardingCorrectionInput,
  dependencies: OnboardingCorrectionDependencies = {},
): OnboardingCorrectionResult => {
  if (input.role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
  const repository = repositoryOf(dependencies)
  if (!(ONBOARDING_CORRECTION_SCOPES as readonly string[]).includes(input.scope)) {
    throw new OnboardingUseCaseError(400, `Correction scope must be one of ${ONBOARDING_CORRECTION_SCOPES.join(', ')}`)
  }
  const rationale = boundedText(input.rationale, 'rationale', 2000)

  const payloadHash = onboardingPayloadHash({
    draftId: input.draftId,
    submissionRevision: input.submissionRevision,
    scope: input.scope,
    buildIndex: input.buildIndex ?? null,
    value: input.value,
  })
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash === payloadHash) return existing.result as unknown as OnboardingCorrectionResult
    throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
  }

  const stored = repository.getDraft(input.draftId)
  if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')
  if (stored.state !== 'submitted') {
    throw new OnboardingUseCaseError(409, `Corrections apply to submitted drafts; this draft is ${stored.state}`)
  }
  if (stored.draft.submissionRevision !== input.submissionRevision) {
    throw new OnboardingUseCaseError(409, `Review targets submission ${stored.draft.submissionRevision}, not ${input.submissionRevision}`)
  }
  const policy = repository.getPolicy(stored.draft.policyId, stored.draft.policyVersion)
  if (!policy) throw new OnboardingUseCaseError(409, 'The bound policy version is unavailable')

  const { corrected, before, after } = applyCorrectionScope(stored.draft, input)

  /* Same canonical validators; a correction may never introduce blockers. */
  const catalog = onboardingCreationCatalog()
  const validation = validateOnboardingPackage(
    {
      trainerBuild: corrected.trainerBuild,
      pokemonBuilds: corrected.pokemonBuilds,
      deferredDecisions: corrected.deferredDecisions,
    },
    policy.content,
    catalog,
    { draftCatalogFingerprint: corrected.catalogFingerprint, profileBound: true },
  )
  if (!validation.submittable) {
    throw new OnboardingUseCaseError(422, `Correction rejected: it would introduce ${validation.blockingCount} blocking issue(s)`)
  }

  const now = dependencies.now?.() ?? Date.now()
  const nextSubmissionRevision = stored.draft.submissionRevision + 1

  const result = repository.database.withTransaction((): OnboardingCorrectionResult => {
    const savedDraft = repository.saveDraftDocument({
      draftId: stored.draft.draftId,
      expectedRevision: stored.revision,
      document: parseOnboardingDraft({ ...corrected, submissionRevision: nextSubmissionRevision }),
      now,
    })
    repository.createSubmission({
      draftId: stored.draft.draftId,
      submissionRevision: nextSubmissionRevision,
      snapshot: savedDraft.draft,
      validation,
      policyContentHash: policy.identity.contentHash,
      catalogFingerprint: catalog.catalogFingerprint,
      now,
    })
    const entry = repository.appendReviewEntry({
      draftId: stored.draft.draftId,
      submissionRevision: nextSubmissionRevision,
      kind: 'correction',
      audience: 'table',
      payload: {
        scope: input.scope,
        ...(input.buildIndex !== undefined ? { buildIndex: input.buildIndex } : {}),
        before,
        after,
        rationale,
        requiresAcknowledgement: input.requiresAcknowledgement,
        fromSubmissionRevision: input.submissionRevision,
        toSubmissionRevision: nextSubmissionRevision,
      },
      now,
    })
    const out: OnboardingCorrectionResult = {
      ok: true,
      submissionRevision: nextSubmissionRevision,
      correctionEntryId: entry.entryId,
      requiresAcknowledgement: input.requiresAcknowledgement,
    }
    repository.recordOperation({
      opId: input.operationId,
      scope: 'correct',
      payloadHash,
      result: out as unknown as Record<string, unknown>,
      now,
    })
    return out
  })

  ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(stored.draft.profileId, {
    schemaVersion: 1,
    draftId: stored.draft.draftId,
    slotId: stored.draft.slotId,
    revision: stored.revision + 1,
    state: 'submitted',
    updatedAt: now,
    clientId: null,
  })
  return result
}

/* ------------------------------------------------------------------ */
/* Player acknowledgement                                             */
/* ------------------------------------------------------------------ */

export interface AcknowledgeCorrectionInput {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly draftId: unknown
  readonly correctionEntryId: string
  readonly operationId: string
}

export const acknowledgeOnboardingCorrectionUseCase = (
  input: AcknowledgeCorrectionInput,
  dependencies: OnboardingCorrectionDependencies = {},
): { ok: true, acknowledgedEntryId: string } => {
  const repository = repositoryOf(dependencies)
  const stored = repository.getDraft(input.draftId)
  if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')
  const isOwner = input.role === 'player' && input.profile?.id === stored.draft.profileId
  if (!isOwner) throw new OnboardingUseCaseError(404, 'Draft not found')

  const payloadHash = onboardingPayloadHash({ draftId: stored.draft.draftId, correctionEntryId: input.correctionEntryId })
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash === payloadHash) return existing.result as never
    throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
  }

  const entries = repository.listReviewEntries(stored.draft.draftId)
  const correction = entries.find(entry => entry.entryId === input.correctionEntryId && entry.kind === 'correction')
  if (!correction) throw new OnboardingUseCaseError(404, 'Correction entry not found')
  const alreadyAcknowledged = entries.some(entry =>
    entry.kind === 'acknowledgement' && entry.payload.correctionEntryId === input.correctionEntryId)
  if (alreadyAcknowledged) {
    return { ok: true, acknowledgedEntryId: input.correctionEntryId }
  }

  const now = dependencies.now?.() ?? Date.now()
  const result = repository.database.withTransaction(() => {
    repository.appendReviewEntry({
      draftId: stored.draft.draftId,
      submissionRevision: correction.submissionRevision,
      kind: 'acknowledgement',
      audience: 'table',
      payload: { correctionEntryId: input.correctionEntryId },
      now,
    })
    const out = { ok: true as const, acknowledgedEntryId: input.correctionEntryId }
    repository.recordOperation({
      opId: input.operationId,
      scope: 'acknowledge',
      payloadHash,
      result: out,
      now,
    })
    return out
  })
  return result
}

/** Corrections on the given submission that still need the owner's acknowledgement. */
export const unacknowledgedCorrections = (
  entries: readonly OnboardingReviewEntryRecord[],
  submissionRevision: number,
): readonly OnboardingReviewEntryRecord[] => {
  const acknowledged = new Set(
    entries
      .filter(entry => entry.kind === 'acknowledgement')
      .map(entry => String(entry.payload.correctionEntryId ?? '')),
  )
  return entries.filter(entry =>
    entry.kind === 'correction'
    && entry.submissionRevision <= submissionRevision
    && entry.payload.requiresAcknowledgement === true
    && !acknowledged.has(entry.entryId))
}
