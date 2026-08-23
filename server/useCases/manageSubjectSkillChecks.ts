import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  type RespondSkillCheckCommandV1,
  type SkillCheckCommandV1,
  type SkillCheckDocumentV1,
  type SkillCheckSubjectV1,
  type SkillCheckState,
  type TimeoutSkillCheckCommandV1,
} from '#shared/skillChecks/contract'
import { parseSkillCheckCommand, parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import type {
  LoadSubjectSkillChecksResponseV1,
  RespondSubjectSkillCheckReceiptV1,
  RespondSubjectSkillCheckResponseV1,
  SkillCheckSubjectRequestViewV1,
} from '#shared/skillChecks/subjectWorkflow'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildSkillCheckSubjectRequestView } from '../domain/skillChecks/subjectProjection'
import { publishCampaignAttentionInvalidation } from '../realtime/campaignAttentionRealtime'
import { previewSkillCheckSubjectModifiers, type SkillCheckSubjectSheetSnapshot } from '../domain/skillChecks/resolveCheck'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  SkillCheckRepositoryError,
  createSqliteSkillCheckRepository,
  skillCheckCommandSha256,
  type SkillCheckOperationResultV1,
  type SkillCheckRepository,
  type StoredSkillCheckOperationV1,
} from '../storage/skillCheckRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export type SubjectSkillCheckAuthority =
  | { readonly kind: 'gm', readonly principalId: string }
  | { readonly kind: 'profile', readonly profile: PlayerProfile }

export interface SubjectSkillCheckDependencies {
  readonly database?: RotomDatabase
  readonly skillCheckRepository?: SkillCheckRepository
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'get'> & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: CampaignClockRepository
  readonly now?: () => number
  readonly publishAttention?: typeof publishCampaignAttentionInvalidation
  readonly failAfterWrite?: (boundary: 'document' | 'operation') => void
}

export interface LoadSubjectSkillChecksInput {
  readonly authority: SubjectSkillCheckAuthority
  readonly states?: readonly SkillCheckState[]
  readonly limit?: number
}

export interface RespondSubjectSkillCheckInput {
  readonly authority: SubjectSkillCheckAuthority
  readonly command: unknown
}

export interface TimeoutExpiredSkillChecksResponseV1 {
  readonly schemaVersion: 1
  readonly observedAt: number
  readonly campaignMinute: number
  readonly timedOutCheckIds: readonly string[]
}

export class SubjectSkillCheckWorkflowError extends UseCaseHttpError<400 | 403 | 404 | 409> {
  readonly code:
    | 'invalid-command'
    | 'forbidden'
    | 'not-found'
    | 'revision-conflict'
    | 'operation-conflict'
    | 'state-conflict'
    | 'expired'
    | 'skill-authority-unavailable'
    | 'repository-mismatch'

  constructor(statusCode: 400 | 403 | 404 | 409, code: SubjectSkillCheckWorkflowError['code'], message: string) {
    super(statusCode, message)
    this.code = code
  }
}

const fail = (
  statusCode: 400 | 403 | 404 | 409,
  code: SubjectSkillCheckWorkflowError['code'],
  message: string,
): never => { throw new SubjectSkillCheckWorkflowError(statusCode, code, message) }

const digest = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const principalFor = (authority: SubjectSkillCheckAuthority): { readonly key: string, readonly id: string } => {
  if (authority.kind === 'profile') {
    return Object.freeze({ key: `profile:${authority.profile.id}`, id: String(authority.profile.id) })
  }
  const principalId = authority.principalId.trim()
  if (!principalId || principalId.length > 200 || /[\u0000-\u001f\u007f]/u.test(principalId)) {
    return fail(403, 'forbidden', 'A bounded GM principal identity is required.')
  }
  return Object.freeze({ key: `gm:${principalId}`, id: `gm:${principalId}` })
}

const databaseFor = (dependencies: SubjectSkillCheckDependencies): RotomDatabase => {
  const candidates = [
    dependencies.skillCheckRepository?.database,
    dependencies.sheetRepository?.database,
    dependencies.campaignClockRepository?.database,
  ].filter((candidate): candidate is RotomDatabase => Boolean(candidate))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    return fail(409, 'repository-mismatch', 'Skill Check workflow repositories must share one RotomDatabase.')
  }
  return database
}

const subjectAuthorized = (
  authority: SubjectSkillCheckAuthority,
  subject: SkillCheckSubjectV1,
): boolean => authority.kind === 'gm' || subject.controllerProfileIds.includes(String(authority.profile.id))

