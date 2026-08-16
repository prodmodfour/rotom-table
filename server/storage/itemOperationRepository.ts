import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ITEM_OPERATION_SCHEMA_VERSION,
  parseItemOperationPlan,
  parseItemPendingDecision,
  parseUseItemCommand,
  type ItemAggregateRef,
  type ItemOperationPlanV1,
  type ItemOperationResultV1,
  type ItemPendingDecisionV1,
  type UseItemCommandV1,
} from '#shared/itemAutomation/operations'
import { parseResumeItemOperationCommand, type ResumeItemOperationCommandV1 } from '#shared/itemAutomation/resume'
import { parseItemOperationRecoveryCommand, type ItemOperationRecoveryCommandV1 } from '#shared/itemAutomation/recovery'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export const ITEM_OPERATION_STORE_SCHEMA_VERSION = 1 as const
export type StoredItemOperationStatus = 'pending' | 'accepted' | 'rejected' | 'abandoned' | 'corrected'

export interface StoredItemOperationRecord {
  readonly schemaVersion: typeof ITEM_OPERATION_STORE_SCHEMA_VERSION
  readonly operationId: string
  readonly commandSha256: string
  readonly command: UseItemCommandV1
  readonly resumeCommandSha256: string | null
  readonly resumeCommand: ResumeItemOperationCommandV1 | null
  readonly status: StoredItemOperationStatus
  readonly canonicalItemId: string | null
  readonly canonicalDefinitionSha256: string | null
  readonly plan: ItemOperationPlanV1 | null
  readonly pendingDecision: ItemPendingDecisionV1 | null
  readonly result: ItemOperationResultV1 | null
  readonly correctionOfOperationId: string | null
  readonly recoveryCommandSha256: string | null
  readonly recoveryCommand: ItemOperationRecoveryCommandV1 | null
  readonly compensation: ItemOperationCompensationV1 | null
  readonly scopes: readonly ItemAggregateRef[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ItemOperationCompensationSheetV1 {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly beforeRevision: number
  readonly afterRevision: number
  readonly beforeSheet: Record<string, unknown>
  readonly afterSheet: Record<string, unknown>
}

export interface ItemOperationCompensationMapV1 {
  readonly slug: string
  readonly beforeRevision: number
  readonly afterRevision: number
  readonly beforeMap: Record<string, unknown>
  readonly afterMap: Record<string, unknown>
}

export interface ItemOperationCompensationGroupInventoryV1 {
  readonly slug: string
  readonly beforeRevision: number
  readonly afterRevision: number
  readonly beforeDocument: Record<string, unknown>
  readonly afterDocument: Record<string, unknown>
}

export interface ItemOperationCompensationV1 {
  readonly schemaVersion: 1
  readonly map: ItemOperationCompensationMapV1 | null
  readonly sheets: readonly ItemOperationCompensationSheetV1[]
  readonly groupInventory: ItemOperationCompensationGroupInventoryV1 | null
}

export interface CreatePendingItemOperationInput {
  readonly command: UseItemCommandV1
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly plan: ItemOperationPlanV1
  readonly pendingDecision?: ItemPendingDecisionV1 | null
  readonly compensation?: ItemOperationCompensationV1 | null
  readonly createdAt?: number
}

export interface ReplacePendingItemOperationCommandInput {
  readonly operationId: string
  readonly expectedCommandSha256: string
  readonly command: UseItemCommandV1
  readonly resumeCommand: ResumeItemOperationCommandV1
  readonly plan: ItemOperationPlanV1
  readonly compensation?: ItemOperationCompensationV1 | null
  readonly updatedAt?: number
}

export interface CompleteItemOperationInput {
  readonly operationId: string
  readonly commandSha256: string
  readonly status: Exclude<StoredItemOperationStatus, 'pending'>
  readonly result: ItemOperationResultV1
  readonly updatedAt?: number
}

export interface RecoverItemOperationInput {
  readonly operationId: string
  readonly command: ItemOperationRecoveryCommandV1
  readonly status: 'abandoned' | 'corrected'
  readonly result: ItemOperationResultV1
  readonly correctionOfOperationId?: string | null
  readonly updatedAt?: number
}

export interface ItemOperationRepository {
  get(operationId: string): StoredItemOperationRecord | null
  findCorrectionOf(operationId: string): StoredItemOperationRecord | null
  listPending(): readonly StoredItemOperationRecord[]
  hasPendingForMap(mapSlug: string): boolean
  listForMap(mapSlug: string, limit?: number): readonly StoredItemOperationRecord[]
  reservedQuantity(sourceInstanceId: string, excludingOperationId?: string): number
  createPending(input: CreatePendingItemOperationInput): StoredItemOperationRecord
  replacePendingCommand(input: ReplacePendingItemOperationCommandInput): StoredItemOperationRecord
  complete(input: CompleteItemOperationInput): StoredItemOperationRecord
  recover(input: RecoverItemOperationInput): StoredItemOperationRecord
}

export interface CreateSqliteItemOperationRepositoryOptions {
  readonly database?: RotomDatabase
  readonly clock?: () => number
}

interface ItemOperationRow {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly resume_command_sha256: unknown
  readonly resume_command_json: unknown
  readonly status: unknown
  readonly canonical_item_id: unknown
  readonly canonical_definition_sha256: unknown
  readonly plan_json: unknown
  readonly pending_decision_json: unknown
  readonly result_json: unknown
  readonly correction_of_operation_id: unknown
  readonly compensation_json: unknown
  readonly recovery_command_sha256: unknown
  readonly recovery_command_json: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

interface ItemOperationScopeRow {
  readonly scope_kind: unknown
  readonly scope_key: unknown
  readonly expected_revision: unknown
  readonly scope_json: unknown
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const STATUS_SET = new Set<StoredItemOperationStatus>(['pending', 'accepted', 'rejected', 'abandoned', 'corrected'])
const TERMINAL_STATUS_BY_RESULT = Object.freeze({ accepted: 'accepted', rejected: 'rejected', pending: 'pending' } as const)

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
export const itemOperationCommandSha256 = (command: UseItemCommandV1): string => sha256(stableJsonStringify(command))
export const itemOperationResumeCommandSha256 = (command: ResumeItemOperationCommandV1): string => sha256(stableJsonStringify(command))
export const itemOperationRecoveryCommandSha256 = (command: ItemOperationRecoveryCommandV1): string => sha256(stableJsonStringify(command))

const operationId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) throw new Error(`${label} must be a valid item operation ID.`)
  return value
}

const digest = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`)
  return value
}

const nullableText = (value: unknown, label: string): string | null => {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be null or non-empty text.`)
  return value
}

