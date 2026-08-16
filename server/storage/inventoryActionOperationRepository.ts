import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson } from '#shared/automation/strictJson'
import {
  parseInventoryActionDeclaration,
  parseInventoryActionExecutionResult,
  type InventoryActionDeclarationV1,
  type InventoryActionExecutionResultV1,
} from '#shared/itemAutomation/inventoryActions'
import {
  parseEquipmentOperationCommand,
  type EquipmentOperationCommandV1,
} from '#shared/itemAutomation/equipmentOperations'
import { normalizeGroupInventoryDocument, type GroupInventoryDocument } from '~/types/groupInventory'
import {
  parseInventoryActionStackOperationCommand,
  type InventoryActionStackOperationCommandV1,
} from '../domain/itemAutomation/inventoryStackOperations'
import type { PersistedSheet } from './sheetRepository'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface InventoryActionEquipmentCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'equipment-operation'
  readonly canonicalItemId: string
  readonly equipmentDefinitionSha256: string
  readonly configurationDefinitionSha256: string | null
  readonly command: EquipmentOperationCommandV1
}

export interface InventoryActionTransferToGroupCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'transfer-to-group'
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly groupSlug: string
  readonly groupRevision: number
  readonly section: string
  readonly trainerItemId: string
  /** Presentation-only original display label retained for user-facing history. */
  readonly itemLabel?: string
  readonly quantity: number
}

export interface InventoryActionTransferToTrainerCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'transfer-to-trainer'
  readonly groupSlug: string
  readonly groupRevision: number
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly section: string
  readonly itemId: string
  /** Presentation-only original display label retained for user-facing history. */
  readonly itemLabel?: string
  readonly quantity: number
}

export type InventoryActionDownstreamCommandV1 =
  | InventoryActionEquipmentCommandV1
  | InventoryActionTransferToGroupCommandV1
  | InventoryActionTransferToTrainerCommandV1
  | InventoryActionStackOperationCommandV1

export interface InventoryActionAcceptedResourcesV1 {
  readonly result: InventoryActionExecutionResultV1
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventories: readonly GroupInventoryDocument[]
}

export interface StoredInventoryActionOperation {
  readonly declarationSha256: string
  readonly principalKey: string
  readonly trainerSlug: string
  readonly declaration: InventoryActionDeclarationV1
  readonly downstreamCommand: InventoryActionDownstreamCommandV1
  readonly status: 'pending' | 'accepted'
  readonly accepted: InventoryActionAcceptedResourcesV1 | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface InventoryActionOperationRepository {
  readonly database?: RotomDatabase
  readonly find: (operationId: string) => StoredInventoryActionOperation | null
  readonly insertPending: (input: {
    readonly declarationSha256: string
    readonly principalKey: string
    readonly trainerSlug: string
    readonly declaration: InventoryActionDeclarationV1
    readonly downstreamCommand: InventoryActionDownstreamCommandV1
    readonly createdAt: number
  }) => StoredInventoryActionOperation
  readonly accept: (operationId: string, accepted: InventoryActionAcceptedResourcesV1, updatedAt: number) => StoredInventoryActionOperation
  readonly removePending: (operationId: string) => void
}

interface Row {
  readonly action_kind: unknown
  readonly status: unknown
  readonly principal_key: unknown
  readonly trainer_slug: unknown
  readonly declaration_sha256: unknown
  readonly declaration_json: unknown
  readonly downstream_command_json: unknown
  readonly result_json: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

const SHA256 = /^[a-f0-9]{64}$/u
const cloneJson = <T>(value: T, label: string): T => deepFreezeStrictJson(cloneStrictJson(value, label, {
  limits: { depth: 24, nodes: 100_000, objectFields: 512, arrayEntries: 4_096, stringLength: 65_536, objectKeyLength: 200 },
  rootLabel: label,
  valueLabel: `${label} values`,
  failNotJson: (_path, detail) => { throw new Error(detail) },
  failLimit: (_path, detail) => { throw new Error(detail) },
})) as T
const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a safe non-negative integer.`)
  return Number(value)
}
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`)
  return value
}

const parseEquipmentCommand = (value: unknown): InventoryActionEquipmentCommandV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventory equipment downstream command must be an object.')
  const row = value as Record<string, unknown>
  const fields = [
    'schemaVersion', 'kind', 'canonicalItemId', 'equipmentDefinitionSha256',
    'configurationDefinitionSha256', 'command',
  ]
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
    || row.schemaVersion !== 1 || row.kind !== 'equipment-operation'
    || typeof row.canonicalItemId !== 'string' || !row.canonicalItemId.trim()
    || typeof row.equipmentDefinitionSha256 !== 'string' || !SHA256.test(row.equipmentDefinitionSha256)
    || (row.configurationDefinitionSha256 !== null
      && (typeof row.configurationDefinitionSha256 !== 'string' || !SHA256.test(row.configurationDefinitionSha256)))) {
    throw new Error('Inventory equipment downstream command is invalid.')
  }
  const command = parseEquipmentOperationCommand(row.command)
  if (command.commandKind !== 'equip' && command.commandKind !== 'give') {
    throw new Error('Inventory equipment downstream command has an unsupported custody action.')
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'equipment-operation',
    canonicalItemId: row.canonicalItemId,
    equipmentDefinitionSha256: row.equipmentDefinitionSha256,
    configurationDefinitionSha256: row.configurationDefinitionSha256 as string | null,
    command,
  })
}

