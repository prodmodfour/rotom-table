import type { AuthRole } from '#shared/auth'
import type { PlayerProfile, PlayerProfileId } from '#shared/playerProfiles'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import {
  parseOnboardingDraft,
  type OnboardingDraftV1,
} from '#shared/onboarding/draft'
import { canOwnerEditDraftContent, type OnboardingDraftState } from '#shared/onboarding/lifecycle'
import type { PublishedOnboardingPolicyV1 } from '#shared/onboarding/policy'
import { validateOnboardingPackage } from '#shared/onboarding/validate'
import type { OnboardingValidationSummary } from '#shared/onboarding/validation'
import {
  OnboardingRepositoryError,
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
  type OnboardingRepository,
  type OnboardingSlotRecord,
  type StoredOnboardingDraft,
} from '../storage/onboardingRepository'
import { createPlayerProfileUseCase } from './createPlayerProfile'
import { readPlayerProfile, listPlayerProfiles } from '../utils/playerProfileStorage'
import {
  publishOnboardingDraftChanged,
  publishOnboardingPolicyPublished,
  publishOnboardingSlotChanged,
} from '../realtime/onboardingRealtime'

export class OnboardingUseCaseError extends Error {
  readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'OnboardingUseCaseError'
    this.statusCode = statusCode
  }
}

export interface OnboardingWorkflowDependencies {
  readonly repository?: OnboardingRepository
  readonly readProfile?: (profileId: PlayerProfileId) => PlayerProfile | null
  readonly listProfiles?: () => readonly PlayerProfile[]
  readonly now?: () => number
  readonly publishSlotChanged?: typeof publishOnboardingSlotChanged
  readonly publishDraftChanged?: typeof publishOnboardingDraftChanged
  readonly publishPolicyPublished?: typeof publishOnboardingPolicyPublished
}

const repositoryOf = (dependencies: OnboardingWorkflowDependencies): OnboardingRepository =>
  dependencies.repository ?? createSqliteOnboardingRepository()

const readProfileOf = (dependencies: OnboardingWorkflowDependencies) =>
  dependencies.readProfile ?? ((profileId: PlayerProfileId) => readPlayerProfile(profileId))

const mapRepositoryError = (error: unknown): never => {
  if (error instanceof OnboardingRepositoryError) {
    const status = error.code === 'not-found'
      ? 404
      : error.code === 'revision-conflict' ? 409 : error.code === 'illegal-transition' ? 409 : 400
    throw new OnboardingUseCaseError(status, error.message)
  }
  throw error
}

