import type {
  CampaignOperationExecutionDecision,
  CampaignOperationLedgerAdapter,
} from '#shared/campaignOperations'
import type { RotomDatabase } from '../storage/database'

export interface TransactionalCampaignOperationLedgerAdapter<Command, Result, Record>
  extends CampaignOperationLedgerAdapter<Command, Result, Record> {
  readonly database: RotomDatabase
}
export interface ExecuteCampaignOperationInput<Command, Result, Record> {
  readonly repository: TransactionalCampaignOperationLedgerAdapter<Command, Result, Record>
  readonly command: unknown
  readonly createdAtCampaignMinute: number
  readonly settledAtCampaignMinute: number | (() => number)
  readonly resumePending?: boolean
  readonly execute: (command: Command, record: Record) => Result
  /** Failure-injection hook proving aggregate writes and terminal settlement are atomic. */
  readonly beforeSettle?: (result: Result) => void
}
export class CampaignOperationPendingError extends Error {
  constructor() { super('A pending campaign operation may be resumed only through an authorized recovery path.'); this.name = 'CampaignOperationPendingError' }
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
let savepointOrdinal = 0
const nextSavepoint = (): string => `campaign_operation_execute_${savepointOrdinal = (savepointOrdinal + 1) % 1_000_000}`
const minute = (value: number | (() => number)): number => typeof value === 'function' ? value() : value

/**
 * Neutral two-phase campaign-operation coordinator.
 *
 * Reservation commits before mechanics when called at top level, so a crash leaves
 * recoverable pending evidence. Aggregate writes and the terminal result then share
 * one caller-owned SQLite transaction and savepoint. Exact retries never call execute.
 */
export const executeCampaignOperation = <Command, Result, Record>(
  input: ExecuteCampaignOperationInput<Command, Result, Record>,
): CampaignOperationExecutionDecision<Record> => {
  const { repository } = input
  const reservation = repository.database.withTransaction(() => repository.reserve(input.command, input.createdAtCampaignMinute))
  if (reservation.kind === 'exact-retry') return Object.freeze({ kind: 'exact-retry', record: reservation.record })
  if (reservation.kind === 'pending' && input.resumePending !== true) return Object.freeze({ kind: 'pending', record: reservation.record })

  return repository.database.withTransaction(() => {
    const current = repository.reserve(input.command, input.createdAtCampaignMinute)
    if (current.kind === 'exact-retry') return Object.freeze({ kind: 'exact-retry' as const, record: current.record })
    if (current.kind === 'reserved') throw new CampaignOperationPendingError()
    const savepoint = nextSavepoint()
    repository.database.connection.exec(`SAVEPOINT ${savepoint}`)
    try {
      const result = input.execute(current.record.command as Command, current.record)
      if (promiseLike(result)) throw new Error('Campaign operation executors must be synchronous.')
      input.beforeSettle?.(result)
      const settlement = repository.settle(current.record.command as Command, result, minute(input.settledAtCampaignMinute))
      repository.database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return Object.freeze({ kind: settlement.kind === 'settled' ? 'executed' as const : 'exact-retry' as const, record: settlement.record })
    }
    catch (error) {
      repository.database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      repository.database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      throw error
    }
  })
}