const parseTransferCommand = (
  value: unknown,
): InventoryActionTransferToGroupCommandV1 | InventoryActionTransferToTrainerCommandV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventory transfer downstream command must be an object.')
  const row = value as Record<string, unknown>
  const toGroup = row.kind === 'transfer-to-group'
  const toTrainer = row.kind === 'transfer-to-trainer'
  const sourceIdentityField = toGroup ? 'trainerItemId' : 'itemId'
  const hasItemLabel = Object.hasOwn(row, 'itemLabel')
  const fields = [
    'schemaVersion', 'kind', 'trainerSlug', 'trainerRevision', 'groupSlug',
    'groupRevision', 'section', sourceIdentityField, ...(hasItemLabel ? ['itemLabel'] : []), 'quantity',
  ]
  if ((!toGroup && !toTrainer)
    || Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
    || row.schemaVersion !== 1
    || typeof row.trainerSlug !== 'string' || !row.trainerSlug
    || typeof row.groupSlug !== 'string' || !row.groupSlug
    || typeof row.section !== 'string' || !row.section
    || typeof row[sourceIdentityField] !== 'string' || !row[sourceIdentityField]
    || (hasItemLabel && (typeof row.itemLabel !== 'string' || !row.itemLabel.trim()
      || row.itemLabel !== row.itemLabel.trim() || row.itemLabel.length > 500
      || /[\u0000-\u001f\u007f]/u.test(row.itemLabel)))
    || !Number.isSafeInteger(row.trainerRevision) || Number(row.trainerRevision) < 0
    || !Number.isSafeInteger(row.groupRevision) || Number(row.groupRevision) < 0
    || !Number.isSafeInteger(row.quantity) || Number(row.quantity) < 1) {
    throw new Error('Inventory transfer downstream command is invalid.')
  }
  const common = {
    schemaVersion: 1 as const,
    trainerSlug: row.trainerSlug,
    trainerRevision: Number(row.trainerRevision),
    groupSlug: row.groupSlug,
    groupRevision: Number(row.groupRevision),
    section: row.section,
    ...(hasItemLabel ? { itemLabel: row.itemLabel as string } : {}),
    quantity: Number(row.quantity),
  }
  return toGroup
    ? Object.freeze({ ...common, kind: 'transfer-to-group' as const, trainerItemId: row.trainerItemId as string })
    : Object.freeze({ ...common, kind: 'transfer-to-trainer' as const, itemId: row.itemId as string })
}

const parseDownstreamCommand = (value: unknown): InventoryActionDownstreamCommandV1 => {
  const kind = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).kind
    : null
  if (kind === 'equipment-operation') return parseEquipmentCommand(value)
  if (kind === 'transfer-to-group' || kind === 'transfer-to-trainer') return parseTransferCommand(value)
  if (kind === 'inventory-stack-operation') return parseInventoryActionStackOperationCommand(value)
  throw new Error('Inventory action downstream command has an unsupported handoff.')
}

