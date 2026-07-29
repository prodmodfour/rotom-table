import {
  parseExecuteCapabilityActionCommand,
  type ExecuteCapabilityActionCommand,
} from '#shared/capabilityAutomation/clientCommands'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

export type StoredCapabilityAdjudicationStatus = 'pending' | 'accepted' | 'rejected' | 'expired'

export interface StoredCapabilityAdjudication {
  readonly requestId: string
  readonly commandSha256: string
  readonly command: ExecuteCapabilityActionCommand
  readonly definitionHash: string
  readonly status: StoredCapabilityAdjudicationStatus
  readonly requestedAt: number
  readonly expiresAt: number
  readonly resolvedAt: number | null
  readonly resolutionOperationId: string | null
  readonly resolutionCommandSha256: string | null
  /** Retained for terminal replay stability; null only on pending or legacy resolved rows. */
  readonly resolutionMapRevision: number | null
}

export interface CapabilityAdjudicationRepository {
  readonly find: (requestId: string) => StoredCapabilityAdjudication | null
  readonly insert: (entry: StoredCapabilityAdjudication) => StoredCapabilityAdjudication
  readonly resolve: (input: {
    readonly requestId: string
    readonly expectedStatus: 'pending'
    readonly status: 'accepted' | 'rejected' | 'expired'
    readonly resolvedAt: number
    readonly resolutionOperationId: string
    readonly resolutionCommandSha256: string
    readonly resolutionMapRevision: number
  }) => 'applied' | 'stale'
}

interface Row {
  request_id: unknown
  command_sha256: unknown
  command_json: unknown
  definition_hash: unknown
  status: unknown
  requested_at: unknown
  expires_at: unknown
  resolved_at: unknown
  resolution_operation_id: unknown
  resolution_command_sha256: unknown
  resolution_map_revision: unknown
}

const SHA = /^[0-9a-f]{64}$/
const parseRow = (row: Row | undefined): StoredCapabilityAdjudication | null => {
  if (!row) return null
  if (typeof row.request_id !== 'string' || typeof row.command_sha256 !== 'string' || !SHA.test(row.command_sha256)
    || typeof row.command_json !== 'string' || typeof row.definition_hash !== 'string' || !SHA.test(row.definition_hash)
    || !['pending', 'accepted', 'rejected', 'expired'].includes(String(row.status))
    || !Number.isSafeInteger(row.requested_at) || !Number.isSafeInteger(row.expires_at)
    || (row.resolved_at !== null && !Number.isSafeInteger(row.resolved_at))
    || (row.resolution_operation_id !== null && typeof row.resolution_operation_id !== 'string')
    || (row.resolution_command_sha256 !== null
      && (typeof row.resolution_command_sha256 !== 'string' || !SHA.test(row.resolution_command_sha256)))
    || (row.resolution_map_revision !== null
      && (!Number.isSafeInteger(row.resolution_map_revision) || Number(row.resolution_map_revision) < 0))) {
    throw new Error('Stored Capability adjudication is malformed.')
  }
  if ((row.status === 'pending') !== (row.resolved_at === null
    && row.resolution_operation_id === null && row.resolution_command_sha256 === null)) {
    throw new Error('Stored Capability adjudication resolution identity is inconsistent.')
  }
  if (row.status === 'pending' && row.resolution_map_revision !== null) {
    throw new Error('Pending Capability adjudication cannot retain a terminal map revision.')
  }
  const command = parseExecuteCapabilityActionCommand(JSON.parse(row.command_json))
  if (stableJsonStringify(command) !== row.command_json || command.operationId !== row.request_id) {
    throw new Error('Stored Capability adjudication command identity is malformed.')
  }
  return Object.freeze({
    requestId: row.request_id,
    commandSha256: row.command_sha256,
    command,
    definitionHash: row.definition_hash,
    status: row.status as StoredCapabilityAdjudicationStatus,
    requestedAt: Number(row.requested_at),
    expiresAt: Number(row.expires_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    resolutionOperationId: row.resolution_operation_id as string | null,
    resolutionCommandSha256: row.resolution_command_sha256 as string | null,
    resolutionMapRevision: row.resolution_map_revision === null ? null : Number(row.resolution_map_revision),
  })
}

export const createSqliteCapabilityAdjudicationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): CapabilityAdjudicationRepository => {
  const find = (requestId: string): StoredCapabilityAdjudication | null => parseRow(
    database.connection.prepare(`
      SELECT request_id, command_sha256, command_json, definition_hash, status,
             requested_at, expires_at, resolved_at, resolution_operation_id,
             resolution_command_sha256, resolution_map_revision
      FROM capability_adjudications WHERE request_id = ?
    `).get(requestId) as unknown as Row | undefined,
  )
  const insert: CapabilityAdjudicationRepository['insert'] = entry => database.withTransaction(() => {
    const command = parseExecuteCapabilityActionCommand(entry.command)
    if (entry.requestId !== command.operationId || !SHA.test(entry.commandSha256) || !SHA.test(entry.definitionHash)
      || entry.status !== 'pending' || entry.resolvedAt !== null || entry.resolutionOperationId !== null
      || entry.resolutionCommandSha256 !== null || entry.resolutionMapRevision !== null
      || entry.expiresAt <= entry.requestedAt) throw new Error('Capability adjudication insert is invalid.')
    database.connection.prepare(`
      INSERT INTO capability_adjudications (
        request_id, command_sha256, map_slug, actor_placement_id, canonical_id,
        action_id, command_json, definition_hash, status, requested_at,
        expires_at, resolved_at, resolution_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      entry.requestId, entry.commandSha256, command.mapSlug, command.actorPlacementId,
      command.canonicalId, command.actionId, stableJsonStringify(command),
      entry.definitionHash, entry.status, entry.requestedAt, entry.expiresAt,
    )
    return find(entry.requestId) ?? (() => { throw new Error('Capability adjudication was not readable after insert.') })()
  })
  const resolve: CapabilityAdjudicationRepository['resolve'] = input => {
    const result = database.connection.prepare(`
      UPDATE capability_adjudications
      SET status = ?, resolved_at = ?, resolution_operation_id = ?,
          resolution_command_sha256 = ?, resolution_map_revision = ?
      WHERE request_id = ? AND status = ?
    `).run(
      input.status,
      input.resolvedAt,
      input.resolutionOperationId,
      input.resolutionCommandSha256,
      input.resolutionMapRevision,
      input.requestId,
      input.expectedStatus,
    )
    return Number(result.changes) === 1 ? 'applied' : 'stale'
  }
  return { find, insert, resolve }
}
