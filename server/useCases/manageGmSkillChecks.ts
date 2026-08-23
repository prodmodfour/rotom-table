import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  SKILL_CHECK_SKILL_IDS,
  type CancelSkillCheckCommandV1,
  type RequestSkillCheckCommandV1,
  type ResolveSkillCheckCommandV1,
  type SkillCheckCommandV1,
  type SkillCheckDocumentV1,
  type SkillCheckState,
} from '#shared/skillChecks/contract'
import { SKILL_CHECK_DC_PRESETS, resolveSkillCheckDifficultyClass } from '#shared/skillChecks/difficulty'
import type {
  LoadGmSkillChecksResponseV1,
  ManageGmSkillCheckResponseV1,
  SkillCheckGmCommandReceiptV1,
  SkillCheckGmSubjectOptionV1,
} from '#shared/skillChecks/gmWorkflow'
import { parseSkillCheckCommand, parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import type { TrainerSheet } from '~/types/trainerSheet'
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
import { listPlayerProfiles } from '../utils/playerProfileStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  SkillCheckAuthorityError,
  resolveSkillCheckUseCase,
  type ResolveSkillCheckDependencies,
  type ResolveSkillCheckReceiptV1,
} from './resolveSkillCheck'

export interface ManageGmSkillCheckInput {
  readonly principalId: string
  readonly command: unknown
}

export interface ManageGmSkillCheckDependencies {
  readonly database?: RotomDatabase
  readonly skillCheckRepository?: SkillCheckRepository
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'get' | 'list'> & { readonly database?: RotomDatabase }
  readonly listProfiles?: () => readonly PlayerProfile[]
  readonly now?: () => number
  readonly randomInt?: ResolveSkillCheckDependencies['randomInt']
  readonly publishAttention?: typeof publishCampaignAttentionInvalidation
  readonly failAfterWrite?: (boundary: 'document' | 'operation') => void
}

export interface LoadGmSkillChecksInput {
  readonly states?: readonly SkillCheckState[]
  readonly limit?: number
}

export type {
  LoadGmSkillChecksResponseV1,
  ManageGmSkillCheckResponseV1,
  SkillCheckGmCommandReceiptV1,
  SkillCheckGmSubjectOptionV1,
} from '#shared/skillChecks/gmWorkflow'

export class SkillCheckGmWorkflowError extends UseCaseHttpError<400 | 403 | 404 | 409> {
  readonly code:
    | 'invalid-command'
    | 'forbidden'
    | 'not-found'
    | 'revision-conflict'
    | 'operation-conflict'
    | 'state-conflict'
    | 'sheet-unavailable'
    | 'repository-mismatch'

  constructor(statusCode: 400 | 403 | 404 | 409, code: SkillCheckGmWorkflowError['code'], message: string) {
    super(statusCode, message)
    this.code = code
  }
}

const fail = (
  statusCode: 400 | 403 | 404 | 409,
  code: SkillCheckGmWorkflowError['code'],
  message: string,
): never => { throw new SkillCheckGmWorkflowError(statusCode, code, message) }

const digest = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const historyId = (operationId: string, kind: 'requested' | 'cancelled'): string => (
  `skill-check-history:v1:${digest({ operationId, kind }).slice(0, 40)}`
)

const gmAuthority = (principalIdInput: string): { readonly principalId: string, readonly principalKey: string } => {
  const principalId = principalIdInput.trim()
  if (!principalId || principalId.length > 200 || /[\u0000-\u001f\u007f]/u.test(principalId)) {
    return fail(403, 'forbidden', 'A bounded GM principal identity is required.')
  }
  return Object.freeze({ principalId: `gm:${principalId}`, principalKey: `gm:${principalId}` })
}

const databaseFor = (dependencies: ManageGmSkillCheckDependencies): RotomDatabase => {
  const candidates = [dependencies.skillCheckRepository?.database, dependencies.sheetRepository?.database]
    .filter((candidate): candidate is RotomDatabase => Boolean(candidate))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    return fail(409, 'repository-mismatch', 'Skill Check repositories must share one RotomDatabase.')
  }
  return database
}

