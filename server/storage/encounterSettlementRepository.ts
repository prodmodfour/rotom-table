import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  parseEncounterSettlementCommitCommand,
  parseEncounterSettlementCommitResult,
  type EncounterSettlementCommitCommand,
  type EncounterSettlementCommitResult,
} from '#shared/encounterSettlement/atomicCommit'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import {
  assertEncounterSettlementAtomicPlanCurrent,
  assertEncounterSettlementAtomicPlanIntegrity,
  encounterSettlementAtomicDefinitionSha256,
  type EncounterSettlementAtomicAuthoritySnapshot,
  type EncounterSettlementAtomicCommitPlan,
  type EncounterSettlementAttentionSource,
  type EncounterSettlementHistoryFact,
} from '../domain/encounterSettlement/atomicCommit'
import { getRotomDatabase, type RotomDatabase } from './database'
import { createSqliteCampaignClockRepository } from './campaignClockRepository'
import { createSqliteEncounterDocumentRepository } from './encounterDocumentRepository'
import { createSqliteGroupInventoryRepository } from './groupInventoryRepository'
import { createSqliteMapRepository } from './mapRepository'
import { createSqliteSheetRepository } from './sheetRepository'
import { createSqliteRealtimeEventRepository } from './realtimeEventRepository'
import { encounterDocumentRealtimeAppendInputs } from '../realtime/encounterDocumentRealtime'
import { mapLibraryUpdatedRealtimeAppendInputs } from '../realtime/libraryMutationRealtime'
import { groupInventoryUpdatedRealtimeAppendInputs } from '../realtime/groupInventoryRealtime'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  sheetDocumentUpdatedRealtimeAppendInput,
} from '../realtime/sheetDocumentRealtime'
import { encounterSettlementRealtimeAppendInputs } from '../realtime/encounterSettlementRealtime'

export interface StoredEncounterSettlementOperation {
  readonly operationId: string
  readonly settlementId: string
  readonly principalKey: string
  readonly commandSha256: string
  readonly command: EncounterSettlementCommitCommand
  readonly planDefinitionSha256: string
  readonly authorityDefinitionSha256: string
  /** Private exact server-owned plan retained for principal-bound idempotent replay. */
  readonly plan?: EncounterSettlementAtomicCommitPlan
  readonly result: EncounterSettlementCommitResult
  readonly resultDefinitionSha256: string
  readonly settlementRevision: number
  readonly createdAt: number
  readonly acceptedAtCampaignMinute: number
}

export interface StoredEncounterSettlementHistoryFact extends EncounterSettlementHistoryFact {
  readonly settlementId: string
  readonly operationId: string
  readonly createdAtCampaignMinute: number
}

export interface StoredEncounterSettlementAttentionSource extends EncounterSettlementAttentionSource {
  readonly settlementId: string
  readonly operationId: string
  readonly status: 'open' | 'resolved'
  readonly revision: number
  readonly createdAtCampaignMinute: number
  readonly resolvedAtCampaignMinute: number | null
  readonly resolutionOperationId: string | null
}

export type EncounterSettlementAtomicWriteBoundary =
  | 'after-encounter-write'
  | 'after-map-write'
  | `after-sheet-write:${'pokemon' | 'trainer'}:${string}`
  | `after-group-write:${string}`
  | 'after-settlement-write'
  | 'after-operation-write'
  | `after-history-write:${string}`
  | `after-attention-write:${string}`
  | 'after-realtime-write'
  | 'before-commit'

export interface ApplyEncounterSettlementAtomicCommitInput {
  readonly principalKey: string
  readonly command: EncounterSettlementCommitCommand
  readonly plan: EncounterSettlementAtomicCommitPlan
  /** Rebuilds one complete current authority snapshot while the SQLite write lock is held. */
  readonly reauthorize: () => EncounterSettlementAtomicAuthoritySnapshot
  readonly onWriteBoundary?: (boundary: EncounterSettlementAtomicWriteBoundary) => void
}

export interface ApplyEncounterSettlementAtomicCommitResult {
  readonly replayed: boolean
  readonly result: EncounterSettlementCommitResult
  /** Private server handoff. Publish only after the enclosing transaction commits. */
  readonly persistedRealtimeEvents: readonly PersistedRealtimeEvent[]
}

