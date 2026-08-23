import { randomInt as secureRandomInt } from 'node:crypto'
import { parseSkillCheckCommand } from '#shared/skillChecks/persistence'
import type {
  ResolveSkillCheckCommandV1,
  SkillCheckCommandV1,
  SkillCheckAcceptedResultV1,
  SkillCheckDiceJournalV1,
  SkillCheckDocumentV1,
} from '#shared/skillChecks/contract'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  SkillCheckResolutionError,
  resolveSkillCheckDocument,
  type SkillCheckSubjectSheetSnapshot,
} from '../domain/skillChecks/resolveCheck'
import { publishCampaignAttentionInvalidation } from '../realtime/campaignAttentionRealtime'
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

export type SkillCheckResolveAuthority =
  | { readonly kind: 'gm', readonly principalId: string }
  | { readonly kind: 'server' }

export interface ResolveSkillCheckInput {
  readonly authority: SkillCheckResolveAuthority
  /** Strict resolve commands contain no dice, totals, modifiers, or outcomes. */
  readonly command: unknown
}

export interface ResolveSkillCheckDependencies {
  readonly database?: RotomDatabase
  readonly skillCheckRepository?: SkillCheckRepository
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'get'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
  readonly randomInt?: (minimum: number, maximumExclusive: number) => number
  readonly publishAttention?: typeof publishCampaignAttentionInvalidation
  /** Deterministic rollback seam used only by recovery certification. */
  readonly failAfterWrite?: (boundary: 'document' | 'operation') => void
}

export interface ResolveSkillCheckReceiptV1 {
  readonly schemaVersion: 1
  readonly operationId: ResolveSkillCheckCommandV1['operationId']
  readonly checkId: ResolveSkillCheckCommandV1['checkId']
  readonly revision: number
  readonly state: 'accepted'
  readonly updatedAt: number
  readonly journals: readonly SkillCheckDiceJournalV1[]
  readonly acceptedResults: readonly SkillCheckAcceptedResultV1[]
  readonly exactReplay: boolean
}

export type SkillCheckAuthorityErrorCode =
  | 'invalid-command'
  | 'forbidden'
  | 'not-found'
  | 'revision-conflict'
  | 'operation-conflict'
  | 'repository-mismatch'
  | 'resolution-rejected'
  | 'replay-evidence-missing'

export class SkillCheckAuthorityError extends Error {
  readonly code: SkillCheckAuthorityErrorCode
  readonly currentRevision: number | null
  readonly causeCode: string | null

  constructor(
    code: SkillCheckAuthorityErrorCode,
    message: string,
    options: { readonly currentRevision?: number | null, readonly causeCode?: string | null } = {},
  ) {
    super(message)
    this.name = 'SkillCheckAuthorityError'
    this.code = code
    this.currentRevision = options.currentRevision ?? null
    this.causeCode = options.causeCode ?? null
  }
}

const fail = (
  code: SkillCheckAuthorityErrorCode,
  message: string,
  options?: { readonly currentRevision?: number | null, readonly causeCode?: string | null },
): never => { throw new SkillCheckAuthorityError(code, message, options) }

const parseResolveCommand = (value: unknown): ResolveSkillCheckCommandV1 => {
  let command: SkillCheckCommandV1
  try { command = parseSkillCheckCommand(value) }
  catch {
    return fail('invalid-command', 'Invalid Skill Check resolve command.')
  }
  if (command.commandKind !== 'resolve') {
    return fail('invalid-command', 'Skill Check server resolution accepts only resolve commands.')
  }
  return command
}

const principalKey = (authority: SkillCheckResolveAuthority): string => {
  if (authority.kind === 'server') return 'server:auto'
  const principalId = authority.principalId.trim()
  if (!principalId || principalId.length > 200 || /[\u0000-\u001f\u007f]/u.test(principalId)) {
    return fail('forbidden', 'A bounded GM principal identity is required.')
  }
  return `gm:${principalId}`
}

const databaseFor = (dependencies: ResolveSkillCheckDependencies): RotomDatabase => {
  const candidates = [
    dependencies.skillCheckRepository?.database,
    dependencies.sheetRepository?.database,
  ].filter((candidate): candidate is RotomDatabase => Boolean(candidate))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    return fail('repository-mismatch', 'Skill Check repositories must share one RotomDatabase.')
  }
  return database
}