const parseGmCommand = (value: unknown): RequestSkillCheckCommandV1 | CancelSkillCheckCommandV1 | ResolveSkillCheckCommandV1 => {
  let command: SkillCheckCommandV1
  try { command = parseSkillCheckCommand(value) }
  catch { return fail(400, 'invalid-command', 'Invalid GM Skill Check command.') }
  if (command.commandKind !== 'request' && command.commandKind !== 'cancel' && command.commandKind !== 'resolve') {
    return fail(400, 'invalid-command', 'GM Skill Check workflow accepts request, resolve, or cancel commands.')
  }
  return command
}

const operationResult = (
  command: RequestSkillCheckCommandV1 | CancelSkillCheckCommandV1,
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
  exactReplay: boolean,
): SkillCheckGmCommandReceiptV1 => {
  if (operation.result.commandKind !== 'request' && operation.result.commandKind !== 'cancel') {
    return fail(409, 'operation-conflict', 'Skill Check operation kind does not belong to the GM workflow receipt.')
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: operation.result.operationId,
    checkId: operation.result.checkId,
    commandKind: operation.result.commandKind,
    revision: operation.result.revision,
    state: operation.result.state,
    updatedAt: operation.result.updatedAt,
    exactReplay,
  })
}

const replayOrConflict = (input: {
  readonly operation: StoredSkillCheckOperationV1
  readonly command: RequestSkillCheckCommandV1 | CancelSkillCheckCommandV1
  readonly principalKey: string
  readonly checks: SkillCheckRepository
}): ManageGmSkillCheckResponseV1 => {
  if (input.operation.commandSha256 !== skillCheckCommandSha256(input.command)) {
    return fail(409, 'operation-conflict', 'Skill Check operation ID was reused with changed input.')
  }
  if (input.operation.principalKey !== input.principalKey) {
    return fail(403, 'forbidden', 'Skill Check operation replay belongs to a different GM principal.')
  }
  const stored = input.checks.get(input.command.checkId)
    ?? fail(404, 'not-found', 'Skill Check replay document is missing.')
  return Object.freeze({
    schemaVersion: 1,
    receipt: receiptFromOperation(input.operation, true),
    document: stored.document,
  })
}

const controllerIdsFor = (input: {
  readonly profiles: readonly PlayerProfile[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly kind: 'trainer' | 'pokemon'
  readonly slug: string
}): readonly string[] => Object.freeze(input.profiles
  .filter(profile => playerProfileCanControlTokenSheet(profile, input.kind, input.slug, {
    linkedTrainerSheets: input.trainerSheets,
  }))
  .map(profile => String(profile.id))
  .sort((left, right) => left.localeCompare(right)))

const resolvedRequestDocument = (input: {
  readonly command: RequestSkillCheckCommandV1
  readonly authority: ReturnType<typeof gmAuthority>
  readonly sheets: Pick<SheetRepository<Record<string, unknown>>, 'get' | 'list'>
  readonly profiles: readonly PlayerProfile[]
  readonly now: number
}): SkillCheckDocumentV1 => {
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    return fail(409, 'state-conflict', 'Skill Check request time is invalid.')
  }
  if (input.command.expiresAt !== null && input.command.expiresAt <= input.now) {
    return fail(400, 'invalid-command', 'Skill Check expiry must be later than its request time.')
  }
  if (input.command.comparison.kind === 'opposed' && input.command.subjects.length !== 2) {
    return fail(400, 'invalid-command', 'Opposed Skill Checks require exactly two subjects.')
  }
  const trainerSheets = input.sheets.list('trainer').map(row => row.document as unknown as TrainerSheet)
  const subjects = input.command.subjects.map((subject) => {
    const stored = input.sheets.get(subject.kind, subject.sheetSlug)
      ?? fail(404, 'sheet-unavailable', `The ${subject.kind} sheet ${subject.sheetSlug} is unavailable.`)
    return Object.freeze({
      ...subject,
      sheetRevision: stored.revision,
      controllerProfileIds: controllerIdsFor({
        profiles: input.profiles,
        trainerSheets,
        kind: subject.kind,
        slug: subject.sheetSlug,
      }),
      response: 'pending' as const,
      respondedAt: null,
    })
  })
  const comparison = input.command.comparison.kind === 'opposed'
    ? input.command.comparison
    : Object.freeze({
        kind: 'dc' as const,
        difficultyClass: resolveSkillCheckDifficultyClass(input.command.comparison.difficulty),
        concealment: input.command.comparison.concealment,
      })
  try {
    return parseSkillCheckDocument({
      schemaVersion: 1,
      checkId: input.command.checkId,
      revision: 1,
      state: 'pending',
      mode: subjects.length === 1 ? 'single' : 'group',
      requester: { role: 'gm', principalId: input.authority.principalId },
      publicLabel: input.command.publicLabel,
      prompt: input.command.prompt,
      gmNotes: input.command.gmNotes,
      visibility: input.command.visibility,
      comparison,
      situationalModifier: input.command.situationalModifier,
      subjects,
      journals: [],
      acceptedResults: [],
      corrections: [],
      history: [{
        historyId: historyId(input.command.operationId, 'requested'),
        kind: 'requested',
        operationId: input.command.operationId,
        subjectId: null,
        headline: 'Skill Check requested',
        createdAt: input.now,
      }],
      createdAt: input.now,
      updatedAt: input.now,
      expiresAt: input.command.expiresAt,
      terminalAt: null,
      lastOperationId: input.command.operationId,
    })
  }
  catch {
    return fail(400, 'invalid-command', 'Skill Check request does not form a valid authoritative document.')
  }
}

