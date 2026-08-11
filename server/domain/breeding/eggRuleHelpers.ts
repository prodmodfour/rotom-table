import { createHash } from 'node:crypto'
import eggRulePolicyJson from '../../../data/breeding-automation/egg-rule-helpers-policy.json'
import hatchDurationPolicyJson from '../../../data/breeding-automation/hatch-duration-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingOfferOptionIdSyntax, type BreedingOfferOptionId, type BreedingSpeciesId } from '#shared/breeding/ids'
import {
  parseBreedingCampaignOptionSnapshotV1,
  type BreedingCampaignOptionSnapshotV1,
  type BreedingHatchDurationVariation,
} from './campaignOptions'
import { compiledBreedingSpeciesSpec } from './registry'

export const BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256 = eggRulePolicyJson.definitionSha256
export const BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256 = hatchDurationPolicyJson.definitionSha256
export const BREEDING_EGG_SOURCE_KINDS = Object.freeze(['breeding', 'fossil', 'gm', 'feature-artificial'] as const)
export type BreedingEggSourceKind = typeof BREEDING_EGG_SOURCE_KINDS[number]
export const BREEDING_HATCH_DURATION_MINUTES_MINIMUM = 1
export const BREEDING_HATCH_DURATION_MINUTES_MAXIMUM = 31_536_000

export type BreedingEggRuleReasonId =
  | 'breeding.egg-rules.options-invalid'
  | 'breeding.hatch-duration.species-unavailable'
  | 'breeding.hatch-duration.missing'
  | 'breeding.hatch-duration.override-required'
  | 'breeding.hatch-duration.override-invalid'
  | 'breeding.hatch-duration.override-not-allowed'
  | 'breeding.hatch-duration.roll-missing'
  | 'breeding.hatch-duration.roll-invalid'
  | 'breeding.hatch-duration.gm-target-required'
  | 'breeding.hatch-duration.gm-target-invalid'
  | 'breeding.hatch-duration.extraneous-input'
  | 'breeding.hatch-duration.out-of-bounds'
  | 'breeding.egg-rules.source-kind-invalid'
  | 'breeding.baby-template.choice-required'
  | 'breeding.baby-template.choice-invalid'
  | 'breeding.baby-template.choice-not-allowed'
  | 'breeding.hatch-special.roll-required'
  | 'breeding.hatch-special.roll-invalid'
  | 'breeding.hatch-special.provider-evidence-invalid'
  | 'breeding.hatch-special.table-unavailable'

export interface BreedingHatchDurationOverride {
  readonly authorityKind: 'gm-adjudication' | 'authoritative-provider'
  readonly authorityId: string
  readonly evidenceId: string
  readonly authorityDefinitionSha256: string
  readonly campaignMinutes: number
}
export interface BreedingHatchDurationRoll {
  readonly rollId: string
  readonly total: number
}
export interface BreedingHatchDurationGmTarget {
  readonly optionId: BreedingOfferOptionId
  readonly evidenceId: string
  readonly targetCampaignMinutes: number
}
export interface ResolveBreedingHatchDurationInput {
  readonly speciesId: BreedingSpeciesId
  readonly sourceKind: BreedingEggSourceKind
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly durationOverride: BreedingHatchDurationOverride | null
  readonly variationRoll: BreedingHatchDurationRoll | null
  readonly gmTarget: BreedingHatchDurationGmTarget | null
}
export type BreedingHatchDurationSourceKind = 'compiled-spec' | 'campaign-option' | 'gm-adjudication' | 'authoritative-provider'
export interface ResolvedBreedingHatchDuration {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly speciesId: BreedingSpeciesId
  readonly sourceKind: BreedingEggSourceKind
  readonly averageCampaignMinutes: number
  readonly durationSourceKind: BreedingHatchDurationSourceKind
  readonly durationSourceEvidence: BreedingHatchDurationOverride | null
  readonly variationPolicyId: BreedingHatchDurationVariation
  readonly variationRoll: BreedingHatchDurationRoll | null
  readonly gmTargetOptionId: BreedingOfferOptionId | null
  readonly gmTargetEvidenceId: string | null
  readonly targetCampaignMinutes: number
  readonly optionSnapshotDefinitionSha256: string
  readonly speciesSpecDefinitionSha256: string
  readonly hatchDurationPolicyDefinitionSha256: string
  readonly resultDefinitionSha256: string
}
export interface UnavailableBreedingHatchDuration {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingEggRuleReasonId[]
  readonly speciesId: BreedingSpeciesId | null
  readonly sourceKind: BreedingEggSourceKind | null
  readonly resultDefinitionSha256: null
  readonly hatchDurationPolicyDefinitionSha256: string
}
export type BreedingHatchDurationResult = ResolvedBreedingHatchDuration | UnavailableBreedingHatchDuration