const snapshotFor = (
  subject: SkillCheckSubjectV1,
  sheets: Pick<SheetRepository<Record<string, unknown>>, 'get'>,
): SkillCheckSubjectSheetSnapshot | undefined => {
  const stored = sheets.get(subject.kind, subject.sheetSlug)
  if (!stored) return undefined
  return Object.freeze({
    kind: subject.kind,
    slug: stored.slug,
    revision: stored.revision,
    sheet: stored.document as unknown as CharacterSheet | TrainerSheet,
  })
}

const viewFor = (input: {
  readonly document: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly sheets: Pick<SheetRepository<Record<string, unknown>>, 'get'>
  readonly now: number
}): SkillCheckSubjectRequestViewV1 => buildSkillCheckSubjectRequestView({
  document: input.document,
  subject: input.subject,
  snapshot: snapshotFor(input.subject, input.sheets),
  now: input.now,
})

export const loadSubjectSkillChecksUseCase = (
  input: LoadSubjectSkillChecksInput,
  dependencies: SubjectSkillCheckDependencies = {},
): LoadSubjectSkillChecksResponseV1 => {
  principalFor(input.authority)
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const now = dependencies.now?.() ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0) return fail(409, 'state-conflict', 'Skill Check projection time is invalid.')
  const requests: SkillCheckSubjectRequestViewV1[] = []
  for (const stored of checks.list({ states: input.states, limit: input.limit ?? 500 })) {
    for (const subject of stored.document.subjects) {
      if (!subjectAuthorized(input.authority, subject)) continue
      requests.push(viewFor({ document: stored.document, subject, sheets, now }))
      if (requests.length >= 500) break
    }
    if (requests.length >= 500) break
  }
  return Object.freeze({
    schemaVersion: 1,
    requests: Object.freeze(requests),
    serverNow: now,
  })
}

const parseRespondCommand = (value: unknown): RespondSkillCheckCommandV1 => {
  let command: SkillCheckCommandV1
  try { command = parseSkillCheckCommand(value) }
  catch { return fail(400, 'invalid-command', 'Invalid subject Skill Check response command.') }
  if (command.commandKind !== 'respond') {
    return fail(400, 'invalid-command', 'Subject Skill Check workflow accepts only response commands.')
  }
  return command
}

const operationResult = (
  command: RespondSkillCheckCommandV1 | TimeoutSkillCheckCommandV1,
  document: SkillCheckDocumentV1,
): SkillCheckOperationResultV1 => Object.freeze({
  schemaVersion: 1,
  operationId: command.operationId,
  checkId: command.checkId,
  commandKind: command.commandKind,
  revision: document.revision,
  state: document.state,
  updatedAt: document.updatedAt,
})

const receiptFromOperation = (
  operation: StoredSkillCheckOperationV1,
  command: RespondSkillCheckCommandV1,
  exactReplay: boolean,
): RespondSubjectSkillCheckReceiptV1 => Object.freeze({
  schemaVersion: 1,
  operationId: command.operationId,
  checkId: command.checkId,
  subjectId: command.subjectId,
  commandKind: 'respond',
  revision: operation.result.revision,
  state: operation.result.state,
  response: command.decision === 'accept' ? 'accepted' : 'declined',
  updatedAt: operation.result.updatedAt,
  exactReplay,
})

const historyId = (operationId: string, kind: 'responded' | 'timed-out'): string => (
  `skill-check-history:v1:${digest({ operationId, kind }).slice(0, 40)}`
)

const authorizeCommandSubject = (input: {
  readonly document: SkillCheckDocumentV1
  readonly command: RespondSkillCheckCommandV1
  readonly authority: SubjectSkillCheckAuthority
}): SkillCheckSubjectV1 => {
  const subject = input.document.subjects.find(candidate => candidate.subjectId === input.command.subjectId)
    ?? fail(404, 'not-found', 'Skill Check subject was not found.')
  if (!subjectAuthorized(input.authority, subject)) {
    return fail(403, 'forbidden', 'This profile does not control the requested Skill Check subject.')
  }
  return subject
}

const replayOrConflict = (input: {
  readonly operation: StoredSkillCheckOperationV1
  readonly command: RespondSkillCheckCommandV1
  readonly authority: SubjectSkillCheckAuthority
  readonly principalKey: string
  readonly checks: SkillCheckRepository
  readonly sheets: Pick<SheetRepository<Record<string, unknown>>, 'get'>
}): RespondSubjectSkillCheckResponseV1 => {
  if (input.operation.commandSha256 !== skillCheckCommandSha256(input.command)) {
    return fail(409, 'operation-conflict', 'Skill Check response operation ID was reused with changed input.')
  }
  if (input.operation.principalKey !== input.principalKey) {
    return fail(403, 'forbidden', 'Skill Check response replay belongs to a different principal.')
  }
  const stored = input.checks.get(input.command.checkId)
    ?? fail(404, 'not-found', 'Skill Check replay document is missing.')
  const subject = authorizeCommandSubject({ document: stored.document, command: input.command, authority: input.authority })
  return Object.freeze({
    schemaVersion: 1,
    receipt: receiptFromOperation(input.operation, input.command, true),
    request: viewFor({ document: stored.document, subject, sheets: input.sheets, now: stored.document.updatedAt }),
  })
}

