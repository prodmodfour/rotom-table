import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { parseBreedingOperationCommandV1, type AdvanceCampaignClockPayloadV1, type BreedingCampaignClockScopeV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { CampaignOperationExecutionDecision } from '#shared/campaignOperations'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash, createBreedingOperationRejectedV1 } from '../domain/breeding/operations'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord, type BreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { executeCampaignOperation } from './executeCampaignOperation'

export interface AdvanceBreedingCampaignClockOptions {
  readonly database?: RotomDatabase
  readonly operationRepository?: BreedingOperationRepository
  readonly clockRepository?: CampaignClockRepository
  readonly resumePending?: boolean
  /** Internal BR-052 capability; only the audited batch coordinator may enable dependent Egg scopes. */
  readonly dependentEggBatchAuthority?: 'validated-by-campaign-clock-batch-v1'
  /** Failure-injection hook proving clock mutation and operation settlement atomicity. */
  readonly beforeSettle?: () => void
}
export class CampaignClockCommandError extends Error {
  readonly code: 'campaign-clock.wrong-command' | 'campaign-clock.stale-ruleset' | 'campaign-clock.unsupported-scope' | 'campaign-clock.repository-mismatch'
  constructor(code: CampaignClockCommandError['code'], message: string) { super(message); this.name = 'CampaignClockCommandError'; this.code = code }
}
const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const clockRef = (revision: number) => Object.freeze({ kind: 'campaign-clock' as const, id: 'campaign-clock', revision })
const commandParts = (value: unknown, dependentEggBatchAuthority?: 'validated-by-campaign-clock-batch-v1'): { readonly command: BreedingOperationCommandV1, readonly scope: BreedingCampaignClockScopeV1, readonly payload: AdvanceCampaignClockPayloadV1 } => {
  const command = parseBreedingOperationCommandV1(value)
  if (command.commandKind !== 'advance-campaign-clock') throw new CampaignClockCommandError('campaign-clock.wrong-command', 'Campaign clock service accepts only advance-campaign-clock commands.')
  if (command.ruleset.rulesetId !== ruleset.rulesetId || command.ruleset.definitionSha256 !== ruleset.definitionSha256) throw new CampaignClockCommandError('campaign-clock.stale-ruleset', 'Campaign clock command must bind the current app-owned breeding ruleset.')
  const validBaseScopes = command.scopes.length === 1 && command.scopes[0]?.kind === 'campaign-clock'
  const validEggBatchScopes = dependentEggBatchAuthority === 'validated-by-campaign-clock-batch-v1'
    && command.scopes.length >= 1 && command.scopes.length <= 101
    && command.scopes[0]?.kind === 'campaign-clock'
    && command.scopes.slice(1).every(scope => scope.kind === 'pokemon-egg' && scope.expectedRevision !== null)
  if (!validBaseScopes && !validEggBatchScopes) throw new CampaignClockCommandError('campaign-clock.unsupported-scope', 'Clock advancement accepts dependent Egg scopes only through the audited bounded batch coordinator.')
  return Object.freeze({ command, scope: command.scopes[0] as BreedingCampaignClockScopeV1, payload: command.payload })
}
export const advanceBreedingCampaignClock = (
  commandInput: unknown,
  options: AdvanceBreedingCampaignClockOptions = {},
): CampaignOperationExecutionDecision<BreedingOperationLedgerRecord> => {
  const parts = commandParts(commandInput, options.dependentEggBatchAuthority)
  const database = options.database ?? options.operationRepository?.database ?? options.clockRepository?.database ?? getRotomDatabase()
  const operationRepository = options.operationRepository ?? createSqliteBreedingOperationRepository(database)
  const clockRepository = options.clockRepository ?? createSqliteCampaignClockRepository(database)
  if (operationRepository.database !== database || clockRepository.database !== database) throw new CampaignClockCommandError('campaign-clock.repository-mismatch', 'Clock and operation repositories must share one coordinator database connection.')
  const createdAtCampaignMinute = clockRepository.get().campaignMinute
  return executeCampaignOperation({
    repository: operationRepository,
    command: parts.command,
    createdAtCampaignMinute,
    settledAtCampaignMinute: () => clockRepository.get().campaignMinute,
    ...(options.resumePending === true ? { resumePending: true } : {}),
    execute: canonical => {
      const current = clockRepository.get()
      const commandHash = createBreedingOperationCommandHash(canonical)
      const canonicalScope = canonical.scopes[0] as BreedingCampaignClockScopeV1
      const payload = canonical.payload as AdvanceCampaignClockPayloadV1
      if (canonicalScope.expectedRevision !== current.revision || payload.targetCampaignMinute < current.campaignMinute) return createBreedingOperationRejectedV1({
        operationId: canonical.operationId, commandHash, commandKind: 'advance-campaign-clock', reasonId: 'breeding.operation.stale-revision',
        currentAggregateRefs: [clockRef(current.revision)], conflictingScopes: [canonicalScope],
      })
      if (payload.targetCampaignMinute === current.campaignMinute) return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId, commandHash, commandKind: 'advance-campaign-clock', outcomeKind: 'clock-advanced',
        aggregateRefs: [clockRef(current.revision)], changedScopes: [], committedAtCampaignMinute: current.campaignMinute,
      })
      const advanced = clockRepository.advance({ expectedRevision: canonicalScope.expectedRevision, targetCampaignMinute: payload.targetCampaignMinute, operationId: canonical.operationId })
      if (advanced.kind === 'stale') return createBreedingOperationRejectedV1({
        operationId: canonical.operationId, commandHash, commandKind: 'advance-campaign-clock', reasonId: 'breeding.operation.conflict',
        currentAggregateRefs: [clockRef(advanced.clock.revision)], conflictingScopes: [canonicalScope],
      })
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId, commandHash, commandKind: 'advance-campaign-clock', outcomeKind: 'clock-advanced',
        aggregateRefs: [clockRef(advanced.clock.revision)], changedScopes: [canonicalScope], committedAtCampaignMinute: advanced.clock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: () => options.beforeSettle?.() } : {}),
  })
}
