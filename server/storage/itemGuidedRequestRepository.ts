import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { isPlainJsonObject, type StrictJsonObject } from '#shared/automation/strictJson'
import {
  ITEM_GUIDED_OPERATION_ID_RE,
  ITEM_GUIDED_REQUEST_ID_RE,
  parseItemGuidedAdjudicationCommand,
  type ItemGuidedAdjudicationCommandV1,
  type ResolveItemGuidedRequestCommandV1,
  type CancelItemGuidedRequestCommandV1,
  type ItemGuidedReBreatherActionKind,
  type ItemGuidedRequestKind,
  type ItemGuidedRequestStatus,
} from '#shared/itemAutomation/guidedAdjudication'
import type { EquipmentOwnerKind } from '#shared/itemAutomation/equipment'
import type { SheetKind } from '#shared/sheets'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export const ITEM_GUIDED_REQUEST_STORE_SCHEMA_VERSION = 1 as const

export interface StoredItemGuidedCommonAuthorityV1 {
  readonly actorLabel: string
  readonly targetLabel: string
  readonly timingLabel: string
  readonly prompt: string
  readonly canonicalFacts: readonly string[]
  readonly settlementFacts: readonly string[]
  readonly reservationLabel: string | null
  readonly boundaryLabel: string
}

interface StoredItemGuidedItemOperationCommonAuthorityV1 extends StoredItemGuidedCommonAuthorityV1 {
  readonly schemaVersion: 1
  readonly sourceKind: 'item-operation'
  readonly itemOperationId: string
  readonly decisionId: string
  readonly targetChoiceId: string
}

export interface StoredItemGuidedLoyaltyAuthorityV1 extends StoredItemGuidedItemOperationCommonAuthorityV1 {
  readonly loyaltyChoiceId: string
}

export interface StoredItemGuidedCampaignToolAuthorityV1 extends StoredItemGuidedItemOperationCommonAuthorityV1 {
  readonly campaignToolChoiceId: string
}

export type StoredItemGuidedItemOperationAuthorityV1 =
  | StoredItemGuidedLoyaltyAuthorityV1
  | StoredItemGuidedCampaignToolAuthorityV1

export interface StoredItemGuidedReBreatherAuthorityV1 extends StoredItemGuidedCommonAuthorityV1 {
  readonly schemaVersion: 1
  readonly sourceKind: 'equipped-re-breather'
  readonly trainerSlug: string
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly sheetRevision: number
  readonly equipmentRevision: number
  readonly instanceId: string
  readonly instanceRevision: number
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly offerId: string
  readonly actionKind: ItemGuidedReBreatherActionKind
}

export type StoredItemGuidedAuthorityV1 =
  | StoredItemGuidedItemOperationAuthorityV1
  | StoredItemGuidedReBreatherAuthorityV1

export interface StoredItemGuidedRequestResultV1 {
  readonly schemaVersion: 1
  readonly status: 'accepted' | 'cancelled'
  readonly acceptedSummary: string | null
}

export type ItemGuidedTerminalCommandV1 = ResolveItemGuidedRequestCommandV1 | CancelItemGuidedRequestCommandV1