export interface ResolvedBreedingHatchStartingLevel {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly sourceKind: BreedingEggSourceKind
  readonly startingLevel: number
  readonly optionSnapshotDefinitionSha256: string
  readonly resultDefinitionSha256: string
}
export interface UnavailableBreedingHatchStartingLevel {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingEggRuleReasonId[]
  readonly sourceKind: null
  readonly startingLevel: null
  readonly optionSnapshotDefinitionSha256: null
  readonly resultDefinitionSha256: null
}
export type BreedingHatchStartingLevelResult = ResolvedBreedingHatchStartingLevel | UnavailableBreedingHatchStartingLevel

export interface BreedingBabyTemplateChoice {
  readonly optionId: BreedingOfferOptionId
  readonly evidenceId: string
  readonly apply: boolean
  readonly sizePercentOfAdult: number | null
}
export interface BreedingBabyTemplateEffects {
  readonly baseStatPenaltyEach: number
  readonly skillRankPenalty: 1
  readonly capabilityPenalty: 2
  readonly sizePercentOfAdult: number
  readonly recoveryBaseStatPointsEachInterval: 1
  readonly recoveryIntervalLevels: 5
  readonly recoveryStepCount: number
  readonly removeSkillAndCapabilityPenaltyAfterFinalRecovery: true
}
export interface ResolvedBreedingBabyTemplate {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly applied: boolean
  readonly choiceOptionId: BreedingOfferOptionId | null
  readonly choiceEvidenceId: string | null
  readonly effects: BreedingBabyTemplateEffects | null
  readonly optionSnapshotDefinitionSha256: string
  readonly resultDefinitionSha256: string
}
export interface UnavailableBreedingBabyTemplate {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingEggRuleReasonId[]
  readonly applied: null
  readonly choiceOptionId: null
  readonly choiceEvidenceId: null
  readonly effects: null
  readonly optionSnapshotDefinitionSha256: string | null
  readonly resultDefinitionSha256: null
}
export type BreedingBabyTemplateResult = ResolvedBreedingBabyTemplate | UnavailableBreedingBabyTemplate

export interface BreedingHatchSpecialRoll { readonly rollId: string, readonly total: number }
export interface BreedingForcedSpecialEvidence {
  readonly providerId: string
  readonly evidenceId: string
  readonly providerDefinitionSha256: string
}
export type BreedingHatchSpecialTriggerId = 'roll-1' | 'roll-100' | 'provider-force'
export interface ResolvedBreedingHatchSpecial {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly isSpecial: boolean
  readonly workflow: 'none' | 'bounded-gm-adjudication-pending'
  readonly roll: BreedingHatchSpecialRoll
  readonly triggerIds: readonly BreedingHatchSpecialTriggerId[]
  readonly forcedByProvider: BreedingForcedSpecialEvidence | null
  readonly automaticShiny: false
  readonly optionSnapshotDefinitionSha256: string
  readonly resultDefinitionSha256: string
}
export interface UnavailableBreedingHatchSpecial {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingEggRuleReasonId[]
  readonly isSpecial: null
  readonly workflow: null
  readonly roll: null
  readonly triggerIds: readonly []
  readonly forcedByProvider: null
  readonly automaticShiny: false
  readonly optionSnapshotDefinitionSha256: string | null
  readonly resultDefinitionSha256: null
}
export type BreedingHatchSpecialResult = ResolvedBreedingHatchSpecial | UnavailableBreedingHatchSpecial