const respondedDocument = (input: {
  readonly current: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly command: RespondSkillCheckCommandV1
  readonly snapshot: SkillCheckSubjectSheetSnapshot | undefined
  readonly now: number
}): SkillCheckDocumentV1 => {
  if (input.current.state !== 'pending') return fail(409, 'state-conflict', 'Only pending Skill Checks accept subject responses.')
  if (input.subject.response !== 'pending') return fail(409, 'state-conflict', 'This Skill Check subject already responded.')
  if (!Number.isSafeInteger(input.now) || input.now < input.current.updatedAt) {
    return fail(409, 'state-conflict', 'Skill Check response time is stale or invalid.')
  }
  if (input.current.expiresAt !== null && input.now >= input.current.expiresAt) {
    return fail(409, 'expired', 'This Skill Check request has expired and awaits server timeout.')
  }
  try {
    previewSkillCheckSubjectModifiers({
      document: input.current,
      subject: input.subject,
      subjectSheet: input.snapshot,
    })
  }
  catch {
    return fail(409, 'skill-authority-unavailable', 'The authoritative subject skill is stale or unavailable.')
  }
  if (input.current.history.length >= 5000) return fail(409, 'state-conflict', 'Skill Check response history is full.')
  const response = input.command.decision === 'accept' ? 'accepted' as const : 'declined' as const
  const subjects = input.current.subjects.map(subject => subject.subjectId === input.subject.subjectId
    ? Object.freeze({ ...subject, response, respondedAt: input.now })
    : subject)
  const state = subjects.every(subject => subject.response === 'accepted') ? 'ready' as const : 'pending' as const
  return parseSkillCheckDocument({
    ...input.current,
    revision: input.current.revision + 1,
    state,
    subjects,
    history: [...input.current.history, {
      historyId: historyId(input.command.operationId, 'responded'),
      kind: 'responded',
      operationId: input.command.operationId,
      subjectId: input.subject.subjectId,
      headline: input.command.decision === 'accept' ? 'Subject accepted Skill Check' : 'Subject declined Skill Check',
      createdAt: input.now,
    }],
    updatedAt: input.now,
    lastOperationId: input.command.operationId,
  })
}

const mapRepositoryError = (error: unknown): never => {
  if (!(error instanceof SkillCheckRepositoryError)) throw error
  if (error.code === 'not-found') return fail(404, 'not-found', error.message)
  if (error.code === 'revision-conflict') return fail(409, 'revision-conflict', error.message)
  return fail(409, 'operation-conflict', error.message)
}

export const respondSubjectSkillCheckUseCase = (
  input: RespondSubjectSkillCheckInput,
  dependencies: SubjectSkillCheckDependencies = {},
): RespondSubjectSkillCheckResponseV1 => {
  const command = parseRespondCommand(input.command)
  const principal = principalFor(input.authority)
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const initialOperation = checks.findOperation(command.operationId)
  if (initialOperation) {
    return replayOrConflict({
      operation: initialOperation, command, authority: input.authority, principalKey: principal.key,
      checks, sheets,
    })
  }
  const publication: { document: SkillCheckDocumentV1 | null } = { document: null }
  try {
    const response = database.withTransaction(() => {
      const operation = checks.findOperation(command.operationId)
      if (operation) {
        return replayOrConflict({
          operation, command, authority: input.authority, principalKey: principal.key,
          checks, sheets,
        })
      }
      const stored = checks.get(command.checkId) ?? fail(404, 'not-found', 'Skill Check was not found.')
      if (stored.revision !== command.expectedRevision) {
        return fail(409, 'revision-conflict', `Skill Check is stale; current revision is ${stored.revision}.`)
      }
      const subject = authorizeCommandSubject({ document: stored.document, command, authority: input.authority })
      const now = dependencies.now?.() ?? Date.now()
      const next = respondedDocument({
        current: stored.document,
        subject,
        command,
        snapshot: snapshotFor(subject, sheets),
        now,
      })
      checks.replace(command.expectedRevision, next)
      dependencies.failAfterWrite?.('document')
      const recorded = checks.recordOperation({
        principalKey: principal.key,
        command,
        result: operationResult(command, next),
        createdAt: now,
      })
      dependencies.failAfterWrite?.('operation')
      publication.document = next
      return Object.freeze({
        schemaVersion: 1,
        receipt: receiptFromOperation(recorded, command, false),
        request: viewFor({ document: next, subject: next.subjects.find(candidate => candidate.subjectId === subject.subjectId)!, sheets, now }),
      })
    })
    if (publication.document && dependencies.publishAttention) {
      try {
        dependencies.publishAttention({
          cause: 'skill-check-operation',
          profileIds: [...new Set(publication.document.subjects.flatMap(subject => subject.controllerProfileIds))],
        })
      }
      catch (error) {
        console.error('[campaign-attention] Skill Check invalidation publication failed', error)
      }
    }
    return response
  }
  catch (error) { return mapRepositoryError(error) }
}

