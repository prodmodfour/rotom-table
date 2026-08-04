import offspringPolicyJson from '../../../data/breeding-automation/offspring-resolution-policy.json'
import {
  parseBreedingFamilyIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingFamilyId,
  type BreedingOfferOptionId,
  type BreedingSpeciesId,
} from '#shared/breeding/ids'
import type { BreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import type {
  BreedingCompatibilityParentFacts,
  BreedingCompatibilityResult,
  BreedingParentRoleId,
} from './compatibility'
import {
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  compiledBreedingFamilySpec,
  compiledBreedingSpeciesSpec,
} from './registry'

export const BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256 = offspringPolicyJson.definitionSha256

export interface BreedingFamilyChoice {
  readonly optionId: BreedingOfferOptionId
  readonly familyId: BreedingFamilyId
  readonly evidenceId: string
}
export interface BreedingSpeciesOverrideChoice {
  readonly optionId: BreedingOfferOptionId
  readonly speciesId: BreedingSpeciesId
  readonly evidenceId: string
}
export interface ResolveBreedingOffspringInput {
  readonly parents: readonly [BreedingCompatibilityParentFacts, BreedingCompatibilityParentFacts]
  readonly compatibility: BreedingCompatibilityResult
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly familyRoll: number | null
  readonly familyChoice: BreedingFamilyChoice | null
  readonly speciesOverride: BreedingSpeciesOverrideChoice | null
}
export type BreedingOffspringResolutionReasonId =
  | 'breeding.offspring.compatibility-unavailable'
  | 'breeding.offspring.parent-spec-unavailable'
  | 'breeding.offspring.parent-family-unavailable'
  | 'breeding.offspring.core-roll-required'
  | 'breeding.offspring.core-roll-invalid'
  | 'breeding.offspring.family-choice-required'
  | 'breeding.offspring.family-choice-invalid'
  | 'breeding.offspring.family-choice-not-allowed'
  | 'breeding.offspring.ditto-family-invalid'
  | 'breeding.offspring.selected-family-unavailable'
  | 'breeding.offspring.species-override-invalid'
  | 'breeding.offspring.species-override-not-allowed'
  | 'breeding.offspring.result-spec-unavailable'

export type BreedingFamilySelectionKind = 'core-d20' | 'maternal-family' | 'gm-family-choice' | 'canonical-ditto'
export interface ResolvedBreedingOffspringResult {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly selectionKind: BreedingFamilySelectionKind
  readonly selectedParentIndex: 0 | 1 | null
  readonly selectedRoleId: BreedingParentRoleId | null
  readonly familyRoll: number | null
  readonly familyChoiceOptionId: BreedingOfferOptionId | null
  readonly familyChoiceEvidenceId: string | null
  readonly selectedFamilyId: BreedingFamilyId
  readonly compiledRootSpeciesId: BreedingSpeciesId
  readonly offspringSpeciesId: BreedingSpeciesId
  readonly speciesOverrideOptionId: BreedingOfferOptionId | null
  readonly speciesOverrideEvidenceId: string | null
  readonly optionSnapshotDefinitionSha256: string
  readonly compiledRegistryDefinitionSha256: string
}
export interface UnavailableBreedingOffspringResult {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingOffspringResolutionReasonId[]
  readonly selectionKind: null
  readonly selectedParentIndex: null
  readonly selectedRoleId: null
  readonly familyRoll: number | null
  readonly familyChoiceOptionId: null
  readonly familyChoiceEvidenceId: null
  readonly selectedFamilyId: null
  readonly compiledRootSpeciesId: null
  readonly offspringSpeciesId: null
  readonly speciesOverrideOptionId: null
  readonly speciesOverrideEvidenceId: null
  readonly optionSnapshotDefinitionSha256: string
  readonly compiledRegistryDefinitionSha256: string
}
export type BreedingOffspringResolutionResult = ResolvedBreedingOffspringResult | UnavailableBreedingOffspringResult

const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const REASONS = offspringPolicyJson.definition.reasonIds as readonly BreedingOffspringResolutionReasonId[]
const reasonOrder = new Map(REASONS.map((reason, index) => [reason, index]))
const orderedReasons = (values: Iterable<BreedingOffspringResolutionReasonId>): readonly BreedingOffspringResolutionReasonId[] => Object.freeze(
  [...new Set(values)].sort((left, right) => reasonOrder.get(left)! - reasonOrder.get(right)!),
)
const validFamilyChoice = (choice: BreedingFamilyChoice | null): choice is BreedingFamilyChoice => (
  Boolean(choice)
  && parseBreedingOfferOptionIdSyntax(choice!.optionId) !== null
  && parseBreedingFamilyIdSyntax(choice!.familyId) !== null
  && EVIDENCE_ID.test(choice!.evidenceId)
)
const validSpeciesOverride = (choice: BreedingSpeciesOverrideChoice | null): choice is BreedingSpeciesOverrideChoice => (
  Boolean(choice)
  && parseBreedingOfferOptionIdSyntax(choice!.optionId) !== null
  && parseBreedingSpeciesIdSyntax(choice!.speciesId) !== null
  && EVIDENCE_ID.test(choice!.evidenceId)
)

export const resolveBreedingOffspring = (
  input: ResolveBreedingOffspringInput,
): BreedingOffspringResolutionResult => {
  const reasons: BreedingOffspringResolutionReasonId[] = []
  const parentSpecs = input.parents.map(parent => compiledBreedingSpeciesSpec(parent.speciesId))
  const parentFamilies = parentSpecs.map(spec => spec ? compiledBreedingFamilySpec(spec.familyId) : null)
  if (input.compatibility.status !== 'compatible'
    || input.compatibility.optionSnapshotDefinitionSha256 !== input.options.definitionSha256
    || input.compatibility.parentRoles.some((assignment, index) => assignment.parentRef !== input.parents[index].parentRef)) {
    reasons.push('breeding.offspring.compatibility-unavailable')
  }
  if (parentSpecs.some(spec => !spec)) reasons.push('breeding.offspring.parent-spec-unavailable')
  if (parentFamilies.some(family => !family)) reasons.push('breeding.offspring.parent-family-unavailable')

  let selectionKind: BreedingFamilySelectionKind | null = null
  let selectedParentIndex: 0 | 1 | null = null
  let selectedRoleId: BreedingParentRoleId | null = null
  let selectedFamilyId: BreedingFamilyId | null = null
  let usedFamilyRoll: number | null = null
  let familyChoiceOptionId: BreedingOfferOptionId | null = null
  let familyChoiceEvidenceId: string | null = null

  if (input.compatibility.status === 'compatible' && parentSpecs.every(Boolean) && parentFamilies.every(Boolean)) {
    const contributorIndexes = input.compatibility.familyContributorParentIndexes
    const dittoIndexes = input.parents
      .map((parent, index) => parent.speciesId === 'ditto' ? index as 0 | 1 : null)
      .filter((index): index is 0 | 1 => index !== null)
    if (dittoIndexes.length === 1) {
      if (contributorIndexes.length !== 1 || contributorIndexes[0] === dittoIndexes[0]) {
        reasons.push('breeding.offspring.ditto-family-invalid')
      }
      else {
        selectedParentIndex = contributorIndexes[0]!
        selectedRoleId = input.compatibility.parentRoles[selectedParentIndex].roleId
        selectedFamilyId = parentSpecs[selectedParentIndex]!.familyId
        selectionKind = 'canonical-ditto'
      }
      if (input.familyRoll !== null) reasons.push('breeding.offspring.core-roll-invalid')
      if (input.familyChoice !== null) reasons.push('breeding.offspring.family-choice-not-allowed')
    }
    else {
      const familyPolicy = input.options.values['breeding.parent-family-policy']
      if (familyPolicy === 'core-d20') {
        selectionKind = 'core-d20'
        if (input.familyRoll === null) reasons.push('breeding.offspring.core-roll-required')
        else if (!Number.isSafeInteger(input.familyRoll) || input.familyRoll < 1 || input.familyRoll > 20) {
          reasons.push('breeding.offspring.core-roll-invalid')
        }
        else {
          usedFamilyRoll = input.familyRoll
          selectedRoleId = input.familyRoll <= 4 ? 'male-parent' : 'female-parent'
          const index = input.compatibility.parentRoles.findIndex(role => role.roleId === selectedRoleId)
          if (index !== 0 && index !== 1) reasons.push('breeding.offspring.compatibility-unavailable')
          else {
            selectedParentIndex = index
            selectedFamilyId = parentSpecs[index]!.familyId
          }
        }
        if (input.familyChoice !== null) reasons.push('breeding.offspring.family-choice-not-allowed')
      }
      else if (familyPolicy === 'maternal-family') {
        selectionKind = 'maternal-family'
        selectedRoleId = 'female-parent'
        const index = input.compatibility.parentRoles.findIndex(role => role.roleId === selectedRoleId)
        if (index !== 0 && index !== 1) reasons.push('breeding.offspring.compatibility-unavailable')
        else {
          selectedParentIndex = index
          selectedFamilyId = parentSpecs[index]!.familyId
        }
        if (input.familyRoll !== null) reasons.push('breeding.offspring.core-roll-invalid')
        if (input.familyChoice !== null) reasons.push('breeding.offspring.family-choice-not-allowed')
      }
      else {
        selectionKind = 'gm-family-choice'
        if (input.familyRoll !== null) reasons.push('breeding.offspring.core-roll-invalid')
        if (!input.familyChoice) reasons.push('breeding.offspring.family-choice-required')
        else if (!validFamilyChoice(input.familyChoice)) reasons.push('breeding.offspring.family-choice-invalid')
        else {
          const contributorFamilies = new Set(contributorIndexes.map(index => parentSpecs[index]!.familyId))
          if (!contributorFamilies.has(input.familyChoice.familyId)) reasons.push('breeding.offspring.family-choice-invalid')
          else {
            selectedFamilyId = input.familyChoice.familyId
            const matching = contributorIndexes.filter(index => parentSpecs[index]!.familyId === selectedFamilyId)
            selectedParentIndex = matching.length === 1 ? matching[0]! : null
            selectedRoleId = selectedParentIndex === null ? null : input.compatibility.parentRoles[selectedParentIndex].roleId
            familyChoiceOptionId = input.familyChoice.optionId
            familyChoiceEvidenceId = input.familyChoice.evidenceId
          }
        }
      }
    }
  }

  const selectedFamily = selectedFamilyId ? compiledBreedingFamilySpec(selectedFamilyId) : null
  if (selectedFamilyId && !selectedFamily) reasons.push('breeding.offspring.selected-family-unavailable')
  let offspringSpeciesId = selectedFamily?.offspringRootSpeciesId ?? null
  let speciesOverrideOptionId: BreedingOfferOptionId | null = null
  let speciesOverrideEvidenceId: string | null = null
  if (input.speciesOverride) {
    if (input.options.values['breeding.form-root-policy'] !== 'gm-species-override') {
      reasons.push('breeding.offspring.species-override-not-allowed')
    }
    else if (!validSpeciesOverride(input.speciesOverride)
      || !selectedFamily
      || !selectedFamily.memberSpeciesIds.includes(input.speciesOverride.speciesId)
      || !compiledBreedingSpeciesSpec(input.speciesOverride.speciesId)) {
      reasons.push('breeding.offspring.species-override-invalid')
    }
    else {
      offspringSpeciesId = input.speciesOverride.speciesId
      speciesOverrideOptionId = input.speciesOverride.optionId
      speciesOverrideEvidenceId = input.speciesOverride.evidenceId
    }
  }
  if (offspringSpeciesId && !compiledBreedingSpeciesSpec(offspringSpeciesId)) {
    reasons.push('breeding.offspring.result-spec-unavailable')
  }

  const finalReasons = orderedReasons(reasons)
  if (finalReasons.length > 0 || !selectionKind || !selectedFamily || !offspringSpeciesId) {
    return Object.freeze({
      status: 'unavailable',
      reasonIds: finalReasons,
      selectionKind: null,
      selectedParentIndex: null,
      selectedRoleId: null,
      familyRoll: input.familyRoll,
      familyChoiceOptionId: null,
      familyChoiceEvidenceId: null,
      selectedFamilyId: null,
      compiledRootSpeciesId: null,
      offspringSpeciesId: null,
      speciesOverrideOptionId: null,
      speciesOverrideEvidenceId: null,
      optionSnapshotDefinitionSha256: input.options.definitionSha256,
      compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
    })
  }
  return Object.freeze({
    status: 'resolved',
    reasonIds: Object.freeze([]),
    selectionKind,
    selectedParentIndex,
    selectedRoleId,
    familyRoll: usedFamilyRoll,
    familyChoiceOptionId,
    familyChoiceEvidenceId,
    selectedFamilyId: selectedFamily.familyId,
    compiledRootSpeciesId: selectedFamily.offspringRootSpeciesId,
    offspringSpeciesId,
    speciesOverrideOptionId,
    speciesOverrideEvidenceId,
    optionSnapshotDefinitionSha256: input.options.definitionSha256,
    compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  })
}
