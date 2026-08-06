import { createHash } from 'node:crypto'
import speciesAcquisitionContractJson from '../../../data/breeding-automation/species-acquisition-reward-contract.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingSpeciesAcquisitionArchiveRecordV1 } from '#shared/breeding/archives'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { TrainerSpeciesAcquisitionRewardResult } from '../../useCases/recordTrainerSpeciesAcquisition'
import { parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1 } from './archives'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const BREEDING_HATCH_SPECIES_ACQUISITION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-hatch-species-acquisition-v1' as const,
  identity: Object.freeze(['trainerSheetSlug', 'speciesId'] as const),
  firstHistory: Object.freeze({ sourceKind: 'hatch' as const, sourceEggRequired: true, dexExpReward: 1 as const }),
  existingHistory: Object.freeze({ preserveFirstFacts: true as const, dexExpReward: 0 as const }),
  rosterRemoval: 'history-remains-authoritative' as const,
  dexExpInference: 'forbidden' as const,
  exactReplay: 'terminal-hatch-bypass-no-service-reexecution' as const,
  transaction: 'same-BR-057-phase-2-transaction' as const,
  speciesAcquisitionContractDefinitionSha256: speciesAcquisitionContractJson.definitionSha256,
})
export const BREEDING_HATCH_SPECIES_ACQUISITION_POLICY_DEFINITION_SHA256 = sha256(BREEDING_HATCH_SPECIES_ACQUISITION_POLICY_DEFINITION)

export interface PokemonHatchSpeciesAcquisitionSettlementV1 {
  readonly schemaVersion: 1
  readonly historyWasNew: boolean
  readonly rewardApplied: 0 | 1
  readonly trainerRevisionAfterReward: number
  readonly trainerDexExpAfterReward: number
  readonly acquisition: BreedingSpeciesAcquisitionArchiveRecordV1
  readonly definitionSha256: string
}
export type PokemonHatchSpeciesAcquisitionErrorCode =
  | 'breeding.hatch-species-acquisition.invalid-input'
  | 'breeding.hatch-species-acquisition.stale-authority'
  | 'breeding.hatch-species-acquisition.invalid-outcome'
export class PokemonHatchSpeciesAcquisitionError extends Error {
  readonly code: PokemonHatchSpeciesAcquisitionErrorCode
  constructor(code: PokemonHatchSpeciesAcquisitionErrorCode, message: string) {
    super(message); this.name = 'PokemonHatchSpeciesAcquisitionError'; this.code = code
  }
}
const fail = (code: PokemonHatchSpeciesAcquisitionErrorCode, message: string): never => { throw new PokemonHatchSpeciesAcquisitionError(code, message) }
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.hatch-species-acquisition.invalid-input', `${label} must be one plain exact object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.hatch-species-acquisition.invalid-input', `${label} must contain exactly the declared fields.`)
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.hatch-species-acquisition.invalid-input', `${label}.${field} must be an enumerable data field.`)
  }
  return row
}
const integer = (value: unknown, label: string): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER
  ? Number(value) : fail('breeding.hatch-species-acquisition.invalid-input', `${label} must be a bounded safe nonnegative integer.`)
const rewardResult = (value: unknown): TrainerSpeciesAcquisitionRewardResult => {
  const row = exact(value, ['outcome', 'sourceKind', 'acquisition', 'trainerSheetSlug', 'trainerRevision', 'currentDexExp', 'historicalRewardAmount', 'appliedRewardAmount'], 'reward')
  if (!['first-acquisition-rewarded', 'already-acquired', 'exact-replay'].includes(String(row.outcome))
    || !['capture', 'hatch', 'evolution', 'trade', 'migration', 'gm-reviewed'].includes(String(row.sourceKind))
    || (row.historicalRewardAmount !== 0 && row.historicalRewardAmount !== 1)
    || (row.appliedRewardAmount !== 0 && row.appliedRewardAmount !== 1)
    || typeof row.trainerSheetSlug !== 'string') return fail('breeding.hatch-species-acquisition.invalid-input', 'Reward service result has invalid closed values.')
  return Object.freeze({
    outcome: row.outcome,
    sourceKind: row.sourceKind,
    acquisition: parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1(row.acquisition),
    trainerSheetSlug: row.trainerSheetSlug,
    trainerRevision: integer(row.trainerRevision, 'reward.trainerRevision'),
    currentDexExp: integer(row.currentDexExp, 'reward.currentDexExp'),
    historicalRewardAmount: row.historicalRewardAmount,
    appliedRewardAmount: row.appliedRewardAmount,
  }) as TrainerSpeciesAcquisitionRewardResult
}

