import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseCampaignClockV1, type CampaignClockV1 } from '#shared/campaignClock'
import {
  BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM,
  parseBreedingCampaignClockEggBatchProjectionV1,
  type BreedingCampaignClockEggBatchEntryV1,
  type BreedingCampaignClockEggBatchProjectionV1,
} from '#shared/breeding/campaignClockBatch'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingOverrideIdSyntax,
  parseBreedingReadSetIdSyntax,
  type BreedingOperationId,
  type BreedingOverrideId,
  type BreedingReadSetId,
} from '#shared/breeding/ids'
import {
  breedingConflictScopeKey,
  parseBreedingOperationCommandV1,
  type BreedingOperationCommandV1,
  type PokemonEggScopeV1,
} from '#shared/breeding/operations'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'

export const BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID = 'breeding-campaign-clock-incubation-batch-v1' as const
export const BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID,
  parentCommandKind: 'advance-campaign-clock' as const,
  childCommandKind: 'advance-egg-incubation' as const,
  authority: 'current-authenticated-gm-plus-self-targeted-command-bound-recovery-override' as const,
  discovery: 'first-due-incubating-Eggs-in-Egg-ID-order' as const,
  maximumEggsPerBatch: BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM,
  continuation: 'new-equal-target-clock-command-processes-next-due-page' as const,
  childIdentity: 'sha256-parent-operation-ID-plus-Egg-ID-namespaced-first-128-bits' as const,
  dedupe: 'parent-exact-retry-plus-child-exact-retry-plus-Egg-clock-checkpoint' as const,
  downtime: 'ordinary-incubation-reducer-credits-or-skips-entire-campaign-clock-gap' as const,
  pausedTime: 'skipped-never-credited' as const,
  transactionBoundary: 'clock-parent-then-one-atomic-child-operation-per-Egg' as const,
  partialFailure: 'durable-parent-and-complete-child-prefix-resume-without-reprocessing' as const,
  randomness: 'none' as const,
  mapEncounterWallBrowserProcessTime: 'never-authority' as const,
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
export const BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION,
)
export const BREEDING_CAMPAIGN_CLOCK_BATCH_EVIDENCE_DEFINITION_SHA256 = sha256({
  schemaVersion: 1,
  providerId: BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID,
  policyDefinitionSha256: BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION_SHA256,
})

export type BreedingCampaignClockBatchAuthorityErrorCode =
  | 'breeding.clock-batch.invalid-authority'
  | 'breeding.clock-batch.scope-mismatch'
  | 'breeding.clock-batch.stale-authority'
  | 'breeding.clock-batch.wrong-command'

export class BreedingCampaignClockBatchAuthorityError extends Error {
  readonly code: BreedingCampaignClockBatchAuthorityErrorCode
  readonly path: string

  constructor(code: BreedingCampaignClockBatchAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingCampaignClockBatchAuthorityError'
    this.code = code
    this.path = path
  }
}
const fail = (
  code: BreedingCampaignClockBatchAuthorityErrorCode,
  path: string,
  message: string,
): never => { throw new BreedingCampaignClockBatchAuthorityError(code, path, message) }

const namespacedId = (namespace: string, parentOperationId: string, eggId: string): string => createHash('sha256')
  .update(`${namespace}\u0000${parentOperationId}\u0000${eggId}`)
  .digest('hex')
  .slice(0, 32)
export const deriveBreedingCampaignClockBatchChildOperationIdV1 = (
  parentOperationId: string,
  eggId: string,
): BreedingOperationId => parseBreedingOperationIdSyntax(
  `breeding-operation:v1:${namespacedId('clock-batch-child-operation-v1', parentOperationId, eggId)}`,
) ?? fail('breeding.clock-batch.invalid-authority', 'operationId', 'could not derive a child operation ID.')
export const deriveBreedingCampaignClockBatchReadSetIdV1 = (
  parentOperationId: string,
  eggId: string,
): BreedingReadSetId => parseBreedingReadSetIdSyntax(
  `breeding-read-set:v1:${namespacedId('clock-batch-child-read-set-v1', parentOperationId, eggId)}`,
) ?? fail('breeding.clock-batch.invalid-authority', 'readSetId', 'could not derive a child read-set ID.')
export const deriveBreedingCampaignClockBatchOverrideIdV1 = (
  parentOperationId: string,
  eggId: string,
): BreedingOverrideId => parseBreedingOverrideIdSyntax(
  `breeding-override:v1:${namespacedId('clock-batch-child-override-v1', parentOperationId, eggId)}`,
) ?? fail('breeding.clock-batch.invalid-authority', 'overrideId', 'could not derive a child override ID.')
export const deriveBreedingCampaignClockBatchParentReadSetIdV1 = (
  parentOperationId: string,
): BreedingReadSetId => parseBreedingReadSetIdSyntax(
  `breeding-read-set:v1:${namespacedId('clock-batch-parent-read-set-v1', parentOperationId, 'campaign-clock')}`,
) ?? fail('breeding.clock-batch.invalid-authority', 'readSetId', 'could not derive the parent read-set ID.')
export const deriveBreedingCampaignClockBatchParentOverrideIdV1 = (
  parentOperationId: string,
): BreedingOverrideId => parseBreedingOverrideIdSyntax(
  `breeding-override:v1:${namespacedId('clock-batch-parent-override-v1', parentOperationId, 'campaign-clock')}`,
) ?? fail('breeding.clock-batch.invalid-authority', 'overrideId', 'could not derive the parent override ID.')