export interface StoredItemGuidedRequestRecord {
  readonly schemaVersion: typeof ITEM_GUIDED_REQUEST_STORE_SCHEMA_VERSION
  readonly requestId: string
  readonly requestKind: ItemGuidedRequestKind
  readonly status: ItemGuidedRequestStatus
  readonly revision: number
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly declarationPrincipalKey: string
  readonly actorKind: SheetKind
  readonly actorSlug: string
  readonly targetKind: SheetKind
  readonly targetSlug: string
  readonly itemOperationId: string | null
  readonly declarationOperationId: string
  readonly declarationCommandSha256: string
  readonly declarationCommand: StrictJsonObject
  readonly authority: StoredItemGuidedAuthorityV1
  readonly terminalPrincipalKey: string | null
  readonly terminalOperationId: string | null
  readonly terminalCommandSha256: string | null
  readonly terminalCommand: ItemGuidedTerminalCommandV1 | null
  readonly outcomeOptionId: string | null
  readonly result: StoredItemGuidedRequestResultV1 | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface CreateItemGuidedRequestInput {
  readonly requestId: string
  readonly requestKind: ItemGuidedRequestKind
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly declarationPrincipalKey: string
  readonly actorKind: SheetKind
  readonly actorSlug: string
  readonly targetKind: SheetKind
  readonly targetSlug: string
  readonly itemOperationId: string | null
  readonly declarationOperationId: string
  readonly declarationCommand: StrictJsonObject
  readonly authority: StoredItemGuidedAuthorityV1
  readonly createdAt?: number
}

export interface SettleItemGuidedRequestInput {
  readonly requestId: string
  readonly expectedRevision: number
  readonly status: 'accepted' | 'cancelled'
  readonly terminalPrincipalKey: string
  readonly command: ItemGuidedTerminalCommandV1
  readonly outcomeOptionId: string | null
  readonly result: StoredItemGuidedRequestResultV1
  readonly updatedAt?: number
}

export interface ItemGuidedRequestRepository {
  readonly database: RotomDatabase
  get(requestId: string): StoredItemGuidedRequestRecord | null
  getByItemOperation(operationId: string): StoredItemGuidedRequestRecord | null
  getByDeclarationOperation(operationId: string): StoredItemGuidedRequestRecord | null
  getByTerminalOperation(operationId: string): StoredItemGuidedRequestRecord | null
  listPending(): readonly StoredItemGuidedRequestRecord[]
  listForActor(kind: SheetKind, slug: string): readonly StoredItemGuidedRequestRecord[]
  create(input: CreateItemGuidedRequestInput): StoredItemGuidedRequestRecord
  settle(input: SettleItemGuidedRequestInput): { readonly kind: 'applied' | 'stale'; readonly record: StoredItemGuidedRequestRecord }
}

interface Row {
  readonly request_id: unknown
  readonly request_kind: unknown
  readonly status: unknown
  readonly revision: unknown
  readonly canonical_item_id: unknown
  readonly canonical_definition_sha256: unknown
  readonly declaration_principal_key: unknown
  readonly actor_kind: unknown
  readonly actor_slug: unknown
  readonly target_kind: unknown
  readonly target_slug: unknown
  readonly item_operation_id: unknown
  readonly declaration_operation_id: unknown
  readonly declaration_command_sha256: unknown
  readonly declaration_command_json: unknown
  readonly authority_json: unknown
  readonly terminal_principal_key: unknown
  readonly terminal_operation_id: unknown
  readonly terminal_command_sha256: unknown
  readonly terminal_command_json: unknown
  readonly outcome_option_id: unknown
  readonly result_json: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const ITEM_OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const EQUIPPED_INSTANCE_ID = /^equipped-item:v1:[a-f0-9]{32}$/
const KINDS = new Set<ItemGuidedRequestKind>([
  'loyalty-consequence', 'campaign-tool-adjudication',
  're-breather-activation', 're-breather-refill',
])
const STATUSES = new Set<ItemGuidedRequestStatus>(['pending', 'accepted', 'cancelled'])
const SHEET_KINDS = new Set<SheetKind>(['trainer', 'pokemon'])

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
export const itemGuidedCommandSha256 = (command: ItemGuidedAdjudicationCommandV1): string => sha256(stableJsonStringify(command))
export const itemGuidedDeclarationCommandSha256 = (command: StrictJsonObject): string => sha256(stableJsonStringify(command))

const text = (value: unknown, label: string, maximum = 500): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded non-empty trimmed text.`)
  }
  return value as string
}
const nullableText = (value: unknown, label: string, maximum = 500): string | null => value === null ? null : text(value, label, maximum)
const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a safe non-negative integer.`)
  return Number(value)
}
const digest = (value: unknown, label: string): string => {
  const result = text(value, label, 64)
  if (!SHA256.test(result)) throw new Error(`${label} must be a lowercase SHA-256 digest.`)
  return result
}
const requestId = (value: unknown, label: string): string => {
  const result = text(value, label, 64)
  if (!ITEM_GUIDED_REQUEST_ID_RE.test(result)) throw new Error(`${label} must be an opaque guided request identity.`)
  return result
}
const operationId = (value: unknown, label: string, guidedOnly = false): string => {
  const result = text(value, label, 200)
  if (!(guidedOnly ? ITEM_GUIDED_OPERATION_ID_RE : ITEM_OPERATION_ID).test(result)) throw new Error(`${label} is invalid.`)
  return result
}
const sheetKind = (value: unknown, label: string): SheetKind => {
  if (typeof value !== 'string' || !SHEET_KINDS.has(value as SheetKind)) throw new Error(`${label} is invalid.`)
  return value as SheetKind
}
const plain = (value: unknown, label: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) throw new Error(`${label} must be a plain JSON object.`)
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], label: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !expected.has(field))) {
    throw new Error(`${label} has an invalid shape.`)
  }
}
const strings = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${label} must be a bounded array.`)
  return (value as unknown[]).map((entry, index) => text(entry, `${label}[${index}]`, 1_000))
}

const commonAuthority = (input: UnknownRecord, label: string): StoredItemGuidedCommonAuthorityV1 => ({
  actorLabel: text(input.actorLabel, `${label}.actorLabel`),
  targetLabel: text(input.targetLabel, `${label}.targetLabel`),
  timingLabel: text(input.timingLabel, `${label}.timingLabel`),
  prompt: text(input.prompt, `${label}.prompt`, 1_000),
  canonicalFacts: strings(input.canonicalFacts, `${label}.canonicalFacts`),
  settlementFacts: strings(input.settlementFacts, `${label}.settlementFacts`),
  reservationLabel: nullableText(input.reservationLabel, `${label}.reservationLabel`, 1_000),
  boundaryLabel: text(input.boundaryLabel, `${label}.boundaryLabel`, 1_000),
})

export const parseStoredItemGuidedAuthority = (value: unknown): StoredItemGuidedAuthorityV1 => {
  const input = plain(value, 'itemGuidedRequest.authority')
  const commonFields = [
    'schemaVersion', 'sourceKind', 'actorLabel', 'targetLabel', 'timingLabel', 'prompt',
    'canonicalFacts', 'settlementFacts', 'reservationLabel', 'boundaryLabel',
  ]
  if (input.schemaVersion !== 1) throw new Error('itemGuidedRequest.authority.schemaVersion must be 1.')
  if (input.sourceKind === 'item-operation') {
    const campaignTool = Object.hasOwn(input, 'campaignToolChoiceId')
    exact(input, [
      ...commonFields, 'itemOperationId', 'decisionId', 'targetChoiceId',
      campaignTool ? 'campaignToolChoiceId' : 'loyaltyChoiceId',
    ], 'itemGuidedRequest.authority')
    const common = {
      schemaVersion: 1 as const,
      sourceKind: 'item-operation' as const,
      ...commonAuthority(input, 'itemGuidedRequest.authority'),
      itemOperationId: operationId(input.itemOperationId, 'itemGuidedRequest.authority.itemOperationId'),
      decisionId: text(input.decisionId, 'itemGuidedRequest.authority.decisionId', 200),
      targetChoiceId: text(input.targetChoiceId, 'itemGuidedRequest.authority.targetChoiceId', 200),
    }
    return campaignTool
      ? Object.freeze({
          ...common,
          campaignToolChoiceId: text(
            input.campaignToolChoiceId,
            'itemGuidedRequest.authority.campaignToolChoiceId',
            200,
          ),
        })
      : Object.freeze({
          ...common,
          loyaltyChoiceId: text(input.loyaltyChoiceId, 'itemGuidedRequest.authority.loyaltyChoiceId', 200),
        })
  }
  if (input.sourceKind === 'equipped-re-breather') {
    exact(input, [
      ...commonFields, 'trainerSlug', 'ownerKind', 'ownerSlug', 'sheetRevision',
      'equipmentRevision', 'instanceId', 'instanceRevision', 'campaignClockRevision',
      'campaignMinute', 'offerId', 'actionKind',
    ], 'itemGuidedRequest.authority')
    if (input.ownerKind !== 'trainer' && input.ownerKind !== 'pokemon') throw new Error('itemGuidedRequest.authority.ownerKind is invalid.')
    if (input.actionKind !== 'activate' && input.actionKind !== 'begin-open-air-refill') throw new Error('itemGuidedRequest.authority.actionKind is invalid.')
    const instanceId = text(input.instanceId, 'itemGuidedRequest.authority.instanceId', 200)
    if (!EQUIPPED_INSTANCE_ID.test(instanceId)) throw new Error('itemGuidedRequest.authority.instanceId is invalid.')
    return Object.freeze({
      schemaVersion: 1, sourceKind: 'equipped-re-breather', ...commonAuthority(input, 'itemGuidedRequest.authority'),
      trainerSlug: text(input.trainerSlug, 'itemGuidedRequest.authority.trainerSlug', 200),
      ownerKind: input.ownerKind as EquipmentOwnerKind,
      ownerSlug: text(input.ownerSlug, 'itemGuidedRequest.authority.ownerSlug', 200),
      sheetRevision: integer(input.sheetRevision, 'itemGuidedRequest.authority.sheetRevision'),
      equipmentRevision: integer(input.equipmentRevision, 'itemGuidedRequest.authority.equipmentRevision'),
      instanceId,
      instanceRevision: integer(input.instanceRevision, 'itemGuidedRequest.authority.instanceRevision'),
      campaignClockRevision: integer(input.campaignClockRevision, 'itemGuidedRequest.authority.campaignClockRevision'),
      campaignMinute: integer(input.campaignMinute, 'itemGuidedRequest.authority.campaignMinute'),
      offerId: text(input.offerId, 'itemGuidedRequest.authority.offerId', 200),
      actionKind: input.actionKind,
    })
  }
  throw new Error('itemGuidedRequest.authority.sourceKind is unsupported.')
}

const parseResult = (value: unknown): StoredItemGuidedRequestResultV1 => {
  const input = plain(value, 'itemGuidedRequest.result')
  exact(input, ['schemaVersion', 'status', 'acceptedSummary'], 'itemGuidedRequest.result')
  if (input.schemaVersion !== 1 || (input.status !== 'accepted' && input.status !== 'cancelled')) throw new Error('itemGuidedRequest.result is invalid.')
  return Object.freeze({
    schemaVersion: 1,
    status: input.status,
    acceptedSummary: nullableText(input.acceptedSummary, 'itemGuidedRequest.result.acceptedSummary', 1_000),
  })
}

const SELECT = `
  SELECT request_id, request_kind, status, revision, canonical_item_id,
    canonical_definition_sha256, declaration_principal_key, actor_kind, actor_slug,
    target_kind, target_slug, item_operation_id, declaration_operation_id,
    declaration_command_sha256, declaration_command_json, authority_json,
    terminal_principal_key, terminal_operation_id, terminal_command_sha256,
    terminal_command_json, outcome_option_id, result_json, created_at, updated_at
  FROM item_guided_requests