/** Certifies the only two legal fresh hatch outcomes: insert-and-reward or preserve-without-reward. */
export const validatePokemonHatchSpeciesAcquisitionSettlementV1 = (inputValue: {
  readonly egg: unknown
  readonly command: unknown
  readonly existingAcquisition: unknown | null
  readonly reward: unknown
  readonly trainerRevisionBefore: unknown
  readonly trainerDexExpBefore: unknown
  readonly campaignMinute: unknown
  readonly sheetUpdatedAt: unknown
}): PokemonHatchSpeciesAcquisitionSettlementV1 => {
  exact(inputValue, ['egg', 'command', 'existingAcquisition', 'reward', 'trainerRevisionBefore', 'trainerDexExpBefore', 'campaignMinute', 'sheetUpdatedAt'], 'hatchSpeciesAcquisitionInput')
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const command = parseBreedingOperationCommandV1(inputValue.command)
  if (command.commandKind !== 'complete-hatch' || command.payload.eggId !== egg.eggId
    || command.payload.destination.trainerSheetSlug !== egg.ownerTrainerSlug) return fail('breeding.hatch-species-acquisition.stale-authority', 'Command must bind the exact Egg and owner Trainer hatch destination.')
  const existing = inputValue.existingAcquisition === null ? null
    : parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1(inputValue.existingAcquisition)
  const reward = rewardResult(inputValue.reward)
  const trainerRevision = integer(inputValue.trainerRevisionBefore, 'trainerRevisionBefore')
  const dexExp = integer(inputValue.trainerDexExpBefore, 'trainerDexExpBefore')
  const minute = integer(inputValue.campaignMinute, 'campaignMinute')
  const updatedAt = integer(inputValue.sheetUpdatedAt, 'sheetUpdatedAt')
  if (reward.trainerSheetSlug !== egg.ownerTrainerSlug || reward.acquisition.trainerSheetSlug !== egg.ownerTrainerSlug
    || reward.acquisition.speciesId !== egg.offspring.speciesId) return fail('breeding.hatch-species-acquisition.stale-authority', 'Reward and history must identify the owner Trainer and frozen child Species.')
  const historyWasNew = existing === null
  if (historyWasNew) {
    if (reward.outcome !== 'first-acquisition-rewarded' || reward.sourceKind !== 'hatch'
      || reward.historicalRewardAmount !== 1 || reward.appliedRewardAmount !== 1
      || reward.trainerRevision !== trainerRevision + 1 || reward.currentDexExp !== dexExp + 1
      || reward.acquisition.sourceKind !== 'hatch' || reward.acquisition.sourceEggId !== egg.eggId
      || reward.acquisition.operationId !== command.operationId
      || reward.acquisition.firstAcquiredAtCampaignMinute !== minute
      || reward.acquisition.trainerRevisionBeforeReward !== trainerRevision
      || reward.acquisition.trainerSheetUpdatedAt !== updatedAt) return fail('breeding.hatch-species-acquisition.invalid-outcome', 'A missing Species identity must insert hatch history and apply exactly one Experience reward.')
  }
  else if (reward.outcome !== 'already-acquired' || reward.historicalRewardAmount !== 0 || reward.appliedRewardAmount !== 0
    || reward.trainerRevision !== trainerRevision || reward.currentDexExp !== dexExp
    || stableJsonStringify(reward.acquisition) !== stableJsonStringify(existing)
    || reward.sourceKind !== existing.sourceKind) return fail('breeding.hatch-species-acquisition.invalid-outcome', 'Existing first-Species history must remain immutable and apply no hatch reward.')
  const definition = {
    schemaVersion: 1 as const,
    historyWasNew,
    rewardApplied: (historyWasNew ? 1 : 0) as 0 | 1,
    trainerRevisionAfterReward: reward.trainerRevision,
    trainerDexExpAfterReward: reward.currentDexExp,
    acquisition: reward.acquisition,
  }
  return Object.freeze({ ...definition, definitionSha256: sha256(definition) })
}
