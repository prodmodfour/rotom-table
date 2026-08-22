import type { AuthRole } from '#shared/auth'
import {
  linkedCharacterRefKey,
  type LinkedCharacterRef,
  type PlayerProfile,
} from '#shared/playerProfiles'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import {
  ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION,
  parseOnboardingCommitPlan,
  type OnboardingCommitPlanV1,
} from '#shared/onboarding/commitPlan'
import { validateOnboardingPackage } from '#shared/onboarding/validate'
import type { OnboardingValidationSummary } from '#shared/onboarding/validation'
import {
  onboardingGmChannel,
  onboardingProfileChannel,
} from '#shared/onboarding/realtime'
import { slugify } from '#shared/paths'
import {
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
  type OnboardingRepository,
  type OnboardingReviewEntryRecord,
  type OnboardingSubmissionRecord,
} from '../storage/onboardingRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import {
  serializeOnboardingCharacterPackage,
  resolveOnboardingStartingMoney,
} from '../domain/onboarding/serializeCharacterPackage'
import {
  defaultPersistedLibraryRealtimeEventPublisher,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  sheetLibraryCreatedRealtimeAppendInputs,
} from '../realtime/libraryMutationRealtime'
import { publishCampaignAttentionInvalidation } from '../realtime/campaignAttentionRealtime'
import {
  publishOnboardingDraftChanged,
  publishOnboardingSlotChanged,
} from '../realtime/onboardingRealtime'
import { readPlayerProfile, updatePlayerProfile } from '../utils/playerProfileStorage'
import { OnboardingUseCaseError } from './onboardingWorkflows'
import { unacknowledgedCorrections } from './onboardingCorrections'

/* ------------------------------------------------------------------ */
/* GM review load (P9-053)                                            */
/* ------------------------------------------------------------------ */

export interface OnboardingReviewView {
  readonly submission: OnboardingSubmissionRecord
  readonly validation: OnboardingValidationSummary
  readonly reviewEntries: readonly OnboardingReviewEntryRecord[]
  readonly deviationsRequiringConfirmation: readonly string[]
  readonly planPreview: OnboardingCommitPlanV1
}

export interface OnboardingApprovalDependencies {
  readonly repository?: OnboardingRepository
  readonly now?: () => number
  readonly readProfile?: typeof readPlayerProfile
  readonly applyProfileLinks?: (profileId: string, refs: readonly LinkedCharacterRef[]) => void
  readonly publishSlotChanged?: typeof publishOnboardingSlotChanged
  readonly publishDraftChanged?: typeof publishOnboardingDraftChanged
}

const repositoryOf = (dependencies: OnboardingApprovalDependencies): OnboardingRepository =>
  dependencies.repository ?? createSqliteOnboardingRepository()

const sheetRepositoryOf = (repository: OnboardingRepository): SheetRepository<Record<string, unknown>> =>
  createSqliteSheetRepository<Record<string, unknown>>(repository.database)