const REASONS = eggRulePolicyJson.definition.reasonIds as readonly BreedingEggRuleReasonId[]
const reasonOrder = new Map(REASONS.map((reason, index) => [reason, index]))
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const SHA256 = /^[0-9a-f]{64}$/
const SOURCE_KINDS = new Set<string>(BREEDING_EGG_SOURCE_KINDS)
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const orderedReasons = (values: Iterable<BreedingEggRuleReasonId>): readonly BreedingEggRuleReasonId[] => Object.freeze(
  [...new Set(values)].sort((left, right) => reasonOrder.get(left)! - reasonOrder.get(right)!),
)
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const parsedOptions = (value: unknown): BreedingCampaignOptionSnapshotV1 | null => {
  try { return parseBreedingCampaignOptionSnapshotV1(value) }
  catch { return null }
}
const sourceKind = (value: unknown): BreedingEggSourceKind | null => (
  typeof value === 'string' && SOURCE_KINDS.has(value) ? value as BreedingEggSourceKind : null
)
const identifier = (value: unknown): value is string => typeof value === 'string' && IDENTIFIER.test(value)
const optionId = (value: unknown): value is BreedingOfferOptionId => parseBreedingOfferOptionIdSyntax(value) !== null
const boundedInteger = (value: unknown, minimum: number, maximum: number): value is number => (
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
)
const validDurationOverride = (value: BreedingHatchDurationOverride): boolean => (
  (value.authorityKind === 'gm-adjudication' || value.authorityKind === 'authoritative-provider')
  && identifier(value.authorityId)
  && identifier(value.evidenceId)
  && SHA256.test(value.authorityDefinitionSha256)
  && boundedInteger(value.campaignMinutes, BREEDING_HATCH_DURATION_MINUTES_MINIMUM, BREEDING_HATCH_DURATION_MINUTES_MAXIMUM)
)
const validDurationRoll = (value: BreedingHatchDurationRoll): boolean => (
  identifier(value.rollId) && boundedInteger(value.total, 50, 200)
)
const validGmTarget = (value: BreedingHatchDurationGmTarget, minimum: number, maximum: number): boolean => (
  optionId(value.optionId)
  && identifier(value.evidenceId)
  && boundedInteger(value.targetCampaignMinutes, minimum, maximum)
)

