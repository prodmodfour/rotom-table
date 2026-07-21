import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_REACTION_AVAILABILITY_SCHEMA_VERSION = 1 as const
export const ABILITY_REACTION_AVAILABILITY_POOL = 'interrupt-reaction' as const
export const ABILITY_REACTION_AVAILABILITY_LIMITS = Object.freeze({
  entries: 512,
  receipts: 2_048,
  identifierLength: 200,
  sequence: 10_000_000,
})

export interface AbilityReactionAvailabilityEntry {
  readonly ownerPlacementId: string
  readonly pool: typeof ABILITY_REACTION_AVAILABILITY_POOL
  readonly spentByOperationId: string
}

export interface AbilityReactionAvailabilityReceipt {
  readonly operationId: string
  readonly ownerPlacementId: string
  readonly pool: typeof ABILITY_REACTION_AVAILABILITY_POOL
  readonly sceneId: string
  readonly roundId: string
  readonly roundSequence: number
}

export interface AbilityReactionAvailabilityLedger {
  readonly schemaVersion: typeof ABILITY_REACTION_AVAILABILITY_SCHEMA_VERSION
  readonly sceneId: string | null
  readonly roundId: string | null
  readonly roundSequence: number | null
  readonly entries: readonly AbilityReactionAvailabilityEntry[]
  readonly receipts: readonly AbilityReactionAvailabilityReceipt[]
}

export class AbilityReactionAvailabilityValidationError extends Error {
  constructor(readonly code: 'invalid-ledger' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityReactionAvailabilityValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sceneId', 'roundId', 'roundSequence', 'entries', 'receipts'] as const
const ENTRY_FIELDS = ['ownerPlacementId', 'pool', 'spentByOperationId'] as const
const RECEIPT_FIELDS = ['operationId', 'ownerPlacementId', 'pool', 'sceneId', 'roundId', 'roundSequence'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityReactionAvailabilityValidationError['code'], path: string, detail: string): never => {
  throw new AbilityReactionAvailabilityValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-ledger', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-ledger', path, 'has invalid shape.')
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0
    || value.length > ABILITY_REACTION_AVAILABILITY_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-ledger', path, 'must be a stable ID.')
  return value as string
}
const sequence = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0
    || Number(value) > ABILITY_REACTION_AVAILABILITY_LIMITS.sequence) {
    fail('invalid-ledger', path, 'must be a bounded sequence.')
  }
  return Number(value)
}

export const createEmptyAbilityReactionAvailabilityLedger = (): AbilityReactionAvailabilityLedger => deepFreezeStrictJson({
  schemaVersion: ABILITY_REACTION_AVAILABILITY_SCHEMA_VERSION,
  sceneId: null,
  roundId: null,
  roundSequence: null,
  entries: [],
  receipts: [],
})

export interface AbilityReactionRoundCursor {
  readonly sceneId: string
  readonly roundId: string
  readonly roundSequence: number
}

