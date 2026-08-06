import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseBreedingRollRecordV1, type BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingModifierProviderHandoffV1 } from '#shared/breeding/modifierProviderHandoff'
import { createBreedingOperationCommandHash } from './operations'
import { parseAuthoritativeBreedingRollRecordV1 } from './ledgers'
import { validatePokemonEggRevisionSuccessor } from './eggLifecycle'
import {
  BREEDING_EGG_WARMER_CAPABILITY_PROVIDER_ID,
  parseAuthoritativeBreedingModifierProviderHandoffV1,
} from './modifierProviderHandoff'

export const BREEDING_EGG_WARMER_CAPABILITY_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-egg-warmer-capability-v1' as const,
  checkpoint: 'incubation-operation' as const,
  frequencyCampaignMinutes: 1_440,
  rollPurpose: 'provider-bounded' as const,
  rollFormula: 'provider-bounded' as const,
  dieCount: 1,
  dieSides: 10,
  rollOneReductionCampaignMinutes: 0,
  rollTwoThroughTenMinutesPerPoint: 60,
  applicationModel: 'target-equivalent-progress-credit-preserves-frozen-target' as const,
})
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const BREEDING_EGG_WARMER_CAPABILITY_POLICY_DEFINITION_SHA256 = sha256(BREEDING_EGG_WARMER_CAPABILITY_POLICY)

export type BreedingEggWarmerCapabilityAuthorityErrorCode =
  | 'breeding.egg-warmer.invalid-authority'
  | 'breeding.egg-warmer.invalid-roll'
  | 'breeding.egg-warmer.stale-authority'
  | 'breeding.egg-warmer.unavailable'
  | 'breeding.egg-warmer.wrong-command'
export class BreedingEggWarmerCapabilityAuthorityError extends Error {
  readonly code: BreedingEggWarmerCapabilityAuthorityErrorCode
  constructor(code: BreedingEggWarmerCapabilityAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingEggWarmerCapabilityAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingEggWarmerCapabilityAuthorityErrorCode, message: string): never => {
  throw new BreedingEggWarmerCapabilityAuthorityError(code, message)
}
const operationIdPart = (operationId: string, eggId: string): string => createHash('sha256')
  .update(`breeding-egg-warmer-capability-roll-v1\0${operationId}\0${eggId}`).digest('hex').slice(0, 32)
export const deriveBreedingEggWarmerCapabilityRollRecordIdV1 = (operationId: string, eggId: string): `breeding-roll:v1:${string}` => (
  `breeding-roll:v1:${operationIdPart(operationId, eggId)}`
)
export const breedingEggWarmerCapabilityRollSourceDefinitionHashesV1 = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly handoff: BreedingModifierProviderHandoffV1
}): readonly string[] => Object.freeze([
  BREEDING_EGG_WARMER_CAPABILITY_POLICY_DEFINITION_SHA256,
  input.egg.ruleset.definitionSha256,
  input.handoff.definitionSha256,
  ...input.handoff.evidence.map(entry => entry.definitionSha256),
  ...input.handoff.dependencyEvidence.flatMap(entry => [entry.providerDefinitionSha256, entry.effectiveEvidenceSha256]),
].filter((value, index, all) => all.indexOf(value) === index).sort())

export interface PlanBreedingEggWarmerCapabilityResultV1 {
  readonly egg: PokemonEggDocumentV1
  readonly roll: BreedingRollRecordV1
  readonly rolledHours: number
  readonly creditedCampaignMinutes: number
  readonly overflowCampaignMinutes: number
  readonly reachedReady: boolean
}