export const resolveBreedingHatchDuration = (
  input: ResolveBreedingHatchDurationInput,
): BreedingHatchDurationResult => {
  const reasons: BreedingEggRuleReasonId[] = []
  const options = parsedOptions(input.options)
  if (!options) reasons.push('breeding.egg-rules.options-invalid')
  const kind = sourceKind(input.sourceKind)
  const species = compiledBreedingSpeciesSpec(input.speciesId)
  if (!species) reasons.push('breeding.hatch-duration.species-unavailable')
  let average: number | null = null
  let durationSourceKind: BreedingHatchDurationSourceKind | null = null
  let durationSourceEvidence: BreedingHatchDurationOverride | null = null

  if (kind === 'breeding') {
    if (input.durationOverride) reasons.push('breeding.hatch-duration.override-not-allowed')
    if (species?.hatchCampaignMinutes) {
      average = species.hatchCampaignMinutes
      durationSourceKind = 'compiled-spec'
    }
  }
  else if (kind === 'fossil') {
    if (input.durationOverride) {
      if (!validDurationOverride(input.durationOverride) || input.durationOverride.authorityKind !== 'authoritative-provider') {
        reasons.push('breeding.hatch-duration.override-invalid')
      }
      else {
        average = input.durationOverride.campaignMinutes
        durationSourceKind = 'authoritative-provider'
        durationSourceEvidence = deepFreeze({ ...input.durationOverride })
      }
    }
    else if (species?.hatchCampaignMinutes) {
      average = species.hatchCampaignMinutes
      durationSourceKind = 'compiled-spec'
    }
  }
  else if (kind === 'gm' || kind === 'feature-artificial') {
    const requiredAuthority = kind === 'gm' ? 'gm-adjudication' : 'authoritative-provider'
    if (!input.durationOverride) reasons.push('breeding.hatch-duration.override-required')
    else if (!validDurationOverride(input.durationOverride) || input.durationOverride.authorityKind !== requiredAuthority) {
      reasons.push('breeding.hatch-duration.override-invalid')
    }
    else {
      average = input.durationOverride.campaignMinutes
      durationSourceKind = requiredAuthority
      durationSourceEvidence = deepFreeze({ ...input.durationOverride })
    }
  }
  else reasons.push('breeding.egg-rules.source-kind-invalid')

  if (average === null && kind && kind !== 'gm' && kind !== 'feature-artificial' && options) {
    if (options.values['breeding.missing-hatch-duration-policy'] === 'gm-explicit-minutes') {
      average = options.values['breeding.gm-hatch-duration-minutes']
      durationSourceKind = 'campaign-option'
    }
    else reasons.push('breeding.hatch-duration.missing')
  }
  if (average !== null && !boundedInteger(average, BREEDING_HATCH_DURATION_MINUTES_MINIMUM, BREEDING_HATCH_DURATION_MINUTES_MAXIMUM)) {
    reasons.push('breeding.hatch-duration.out-of-bounds')
  }

  let target: number | null = null
  let usedRoll: BreedingHatchDurationRoll | null = null
  let gmTargetOptionId: BreedingOfferOptionId | null = null
  let gmTargetEvidenceId: string | null = null
  const variation = options?.values['breeding.hatch-duration-variation'] ?? null
  if (average !== null && variation === 'fixed-average') {
    if (input.variationRoll || input.gmTarget) reasons.push('breeding.hatch-duration.extraneous-input')
    else target = average
  }
  else if (average !== null && variation === 'server-random-half-to-double') {
    if (input.gmTarget) reasons.push('breeding.hatch-duration.extraneous-input')
    if (!input.variationRoll) reasons.push('breeding.hatch-duration.roll-missing')
    else if (!validDurationRoll(input.variationRoll)) reasons.push('breeding.hatch-duration.roll-invalid')
    else {
      usedRoll = deepFreeze({ ...input.variationRoll })
      target = Math.ceil(average * input.variationRoll.total / 100)
    }
  }
  else if (average !== null && variation === 'gm-within-half-to-double') {
    if (input.variationRoll) reasons.push('breeding.hatch-duration.extraneous-input')
    const minimum = Math.ceil(average / 2)
    const maximum = average * 2
    if (!input.gmTarget) reasons.push('breeding.hatch-duration.gm-target-required')
    else if (!validGmTarget(input.gmTarget, minimum, maximum)) reasons.push('breeding.hatch-duration.gm-target-invalid')
    else {
      target = input.gmTarget.targetCampaignMinutes
      gmTargetOptionId = input.gmTarget.optionId
      gmTargetEvidenceId = input.gmTarget.evidenceId
    }
  }
  if (target !== null && !boundedInteger(target, BREEDING_HATCH_DURATION_MINUTES_MINIMUM, BREEDING_HATCH_DURATION_MINUTES_MAXIMUM)) {
    reasons.push('breeding.hatch-duration.out-of-bounds')
  }
  const finalReasons = orderedReasons(reasons)
  if (finalReasons.length || !options || !kind || !species || average === null || !durationSourceKind || target === null) {
    return Object.freeze({
      status: 'unavailable', reasonIds: finalReasons, speciesId: species?.speciesId ?? null,
      sourceKind: kind, resultDefinitionSha256: null,
      hatchDurationPolicyDefinitionSha256: BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
    })
  }
  const definition = deepFreeze({
    speciesId: species.speciesId,
    sourceKind: kind,
    averageCampaignMinutes: average,
    durationSourceKind,
    durationSourceEvidence,
    variationPolicyId: variation!,
    variationRoll: usedRoll,
    gmTargetOptionId,
    gmTargetEvidenceId,
    targetCampaignMinutes: target,
    optionSnapshotDefinitionSha256: options.definitionSha256,
    speciesSpecDefinitionSha256: species.definitionSha256,
    hatchDurationPolicyDefinitionSha256: BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
  })
  return Object.freeze({ status: 'resolved', reasonIds: Object.freeze([] as const), ...definition, resultDefinitionSha256: hash(definition) })
}

