import {
  parsePendingAbilityResolution,
  type PendingAbilityRead,
  type PendingAbilityResolution,
} from '#shared/abilityAutomation/pendingResolution'

export interface PendingAbilityResolutionTransaction {
  readonly findByOperationId: (operationId: string) => unknown | null
  readonly findByResolutionId: (resolutionId: string) => unknown | null
  /** Revisions after any reservation/pending-summary write staged in this transaction. */
  readonly revisionFor: (read: PendingAbilityRead) => number | null
  readonly insert: (resolution: PendingAbilityResolution) => void
}

export interface PendingAbilityResolutionStore {
  readonly transaction: <Result>(
    callback: (transaction: PendingAbilityResolutionTransaction) => Result,
  ) => Result
}

export interface PersistPendingAbilityResolutionResult {
  readonly status: 'created' | 'duplicate'
  readonly resolution: PendingAbilityResolution
}

export type PendingAbilityPersistenceErrorCode =
  | 'operation-id-conflict'
  | 'resolution-id-conflict'
  | 'stale-read'

export class PendingAbilityPersistenceError extends Error {
  constructor(
    readonly code: PendingAbilityPersistenceErrorCode,
    readonly read: PendingAbilityRead | null,
    detail: string,
  ) {
    super(detail)
    this.name = 'PendingAbilityPersistenceError'
  }
}

const readKey = (read: PendingAbilityRead): string => read.kind === 'sheet'
  ? `sheet:${read.sheetKind}:${read.slug}`
  : `${read.kind}:${read.slug}`

/** Revalidate the complete private read set before create or resume. */
export const assertPendingAbilityResolutionReads = (
  resolutionValue: unknown,
  revisionFor: (read: PendingAbilityRead) => number | null,
): PendingAbilityResolution => {
  const resolution = parsePendingAbilityResolution(resolutionValue)
  for (const read of resolution.readSet) {
    const current = revisionFor(read)
    if (current === null || current !== read.revision) {
      throw new PendingAbilityPersistenceError(
        'stale-read',
        read,
        `Pending ability read ${readKey(read)} expected revision ${read.revision}; received ${current ?? 'missing'}.`,
      )
    }
  }
  return resolution
}

/**
 * Insert the private pending record in the store's physical transaction.
 * The caller stages resource reservations and the public pending summary in
 * that same transaction before this function observes post-stage revisions.
 */
export const persistPendingAbilityResolution = (
  resolutionValue: unknown,
  store: PendingAbilityResolutionStore,
): PersistPendingAbilityResolutionResult => {
  const resolution = parsePendingAbilityResolution(resolutionValue)
  return store.transaction((transaction) => {
    const operationRecord = transaction.findByOperationId(resolution.operationId)
    if (operationRecord !== null) {
      const existing = parsePendingAbilityResolution(operationRecord)
      if (existing.requestSha256 === resolution.requestSha256
        && existing.resolutionId === resolution.resolutionId) {
        return Object.freeze({ status: 'duplicate', resolution: existing })
      }
      throw new PendingAbilityPersistenceError(
        'operation-id-conflict',
        null,
        'Pending ability operation ID already belongs to a different request.',
      )
    }
    if (transaction.findByResolutionId(resolution.resolutionId) !== null) {
      throw new PendingAbilityPersistenceError(
        'resolution-id-conflict',
        null,
        'Pending ability resolution ID is already in use.',
      )
    }
    assertPendingAbilityResolutionReads(resolution, transaction.revisionFor)
    transaction.insert(resolution)
    return Object.freeze({ status: 'created', resolution })
  })
}