export const parseAbilityReactionAvailabilityLedger = (
  value: unknown,
  path = 'abilityReactionAvailability',
): AbilityReactionAvailabilityLedger => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 6, nodes: 32_768, objectFields: 12, arrayEntries: ABILITY_REACTION_AVAILABILITY_LIMITS.receipts, stringLength: 200, objectKeyLength: 200 },
    rootLabel: 'ability reaction availability ledger', valueLabel: 'ability reaction availability values',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_REACTION_AVAILABILITY_SCHEMA_VERSION) {
    fail('invalid-ledger', `${path}.schemaVersion`, 'is unsupported.')
  }
  const sceneId = input.sceneId === null ? null : stableId(input.sceneId, `${path}.sceneId`)
  const roundId = input.roundId === null ? null : stableId(input.roundId, `${path}.roundId`)
  const roundSequence = input.roundSequence === null ? null : sequence(input.roundSequence, `${path}.roundSequence`)
  if ((roundId === null) !== (roundSequence === null)
    || (sceneId === null && roundId !== null)) {
    fail('invalid-ledger', path, 'a round requires a scene and a complete cursor.')
  }
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_REACTION_AVAILABILITY_LIMITS.entries) {
    fail('limit-exceeded', `${path}.entries`, 'must be bounded.')
  }
  const entries = (input.entries as readonly unknown[]).map((entry, index): AbilityReactionAvailabilityEntry => {
    const entryPath = `${path}.entries[${index}]`
    const item = record(entry, entryPath)
    exact(item, ENTRY_FIELDS, entryPath)
    if (item.pool !== ABILITY_REACTION_AVAILABILITY_POOL) fail('invalid-ledger', `${entryPath}.pool`, 'is unsupported.')
    return Object.freeze({
      ownerPlacementId: stableId(item.ownerPlacementId, `${entryPath}.ownerPlacementId`),
      pool: ABILITY_REACTION_AVAILABILITY_POOL,
      spentByOperationId: stableId(item.spentByOperationId, `${entryPath}.spentByOperationId`),
    })
  })
  if (new Set(entries.map(entry => entry.ownerPlacementId)).size !== entries.length) {
    fail('duplicate-id', `${path}.entries`, 'must not repeat owners in one round.')
  }
  if (!Array.isArray(input.receipts) || input.receipts.length > ABILITY_REACTION_AVAILABILITY_LIMITS.receipts) {
    fail('limit-exceeded', `${path}.receipts`, 'must be bounded.')
  }
  const receipts = (input.receipts as readonly unknown[]).map((entry, index): AbilityReactionAvailabilityReceipt => {
    const receiptPath = `${path}.receipts[${index}]`
    const item = record(entry, receiptPath)
    exact(item, RECEIPT_FIELDS, receiptPath)
    if (item.pool !== ABILITY_REACTION_AVAILABILITY_POOL) fail('invalid-ledger', `${receiptPath}.pool`, 'is unsupported.')
    return Object.freeze({
      operationId: stableId(item.operationId, `${receiptPath}.operationId`),
      ownerPlacementId: stableId(item.ownerPlacementId, `${receiptPath}.ownerPlacementId`),
      pool: ABILITY_REACTION_AVAILABILITY_POOL,
      sceneId: stableId(item.sceneId, `${receiptPath}.sceneId`),
      roundId: stableId(item.roundId, `${receiptPath}.roundId`),
      roundSequence: sequence(item.roundSequence, `${receiptPath}.roundSequence`),
    })
  })
  if (new Set(receipts.map(receipt => receipt.operationId)).size !== receipts.length) {
    fail('duplicate-id', `${path}.receipts`, 'must not repeat operation IDs.')
  }
  if (entries.length > 0 && sceneId === null) fail('invalid-ledger', path, 'entries require an active round.')
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_REACTION_AVAILABILITY_SCHEMA_VERSION,
    sceneId,
    roundId,
    roundSequence,
    entries: Object.freeze(entries),
    receipts: Object.freeze(receipts),
  })
}

export const advanceAbilityReactionAvailabilityRound = (
  ledgerValue: unknown,
  cursor: AbilityReactionRoundCursor,
): AbilityReactionAvailabilityLedger => {
  const ledger = parseAbilityReactionAvailabilityLedger(ledgerValue)
  const sceneId = stableId(cursor.sceneId, 'abilityReactionCursor.sceneId')
  const roundId = stableId(cursor.roundId, 'abilityReactionCursor.roundId')
  const roundSequence = sequence(cursor.roundSequence, 'abilityReactionCursor.roundSequence')
  if (ledger.sceneId !== null && ledger.sceneId !== sceneId) {
    fail('invalid-ledger', 'abilityReactionCursor.sceneId', 'requires an explicit scene transition.')
  }
  if (ledger.roundSequence !== null && roundSequence < ledger.roundSequence) {
    fail('invalid-ledger', 'abilityReactionCursor.roundSequence', 'cannot regress.')
  }
  if (ledger.roundSequence === roundSequence && ledger.roundId !== roundId) {
    fail('invalid-ledger', 'abilityReactionCursor.roundId', 'cannot change at the same sequence.')
  }
  if (ledger.sceneId === sceneId && ledger.roundId === roundId
    && ledger.roundSequence === roundSequence) return ledger
  return parseAbilityReactionAvailabilityLedger({
    ...ledger,
    sceneId,
    roundId,
    roundSequence,
    entries: [],
  })
}

export const beginAbilityReactionAvailabilityScene = (
  ledgerValue: unknown,
  sceneIdValue: string,
): AbilityReactionAvailabilityLedger => {
  const ledger = parseAbilityReactionAvailabilityLedger(ledgerValue)
  const sceneId = stableId(sceneIdValue, 'abilityReactionScene.sceneId')
  if (ledger.sceneId === sceneId) return ledger
  return parseAbilityReactionAvailabilityLedger({
    ...createEmptyAbilityReactionAvailabilityLedger(),
    sceneId,
    roundId: null,
    roundSequence: null,
  })
}

export const isAbilityReactionAvailabilityReady = (
  ledgerValue: unknown,
  ownerPlacementIdValue: string,
): boolean => {
  const ledger = parseAbilityReactionAvailabilityLedger(ledgerValue)
  const ownerPlacementId = stableId(ownerPlacementIdValue, 'abilityReactionOwner.placementId')
  return ledger.roundId !== null
    && !ledger.entries.some(entry => entry.ownerPlacementId === ownerPlacementId)
}