const cancelledDocument = (input: {
  readonly command: CancelSkillCheckCommandV1
  readonly current: SkillCheckDocumentV1
  readonly now: number
}): SkillCheckDocumentV1 => {
  if (input.current.state !== 'pending' && input.current.state !== 'ready') {
    return fail(409, 'state-conflict', 'Only pending or ready Skill Checks can be cancelled.')
  }
  if (!Number.isSafeInteger(input.now) || input.now < input.current.updatedAt) {
    return fail(409, 'state-conflict', 'Skill Check cancellation time is stale or invalid.')
  }
  if (input.current.history.length >= 5000) {
    return fail(409, 'state-conflict', 'Skill Check cancellation history is full.')
  }
  return parseSkillCheckDocument({
    ...input.current,
    revision: input.current.revision + 1,
    state: 'cancelled',
    history: [...input.current.history, {
      historyId: historyId(input.command.operationId, 'cancelled'),
      kind: 'cancelled',
      operationId: input.command.operationId,
      subjectId: null,
      headline: 'Skill Check cancelled',
      createdAt: input.now,
    }],
    updatedAt: input.now,
    terminalAt: input.now,
    lastOperationId: input.command.operationId,
  })
}

const mapRepositoryError = (error: unknown): never => {
  if (!(error instanceof SkillCheckRepositoryError)) throw error
  if (error.code === 'not-found') return fail(404, 'not-found', error.message)
  if (error.code === 'revision-conflict') return fail(409, 'revision-conflict', error.message)
  if (error.code === 'operation-conflict') return fail(409, 'operation-conflict', error.message)
  throw error
}

const mapResolveError = (error: unknown): never => {
  if (!(error instanceof SkillCheckAuthorityError)) throw error
  if (error.code === 'invalid-command') return fail(400, 'invalid-command', error.message)
  if (error.code === 'forbidden') return fail(403, 'forbidden', error.message)
  if (error.code === 'not-found') return fail(404, 'not-found', error.message)
  if (error.code === 'revision-conflict') return fail(409, 'revision-conflict', error.message)
  if (error.code === 'operation-conflict') return fail(409, 'operation-conflict', error.message)
  if (error.code === 'repository-mismatch') return fail(409, 'repository-mismatch', error.message)
  return fail(409, 'state-conflict', error.message)
}

