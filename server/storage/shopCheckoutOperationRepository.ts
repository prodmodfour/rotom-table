import { validateSlug } from '#shared/paths'
import {
  validateShopCheckoutCommandEnvelope,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  areShopCheckoutCommandsSemanticallyEqual,
  assertShopCheckoutOperationResultCompatible,
  assertShopCheckoutResultMatchesCommand,
  createShopCheckoutCommandHash,
  isStorableShopCheckoutCommandResult,
  shopCheckoutIdempotencyViolationMessage,
  type ShopCheckoutCommandHash,
  type StorableShopCheckoutCommandResult,
} from '../livePlay/shopCheckoutOpResult'
import { validateLivePlayOperationId } from '../livePlay/commandIdempotency'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export const SHOP_CHECKOUT_OPERATION_STORE_SCHEMA_VERSION = 1 as const

export interface SqliteShopCheckoutOperationRecord {
  readonly schemaVersion: typeof SHOP_CHECKOUT_OPERATION_STORE_SCHEMA_VERSION
  readonly shopSlug: string
  readonly opId: string
  readonly commandHash: ShopCheckoutCommandHash
  readonly command: ShopCheckoutLivePlayCommand
  readonly result: StorableShopCheckoutCommandResult
  readonly createdAt: number
  readonly recordedAt: string
  readonly resultRevision?: number
}

export interface SaveShopCheckoutOperationResultInput {
  readonly shopSlug: string
  readonly opId: string
  readonly command: ShopCheckoutLivePlayCommand
  readonly commandHash?: ShopCheckoutCommandHash
  readonly result: StorableShopCheckoutCommandResult
  readonly recordedAt?: string
}

export interface ShopCheckoutOperationRepository {
  getStoredOperation(shopSlug: string, opId: string): SqliteShopCheckoutOperationRecord | null
  getOperationResult(shopSlug: string, opId: string): StorableShopCheckoutCommandResult | null
  saveCommandResult(input: SaveShopCheckoutOperationResultInput): SqliteShopCheckoutOperationRecord
}

export interface CreateSqliteShopCheckoutOperationRepositoryOptions {
  readonly database?: RotomDatabase
  readonly clock?: () => number
}

interface ShopCheckoutOperationRow {
  readonly op_id: unknown
  readonly shop_slug: unknown
  readonly command_hash: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const commandPayloadShopSlug = (command: ShopCheckoutLivePlayCommand, label: string): string => {
  if (!isRecord(command.payload)) throw new Error(`${label}.payload must be an object`)
  return validateSlug(command.payload.shopSlug, `${label}.payload.shopSlug`)
}

const validateCommandHash = (value: unknown): ShopCheckoutCommandHash => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('shop_checkout_ops.command_hash must be a non-empty string')
  }
  return value as ShopCheckoutCommandHash
}

const parseResultRevision = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  return parseStoredRevision(value, 'shop_checkout_ops.result_revision')
}

const parseStoredCommand = (json: string, opId: string): ShopCheckoutLivePlayCommand => {
  const command = parseStoredDocumentJson<unknown>(json, `shop checkout op ${opId} command`)
  const validation = validateShopCheckoutCommandEnvelope(command)
  if (!validation.valid) {
    const summary = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    throw new Error(`shop checkout op ${opId} command_json must be a valid shop checkout command envelope: ${summary}`)
  }
  return cloneStoredJson(validation.command)
}

const parseRecordedResult = (json: string, opId: string): StorableShopCheckoutCommandResult => {
  const result = parseStoredDocumentJson<unknown>(json, `shop checkout op ${opId} result`)
  if (!isStorableShopCheckoutCommandResult(result)) {
    throw new Error(`shop checkout op ${opId} result_json must be an accepted or rejected checkout result`)
  }
  return cloneStoredJson(result)
}

const resultRevision = (result: StorableShopCheckoutCommandResult): number | null => {
  const revision = result.ok ? result.shopRevision : result.currentShopRevision
  return typeof revision === 'number' ? parseStoredRevision(revision, 'shop checkout op result revision') : null
}

const rowToOperationRecord = (row: ShopCheckoutOperationRow): SqliteShopCheckoutOperationRecord => {
  if (typeof row.command_json !== 'string') throw new Error('shop_checkout_ops.command_json must be a string')
  if (typeof row.result_json !== 'string') throw new Error('shop_checkout_ops.result_json must be a string')

  const opId = validateLivePlayOperationId(row.op_id, 'shop_checkout_ops.op_id')
  const shopSlug = validateSlug(row.shop_slug, 'shop_checkout_ops.shop_slug')
  const commandHash = validateCommandHash(row.command_hash)
  const command = parseStoredCommand(row.command_json, opId)
  const result = parseRecordedResult(row.result_json, opId)
  const createdAt = parseStoredTimestamp(row.created_at, 'shop_checkout_ops.created_at')
  const storedResultRevision = parseResultRevision(row.result_revision)

  if (command.opId !== opId) {
    throw new Error(`shop checkout op ${opId} command_json opId must match op_id`)
  }
  if (commandPayloadShopSlug(command, `shop checkout op ${opId} command_json`) !== shopSlug) {
    throw new Error(`shop checkout op ${opId} command_json payload.shopSlug must match shop_slug`)
  }
  if (result.opId !== opId) {
    throw new Error(`shop checkout op ${opId} result_json opId must match op_id`)
  }
  if (result.ok && result.shopSlug !== shopSlug) {
    throw new Error(`shop checkout op ${opId} accepted result_json shopSlug must match shop_slug`)
  }
  if (!result.ok && result.shopSlug !== undefined && result.shopSlug !== shopSlug) {
    throw new Error(`shop checkout op ${opId} rejected result_json shopSlug must match shop_slug when present`)
  }

  return {
    schemaVersion: SHOP_CHECKOUT_OPERATION_STORE_SCHEMA_VERSION,
    shopSlug,
    opId,
    commandHash,
    command,
    result,
    ...(storedResultRevision === undefined ? {} : { resultRevision: storedResultRevision }),
    createdAt,
    recordedAt: new Date(createdAt).toISOString(),
  }
}