const requireGmRole = (role: AuthRole): void => {
  if (role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
}

/* ------------------------------------------------------------------ */
/* Policy                                                             */
/* ------------------------------------------------------------------ */

export interface PublishOnboardingPolicyInput {
  readonly role: AuthRole
  readonly content: unknown
  readonly display: { readonly name?: unknown, readonly description?: unknown }
  readonly policyId?: unknown
}

export const publishOnboardingPolicyUseCase = (
  input: PublishOnboardingPolicyInput,
  dependencies: OnboardingWorkflowDependencies = {},
): { policy: PublishedOnboardingPolicyV1 } => {
  requireGmRole(input.role)
  const repository = repositoryOf(dependencies)
  const name = typeof input.display?.name === 'string' && input.display.name.trim() !== ''
    ? input.display.name.trim()
    : null
  if (!name) throw new OnboardingUseCaseError(400, 'display.name is required')
  try {
    const policy = repository.publishPolicy({
      content: input.content,
      display: {
        name,
        description: typeof input.display?.description === 'string' ? input.display.description : '',
      },
      policyId: input.policyId === undefined || input.policyId === null ? undefined : String(input.policyId),
      now: dependencies.now?.(),
    })
    ;(dependencies.publishPolicyPublished ?? publishOnboardingPolicyPublished)({
      schemaVersion: 1,
      policyId: policy.identity.policyId,
      version: policy.identity.version,
      publishedAt: policy.identity.publishedAt,
    })
    return { policy }
  } catch (error) {
    return mapRepositoryError(error)
  }
}

/* ------------------------------------------------------------------ */
/* Overview / queue / home                                            */
/* ------------------------------------------------------------------ */

export interface OnboardingSlotSummary {
  readonly slotId: string
  readonly profileId: string
  readonly profileDisplayName: string
  readonly policyVersion: number
  readonly status: OnboardingSlotRecord['status']
  readonly draftId: string | null
  readonly draftState: OnboardingDraftState | null
  readonly draftRevision: number | null
  readonly submissionRevision: number
  readonly updatedAt: number
  readonly ageMs: number
}

export interface OnboardingRosterRow {
  readonly profileId: string
  readonly displayName: string
  readonly trainerSlugs: readonly string[]
  readonly linkedPokemonCount: number
  readonly onboardingState: string
  readonly conflicts: readonly string[]
}

export interface GmOnboardingOverview {
  readonly kind: 'gm'
  readonly activePolicy: PublishedOnboardingPolicyV1 | null
  readonly policyVersions: readonly PublishedOnboardingPolicyV1[]
  readonly slots: readonly OnboardingSlotSummary[]
  readonly profilesWithoutSlots: readonly { readonly profileId: string, readonly displayName: string }[]
  readonly roster: readonly OnboardingRosterRow[]
  readonly catalogFingerprint: string
}

export interface PlayerOnboardingHome {
  readonly kind: 'player'
  readonly slot: OnboardingSlotSummary | null
  readonly draft: OnboardingDraftV1 | null
  readonly policy: PublishedOnboardingPolicyV1 | null
  readonly completion: { readonly completionId: string, readonly refs: Record<string, unknown> } | null
  readonly catalogFingerprint: string
}

const slotSummary = (
  slot: OnboardingSlotRecord,
  draft: StoredOnboardingDraft | null,
  profileName: string,
  now: number,
): OnboardingSlotSummary => ({
  slotId: slot.slotId,
  profileId: slot.profileId,
  profileDisplayName: profileName,
  policyVersion: slot.policyVersion,
  status: slot.status,
  draftId: draft?.draft.draftId ?? null,
  draftState: draft?.state ?? null,
  draftRevision: draft?.revision ?? null,
  submissionRevision: draft?.draft.submissionRevision ?? 0,
  updatedAt: slot.updatedAt,
  ageMs: Math.max(0, now - slot.createdAt),
})

export const loadGmOnboardingOverviewUseCase = (
  input: { readonly role: AuthRole },
  dependencies: OnboardingWorkflowDependencies = {},
): GmOnboardingOverview => {
  requireGmRole(input.role)
  const repository = repositoryOf(dependencies)
  const now = dependencies.now?.() ?? Date.now()
  const profiles = (dependencies.listProfiles ?? listPlayerProfiles)()
  const profileNames = new Map(profiles.map(profile => [profile.id as string, profile.displayName as string]))
  const slots = repository.listSlots().map((slot) => {
    const draft = slot.activeDraftId ? repository.getDraft(slot.activeDraftId) : null
    return slotSummary(slot, draft, profileNames.get(slot.profileId) ?? 'Unknown player', now)
  })
  const slottedProfiles = new Set(
    repository.listSlots().filter(slot => slot.status === 'open').map(slot => slot.profileId as string),
  )

  /* Roster and ownership overview (P9-076): orchestration data, not an editor. */
  const linkOwners = new Map<string, string[]>()
  for (const profile of profiles) {
    for (const ref of profile.linkedCharacters) {
      const key = `${ref.sheetKind}:${ref.sheetSlug}`
      linkOwners.set(key, [...(linkOwners.get(key) ?? []), profile.displayName as string])
    }
  }
  const completedProfiles = new Set(
    repository.listSlots().filter(slot => slot.status === 'completed').map(slot => slot.profileId as string),
  )
  const roster: OnboardingRosterRow[] = profiles.map((profile) => {
    const openSlot = slots.find(slot => slot.profileId === profile.id && slot.status === 'open')
    const conflicts = profile.linkedCharacters
      .map(ref => `${ref.sheetKind}:${ref.sheetSlug}`)
      .filter(key => (linkOwners.get(key) ?? []).length > 1)
    return {
      profileId: profile.id,
      displayName: profile.displayName,
      trainerSlugs: profile.linkedCharacters.filter(ref => ref.sheetKind === 'trainer').map(ref => ref.sheetSlug),
      linkedPokemonCount: profile.linkedCharacters.filter(ref => ref.sheetKind === 'pokemon').length,
      onboardingState: openSlot
        ? (openSlot.draftState ?? 'unstarted')
        : completedProfiles.has(profile.id)
          ? 'completed'
          : 'none',
      conflicts,
    }
  })

  return {
    kind: 'gm',
    activePolicy: repository.getActivePolicy(),
    policyVersions: repository.listPolicyVersions(),
    slots,
    profilesWithoutSlots: profiles
      .filter(profile => !slottedProfiles.has(profile.id))
      .map(profile => ({ profileId: profile.id, displayName: profile.displayName })),
    roster,
    catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
  }
}

export const loadPlayerOnboardingHomeUseCase = (
  input: { readonly role: AuthRole, readonly profile: PlayerProfile | null },
  dependencies: OnboardingWorkflowDependencies = {},
): PlayerOnboardingHome => {
  if (input.role !== 'player') throw new OnboardingUseCaseError(403, 'Player role required')
  if (!input.profile) throw new OnboardingUseCaseError(400, 'A selected player profile is required')
  const repository = repositoryOf(dependencies)
  const now = dependencies.now?.() ?? Date.now()

  const openSlot = repository.findOpenSlotByProfile(input.profile.id)
  const slots = repository.listSlots().filter(slot => slot.profileId === input.profile!.id)
  const latestClosed = slots
    .filter(slot => slot.status === 'completed')
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  const slot = openSlot ?? latestClosed
  if (!slot) {
    return {
      kind: 'player',
      slot: null,
      draft: null,
      policy: null,
      completion: null,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
    }
  }
  const draft = slot.activeDraftId ? repository.getDraft(slot.activeDraftId) : null
  const completion = repository.getCompletionBySlot(slot.slotId)
  return {
    kind: 'player',
    slot: slotSummary(slot, draft, input.profile.displayName, now),
    draft: draft?.draft ?? null,
    policy: repository.getPolicy(slot.policyId, slot.policyVersion),
    completion: completion ? { completionId: completion.completionId, refs: completion.refs } : null,
    catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
  }
}

/* ------------------------------------------------------------------ */
/* Slot creation (P9-024)                                             */
/* ------------------------------------------------------------------ */

export interface CreateOnboardingSlotUseCaseInput {
  readonly role: AuthRole
  readonly profileId?: unknown
  readonly newProfileDisplayName?: unknown
}

export const createOnboardingSlotUseCase = (
  input: CreateOnboardingSlotUseCaseInput,
  dependencies: OnboardingWorkflowDependencies = {},
): { slot: OnboardingSlotRecord, draft: StoredOnboardingDraft, profile: PlayerProfile } => {
  requireGmRole(input.role)
  const repository = repositoryOf(dependencies)

  let profile: PlayerProfile | null = null
  if (input.profileId !== undefined && input.profileId !== null && input.profileId !== '') {
    profile = readProfileOf(dependencies)(input.profileId as PlayerProfileId)
    if (!profile) throw new OnboardingUseCaseError(404, `Player profile ${String(input.profileId)} not found`)
  } else if (typeof input.newProfileDisplayName === 'string' && input.newProfileDisplayName.trim() !== '') {
    const created = createPlayerProfileUseCase({
      role: input.role,
      displayName: input.newProfileDisplayName,
    })
    profile = created.profile
  } else {
    throw new OnboardingUseCaseError(400, 'Provide profileId or newProfileDisplayName')
  }

  try {
    const created = repository.createSlotWithDraft({
      profileId: profile.id,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
      now: dependencies.now?.(),
    })
    ;(dependencies.publishSlotChanged ?? publishOnboardingSlotChanged)({
      schemaVersion: 1,
      slotId: created.slot.slotId,
      profileId: created.slot.profileId,
      state: created.draft.state,
      policyVersion: created.slot.policyVersion,
      updatedAt: created.slot.updatedAt,
    })
    ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(profile.id, {
      schemaVersion: 1,
      draftId: created.draft.draft.draftId,
      slotId: created.slot.slotId,
      revision: created.draft.revision,
      state: created.draft.state,
      updatedAt: created.draft.updatedAt,
      clientId: null,
    })
    return { ...created, profile }
  } catch (error) {
    return mapRepositoryError(error)
  }
}

/* ------------------------------------------------------------------ */
/* Draft access and mutation (P9-025, P9-027)                         */
/* ------------------------------------------------------------------ */

interface DraftAccessInput {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly draftId: unknown
}

const loadDraftForPrincipal = (
  input: DraftAccessInput,
  repository: OnboardingRepository,
): { draft: StoredOnboardingDraft, slot: OnboardingSlotRecord } => {
  let draft: StoredOnboardingDraft | null
  try {
    draft = repository.getDraft(input.draftId)
  } catch {
    throw new OnboardingUseCaseError(400, 'draftId is invalid')
  }
  if (!draft) throw new OnboardingUseCaseError(404, 'Draft not found')
  const slot = repository.getSlot(draft.draft.slotId)
  if (!slot) throw new OnboardingUseCaseError(404, 'Slot not found')

  if (input.role === 'gm') return { draft, slot }
  if (input.role === 'player' && input.profile && input.profile.id === draft.draft.profileId) {
    return { draft, slot }
  }
  // Do not reveal existence to unrelated principals.
  throw new OnboardingUseCaseError(404, 'Draft not found')
}

export const loadOnboardingDraftUseCase = (
  input: DraftAccessInput,
  dependencies: OnboardingWorkflowDependencies = {},
): { draft: OnboardingDraftV1, revision: number, state: OnboardingDraftState, policy: PublishedOnboardingPolicyV1 | null } => {
  const repository = repositoryOf(dependencies)
  const { draft, slot } = loadDraftForPrincipal(input, repository)
  return {
    draft: draft.draft,
    revision: draft.revision,
    state: draft.state,
    policy: repository.getPolicy(slot.policyId, slot.policyVersion),
  }
}

export interface SaveOnboardingDraftUseCaseInput extends DraftAccessInput {
  readonly expectedRevision: number
  readonly document: unknown
  readonly clientId?: string | null
}

export const saveOnboardingDraftUseCase = (
  input: SaveOnboardingDraftUseCaseInput,
  dependencies: OnboardingWorkflowDependencies = {},
): { draft: OnboardingDraftV1, revision: number, state: OnboardingDraftState } => {
  const repository = repositoryOf(dependencies)
  const { draft } = loadDraftForPrincipal(input, repository)

  if (input.role !== 'player' || !input.profile || input.profile.id !== draft.draft.profileId) {
    throw new OnboardingUseCaseError(403, 'Only the owning player edits this draft; the GM uses review and corrections')
  }
  if (!canOwnerEditDraftContent(draft.state)) {
    throw new OnboardingUseCaseError(409, `Draft is ${draft.state}; content can be edited only while draft or changes-requested`)
  }

  let parsed: OnboardingDraftV1
  try {
    parsed = parseOnboardingDraft(input.document)
  } catch (error) {
    throw new OnboardingUseCaseError(400, error instanceof Error ? error.message : 'Draft document is invalid')
  }

  try {
    const saved = repository.saveDraftDocument({
      draftId: draft.draft.draftId,
      expectedRevision: input.expectedRevision,
      document: parsed,
      now: dependencies.now?.(),
    })
    ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(draft.draft.profileId, {
      schemaVersion: 1,
      draftId: saved.draft.draftId,
      slotId: saved.draft.slotId,
      revision: saved.revision,
      state: saved.state,
      updatedAt: saved.updatedAt,
      clientId: input.clientId ?? null,
    })
    return { draft: saved.draft, revision: saved.revision, state: saved.state }
  } catch (error) {
    return mapRepositoryError(error)
  }
}

/* ------------------------------------------------------------------ */
/* Cancel / restart / supersede (P9-028)                              */
/* ------------------------------------------------------------------ */

export interface CancelOnboardingSlotInput {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly slotId: unknown
  readonly operationId: string
}

const journalReplay = <T extends Record<string, unknown>>(
  repository: OnboardingRepository,
  opId: string,
  payload: unknown,
): T | null => {
  const payloadHash = onboardingPayloadHash(payload)
  const existing = repository.findOperation(opId)
  if (!existing) return null
  if (existing.payloadHash === payloadHash) return existing.result as T
  throw new OnboardingUseCaseError(409, `Operation ${opId} was already recorded with different material`)
}

const journalledOperation = <T extends Record<string, unknown>>(
  repository: OnboardingRepository,
  opId: string,
  scope: 'cancel' | 'supersede' | 'migrate-policy',
  payload: unknown,
  work: () => T,
): T => {
  const replayed = journalReplay<T>(repository, opId, payload)
  if (replayed) return replayed
  const payloadHash = onboardingPayloadHash(payload)
  const result = repository.database.withTransaction((): Record<string, unknown> => {
    const inner = work()
    repository.recordOperation({ opId, scope, payloadHash, result: inner })
    return inner
  })
  return result as T
}

export const cancelOnboardingSlotUseCase = (
  input: CancelOnboardingSlotInput,
  dependencies: OnboardingWorkflowDependencies = {},
): { slotId: string, status: 'cancelled', draftState: OnboardingDraftState } => {
  const repository = repositoryOf(dependencies)
  const slot = repository.getSlot(input.slotId)
  if (!slot) throw new OnboardingUseCaseError(404, 'Slot not found')

  const isOwner = input.role === 'player' && input.profile?.id === slot.profileId
  if (input.role !== 'gm' && !isOwner) throw new OnboardingUseCaseError(404, 'Slot not found')

  const actor = input.role === 'gm' ? 'gm' as const : 'owner-player' as const
  const replayed = journalReplay<{ slotId: string, status: 'cancelled', draftState: OnboardingDraftState }>(
    repository,
    input.operationId,
    { slotId: slot.slotId, actor },
  )
  if (replayed) return replayed
  if (slot.status !== 'open') throw new OnboardingUseCaseError(409, `Slot is ${slot.status}`)

  const result = journalledOperation(repository, input.operationId, 'cancel', {
    slotId: slot.slotId,
    actor,
  }, () => {
    const draft = slot.activeDraftId ? repository.getDraft(slot.activeDraftId) : null
    let draftState: OnboardingDraftState = 'cancelled'
    if (draft) {
      const transitioned = repository.transitionDraft({
        draftId: draft.draft.draftId,
        expectedRevision: draft.revision,
        to: 'cancelled',
        actor,
        now: dependencies.now?.(),
      })
      draftState = transitioned.state
    }
    repository.closeSlot(slot.slotId, 'cancelled', dependencies.now?.())
    return { slotId: slot.slotId as string, status: 'cancelled' as const, draftState }
  })

  ;(dependencies.publishSlotChanged ?? publishOnboardingSlotChanged)({
    schemaVersion: 1,
    slotId: slot.slotId,
    profileId: slot.profileId,
    state: 'cancelled',
    policyVersion: slot.policyVersion,
    updatedAt: dependencies.now?.() ?? Date.now(),
  })
  if (slot.activeDraftId) {
    ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(slot.profileId, {
      schemaVersion: 1,
      draftId: slot.activeDraftId,
      slotId: slot.slotId,
      revision: 0,
      state: 'cancelled',
      updatedAt: dependencies.now?.() ?? Date.now(),
      clientId: null,
    })
  }
  return result
}

export interface RestartOnboardingSlotInput {
  readonly role: AuthRole
  readonly slotId: unknown
  readonly operationId: string
}

/** GM supersedes the current draft and opens a fresh slot under the active policy. */
export const restartOnboardingSlotUseCase = (
  input: RestartOnboardingSlotInput,
  dependencies: OnboardingWorkflowDependencies = {},
): { supersededSlotId: string, slot: OnboardingSlotRecord, draft: StoredOnboardingDraft } => {
  requireGmRole(input.role)
  const repository = repositoryOf(dependencies)
  const slot = repository.getSlot(input.slotId)
  if (!slot) throw new OnboardingUseCaseError(404, 'Slot not found')
  if (slot.status !== 'open') throw new OnboardingUseCaseError(409, `Slot is ${slot.status}`)

  const result = journalledOperation(repository, input.operationId, 'supersede', {
    slotId: slot.slotId,
  }, () => {
    const draft = slot.activeDraftId ? repository.getDraft(slot.activeDraftId) : null
    if (draft) {
      repository.transitionDraft({
        draftId: draft.draft.draftId,
        expectedRevision: draft.revision,
        to: 'superseded',
        actor: 'gm',
        now: dependencies.now?.(),
      })
    }
    repository.closeSlot(slot.slotId, 'superseded', dependencies.now?.())
    const created = repository.createSlotWithDraft({
      profileId: slot.profileId,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
      now: dependencies.now?.(),
    })
    return {
      supersededSlotId: slot.slotId as string,
      slot: created.slot,
      draft: created.draft,
    } as unknown as Record<string, unknown> & { supersededSlotId: string, slot: OnboardingSlotRecord, draft: StoredOnboardingDraft }
  })

  ;(dependencies.publishSlotChanged ?? publishOnboardingSlotChanged)({
    schemaVersion: 1,
    slotId: result.slot.slotId,
    profileId: result.slot.profileId,
    state: 'draft',
    policyVersion: result.slot.policyVersion,
    updatedAt: result.slot.updatedAt,
  })
  return result
}

/* ------------------------------------------------------------------ */
/* Policy migration (P9-023)                                          */
/* ------------------------------------------------------------------ */

export interface MigrateOnboardingDraftPolicyInput {
  readonly role: AuthRole
  readonly draftId: unknown
  readonly apply: boolean
  readonly expectedRevision?: number
  readonly operationId?: string
}

export interface MigrateOnboardingDraftPolicyResult {
  readonly fromVersion: number
  readonly toVersion: number
  readonly validation: OnboardingValidationSummary
  readonly applied: boolean
  readonly revision?: number
}

export const migrateOnboardingDraftPolicyUseCase = (
  input: MigrateOnboardingDraftPolicyInput,
  dependencies: OnboardingWorkflowDependencies = {},
): MigrateOnboardingDraftPolicyResult => {
  requireGmRole(input.role)
  const repository = repositoryOf(dependencies)
  const draft = repository.getDraft(input.draftId)
  if (!draft) throw new OnboardingUseCaseError(404, 'Draft not found')
  const active = repository.getActivePolicy()
  if (!active) throw new OnboardingUseCaseError(409, 'No active policy is published')
  if (input.apply && typeof input.operationId === 'string') {
    const replayed = journalReplay<Record<string, unknown> & MigrateOnboardingDraftPolicyResult>(
      repository,
      input.operationId,
      { draftId: draft.draft.draftId, toVersion: active.identity.version },
    )
    if (replayed) return replayed
  }
  if (active.identity.policyId === draft.draft.policyId && active.identity.version === draft.draft.policyVersion) {
    throw new OnboardingUseCaseError(409, 'Draft is already bound to the active policy version')
  }
  if (!canOwnerEditDraftContent(draft.state)) {
    throw new OnboardingUseCaseError(409, `Draft is ${draft.state}; migrate before submission or after requesting changes`)
  }

  const catalog = onboardingCreationCatalog()
  const validation = validateOnboardingPackage(
    {
      trainerBuild: draft.draft.trainerBuild,
      pokemonBuilds: draft.draft.pokemonBuilds,
      deferredDecisions: draft.draft.deferredDecisions,
    },
    active.content,
    catalog,
    { draftCatalogFingerprint: catalog.catalogFingerprint, profileBound: true },
  )

  if (!input.apply) {
    return {
      fromVersion: draft.draft.policyVersion,
      toVersion: active.identity.version,
      validation,
      applied: false,
    }
  }

  if (typeof input.expectedRevision !== 'number' || typeof input.operationId !== 'string') {
    throw new OnboardingUseCaseError(400, 'expectedRevision and operationId are required to apply a migration')
  }

  const result = journalledOperation(repository, input.operationId, 'migrate-policy', {
    draftId: draft.draft.draftId,
    toVersion: active.identity.version,
  }, () => {
    if (draft.revision !== input.expectedRevision) {
      throw new OnboardingUseCaseError(409, `Draft is at revision ${draft.revision}, not ${input.expectedRevision}`)
    }
    // Rebind identity and starter count shells if the new policy needs more/fewer.
    const starterCount = active.content.pokemon.starterCount
    const builds = [...draft.draft.pokemonBuilds]
    while (builds.length < starterCount) {
      builds.push({
        buildId: `starter-${builds.length + 1}`,
        speciesId: null,
        nickname: null,
        natureId: null,
        gender: null,
        abilityIds: [],
        moveIds: [],
        addedStats: { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 },
        heldItemId: null,
        caughtBallId: null,
        teamSlot: builds.length + 1,
      })
    }
    const trimmed = builds.slice(0, starterCount)
    const migrated = parseOnboardingDraft({
      ...draft.draft,
      policyId: active.identity.policyId,
      policyVersion: active.identity.version,
      pokemonBuilds: trimmed,
    })
    const saved = repository.saveDraftDocument({
      draftId: draft.draft.draftId,
      expectedRevision: input.expectedRevision,
      document: migrated,
      now: dependencies.now?.(),
    })
    // Rebind the slot to the new policy version for queue accuracy.
    repository.database.connection.prepare(
      'UPDATE onboarding_slots SET policy_id = ?, policy_version = ?, updated_at = ? WHERE slot_id = ?',
    ).run(active.identity.policyId, active.identity.version, saved.updatedAt, draft.draft.slotId)
    return {
      fromVersion: draft.draft.policyVersion,
      toVersion: active.identity.version,
      validation: validation as unknown as Record<string, unknown>,
      applied: true,
      revision: saved.revision,
    } as unknown as Record<string, unknown> & MigrateOnboardingDraftPolicyResult
  })

  ;(dependencies.publishDraftChanged ?? publishOnboardingDraftChanged)(draft.draft.profileId, {
    schemaVersion: 1,
    draftId: draft.draft.draftId,
    slotId: draft.draft.slotId,
    revision: result.revision ?? draft.revision + 1,
    state: draft.state,
    updatedAt: dependencies.now?.() ?? Date.now(),
    clientId: null,
  })
  return result
}