export interface EncounterSettlementRepository {
  readonly database: RotomDatabase
  get(settlementId: string): EncounterSettlementDocument | null
  getByEncounterId(encounterId: string): EncounterSettlementDocument | null
  create(document: EncounterSettlementDocument): EncounterSettlementDocument
  replace(input: {
    readonly expectedRevision: number
    readonly document: EncounterSettlementDocument
  }): EncounterSettlementDocument | null
  getOperation(operationId: string): StoredEncounterSettlementOperation | null
  listHistoryFacts(settlementId: string): readonly StoredEncounterSettlementHistoryFact[]
  listAttentionSources(settlementId: string): readonly StoredEncounterSettlementAttentionSource[]
  applyAtomicCommit(input: ApplyEncounterSettlementAtomicCommitInput): ApplyEncounterSettlementAtomicCommitResult
}

export type EncounterSettlementRepositoryErrorCode =
  | 'invalid-input'
  | 'corrupt-record'
  | 'duplicate-operation'
  | 'stale-authority'
  | 'write-drift'

export class EncounterSettlementRepositoryError extends Error {
  constructor(readonly code: EncounterSettlementRepositoryErrorCode, message: string) {
    super(message)
    this.name = 'EncounterSettlementRepositoryError'
  }
}

interface SettlementRow {
  readonly settlement_id: unknown
  readonly encounter_id: unknown
  readonly status: unknown
  readonly revision: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly created_at_campaign_minute: unknown
  readonly updated_at_campaign_minute: unknown
  readonly completion_operation_id: unknown
}

interface OperationRow {
  readonly operation_id: unknown
  readonly settlement_id: unknown
  readonly principal_key: unknown
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly plan_definition_sha256: unknown
  readonly authority_definition_sha256: unknown
  readonly evidence_json: unknown
  readonly result_json: unknown
  readonly result_definition_sha256: unknown
  readonly settlement_revision: unknown
  readonly created_at: unknown
  readonly accepted_at_campaign_minute: unknown
}

interface HistoryRow {
  readonly fact_id: unknown
  readonly settlement_id: unknown
  readonly operation_id: unknown
  readonly fact_kind: unknown
  readonly audience: unknown
  readonly subject_kind: unknown
  readonly subject_id: unknown
  readonly result_code: unknown
  readonly fact_json: unknown
  readonly created_at_campaign_minute: unknown
}