const timeoutCommand = (document: SkillCheckDocumentV1, campaignMinute: number): TimeoutSkillCheckCommandV1 => parseSkillCheckCommand({
  schemaVersion: 1,
  operationId: `skill-check-op:v1:timeout_${digest({
    checkId: document.checkId,
    revision: document.revision,
    expiresAt: document.expiresAt,
  }).slice(0, 40)}`,
  expectedRevision: document.revision,
  commandKind: 'timeout',
  checkId: document.checkId,
  campaignMinute,
}) as TimeoutSkillCheckCommandV1

const timedOutDocument = (input: {
  readonly current: SkillCheckDocumentV1
  readonly command: TimeoutSkillCheckCommandV1
  readonly now: number
}): SkillCheckDocumentV1 => parseSkillCheckDocument({
  ...input.current,
  revision: input.current.revision + 1,
  state: 'timed-out',
  history: [...input.current.history, {
    historyId: historyId(input.command.operationId, 'timed-out'),
    kind: 'timed-out',
    operationId: input.command.operationId,
    subjectId: null,
    headline: 'Skill Check timed out',
    createdAt: input.now,
  }],
  updatedAt: input.now,
  terminalAt: input.now,
  lastOperationId: input.command.operationId,
})

export const timeoutExpiredSkillChecksUseCase = (
  dependencies: SubjectSkillCheckDependencies = {},
): TimeoutExpiredSkillChecksResponseV1 => {
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const clock = dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database)
  const observedAt = dependencies.now?.() ?? Date.now()
  const campaignMinute = clock.get().campaignMinute
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) return fail(409, 'state-conflict', 'Skill Check timeout time is invalid.')
  const timedOut: string[] = []
  const affectedProfileIds = new Set<string>()
  const candidates = checks.list({ states: ['pending', 'ready'], limit: 500 })
    .filter(stored => stored.document.expiresAt !== null && stored.document.expiresAt <= observedAt)
  for (const candidate of candidates) {
    try {
      const changed = database.withTransaction(() => {
        const current = checks.get(candidate.document.checkId)
        if (!current || (current.state !== 'pending' && current.state !== 'ready')
          || current.document.expiresAt === null || current.document.expiresAt > observedAt) return false
        if (current.document.history.length >= 5000) {
          return fail(409, 'state-conflict', 'Skill Check timeout history is full.')
        }
        const command = timeoutCommand(current.document, campaignMinute)
        const existing = checks.findOperation(command.operationId)
        if (existing) return false
        const next = timedOutDocument({ current: current.document, command, now: observedAt })
        checks.replace(current.revision, next)
        dependencies.failAfterWrite?.('document')
        checks.recordOperation({
          principalKey: 'server:skill-check-timeout',
          command,
          result: operationResult(command, next),
          createdAt: observedAt,
        })
        dependencies.failAfterWrite?.('operation')
        return true
      })
      if (changed) {
        timedOut.push(candidate.document.checkId)
        for (const subject of candidate.document.subjects) {
          for (const profileId of subject.controllerProfileIds) affectedProfileIds.add(profileId)
        }
      }
    }
    catch (error) {
      if (error instanceof SkillCheckRepositoryError && error.code === 'revision-conflict') continue
      throw error
    }
  }
  if (timedOut.length > 0 && dependencies.publishAttention) {
    try {
      dependencies.publishAttention({
        cause: 'skill-check-operation',
        profileIds: [...affectedProfileIds],
      })
    }
    catch (error) {
      console.error('[campaign-attention] Skill Check timeout invalidation publication failed', error)
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    campaignMinute,
    timedOutCheckIds: Object.freeze(timedOut),
  })
}