`

const rowToRecord = (row: Row): StoredItemGuidedRequestRecord => {
  const id = requestId(row.request_id, 'item_guided_requests.request_id')
  if (typeof row.request_kind !== 'string' || !KINDS.has(row.request_kind as ItemGuidedRequestKind)) throw new Error(`Guided request ${id} kind is invalid.`)
  if (typeof row.status !== 'string' || !STATUSES.has(row.status as ItemGuidedRequestStatus)) throw new Error(`Guided request ${id} status is invalid.`)
  if (typeof row.declaration_command_json !== 'string' || typeof row.authority_json !== 'string') throw new Error(`Guided request ${id} JSON evidence is missing.`)
  const declarationCommand = plain(parseStoredDocumentJson<unknown>(row.declaration_command_json, `guided request ${id} declaration`), `guided request ${id} declaration`) as StrictJsonObject
  const declarationHash = digest(row.declaration_command_sha256, `guided request ${id} declaration hash`)
  if (itemGuidedDeclarationCommandSha256(declarationCommand) !== declarationHash) throw new Error(`Guided request ${id} declaration evidence drifted.`)
  const authority = parseStoredItemGuidedAuthority(parseStoredDocumentJson<unknown>(row.authority_json, `guided request ${id} authority`))
  const terminalParsed = row.terminal_command_json === null
    ? null
    : parseItemGuidedAdjudicationCommand(parseStoredDocumentJson<unknown>(String(row.terminal_command_json), `guided request ${id} terminal command`))
  if (terminalParsed?.action === 'declare-re-breather') throw new Error(`Guided request ${id} stored a declaration as terminal evidence.`)
  const terminalCommand: ItemGuidedTerminalCommandV1 | null = terminalParsed
  const terminalHash = row.terminal_command_sha256 === null ? null : digest(row.terminal_command_sha256, `guided request ${id} terminal hash`)
  if ((terminalCommand === null) !== (terminalHash === null)
    || (terminalCommand && itemGuidedCommandSha256(terminalCommand) !== terminalHash)) throw new Error(`Guided request ${id} terminal evidence drifted.`)
  const result = row.result_json === null
    ? null
    : parseResult(parseStoredDocumentJson<unknown>(String(row.result_json), `guided request ${id} result`))
  const status = row.status as ItemGuidedRequestStatus
  const revision = integer(row.revision, `guided request ${id} revision`)
  if ((status === 'pending') !== (terminalCommand === null) || (status === 'pending') !== (result === null)
    || revision !== (status === 'pending' ? 0 : 1)) throw new Error(`Guided request ${id} lifecycle evidence drifted.`)
  const itemOperationId = nullableText(row.item_operation_id, `guided request ${id} item operation`, 200)
  if (itemOperationId !== null) operationId(itemOperationId, `guided request ${id} item operation`)
  const declarationOperationId = operationId(row.declaration_operation_id, `guided request ${id} declaration operation`)
  const terminalOperationId = nullableText(row.terminal_operation_id, `guided request ${id} terminal operation`, 200)
  if (terminalOperationId !== null) operationId(terminalOperationId, `guided request ${id} terminal operation`, true)
  if (terminalCommand && (terminalCommand.operationId !== terminalOperationId || terminalCommand.requestId !== id)) {
    throw new Error(`Guided request ${id} terminal command identity drifted.`)
  }
  const requestKind = row.request_kind as ItemGuidedRequestKind
  if ((authority.sourceKind === 'item-operation') !== (itemOperationId !== null)
    || (authority.sourceKind === 'item-operation' && authority.itemOperationId !== itemOperationId)
    || (requestKind === 'campaign-tool-adjudication') !== (authority.sourceKind === 'item-operation'
      && 'campaignToolChoiceId' in authority)
    || (requestKind === 'loyalty-consequence') !== (authority.sourceKind === 'item-operation'
      && 'loyaltyChoiceId' in authority)) {
    throw new Error(`Guided request ${id} source authority drifted.`)
  }
  return Object.freeze({
    schemaVersion: ITEM_GUIDED_REQUEST_STORE_SCHEMA_VERSION,
    requestId: id,
    requestKind,
    status,
    revision,
    canonicalItemId: text(row.canonical_item_id, `guided request ${id} canonical item`, 200),
    canonicalDefinitionSha256: digest(row.canonical_definition_sha256, `guided request ${id} definition hash`),
    declarationPrincipalKey: text(row.declaration_principal_key, `guided request ${id} declaration principal`, 160),
    actorKind: sheetKind(row.actor_kind, `guided request ${id} actor kind`),
    actorSlug: text(row.actor_slug, `guided request ${id} actor slug`, 200),
    targetKind: sheetKind(row.target_kind, `guided request ${id} target kind`),
    targetSlug: text(row.target_slug, `guided request ${id} target slug`, 200),
    itemOperationId,
    declarationOperationId,
    declarationCommandSha256: declarationHash,
    declarationCommand: cloneStoredJson(declarationCommand),
    authority,
    terminalPrincipalKey: nullableText(row.terminal_principal_key, `guided request ${id} terminal principal`, 160),
    terminalOperationId,
    terminalCommandSha256: terminalHash,
    terminalCommand,
    outcomeOptionId: nullableText(row.outcome_option_id, `guided request ${id} outcome option`, 200),
    result,
    createdAt: parseStoredTimestamp(row.created_at, `guided request ${id} createdAt`),
    updatedAt: parseStoredTimestamp(row.updated_at, `guided request ${id} updatedAt`),
  })
}

export const createSqliteItemGuidedRequestRepository = (input: {
  readonly database?: RotomDatabase
  readonly now?: () => number
} = {}): ItemGuidedRequestRepository => {
  const database = input.database ?? getRotomDatabase()
  const now = input.now ?? Date.now
  const select = (suffix: string, value: string): StoredItemGuidedRequestRecord | null => {
    const row = database.connection.prepare(`${SELECT} WHERE ${suffix} = ?`).get(value) as Row | undefined
    return row ? rowToRecord(row) : null
  }
  const repository: ItemGuidedRequestRepository = {
    database,
    get: id => select('request_id', requestId(id, 'guided request ID')),
    getByItemOperation: id => select('item_operation_id', operationId(id, 'item operation ID')),
    getByDeclarationOperation: id => select('declaration_operation_id', operationId(id, 'declaration operation ID')),
    getByTerminalOperation: id => select('terminal_operation_id', operationId(id, 'terminal operation ID', true)),
    listPending: () => Object.freeze((database.connection.prepare(`${SELECT} WHERE status = 'pending' ORDER BY created_at, request_id`).all() as unknown as Row[]).map(rowToRecord)),
    listForActor: (kind, slug) => Object.freeze((database.connection.prepare(`${SELECT} WHERE actor_kind = ? AND actor_slug = ? ORDER BY created_at DESC, request_id DESC`).all(sheetKind(kind, 'actor kind'), text(slug, 'actor slug', 200)) as unknown as Row[]).map(rowToRecord)),
    create: value => database.withTransaction(() => {
      const id = requestId(value.requestId, 'guided request ID')
      const declarationOperationId = operationId(value.declarationOperationId, 'declaration operation ID')
      const declarationCommand = plain(value.declarationCommand, 'guided declaration command') as StrictJsonObject
      const authority = parseStoredItemGuidedAuthority(value.authority)
      if (!KINDS.has(value.requestKind) || !SHEET_KINDS.has(value.actorKind) || !SHEET_KINDS.has(value.targetKind)) throw new Error('Guided request identity values are invalid.')
      const itemOperationId = value.itemOperationId === null ? null : operationId(value.itemOperationId, 'item operation ID')
      if ((authority.sourceKind === 'item-operation') !== (itemOperationId !== null)
        || (authority.sourceKind === 'item-operation' && authority.itemOperationId !== itemOperationId)
        || (value.requestKind === 'campaign-tool-adjudication') !== (authority.sourceKind === 'item-operation'
          && 'campaignToolChoiceId' in authority)
        || (value.requestKind === 'loyalty-consequence') !== (authority.sourceKind === 'item-operation'
          && 'loyaltyChoiceId' in authority)) throw new Error('Guided request item operation authority is inconsistent.')
      const existing = repository.get(id)
      if (existing) {
        if (existing.declarationOperationId !== declarationOperationId
          || existing.declarationCommandSha256 !== itemGuidedDeclarationCommandSha256(declarationCommand)
          || stableJsonStringify(existing.declarationCommand) !== stableJsonStringify(declarationCommand)) throw new Error(`Guided request ${id} was reused for another declaration.`)
        return existing
      }
      const operationReplay = repository.getByDeclarationOperation(declarationOperationId)
      if (operationReplay) throw new Error(`Guided declaration operation ${declarationOperationId} is already in use.`)
      const createdAt = parseStoredTimestamp(value.createdAt ?? now(), 'guided request createdAt')
      database.connection.prepare(`
        INSERT INTO item_guided_requests (
          request_id, request_kind, status, revision, canonical_item_id,
          canonical_definition_sha256, declaration_principal_key, actor_kind, actor_slug,
          target_kind, target_slug, item_operation_id, declaration_operation_id,
          declaration_command_sha256, declaration_command_json, authority_json,
          terminal_principal_key, terminal_operation_id, terminal_command_sha256,
          terminal_command_json, outcome_option_id, result_json, created_at, updated_at
        ) VALUES (?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).run(
        id, value.requestKind, text(value.canonicalItemId, 'canonical item ID', 200),
        digest(value.canonicalDefinitionSha256, 'canonical definition SHA-256'),
        text(value.declarationPrincipalKey, 'declaration principal key', 160),
        value.actorKind, text(value.actorSlug, 'actor slug', 200),
        value.targetKind, text(value.targetSlug, 'target slug', 200), itemOperationId,
        declarationOperationId, itemGuidedDeclarationCommandSha256(declarationCommand),
        stringifyStoredDocument(declarationCommand), stringifyStoredDocument(authority),
        createdAt, createdAt,
      )
      return repository.get(id) ?? (() => { throw new Error(`Guided request ${id} disappeared after creation.`) })()
    }),
    settle: value => database.withTransaction(() => {
      const id = requestId(value.requestId, 'guided request ID')
      const parsedCommand = parseItemGuidedAdjudicationCommand(value.command)
      if (parsedCommand.action === 'declare-re-breather') throw new Error('Guided settlement requires a terminal command.')
      const command: ItemGuidedTerminalCommandV1 = parsedCommand
      if (command.requestId !== id || command.expectedRevision !== value.expectedRevision
        || (value.status === 'accepted') !== (command.action === 'resolve')
        || (value.status === 'cancelled') !== (command.action === 'cancel')) throw new Error('Guided terminal command does not match its requested settlement.')
      if (value.result.schemaVersion !== 1 || value.result.status !== value.status
        || (value.status === 'cancelled' && value.result.acceptedSummary !== null)) throw new Error('Guided terminal result does not match its settlement.')
      const existing = repository.get(id) ?? (() => { throw new Error(`Guided request ${id} does not exist.`) })()
      if (existing.status !== 'pending' || existing.revision !== value.expectedRevision) return { kind: 'stale' as const, record: existing }
      const updatedAt = parseStoredTimestamp(value.updatedAt ?? now(), 'guided request updatedAt')
      const change = database.connection.prepare(`
        UPDATE item_guided_requests
        SET status = ?, revision = 1, terminal_principal_key = ?, terminal_operation_id = ?,
          terminal_command_sha256 = ?, terminal_command_json = ?, outcome_option_id = ?,
          result_json = ?, updated_at = ?
        WHERE request_id = ? AND status = 'pending' AND revision = ?
      `).run(
        value.status, text(value.terminalPrincipalKey, 'terminal principal key', 160),
        command.operationId, itemGuidedCommandSha256(command), stringifyStoredDocument(command),
        value.outcomeOptionId === null ? null : text(value.outcomeOptionId, 'outcome option ID', 200),
        stringifyStoredDocument(value.result), updatedAt, id, value.expectedRevision,
      )
      const record = repository.get(id) ?? (() => { throw new Error(`Guided request ${id} disappeared during settlement.`) })()
      return { kind: Number(change.changes) === 1 ? 'applied' as const : 'stale' as const, record }
    }),
  }
  return repository
}