export interface BreedingCampaignClockBatchPlanV1 {
  readonly command: BreedingOperationCommandV1 & { readonly commandKind: 'advance-campaign-clock' }
  readonly currentClock: CampaignClockV1
  readonly targetClockRevision: number
  readonly targetCampaignMinute: number
  readonly dueEggs: readonly PokemonEggDocumentV1[]
  readonly eggScopes: readonly PokemonEggScopeV1[]
}

const isEggBehind = (
  egg: PokemonEggDocumentV1,
  clockRevision: number,
  campaignMinute: number,
): boolean => egg.status === 'incubating' && (
  egg.incubation.lastAppliedClockRevision < clockRevision
  || (egg.incubation.lastAppliedClockRevision === clockRevision
    && egg.incubation.lastAppliedClockMinute < campaignMinute)
)

export const validateBreedingCampaignClockBatchPlanV1 = (input: {
  readonly command: unknown
  readonly currentClock: unknown
  readonly dueEggs: readonly PokemonEggDocumentV1[]
}): BreedingCampaignClockBatchPlanV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  const currentClock = parseCampaignClockV1(input.currentClock)
  if (command.commandKind !== 'advance-campaign-clock') {
    return fail('breeding.clock-batch.wrong-command', 'command.commandKind', 'must be advance-campaign-clock.')
  }
  const clockScope = command.scopes[0]
  if (clockScope?.kind !== 'campaign-clock' || clockScope.expectedRevision !== currentClock.revision
    || command.payload.targetCampaignMinute < currentClock.campaignMinute) {
    return fail('breeding.clock-batch.stale-authority', 'command', 'must bind the current clock revision and a nondecreasing target minute.')
  }
  if (!Array.isArray(input.dueEggs)
    || input.dueEggs.length > BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM) {
    return fail('breeding.clock-batch.invalid-authority', 'dueEggs', 'must be one bounded server-discovered page.')
  }
  const targetClockRevision = command.payload.targetCampaignMinute === currentClock.campaignMinute
    ? currentClock.revision
    : currentClock.revision + 1
  const dueEggs = [...input.dueEggs]
  for (let index = 0; index < dueEggs.length; index += 1) {
    const egg = dueEggs[index]!
    if (!isEggBehind(egg, targetClockRevision, command.payload.targetCampaignMinute)
      || (index > 0 && dueEggs[index - 1]!.eggId >= egg.eggId)) {
      return fail('breeding.clock-batch.invalid-authority', `dueEggs[${index}]`, 'must be current due incubating Eggs in strict Egg-ID order.')
    }
  }
  const eggScopes = dueEggs.map(egg => Object.freeze({
    kind: 'pokemon-egg' as const,
    eggId: egg.eggId,
    expectedRevision: egg.revision,
  }))
  const expectedScopes = [clockScope, ...eggScopes]
  if (command.scopes.length !== expectedScopes.length
    || command.scopes.some((scope, index) => (
      breedingConflictScopeKey(scope) !== breedingConflictScopeKey(expectedScopes[index]!)
      || stableJsonStringify(scope) !== stableJsonStringify(expectedScopes[index])
    ))) {
    return fail('breeding.clock-batch.scope-mismatch', 'command.scopes', 'must equal the complete first server-discovered due Egg page.')
  }
  return Object.freeze({
    command: command as BreedingCampaignClockBatchPlanV1['command'],
    currentClock,
    targetClockRevision,
    targetCampaignMinute: command.payload.targetCampaignMinute,
    dueEggs: Object.freeze(dueEggs),
    eggScopes: Object.freeze(eggScopes),
  })
}

export const projectBreedingCampaignClockEggBatchV1 = (input: {
  readonly parentOperationId: string
  readonly parentExecutionKind: 'executed' | 'exact-retry' | 'pending'
  readonly parentStatus: 'accepted' | 'rejected' | 'pending'
  readonly clockRevision: number
  readonly campaignMinute: number
  readonly entries: readonly BreedingCampaignClockEggBatchEntryV1[]
  readonly hasMoreDueEggs: boolean
}): BreedingCampaignClockEggBatchProjectionV1 => parseBreedingCampaignClockEggBatchProjectionV1({
  schemaVersion: 1,
  audience: 'gm',
  ...input,
})

export const breedingCampaignClockBatchDefinitionSha256 = sha256
