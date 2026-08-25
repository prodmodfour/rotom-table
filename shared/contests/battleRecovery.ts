import type { ContestCorrectionReceiptV1 } from './document'

export const BATTLE_CONTEST_RECOVERY_SCHEMA_VERSION = 1 as const

export const BATTLE_CONTEST_RECOVERY_KINDS = Object.freeze([
  'pause',
  'resume',
  'correction',
  'cancel',
] as const)
export type BattleContestRecoveryKindV1 = typeof BATTLE_CONTEST_RECOVERY_KINDS[number]

export interface BattleContestRecoveryReceiptV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_RECOVERY_SCHEMA_VERSION
  readonly receiptId: string
  readonly operationId: string
  readonly linkId: string
  readonly kind: BattleContestRecoveryKindV1
  readonly correctionKind: ContestCorrectionReceiptV1['kind'] | null
  readonly correctionTargetPerformerId: string | null
  readonly contestRevisionBefore: number
  readonly contestRevisionAfter: number
  readonly encounterDocumentRevisionBefore: number
  readonly encounterDocumentRevisionAfter: number
  readonly encounterMapRevision: number
  readonly encounterSceneId: string
  readonly contestPausedBefore: boolean
  readonly contestPausedAfter: boolean
  readonly encounterLifecycleBefore: 'active' | 'paused'
  readonly encounterLifecycleAfter: 'active' | 'paused'
  readonly intentSha256: string
  readonly createdAt: number
}

export class BattleContestRecoveryContractError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BattleContestRecoveryContractError'
  }
}

const fail = (path: string, message: string): never => { throw new BattleContestRecoveryContractError(path, message) }
const record = (value: unknown, path: string): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(path, 'must be an object')
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `must contain exactly ${fields.join(', ')}`)
}
const id = (value: unknown, path: string): string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u.test(value) ? value : fail(path, 'must be a stable bounded ID')
const sha256 = (value: unknown, path: string): string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : fail(path, 'must be a lowercase SHA-256 digest')
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail(path, 'must be a non-negative safe integer')
const boolean = (value: unknown, path: string): boolean => typeof value === 'boolean' ? value : fail(path, 'must be boolean')
const nullableId = (value: unknown, path: string): string | null => value === null ? null : id(value, path)

const CORRECTION_KINDS = Object.freeze([
  'appeal-delta', 'fumble-delta', 'voltage-delta', 'dice-pool-delta', 'controller-reassignment', 'cancel-contest',
] as const)