export const resolveBreedingHatchStartingLevel = (
  source: unknown,
  optionSnapshot: unknown,
): BreedingHatchStartingLevelResult => {
  const reasons: BreedingEggRuleReasonId[] = []
  const kind = sourceKind(source)
  const options = parsedOptions(optionSnapshot)
  if (!kind) reasons.push('breeding.egg-rules.source-kind-invalid')
  if (!options) reasons.push('breeding.egg-rules.options-invalid')
  if (reasons.length || !kind || !options) {
    return Object.freeze({ status: 'unavailable', reasonIds: orderedReasons(reasons), sourceKind: null, startingLevel: null, optionSnapshotDefinitionSha256: null, resultDefinitionSha256: null })
  }
  const definition = Object.freeze({
    sourceKind: kind,
    startingLevel: kind === 'fossil' ? options.values['breeding.fossil-hatch-level'] : 1,
    optionSnapshotDefinitionSha256: options.definitionSha256,
  })
  return Object.freeze({ status: 'resolved', reasonIds: Object.freeze([] as const), ...definition, resultDefinitionSha256: hash(definition) })
}

const validBabyChoice = (choice: BreedingBabyTemplateChoice): boolean => (
  optionId(choice.optionId)
  && identifier(choice.evidenceId)
  && typeof choice.apply === 'boolean'
  && (choice.apply
    ? boundedInteger(choice.sizePercentOfAdult, 50, 100)
    : choice.sizePercentOfAdult === null)
)
export const resolveBreedingBabyTemplate = (
  optionSnapshot: unknown,
  choice: BreedingBabyTemplateChoice | null,
): BreedingBabyTemplateResult => {
  const options = parsedOptions(optionSnapshot)
  if (!options) return Object.freeze({
    status: 'unavailable', reasonIds: Object.freeze(['breeding.egg-rules.options-invalid'] as const),
    applied: null, choiceOptionId: null, choiceEvidenceId: null, effects: null,
    optionSnapshotDefinitionSha256: null, resultDefinitionSha256: null,
  })
  const policy = options.values['breeding.baby-template-policy']
  if (policy === 'disabled' && choice) return Object.freeze({
    status: 'unavailable', reasonIds: Object.freeze(['breeding.baby-template.choice-not-allowed'] as const),
    applied: null, choiceOptionId: null, choiceEvidenceId: null, effects: null,
    optionSnapshotDefinitionSha256: options.definitionSha256, resultDefinitionSha256: null,
  })
  if (policy === 'per-egg-gm-choice' && !choice) return Object.freeze({
    status: 'unavailable', reasonIds: Object.freeze(['breeding.baby-template.choice-required'] as const),
    applied: null, choiceOptionId: null, choiceEvidenceId: null, effects: null,
    optionSnapshotDefinitionSha256: options.definitionSha256, resultDefinitionSha256: null,
  })
  if (choice && !validBabyChoice(choice)) return Object.freeze({
    status: 'unavailable', reasonIds: Object.freeze(['breeding.baby-template.choice-invalid'] as const),
    applied: null, choiceOptionId: null, choiceEvidenceId: null, effects: null,
    optionSnapshotDefinitionSha256: options.definitionSha256, resultDefinitionSha256: null,
  })
  const applied = choice?.apply ?? false
  const penalty = options.values['breeding.baby-template-stat-penalty']
  const effects: BreedingBabyTemplateEffects | null = applied ? Object.freeze({
    baseStatPenaltyEach: penalty,
    skillRankPenalty: 1,
    capabilityPenalty: 2,
    sizePercentOfAdult: choice!.sizePercentOfAdult!,
    recoveryBaseStatPointsEachInterval: 1,
    recoveryIntervalLevels: 5,
    recoveryStepCount: penalty,
    removeSkillAndCapabilityPenaltyAfterFinalRecovery: true,
  }) : null
  const definition = deepFreeze({
    applied,
    choiceOptionId: choice?.optionId ?? null,
    choiceEvidenceId: choice?.evidenceId ?? null,
    effects,
    optionSnapshotDefinitionSha256: options.definitionSha256,
  })
  return Object.freeze({ status: 'resolved', reasonIds: Object.freeze([] as const), ...definition, resultDefinitionSha256: hash(definition) })
}