const requireGm = (role: AuthRole): void => {
  if (role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
}

const latestSubmission = (
  repository: OnboardingRepository,
  draftId: unknown,
): OnboardingSubmissionRecord => {
  const stored = repository.getDraft(draftId)
  if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')
  const submission = repository.getSubmission(stored.draft.draftId, stored.draft.submissionRevision)
  if (!submission) throw new OnboardingUseCaseError(409, 'No submission exists for this draft yet')
  return submission
}

const revalidateSubmission = (
  repository: OnboardingRepository,
  submission: OnboardingSubmissionRecord,
): { validation: OnboardingValidationSummary, policyContentHash: string } => {
  const policy = repository.getPolicy(submission.snapshot.policyId, submission.snapshot.policyVersion)
  if (!policy) throw new OnboardingUseCaseError(409, 'The bound policy version is unavailable')
  const catalog = onboardingCreationCatalog()
  const validation = validateOnboardingPackage(
    {
      trainerBuild: submission.snapshot.trainerBuild,
      pokemonBuilds: submission.snapshot.pokemonBuilds,
      deferredDecisions: submission.snapshot.deferredDecisions,
    },
    policy.content,
    catalog,
    { draftCatalogFingerprint: submission.catalogFingerprint, profileBound: true },
  )
  return { validation, policyContentHash: policy.identity.contentHash }
}

export const buildOnboardingCommitPlan = (
  repository: OnboardingRepository,
  submission: OnboardingSubmissionRecord,
  options: { readonly reserveSlugs?: boolean } = {},
): OnboardingCommitPlanV1 => {
  const stored = repository.getDraft(submission.draftId)
  if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')
  const policy = repository.getPolicy(submission.snapshot.policyId, submission.snapshot.policyVersion)
  if (!policy) throw new OnboardingUseCaseError(409, 'The bound policy version is unavailable')
  const catalog = onboardingCreationCatalog()
  const snapshot = submission.snapshot
  const sheetRepository = sheetRepositoryOf(repository)

  const trainerSlug = sheetRepository.allocateSlug('trainer', slugify(snapshot.trainerBuild.name ?? 'new trainer'))
  const pokemonSlugs = new Map<string, string>()
  const claimed = new Set<string>()
  for (const build of snapshot.pokemonBuilds) {
    const base = slugify(build.nickname ?? build.speciesId ?? 'starter')
    let candidate = sheetRepository.allocateSlug('pokemon', base)
    let suffix = 1
    while (claimed.has(candidate)) {
      candidate = sheetRepository.allocateSlug('pokemon', `${base}-${suffix}`)
      suffix += 1
    }
    claimed.add(candidate)
    pokemonSlugs.set(build.buildId, candidate)
  }
  void options

  const orderedTeam = [...snapshot.pokemonBuilds]
    .sort((left, right) => (left.teamSlot ?? 99) - (right.teamSlot ?? 99))
    .map(build => pokemonSlugs.get(build.buildId)!)

  const plan = parseOnboardingCommitPlan({
    schemaVersion: ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION,
    operationId: `onbop_commit-${submission.draftId}-${submission.submissionRevision}`,
    readSet: {
      draft: { draftId: submission.draftId, revision: stored.revision },
      policy: {
        policyId: policy.identity.policyId,
        version: policy.identity.version,
        contentHash: policy.identity.contentHash,
      },
      catalogFingerprint: catalog.catalogFingerprint,
      profileId: snapshot.profileId,
      slotId: snapshot.slotId,
      slugReservations: [
        { kind: 'trainer', slug: trainerSlug },
        ...[...pokemonSlugs.values()].map(slug => ({ kind: 'pokemon' as const, slug })),
      ],
      folderDestinations: [
        policy.content.workflow.destinations.trainerFolder,
        policy.content.workflow.destinations.pokemonFolder,
      ],
    },
    writeSet: {
      sheets: [
        {
          kind: 'trainer',
          slug: trainerSlug,
          folder: policy.content.workflow.destinations.trainerFolder,
          displayName: snapshot.trainerBuild.name ?? 'New Trainer',
          sourceBuildId: 'trainer',
        },
        ...snapshot.pokemonBuilds.map(build => ({
          kind: 'pokemon' as const,
          slug: pokemonSlugs.get(build.buildId)!,
          folder: policy.content.workflow.destinations.pokemonFolder,
          displayName: build.nickname ?? build.speciesId ?? 'Starter',
          sourceBuildId: build.buildId,
        })),
      ],
      profileLinks: [
        { profileId: snapshot.profileId, sheetKind: 'trainer', sheetSlug: trainerSlug },
        ...[...pokemonSlugs.values()].map(slug => ({
          profileId: snapshot.profileId,
          sheetKind: 'pokemon' as const,
          sheetSlug: slug,
        })),
      ],
      team: { trainerSlug, currentTeam: orderedTeam, boxedPokemon: [] },
      startingMoney: resolveOnboardingStartingMoney(policy.content, catalog),
      inventoryRows: policy.content.packages.trainerItems.map(grant => ({
        trainerSlug,
        section: grant.section,
        itemId: grant.itemId,
        quantity: grant.quantity,
      })),
      starterHeldItems: snapshot.pokemonBuilds
        .filter(build => build.heldItemId !== null)
        .map(build => ({ pokemonSlug: pokemonSlugs.get(build.buildId)!, itemId: build.heldItemId! })),
      completionRecordId: `onbdone-${submission.draftId}-${submission.submissionRevision}`,
      realtimeEventTypes: ['onboarding.completed'],
    },
  })
  return plan
}

export const loadOnboardingReviewUseCase = (
  input: { readonly role: AuthRole, readonly draftId: unknown },
  dependencies: OnboardingApprovalDependencies = {},
): OnboardingReviewView => {
  requireGm(input.role)
  const repository = repositoryOf(dependencies)
  const submission = latestSubmission(repository, input.draftId)
  const { validation } = revalidateSubmission(repository, submission)
  const deviations = validation.issues
    .filter(issue => issue.severity === 'deviation')
    .map(issue => issue.message)
  return {
    submission,
    validation,
    reviewEntries: repository.listReviewEntries(submission.draftId, { includeGmOnly: true }),
    deviationsRequiringConfirmation: deviations,
    planPreview: buildOnboardingCommitPlan(repository, submission),
  }
}

/* ------------------------------------------------------------------ */
/* Change requests (P9-054)                                           */
/* ------------------------------------------------------------------ */

export interface RequestOnboardingChangesInput {
  readonly role: AuthRole
  readonly draftId: unknown
  readonly submissionRevision: number
  readonly reasons: readonly string[]
  readonly comment?: string
  readonly gmOnlyNote?: string
  readonly operationId: string
}

export const requestOnboardingChangesUseCase = (
  input: RequestOnboardingChangesInput,
  dependencies: OnboardingApprovalDependencies = {},
): { ok: true, state: 'changes-requested' } => {
  requireGm(input.role)
  const repository = repositoryOf(dependencies)
  if (input.reasons.length === 0 || input.reasons.length > 20) {
    throw new OnboardingUseCaseError(400, 'Provide 1-20 stable reason codes')
  }
  const payloadHash = onboardingPayloadHash({ draftId: input.draftId, submissionRevision: input.submissionRevision, reasons: input.reasons })
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash === payloadHash) return existing.result as never
    throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
  }

  const stored = repository.getDraft(input.draftId)
  if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')
  if (stored.state !== 'submitted') throw new OnboardingUseCaseError(409, `Draft is ${stored.state}, not submitted`)
  if (stored.draft.submissionRevision !== input.submissionRevision) {
    throw new OnboardingUseCaseError(409, `Review targets submission ${stored.draft.submissionRevision}, not ${input.submissionRevision}`)
  }

  const result = repository.database.withTransaction(() => {
    repository.appendReviewEntry({
      draftId: stored.draft.draftId,
      submissionRevision: input.submissionRevision,
      kind: 'change-request',
      audience: 'table',
      payload: {
        reasons: [...input.reasons],
        ...(input.comment ? { comment: String(input.comment).slice(0, 2000) } : {}),
      },
      now: dependencies.now?.(),
    })
    if (input.gmOnlyNote) {
      repository.appendReviewEntry({
        draftId: stored.draft.draftId,
        submissionRevision: input.submissionRevision,
        kind: 'approval-note',
        audience: 'gm-only',
        payload: { note: String(input.gmOnlyNote).slice(0, 2000) },
        now: dependencies.now?.(),
      })
    }
    repository.transitionDraft({
      draftId: stored.draft.draftId,
      expectedRevision: stored.revision,
      to: 'changes-requested',
      actor: 'gm',
      now: dependencies.now?.(),
    })
    const out = { ok: true as const, state: 'changes-requested' as const }
    repository.recordOperation({
      opId: input.operationId,
      scope: 'request-changes',
      payloadHash,
      result: out,
      now: dependencies.now?.(),
    })
    return out
  })

  ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(stored.draft.profileId, {
    schemaVersion: 1,
    draftId: stored.draft.draftId,
    slotId: stored.draft.slotId,
    revision: stored.revision + 1,
    state: 'changes-requested',
    updatedAt: dependencies.now?.() ?? Date.now(),
    clientId: null,
  })
  const slot = repository.getSlot(stored.draft.slotId)
  if (slot) {
    ;(dependencies.publishSlotChanged ?? publishOnboardingSlotChanged)({
      schemaVersion: 1,
      slotId: slot.slotId,
      profileId: slot.profileId,
      state: 'changes-requested',
      policyVersion: slot.policyVersion,
      updatedAt: dependencies.now?.() ?? Date.now(),
    })
  }
  return result
}

