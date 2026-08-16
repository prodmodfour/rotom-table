import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseItemExtendedActionCommand,
  parseItemExtendedActionResult,
  type CompleteItemExtendedActionCommandV1,
  type InterruptItemExtendedActionCommandV1,
  type ItemExtendedActionResultV1,
  type StartItemExtendedActionCommandV1,
} from '#shared/itemAutomation/extendedActions'
import { parseItemNonEncounterExecutionSnapshot, type ItemNonEncounterExecutionSnapshotV1 } from '#shared/itemAutomation/nonEncounter'
import { parseUseItemCommand, type UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  parseStoredDocumentJson,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export const ITEM_EXTENDED_ACTION_STORE_SCHEMA_VERSION = 1 as const
export type StoredItemExtendedActionStatus = 'in-progress' | 'completed' | 'interrupted'
export type ItemExtendedActionTerminalCommandV1 =
  | CompleteItemExtendedActionCommandV1
  | InterruptItemExtendedActionCommandV1

export interface StoredItemExtendedActionRecord {
  readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_STORE_SCHEMA_VERSION
  readonly activityId: string
  readonly revision: number
  readonly status: StoredItemExtendedActionStatus
  readonly startCommand: StartItemExtendedActionCommandV1
  readonly initialItemCommand: UseItemCommandV1
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly sourceDisplayLabel: string
  readonly actorDisplayLabel: string
  readonly targetSnapshots: readonly {
    readonly sheetKind: 'pokemon' | 'trainer'
    readonly sheetSlug: string
    readonly displayLabel: string
  }[]
  readonly startedContext: ItemNonEncounterExecutionSnapshotV1
  readonly terminalCommand: ItemExtendedActionTerminalCommandV1 | null
  readonly result: ItemExtendedActionResultV1 | null
  readonly startedAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface CreateItemExtendedActionInput {
  readonly startCommand: StartItemExtendedActionCommandV1
  readonly initialItemCommand: UseItemCommandV1
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly sourceDisplayLabel: string
  readonly actorDisplayLabel: string
  readonly targetSnapshots: readonly {
    readonly sheetKind: 'pokemon' | 'trainer'
    readonly sheetSlug: string
    readonly displayLabel: string
  }[]
  readonly startedContext: ItemNonEncounterExecutionSnapshotV1
  readonly createdAt: number
}

export type SettleItemExtendedActionResult =
  | { readonly kind: 'applied', readonly record: StoredItemExtendedActionRecord }
  | { readonly kind: 'stale', readonly record: StoredItemExtendedActionRecord }
  | { readonly kind: 'exact-replay', readonly record: StoredItemExtendedActionRecord }

export interface ItemExtendedActionRepository {
  readonly database: RotomDatabase
  get(activityId: string): StoredItemExtendedActionRecord | null
  getByOperation(operationId: string): StoredItemExtendedActionRecord | null
  listForTrainer(trainerSlug: string, limit?: number): readonly StoredItemExtendedActionRecord[]
  findInProgressForTrainer(trainerSlug: string): StoredItemExtendedActionRecord | null
  findInProgressForSource(sourceInstanceId: string): StoredItemExtendedActionRecord | null
  create(input: CreateItemExtendedActionInput): StoredItemExtendedActionRecord
  settle(input: {
    readonly activityId: string
    readonly expectedRevision: number
    readonly command: ItemExtendedActionTerminalCommandV1
    readonly result: ItemExtendedActionResultV1
    readonly status: 'completed' | 'interrupted'
    readonly updatedAtCampaignMinute: number
    readonly updatedAt: number
  }): SettleItemExtendedActionResult
}

interface ActivityRow {
  readonly activity_id: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly start_operation_id: unknown
  readonly settlement_operation_id: unknown
  readonly actor_sheet_slug: unknown
  readonly source_instance_id: unknown
  readonly start_command_sha256: unknown
  readonly start_command_json: unknown
  readonly terminal_operation_id: unknown
  readonly terminal_command_sha256: unknown
  readonly terminal_command_json: unknown
  readonly result_json: unknown
  readonly record_json: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

type StoredRecordJson = Omit<
  StoredItemExtendedActionRecord,
  'startCommand' | 'terminalCommand' | 'result' | 'createdAt' | 'updatedAt'
>

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STATUS_SET = new Set<StoredItemExtendedActionStatus>(['in-progress', 'completed', 'interrupted'])
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
export const itemExtendedActionCommandSha256 = (
  command: StartItemExtendedActionCommandV1 | ItemExtendedActionTerminalCommandV1,
): string => sha256(stableJsonStringify(command))

const digest = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be a SHA-256 digest.`)
  return value
}
const nonnegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a safe non-negative integer.`)
  return Number(value)
}
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`)
  return value
}
const status = (value: unknown): StoredItemExtendedActionStatus => {
  if (typeof value !== 'string' || !STATUS_SET.has(value as StoredItemExtendedActionStatus)) {
    throw new Error('item_extended_action_activities.status is invalid.')
  }
  return value as StoredItemExtendedActionStatus
}

const recordJson = (record: StoredItemExtendedActionRecord): StoredRecordJson => ({
  schemaVersion: record.schemaVersion,
  activityId: record.activityId,
  revision: record.revision,
  status: record.status,
  initialItemCommand: record.initialItemCommand,
  canonicalItemId: record.canonicalItemId,
  canonicalDefinitionSha256: record.canonicalDefinitionSha256,
  sourceDisplayLabel: record.sourceDisplayLabel,
  actorDisplayLabel: record.actorDisplayLabel,
  targetSnapshots: record.targetSnapshots,
  startedContext: record.startedContext,
  startedAtCampaignMinute: record.startedAtCampaignMinute,
  updatedAtCampaignMinute: record.updatedAtCampaignMinute,
})

const parseRecordJson = (value: unknown, label: string): StoredRecordJson => {
  if (typeof value !== 'string') throw new Error(`${label} must be JSON text.`)
  const parsed = parseStoredDocumentJson<unknown>(value, label)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be an object.`)
  const row = parsed as Record<string, unknown>
  const fields = [
    'schemaVersion', 'activityId', 'revision', 'status', 'initialItemCommand', 'canonicalItemId',
    'canonicalDefinitionSha256', 'sourceDisplayLabel', 'actorDisplayLabel', 'targetSnapshots',
    'startedContext', 'startedAtCampaignMinute', 'updatedAtCampaignMinute',
  ]
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) {
    throw new Error(`${label} has an invalid shape.`)
  }
  if (row.schemaVersion !== ITEM_EXTENDED_ACTION_STORE_SCHEMA_VERSION) throw new Error(`${label} schema version is unsupported.`)
  const initialItemCommand = parseUseItemCommand(row.initialItemCommand)
  const startedContext = parseItemNonEncounterExecutionSnapshot(row.startedContext)
  const startedAtCampaignMinute = nonnegativeInteger(row.startedAtCampaignMinute, `${label}.startedAtCampaignMinute`)
  const updatedAtCampaignMinute = nonnegativeInteger(row.updatedAtCampaignMinute, `${label}.updatedAtCampaignMinute`)
  if (updatedAtCampaignMinute < startedAtCampaignMinute) throw new Error(`${label} campaign time moved backwards.`)
  if (!Array.isArray(row.targetSnapshots) || row.targetSnapshots.length < 1 || row.targetSnapshots.length > 64) {
    throw new Error(`${label}.targetSnapshots must contain bounded target evidence.`)
  }
  const targetSnapshots = row.targetSnapshots.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label}.targetSnapshots[${index}] is invalid.`)
    }
    const target = entry as Record<string, unknown>
    if (Object.keys(target).length !== 3
      || !['sheetKind', 'sheetSlug', 'displayLabel'].every(field => Object.hasOwn(target, field))
      || (target.sheetKind !== 'pokemon' && target.sheetKind !== 'trainer')) {
      throw new Error(`${label}.targetSnapshots[${index}] has an invalid shape.`)
    }
    return Object.freeze({
      sheetKind: target.sheetKind,
      sheetSlug: text(target.sheetSlug, `${label}.targetSnapshots[${index}].sheetSlug`),
      displayLabel: text(target.displayLabel, `${label}.targetSnapshots[${index}].displayLabel`),
    })
  })
  if (new Set(targetSnapshots.map(target => `${target.sheetKind}:${target.sheetSlug}`)).size !== targetSnapshots.length) {
    throw new Error(`${label}.targetSnapshots contains duplicate sheets.`)
  }
  return {
    schemaVersion: ITEM_EXTENDED_ACTION_STORE_SCHEMA_VERSION,
    activityId: text(row.activityId, `${label}.activityId`),
    revision: nonnegativeInteger(row.revision, `${label}.revision`),
    status: status(row.status),
    initialItemCommand,
    canonicalItemId: text(row.canonicalItemId, `${label}.canonicalItemId`),
    canonicalDefinitionSha256: digest(row.canonicalDefinitionSha256, `${label}.canonicalDefinitionSha256`),
    sourceDisplayLabel: text(row.sourceDisplayLabel, `${label}.sourceDisplayLabel`),
    actorDisplayLabel: text(row.actorDisplayLabel, `${label}.actorDisplayLabel`),
    targetSnapshots: Object.freeze(targetSnapshots),
    startedContext,
    startedAtCampaignMinute,
    updatedAtCampaignMinute,
  }
}

const rowToRecord = (row: ActivityRow): StoredItemExtendedActionRecord => {
  const stored = parseRecordJson(row.record_json, `item Extended Action ${String(row.activity_id)} record`)
  const parsedStart = parseItemExtendedActionCommand(
    parseStoredDocumentJson<unknown>(String(row.start_command_json), `item Extended Action ${stored.activityId} start command`),
  )
  if (parsedStart.kind !== 'start') throw new Error(`item Extended Action ${stored.activityId} start command drifted.`)
  const startHash = digest(row.start_command_sha256, `item Extended Action ${stored.activityId} start command hash`)
  if (itemExtendedActionCommandSha256(parsedStart) !== startHash) throw new Error(`item Extended Action ${stored.activityId} start command hash drifted.`)
  const storedStatus = status(row.status)
  const revision = nonnegativeInteger(row.revision, `item Extended Action ${stored.activityId} revision`)
  const createdAt = parseStoredTimestamp(row.created_at, `item Extended Action ${stored.activityId} createdAt`)
  const updatedAt = parseStoredTimestamp(row.updated_at, `item Extended Action ${stored.activityId} updatedAt`)
  if (updatedAt < createdAt) throw new Error(`item Extended Action ${stored.activityId} wall time moved backwards.`)
  let terminalCommand: ItemExtendedActionTerminalCommandV1 | null = null
  let result: ItemExtendedActionResultV1 | null = null
  if (row.terminal_command_json !== null) {
    const parsed = parseItemExtendedActionCommand(parseStoredDocumentJson<unknown>(
      String(row.terminal_command_json),
      `item Extended Action ${stored.activityId} terminal command`,
    ))
    if (parsed.kind === 'start') throw new Error(`item Extended Action ${stored.activityId} terminal command drifted.`)
    terminalCommand = parsed
    const terminalHash = digest(row.terminal_command_sha256, `item Extended Action ${stored.activityId} terminal command hash`)
    if (itemExtendedActionCommandSha256(parsed) !== terminalHash) throw new Error(`item Extended Action ${stored.activityId} terminal command hash drifted.`)
    result = parseItemExtendedActionResult(parseStoredDocumentJson<unknown>(
      String(row.result_json),
      `item Extended Action ${stored.activityId} result`,
    ))
  }
  const terminalExpected = storedStatus !== 'in-progress'
  if (terminalExpected !== Boolean(terminalCommand && result)
    || (terminalCommand && terminalCommand.operationId !== row.terminal_operation_id)
    || (result && (result.operationId !== terminalCommand?.operationId || result.activityId !== stored.activityId))) {
    throw new Error(`item Extended Action ${stored.activityId} terminal evidence drifted.`)
  }
  if (stored.activityId !== row.activity_id || stored.activityId !== parsedStart.activityId
    || stored.revision !== revision || stored.status !== storedStatus
    || parsedStart.operationId !== row.start_operation_id
    || parsedStart.settlementOperationId !== row.settlement_operation_id
    || stored.initialItemCommand.operationId !== parsedStart.settlementOperationId
    || stored.initialItemCommand.actorSheet.slug !== row.actor_sheet_slug
    || stored.initialItemCommand.sourceInstanceId !== row.source_instance_id
    || stored.startedContext.extendedAction.mode !== 'extended'
    || stored.startedContext.extendedAction.phase !== 'declaration'
    || stored.startedContext.campaignTime.campaignMinute !== stored.startedAtCampaignMinute) {
    throw new Error(`item Extended Action ${stored.activityId} authority columns drifted.`)
  }
  if (storedStatus === 'completed' && (terminalCommand?.kind !== 'complete' || result?.status !== 'completed')) {
    throw new Error(`item Extended Action ${stored.activityId} completion evidence drifted.`)
  }
  if (storedStatus === 'interrupted' && (terminalCommand?.kind !== 'interrupt' || result?.status !== 'interrupted')) {
    throw new Error(`item Extended Action ${stored.activityId} interruption evidence drifted.`)
  }
  return Object.freeze({
    ...stored,
    startCommand: parsedStart,
    terminalCommand,
    result,
    createdAt,
    updatedAt,
  })
}

const SELECT = `
  SELECT activity_id, revision, status, start_operation_id, settlement_operation_id,
    actor_sheet_slug, source_instance_id, start_command_sha256, start_command_json,
    terminal_operation_id, terminal_command_sha256, terminal_command_json, result_json,
    record_json, created_at, updated_at
  FROM item_extended_action_activities