export const planBreedingEggWarmerCapabilityV1 = (input: {
  readonly egg: unknown
  readonly command: unknown
  readonly campaignClock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }
  readonly handoff: unknown
  readonly roll: unknown
}): PlanBreedingEggWarmerCapabilityResultV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'apply-egg-warmer-capability') return fail('breeding.egg-warmer.wrong-command', 'Egg Warmer reducer accepts only apply-egg-warmer-capability.')
  const scope = command.scopes[0]
  if (scope?.kind !== 'pokemon-egg' || command.scopes.length !== 1 || scope.eggId !== egg.eggId
    || scope.expectedRevision !== egg.revision || command.payload.eggId !== egg.eggId
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256) {
    return fail('breeding.egg-warmer.stale-authority', 'Command must bind the exact current Egg revision and ruleset.')
  }
  if (egg.status !== 'incubating' || egg.incubation.readinessKind !== null
    || !Number.isSafeInteger(input.campaignClock.revision) || input.campaignClock.revision < egg.incubation.lastAppliedClockRevision
    || !Number.isSafeInteger(input.campaignClock.campaignMinute) || input.campaignClock.campaignMinute < egg.updatedAtCampaignMinute) {
    return fail('breeding.egg-warmer.unavailable', 'Egg Warmer applies only to a current not-ready incubating Egg at monotonic campaign time.')
  }
  const handoff = parseAuthoritativeBreedingModifierProviderHandoffV1(input.handoff)
  const evidence = handoff.evidence[0]
  const contribution = evidence?.contribution
  if (handoff.checkpoint !== 'incubation-operation' || handoff.capturedAtCampaignMinute !== input.campaignClock.campaignMinute
    || handoff.evidence.length !== 1 || handoff.dependencyEvidence.length !== 1
    || evidence?.disposition !== 'active-br-062' || contribution?.inventoryEntryId !== 'capability:Egg Warmer'
    || contribution.providerKind !== 'capability' || contribution.providerId !== BREEDING_EGG_WARMER_CAPABILITY_PROVIDER_ID
    || contribution.subjectKind !== 'pokemon-sheet' || contribution.subjectId !== command.payload.sourcePokemonSheetSlug
    || contribution.subjectRevision !== command.payload.expectedSourcePokemonSheetRevision
    || contribution.contributionId !== 'once-per-24-hours-hatch-reduction-d10'
    || contribution.value.kind !== 'flag' || contribution.value.enabled !== true) {
    return fail('breeding.egg-warmer.invalid-authority', 'Exactly one current effective command-bound Egg Warmer Capability contribution is required.')
  }
  const roll = parseAuthoritativeBreedingRollRecordV1(input.roll)
  const expectedHashes = breedingEggWarmerCapabilityRollSourceDefinitionHashesV1({ egg, handoff })
  if (roll.rollRecordId !== deriveBreedingEggWarmerCapabilityRollRecordIdV1(command.operationId, egg.eggId)
    || roll.operationId !== command.operationId || roll.commandSha256 !== createBreedingOperationCommandHash(command)
    || roll.operationRollOrdinal !== 0 || roll.purpose !== 'provider-bounded' || roll.formula !== 'provider-bounded'
    || roll.dieCount !== 1 || roll.dieSides !== 10 || roll.ordered !== false || roll.modifier !== 0
    || roll.target.kind !== 'pokemon-egg' || roll.target.eggId !== egg.eggId || roll.target.revision !== egg.revision
    || roll.generatedAtCampaignMinute !== input.campaignClock.campaignMinute
    || stableJsonStringify(roll.sourceDefinitionHashes) !== stableJsonStringify(expectedHashes)) {
    return fail('breeding.egg-warmer.invalid-roll', 'Exactly one persisted command-bound d10 must target the current Egg revision and provider evidence.')
  }
  // Reparse structurally before relying on the bounded total in case a caller supplied an enriched proxy.
  parseBreedingRollRecordV1(roll)
  const reduction = roll.total === 1 ? 0 : roll.total * 60
  const before = egg.incubation.accumulatedCampaignMinutes
  const remaining = egg.incubation.targetCampaignMinutes - before
  const credited = Math.min(reduction, remaining)
  const overflow = Math.max(0, reduction - remaining)
  const after = before + credited
  const reachedReady = after === egg.incubation.targetCampaignMinutes
  const next = validatePokemonEggRevisionSuccessor(egg, {
    ...egg,
    revision: egg.revision + 1,
    status: reachedReady ? 'ready' : 'incubating',
    incubation: {
      ...egg.incubation,
      accumulatedCampaignMinutes: after,
      readyAtCampaignMinute: reachedReady ? input.campaignClock.campaignMinute : null,
      readinessKind: reachedReady ? 'incubation-complete' : null,
      readyOperationId: reachedReady ? command.operationId : null,
    },
    updatedAtCampaignMinute: input.campaignClock.campaignMinute,
    statusChangedAtCampaignMinute: reachedReady ? input.campaignClock.campaignMinute : egg.statusChangedAtCampaignMinute,
    lastOperationId: command.operationId,
  })
  return Object.freeze({ egg: next, roll, rolledHours: roll.total, creditedCampaignMinutes: credited, overflowCampaignMinutes: overflow, reachedReady })
}