export const parseBattleContestRecoveryReceipt = (value: unknown): BattleContestRecoveryReceiptV1 => {
  const row = record(value, 'battleRecoveryReceipt')
  exact(row, [
    'schemaVersion', 'receiptId', 'operationId', 'linkId', 'kind', 'correctionKind', 'correctionTargetPerformerId',
    'contestRevisionBefore', 'contestRevisionAfter', 'encounterDocumentRevisionBefore', 'encounterDocumentRevisionAfter',
    'encounterMapRevision', 'encounterSceneId', 'contestPausedBefore', 'contestPausedAfter',
    'encounterLifecycleBefore', 'encounterLifecycleAfter', 'intentSha256', 'createdAt',
  ], 'battleRecoveryReceipt')
  if (row.schemaVersion !== BATTLE_CONTEST_RECOVERY_SCHEMA_VERSION) fail('battleRecoveryReceipt.schemaVersion', 'must be 1')
  if (!BATTLE_CONTEST_RECOVERY_KINDS.includes(row.kind as BattleContestRecoveryKindV1)) fail('battleRecoveryReceipt.kind', 'is unsupported')
  const kind = row.kind as BattleContestRecoveryKindV1
  const correctionKind = row.correctionKind === null ? null : CORRECTION_KINDS.includes(row.correctionKind as ContestCorrectionReceiptV1['kind']) ? row.correctionKind as ContestCorrectionReceiptV1['kind'] : fail('battleRecoveryReceipt.correctionKind', 'is unsupported')
  if ((kind === 'correction') !== (correctionKind !== null && correctionKind !== 'cancel-contest')) fail('battleRecoveryReceipt.correctionKind', 'must identify exactly one non-cancellation correction')
  if (kind === 'cancel' && correctionKind !== null && correctionKind !== 'cancel-contest') fail('battleRecoveryReceipt.correctionKind', 'may identify only cancel-contest for cancellation')
  if ((kind === 'pause' || kind === 'resume') && correctionKind !== null) fail('battleRecoveryReceipt.correctionKind', 'must be null for pause and resume')
  const correctionTargetPerformerId = nullableId(row.correctionTargetPerformerId, 'battleRecoveryReceipt.correctionTargetPerformerId')
  if ((correctionKind === 'voltage-delta') !== (correctionTargetPerformerId !== null)) fail('battleRecoveryReceipt.correctionTargetPerformerId', 'must identify exactly one Pokémon for a Battle Voltage correction')
  const contestRevisionBefore = integer(row.contestRevisionBefore, 'battleRecoveryReceipt.contestRevisionBefore')
  const contestRevisionAfter = integer(row.contestRevisionAfter, 'battleRecoveryReceipt.contestRevisionAfter')
  const encounterDocumentRevisionBefore = integer(row.encounterDocumentRevisionBefore, 'battleRecoveryReceipt.encounterDocumentRevisionBefore')
  const encounterDocumentRevisionAfter = integer(row.encounterDocumentRevisionAfter, 'battleRecoveryReceipt.encounterDocumentRevisionAfter')
  if (contestRevisionAfter !== contestRevisionBefore + 1) fail('battleRecoveryReceipt.contestRevisionAfter', 'must advance exactly one revision')
  if (encounterDocumentRevisionAfter !== encounterDocumentRevisionBefore + 1) fail('battleRecoveryReceipt.encounterDocumentRevisionAfter', 'must advance exactly one revision')
  const contestPausedBefore = boolean(row.contestPausedBefore, 'battleRecoveryReceipt.contestPausedBefore')
  const contestPausedAfter = boolean(row.contestPausedAfter, 'battleRecoveryReceipt.contestPausedAfter')
  const encounterLifecycleBefore = row.encounterLifecycleBefore === 'active' || row.encounterLifecycleBefore === 'paused' ? row.encounterLifecycleBefore : fail('battleRecoveryReceipt.encounterLifecycleBefore', 'must be active or paused')
  const encounterLifecycleAfter = row.encounterLifecycleAfter === 'active' || row.encounterLifecycleAfter === 'paused' ? row.encounterLifecycleAfter : fail('battleRecoveryReceipt.encounterLifecycleAfter', 'must be active or paused')
  if (kind === 'pause' && (contestPausedBefore || !contestPausedAfter || encounterLifecycleBefore !== 'active' || encounterLifecycleAfter !== 'paused')) fail('battleRecoveryReceipt', 'pause must atomically move both authorities into paused state')
  if (kind === 'resume' && (!contestPausedBefore || contestPausedAfter || encounterLifecycleBefore !== 'paused' || encounterLifecycleAfter !== 'active')) fail('battleRecoveryReceipt', 'resume must atomically move both authorities into active state')
  if (kind === 'correction' && (!contestPausedBefore || !contestPausedAfter || encounterLifecycleBefore !== 'paused' || encounterLifecycleAfter !== 'paused')) fail('battleRecoveryReceipt', 'a bounded correction requires both authorities to remain paused')
  if (kind === 'cancel' && (contestPausedAfter || encounterLifecycleAfter !== 'paused')) fail('battleRecoveryReceipt', 'cancellation must close Contest play and retain the linked Encounter at a safe paused boundary')
  return Object.freeze({
    schemaVersion: BATTLE_CONTEST_RECOVERY_SCHEMA_VERSION,
    receiptId: id(row.receiptId, 'battleRecoveryReceipt.receiptId'),
    operationId: id(row.operationId, 'battleRecoveryReceipt.operationId'),
    linkId: id(row.linkId, 'battleRecoveryReceipt.linkId'),
    kind,
    correctionKind,
    correctionTargetPerformerId,
    contestRevisionBefore,
    contestRevisionAfter,
    encounterDocumentRevisionBefore,
    encounterDocumentRevisionAfter,
    encounterMapRevision: integer(row.encounterMapRevision, 'battleRecoveryReceipt.encounterMapRevision'),
    encounterSceneId: id(row.encounterSceneId, 'battleRecoveryReceipt.encounterSceneId'),
    contestPausedBefore,
    contestPausedAfter,
    encounterLifecycleBefore,
    encounterLifecycleAfter,
    intentSha256: sha256(row.intentSha256, 'battleRecoveryReceipt.intentSha256'),
    createdAt: integer(row.createdAt, 'battleRecoveryReceipt.createdAt'),
  })
}

export const parseBattleContestRecoveryReceipts = (value: unknown, path = 'battleRecoveryReceipts'): readonly BattleContestRecoveryReceiptV1[] => {
  if (!Array.isArray(value) || value.length > 10_000) fail(path, 'must be a bounded array')
  const entries = value as unknown[]
  const receipts: BattleContestRecoveryReceiptV1[] = entries.map((entry: unknown, index: number) => {
    try { return parseBattleContestRecoveryReceipt(entry) }
    catch (error) { return fail(`${path}[${index}]`, error instanceof Error ? error.message : 'is invalid') }
  })
  for (const identity of ['receiptId', 'operationId'] as const) if (new Set(receipts.map(receipt => receipt[identity])).size !== receipts.length) fail(path, `must use unique ${identity} values`)
  for (let index = 1; index < receipts.length; index += 1) {
    const before = receipts[index - 1]!, current = receipts[index]!
    if (current.contestRevisionBefore < before.contestRevisionAfter
      || current.encounterDocumentRevisionBefore < before.encounterDocumentRevisionAfter
      || current.encounterMapRevision < before.encounterMapRevision
      || current.createdAt < before.createdAt) fail(`${path}[${index}]`, 'must follow monotonic linked authority')
  }
  return Object.freeze(receipts)
}
