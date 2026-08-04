import traitPolicyJson from '../../../data/breeding-automation/trait-resolution-policy.json'
import {
  parseBreedingOfferOptionIdSyntax,
  type BreedingAbilityId,
  type BreedingOfferOptionId,
  type BreedingSpeciesId,
} from '#shared/breeding/ids'
import type { BreedingOffspringResolutionResult } from './offspringResolution'
import {
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  compiledBreedingSpeciesSpec,
} from './registry'
import {
  BREEDING_NATURE_DEFINITION_SHA256,
  breedingNature,
  breedingNatureForOrderedDice,
  type BreedingNatureId,
} from './natures'

export const BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256 = traitPolicyJson.definitionSha256
export const POKEMON_EDUCATION_RANKS = Object.freeze(['Untrained', 'Novice', 'Adept', 'Expert', 'Master'] as const)
export type PokemonEducationRank = typeof POKEMON_EDUCATION_RANKS[number]
export type BreedingOffspringGenderId = 'female' | 'male' | 'genderless'

interface TraitChoiceBase {
  readonly optionId: BreedingOfferOptionId
  readonly evidenceId: string
}
export interface BreedingNatureChoice extends TraitChoiceBase { readonly natureId: BreedingNatureId }
export interface BreedingAbilityChoice extends TraitChoiceBase { readonly abilityId: BreedingAbilityId }
export interface BreedingGenderChoice extends TraitChoiceBase { readonly genderId: BreedingOffspringGenderId }
export interface BreedingNatureRoll { readonly firstDie: number, readonly secondDie: number }
export interface ResolveBreedingTraitsInput {
  readonly offspring: BreedingOffspringResolutionResult
  readonly pokemonEducationRank: PokemonEducationRank
  readonly natureRoll: BreedingNatureRoll | null
  readonly natureChoice: BreedingNatureChoice | null
  readonly abilityRoll: number | null
  readonly abilityChoice: BreedingAbilityChoice | null
  readonly genderRoll: number | null
  readonly genderChoice: BreedingGenderChoice | null
}
export type BreedingTraitResolutionReasonId =
  | 'breeding.traits.offspring-unavailable'
  | 'breeding.traits.invalid-education-rank'
  | 'breeding.traits.nature-roll-required'
  | 'breeding.traits.nature-roll-invalid'
  | 'breeding.traits.nature-choice-unauthorized'
  | 'breeding.traits.nature-choice-invalid'
  | 'breeding.traits.ability-options-missing'
  | 'breeding.traits.ability-roll-required'
  | 'breeding.traits.ability-roll-invalid'
  | 'breeding.traits.ability-choice-unauthorized'
  | 'breeding.traits.ability-choice-invalid'
  | 'breeding.traits.gender-roll-required'
  | 'breeding.traits.gender-roll-invalid'
  | 'breeding.traits.gender-choice-unauthorized'
  | 'breeding.traits.gender-choice-invalid'
  | 'breeding.traits.extraneous-roll-or-choice'
export type BreedingTraitResolutionKind = 'random' | 'rank-choice' | 'fixed'
export interface BreedingResolvedTrait<Id extends string, Roll> {
  readonly id: Id
  readonly resolutionKind: BreedingTraitResolutionKind
  readonly roll: Roll | null
  readonly optionId: BreedingOfferOptionId | null
  readonly choiceEvidenceId: string | null
}
export interface ResolvedBreedingTraitsResult {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly offspringSpeciesId: BreedingSpeciesId
  readonly pokemonEducationRank: PokemonEducationRank
  readonly nature: BreedingResolvedTrait<BreedingNatureId, BreedingNatureRoll>
  readonly ability: BreedingResolvedTrait<BreedingAbilityId, number>
  readonly gender: BreedingResolvedTrait<BreedingOffspringGenderId, number>
  readonly speciesSpecDefinitionSha256: string
  readonly natureCatalogDefinitionSha256: string
  readonly traitPolicyDefinitionSha256: string
}
export interface UnavailableBreedingTraitsResult {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingTraitResolutionReasonId[]
  readonly offspringSpeciesId: BreedingSpeciesId | null
  readonly pokemonEducationRank: PokemonEducationRank | null
  readonly nature: null
  readonly ability: null
  readonly gender: null
  readonly speciesSpecDefinitionSha256: string | null
  readonly natureCatalogDefinitionSha256: string
  readonly traitPolicyDefinitionSha256: string
}
export type BreedingTraitsResult = ResolvedBreedingTraitsResult | UnavailableBreedingTraitsResult

const EVIDENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const RANK_INDEX = new Map(POKEMON_EDUCATION_RANKS.map((rank, index) => [rank, index]))
const REASONS = traitPolicyJson.definition.reasonIds as readonly BreedingTraitResolutionReasonId[]
const reasonOrder = new Map(REASONS.map((reason, index) => [reason, index]))
const orderedReasons = (values: Iterable<BreedingTraitResolutionReasonId>): readonly BreedingTraitResolutionReasonId[] => Object.freeze(
  [...new Set(values)].sort((left, right) => reasonOrder.get(left)! - reasonOrder.get(right)!),
)
const choiceBaseIsValid = (value: TraitChoiceBase): boolean => (
  parseBreedingOfferOptionIdSyntax(value.optionId) !== null && EVIDENCE.test(value.evidenceId)
)
const resolvedTrait = <Id extends string, Roll>(
  id: Id,
  resolutionKind: BreedingTraitResolutionKind,
  roll: Roll | null,
  choice: TraitChoiceBase | null,
): BreedingResolvedTrait<Id, Roll> => Object.freeze({
  id,
  resolutionKind,
  roll: roll && typeof roll === 'object' ? Object.freeze({ ...roll }) as Roll : roll,
  optionId: choice?.optionId ?? null,
  choiceEvidenceId: choice?.evidenceId ?? null,
})