const parseAccepted = (value: unknown): InventoryActionAcceptedResourcesV1 => {
  const row = cloneJson(value, 'inventoryActionAcceptedResources') as unknown
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Stored inventory action result must be an object.')
  const input = row as Record<string, unknown>
  if (Object.keys(input).length !== 3 || !Object.hasOwn(input, 'result')
    || !Array.isArray(input.sheets) || !Array.isArray(input.groupInventories)) {
    throw new Error('Stored inventory action result has an invalid shape.')
  }
  const result = parseInventoryActionExecutionResult(input.result)
  const sheets = input.sheets.map((value, index): PersistedSheet => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Stored inventory action sheet ${index + 1} is invalid.`)
    const sheet = value as Record<string, unknown>
    if (Object.keys(sheet).some(key => !['kind', 'slug', 'revision', 'updatedAt', 'sheet'].includes(key))
      || (sheet.kind !== 'trainer' && sheet.kind !== 'pokemon')
      || typeof sheet.slug !== 'string' || !sheet.slug
      || !sheet.sheet || typeof sheet.sheet !== 'object' || Array.isArray(sheet.sheet)) {
      throw new Error(`Stored inventory action sheet ${index + 1} has invalid authority.`)
    }
    return Object.freeze({
      kind: sheet.kind,
      slug: sheet.slug,
      revision: integer(sheet.revision, `Stored inventory action sheet ${index + 1} revision`),
      updatedAt: integer(sheet.updatedAt, `Stored inventory action sheet ${index + 1} updatedAt`),
      sheet: cloneJson(sheet.sheet, `inventoryActionSheet${index + 1}`) as Record<string, unknown>,
    })
  })
  const groupInventories = input.groupInventories.map(document => normalizeGroupInventoryDocument(document))
  return Object.freeze({ result, sheets: Object.freeze(sheets), groupInventories: Object.freeze(groupInventories) })
}

const parseRow = (operationId: string, row: Row | undefined): StoredInventoryActionOperation | null => {
  if (!row) return null
  const status = row.status
  if ((status !== 'pending' && status !== 'accepted')
    || typeof row.declaration_json !== 'string'
    || (row.downstream_command_json !== null && typeof row.downstream_command_json !== 'string')
    || (row.result_json !== null && typeof row.result_json !== 'string')) {
    throw new Error(`Stored inventory action ${operationId} is malformed.`)
  }
  const declaration = parseInventoryActionDeclaration(JSON.parse(row.declaration_json))
  if (row.downstream_command_json === null) throw new Error(`Stored inventory action ${operationId} has no downstream command.`)
  const downstreamCommand = parseDownstreamCommand(JSON.parse(row.downstream_command_json))
  const accepted = row.result_json === null ? null : parseAccepted(JSON.parse(row.result_json))
  const declarationSha256 = text(row.declaration_sha256, 'Stored inventory action declaration hash')
  const principalKey = text(row.principal_key, 'Stored inventory action principal')
  const trainerSlug = text(row.trainer_slug, 'Stored inventory action Trainer slug')
  const createdAt = integer(row.created_at, 'Stored inventory action createdAt')
  const updatedAt = integer(row.updated_at, 'Stored inventory action updatedAt')
  if (!SHA256.test(declarationSha256)
    || declaration.operationId !== operationId
    || declaration.action !== row.action_kind
    || (status === 'accepted') !== (accepted !== null)
    || (accepted !== null && (accepted.result.operationId !== operationId
      || accepted.result.action !== declaration.action))
    || row.declaration_json !== stableJsonStringify(declaration)
    || row.downstream_command_json !== stableJsonStringify(downstreamCommand)
    || (accepted && row.result_json !== stableJsonStringify(accepted))) {
    throw new Error(`Stored inventory action ${operationId} indexes or canonical JSON disagree.`)
  }
  return Object.freeze({
    declarationSha256,
    principalKey,
    trainerSlug,
    declaration,
    downstreamCommand,
    status,
    accepted,
    createdAt,
    updatedAt,
  })
}

export const inventoryActionDeclarationSha256 = (declaration: InventoryActionDeclarationV1): string => createHash('sha256')
  .update(stableJsonStringify(parseInventoryActionDeclaration(declaration)))
  .digest('hex')

export const createSqliteInventoryActionOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): InventoryActionOperationRepository => {
  const find = (operationId: string): StoredInventoryActionOperation | null => parseRow(
    operationId,
    database.connection.prepare(`
      SELECT action_kind, status, principal_key, trainer_slug, declaration_sha256,
             declaration_json, downstream_command_json, result_json, created_at, updated_at
      FROM inventory_action_operations
      WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined,
  )
  const insertPending: InventoryActionOperationRepository['insertPending'] = input => database.withTransaction(() => {
    const declaration = parseInventoryActionDeclaration(input.declaration)
    const downstream = parseDownstreamCommand(input.downstreamCommand)
    if (!SHA256.test(input.declarationSha256)
      || input.declarationSha256 !== inventoryActionDeclarationSha256(declaration)
      || !input.principalKey.trim() || input.principalKey.length > 160
      || !input.trainerSlug.trim() || input.trainerSlug.length > 200
      || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
      throw new Error('Pending inventory action operation authority is invalid.')
    }
    database.connection.prepare(`
      INSERT INTO inventory_action_operations (
        operation_id, action_kind, status, principal_key, trainer_slug,
        declaration_sha256, declaration_json, downstream_command_json,
        result_json, created_at, updated_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      declaration.operationId,
      declaration.action,
      input.principalKey,
      input.trainerSlug,
      input.declarationSha256,
      stableJsonStringify(declaration),
      stableJsonStringify(downstream),
      input.createdAt,
      input.createdAt,
    )
    const stored = find(declaration.operationId)
    if (!stored) throw new Error('Pending inventory action operation was not readable after insert.')
    return stored
  })
  const accept: InventoryActionOperationRepository['accept'] = (operationId, acceptedValue, updatedAt) => database.withTransaction(() => {
    const accepted = parseAccepted(acceptedValue)
    if (accepted.result.operationId !== operationId || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      throw new Error('Accepted inventory action operation authority is invalid.')
    }
    const result = database.connection.prepare(`
      UPDATE inventory_action_operations
      SET status = 'accepted', result_json = ?, updated_at = ?
      WHERE operation_id = ? AND status = 'pending' AND result_json IS NULL
    `).run(stableJsonStringify(accepted), updatedAt, operationId)
    if (result.changes !== 1) throw new Error('Pending inventory action operation was unavailable for acceptance.')
    const stored = find(operationId)
    if (!stored) throw new Error('Accepted inventory action operation was not readable after update.')
    return stored
  })
  const removePending = (operationId: string): void => {
    database.withTransaction(() => {
      database.connection.prepare(`
        DELETE FROM inventory_action_operations
        WHERE operation_id = ? AND status = 'pending' AND result_json IS NULL
      `).run(operationId)
    })
  }
  return { database, find, insertPending, accept, removePending }
}