interface AttentionRow {
  readonly source_id: unknown
  readonly settlement_id: unknown
  readonly operation_id: unknown
  readonly source_fact_id: unknown
  readonly reason: unknown
  readonly audience: unknown
  readonly entity_kind: unknown
  readonly entity_id: unknown
  readonly status: unknown
  readonly revision: unknown
  readonly source_json: unknown
  readonly created_at_campaign_minute: unknown
  readonly resolved_at_campaign_minute: unknown
  readonly resolution_operation_id: unknown
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/
const fail = (code: EncounterSettlementRepositoryErrorCode, message: string): never => {
  throw new EncounterSettlementRepositoryError(code, message)
}
const text = (value: unknown, label: string, max = 200): string => (
  typeof value === 'string' && value.length >= 1 && value.length <= max
    ? value
    : fail('corrupt-record', `Stored encounter settlement ${label} is invalid.`)
)
const id = (value: unknown, label: string): string => {
  const parsed = text(value, label)
  return ID.test(parsed)
    ? parsed
    : fail('corrupt-record', `Stored encounter settlement ${label} is invalid.`)
}
const revision = (value: unknown, label: string): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('corrupt-record', `Stored encounter settlement ${label} is invalid.`)
)
const nullableRevision = (value: unknown, label: string): number | null => (
  value === null ? null : revision(value, label)
)
const json = <Value>(value: unknown, label: string): Value => {
  const serialized = typeof value === 'string'
    ? value
    : fail('corrupt-record', `Stored encounter settlement ${label} is invalid.`)
  try { return JSON.parse(serialized) as Value }
  catch { return fail('corrupt-record', `Stored encounter settlement ${label} is invalid JSON.`) }
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const principalKey = (value: unknown): string => (
  typeof value === 'string' && value.length >= 1 && value.length <= 160
    ? value
    : fail('invalid-input', 'Encounter settlement commit principal is invalid.')
)
const exactHash = (value: unknown, label: string): string => {
  const parsed = text(value, label, 64)
  return HASH.test(parsed)
    ? parsed
    : fail('corrupt-record', `Stored encounter settlement ${label} is invalid.`)
}

const settlementFromRow = (row: SettlementRow): EncounterSettlementDocument => {
  const document = parseEncounterSettlementDocument(json(row.document_json, 'document'))
  const storedId = id(row.settlement_id, 'settlement identity')
  const storedEncounterId = id(row.encounter_id, 'encounter identity')
  const storedRevision = revision(row.revision, 'revision')
  const storedHash = exactHash(row.definition_sha256, 'definition hash')
  const completionOperationId = row.completion_operation_id === null
    ? null
    : id(row.completion_operation_id, 'completion operation identity')
  if (document.settlementId !== storedId || document.encounter.encounterId !== storedEncounterId
    || document.status !== row.status || document.revision !== storedRevision
    || document.createdAtCampaignMinute !== revision(row.created_at_campaign_minute, 'created minute')
    || document.updatedAtCampaignMinute !== revision(row.updated_at_campaign_minute, 'updated minute')
    || encounterSettlementAtomicDefinitionSha256(document) !== storedHash
    || (document.completion.state === 'accepted' ? document.completion.operationId : null) !== completionOperationId) {
    fail('corrupt-record', 'Stored encounter settlement columns do not match the canonical document.')
  }
  return document
}

const operationFromRow = (row: OperationRow): StoredEncounterSettlementOperation => {
  const command = parseEncounterSettlementCommitCommand(json(row.command_json, 'operation command'))
  const evidence = assertEncounterSettlementAtomicPlanIntegrity(
    json(row.evidence_json, 'operation plan evidence'),
  )
  const result = parseEncounterSettlementCommitResult(json(row.result_json, 'operation result'))
  const operationId = id(row.operation_id, 'operation identity')
  const settlementId = id(row.settlement_id, 'operation settlement identity')
  const commandSha256 = exactHash(row.command_sha256, 'operation command hash')
  const planDefinitionSha256 = exactHash(row.plan_definition_sha256, 'operation plan hash')
  const authorityDefinitionSha256 = exactHash(row.authority_definition_sha256, 'operation authority hash')
  const settlementRevision = revision(row.settlement_revision, 'operation settlement revision')
  const acceptedAtCampaignMinute = revision(row.accepted_at_campaign_minute, 'operation accepted minute')
  const resultDefinitionSha256 = exactHash(row.result_definition_sha256, 'operation result hash')
  if (command.operationId !== operationId || command.settlementId !== settlementId
    || command.planDefinitionSha256 !== planDefinitionSha256
    || evidence.operationId !== operationId || evidence.settlementId !== settlementId
    || evidence.planDefinitionSha256 !== planDefinitionSha256
    || evidence.authorityDefinitionSha256 !== authorityDefinitionSha256
    || result.operationId !== operationId || result.settlementId !== settlementId
    || result.settlementRevision !== settlementRevision
    || result.completedAtCampaignMinute !== acceptedAtCampaignMinute
    || sha256(command) !== commandSha256 || sha256(result) !== resultDefinitionSha256) {
    fail('corrupt-record', 'Stored encounter settlement operation evidence does not match its indexed columns.')
  }
  return Object.freeze({
    operationId,
    settlementId,
    principalKey: text(row.principal_key, 'operation principal', 160),
    commandSha256,
    command,
    planDefinitionSha256,
    authorityDefinitionSha256,
    plan: evidence,
    result,
    resultDefinitionSha256,
    settlementRevision,
    createdAt: revision(row.created_at, 'operation created timestamp'),
    acceptedAtCampaignMinute,
  })
}

const historyFromRow = (row: HistoryRow): StoredEncounterSettlementHistoryFact => {
  const fact = json<EncounterSettlementHistoryFact>(row.fact_json, 'history fact')
  const stored: StoredEncounterSettlementHistoryFact = Object.freeze({
    ...fact,
    settlementId: id(row.settlement_id, 'history settlement identity'),
    operationId: id(row.operation_id, 'history operation identity'),
    createdAtCampaignMinute: revision(row.created_at_campaign_minute, 'history created minute'),
  })
  if (fact.factId !== id(row.fact_id, 'history fact identity') || fact.kind !== row.fact_kind
    || fact.audience !== row.audience || fact.subjectKind !== row.subject_kind
    || fact.subjectId !== row.subject_id || fact.resultCode !== row.result_code) {
    fail('corrupt-record', 'Stored encounter settlement history columns do not match the immutable fact.')
  }
  return stored
}

const attentionFromRow = (row: AttentionRow): StoredEncounterSettlementAttentionSource => {
  const source = json<EncounterSettlementAttentionSource>(row.source_json, 'attention source')
  const status = row.status === 'open' || row.status === 'resolved'
    ? row.status
    : fail('corrupt-record', 'Stored encounter settlement attention status is invalid.')
  const stored: StoredEncounterSettlementAttentionSource = Object.freeze({
    ...source,
    settlementId: id(row.settlement_id, 'attention settlement identity'),
    operationId: id(row.operation_id, 'attention operation identity'),
    status,
    revision: revision(row.revision, 'attention revision'),
    createdAtCampaignMinute: revision(row.created_at_campaign_minute, 'attention created minute'),
    resolvedAtCampaignMinute: nullableRevision(row.resolved_at_campaign_minute, 'attention resolved minute'),
    resolutionOperationId: row.resolution_operation_id === null
      ? null
      : id(row.resolution_operation_id, 'attention resolution operation identity'),
  })
  if (source.sourceId !== id(row.source_id, 'attention identity')
    || source.sourceFactId !== id(row.source_fact_id, 'attention source fact identity')
    || source.reason !== row.reason || source.audience !== row.audience
    || source.entityKind !== row.entity_kind || source.entityId !== row.entity_id) {
    fail('corrupt-record', 'Stored encounter settlement attention columns do not match the source document.')
  }
  return stored
}

const settlementRowColumns = `
  settlement_id, encounter_id, status, revision, document_json, definition_sha256,
  created_at_campaign_minute, updated_at_campaign_minute, completion_operation_id
`
const operationRowColumns = `
  operation_id, settlement_id, principal_key, command_sha256, command_json,
  plan_definition_sha256, authority_definition_sha256, evidence_json, result_json,
  result_definition_sha256, settlement_revision, created_at, accepted_at_campaign_minute
`

export const createSqliteEncounterSettlementRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EncounterSettlementRepository => {
  const get = (settlementIdInput: string): EncounterSettlementDocument | null => {
    if (!ID.test(settlementIdInput)) fail('invalid-input', 'Encounter settlement identity is invalid.')
    const row = database.connection.prepare(`
      SELECT ${settlementRowColumns} FROM encounter_settlements WHERE settlement_id = ?
    `).get(settlementIdInput) as unknown as SettlementRow | undefined
    return row ? settlementFromRow(row) : null
  }

  const getByEncounterId = (encounterIdInput: string): EncounterSettlementDocument | null => {
    if (!ID.test(encounterIdInput)) fail('invalid-input', 'Encounter identity is invalid.')
    const row = database.connection.prepare(`
      SELECT ${settlementRowColumns} FROM encounter_settlements WHERE encounter_id = ?
    `).get(encounterIdInput) as unknown as SettlementRow | undefined
    return row ? settlementFromRow(row) : null
  }

  const insertSettlement = (document: EncounterSettlementDocument): void => {
    const completionOperationId = document.completion.state === 'accepted'
      ? document.completion.operationId
      : null
    database.connection.prepare(`
      INSERT INTO encounter_settlements (
        settlement_id, encounter_id, status, revision, document_json, definition_sha256,
        created_at_campaign_minute, updated_at_campaign_minute, completion_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      document.settlementId,
      document.encounter.encounterId,
      document.status,
      document.revision,
      stableJsonStringify(document),
      encounterSettlementAtomicDefinitionSha256(document),
      document.createdAtCampaignMinute,
      document.updatedAtCampaignMinute,
      completionOperationId,
    )
  }

  const create = (input: EncounterSettlementDocument): EncounterSettlementDocument => database.withTransaction(() => {
    const document = parseEncounterSettlementDocument(input)
    if (document.revision !== 0 || document.completion.state !== 'open') {
      fail('invalid-input', 'New encounter settlement documents must begin at revision zero with open completion.')
    }
    insertSettlement(document)
    return get(document.settlementId)!
  })

  const replace = (input: {
    readonly expectedRevision: number
    readonly document: EncounterSettlementDocument
  }): EncounterSettlementDocument | null => database.withTransaction(() => {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      fail('invalid-input', 'Expected encounter settlement revision is invalid.')
    }
    const document = parseEncounterSettlementDocument(input.document)
    if (document.revision !== input.expectedRevision + 1) {
      fail('invalid-input', 'Encounter settlement replacement must advance exactly one revision.')
    }
    const completionOperationId = document.completion.state === 'accepted'
      ? document.completion.operationId
      : null
    const result = database.connection.prepare(`
      UPDATE encounter_settlements
      SET status = ?, revision = ?, document_json = ?, definition_sha256 = ?,
          updated_at_campaign_minute = ?, completion_operation_id = ?
      WHERE settlement_id = ? AND revision = ?
    `).run(
      document.status,
      document.revision,
      stableJsonStringify(document),
      encounterSettlementAtomicDefinitionSha256(document),
      document.updatedAtCampaignMinute,
      completionOperationId,
      document.settlementId,
      input.expectedRevision,
    )
    return Number(result.changes) === 1 ? get(document.settlementId) : null
  })

  const getOperation = (operationIdInput: string): StoredEncounterSettlementOperation | null => {
    if (!ID.test(operationIdInput)) fail('invalid-input', 'Encounter settlement operation identity is invalid.')
    const row = database.connection.prepare(`
      SELECT ${operationRowColumns}
      FROM encounter_settlement_operations WHERE operation_id = ?
    `).get(operationIdInput) as unknown as OperationRow | undefined
    return row ? operationFromRow(row) : null
  }

  const planEvidenceForOperation = (operationIdInput: string): EncounterSettlementAtomicCommitPlan => {
    const row = database.connection.prepare(`
      SELECT evidence_json FROM encounter_settlement_operations WHERE operation_id = ?
    `).get(operationIdInput) as { readonly evidence_json?: unknown } | undefined
    return row
      ? assertEncounterSettlementAtomicPlanIntegrity(json(row.evidence_json, 'operation plan evidence'))
      : fail('corrupt-record', 'Stored encounter settlement audit row has no owning operation evidence.')
  }

  const listHistoryFacts = (settlementIdInput: string): readonly StoredEncounterSettlementHistoryFact[] => {
    if (!ID.test(settlementIdInput)) fail('invalid-input', 'Encounter settlement identity is invalid.')
    const facts = (database.connection.prepare(`
      SELECT fact_id, settlement_id, operation_id, fact_kind, audience, subject_kind,
             subject_id, result_code, fact_json, created_at_campaign_minute
      FROM encounter_settlement_history_facts
      WHERE settlement_id = ?
      ORDER BY created_at_campaign_minute DESC, fact_id DESC
    `).all(settlementIdInput) as unknown as HistoryRow[]).map(historyFromRow)
    const plans = new Map<string, EncounterSettlementAtomicCommitPlan>()
    for (const fact of facts) {
      const plan = plans.get(fact.operationId) ?? planEvidenceForOperation(fact.operationId)
      plans.set(fact.operationId, plan)
      const planned = plan.historyFacts.find(row => row.factId === fact.factId)
      const persisted: EncounterSettlementHistoryFact = {
        factId: fact.factId,
        kind: fact.kind,
        audience: fact.audience,
        subjectKind: fact.subjectKind,
        subjectId: fact.subjectId,
        resultCode: fact.resultCode,
        payload: fact.payload,
      }
      if (plan.settlementId !== fact.settlementId || plan.campaignMinute !== fact.createdAtCampaignMinute
        || !planned || sha256(planned) !== sha256(persisted)) {
        fail('corrupt-record', 'Stored encounter settlement history no longer matches its immutable operation evidence.')
      }
    }
    return facts
  }

  const listAttentionSources = (settlementIdInput: string): readonly StoredEncounterSettlementAttentionSource[] => {
    if (!ID.test(settlementIdInput)) fail('invalid-input', 'Encounter settlement identity is invalid.')
    const sources = (database.connection.prepare(`
      SELECT source_id, settlement_id, operation_id, source_fact_id, reason, audience,
             entity_kind, entity_id, status, revision, source_json,
             created_at_campaign_minute, resolved_at_campaign_minute, resolution_operation_id
      FROM encounter_settlement_attention_sources
      WHERE settlement_id = ?
      ORDER BY created_at_campaign_minute ASC, source_id ASC
    `).all(settlementIdInput) as unknown as AttentionRow[]).map(attentionFromRow)
    const plans = new Map<string, EncounterSettlementAtomicCommitPlan>()
    for (const source of sources) {
      const plan = plans.get(source.operationId) ?? planEvidenceForOperation(source.operationId)
      plans.set(source.operationId, plan)
      const planned = plan.attentionSources.find(row => row.sourceId === source.sourceId)
      const persisted: EncounterSettlementAttentionSource = {
        sourceId: source.sourceId,
        reason: source.reason,
        audience: source.audience,
        entityKind: source.entityKind,
        entityId: source.entityId,
        sourceFactId: source.sourceFactId,
        authority: source.authority,
      }
      if (plan.settlementId !== source.settlementId || plan.campaignMinute !== source.createdAtCampaignMinute
        || !planned || sha256(planned) !== sha256(persisted)) {
        fail('corrupt-record', 'Stored encounter settlement attention source no longer matches its immutable operation evidence.')
      }
    }
    return sources
  }

  const applyAtomicCommit = (
    input: ApplyEncounterSettlementAtomicCommitInput,
  ): ApplyEncounterSettlementAtomicCommitResult => {
    const command = parseEncounterSettlementCommitCommand(input.command)
    const principal = principalKey(input.principalKey)
    const plan = assertEncounterSettlementAtomicPlanIntegrity(input.plan)
    if (command.operationId !== plan.operationId || command.settlementId !== plan.settlementId
      || command.expectedSettlementRevision !== plan.expectedSettlementRevision
      || command.planDefinitionSha256 !== plan.planDefinitionSha256) {
      fail('invalid-input', 'Settlement commit command does not match its server-owned atomic plan.')
    }
    const commandSha256 = sha256(command)

    return database.withTransaction(() => {
      const replay = getOperation(command.operationId)
      const collidingCorrection = database.connection.prepare(`
        SELECT 1 AS present FROM encounter_settlement_corrections WHERE operation_id = ?
      `).get(command.operationId)
      if (replay && collidingCorrection) {
        fail('duplicate-operation', 'Settlement operation identity is ambiguous across settlement journals.')
      }
      if (replay) {
        if (replay.commandSha256 !== commandSha256 || replay.principalKey !== principal) {
          fail('duplicate-operation', 'Settlement operation identity was already used by another exact command authority.')
        }
        return Object.freeze({ replayed: true, result: replay.result, persistedRealtimeEvents: [] })
      }
      if (collidingCorrection) {
        fail('duplicate-operation', 'Settlement operation identity is already bound to a correction.')
      }

      const currentAuthority = input.reauthorize()
      assertEncounterSettlementAtomicPlanCurrent({ plan, currentAuthority })
      const currentSettlement = get(plan.settlementId)
        ?? fail('stale-authority', 'Encounter settlement is unavailable before atomic commit.')
      if (currentSettlement.revision !== plan.expectedSettlementRevision
        || encounterSettlementAtomicDefinitionSha256(currentSettlement) !== plan.settlementWrite.beforeDefinitionSha256
        || currentSettlement.completion.state !== 'open') {
        fail('stale-authority', 'Encounter settlement changed before atomic commit.')
      }
      if (createSqliteCampaignClockRepository(database).get().campaignMinute !== plan.campaignMinute) {
        fail('stale-authority', 'Campaign clock changed before atomic settlement commit.')
      }

      const encounterRepository = createSqliteEncounterDocumentRepository(database)
      const mapRepository = createSqliteMapRepository(database)
      const sheetRepository = createSqliteSheetRepository(database)
      const groupRepository = createSqliteGroupInventoryRepository(database)
      const currentEncounter = encounterRepository.get(plan.encounterWrite.encounterId)
      if (!currentEncounter || currentEncounter.revision !== plan.encounterWrite.expectedRevision
        || encounterSettlementAtomicDefinitionSha256(currentEncounter) !== plan.encounterWrite.beforeDefinitionSha256) {
        fail('stale-authority', 'Encounter Document changed before atomic settlement commit.')
      }
      const currentMap = mapRepository.getBySlug(currentSettlement.encounter.linkedMapSlug)
      if (!currentMap || Number(currentMap.revision ?? 0) !== currentSettlement.encounter.linkedMapRevision
        || (plan.mapWrite !== null
          && encounterSettlementAtomicDefinitionSha256(currentMap) !== plan.mapWrite.beforeDefinitionSha256)) {
        fail('stale-authority', 'Encounter map changed before atomic settlement commit.')
      }
      for (const write of plan.sheetWrites) {
        const current = sheetRepository.get(write.kind, write.slug)
        if (!current || current.revision !== write.expectedRevision
          || encounterSettlementAtomicDefinitionSha256(current.document) !== write.beforeDefinitionSha256) {
          fail('stale-authority', 'A settlement sheet changed before atomic commit.')
        }
      }
      for (const write of plan.groupWrites) {
        const current = groupRepository.get(write.slug)
        if (!current || current.revision !== write.expectedRevision
          || encounterSettlementAtomicDefinitionSha256(current.document) !== write.beforeDefinitionSha256) {
          fail('stale-authority', 'A group inventory changed before atomic settlement commit.')
        }
      }

      const encounter = encounterRepository.replace({
        expectedRevision: plan.encounterWrite.expectedRevision,
        document: plan.encounterWrite.nextDocument,
      })
      if (!encounter || encounterSettlementAtomicDefinitionSha256(encounter) !== plan.encounterWrite.afterDefinitionSha256) {
        fail('write-drift', 'Encounter Document did not persist the exact atomic successor.')
      }
      input.onWriteBoundary?.('after-encounter-write')

      if (plan.mapWrite) {
        const outcome = mapRepository.applyLivePlayUpdate({
          slug: plan.mapWrite.mapSlug,
          expectedRevision: plan.mapWrite.expectedRevision,
          nextMap: plan.mapWrite.nextMap,
        })
        const persisted = mapRepository.getBySlug(plan.mapWrite.mapSlug)
        if (outcome !== 'applied' || !persisted
          || encounterSettlementAtomicDefinitionSha256(persisted) !== plan.mapWrite.afterDefinitionSha256) {
          fail('write-drift', 'Encounter map did not persist the exact atomic successor.')
        }
        input.onWriteBoundary?.('after-map-write')
      }

      for (const write of plan.sheetWrites) {
        const outcome = sheetRepository.applyLivePlayUpdate({
          kind: write.kind,
          slug: write.slug,
          expectedRevision: write.expectedRevision,
          nextSheet: write.nextDocument as unknown as Record<string, unknown>,
          sourceOperationId: plan.operationId,
          allowMedicalTreatmentTransition: true,
        })
        const persisted = sheetRepository.get(write.kind, write.slug)
        if (outcome !== 'applied' || !persisted
          || encounterSettlementAtomicDefinitionSha256(persisted.document) !== write.afterDefinitionSha256) {
          fail('write-drift', 'A settlement sheet did not persist the exact atomic successor.')
        }
        input.onWriteBoundary?.(`after-sheet-write:${write.kind}:${write.slug}`)
      }

      for (const write of plan.groupWrites) {
        const outcome = groupRepository.applyLivePlayUpdate({
          slug: write.slug,
          expectedRevision: write.expectedRevision,
          nextDocument: write.nextDocument,
          now: plan.committedAt,
        })
        if (outcome.status !== 'applied'
          || encounterSettlementAtomicDefinitionSha256(outcome.document) !== write.afterDefinitionSha256) {
          fail('write-drift', 'A group inventory did not persist the exact atomic successor.')
        }
        input.onWriteBoundary?.(`after-group-write:${write.slug}`)
      }

      const committedSettlement = replace({
        expectedRevision: plan.settlementWrite.expectedRevision,
        document: plan.settlementWrite.nextDocument,
      })
      if (!committedSettlement
        || encounterSettlementAtomicDefinitionSha256(committedSettlement) !== plan.settlementWrite.afterDefinitionSha256) {
        fail('write-drift', 'Settlement document did not persist the exact terminal successor.')
      }
      input.onWriteBoundary?.('after-settlement-write')

      const result = parseEncounterSettlementCommitResult({
        schemaVersion: 1,
        operationId: plan.operationId,
        settlementId: plan.settlementId,
        settlementRevision: plan.settlementWrite.revision,
        encounterId: plan.encounterWrite.encounterId,
        encounterRevision: plan.encounterWrite.revision,
        mapSlug: currentSettlement.encounter.linkedMapSlug,
        mapRevision: plan.mapWrite?.revision ?? null,
        sheetRevisions: plan.sheetWrites.map(write => ({
          kind: write.kind, slug: write.slug, revision: write.revision,
        })),
        groupRevisions: plan.groupWrites.map(write => ({ slug: write.slug, revision: write.revision })),
        historyFactIds: plan.historyFacts.map(fact => fact.factId),
        attentionSourceIds: plan.attentionSources.map(source => source.sourceId),
        completedAtCampaignMinute: plan.campaignMinute,
      })
      database.connection.prepare(`
        INSERT INTO encounter_settlement_operations (
          operation_id, settlement_id, principal_key, command_sha256, command_json,
          plan_definition_sha256, authority_definition_sha256, evidence_json,
          result_json, result_definition_sha256, settlement_revision, created_at,
          accepted_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        plan.operationId,
        plan.settlementId,
        principal,
        commandSha256,
        stableJsonStringify(command),
        plan.planDefinitionSha256,
        plan.authorityDefinitionSha256,
        stableJsonStringify(plan),
        stableJsonStringify(result),
        sha256(result),
        plan.settlementWrite.revision,
        plan.committedAt,
        plan.campaignMinute,
      )
      input.onWriteBoundary?.('after-operation-write')

      for (const fact of plan.historyFacts) {
        database.connection.prepare(`
          INSERT INTO encounter_settlement_history_facts (
            fact_id, settlement_id, operation_id, fact_kind, audience, subject_kind,
            subject_id, result_code, fact_json, created_at_campaign_minute
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fact.factId,
          plan.settlementId,
          plan.operationId,
          fact.kind,
          fact.audience,
          fact.subjectKind,
          fact.subjectId,
          fact.resultCode,
          stableJsonStringify(fact),
          plan.campaignMinute,
        )
        input.onWriteBoundary?.(`after-history-write:${fact.factId}`)
      }

      for (const source of plan.attentionSources) {
        database.connection.prepare(`
          INSERT INTO encounter_settlement_attention_sources (
            source_id, settlement_id, operation_id, source_fact_id, reason, audience,
            entity_kind, entity_id, status, revision, source_json,
            created_at_campaign_minute, resolved_at_campaign_minute, resolution_operation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, NULL, NULL)
        `).run(
          source.sourceId,
          plan.settlementId,
          plan.operationId,
          source.sourceFactId,
          source.reason,
          source.audience,
          source.entityKind,
          source.entityId,
          stableJsonStringify(source),
          plan.campaignMinute,
        )
        input.onWriteBoundary?.(`after-attention-write:${source.sourceId}`)
      }

      const sheetRealtime = plan.sheetWrites.flatMap((write) => {
        const update = normalizeAuthoritativeSheetDocumentUpdate({
          kind: write.kind,
          slug: write.slug,
          sheet: write.nextDocument as unknown as Record<string, unknown>,
        }, 'encounter settlement sheet')
        return (['specific', 'global'] as const).map(destination => sheetDocumentUpdatedRealtimeAppendInput({
          update,
          destination,
          dedupeKey: `encounter-settlement-sheet:${createHash('sha256').update([
            plan.settlementId,
            String(plan.settlementWrite.revision),
            write.kind,
            write.slug,
            destination,
          ].join('\u0000')).digest('hex')}`,
        }))
      })
      const historyForProjection = plan.historyFacts.map(fact => ({
        ...fact,
        createdAtCampaignMinute: plan.campaignMinute,
      }))
      const realtimeInputs = [
        ...encounterDocumentRealtimeAppendInputs({
          document: plan.encounterWrite.nextDocument,
          kind: 'updated',
          previousRevision: plan.encounterWrite.expectedRevision,
          operationId: null,
          timestamp: plan.committedAt,
        }),
        ...(plan.mapWrite
          ? mapLibraryUpdatedRealtimeAppendInputs(
              plan.mapWrite.nextMap,
              undefined,
              'encounter-settlement',
            )
          : []),
        ...sheetRealtime,
        ...plan.groupWrites.flatMap(write => groupInventoryUpdatedRealtimeAppendInputs(
          write.nextDocument,
          undefined,
          'encounter-settlement',
        )),
        ...encounterSettlementRealtimeAppendInputs({
          settlement: plan.settlementWrite.nextDocument,
          history: historyForProjection,
          kind: 'updated',
          timestamp: plan.committedAt,
        }),
      ]
      const persistedRealtimeEvents = createSqliteRealtimeEventRepository({
        database,
        clock: () => plan.committedAt,
      }).appendMany(realtimeInputs)
      input.onWriteBoundary?.('after-realtime-write')
      input.onWriteBoundary?.('before-commit')
      return Object.freeze({ replayed: false, result, persistedRealtimeEvents })
    })
  }

  return Object.freeze({
    database,
    get,
    getByEncounterId,
    create,
    replace,
    getOperation,
    listHistoryFacts,
    listAttentionSources,
    applyAtomicCommit,
  })
}