const validSpecialRoll = (roll: BreedingHatchSpecialRoll): boolean => identifier(roll.rollId) && boundedInteger(roll.total, 1, 100)
const validProviderForce = (evidence: BreedingForcedSpecialEvidence): boolean => (
  identifier(evidence.providerId) && identifier(evidence.evidenceId) && SHA256.test(evidence.providerDefinitionSha256)
)
export const resolveBreedingHatchSpecial = (
  optionSnapshot: unknown,
  roll: BreedingHatchSpecialRoll | null,
  forcedByProvider: BreedingForcedSpecialEvidence | null,
): BreedingHatchSpecialResult => {
  const reasons: BreedingEggRuleReasonId[] = []
  const options = parsedOptions(optionSnapshot)
  if (!options) reasons.push('breeding.egg-rules.options-invalid')
  if (!roll) reasons.push('breeding.hatch-special.roll-required')
  else if (!validSpecialRoll(roll)) reasons.push('breeding.hatch-special.roll-invalid')
  if (forcedByProvider && !validProviderForce(forcedByProvider)) reasons.push('breeding.hatch-special.provider-evidence-invalid')
  const triggerIds: BreedingHatchSpecialTriggerId[] = []
  if (roll?.total === 1) triggerIds.push('roll-1')
  if (roll?.total === 100) triggerIds.push('roll-100')
  if (forcedByProvider && validProviderForce(forcedByProvider)) triggerIds.push('provider-force')
  if (triggerIds.length && options?.values['breeding.hatch-special-policy'] === 'configured-bounded-table') {
    reasons.push('breeding.hatch-special.table-unavailable')
  }
  const finalReasons = orderedReasons(reasons)
  if (finalReasons.length || !options || !roll) return Object.freeze({
    status: 'unavailable', reasonIds: finalReasons, isSpecial: null, workflow: null, roll: null,
    triggerIds: Object.freeze([] as const), forcedByProvider: null, automaticShiny: false,
    optionSnapshotDefinitionSha256: options?.definitionSha256 ?? null, resultDefinitionSha256: null,
  })
  const isSpecial = triggerIds.length > 0
  const definition = deepFreeze({
    isSpecial,
    workflow: isSpecial ? 'bounded-gm-adjudication-pending' as const : 'none' as const,
    roll: { ...roll },
    triggerIds,
    forcedByProvider: forcedByProvider ? { ...forcedByProvider } : null,
    automaticShiny: false as const,
    optionSnapshotDefinitionSha256: options.definitionSha256,
  })
  return Object.freeze({ status: 'resolved', reasonIds: Object.freeze([] as const), ...definition, resultDefinitionSha256: hash(definition) })
}
