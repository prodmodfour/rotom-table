import { createHash } from 'node:crypto'
import sourceAdjudicationsJson from '../../../data/breeding-automation/source-adjudications.json'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingBabyTemplateAuthorityV1,
  parseBreedingBabyTemplateMechanicsV1,
  type BreedingBabyTemplateAuthorityV1,
  type BreedingBabyTemplateMechanicsV1,
} from '#shared/breeding/babyTemplate'
import type { PokemonEggBabyTemplateV1, PokemonEggMarsupialV1 } from '#shared/breeding/egg'

const adjudication = sourceAdjudicationsJson.entries.find(entry => entry.id === 'BR-SRC-011')
if (!adjudication || adjudication.status !== 'accepted') {
  throw new Error('Accepted BR-SRC-011 Baby Template adjudication is unavailable.')
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const marsupialInventoryEntry = modifierInventoryJson.definition.entries.find(entry => entry.id === 'capability:Marsupial')
if (!marsupialInventoryEntry || marsupialInventoryEntry.integrationStatus !== 'requires-breeding-integration'
  || marsupialInventoryEntry.clientAuthority !== 'none'
  || !marsupialInventoryEntry.contributionIds.includes('kangaskhan-forced-baby-template-minus-5')
  || !marsupialInventoryEntry.contributionIds.includes('mother-pouch-link')
  || !marsupialInventoryEntry.contributionIds.includes('level-25-template-removal')) {
  throw new Error('Reviewed Marsupial modifier inventory authority is unavailable for Baby Template production.')
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}

export const BREEDING_BABY_TEMPLATE_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-baby-template-v1' as const,
  sourceAdjudicationId: adjudication.id,
  sourceAdjudicationDecision: adjudication.decision,
  defaultPolicyId: adjudication.defaultPolicyId,
  campaignPenaltyMinimum: 2 as const,
  campaignPenaltyMaximum: 4 as const,
  marsupialPenalty: 5 as const,
  recoveryIntervalLevels: 5 as const,
  skillPenaltyUntilFinalRecovery: 1 as const,
  capabilityPenaltyUntilFinalRecovery: 2 as const,
  sizeGrowth: 'linear-integer-percent-by-recovery-step' as const,
  speciesReferenceMutation: 'forbidden' as const,
  editableBabyTemplateAuthority: 'none' as const,
  marsupialProviderRecordSha256: marsupialInventoryEntry.recordSha256,
  marsupialProviderMechanicFieldsSha256: marsupialInventoryEntry.mechanicFieldsSha256,
})
export const BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256 = sha256(BREEDING_BABY_TEMPLATE_POLICY_DEFINITION)

export type BreedingBabyTemplateAuthorityErrorCode =
  | 'breeding.baby-template.hash-mismatch'
  | 'breeding.baby-template.invalid-authority'