const status = (value: unknown): StoredItemOperationStatus => {
  if (typeof value !== 'string' || !STATUS_SET.has(value as StoredItemOperationStatus)) throw new Error('item_operations.status is invalid.')
  return value as StoredItemOperationStatus
}

const parseResult = (value: unknown, label: string): ItemOperationResultV1 | null => {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be JSON text or null.`)
  const result = parseStoredDocumentJson<unknown>(value, label)
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`${label} must be an item operation result object.`)
  const row = result as Record<string, unknown>
  const baseValid = row.schemaVersion === ITEM_OPERATION_SCHEMA_VERSION
    && typeof row.operationId === 'string'
    && typeof row.exactReplay === 'boolean'
    && ['accepted', 'rejected', 'pending'].includes(String(row.status))
  const statusValid = row.status === 'accepted'
    ? typeof row.canonicalItemId === 'string' && Array.isArray(row.aggregateRefs)
      && typeof row.receiptId === 'string'
    : row.status === 'rejected'
      ? (row.canonicalItemId === null || typeof row.canonicalItemId === 'string')
        && typeof row.reasonId === 'string' && typeof row.message === 'string'
      : typeof row.canonicalItemId === 'string' && typeof row.decisionId === 'string'
        && (row.reservationId === null || typeof row.reservationId === 'string')
  if (!baseValid || !statusValid) throw new Error(`${label} is not a valid item operation result.`)
  return cloneStoredJson(result as ItemOperationResultV1)
}

const parseCompensation = (value: unknown, label: string): ItemOperationCompensationV1 | null => {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be JSON text or null.`)
  const parsed = parseStoredDocumentJson<unknown>(value, label)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be an object.`)
  const root = parsed as Record<string, unknown>
  if (root.schemaVersion !== 1 || !Array.isArray(root.sheets)
    || (root.map !== null && (typeof root.map !== 'object' || Array.isArray(root.map)))
    || (root.groupInventory !== null && (typeof root.groupInventory !== 'object' || Array.isArray(root.groupInventory)))) {
    throw new Error(`${label} is not valid item compensation evidence.`)
  }
  return cloneStoredJson(parsed as ItemOperationCompensationV1)
}

const scopeKeyFor = (scope: ItemAggregateRef): string => scope.kind === 'sheet'
  ? `${scope.sheetKind}:${scope.id}`
  : scope.id

const loadScopes = (database: RotomDatabase, id: string): readonly ItemAggregateRef[] => {
  const rows = database.connection.prepare(`
    SELECT scope_kind, scope_key, expected_revision, scope_json
    FROM item_operation_scopes
    WHERE operation_id = ?
    ORDER BY scope_kind, scope_key
  `).all(id) as unknown as ItemOperationScopeRow[]
  return Object.freeze(rows.map((row, index) => {
    if (typeof row.scope_json !== 'string') throw new Error(`item operation ${id} scope ${index} must contain JSON.`)
    const scope = parseStoredDocumentJson<ItemAggregateRef>(row.scope_json, `item operation ${id} scope ${index}`)
    if (typeof row.scope_kind !== 'string' || scope.kind !== row.scope_kind
      || scopeKeyFor(scope) !== row.scope_key || scope.revision !== row.expected_revision) {
      throw new Error(`item operation ${id} scope ${index} columns do not match scope_json.`)
    }
    return cloneStoredJson(scope)
  }))
}

const rowToRecord = (database: RotomDatabase, row: ItemOperationRow): StoredItemOperationRecord => {
  const id = operationId(row.operation_id, 'item_operations.operation_id')
  if (typeof row.command_json !== 'string') throw new Error(`item operation ${id} command_json must be text.`)
  const command = parseUseItemCommand(parseStoredDocumentJson<unknown>(row.command_json, `item operation ${id} command`))
  const commandSha256 = digest(row.command_sha256, `item operation ${id} command_sha256`)
  if (command.operationId !== id || itemOperationCommandSha256(command) !== commandSha256) throw new Error(`item operation ${id} command evidence drifted.`)
  const resumeCommand = row.resume_command_json === null
    ? null
    : parseResumeItemOperationCommand(parseStoredDocumentJson<unknown>(String(row.resume_command_json), `item operation ${id} resume command`))
  const resumeCommandSha256 = row.resume_command_sha256 === null
    ? null
    : digest(row.resume_command_sha256, `item operation ${id} resume_command_sha256`)
  if ((resumeCommand === null) !== (resumeCommandSha256 === null)
    || (resumeCommand && (resumeCommand.operationId !== id || itemOperationResumeCommandSha256(resumeCommand) !== resumeCommandSha256))) {
    throw new Error(`item operation ${id} resume command evidence drifted.`)
  }
  const storedStatus = status(row.status)
  const plan = row.plan_json === null
    ? null
    : parseItemOperationPlan(parseStoredDocumentJson<unknown>(String(row.plan_json), `item operation ${id} plan`))
  const pendingDecision = row.pending_decision_json === null
    ? null
    : parseItemPendingDecision(parseStoredDocumentJson<unknown>(String(row.pending_decision_json), `item operation ${id} pending decision`))
  if (pendingDecision && (pendingDecision.operationId !== id || pendingDecision.sourceInstanceId !== command.sourceInstanceId)) {
    throw new Error(`item operation ${id} pending decision identity drifted.`)
  }
  if (resumeCommand && (!pendingDecision || resumeCommand.decisionId !== pendingDecision.decisionId)) {
    throw new Error(`item operation ${id} resume decision evidence drifted.`)
  }
  const result = parseResult(row.result_json, `item operation ${id} result`)
  const compensation = parseCompensation(row.compensation_json, `item operation ${id} compensation`)
  if (storedStatus === 'corrected' && compensation !== null) {
    throw new Error(`item operation ${id} correction row must not carry origin compensation evidence.`)
  }
  if ((storedStatus === 'pending') !== (result === null)) throw new Error(`item operation ${id} status and result are inconsistent.`)
  if (result && result.operationId !== id) throw new Error(`item operation ${id} result identity drifted.`)
  if (result && storedStatus !== 'abandoned' && storedStatus !== 'corrected'
    && TERMINAL_STATUS_BY_RESULT[result.status] !== storedStatus) throw new Error(`item operation ${id} terminal status drifted.`)
  const canonicalDefinitionSha256 = row.canonical_definition_sha256 === null
    ? null
    : digest(row.canonical_definition_sha256, `item operation ${id} canonical_definition_sha256`)
  const recoveryCommand = row.recovery_command_json === null
    ? null
    : parseItemOperationRecoveryCommand(parseStoredDocumentJson<unknown>(String(row.recovery_command_json), `item operation ${id} recovery command`))
  const recoveryCommandSha256 = row.recovery_command_sha256 === null
    ? null
    : digest(row.recovery_command_sha256, `item operation ${id} recovery_command_sha256`)
  const correctionOfOperationId = nullableText(row.correction_of_operation_id, `item operation ${id} correction_of_operation_id`)
  const expectedRecoveryOperationId = recoveryCommand?.action === 'correct'
    ? correctionOfOperationId
    : id
  if ((recoveryCommand === null) !== (recoveryCommandSha256 === null)
    || (recoveryCommand && (recoveryCommand.operationId !== expectedRecoveryOperationId
      || itemOperationRecoveryCommandSha256(recoveryCommand) !== recoveryCommandSha256))) {
    throw new Error(`item operation ${id} recovery command evidence drifted.`)
  }
  if ((storedStatus === 'abandoned' || storedStatus === 'corrected') !== (recoveryCommand !== null)) {
    throw new Error(`item operation ${id} recovery status and command evidence are inconsistent.`)
  }
  if (storedStatus === 'corrected' && recoveryCommand?.action !== 'correct') {
    throw new Error(`item operation ${id} corrected recovery evidence drifted.`)
  }
  if (storedStatus === 'abandoned' && recoveryCommand?.action !== 'abandon') {
    throw new Error(`item operation ${id} abandoned recovery evidence drifted.`)
  }
  if (storedStatus === 'corrected') {
    if (!correctionOfOperationId || recoveryCommand?.action !== 'correct'
      || recoveryCommand.correctionOperationId !== id
      || recoveryCommand.operationId !== correctionOfOperationId) {
      throw new Error(`item operation ${id} correction ancestry drifted.`)
    }
  }
  else if (correctionOfOperationId !== null) {
    throw new Error(`item operation ${id} has correction ancestry without corrected status.`)
  }
  return Object.freeze({
    schemaVersion: ITEM_OPERATION_STORE_SCHEMA_VERSION,
    operationId: id,
    commandSha256,
    command,
    resumeCommandSha256,
    resumeCommand,
    status: storedStatus,
    canonicalItemId: nullableText(row.canonical_item_id, `item operation ${id} canonical_item_id`),
    canonicalDefinitionSha256,
    plan,
    pendingDecision,
    result,
    correctionOfOperationId,
    recoveryCommandSha256,
    recoveryCommand,
    compensation,
    scopes: loadScopes(database, id),
    createdAt: parseStoredTimestamp(row.created_at, `item operation ${id} created_at`),
    updatedAt: parseStoredTimestamp(row.updated_at, `item operation ${id} updated_at`),
  })
}

const selectById = (database: RotomDatabase, id: string): StoredItemOperationRecord | null => {
  const row = database.connection.prepare(`
    SELECT operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json,
      status, canonical_item_id, canonical_definition_sha256, plan_json, pending_decision_json, result_json, correction_of_operation_id,
      recovery_command_sha256, recovery_command_json, compensation_json, created_at, updated_at
    FROM item_operations WHERE operation_id = ?
  `).get(operationId(id, 'item operation ID')) as ItemOperationRow | undefined
  return row ? rowToRecord(database, row) : null
}

const sameCommand = (record: StoredItemOperationRecord, command: UseItemCommandV1): boolean => (
  record.commandSha256 === itemOperationCommandSha256(command)
  && stableJsonStringify(record.command) === stableJsonStringify(command)
)

const selectCorrectionOf = (database: RotomDatabase, originOperationId: string): StoredItemOperationRecord | null => {
  const rows = database.connection.prepare(`
    SELECT operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json,
      status, canonical_item_id, canonical_definition_sha256, plan_json, pending_decision_json, result_json,
      correction_of_operation_id, recovery_command_sha256, recovery_command_json, compensation_json, created_at, updated_at
    FROM item_operations
    WHERE correction_of_operation_id = ?
    ORDER BY created_at, operation_id
    LIMIT 2
  `).all(operationId(originOperationId, 'origin item operation ID')) as unknown as ItemOperationRow[]
  if (rows.length > 1) throw new Error(`Item operation ${originOperationId} has multiple correction records.`)
  return rows[0] ? rowToRecord(database, rows[0]) : null
}

export const createSqliteItemOperationRepository = (
  options: CreateSqliteItemOperationRepositoryOptions = {},
): ItemOperationRepository => {
  const database = options.database ?? getRotomDatabase()
  const clock = options.clock ?? Date.now

  const createPending = (input: CreatePendingItemOperationInput): StoredItemOperationRecord => database.withTransaction(() => {
    const command = parseUseItemCommand(input.command)
    const plan = parseItemOperationPlan(input.plan)
    const pendingDecision = input.pendingDecision === undefined || input.pendingDecision === null
      ? null
      : parseItemPendingDecision(input.pendingDecision)
    if (plan.operationId !== command.operationId) throw new Error('Item operation plan must match the command operation ID.')
    if (plan.canonicalItemId !== input.canonicalItemId || plan.canonicalDefinitionSha256 !== input.canonicalDefinitionSha256) {
      throw new Error('Item operation plan canonical evidence must match the registered definition.')
    }
    if (stableJsonStringify(plan.readSet) !== stableJsonStringify(command.readSet)) {
      throw new Error('Item operation plan read set must exactly match the command read set.')
    }
    if (pendingDecision && (pendingDecision.operationId !== command.operationId
      || pendingDecision.canonicalItemId !== input.canonicalItemId
      || pendingDecision.sourceInstanceId !== command.sourceInstanceId)) {
      throw new Error('Item pending decision identity must match the reserved command and canonical item.')
    }
    const compensation = input.compensation === undefined || input.compensation === null
      ? null
      : cloneStoredJson(input.compensation)
    if (pendingDecision && compensation !== null) {
      throw new Error('Unresolved item reservations cannot carry applied compensation evidence.')
    }
    const commandSha256 = itemOperationCommandSha256(command)
    const existing = selectById(database, command.operationId)
    if (existing) {
      if (!sameCommand(existing, command)) throw new Error(`Item operation ${command.operationId} was reused for a different command.`)
      return existing
    }
    const createdAt = parseStoredTimestamp(input.createdAt ?? clock(), 'item operation createdAt')
    database.connection.prepare(`
      INSERT INTO item_operations (
        operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json, status, canonical_item_id,
        canonical_definition_sha256, plan_json, pending_decision_json, result_json, correction_of_operation_id,
        compensation_json, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    `).run(
      command.operationId,
      commandSha256,
      stringifyStoredDocument(command),
      input.canonicalItemId,
      digest(input.canonicalDefinitionSha256, 'canonical definition SHA-256'),
      stringifyStoredDocument(plan),
      pendingDecision ? stringifyStoredDocument(pendingDecision) : null,
      compensation ? stringifyStoredDocument(compensation) : null,
      createdAt,
      createdAt,
    )
    const insertScope = database.connection.prepare(`
      INSERT INTO item_operation_scopes (
        operation_id, scope_kind, scope_key, expected_revision, scope_json
      ) VALUES (?, ?, ?, ?, ?)
    `)
    for (const scope of command.readSet) {
      insertScope.run(command.operationId, scope.kind, scopeKeyFor(scope), scope.revision, stringifyStoredDocument(scope))
    }
    return selectById(database, command.operationId)
      ?? (() => { throw new Error(`Item operation ${command.operationId} was not readable after insert.`) })()
  })

  const pendingCommandMatchesReservation = (input: {
    readonly existing: StoredItemOperationRecord
    readonly command: UseItemCommandV1
  }): boolean => {
    const immutableCommand = {
      ...input.command,
      targetIds: input.existing.command.targetIds,
      choices: input.existing.command.choices,
    }
    if (stableJsonStringify(immutableCommand) === stableJsonStringify(input.existing.command)) return true
    const existingSource = input.existing.command.source
    const candidateSource = input.command.source
    if (existingSource.kind !== 'group' || candidateSource.kind !== 'group'
      || input.existing.command.context !== 'sheet' || input.command.context !== 'sheet'
      || !input.existing.pendingDecision?.reservation
      || input.existing.pendingDecision.sourceInstanceId !== input.existing.command.sourceInstanceId
      || candidateSource.expectedRevision <= existingSource.expectedRevision
      || candidateSource.slug !== existingSource.slug
      || candidateSource.section !== existingSource.section
      || candidateSource.rowId !== existingSource.rowId) return false
    const existingGroupRefs = input.existing.command.readSet.filter(ref => ref.kind === 'group-inventory')
    const candidateGroupRefs = input.command.readSet.filter(ref => ref.kind === 'group-inventory')
    if (existingGroupRefs.length !== 1 || candidateGroupRefs.length !== 1
      || existingGroupRefs[0]?.id !== existingSource.slug
      || candidateGroupRefs[0]?.id !== existingSource.slug
      || candidateGroupRefs[0]?.revision !== candidateSource.expectedRevision) return false
    const rebasedExisting = {
      ...input.existing.command,
      source: { ...existingSource, expectedRevision: candidateSource.expectedRevision },
      readSet: input.existing.command.readSet.map(ref => ref.kind === 'group-inventory'
        ? { ...ref, revision: candidateSource.expectedRevision }
        : ref),
    }
    return stableJsonStringify(immutableCommand) === stableJsonStringify(rebasedExisting)
  }

  const replacePendingCommand = (input: ReplacePendingItemOperationCommandInput): StoredItemOperationRecord => database.withTransaction(() => {
    const id = operationId(input.operationId, 'item operation ID')
    const expectedHash = digest(input.expectedCommandSha256, 'expected item command SHA-256')
    const existing = selectById(database, id)
      ?? (() => { throw new Error(`Item operation ${id} does not exist.`) })()
    if (existing.status !== 'pending' || existing.commandSha256 !== expectedHash || !existing.pendingDecision) {
      throw new Error(`Item operation ${id} is not the expected pending decision.`)
    }
    const command = parseUseItemCommand(input.command)
    const resumeCommand = parseResumeItemOperationCommand(input.resumeCommand)
    const plan = parseItemOperationPlan(input.plan)
    if (command.operationId !== id || resumeCommand.operationId !== id
      || resumeCommand.decisionId !== existing.pendingDecision.decisionId
      || plan.operationId !== id
      || !pendingCommandMatchesReservation({ existing, command })
      || plan.canonicalItemId !== existing.canonicalItemId
      || plan.canonicalDefinitionSha256 !== existing.canonicalDefinitionSha256
      || stableJsonStringify(plan.readSet) !== stableJsonStringify(command.readSet)) {
      throw new Error(`Item operation ${id} resume authority does not match its reservation.`)
    }
    const compensation = input.compensation === undefined || input.compensation === null
      ? null
      : cloneStoredJson(input.compensation)
    const resumeHash = itemOperationResumeCommandSha256(resumeCommand)
    if (existing.resumeCommand) {
      if (existing.resumeCommandSha256 !== resumeHash
        || stableJsonStringify(existing.resumeCommand) !== stableJsonStringify(resumeCommand)
        || stableJsonStringify(existing.plan) !== stableJsonStringify(plan)
        || stableJsonStringify(existing.compensation) !== stableJsonStringify(compensation)) {
        throw new Error(`Item operation ${id} was resumed with different choices.`)
      }
      return existing
    }
    const updatedAt = parseStoredTimestamp(input.updatedAt ?? clock(), 'item operation resume updatedAt')
    const changed = database.connection.prepare(`
      UPDATE item_operations
      SET resume_command_sha256 = ?, resume_command_json = ?, plan_json = ?, compensation_json = ?, updated_at = ?
      WHERE operation_id = ? AND status = 'pending' AND command_sha256 = ? AND resume_command_json IS NULL
    `).run(
      resumeHash,
      stringifyStoredDocument(resumeCommand),
      stringifyStoredDocument(plan),
      compensation ? stringifyStoredDocument(compensation) : null,
      updatedAt,
      id,
      expectedHash,
    )
    if (Number(changed.changes) !== 1) throw new Error(`Item operation ${id} could not resume atomically.`)
    return selectById(database, id)
      ?? (() => { throw new Error(`Item operation ${id} was not readable after resume.`) })()
  })

  const complete = (input: CompleteItemOperationInput): StoredItemOperationRecord => database.withTransaction(() => {
    const id = operationId(input.operationId, 'item operation ID')
    const expectedHash = digest(input.commandSha256, 'item operation command SHA-256')
    const existing = selectById(database, id)
      ?? (() => { throw new Error(`Item operation ${id} does not exist.`) })()
    if (existing.commandSha256 !== expectedHash) throw new Error(`Item operation ${id} command hash does not match.`)
    if (input.result.operationId !== id || input.result.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) throw new Error(`Item operation ${id} result identity is invalid.`)
    if (input.status === 'abandoned' || input.status === 'corrected') {
      throw new Error(`Item operation ${id} recovery statuses require immutable recovery command evidence.`)
    }
    if (TERMINAL_STATUS_BY_RESULT[input.result.status] !== input.status) throw new Error(`Item operation ${id} result does not match terminal status.`)
    if (existing.status !== 'pending') {
      if (existing.status !== input.status || stableJsonStringify(existing.result) !== stableJsonStringify(input.result)) {
        throw new Error(`Item operation ${id} already has a different terminal result.`)
      }
      return existing
    }
    const updatedAt = parseStoredTimestamp(input.updatedAt ?? clock(), 'item operation updatedAt')
    if (updatedAt < existing.createdAt) throw new Error('Item operation updatedAt cannot precede createdAt.')
    const changed = database.connection.prepare(`
      UPDATE item_operations
      SET status = ?, result_json = ?, updated_at = ?
      WHERE operation_id = ? AND status = 'pending' AND command_sha256 = ?
    `).run(input.status, stringifyStoredDocument(input.result), updatedAt, id, expectedHash)
    if (Number(changed.changes) !== 1) throw new Error(`Item operation ${id} could not transition atomically.`)
    return selectById(database, id)
      ?? (() => { throw new Error(`Item operation ${id} was not readable after completion.`) })()
  })

  const recover = (input: RecoverItemOperationInput): StoredItemOperationRecord => database.withTransaction(() => {
    const originId = operationId(input.operationId, 'item operation ID')
    const command = parseItemOperationRecoveryCommand(input.command)
    if (command.operationId !== originId) throw new Error(`Item operation ${originId} recovery command identity is invalid.`)
    if ((input.status === 'abandoned') !== (command.action === 'abandon')) {
      throw new Error(`Item operation ${originId} recovery command does not match terminal status.`)
    }
    const commandHash = itemOperationRecoveryCommandSha256(command)
    const origin = selectById(database, originId)
      ?? (() => { throw new Error(`Item operation ${originId} does not exist.`) })()
    const updatedAt = parseStoredTimestamp(input.updatedAt ?? clock(), 'item operation recovery updatedAt')
    if (updatedAt < origin.updatedAt) throw new Error('Item operation recovery updatedAt cannot precede its terminal evidence.')

    if (input.status === 'abandoned') {
      if (input.result.operationId !== originId || input.result.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) {
        throw new Error(`Item operation ${originId} abandonment result identity is invalid.`)
      }
      if (origin.status === 'abandoned') {
        if (origin.recoveryCommandSha256 !== commandHash
          || stableJsonStringify(origin.recoveryCommand) !== stableJsonStringify(command)
          || stableJsonStringify(origin.result) !== stableJsonStringify(input.result)) {
          throw new Error(`Item operation ${originId} already has different recovery evidence.`)
        }
        return origin
      }
      if (origin.status !== 'pending') throw new Error(`Item operation ${originId} is already terminal and cannot be abandoned.`)
      const changed = database.connection.prepare(`
        UPDATE item_operations
        SET status = 'abandoned', result_json = ?, recovery_command_sha256 = ?,
          recovery_command_json = ?, updated_at = ?
        WHERE operation_id = ? AND status = 'pending'
      `).run(stringifyStoredDocument(input.result), commandHash, stringifyStoredDocument(command), updatedAt, originId)
      if (Number(changed.changes) !== 1) throw new Error(`Item operation ${originId} could not abandon atomically.`)
      return selectById(database, originId)
        ?? (() => { throw new Error(`Item operation ${originId} was not readable after abandonment.`) })()
    }

    if (command.action !== 'correct') throw new Error(`Item operation ${originId} correction command is invalid.`)
    const correctionId = operationId(input.correctionOfOperationId, 'item correction operation ID')
    if (command.correctionOperationId !== correctionId || input.result.operationId !== correctionId
      || input.result.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) {
      throw new Error(`Item operation ${originId} correction identity is invalid.`)
    }
    const priorCorrection = selectCorrectionOf(database, originId)
    if (priorCorrection) {
      if (priorCorrection.operationId !== correctionId
        || priorCorrection.recoveryCommandSha256 !== commandHash
        || stableJsonStringify(priorCorrection.recoveryCommand) !== stableJsonStringify(command)
        || stableJsonStringify(priorCorrection.result) !== stableJsonStringify(input.result)) {
        throw new Error(`Item operation ${originId} already has different recovery evidence.`)
      }
      return priorCorrection
    }
    if (origin.status !== 'accepted' || origin.result?.status !== 'accepted' || !origin.plan
      || !origin.canonicalItemId || !origin.canonicalDefinitionSha256) {
      throw new Error(`Item operation ${originId} is not an accepted operation that can be corrected.`)
    }
    if (selectById(database, correctionId)) throw new Error(`Item correction operation ${correctionId} is already used.`)
    const correctionReadSet = origin.result.aggregateRefs
    const actorKey = `sheet:${origin.command.actorSheet.kind}:${origin.command.actorSheet.slug}`
    const sourceKey = origin.command.source.kind === 'trainer'
      ? `sheet:trainer:${origin.command.source.slug}`
      : `group-inventory:${origin.command.source.slug}`
    const refKey = (ref: ItemAggregateRef): string => ref.kind === 'sheet'
      ? `sheet:${ref.sheetKind}:${ref.id}` : `${ref.kind}:${ref.id}`
    const actorRevision = correctionReadSet.find(ref => refKey(ref) === actorKey)?.revision
    const sourceRevision = correctionReadSet.find(ref => refKey(ref) === sourceKey)?.revision
    if (actorRevision === undefined || sourceRevision === undefined) {
      throw new Error(`Item operation ${originId} correction read authority is incomplete.`)
    }
    const correctionCommand = parseUseItemCommand({
      ...origin.command,
      operationId: correctionId,
      actorSheet: { ...origin.command.actorSheet, expectedRevision: actorRevision },
      source: { ...origin.command.source, expectedRevision: sourceRevision },
      readSet: correctionReadSet,
    })
    const correctionPlan = parseItemOperationPlan({
      schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
      operationId: correctionId,
      canonicalItemId: origin.canonicalItemId,
      canonicalDefinitionSha256: origin.canonicalDefinitionSha256,
      readSet: correctionReadSet,
      operations: [],
      receiptFacts: [],
    })
    const correctionUseHash = itemOperationCommandSha256(correctionCommand)
    database.connection.prepare(`
      INSERT INTO item_operations (
        operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json,
        status, canonical_item_id, canonical_definition_sha256, plan_json, pending_decision_json,
        result_json, correction_of_operation_id, recovery_command_sha256, recovery_command_json,
        compensation_json, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, 'corrected', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      correctionId,
      correctionUseHash,
      stringifyStoredDocument(correctionCommand),
      origin.canonicalItemId,
      origin.canonicalDefinitionSha256,
      stringifyStoredDocument(correctionPlan),
      stringifyStoredDocument(input.result),
      originId,
      commandHash,
      stringifyStoredDocument(command),
      updatedAt,
      updatedAt,
    )
    const insertScope = database.connection.prepare(`
      INSERT INTO item_operation_scopes (
        operation_id, scope_kind, scope_key, expected_revision, scope_json
      ) VALUES (?, ?, ?, ?, ?)
    `)
    for (const scope of correctionReadSet) {
      insertScope.run(correctionId, scope.kind, scopeKeyFor(scope), scope.revision, stringifyStoredDocument(scope))
    }
    return selectById(database, correctionId)
      ?? (() => { throw new Error(`Item correction ${correctionId} was not readable after insert.`) })()
  })

  const listPending = (): readonly StoredItemOperationRecord[] => {
    const rows = database.connection.prepare(`
      SELECT operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json,
        status, canonical_item_id, canonical_definition_sha256, plan_json, pending_decision_json, result_json, correction_of_operation_id,
        recovery_command_sha256, recovery_command_json, compensation_json, created_at, updated_at
      FROM item_operations
      WHERE status = 'pending'
      ORDER BY created_at, operation_id
    `).all() as unknown as ItemOperationRow[]
    return Object.freeze(rows.map(row => rowToRecord(database, row)))
  }

  const validateMapSlug = (mapSlug: string): void => {
    if (typeof mapSlug !== 'string' || !mapSlug.trim() || mapSlug !== mapSlug.trim() || mapSlug.length > 200) {
      throw new Error('Item operation map slug must be bounded non-empty text.')
    }
  }

  const hasPendingForMap = (mapSlug: string): boolean => {
    validateMapSlug(mapSlug)
    const row = database.connection.prepare(`
      SELECT 1 AS present
      FROM item_operations AS operation
      WHERE operation.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM item_operation_scopes AS scope
          WHERE scope.operation_id = operation.operation_id
            AND scope.scope_kind IN ('map', 'encounter')
            AND scope.scope_key = ?
        )
      LIMIT 1
    `).get(mapSlug) as { readonly present?: unknown } | undefined
    return row?.present === 1
  }

  const listForMap = (mapSlug: string, limit = 200): readonly StoredItemOperationRecord[] => {
    validateMapSlug(mapSlug)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Item operation map query limit must be from 1 through 500.')
    const rows = database.connection.prepare(`
      SELECT operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json,
        status, canonical_item_id, canonical_definition_sha256, plan_json, pending_decision_json, result_json, correction_of_operation_id,
        recovery_command_sha256, recovery_command_json, compensation_json, created_at, updated_at
      FROM item_operations AS operation
      WHERE EXISTS (
        SELECT 1 FROM item_operation_scopes AS scope
        WHERE scope.operation_id = operation.operation_id
          AND scope.scope_kind IN ('map', 'encounter')
          AND scope.scope_key = ?
      )
      ORDER BY operation.updated_at DESC, operation.operation_id DESC
      LIMIT ?
    `).all(mapSlug, limit) as unknown as ItemOperationRow[]
    return Object.freeze(rows.map(row => rowToRecord(database, row)).reverse())
  }

  const reservedQuantity = (sourceInstanceId: string, excludingOperationId?: string): number => listPending()
    .filter(record => record.operationId !== excludingOperationId
      && record.command.sourceInstanceId === sourceInstanceId
      && record.plan !== null)
    .flatMap(record => record.plan!.operations)
    .filter(operation => operation.kind === 'inventory'
      && operation.payload.action === 'consume'
      && operation.payload.sourceInstanceId === sourceInstanceId)
    .reduce((total, operation) => {
      const quantity = operation.payload.quantity
      return total + (Number.isSafeInteger(quantity) && Number(quantity) > 0 ? Number(quantity) : 0)
    }, 0)

  return {
    get: id => selectById(database, id),
    findCorrectionOf: id => selectCorrectionOf(database, id),
    listPending,
    hasPendingForMap,
    listForMap,
    reservedQuantity,
    createPending,
    replacePendingCommand,
    complete,
    recover,
  }
}
