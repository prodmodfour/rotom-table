import { createHash, randomUUID } from 'node:crypto'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { isPlayerProfileId } from '#shared/playerProfiles'
import {
  allocateOnboardingDraftId,
  allocateOnboardingPolicyId,
  allocateOnboardingSlotId,
  parseOnboardingDraftId,
  parseOnboardingPolicyId,
  parseOnboardingSlotId,
  type OnboardingDraftId,
  type OnboardingPolicyId,
  type OnboardingSlotId,
} from '#shared/onboarding/ids'
import {
  canonicalOnboardingPolicyContentString,
  parseCampaignOnboardingPolicyContent,
  type CampaignOnboardingPolicyContentV1,
  type PublishedOnboardingPolicyV1,
} from '#shared/onboarding/policy'
import {
  createEmptyOnboardingDraft,
  parseOnboardingDraft,
  type OnboardingDraftV1,
} from '#shared/onboarding/draft'
import {
  assertOnboardingTransition,
  isOnboardingDraftState,
  type OnboardingActor,
  type OnboardingDraftState,
} from '#shared/onboarding/lifecycle'
import type { RotomDatabase } from './database'
import { getRotomDatabase } from './database'

/* ------------------------------------------------------------------ */
/* Row/record types                                                   */
/* ------------------------------------------------------------------ */

export const ONBOARDING_SLOT_STATUSES = Object.freeze(['open', 'completed', 'cancelled', 'superseded'] as const)
export type OnboardingSlotStatus = typeof ONBOARDING_SLOT_STATUSES[number]

