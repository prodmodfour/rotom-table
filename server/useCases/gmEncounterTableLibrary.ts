import { createHash, randomUUID } from 'node:crypto'
import {
  parseEncounterTableDocumentV1,
  parseEncounterTableExportV1,
  projectEncounterTableForLibrary,
  stableEncounterTableExport,
  type EncounterTableDocumentV1,
  type EncounterTableExportV1,
  type EncounterTableGroupSizePolicyV1,
  type EncounterTablePredicatesV1,
  type EncounterTableRowV1,
} from '#shared/gmToolkit/encounterTables'
import {
  createSqliteGmEncounterTableRepository,
  gmEncounterTableCommandSha256,
  type GmEncounterTableCommandKind,
  type GmEncounterTableOperationCommand,
  type GmEncounterTableOperationResult,
  type GmEncounterTableRepository,
} from '../storage/gmEncounterTableRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class GmEncounterTableUseCaseError extends UseCaseHttpError<400 | 404 | 409> {
  readonly code: string

  constructor(statusCode: 400 | 404 | 409, code: string, message: string) {
    super(statusCode, message)
    this.code = code
  }
}

export interface GmEncounterTableDraftRow {
  readonly rowId?: unknown
  readonly kind?: unknown
  readonly speciesId?: unknown
  readonly weight?: unknown
  readonly minLevel?: unknown
  readonly maxLevel?: unknown
  readonly predicates?: unknown
}

export interface GmEncounterTableDraft {
  readonly name?: unknown
  readonly environmentTags?: unknown
  readonly predicates?: unknown
  readonly rows?: unknown
  readonly groupSizePolicy?: unknown
  readonly notes?: unknown
}

export interface MutateGmEncounterTableInput {
  readonly operationId?: unknown
  readonly expectedRevision?: unknown
  readonly tableId?: unknown
  readonly draft?: unknown
  readonly name?: unknown
  readonly export?: unknown
}

export interface GmEncounterTableUseCaseDependencies {
  readonly repository?: GmEncounterTableRepository
  readonly now?: () => string
}

const OPERATION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const TABLE_ID_RE = /^encounter-table:v1:[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GmEncounterTableUseCaseError(400, 'invalid-object', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const exactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) throw new GmEncounterTableUseCaseError(400, 'unknown-field', `${label}.${unknown} is not allowed`)
}

const operationId = (value: unknown): string => {
  if (typeof value !== 'string' || !OPERATION_ID_RE.test(value)) {
    throw new GmEncounterTableUseCaseError(400, 'invalid-operation-id', 'operationId must be a stable bounded ID')
  }
  return value
}

const tableId = (value: unknown): string => {
  if (typeof value !== 'string' || !TABLE_ID_RE.test(value)) {
    throw new GmEncounterTableUseCaseError(400, 'invalid-table-id', 'tableId must be a versioned encounter-table ID')
  }
  return value
}

const revision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new GmEncounterTableUseCaseError(400, 'invalid-revision', 'expectedRevision must be a non-negative safe integer')
  }
  return Number(value)
}

const normalizedInstant = (value: string): string => {
  if (!Number.isFinite(Date.parse(value))) throw new Error('GM encounter table clock returned an invalid instant')
  return new Date(value).toISOString()
}

const derivedSlug = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
const derivedTableId = (operation: string): string => `encounter-table:v1:${derivedSlug(operation)}`
const derivedRowId = (operation: string, index: number): string => `encounter-row:v1:${derivedSlug(operation)}-${String(index + 1).padStart(2, '0')}`