export class BreedingBabyTemplateAuthorityError extends Error {
  readonly code: BreedingBabyTemplateAuthorityErrorCode
  constructor(code: BreedingBabyTemplateAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingBabyTemplateAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingBabyTemplateAuthorityErrorCode, message: string): never => {
  throw new BreedingBabyTemplateAuthorityError(code, message)
}

export const parseAuthoritativeBreedingBabyTemplateAuthorityV1 = (
  value: unknown,
  path = 'babyTemplateAuthority',
): BreedingBabyTemplateAuthorityV1 => {
  const parsed = parseBreedingBabyTemplateAuthorityV1(value, path)
  if (sha256(withoutHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.baby-template.hash-mismatch', `${path} hash does not match its exact frozen mechanics and evidence.`)
  }
  return parsed
}

export const createBreedingBabyTemplateAuthorityV1 = (input: {
  readonly sourceEggId: BreedingBabyTemplateAuthorityV1['sourceEggId']
  readonly babyTemplate: PokemonEggBabyTemplateV1
  readonly marsupial: PokemonEggMarsupialV1 | null
}): BreedingBabyTemplateAuthorityV1 => {
  if (!input.babyTemplate.applied || !input.babyTemplate.effects) {
    return fail('breeding.baby-template.invalid-authority', 'Only one applied frozen Baby Template may create child authority.')
  }
  const applicationKind = input.marsupial ? 'marsupial' as const : 'campaign-option' as const
  if (input.marsupial) {
    const expectedEvidence = [marsupialInventoryEntry.mechanicFieldsSha256, marsupialInventoryEntry.recordSha256].sort(compare)
    if (input.babyTemplate.effects.baseStatPenaltyEach !== 5
      || input.babyTemplate.choiceOptionId !== null || input.babyTemplate.choiceEvidenceId !== null
      || input.marsupial.providerRecordSha256 !== marsupialInventoryEntry.recordSha256
      || input.marsupial.providerMechanicFieldsSha256 !== marsupialInventoryEntry.mechanicFieldsSha256
      || stableJsonStringify(input.marsupial.providerEvidenceDefinitionSha256s) !== stableJsonStringify(expectedEvidence)
      || input.marsupial.forcedBaseStatPenaltyEach !== 5 || input.marsupial.motherPouchRequired !== true
      || input.marsupial.removalLevel !== 25) {
      return fail('breeding.baby-template.invalid-authority', 'Marsupial must force the exact five-point template without a campaign choice.')
    }
  }
  else if (input.babyTemplate.effects.baseStatPenaltyEach < 2
    || input.babyTemplate.effects.baseStatPenaltyEach > 4
    || input.babyTemplate.choiceOptionId === null || input.babyTemplate.choiceEvidenceId === null) {
    return fail('breeding.baby-template.invalid-authority', 'Campaign Baby Template authority requires one exact bounded selected option.')
  }
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    applicationKind,
    effects: input.babyTemplate.effects,
    sourceEggId: input.sourceEggId,
    choiceOptionId: input.babyTemplate.choiceOptionId,
    choiceEvidenceId: input.babyTemplate.choiceEvidenceId,
    providerEvidenceDefinitionSha256s: Object.freeze(input.marsupial
      ? [...input.marsupial.providerEvidenceDefinitionSha256s].sort()
      : []),
  })
  return parseAuthoritativeBreedingBabyTemplateAuthorityV1({ ...definition, definitionSha256: sha256(definition) })
}

export const createBreedingMarsupialProviderTraitV1 = (): PokemonEggMarsupialV1 => Object.freeze({
  providerRecordSha256: marsupialInventoryEntry.recordSha256,
  providerMechanicFieldsSha256: marsupialInventoryEntry.mechanicFieldsSha256,
  providerEvidenceDefinitionSha256s: Object.freeze([
    marsupialInventoryEntry.mechanicFieldsSha256,
    marsupialInventoryEntry.recordSha256,
  ].sort(compare)),
  forcedBaseStatPenaltyEach: 5,
  motherPouchRequired: true,
  removalLevel: 25,
})

export const resolveBreedingMarsupialBabyTemplateV1 = (): PokemonEggBabyTemplateV1 & { readonly status: 'resolved', readonly resultDefinitionSha256: string } => {
  const effects = Object.freeze({
    baseStatPenaltyEach: 5,
    skillRankPenalty: 1 as const,
    capabilityPenalty: 2 as const,
    sizePercentOfAdult: 50,
    recoveryBaseStatPointsEachInterval: 1 as const,
    recoveryIntervalLevels: 5 as const,
    recoveryStepCount: 5,
    removeSkillAndCapabilityPenaltyAfterFinalRecovery: true as const,
  })
  const definition = Object.freeze({ applied: true, choiceOptionId: null, choiceEvidenceId: null, effects })
  return Object.freeze({ status: 'resolved' as const, ...definition, resultDefinitionSha256: sha256({
    ...definition,
    policyDefinitionSha256: BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  }) })
}

export const breedingBabyTemplateMechanicsV1 = (
  authorityValue: unknown,
): BreedingBabyTemplateMechanicsV1 => {
  const authority = parseAuthoritativeBreedingBabyTemplateAuthorityV1(authorityValue)
  return parseBreedingBabyTemplateMechanicsV1({
    schemaVersion: 1,
    applicationKind: authority.applicationKind,
    effects: authority.effects,
  })
}