/* ------------------------------------------------------------------ */
/* Approve + atomic commit (P9-056, P9-057, P9-058, P9-059)           */
/* ------------------------------------------------------------------ */

export interface ApproveOnboardingSubmissionInput {
  readonly role: AuthRole
  readonly draftId: unknown
  readonly submissionRevision: number
  readonly confirmDeviations: boolean
  readonly operationId: string
}

export interface ApproveOnboardingSubmissionResult {
  readonly ok: true
  readonly completionRecordId: string
  readonly trainerSlug: string
  readonly pokemonSlugs: readonly string[]
  readonly profileLinksApplied: boolean
}

export const approveOnboardingSubmissionUseCase = (
  input: ApproveOnboardingSubmissionInput,
  dependencies: OnboardingApprovalDependencies = {},
): ApproveOnboardingSubmissionResult => {
  requireGm(input.role)
  const repository = repositoryOf(dependencies)

  const payloadHash = onboardingPayloadHash({
    draftId: input.draftId,
    submissionRevision: input.submissionRevision,
  })
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
    }
    const replayed = existing.result as unknown as ApproveOnboardingSubmissionResult
    if (!replayed.profileLinksApplied) {
      return finishProfileLinks(repository, replayed, dependencies, input.operationId)
    }
    return replayed
  }

  const submission = latestSubmission(repository, input.draftId)
  if (submission.submissionRevision !== input.submissionRevision) {
    throw new OnboardingUseCaseError(409, `Review targets submission ${submission.submissionRevision}, not ${input.submissionRevision}`)
  }
  const stored = repository.getDraft(input.draftId)!
  if (stored.state !== 'submitted') {
    throw new OnboardingUseCaseError(409, `Draft is ${stored.state}, not submitted`)
  }

  /* Full re-authorization (product rule 6/9). */
  const { validation } = revalidateSubmission(repository, submission)
  if (!validation.submittable) {
    throw new OnboardingUseCaseError(422, `Approval blocked: ${validation.blockingCount} blocking issue(s) under current authority`)
  }
  if (validation.deviationCount > 0 && !input.confirmDeviations) {
    throw new OnboardingUseCaseError(409, `${validation.deviationCount} reviewed deviation(s) require explicit GM confirmation`)
  }
  const pendingAcknowledgements = unacknowledgedCorrections(
    repository.listReviewEntries(submission.draftId, { includeGmOnly: true }),
    submission.submissionRevision,
  )
  if (pendingAcknowledgements.length > 0) {
    throw new OnboardingUseCaseError(409, `${pendingAcknowledgements.length} correction(s) await the player's acknowledgement before approval`)
  }

  const policy = repository.getPolicy(submission.snapshot.policyId, submission.snapshot.policyVersion)!
  const catalog = onboardingCreationCatalog()
  const plan = buildOnboardingCommitPlan(repository, submission)

  const profile = (dependencies.readProfile ?? readPlayerProfile)(plan.readSet.profileId)
  if (!profile) {
    throw new OnboardingUseCaseError(409, `Player profile ${plan.readSet.profileId} no longer exists; rebind the slot first`)
  }

  const pokemonSlugMap = new Map(
    plan.writeSet.sheets
      .filter(sheet => sheet.kind === 'pokemon')
      .map(sheet => [sheet.sourceBuildId, sheet.slug]),
  )
  const serialized = serializeOnboardingCharacterPackage({
    snapshot: submission.snapshot,
    policy: policy.content,
    catalog,
    trainerSlug: plan.writeSet.team.trainerSlug,
    pokemonSlugs: pokemonSlugMap,
    trainerFolder: policy.content.workflow.destinations.trainerFolder,
    pokemonFolder: policy.content.workflow.destinations.pokemonFolder,
  })

  const realtimeEventRepository = createSqliteRealtimeEventRepository({ database: repository.database })
  const sheetRepository = sheetRepositoryOf(repository)
  const now = dependencies.now?.() ?? Date.now()

  const transactionResult = repository.database.withTransaction(() => {
    /* Re-validate the read set inside the transaction. */
    const current = repository.getDraft(submission.draftId)
    if (!current || current.revision !== plan.readSet.draft.revision) {
      throw new OnboardingUseCaseError(409, 'The draft changed while approval was in flight; re-open the review')
    }
    for (const reservation of plan.readSet.slugReservations) {
      if (sheetRepository.getByRef(reservation.kind, reservation.slug)) {
        throw new OnboardingUseCaseError(409, `Sheet slug ${reservation.kind}:${reservation.slug} is no longer free; re-open the review to re-plan`)
      }
    }

    /* Lifecycle: submitted -> approved -> committing -> completed. */
    const approved = repository.transitionDraft({
      draftId: submission.draftId, expectedRevision: current.revision, to: 'approved', actor: 'gm', now,
    })
    const committing = repository.transitionDraft({
      draftId: submission.draftId, expectedRevision: approved.revision, to: 'committing', actor: 'system', now,
    })

    /* Folders, sheets, and library events. */
    for (const folder of plan.readSet.folderDestinations) {
      sheetRepository.createFolder('trainer', folder, now)
      sheetRepository.createFolder('pokemon', folder, now)
    }
    const persistedSheets = [] as { kind: 'trainer' | 'pokemon', slug: string, persisted: ReturnType<typeof sheetRepository.saveSetupSheet> }[]
    const trainerPersisted = sheetRepository.saveSetupSheet('trainer', plan.writeSet.team.trainerSlug, {
      ...serialized.trainerDocument,
      revision: 0,
      updatedAt: now,
    })
    persistedSheets.push({ kind: 'trainer', slug: plan.writeSet.team.trainerSlug, persisted: trainerPersisted })
    for (const entry of serialized.pokemonDocuments) {
      const slug = pokemonSlugMap.get(entry.buildId)!
      const persisted = sheetRepository.saveSetupSheet('pokemon', slug, {
        ...entry.document,
        revision: 0,
        updatedAt: now,
      })
      persistedSheets.push({ kind: 'pokemon', slug, persisted })
    }

    const libraryEvents = persistedSheets.flatMap(sheet =>
      realtimeEventRepository.appendMany(sheetLibraryCreatedRealtimeAppendInputs(sheet.persisted)))

    /* Completion + provenance. */
    const completion = repository.recordCompletion({
      completionId: plan.writeSet.completionRecordId,
      slotId: plan.readSet.slotId,
      draftId: submission.draftId,
      submissionRevision: submission.submissionRevision,
      refs: {
        trainerSlug: plan.writeSet.team.trainerSlug,
        pokemonSlugs: [...pokemonSlugMap.values()],
        team: plan.writeSet.team,
        startingMoney: plan.writeSet.startingMoney,
        inventoryRows: plan.writeSet.inventoryRows,
        policyContentHash: plan.readSet.policy.contentHash,
        catalogFingerprint: plan.readSet.catalogFingerprint,
        profileLinksApplied: false,
      },
      now,
    })
    repository.closeSlot(plan.readSet.slotId, 'completed', now)
    const completed = repository.transitionDraft({
      draftId: submission.draftId, expectedRevision: committing.revision, to: 'completed', actor: 'system', now,
    })

    /* Durable completion events for both audiences. */
    const completionPayload = {
      schemaVersion: 1,
      slotId: plan.readSet.slotId,
      profileId: plan.readSet.profileId,
      trainerSlug: plan.writeSet.team.trainerSlug,
      pokemonSlugs: [...pokemonSlugMap.values()],
      completionRecordId: completion.completionId,
      completedAt: now,
    }
    const completionEvents = realtimeEventRepository.appendMany([
      {
        event: { channel: onboardingGmChannel, type: 'onboarding.completed', data: completionPayload },
        access: { kind: 'gm-only' },
        dedupeKey: `onboarding-completed:gm:${completion.completionId}`,
      },
      {
        event: {
          channel: onboardingProfileChannel(plan.readSet.profileId),
          type: 'onboarding.completed',
          data: completionPayload,
        },
        access: { kind: 'player-profile-access', profileId: plan.readSet.profileId },
        dedupeKey: `onboarding-completed:owner:${completion.completionId}`,
      },
    ])

    const result: ApproveOnboardingSubmissionResult = {
      ok: true,
      completionRecordId: completion.completionId,
      trainerSlug: plan.writeSet.team.trainerSlug,
      pokemonSlugs: [...pokemonSlugMap.values()],
      profileLinksApplied: false,
    }
    repository.recordOperation({
      opId: input.operationId,
      scope: 'approve',
      payloadHash,
      result: result as unknown as Record<string, unknown>,
      now,
    })
    void completed
    return { result, events: [...libraryEvents, ...completionEvents] }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.events,
    publish: defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: () => {},
  })

  const finished = finishProfileLinks(repository, transactionResult.result, dependencies, input.operationId)

  ;(dependencies.publishSlotChanged ?? publishOnboardingSlotChanged)({
    schemaVersion: 1,
    slotId: plan.readSet.slotId,
    profileId: plan.readSet.profileId,
    state: 'completed',
    policyVersion: plan.readSet.policy.version,
    updatedAt: now,
  })
  ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(plan.readSet.profileId, {
    schemaVersion: 1,
    draftId: submission.draftId,
    slotId: plan.readSet.slotId,
    revision: plan.readSet.draft.revision + 3,
    state: 'completed',
    updatedAt: now,
    clientId: null,
  })
  publishCampaignAttentionInvalidation({
    cause: 'profile-authority',
    profileIds: [plan.readSet.profileId],
  })

  return finished
}