export interface OnboardingSlotRecord {
  readonly slotId: OnboardingSlotId
  readonly profileId: PlayerProfileId
  readonly policyId: OnboardingPolicyId
  readonly policyVersion: number
  readonly status: OnboardingSlotStatus
  readonly activeDraftId: OnboardingDraftId | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface StoredOnboardingDraft {
  readonly draft: OnboardingDraftV1
  readonly state: OnboardingDraftState
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface OnboardingSubmissionRecord {
  readonly draftId: OnboardingDraftId
  readonly submissionRevision: number
  readonly snapshot: OnboardingDraftV1
  readonly validation: unknown
  readonly policyContentHash: string
  readonly catalogFingerprint: string
  readonly createdAt: number
}

export const ONBOARDING_REVIEW_ENTRY_KINDS = Object.freeze([
  'change-request', 'player-response', 'correction', 'acknowledgement', 'approval-note',
] as const)
export type OnboardingReviewEntryKind = typeof ONBOARDING_REVIEW_ENTRY_KINDS[number]

export interface OnboardingReviewEntryRecord {
  readonly entryId: string
  readonly draftId: OnboardingDraftId
  readonly submissionRevision: number
  readonly kind: OnboardingReviewEntryKind
  readonly audience: 'table' | 'gm-only'
  readonly payload: Record<string, unknown>
  readonly createdAt: number
}

export const ONBOARDING_OPERATION_SCOPES = Object.freeze([
  'create-slot', 'submit', 'request-changes', 'respond', 'correct', 'acknowledge',
  'approve', 'commit', 'cancel', 'supersede', 'migrate-policy',
] as const)
export type OnboardingOperationScope = typeof ONBOARDING_OPERATION_SCOPES[number]

export interface OnboardingOperationRecord {
  readonly opId: string
  readonly scope: OnboardingOperationScope
  readonly payloadHash: string
  readonly result: Record<string, unknown>
  readonly createdAt: number
}

export interface OnboardingCompletionRecord {
  readonly completionId: string
  readonly slotId: OnboardingSlotId
  readonly draftId: OnboardingDraftId
  readonly submissionRevision: number
  readonly policyId: OnboardingPolicyId
  readonly policyVersion: number
  readonly refs: Record<string, unknown>
  readonly createdAt: number
}

export class OnboardingRepositoryError extends Error {
  readonly code:
    | 'not-found'
    | 'revision-conflict'
    | 'illegal-transition'
    | 'slot-conflict'
    | 'policy-conflict'
    | 'operation-conflict'
  constructor(code: OnboardingRepositoryError['code'], message: string) {
    super(message)
    this.name = 'OnboardingRepositoryError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export const onboardingPayloadHash = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex')

const nowOr = (value: number | undefined): number => {
  if (value !== undefined) {
    if (!Number.isInteger(value) || value < 0) throw new Error('timestamp must be a non-negative integer')
    return value
  }
  return Date.now()
}

const parseJsonColumn = (value: unknown, label: string): unknown => {
  if (typeof value !== 'string') throw new Error(`${label} must be stored JSON`)
  return JSON.parse(value)
}

/* ------------------------------------------------------------------ */
/* Repository                                                         */
/* ------------------------------------------------------------------ */

export interface PublishOnboardingPolicyInput {
  readonly content: unknown
  readonly display: { readonly name: string, readonly description?: string }
  /** Publish a new version of an existing policy line; omitted allocates a new line. */
  readonly policyId?: string
  readonly now?: number
}

export interface CreateOnboardingSlotInput {
  readonly profileId: unknown
  /** Fingerprint of the creation catalog the new draft binds to. */
  readonly catalogFingerprint: string
  readonly now?: number
}

export interface SaveOnboardingDraftInput {
  readonly draftId: unknown
  readonly expectedRevision: number
  readonly document: unknown
  readonly now?: number
}

export interface TransitionOnboardingDraftInput {
  readonly draftId: unknown
  readonly expectedRevision: number
  readonly to: OnboardingDraftState
  readonly actor: OnboardingActor
  readonly now?: number
}

export interface OnboardingRepository {
  readonly database: RotomDatabase
  publishPolicy(input: PublishOnboardingPolicyInput): PublishedOnboardingPolicyV1
  updatePolicyDisplay(policyId: unknown, version: number, display: { name: string, description?: string }): PublishedOnboardingPolicyV1 | null
  getActivePolicy(): PublishedOnboardingPolicyV1 | null
  getPolicy(policyId: unknown, version: number): PublishedOnboardingPolicyV1 | null
  listPolicyVersions(): readonly PublishedOnboardingPolicyV1[]
  createSlotWithDraft(input: CreateOnboardingSlotInput): { slot: OnboardingSlotRecord, draft: StoredOnboardingDraft }
  /** Immediately-completed slot used by existing-character intake provenance. */
  createIntakeSlot(input: { profileId: unknown, now?: number }): OnboardingSlotRecord
  getSlot(slotId: unknown): OnboardingSlotRecord | null
  findOpenSlotByProfile(profileId: unknown): OnboardingSlotRecord | null
  listSlots(): readonly OnboardingSlotRecord[]
  getDraft(draftId: unknown): StoredOnboardingDraft | null
  saveDraftDocument(input: SaveOnboardingDraftInput): StoredOnboardingDraft
  transitionDraft(input: TransitionOnboardingDraftInput): StoredOnboardingDraft
  createSubmission(input: {
    draftId: unknown
    submissionRevision: number
    snapshot: OnboardingDraftV1
    validation: unknown
    policyContentHash: string
    catalogFingerprint: string
    now?: number
  }): OnboardingSubmissionRecord
  getSubmission(draftId: unknown, submissionRevision: number): OnboardingSubmissionRecord | null
  listSubmissions(draftId: unknown): readonly OnboardingSubmissionRecord[]
  appendReviewEntry(input: {
    draftId: unknown
    submissionRevision: number
    kind: OnboardingReviewEntryKind
    audience: 'table' | 'gm-only'
    payload: Record<string, unknown>
    now?: number
  }): OnboardingReviewEntryRecord
  listReviewEntries(draftId: unknown, options?: { includeGmOnly?: boolean }): readonly OnboardingReviewEntryRecord[]
  findOperation(opId: string): OnboardingOperationRecord | null
  recordOperation(input: {
    opId: string
    scope: OnboardingOperationScope
    payloadHash: string
    result: Record<string, unknown>
    now?: number
  }): OnboardingOperationRecord
  recordCompletion(input: {
    completionId?: string
    slotId: unknown
    draftId: unknown
    submissionRevision: number
    refs: Record<string, unknown>
    now?: number
  }): OnboardingCompletionRecord
  getCompletionBySlot(slotId: unknown): OnboardingCompletionRecord | null
  listCompletions(): readonly OnboardingCompletionRecord[]
  closeSlot(slotId: unknown, status: Exclude<OnboardingSlotStatus, 'open'>, now?: number): OnboardingSlotRecord
}

export const createSqliteOnboardingRepository = (
  database: RotomDatabase = getRotomDatabase(),
): OnboardingRepository => {
  const rowToPolicy = (row: Record<string, unknown>): PublishedOnboardingPolicyV1 => ({
    identity: {
      policyId: parseOnboardingPolicyId(row.policy_id),
      version: Number(row.version),
      contentHash: String(row.content_hash),
      publishedAt: Number(row.published_at),
    },
    display: parseJsonColumn(row.display_json, 'display_json') as { name: string, description: string },
    content: parseCampaignOnboardingPolicyContent(parseJsonColumn(row.content_json, 'content_json')),
  })

  const rowToSlot = (row: Record<string, unknown>): OnboardingSlotRecord => ({
    slotId: parseOnboardingSlotId(row.slot_id),
    profileId: row.profile_id as PlayerProfileId,
    policyId: parseOnboardingPolicyId(row.policy_id),
    policyVersion: Number(row.policy_version),
    status: row.status as OnboardingSlotStatus,
    activeDraftId: row.active_draft_id === null ? null : parseOnboardingDraftId(row.active_draft_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  })

  const rowToDraft = (row: Record<string, unknown>): StoredOnboardingDraft => {
    const document = parseOnboardingDraft(parseJsonColumn(row.document_json, 'document_json'))
    const state = row.state
    if (!isOnboardingDraftState(state)) throw new Error(`onboarding draft row has illegal state ${String(state)}`)
    if (document.state !== state || document.revision !== Number(row.revision)) {
      throw new Error(`onboarding draft ${document.draftId} row/document state drift`)
    }
    return {
      draft: document,
      state,
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  const rowToSubmission = (row: Record<string, unknown>): OnboardingSubmissionRecord => ({
    draftId: parseOnboardingDraftId(row.draft_id),
    submissionRevision: Number(row.submission_revision),
    snapshot: parseOnboardingDraft(parseJsonColumn(row.snapshot_json, 'snapshot_json')),
    validation: parseJsonColumn(row.validation_json, 'validation_json'),
    policyContentHash: String(row.policy_content_hash),
    catalogFingerprint: String(row.catalog_fingerprint),
    createdAt: Number(row.created_at),
  })

  const getPolicyRow = (policyId: string, version: number): Record<string, unknown> | null =>
    (database.connection.prepare(
      'SELECT * FROM onboarding_policies WHERE policy_id = ? AND version = ?',
    ).get(policyId, version) as Record<string, unknown> | undefined) ?? null

  const getDraftRow = (draftId: string): Record<string, unknown> | null =>
    (database.connection.prepare(
      'SELECT * FROM onboarding_drafts WHERE draft_id = ?',
    ).get(draftId) as Record<string, unknown> | undefined) ?? null

  const writeDraft = (draft: OnboardingDraftV1, createdAt: number): void => {
    database.connection.prepare(`
      UPDATE onboarding_drafts
      SET state = ?, revision = ?, document_json = ?, updated_at = ?
      WHERE draft_id = ?
    `).run(draft.state, draft.revision, JSON.stringify(draft), draft.updatedAt, draft.draftId)
    void createdAt
  }

  const touchSlot = (slotId: string, now: number): void => {
    database.connection.prepare('UPDATE onboarding_slots SET updated_at = ? WHERE slot_id = ?')
      .run(now, slotId)
  }

  return {
    database,

    publishPolicy: (input) => database.withTransaction(() => {
      const content = parseCampaignOnboardingPolicyContent(input.content)
      const now = nowOr(input.now)
      const policyId = input.policyId === undefined
        ? allocateOnboardingPolicyId()
        : parseOnboardingPolicyId(input.policyId)
      const latest = database.connection.prepare(
        'SELECT MAX(version) AS latest FROM onboarding_policies WHERE policy_id = ?',
      ).get(policyId) as { latest: number | null }
      if (input.policyId !== undefined && (latest.latest ?? 0) === 0) {
        throw new OnboardingRepositoryError('policy-conflict', `policy ${policyId} does not exist; omit policyId to create a new line`)
      }
      const version = (latest.latest ?? 0) + 1
      const contentHash = createHash('sha256')
        .update(canonicalOnboardingPolicyContentString(content))
        .digest('hex')
      const display = {
        name: input.display.name,
        description: input.display.description ?? '',
      }
      database.connection.prepare('UPDATE onboarding_policies SET is_active = 0 WHERE is_active = 1').run()
      database.connection.prepare(`
        INSERT INTO onboarding_policies (policy_id, version, content_json, display_json, content_hash, published_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(policyId, version, JSON.stringify(content), JSON.stringify(display), contentHash, now)
      return rowToPolicy(getPolicyRow(policyId, version)!)
    }),

    updatePolicyDisplay: (policyIdInput, version, display) => database.withTransaction(() => {
      const policyId = parseOnboardingPolicyId(policyIdInput)
      const row = getPolicyRow(policyId, version)
      if (!row) return null
      database.connection.prepare('UPDATE onboarding_policies SET display_json = ? WHERE policy_id = ? AND version = ?')
        .run(JSON.stringify({ name: display.name, description: display.description ?? '' }), policyId, version)
      return rowToPolicy(getPolicyRow(policyId, version)!)
    }),

    getActivePolicy: () => {
      const row = database.connection.prepare(
        'SELECT * FROM onboarding_policies WHERE is_active = 1',
      ).get() as Record<string, unknown> | undefined
      return row ? rowToPolicy(row) : null
    },

    getPolicy: (policyIdInput, version) => {
      const policyId = parseOnboardingPolicyId(policyIdInput)
      const row = getPolicyRow(policyId, version)
      return row ? rowToPolicy(row) : null
    },

    listPolicyVersions: () => (database.connection.prepare(
      'SELECT * FROM onboarding_policies ORDER BY published_at DESC, policy_id, version DESC',
    ).all() as Record<string, unknown>[]).map(rowToPolicy),

    createSlotWithDraft: (input) => database.withTransaction(() => {
      if (!isPlayerProfileId(input.profileId)) {
        throw new OnboardingRepositoryError('slot-conflict', 'profileId must be a player profile ID')
      }
      const activeRow = database.connection.prepare(
        'SELECT * FROM onboarding_policies WHERE is_active = 1',
      ).get() as Record<string, unknown> | undefined
      if (!activeRow) {
        throw new OnboardingRepositoryError('policy-conflict', 'no active onboarding policy is published')
      }
      const policy = rowToPolicy(activeRow)
      const existing = database.connection.prepare(
        "SELECT * FROM onboarding_slots WHERE profile_id = ? AND status = 'open'",
      ).get(input.profileId) as Record<string, unknown> | undefined
      if (existing) {
        throw new OnboardingRepositoryError('slot-conflict', `profile ${input.profileId} already has an open onboarding slot`)
      }
      const now = nowOr(input.now)
      const slotId = allocateOnboardingSlotId()
      const draftId = allocateOnboardingDraftId()
      const draft = createEmptyOnboardingDraft({
        draftId,
        slotId,
        profileId: input.profileId,
        policyId: policy.identity.policyId,
        policyVersion: policy.identity.version,
        starterCount: policy.content.pokemon.starterCount,
        catalogFingerprint: input.catalogFingerprint,
        now,
      })
      database.connection.prepare(`
        INSERT INTO onboarding_slots (slot_id, profile_id, policy_id, policy_version, status, active_draft_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
      `).run(slotId, input.profileId, policy.identity.policyId, policy.identity.version, draftId, now, now)
      database.connection.prepare(`
        INSERT INTO onboarding_drafts (draft_id, slot_id, state, revision, document_json, created_at, updated_at)
        VALUES (?, ?, 'draft', 0, ?, ?, ?)
      `).run(draftId, slotId, JSON.stringify(draft), now, now)
      const slot = rowToSlot(database.connection.prepare(
        'SELECT * FROM onboarding_slots WHERE slot_id = ?',
      ).get(slotId) as Record<string, unknown>)
      return { slot, draft: rowToDraft(getDraftRow(draftId)!) }
    }),

    createIntakeSlot: (input) => database.withTransaction(() => {
      if (!isPlayerProfileId(input.profileId)) {
        throw new OnboardingRepositoryError('slot-conflict', 'profileId must be a player profile ID')
      }
      const activeRow = database.connection.prepare(
        'SELECT * FROM onboarding_policies WHERE is_active = 1',
      ).get() as Record<string, unknown> | undefined
      if (!activeRow) {
        throw new OnboardingRepositoryError('policy-conflict', 'no active onboarding policy is published')
      }
      const policy = rowToPolicy(activeRow)
      const now = nowOr(input.now)
      const slotId = allocateOnboardingSlotId()
      database.connection.prepare(`
        INSERT INTO onboarding_slots (slot_id, profile_id, policy_id, policy_version, status, active_draft_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'completed', NULL, ?, ?)
      `).run(slotId, input.profileId, policy.identity.policyId, policy.identity.version, now, now)
      return rowToSlot(database.connection.prepare(
        'SELECT * FROM onboarding_slots WHERE slot_id = ?',
      ).get(slotId) as Record<string, unknown>)
    }),

    getSlot: (slotIdInput) => {
      const slotId = parseOnboardingSlotId(slotIdInput)
      const row = database.connection.prepare('SELECT * FROM onboarding_slots WHERE slot_id = ?')
        .get(slotId) as Record<string, unknown> | undefined
      return row ? rowToSlot(row) : null
    },

    findOpenSlotByProfile: (profileId) => {
      if (!isPlayerProfileId(profileId)) return null
      const row = database.connection.prepare(
        "SELECT * FROM onboarding_slots WHERE profile_id = ? AND status = 'open'",
      ).get(profileId) as Record<string, unknown> | undefined
      return row ? rowToSlot(row) : null
    },

    listSlots: () => (database.connection.prepare(
      'SELECT * FROM onboarding_slots ORDER BY created_at, slot_id',
    ).all() as Record<string, unknown>[]).map(rowToSlot),

    getDraft: (draftIdInput) => {
      const draftId = parseOnboardingDraftId(draftIdInput)
      const row = getDraftRow(draftId)
      return row ? rowToDraft(row) : null
    },

    saveDraftDocument: (input) => database.withTransaction(() => {
      const draftId = parseOnboardingDraftId(input.draftId)
      const row = getDraftRow(draftId)
      if (!row) throw new OnboardingRepositoryError('not-found', `draft ${draftId} does not exist`)
      const current = rowToDraft(row)
      if (current.revision !== input.expectedRevision) {
        throw new OnboardingRepositoryError('revision-conflict', `draft ${draftId} is at revision ${current.revision}, not ${input.expectedRevision}`)
      }
      const now = nowOr(input.now)
      const parsed = parseOnboardingDraft(input.document)
      if (parsed.draftId !== draftId || parsed.slotId !== current.draft.slotId || parsed.profileId !== current.draft.profileId) {
        throw new OnboardingRepositoryError('revision-conflict', 'draft identity fields cannot change on save')
      }
      if (parsed.state !== current.state) {
        throw new OnboardingRepositoryError('illegal-transition', 'draft saves cannot change lifecycle state; use transitionDraft')
      }
      const next: OnboardingDraftV1 = {
        ...parsed,
        revision: current.revision + 1,
        updatedAt: now,
      }
      writeDraft(next, current.createdAt)
      touchSlot(next.slotId, now)
      return rowToDraft(getDraftRow(draftId)!)
    }),

    transitionDraft: (input) => database.withTransaction(() => {
      const draftId = parseOnboardingDraftId(input.draftId)
      const row = getDraftRow(draftId)
      if (!row) throw new OnboardingRepositoryError('not-found', `draft ${draftId} does not exist`)
      const current = rowToDraft(row)
      if (current.revision !== input.expectedRevision) {
        throw new OnboardingRepositoryError('revision-conflict', `draft ${draftId} is at revision ${current.revision}, not ${input.expectedRevision}`)
      }
      try {
        assertOnboardingTransition(current.state, input.to, input.actor)
      } catch (error) {
        throw new OnboardingRepositoryError('illegal-transition', error instanceof Error ? error.message : 'illegal transition')
      }
      const now = nowOr(input.now)
      const next: OnboardingDraftV1 = {
        ...current.draft,
        state: input.to,
        revision: current.revision + 1,
        updatedAt: now,
        submissionRevision: input.to === 'submitted'
          ? current.draft.submissionRevision + 1
          : current.draft.submissionRevision,
      }
      writeDraft(next, current.createdAt)
      touchSlot(next.slotId, now)
      return rowToDraft(getDraftRow(draftId)!)
    }),

    createSubmission: (input) => database.withTransaction(() => {
      const draftId = parseOnboardingDraftId(input.draftId)
      const now = nowOr(input.now)
      database.connection.prepare(`
        INSERT INTO onboarding_submissions (draft_id, submission_revision, snapshot_json, validation_json, policy_content_hash, catalog_fingerprint, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        draftId,
        input.submissionRevision,
        JSON.stringify(input.snapshot),
        JSON.stringify(input.validation ?? null),
        input.policyContentHash,
        input.catalogFingerprint,
        now,
      )
      return rowToSubmission(database.connection.prepare(
        'SELECT * FROM onboarding_submissions WHERE draft_id = ? AND submission_revision = ?',
      ).get(draftId, input.submissionRevision) as Record<string, unknown>)
    }),

    getSubmission: (draftIdInput, submissionRevision) => {
      const draftId = parseOnboardingDraftId(draftIdInput)
      const row = database.connection.prepare(
        'SELECT * FROM onboarding_submissions WHERE draft_id = ? AND submission_revision = ?',
      ).get(draftId, submissionRevision) as Record<string, unknown> | undefined
      return row ? rowToSubmission(row) : null
    },

    listSubmissions: (draftIdInput) => {
      const draftId = parseOnboardingDraftId(draftIdInput)
      return (database.connection.prepare(
        'SELECT * FROM onboarding_submissions WHERE draft_id = ? ORDER BY submission_revision',
      ).all(draftId) as Record<string, unknown>[]).map(rowToSubmission)
    },

    appendReviewEntry: (input) => database.withTransaction(() => {
      const draftId = parseOnboardingDraftId(input.draftId)
      const now = nowOr(input.now)
      const entryId = `onbrev-${randomUUID()}`
      database.connection.prepare(`
        INSERT INTO onboarding_review_entries (entry_id, draft_id, submission_revision, kind, audience, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(entryId, draftId, input.submissionRevision, input.kind, input.audience, JSON.stringify(input.payload), now)
      return {
        entryId,
        draftId,
        submissionRevision: input.submissionRevision,
        kind: input.kind,
        audience: input.audience,
        payload: input.payload,
        createdAt: now,
      }
    }),

    listReviewEntries: (draftIdInput, options = {}) => {
      const draftId = parseOnboardingDraftId(draftIdInput)
      const rows = database.connection.prepare(
        options.includeGmOnly === true
          ? 'SELECT * FROM onboarding_review_entries WHERE draft_id = ? ORDER BY created_at, entry_id'
          : "SELECT * FROM onboarding_review_entries WHERE draft_id = ? AND audience = 'table' ORDER BY created_at, entry_id",
      ).all(draftId) as Record<string, unknown>[]
      return rows.map(row => ({
        entryId: String(row.entry_id),
        draftId,
        submissionRevision: Number(row.submission_revision),
        kind: row.kind as OnboardingReviewEntryKind,
        audience: row.audience as 'table' | 'gm-only',
        payload: parseJsonColumn(row.payload_json, 'payload_json') as Record<string, unknown>,
        createdAt: Number(row.created_at),
      }))
    },

    findOperation: (opId) => {
      const row = database.connection.prepare('SELECT * FROM onboarding_ops WHERE op_id = ?')
        .get(opId) as Record<string, unknown> | undefined
      if (!row) return null
      return {
        opId: String(row.op_id),
        scope: row.scope as OnboardingOperationScope,
        payloadHash: String(row.payload_hash),
        result: parseJsonColumn(row.result_json, 'result_json') as Record<string, unknown>,
        createdAt: Number(row.created_at),
      }
    },

    recordOperation: (input) => database.withTransaction(() => {
      const now = nowOr(input.now)
      database.connection.prepare(`
        INSERT INTO onboarding_ops (op_id, scope, payload_hash, result_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.opId, input.scope, input.payloadHash, JSON.stringify(input.result), now)
      return { opId: input.opId, scope: input.scope, payloadHash: input.payloadHash, result: input.result, createdAt: now }
    }),

    recordCompletion: (input) => database.withTransaction(() => {
      const slotId = parseOnboardingSlotId(input.slotId)
      const draftId = parseOnboardingDraftId(input.draftId)
      const slotRow = database.connection.prepare('SELECT * FROM onboarding_slots WHERE slot_id = ?')
        .get(slotId) as Record<string, unknown> | undefined
      if (!slotRow) throw new OnboardingRepositoryError('not-found', `slot ${slotId} does not exist`)
      const now = nowOr(input.now)
      const completionId = input.completionId ?? `onbdone-${randomUUID()}`
      database.connection.prepare(`
        INSERT INTO onboarding_completions (completion_id, slot_id, draft_id, submission_revision, policy_id, policy_version, refs_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        completionId,
        slotId,
        draftId,
        input.submissionRevision,
        String(slotRow.policy_id),
        Number(slotRow.policy_version),
        JSON.stringify(input.refs),
        now,
      )
      return {
        completionId,
        slotId,
        draftId,
        submissionRevision: input.submissionRevision,
        policyId: parseOnboardingPolicyId(slotRow.policy_id),
        policyVersion: Number(slotRow.policy_version),
        refs: input.refs,
        createdAt: now,
      }
    }),

    getCompletionBySlot: (slotIdInput) => {
      const slotId = parseOnboardingSlotId(slotIdInput)
      const row = database.connection.prepare('SELECT * FROM onboarding_completions WHERE slot_id = ?')
        .get(slotId) as Record<string, unknown> | undefined
      if (!row) return null
      return {
        completionId: String(row.completion_id),
        slotId,
        draftId: parseOnboardingDraftId(row.draft_id),
        submissionRevision: Number(row.submission_revision),
        policyId: parseOnboardingPolicyId(row.policy_id),
        policyVersion: Number(row.policy_version),
        refs: parseJsonColumn(row.refs_json, 'refs_json') as Record<string, unknown>,
        createdAt: Number(row.created_at),
      }
    },

    listCompletions: () => (database.connection.prepare(
      'SELECT * FROM onboarding_completions ORDER BY created_at DESC, completion_id',
    ).all() as Record<string, unknown>[]).map(row => ({
      completionId: String(row.completion_id),
      slotId: parseOnboardingSlotId(row.slot_id),
      draftId: parseOnboardingDraftId(row.draft_id),
      submissionRevision: Number(row.submission_revision),
      policyId: parseOnboardingPolicyId(row.policy_id),
      policyVersion: Number(row.policy_version),
      refs: parseJsonColumn(row.refs_json, 'refs_json') as Record<string, unknown>,
      createdAt: Number(row.created_at),
    })),

    closeSlot: (slotIdInput, status, nowInput) => database.withTransaction(() => {
      const slotId = parseOnboardingSlotId(slotIdInput)
      const row = database.connection.prepare('SELECT * FROM onboarding_slots WHERE slot_id = ?')
        .get(slotId) as Record<string, unknown> | undefined
      if (!row) throw new OnboardingRepositoryError('not-found', `slot ${slotId} does not exist`)
      const now = nowOr(nowInput)
      database.connection.prepare('UPDATE onboarding_slots SET status = ?, updated_at = ? WHERE slot_id = ?')
        .run(status, now, slotId)
      return rowToSlot(database.connection.prepare('SELECT * FROM onboarding_slots WHERE slot_id = ?')
        .get(slotId) as Record<string, unknown>)
    }),
  }
}

let defaultRepository: OnboardingRepository | null = null

export const sqliteOnboardingRepository = (): OnboardingRepository => {
  if (!defaultRepository) defaultRepository = createSqliteOnboardingRepository()
  return defaultRepository
}