`

export const createSqliteItemExtendedActionRepository = (
  database: RotomDatabase = getRotomDatabase(),
): ItemExtendedActionRepository => {
  const get = (activityId: string): StoredItemExtendedActionRecord | null => {
    const row = database.connection.prepare(`${SELECT} WHERE activity_id = ?`).get(activityId) as ActivityRow | undefined
    return row ? rowToRecord(row) : null
  }
  const getByOperation = (operationId: string): StoredItemExtendedActionRecord | null => {
    const rows = database.connection.prepare(`${SELECT}
      WHERE start_operation_id = ? OR terminal_operation_id = ?
      ORDER BY activity_id LIMIT 2
    `).all(operationId, operationId) as unknown as ActivityRow[]
    if (rows.length > 1) throw new Error(`Item Extended Action operation ${operationId} is not unique.`)
    return rows[0] ? rowToRecord(rows[0]) : null
  }
  const listForTrainer = (trainerSlug: string, limit = 50): readonly StoredItemExtendedActionRecord[] => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Item Extended Action list limit is invalid.')
    return Object.freeze((database.connection.prepare(`${SELECT}
      WHERE actor_sheet_slug = ? ORDER BY updated_at DESC, activity_id LIMIT ?
    `).all(trainerSlug, limit) as unknown as ActivityRow[]).map(rowToRecord))
  }
  const findOne = (field: 'actor_sheet_slug' | 'source_instance_id', value: string): StoredItemExtendedActionRecord | null => {
    const rows = database.connection.prepare(`${SELECT}
      WHERE ${field} = ? AND status = 'in-progress' ORDER BY activity_id LIMIT 2
    `).all(value) as unknown as ActivityRow[]
    if (rows.length > 1) throw new Error(`Item Extended Action active ${field} is not unique.`)
    return rows[0] ? rowToRecord(rows[0]) : null
  }
  const create = (input: CreateItemExtendedActionInput): StoredItemExtendedActionRecord => database.withTransaction(() => {
    const startCommand = parseItemExtendedActionCommand(input.startCommand)
    if (startCommand.kind !== 'start') throw new Error('Item Extended Action creation requires a start command.')
    const initialItemCommand = parseUseItemCommand(input.initialItemCommand)
    const startedContext = parseItemNonEncounterExecutionSnapshot(input.startedContext)
    const startChoices = startCommand.choices ?? []
    const startChoiceIds = new Set(startChoices.map(choice => choice.choiceId))
    const targetChoices = initialItemCommand.choices.filter(choice => !startChoiceIds.has(choice.choiceId))
    const storedChoices = initialItemCommand.choices.filter(choice => startChoiceIds.has(choice.choiceId))
    if (startedContext.extendedAction.mode !== 'extended' || startedContext.extendedAction.phase !== 'declaration'
      || initialItemCommand.operationId !== startCommand.settlementOperationId
      || initialItemCommand.actorSheet.kind !== 'trainer'
      || initialItemCommand.actorSheet.slug !== startCommand.trainerSlug
      || initialItemCommand.actorSheet.expectedRevision !== startCommand.trainerRevision
      || initialItemCommand.offerId !== startCommand.offerId
      || stableJsonStringify(initialItemCommand.targetIds) !== stableJsonStringify(startCommand.targetIds)
      || stableJsonStringify(storedChoices) !== stableJsonStringify(startChoices)
      || targetChoices.length !== 1
      || stableJsonStringify(targetChoices[0]!.optionIds) !== stableJsonStringify(startCommand.targetIds)
      || startedContext.context !== initialItemCommand.context
      || startedContext.campaignTime.campaignMinute < 0) {
      throw new Error('Item Extended Action start evidence is inconsistent.')
    }
    const existing = getByOperation(startCommand.operationId) ?? get(startCommand.activityId)
    if (existing) {
      if (itemExtendedActionCommandSha256(existing.startCommand) !== itemExtendedActionCommandSha256(startCommand)
        || stableJsonStringify(existing.startCommand) !== stableJsonStringify(startCommand)) {
        throw new Error('Item Extended Action identity was reused for another start command.')
      }
      return existing
    }
    const targetSnapshots = input.targetSnapshots.map((target, index) => Object.freeze({
      sheetKind: target.sheetKind,
      sheetSlug: text(target.sheetSlug, `target snapshot ${index} slug`),
      displayLabel: text(target.displayLabel, `target snapshot ${index} display label`),
    }))
    if (targetSnapshots.length !== initialItemCommand.targetIds.length
      || stableJsonStringify(targetSnapshots.map(target => sheetItemTargetId(target.sheetKind, target.sheetSlug)))
        !== stableJsonStringify(initialItemCommand.targetIds)
      || new Set(targetSnapshots.map(target => `${target.sheetKind}:${target.sheetSlug}`)).size !== targetSnapshots.length) {
      throw new Error('Item Extended Action target snapshots do not match the declaration.')
    }
    const createdAt = parseStoredTimestamp(input.createdAt, 'item Extended Action createdAt')
    const record: StoredItemExtendedActionRecord = Object.freeze({
      schemaVersion: ITEM_EXTENDED_ACTION_STORE_SCHEMA_VERSION,
      activityId: startCommand.activityId,
      revision: 0,
      status: 'in-progress',
      startCommand,
      initialItemCommand,
      canonicalItemId: text(input.canonicalItemId, 'canonical item ID'),
      canonicalDefinitionSha256: digest(input.canonicalDefinitionSha256, 'canonical definition SHA-256'),
      sourceDisplayLabel: text(input.sourceDisplayLabel, 'source display label'),
      actorDisplayLabel: text(input.actorDisplayLabel, 'actor display label'),
      targetSnapshots: Object.freeze(targetSnapshots),
      startedContext,
      terminalCommand: null,
      result: null,
      startedAtCampaignMinute: startedContext.campaignTime.campaignMinute,
      updatedAtCampaignMinute: startedContext.campaignTime.campaignMinute,
      createdAt,
      updatedAt: createdAt,
    })
    database.connection.prepare(`
      INSERT INTO item_extended_action_activities (
        activity_id, revision, status, start_operation_id, settlement_operation_id,
        actor_sheet_slug, source_instance_id, start_command_sha256, start_command_json,
        terminal_operation_id, terminal_command_sha256, terminal_command_json, result_json,
        record_json, created_at, updated_at
      ) VALUES (?, 0, 'in-progress', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
    `).run(
      record.activityId,
      startCommand.operationId,
      startCommand.settlementOperationId,
      initialItemCommand.actorSheet.slug,
      initialItemCommand.sourceInstanceId,
      itemExtendedActionCommandSha256(startCommand),
      stringifyStoredDocument(startCommand),
      stringifyStoredDocument(recordJson(record)),
      createdAt,
      createdAt,
    )
    return get(record.activityId) ?? (() => { throw new Error('Item Extended Action was not readable after creation.') })()
  })
  const settle: ItemExtendedActionRepository['settle'] = input => database.withTransaction(() => {
    const current = get(input.activityId) ?? (() => { throw new Error('Item Extended Action does not exist.') })()
    const command = parseItemExtendedActionCommand(input.command)
    if (command.kind === 'start' || command.activityId !== current.activityId) throw new Error('Item Extended Action terminal command is invalid.')
    const result = parseItemExtendedActionResult(input.result)
    if (result.activityId !== current.activityId || result.operationId !== command.operationId
      || result.status !== input.status || command.expectedRevision !== input.expectedRevision) {
      throw new Error('Item Extended Action terminal result does not match its command.')
    }
    if (current.status !== 'in-progress') {
      if (current.terminalCommand
        && itemExtendedActionCommandSha256(current.terminalCommand) === itemExtendedActionCommandSha256(command)
        && stableJsonStringify(current.terminalCommand) === stableJsonStringify(command)) {
        return Object.freeze({ kind: 'exact-replay' as const, record: current })
      }
      return Object.freeze({ kind: 'stale' as const, record: current })
    }
    if (current.revision !== input.expectedRevision) return Object.freeze({ kind: 'stale' as const, record: current })
    const updatedAtCampaignMinute = nonnegativeInteger(input.updatedAtCampaignMinute, 'updated campaign minute')
    if (updatedAtCampaignMinute < current.startedAtCampaignMinute) throw new Error('Item Extended Action cannot settle before it started.')
    const updatedAt = parseStoredTimestamp(input.updatedAt, 'item Extended Action updatedAt')
    if (updatedAt < current.createdAt) throw new Error('Item Extended Action wall time cannot move backwards.')
    const next: StoredItemExtendedActionRecord = Object.freeze({
      ...current,
      revision: current.revision + 1,
      status: input.status,
      terminalCommand: command,
      result,
      updatedAtCampaignMinute,
      updatedAt,
    })
    const changed = database.connection.prepare(`
      UPDATE item_extended_action_activities
      SET revision = ?, status = ?, terminal_operation_id = ?, terminal_command_sha256 = ?,
        terminal_command_json = ?, result_json = ?, record_json = ?, updated_at = ?
      WHERE activity_id = ? AND revision = ? AND status = 'in-progress'
    `).run(
      next.revision,
      next.status,
      command.operationId,
      itemExtendedActionCommandSha256(command),
      stringifyStoredDocument(command),
      stringifyStoredDocument(result),
      stringifyStoredDocument(recordJson(next)),
      updatedAt,
      current.activityId,
      current.revision,
    )
    if (Number(changed.changes) !== 1) return Object.freeze({ kind: 'stale' as const, record: get(current.activityId)! })
    return Object.freeze({ kind: 'applied' as const, record: get(current.activityId)! })
  })
  return Object.freeze({
    database,
    get,
    getByOperation,
    listForTrainer,
    findInProgressForTrainer: (trainerSlug: string) => findOne('actor_sheet_slug', trainerSlug),
    findInProgressForSource: (sourceInstanceId: string) => findOne('source_instance_id', sourceInstanceId),
    create,
    settle,
  })
}