/**
 * Profile links live in filesystem JSON outside the SQLite transaction; the
 * completion record tracks whether they were applied so exact retry finishes
 * deterministically (see docs/onboarding/atomicity-contract.md).
 */
const finishProfileLinks = (
  repository: OnboardingRepository,
  result: ApproveOnboardingSubmissionResult,
  dependencies: OnboardingApprovalDependencies,
  operationId: string,
): ApproveOnboardingSubmissionResult => {
  if (result.profileLinksApplied) return result

  const completionRow = repository.database.connection.prepare(
    'SELECT slot_id, refs_json FROM onboarding_completions WHERE completion_id = ?',
  ).get(result.completionRecordId) as { slot_id?: string, refs_json?: string } | undefined
  if (!completionRow?.refs_json) return result
  const refs = JSON.parse(completionRow.refs_json) as Record<string, unknown>
  if (refs.profileLinksApplied === true) {
    return { ...result, profileLinksApplied: true }
  }

  const slot = repository.getSlot(completionRow.slot_id)
  if (!slot) return result

  const applyLinks = dependencies.applyProfileLinks ?? ((profileId: string, newRefs: readonly LinkedCharacterRef[]) => {
    const profile = (dependencies.readProfile ?? readPlayerProfile)(profileId as never)
    if (!profile) throw new OnboardingUseCaseError(409, `Player profile ${profileId} disappeared before linking`)
    const merged = new Map(profile.linkedCharacters.map(ref => [linkedCharacterRefKey(ref), ref]))
    for (const ref of newRefs) merged.set(linkedCharacterRefKey(ref), ref)
    updatePlayerProfile(profileId, { linkedCharacters: [...merged.values()] })
  })

  applyLinks(slot.profileId, [
    { sheetKind: 'trainer', sheetSlug: result.trainerSlug },
    ...result.pokemonSlugs.map(slug => ({ sheetKind: 'pokemon' as const, sheetSlug: slug })),
  ])

  const nextRefs = { ...refs, profileLinksApplied: true }
  repository.database.connection.prepare(
    'UPDATE onboarding_completions SET refs_json = ? WHERE completion_id = ?',
  ).run(JSON.stringify(nextRefs), result.completionRecordId)

  /* Update the journaled operation result so replay reports the final state. */
  const finished = { ...result, profileLinksApplied: true }
  repository.database.connection.prepare(
    'UPDATE onboarding_ops SET result_json = ? WHERE op_id = ?',
  ).run(JSON.stringify(finished), operationId)
  return finished
}