export const resolveBreedingTraits = (input: ResolveBreedingTraitsInput): BreedingTraitsResult => {
  const reasons: BreedingTraitResolutionReasonId[] = []
  const rankIndex = RANK_INDEX.get(input.pokemonEducationRank)
  if (rankIndex === undefined) reasons.push('breeding.traits.invalid-education-rank')
  const offspringSpeciesId = input.offspring.status === 'resolved'
    && input.offspring.compiledRegistryDefinitionSha256 === COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256
    ? input.offspring.offspringSpeciesId
    : null
  const species = offspringSpeciesId ? compiledBreedingSpeciesSpec(offspringSpeciesId) : null
  if (!species) reasons.push('breeding.traits.offspring-unavailable')

  let nature: ResolvedBreedingTraitsResult['nature'] | null = null
  if (input.natureChoice) {
    if (input.natureRoll !== null) reasons.push('breeding.traits.extraneous-roll-or-choice')
    if (rankIndex === undefined || rankIndex < RANK_INDEX.get('Adept')!) {
      reasons.push('breeding.traits.nature-choice-unauthorized')
    }
    else {
      const selected = breedingNature(input.natureChoice.natureId)
      if (!choiceBaseIsValid(input.natureChoice) || !selected) reasons.push('breeding.traits.nature-choice-invalid')
      else nature = resolvedTrait(selected.id, 'rank-choice', null, input.natureChoice)
    }
  }
  else if (input.natureRoll === null) reasons.push('breeding.traits.nature-roll-required')
  else {
    const selected = breedingNatureForOrderedDice(input.natureRoll.firstDie, input.natureRoll.secondDie)
    if (!selected) reasons.push('breeding.traits.nature-roll-invalid')
    else nature = resolvedTrait(selected.id, 'random', input.natureRoll, null)
  }

  let ability: ResolvedBreedingTraitsResult['ability'] | null = null
  const abilityOptions = species?.basicAbilityIds ?? []
  if (abilityOptions.length < 1) reasons.push('breeding.traits.ability-options-missing')
  if (input.abilityChoice) {
    if (input.abilityRoll !== null) reasons.push('breeding.traits.extraneous-roll-or-choice')
    if (rankIndex === undefined || rankIndex < RANK_INDEX.get('Expert')!) {
      reasons.push('breeding.traits.ability-choice-unauthorized')
    }
    else if (!choiceBaseIsValid(input.abilityChoice) || !abilityOptions.includes(input.abilityChoice.abilityId)) {
      reasons.push('breeding.traits.ability-choice-invalid')
    }
    else ability = resolvedTrait(input.abilityChoice.abilityId, 'rank-choice', null, input.abilityChoice)
  }
  else if (input.abilityRoll === null) reasons.push('breeding.traits.ability-roll-required')
  else if (!Number.isSafeInteger(input.abilityRoll)
    || input.abilityRoll < 1
    || input.abilityRoll > abilityOptions.length) {
    reasons.push('breeding.traits.ability-roll-invalid')
  }
  else ability = resolvedTrait(abilityOptions[input.abilityRoll - 1]!, 'random', input.abilityRoll, null)

  let gender: ResolvedBreedingTraitsResult['gender'] | null = null
  if (species?.genderPolicy.kind === 'genderless') {
    if (input.genderRoll !== null || input.genderChoice !== null) reasons.push('breeding.traits.extraneous-roll-or-choice')
    else gender = resolvedTrait('genderless', 'fixed', null, null)
  }
  else if (input.genderChoice) {
    if (input.genderRoll !== null) reasons.push('breeding.traits.extraneous-roll-or-choice')
    if (rankIndex === undefined || rankIndex < RANK_INDEX.get('Master')!) {
      reasons.push('breeding.traits.gender-choice-unauthorized')
    }
    else if (!choiceBaseIsValid(input.genderChoice)
      || (input.genderChoice.genderId !== 'female' && input.genderChoice.genderId !== 'male')) {
      reasons.push('breeding.traits.gender-choice-invalid')
    }
    else gender = resolvedTrait(input.genderChoice.genderId, 'rank-choice', null, input.genderChoice)
  }
  else if (input.genderRoll === null) reasons.push('breeding.traits.gender-roll-required')
  else if (!Number.isSafeInteger(input.genderRoll) || input.genderRoll < 1 || input.genderRoll > 100) {
    reasons.push('breeding.traits.gender-roll-invalid')
  }
  else if (species?.genderPolicy.kind === 'ratio') {
    gender = resolvedTrait(
      input.genderRoll <= species.genderPolicy.femalePercent ? 'female' : 'male',
      'random',
      input.genderRoll,
      null,
    )
  }

  const finalReasons = orderedReasons(reasons)
  if (finalReasons.length > 0 || !species || !nature || !ability || !gender || rankIndex === undefined) {
    return Object.freeze({
      status: 'unavailable',
      reasonIds: finalReasons,
      offspringSpeciesId,
      pokemonEducationRank: rankIndex === undefined ? null : input.pokemonEducationRank,
      nature: null,
      ability: null,
      gender: null,
      speciesSpecDefinitionSha256: species?.definitionSha256 ?? null,
      natureCatalogDefinitionSha256: BREEDING_NATURE_DEFINITION_SHA256,
      traitPolicyDefinitionSha256: BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
    })
  }
  return Object.freeze({
    status: 'resolved',
    reasonIds: Object.freeze([]),
    offspringSpeciesId: species.speciesId,
    pokemonEducationRank: input.pokemonEducationRank,
    nature,
    ability,
    gender,
    speciesSpecDefinitionSha256: species.definitionSha256,
    natureCatalogDefinitionSha256: BREEDING_NATURE_DEFINITION_SHA256,
    traitPolicyDefinitionSha256: BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
  })
}
