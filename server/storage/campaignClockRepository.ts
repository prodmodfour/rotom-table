import { parseBreedingOperationIdSyntax, type BreedingOperationId } from '#shared/breeding/ids'
import { createCampaignClockSuccessorV1, parseCampaignClockV1, type CampaignClockV1 } from '#shared/campaignClock'
import { getRotomDatabase, type RotomDatabase } from './database'
import { BreedingRepositoryCorruptionError, parseBreedingRepositoryCampaignMinute, parseBreedingRepositoryRevision } from './breedingRepositorySupport'

export type CampaignClockAdvanceResult =
  | { readonly kind: 'applied', readonly clock: CampaignClockV1 }
  | { readonly kind: 'exact-replay', readonly clock: CampaignClockV1 }
  | { readonly kind: 'stale', readonly expectedRevision: number, readonly clock: CampaignClockV1 }
export interface CampaignClockRepository {
  readonly database: RotomDatabase
  get(): CampaignClockV1
  advance(input: { readonly expectedRevision: number, readonly targetCampaignMinute: number, readonly operationId: BreedingOperationId | string }): CampaignClockAdvanceResult
}
interface ClockRow { readonly singleton: unknown, readonly revision: unknown, readonly campaign_minute: unknown, readonly last_operation_id: unknown }
export class CampaignClockRepositoryTransactionError extends Error {
  constructor() { super('Campaign clock advancement requires a caller-owned SQLite transaction.'); this.name = 'CampaignClockRepositoryTransactionError' }
}
const rowToClock = (row: ClockRow): CampaignClockV1 => {
  if (row.singleton !== 1) throw new BreedingRepositoryCorruptionError('campaign_clock', 'singleton', 'singleton identity')
  let revision: number; let campaignMinute: number
  try {
    revision = parseBreedingRepositoryRevision(row.revision, 'campaign_clock.revision')
    campaignMinute = parseBreedingRepositoryCampaignMinute(row.campaign_minute, 'campaign_clock.campaign_minute')
  }
  catch { throw new BreedingRepositoryCorruptionError('campaign_clock', 'singleton', 'revision or campaign minute') }
  const lastOperationId = row.last_operation_id === null ? null : parseBreedingOperationIdSyntax(row.last_operation_id)
  if (row.last_operation_id !== null && !lastOperationId) throw new BreedingRepositoryCorruptionError('campaign_clock', 'singleton', 'last_operation_id')
  try { return parseCampaignClockV1({ schemaVersion: 1, revision, campaignMinute, lastOperationId }) }
  catch { throw new BreedingRepositoryCorruptionError('campaign_clock', 'singleton', 'clock invariant') }
}
export const createSqliteCampaignClockRepository = (database: RotomDatabase = getRotomDatabase()): CampaignClockRepository => {
  const get = (): CampaignClockV1 => {
    const rows = database.connection.prepare('SELECT singleton, revision, campaign_minute, last_operation_id FROM campaign_clock ORDER BY singleton').all() as unknown as ClockRow[]
    if (rows.length !== 1) throw new BreedingRepositoryCorruptionError('campaign_clock', 'singleton', 'exactly one row')
    return rowToClock(rows[0]!)
  }
  const advance = (input: { readonly expectedRevision: number, readonly targetCampaignMinute: number, readonly operationId: BreedingOperationId | string }): CampaignClockAdvanceResult => {
    if (!database.connection.isTransaction) throw new CampaignClockRepositoryTransactionError()
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const targetCampaignMinute = parseBreedingRepositoryCampaignMinute(input.targetCampaignMinute, 'targetCampaignMinute')
    const operationId = parseBreedingOperationIdSyntax(input.operationId) ?? (() => { throw new Error('operationId must be a breeding operation ID.') })()
    const current = get()
    if (current.lastOperationId === operationId && current.revision === expectedRevision + 1 && current.campaignMinute === targetCampaignMinute) return Object.freeze({ kind: 'exact-replay', clock: current })
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'stale', expectedRevision, clock: current })
    const successor = createCampaignClockSuccessorV1({ current, targetCampaignMinute, operationId })
    const result = database.connection.prepare(`
      UPDATE campaign_clock SET revision = ?, campaign_minute = ?, last_operation_id = ?
      WHERE singleton = 1 AND revision = ? AND campaign_minute = ?
    `).run(successor.revision, successor.campaignMinute, successor.lastOperationId, current.revision, current.campaignMinute)
    if (Number(result.changes) !== 1) return Object.freeze({ kind: 'stale', expectedRevision, clock: get() })
    return Object.freeze({ kind: 'applied', clock: get() })
  }
  return Object.freeze({ database, get, advance })
}