const receiptFrom = (input: {
  readonly operation: Pick<StoredSkillCheckOperationV1, 'result'>
  readonly document: SkillCheckDocumentV1
  readonly exactReplay: boolean
}): ResolveSkillCheckReceiptV1 => {
  const result = input.operation.result
  if (result.commandKind !== 'resolve' || result.state !== 'accepted'
    || input.document.state !== 'accepted'
    || input.document.journals.length === 0
    || input.document.acceptedResults.length !== input.document.subjects.length) {
    return fail('replay-evidence-missing', 'Accepted Skill Check operation evidence is unavailable.')
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: result.operationId,
    checkId: result.checkId,
    revision: result.revision,
    state: 'accepted',
    updatedAt: result.updatedAt,
    journals: input.document.journals,
    acceptedResults: input.document.acceptedResults,
    exactReplay: input.exactReplay,
  })
}

const replayOrConflict = (input: {
  readonly existing: StoredSkillCheckOperationV1
  readonly command: ResolveSkillCheckCommandV1
  readonly principalKey: string
  readonly repository: SkillCheckRepository
}): ResolveSkillCheckReceiptV1 => {
  if (input.existing.commandSha256 !== skillCheckCommandSha256(input.command)) {
    return fail('operation-conflict', 'Skill Check operation ID was reused with changed input.')
  }
  if (input.existing.principalKey !== input.principalKey) {
    return fail('forbidden', 'Skill Check operation replay belongs to a different principal.')
  }
  const stored = input.repository.get(input.command.checkId)
    ?? fail('replay-evidence-missing', 'Accepted Skill Check replay document is missing.')
  return receiptFrom({ operation: input.existing, document: stored.document, exactReplay: true })
}

const operationResult = (
  command: ResolveSkillCheckCommandV1,
  document: SkillCheckDocumentV1,
): SkillCheckOperationResultV1 => Object.freeze({
  schemaVersion: 1,
  operationId: command.operationId,
  checkId: command.checkId,
  commandKind: 'resolve',
  revision: document.revision,
  state: document.state,
  updatedAt: document.updatedAt,
})

const mapRepositoryError = (error: unknown): never => {
  if (!(error instanceof SkillCheckRepositoryError)) throw error
  if (error.code === 'revision-conflict' || error.code === 'not-found') {
    return fail(error.code, error.message, { currentRevision: error.currentRevision })
  }
  if (error.code === 'operation-conflict') return fail('operation-conflict', error.message)
  throw error
}

export const resolveSkillCheckUseCase = (
  input: ResolveSkillCheckInput,
  dependencies: ResolveSkillCheckDependencies = {},
): ResolveSkillCheckReceiptV1 => {
  const command = parseResolveCommand(input.command)
  const replayPrincipal = principalKey(input.authority)
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)

  const initialExisting = checks.findOperation(command.operationId)
  if (initialExisting) {
    return replayOrConflict({ existing: initialExisting, command, principalKey: replayPrincipal, repository: checks })
  }

  const publication: { document: SkillCheckDocumentV1 | null } = { document: null }
  try {
    const receipt = database.withTransaction(() => {
      const existing = checks.findOperation(command.operationId)
      if (existing) {
        return replayOrConflict({ existing, command, principalKey: replayPrincipal, repository: checks })
      }
      const stored = checks.get(command.checkId)
        ?? fail('not-found', 'Skill Check was not found.')
      if (stored.revision !== command.expectedRevision) {
        return fail('revision-conflict', `Skill Check is stale; current revision is ${stored.revision}.`, {
          currentRevision: stored.revision,
        })
      }

      const snapshots: SkillCheckSubjectSheetSnapshot[] = stored.document.subjects.map((subject) => {
        const sheet = sheets.get(subject.kind, subject.sheetSlug)
        if (!sheet) {
          return fail(
            'resolution-rejected',
            `Skill Check subject ${subject.subjectId} has no authoritative sheet.`,
            { causeCode: 'sheet-missing' },
          )
        }
        return Object.freeze({
          kind: subject.kind,
          slug: sheet.slug,
          revision: sheet.revision,
          sheet: sheet.document as unknown as CharacterSheet | TrainerSheet,
        })
      })
      const now = dependencies.now?.() ?? Date.now()
      let next: SkillCheckDocumentV1
      try {
        next = resolveSkillCheckDocument({
          document: stored.document,
          operationId: command.operationId,
          subjectSheets: snapshots,
          now,
          randomInt: dependencies.randomInt ?? secureRandomInt,
        })
      }
      catch (error) {
        if (error instanceof SkillCheckResolutionError) {
          return fail('resolution-rejected', error.message, { causeCode: error.code })
        }
        throw error
      }

      checks.replace(command.expectedRevision, next)
      dependencies.failAfterWrite?.('document')
      const operation = checks.recordOperation({
        principalKey: replayPrincipal,
        command,
        result: operationResult(command, next),
        createdAt: now,
      })
      dependencies.failAfterWrite?.('operation')
      publication.document = next
      return receiptFrom({ operation, document: next, exactReplay: false })
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
    return receipt
  }
  catch (error) {
    return mapRepositoryError(error)
  }
}