export const manageGmSkillCheckUseCase = (
  input: ManageGmSkillCheckInput,
  dependencies: ManageGmSkillCheckDependencies = {},
): ManageGmSkillCheckResponseV1 => {
  const command = parseGmCommand(input.command)
  const authority = gmAuthority(input.principalId)
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)

  if (command.commandKind === 'resolve') {
    let receipt: ResolveSkillCheckReceiptV1
    try {
      receipt = resolveSkillCheckUseCase({
        authority: { kind: 'gm', principalId: input.principalId },
        command,
      }, {
        database,
        skillCheckRepository: checks,
        sheetRepository: sheets,
        now: dependencies.now,
        randomInt: dependencies.randomInt,
        publishAttention: dependencies.publishAttention,
        failAfterWrite: dependencies.failAfterWrite,
      })
    }
    catch (error) { return mapResolveError(error) }
    const stored = checks.get(command.checkId) ?? fail(404, 'not-found', 'Resolved Skill Check is missing.')
    return Object.freeze({
      schemaVersion: 1,
      receipt: Object.freeze({
        schemaVersion: 1,
        operationId: receipt.operationId,
        checkId: receipt.checkId,
        commandKind: 'resolve' as const,
        revision: receipt.revision,
        state: receipt.state,
        updatedAt: receipt.updatedAt,
        exactReplay: receipt.exactReplay,
      }),
      document: stored.document,
    })
  }

  const initialOperation = checks.findOperation(command.operationId)
  if (initialOperation) {
    return replayOrConflict({ operation: initialOperation, command, principalKey: authority.principalKey, checks })
  }

  const publication: { document: SkillCheckDocumentV1 | null } = { document: null }
  try {
    const response = database.withTransaction(() => {
      const existingOperation = checks.findOperation(command.operationId)
      if (existingOperation) {
        return replayOrConflict({ operation: existingOperation, command, principalKey: authority.principalKey, checks })
      }
      const now = dependencies.now?.() ?? Date.now()
      let next: SkillCheckDocumentV1
      if (command.commandKind === 'request') {
        if (checks.get(command.checkId)) return fail(409, 'state-conflict', 'Skill Check identity already exists.')
        next = resolvedRequestDocument({
          command,
          authority,
          sheets,
          profiles: (dependencies.listProfiles ?? listPlayerProfiles)(),
          now,
        })
        checks.insert(next)
      }
      else {
        const current = checks.get(command.checkId)
          ?? fail(404, 'not-found', 'Skill Check was not found.')
        if (current.revision !== command.expectedRevision) {
          return fail(409, 'revision-conflict', `Skill Check is stale; current revision is ${current.revision}.`)
        }
        next = cancelledDocument({ command, current: current.document, now })
        checks.replace(command.expectedRevision, next)
      }
      dependencies.failAfterWrite?.('document')
      const operation = checks.recordOperation({
        principalKey: authority.principalKey,
        command,
        result: operationResult(command, next),
        createdAt: now,
      })
      dependencies.failAfterWrite?.('operation')
      publication.document = next
      return Object.freeze({
        schemaVersion: 1,
        receipt: receiptFromOperation(operation, false),
        document: next,
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

const safeLabel = (kind: 'trainer' | 'pokemon', slug: string, document: Record<string, unknown>): string => {
  const candidate = kind === 'trainer' ? document.name : document.nickname ?? document.species
  return typeof candidate === 'string' && candidate.trim() && candidate.length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(candidate)
    ? candidate.trim()
    : slug
}

export const loadGmSkillChecksUseCase = (
  input: LoadGmSkillChecksInput = {},
  dependencies: ManageGmSkillCheckDependencies = {},
): LoadGmSkillChecksResponseV1 => {
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const profiles = (dependencies.listProfiles ?? listPlayerProfiles)()
  const trainerSheets = sheets.list('trainer').map(row => row.document as unknown as TrainerSheet)
  const subjects = sheets.list().map((sheet): SkillCheckGmSubjectOptionV1 => Object.freeze({
    kind: sheet.kind,
    sheetSlug: sheet.slug,
    sheetRevision: sheet.revision,
    label: safeLabel(sheet.kind, sheet.slug, sheet.document),
    controllerProfileIds: controllerIdsFor({
      profiles,
      trainerSheets,
      kind: sheet.kind,
      slug: sheet.slug,
    }),
    skillIds: SKILL_CHECK_SKILL_IDS,
  })).sort((left, right) => left.label.localeCompare(right.label)
    || left.kind.localeCompare(right.kind)
    || left.sheetSlug.localeCompare(right.sheetSlug))
  return Object.freeze({
    schemaVersion: 1,
    checks: Object.freeze(checks.list({ states: input.states, limit: input.limit }).map(row => row.document)),
    subjects: Object.freeze(subjects),
    dcPresets: SKILL_CHECK_DC_PRESETS,
  })
}