const createdAtFromInput = (
  input: Pick<SaveShopCheckoutOperationResultInput, 'recordedAt'>,
  clock: () => number,
): number => {
  if (input.recordedAt === undefined) return parseStoredTimestamp(clock(), 'shop checkout op createdAt')
  const parsed = Date.parse(input.recordedAt)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('shop checkout op recordedAt must be an ISO-compatible timestamp')
  }
  return parsed
}

const validateSaveInput = (
  input: SaveShopCheckoutOperationResultInput,
): { readonly shopSlug: string; readonly opId: string; readonly commandHash: ShopCheckoutCommandHash } => {
  const shopSlug = validateSlug(input.shopSlug, 'shop checkout op shopSlug')
  const opId = validateLivePlayOperationId(input.opId, 'shop checkout op opId')
  const validation = validateShopCheckoutCommandEnvelope(input.command)
  if (!validation.valid) {
    const summary = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    throw new Error(`shop checkout op command is invalid: ${summary}`)
  }
  if (input.command.opId !== opId) {
    throw new Error('shop checkout op command opId must match the stored opId')
  }
  if (commandPayloadShopSlug(input.command, 'shop checkout op command') !== shopSlug) {
    throw new Error('shop checkout op command payload.shopSlug must match the stored shopSlug')
  }
  if (!isStorableShopCheckoutCommandResult(input.result)) {
    throw new Error('shop checkout op result must be an accepted or rejected checkout result')
  }
  assertShopCheckoutResultMatchesCommand(input.command, input.result)

  const computedCommandHash = createShopCheckoutCommandHash(input.command)
  if (input.commandHash !== undefined && input.commandHash !== computedCommandHash) {
    throw new Error('shop checkout op commandHash must match the command envelope')
  }

  return { shopSlug, opId, commandHash: computedCommandHash }
}

export const createSqliteShopCheckoutOperationRepository = (
  options: CreateSqliteShopCheckoutOperationRepositoryOptions = {},
): ShopCheckoutOperationRepository => {
  const database = options.database ?? getRotomDatabase()
  const clock = options.clock ?? Date.now

  const findByOpId = (opId: string): SqliteShopCheckoutOperationRecord | null => {
    const parsedOpId = validateLivePlayOperationId(opId, 'shop checkout op opId')
    const row = database.connection.prepare(`
      SELECT op_id, shop_slug, command_hash, command_json, result_json, result_revision, created_at
      FROM shop_checkout_ops
      WHERE op_id = ?
    `).get(parsedOpId) as ShopCheckoutOperationRow | undefined
    return row ? rowToOperationRecord(row) : null
  }

  const getStoredOperation = (shopSlugInput: string, opId: string): SqliteShopCheckoutOperationRecord | null => {
    const shopSlug = validateSlug(shopSlugInput, 'shop checkout op shopSlug')
    const record = findByOpId(opId)
    return record && record.shopSlug === shopSlug ? record : null
  }

  const saveCommandResult = (input: SaveShopCheckoutOperationResultInput): SqliteShopCheckoutOperationRecord =>
    database.withTransaction(() => {
      const { shopSlug, opId, commandHash } = validateSaveInput(input)
      const command = cloneStoredJson(input.command)
      const result = cloneStoredJson(input.result)
      const existing = findByOpId(opId)
      if (existing) {
        if (
          existing.shopSlug !== shopSlug
          || existing.commandHash !== commandHash
          || !areShopCheckoutCommandsSemanticallyEqual(existing.command, command)
        ) {
          throw new Error(shopCheckoutIdempotencyViolationMessage(existing.shopSlug, existing.opId))
        }
        assertShopCheckoutOperationResultCompatible({
          shopSlug: existing.shopSlug,
          opId: existing.opId,
          commandHash,
          existingResult: existing.result,
          attemptedResult: result,
        })
        return existing
      }

      const createdAt = createdAtFromInput(input, clock)
      database.connection.prepare(`
        INSERT INTO shop_checkout_ops (
          op_id,
          shop_slug,
          command_hash,
          command_json,
          result_json,
          result_revision,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        shopSlug,
        commandHash,
        stringifyStoredDocument(command),
        stringifyStoredDocument(result),
        resultRevision(result),
        createdAt,
      )
      const record = findByOpId(opId)
      if (!record) throw new Error(`shop checkout op ${opId} was not readable after insert`)
      return record
    })

  return {
    getStoredOperation,
    getOperationResult: (shopSlug, opId) => getStoredOperation(shopSlug, opId)?.result ?? null,
    saveCommandResult,
  }
}

const defaultOperationRepository = (): ShopCheckoutOperationRepository =>
  createSqliteShopCheckoutOperationRepository({ database: getRotomDatabase() })

export const sqliteShopCheckoutOperationRepository: ShopCheckoutOperationRepository = {
  getStoredOperation: (shopSlug, opId) => defaultOperationRepository().getStoredOperation(shopSlug, opId),
  getOperationResult: (shopSlug, opId) => defaultOperationRepository().getOperationResult(shopSlug, opId),
  saveCommandResult: (input) => defaultOperationRepository().saveCommandResult(input),
}