const draftDocument = (input: {
  readonly draft: unknown
  readonly operationId: string
  readonly current?: EncounterTableDocumentV1
  readonly source?: EncounterTableDocumentV1
  readonly tableId?: string
  readonly provenanceKind?: 'campaign-authored' | 'copied' | 'imported'
  readonly now: string
}): EncounterTableDocumentV1 => {
  const draft = record(input.draft, 'draft')
  exactKeys(draft, ['name', 'environmentTags', 'predicates', 'rows', 'groupSizePolicy', 'notes'], 'draft')
  if (!Array.isArray(draft.rows)) throw new GmEncounterTableUseCaseError(400, 'invalid-rows', 'draft.rows must be an array')
  const id = input.current?.tableId ?? input.tableId ?? derivedTableId(input.operationId)
  const rows = draft.rows.map((candidate, index): EncounterTableRowV1 => {
    const row = record(candidate, `draft.rows[${index}]`)
    const kind = row.kind
    if (kind !== 'species' && kind !== 'nothing') {
      throw new GmEncounterTableUseCaseError(400, 'invalid-row-kind', `draft.rows[${index}].kind must be species or nothing`)
    }
    exactKeys(row, kind === 'species'
      ? ['rowId', 'kind', 'speciesId', 'weight', 'minLevel', 'maxLevel', 'predicates']
      : ['rowId', 'kind', 'weight', 'predicates'], `draft.rows[${index}]`)
    const rowId = typeof row.rowId === 'string' && input.current?.rows.some(current => current.rowId === row.rowId)
      ? row.rowId
      : derivedRowId(`${input.operationId}:${id}`, index)
    const predicates = row.predicates as EncounterTablePredicatesV1
    return kind === 'nothing'
      ? { rowId, kind, weight: row.weight as number, predicates }
      : {
          rowId,
          kind,
          speciesId: row.speciesId as string,
          weight: row.weight as number,
          minLevel: row.minLevel as number,
          maxLevel: row.maxLevel as number,
          predicates,
        }
  })
  const provenance = input.current?.provenance ?? {
    kind: input.provenanceKind ?? 'campaign-authored',
    sourceLabel: input.source?.name ?? null,
    sourceSha256: null,
    sourceTableId: input.source?.tableId ?? null,
    sourceRevision: input.source?.revision ?? null,
  }
  try {
    return parseEncounterTableDocumentV1({
      schemaVersion: 1,
      documentKind: 'encounter-table',
      tableId: id,
      revision: input.current ? input.current.revision + 1 : 0,
      status: input.current?.status ?? 'active',
      name: draft.name,
      environmentTags: draft.environmentTags,
      predicates: draft.predicates,
      rows,
      groupSizePolicy: draft.groupSizePolicy as EncounterTableGroupSizePolicyV1,
      notes: draft.notes,
      provenance,
      createdAt: input.current?.createdAt ?? input.now,
      updatedAt: input.now,
      archivedAt: input.current?.archivedAt ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Encounter table draft is invalid'
    throw new GmEncounterTableUseCaseError(400, 'invalid-table', message)
  }
}

export const encounterTableDocumentToDraft = (table: EncounterTableDocumentV1): GmEncounterTableDraft => ({
  name: table.name,
  environmentTags: [...table.environmentTags],
  predicates: { timeOfDay: [...table.predicates.timeOfDay], weather: [...table.predicates.weather] },
  rows: table.rows.map(row => ({
    ...row,
    predicates: { timeOfDay: [...row.predicates.timeOfDay], weather: [...row.predicates.weather] },
  })),
  groupSizePolicy: { ...table.groupSizePolicy },
  notes: table.notes,
})

const dependencies = (input: GmEncounterTableUseCaseDependencies) => ({
  repository: input.repository ?? createSqliteGmEncounterTableRepository(),
  now: normalizedInstant((input.now ?? (() => new Date().toISOString()))()),
})

export const listGmEncounterTablesUseCase = (
  input: { readonly includeArchived?: boolean } = {},
  deps: GmEncounterTableUseCaseDependencies = {},
) => {
  const { repository } = dependencies(deps)
  return {
    schemaVersion: 1 as const,
    tables: repository.list({ includeArchived: input.includeArchived }).map(projectEncounterTableForLibrary),
  }
}

export const getGmEncounterTableUseCase = (
  input: { readonly tableId?: unknown },
  deps: GmEncounterTableUseCaseDependencies = {},
) => {
  const { repository } = dependencies(deps)
  const id = tableId(input.tableId)
  const table = repository.get(id)
  if (!table) throw new GmEncounterTableUseCaseError(404, 'not-found', 'Encounter table not found')
  const sourceReview = table.provenance.kind === 'legacy-migration'
    ? { state: 'migration-bound' as const, sourceName: null, sourceRevision: null }
    : table.provenance.sourceTableId === null
      ? { state: 'not-applicable' as const, sourceName: null, sourceRevision: null }
      : (() => {
          const source = repository.get(table.provenance.sourceTableId)
          if (!source) return { state: 'source-missing' as const, sourceName: table.provenance.sourceLabel, sourceRevision: null }
          return {
            state: source.revision === table.provenance.sourceRevision ? 'current' as const : 'source-changed' as const,
            sourceName: source.name,
            sourceRevision: source.revision,
          }
        })()
  return { schemaVersion: 1 as const, table, sourceReview }
}

const settle = (
  command: GmEncounterTableOperationCommand,
  createResult: () => EncounterTableDocumentV1,
  deps: GmEncounterTableUseCaseDependencies,
): GmEncounterTableOperationResult => {
  const { repository, now } = dependencies(deps)
  const commandSha256 = gmEncounterTableCommandSha256(command)
  const prior = repository.getOperation(command.operationId)
  if (prior) {
    if (prior.commandSha256 !== commandSha256) {
      throw new GmEncounterTableUseCaseError(409, 'operation-reused', 'This operation ID was already used for different table changes')
    }
    return prior
  }
  return repository.database.withTransaction(() => {
    const concurrent = repository.getOperation(command.operationId)
    if (concurrent) {
      if (concurrent.commandSha256 !== commandSha256) {
        throw new GmEncounterTableUseCaseError(409, 'operation-reused', 'This operation ID was already used for different table changes')
      }
      return concurrent
    }
    let table: EncounterTableDocumentV1
    try {
      table = createResult()
    } catch (error) {
      if (error instanceof GmEncounterTableUseCaseError) throw error
      const message = error instanceof Error ? error.message : 'Encounter table could not be changed'
      if (message.includes('changed before')) throw new GmEncounterTableUseCaseError(409, 'stale-revision', message)
      if (message.includes('UNIQUE constraint')) throw new GmEncounterTableUseCaseError(409, 'table-conflict', 'An encounter table with that identity already exists')
      throw error
    }
    const result: GmEncounterTableOperationResult = {
      schemaVersion: 1,
      operationId: command.operationId,
      commandSha256,
      commandKind: command.commandKind,
      table,
      exactRetry: false,
    }
    repository.recordOperation(command, result, now)
    return result
  })
}

const mutableCommand = (
  kind: GmEncounterTableCommandKind,
  input: MutateGmEncounterTableInput,
): { readonly command: GmEncounterTableOperationCommand; readonly id: string; readonly expectedRevision: number } => {
  const op = operationId(input.operationId)
  const id = tableId(input.tableId)
  const expected = revision(input.expectedRevision)
  return {
    id,
    expectedRevision: expected,
    command: { operationId: op, commandKind: kind, tableId: id, expectedRevision: expected, material: kind === 'update' ? record(input.draft, 'draft') : null },
  }
}

export const createGmEncounterTableUseCase = (
  input: MutateGmEncounterTableInput,
  deps: GmEncounterTableUseCaseDependencies = {},
): GmEncounterTableOperationResult => {
  const op = operationId(input.operationId ?? randomUUID())
  const material = record(input.draft, 'draft')
  const id = derivedTableId(op)
  const command: GmEncounterTableOperationCommand = { operationId: op, commandKind: 'create', tableId: id, expectedRevision: null, material }
  return settle(command, () => {
    const { repository, now } = dependencies(deps)
    return repository.create(draftDocument({ draft: material, operationId: op, tableId: id, now }))
  }, deps)
}

export const updateGmEncounterTableUseCase = (
  input: MutateGmEncounterTableInput,
  deps: GmEncounterTableUseCaseDependencies = {},
): GmEncounterTableOperationResult => {
  const { command, id, expectedRevision } = mutableCommand('update', input)
  return settle(command, () => {
    const { repository, now } = dependencies(deps)
    const current = repository.get(id)
    if (!current) throw new GmEncounterTableUseCaseError(404, 'not-found', 'Encounter table not found')
    if (current.revision !== expectedRevision) throw new GmEncounterTableUseCaseError(409, 'stale-revision', 'Encounter table changed before it could be saved')
    return repository.replace(expectedRevision, draftDocument({ draft: input.draft, operationId: command.operationId, current, now }))
  }, deps)
}

const changeArchiveState = (
  kind: 'archive' | 'restore',
  input: MutateGmEncounterTableInput,
  deps: GmEncounterTableUseCaseDependencies,
): GmEncounterTableOperationResult => {
  const { command, id, expectedRevision } = mutableCommand(kind, input)
  return settle(command, () => {
    const { repository, now } = dependencies(deps)
    const current = repository.get(id)
    if (!current) throw new GmEncounterTableUseCaseError(404, 'not-found', 'Encounter table not found')
    if (current.revision !== expectedRevision) throw new GmEncounterTableUseCaseError(409, 'stale-revision', 'Encounter table changed before it could be archived')
    const status = kind === 'archive' ? 'archived' : 'active'
    if (current.status === status) throw new GmEncounterTableUseCaseError(409, 'already-set', `Encounter table is already ${status}`)
    return repository.replace(expectedRevision, parseEncounterTableDocumentV1({
      ...current,
      revision: expectedRevision + 1,
      status,
      updatedAt: now,
      archivedAt: kind === 'archive' ? now : null,
    }))
  }, deps)
}

export const archiveGmEncounterTableUseCase = (input: MutateGmEncounterTableInput, deps: GmEncounterTableUseCaseDependencies = {}) => (
  changeArchiveState('archive', input, deps)
)
export const restoreGmEncounterTableUseCase = (input: MutateGmEncounterTableInput, deps: GmEncounterTableUseCaseDependencies = {}) => (
  changeArchiveState('restore', input, deps)
)

export const copyGmEncounterTableUseCase = (
  input: MutateGmEncounterTableInput,
  deps: GmEncounterTableUseCaseDependencies = {},
): GmEncounterTableOperationResult => {
  const op = operationId(input.operationId)
  const sourceId = tableId(input.tableId)
  const expected = revision(input.expectedRevision)
  const id = derivedTableId(op)
  const command: GmEncounterTableOperationCommand = {
    operationId: op,
    commandKind: 'copy',
    tableId: id,
    expectedRevision: expected,
    material: { sourceTableId: sourceId, name: typeof input.name === 'string' ? input.name : null },
  }
  return settle(command, () => {
    const { repository, now } = dependencies(deps)
    const source = repository.get(sourceId)
    if (!source) throw new GmEncounterTableUseCaseError(404, 'not-found', 'Source encounter table not found')
    if (source.revision !== expected) throw new GmEncounterTableUseCaseError(409, 'stale-revision', 'Source encounter table changed before it could be copied')
    const draft = encounterTableDocumentToDraft(source) as Record<string, unknown>
    draft.name = typeof input.name === 'string' ? input.name : `${source.name} copy`
    return repository.create(draftDocument({ draft, operationId: op, source, tableId: id, provenanceKind: 'copied', now }))
  }, deps)
}

export const exportGmEncounterTableUseCase = (
  input: { readonly tableId?: unknown },
  deps: GmEncounterTableUseCaseDependencies = {},
): EncounterTableExportV1 => {
  const { repository, now } = dependencies(deps)
  const table = repository.get(tableId(input.tableId))
  if (!table) throw new GmEncounterTableUseCaseError(404, 'not-found', 'Encounter table not found')
  return stableEncounterTableExport(table, now)
}

export const importGmEncounterTableUseCase = (
  input: MutateGmEncounterTableInput,
  deps: GmEncounterTableUseCaseDependencies = {},
): GmEncounterTableOperationResult => {
  const op = operationId(input.operationId)
  let imported: EncounterTableExportV1
  try {
    imported = parseEncounterTableExportV1(input.export)
  } catch (error) {
    throw new GmEncounterTableUseCaseError(400, 'invalid-import', error instanceof Error ? error.message : 'Import is invalid')
  }
  const id = derivedTableId(op)
  const command: GmEncounterTableOperationCommand = { operationId: op, commandKind: 'import', tableId: id, expectedRevision: null, material: input.export }
  return settle(command, () => {
    const { repository, now } = dependencies(deps)
    return repository.create(draftDocument({
      draft: encounterTableDocumentToDraft(imported.table),
      operationId: op,
      source: imported.table,
      tableId: id,
      provenanceKind: 'imported',
      now,
    }))
  }, deps)
}
