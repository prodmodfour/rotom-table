import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { POKEMON_EGG_SERPENTS_MARK_PATTERN_IDS, type PokemonEggProviderTraitsV1 } from '#shared/breeding/egg'
import type { BreedingOptionOfferRecordV1, BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingOfferId,
  type BreedingOfferOptionId,
  type BreedingOperationId,
  type BreedingProjectId,
} from '#shared/breeding/ids'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  breedingOffspringSelectedOfferEvidenceKey,
  parseBreedingOffspringResolutionProjectionV1,
  parseBreedingOffspringResolutionRecordV1,
  type BreedingOffspringResolutionProjectionV1,
  type BreedingOffspringResolutionRecordV1,
  type BreedingOffspringSelectedOfferEvidenceV1,
} from '#shared/breeding/offspringProduction'
import { parseBreedingProductionSnapshotV1 } from '#shared/breeding/productionSnapshots'
import { parseAuthoritativeBreedingOptionOfferRecordV1, parseAuthoritativeBreedingRollRecordV1, createBreedingOptionOfferRecordV1, createBreedingOptionOfferRevisionV1 } from './ledgers'
import { createBreedingOperationCommandHash } from './operations'
import { parseAuthoritativeBreedingProductionSnapshotV1 } from './productionSnapshots'
import { parseBreedingCampaignOptionSnapshotV1, type BreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import { evaluateBreedingCompatibility, type BreedingParentRoleOverride } from './compatibility'
import {
  BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256,
  resolveBreedingOffspring,
} from './offspringResolution'
import {
  BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
  POKEMON_EDUCATION_RANKS,
  resolveBreedingTraits,
} from './traitResolution'
import {
  BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
  buildBreedingInheritanceCandidates,
  createBreedingInheritanceParentSnapshot,
} from './inheritanceCandidates'
import {
  BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256,
  resolveBreedingBabyTemplate,
  resolveBreedingHatchStartingLevel,
} from './eggRuleHelpers'
import {
  BREEDING_NATURE_DEFINITION_SHA256,
  breedingNature,
} from './natures'
import {
  createPokemonEggOffspringBlueprintV1,
  parseAuthoritativePokemonEggOffspringBlueprintV1,
} from './lineage'
import {
  BREEDING_CANONICAL_ID_DEFINITION_SHA256,
  canonicalBreedingAbilityIdentity,
  canonicalBreedingSpeciesIdentity,
} from './canonicalIds'
import {
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  compiledBreedingFamilySpec,
  compiledBreedingSpeciesSpec,
} from './registry'
import {
  BREEDING_BABY_TEMPLATE_POLICY_DEFINITION,
  BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  createBreedingMarsupialProviderTraitV1,
  resolveBreedingMarsupialBabyTemplateV1,
} from './babyTemplate'

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
export const BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID = 'breeding.baby-template.gm-authority' as const
export const breedingBabyTemplateOptionDefinitionSha256V1 = (input: {
  readonly canonicalValueId: string
  readonly campaignOptionSnapshotDefinitionSha256: string
}): string => sha256({
  schemaVersion: 1,
  policyDefinitionSha256: BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  campaignOptionSnapshotDefinitionSha256: input.campaignOptionSnapshotDefinitionSha256,
  canonicalValueId: input.canonicalValueId,
})

export const breedingBabyTemplateOfferIdV1 = (
  projectId: BreedingProjectId,
  projectRevision: number,
  issuedOperationId: BreedingOperationId,
): BreedingOfferId => `breeding-offer:v1:${sha256(`baby-template-offer-v1\0${projectId}\0${projectRevision}\0${issuedOperationId}`).slice(0, 32)}` as BreedingOfferId

export const breedingBabyTemplateOfferOptionIdV1 = (
  projectId: BreedingProjectId,
  projectRevision: number,
  issuedOperationId: BreedingOperationId,
  canonicalValueId: string,
): BreedingOfferOptionId => `option:v1:${sha256(`baby-template-option-v1\0${projectId}\0${projectRevision}\0${issuedOperationId}\0${canonicalValueId}`).slice(0, 32)}` as BreedingOfferOptionId

/**
 * Issue the ordinary Breeding Project's optional-template decision from one
 * frozen campaign-option snapshot. The browser may select a returned option;
 * it cannot invent the values, evidence, or policy-bound value hashes.
 */
export const createBreedingBabyTemplateOptionOfferV1 = (inputValue: unknown): BreedingOptionOfferRecordV1 => {
  if (!inputValue || typeof inputValue !== 'object' || Array.isArray(inputValue)
    || (Object.getPrototypeOf(inputValue) !== Object.prototype && Object.getPrototypeOf(inputValue) !== null)
    || Object.getOwnPropertySymbols(inputValue).length > 0) {
    return fail('breeding.offspring-production.invalid-choice', 'Baby Template offer issuance requires one plain server input.')
  }
  const input = inputValue as Record<string, unknown>
  const fields = ['projectId','projectRevision','chooserProfileId','campaignOptionSnapshot','adultSizePercentages','issuedOperationId','issuedCommandSha256','issuedAtCampaignMinute','expiresAtCampaignMinute'] as const
  if (fields.some(field => !Object.hasOwn(input, field)) || Object.getOwnPropertyNames(input).some(field => !fields.includes(field as never))) {
    return fail('breeding.offspring-production.invalid-choice', 'Baby Template offer issuance rejects missing or enriched input.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.offspring-production.invalid-choice', 'Baby Template offer issuance rejects accessor-backed input.')
  }
  const projectId = parseBreedingProjectIdSyntax(input.projectId)
  const issuedOperationId = parseBreedingOperationIdSyntax(input.issuedOperationId)
  const projectRevision = Number.isSafeInteger(input.projectRevision) && Number(input.projectRevision) >= 0 ? Number(input.projectRevision) : null
  const issuedAt = Number.isSafeInteger(input.issuedAtCampaignMinute) && Number(input.issuedAtCampaignMinute) >= 0 ? Number(input.issuedAtCampaignMinute) : null
  const expiresAt = Number.isSafeInteger(input.expiresAtCampaignMinute) && Number(input.expiresAtCampaignMinute) >= 0 ? Number(input.expiresAtCampaignMinute) : null
  if (!projectId || !issuedOperationId || projectRevision === null || issuedAt === null || expiresAt === null || expiresAt <= issuedAt
    || expiresAt > issuedAt + 525_600 || typeof input.chooserProfileId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(input.chooserProfileId)
    || typeof input.issuedCommandSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(input.issuedCommandSha256)) {
    return fail('breeding.offspring-production.invalid-choice', 'Baby Template offer issuance identifiers, campaign times, chooser, and command hash must be exact bounded authority.')
  }
  const rawPercentages = input.adultSizePercentages
  if (!Array.isArray(rawPercentages) || rawPercentages.length < 1 || rawPercentages.length > 51
    || Object.getPrototypeOf(rawPercentages) !== Array.prototype || Object.getOwnPropertySymbols(rawPercentages).length > 0
    || Object.getOwnPropertyNames(rawPercentages).length !== rawPercentages.length + 1) {
    return fail('breeding.offspring-production.invalid-choice', 'Baby Template size choices must be one strict bounded server list.')
  }
  const percentages: number[] = []
  for (let index = 0; index < rawPercentages.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rawPercentages, String(index))
    const value = descriptor && 'value' in descriptor ? descriptor.value : null
    if (!descriptor?.enumerable || !Number.isSafeInteger(value) || Number(value) < 50 || Number(value) > 100
      || (index > 0 && percentages[index - 1]! >= Number(value))) {
      return fail('breeding.offspring-production.invalid-choice', 'Baby Template size choices must be unique canonical ascending percentages from 50 through 100.')
    }
    percentages.push(Number(value))
  }
  const campaignOptions = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  if (campaignOptions.values['breeding.baby-template-policy'] !== 'per-egg-gm-choice') {
    return fail('breeding.offspring-production.unavailable', 'Baby Template offers exist only under the frozen per-Egg GM-choice campaign policy.')
  }
  const canonicalValues = ['baby-template:decline', ...percentages.map(value => `baby-template:apply:size-percent:${value}`)]
  const options = canonicalValues.map(canonicalValueId => Object.freeze({
    optionId: breedingBabyTemplateOfferOptionIdV1(projectId, projectRevision, issuedOperationId, canonicalValueId),
    kind: 'baby-template' as const,
    canonicalValueId,
    valueDefinitionSha256: breedingBabyTemplateOptionDefinitionSha256V1({
      canonicalValueId,
      campaignOptionSnapshotDefinitionSha256: campaignOptions.definitionSha256,
    }),
    authorityEvidenceIds: Object.freeze([BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID]),
  })).sort((left, right) => compare(left.optionId, right.optionId))
  return createBreedingOptionOfferRecordV1({
    schemaVersion: 1,
    offerId: breedingBabyTemplateOfferIdV1(projectId, projectRevision, issuedOperationId),
    choiceKind: 'baby-template',
    target: { kind: 'breeding-project', projectId, revision: projectRevision },
    chooserProfileId: input.chooserProfileId,
    minimumPokemonEducationRank: null,
    options,
    issuedOperationId,
    issuedCommandSha256: input.issuedCommandSha256,
    issuedAtCampaignMinute: issuedAt,
    expiresAtCampaignMinute: expiresAt,
  })
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => { const { definitionSha256: _hash, ...definition } = value; return definition }
export type BreedingOffspringProductionAuthorityErrorCode =
  | 'breeding.offspring-production.hash-mismatch'
  | 'breeding.offspring-production.invalid-choice'
  | 'breeding.offspring-production.invalid-roll-set'
  | 'breeding.offspring-production.stale-authority'
  | 'breeding.offspring-production.unavailable'
  | 'breeding.offspring-production.unsupported-provider'
  | 'breeding.offspring-production.wrong-command'
export class BreedingOffspringProductionAuthorityError extends Error {
  readonly code: BreedingOffspringProductionAuthorityErrorCode
  constructor(code: BreedingOffspringProductionAuthorityErrorCode, message: string) { super(message); this.name = 'BreedingOffspringProductionAuthorityError'; this.code = code }
}
const fail = (code: BreedingOffspringProductionAuthorityErrorCode, message: string): never => { throw new BreedingOffspringProductionAuthorityError(code, message) }
const rankIndex = new Map(POKEMON_EDUCATION_RANKS.map((rank, index) => [rank, index]))
export const breedingCampaignOptionsFromProductionSnapshotV1 = (snapshot: ReturnType<typeof parseBreedingProductionSnapshotV1>): BreedingCampaignOptionSnapshotV1 => {
  const values = Object.fromEntries(snapshot.campaignOptionSnapshot.entries.map(entry => [entry.optionId, entry.value]))
  return parseBreedingCampaignOptionSnapshotV1({
    schemaVersion: 1,
    rulesetDefinitionSha256: snapshot.campaignOptionSnapshot.rulesetDefinitionSha256,
    values,
    definitionSha256: snapshot.campaignOptionSnapshot.sourceSnapshotDefinitionSha256,
  })
}
export const breedingOffspringRollSourceDefinitionHashes = (snapshotValue: unknown): readonly string[] => {
  const snapshot = parseAuthoritativeBreedingProductionSnapshotV1(snapshotValue)
  return Object.freeze([
    snapshot.definitionSha256,
    snapshot.referenceSnapshot.rulesetDefinitionSha256,
    BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256,
    BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
    BREEDING_NATURE_DEFINITION_SHA256,
    BREEDING_CANONICAL_ID_DEFINITION_SHA256,
    COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  ].filter((value, index, values) => values.indexOf(value) === index).sort(compare))
}
const rollByPurpose = (rolls: readonly BreedingRollRecordV1[], purpose: BreedingRollRecordV1['purpose']): BreedingRollRecordV1 | null => rolls.find(roll => roll.purpose === purpose) ?? null
const requestForPurpose: Partial<Record<BreedingRollRecordV1['purpose'], string>> = {
  'offspring-family-d20': 'offspring-family',
  'nature-ordered-2d6': 'nature',
  'ability-uniform-index': 'ability',
  'gender-d100': 'gender',
  'hatch-duration-percentage': 'hatch-duration',
  'provider-bounded': 'provider',
}
const offerEvidence = (offer: BreedingOptionOfferRecordV1, optionId: string): BreedingOffspringSelectedOfferEvidenceV1 => {
  const option = offer.options.find(value => value.optionId === optionId)!
  return Object.freeze({
    offerId: offer.offerId,
    offerRevision: 0,
    offerDefinitionSha256: offer.definitionSha256,
    choiceKind: offer.choiceKind as BreedingOffspringSelectedOfferEvidenceV1['choiceKind'],
    optionId: option.optionId,
    canonicalValueId: option.canonicalValueId,
    valueDefinitionSha256: option.valueDefinitionSha256,
    authorityEvidenceIds: option.authorityEvidenceIds,
  })
}
const validateSelectedOffers = (input: {
  readonly offers: readonly BreedingOptionOfferRecordV1[]
  readonly selectedOptionIds: readonly string[]
  readonly projectId: string
  readonly projectRevision: number
  readonly chooserProfileId: string
  readonly rank: string
  readonly operationId: string
  readonly commandSha256: string
  readonly at: number
}): { readonly selected: readonly BreedingOffspringSelectedOfferEvidenceV1[], readonly byKind: ReadonlyMap<string, BreedingOffspringSelectedOfferEvidenceV1>, readonly successors: readonly BreedingOptionOfferRecordV1[] } => {
  const parsed = input.offers.map((value, index) => parseAuthoritativeBreedingOptionOfferRecordV1(value, `offers[${index}]`))
  const selected: BreedingOffspringSelectedOfferEvidenceV1[] = []
  const successors: BreedingOptionOfferRecordV1[] = []
  const usedOffers = new Set<string>()
  for (const optionId of input.selectedOptionIds) {
    const matching = parsed.filter(offer => offer.options.some(option => option.optionId === optionId))
    if (matching.length !== 1) return fail('breeding.offspring-production.invalid-choice', 'Every selected option must belong to exactly one server-issued offer.')
    const offer = matching[0]!
    if (usedOffers.has(offer.offerId) || offer.status !== 'active' || offer.revision !== 0
      || offer.target.kind !== 'breeding-project' || offer.target.projectId !== input.projectId
      || offer.target.revision !== input.projectRevision || offer.chooserProfileId !== input.chooserProfileId
      || offer.issuedAtCampaignMinute > input.at
      || (offer.expiresAtCampaignMinute !== null && input.at >= offer.expiresAtCampaignMinute)
      || (offer.minimumPokemonEducationRank !== null
        && (rankIndex.get(input.rank as never) ?? -1) < (rankIndex.get(offer.minimumPokemonEducationRank) ?? Number.MAX_SAFE_INTEGER))) {
      return fail('breeding.offspring-production.invalid-choice', 'Selected offers must be active, current, unexpired, actor-bound, rank-authorized Project options.')
    }
    if (!['family','species','nature','ability','gender','hatch-duration','baby-template'].includes(offer.choiceKind)) {
      return fail('breeding.offspring-production.invalid-choice', 'Selected offer kind is not valid during offspring production.')
    }
    usedOffers.add(offer.offerId)
    const evidence = offerEvidence(offer, optionId)
    selected.push(evidence)
    successors.push(createBreedingOptionOfferRevisionV1({
      ...offer,
      revision: 1,
      status: 'consumed',
      selectedOptionId: evidence.optionId,
      settlementOperationId: input.operationId as never,
      settlementCommandSha256: input.commandSha256,
      settledAtCampaignMinute: input.at,
      settlementReasonId: null,
    }))
  }
  selected.sort((left, right) => compare(breedingOffspringSelectedOfferEvidenceKey(left), breedingOffspringSelectedOfferEvidenceKey(right)))
  const byKind = new Map<string, BreedingOffspringSelectedOfferEvidenceV1>()
  for (const evidence of selected) {
    if (byKind.has(evidence.choiceKind)) return fail('breeding.offspring-production.invalid-choice', 'At most one selected offer is allowed per offspring decision kind.')
    byKind.set(evidence.choiceKind, evidence)
  }
  return Object.freeze({ selected: Object.freeze(selected), byKind, successors: Object.freeze(successors) })
}
const checkRoll = (input: {
  readonly roll: BreedingRollRecordV1
  readonly commandHash: string
  readonly operationId: string
  readonly projectId: string
  readonly projectRevision: number
  readonly sourceDefinitionHashes: readonly string[]
  readonly at: number
}): BreedingRollRecordV1 => {
  const roll = parseAuthoritativeBreedingRollRecordV1(input.roll)
  if (roll.operationId !== input.operationId || roll.commandSha256 !== input.commandHash
    || roll.target.kind !== 'breeding-project' || roll.target.projectId !== input.projectId
    || roll.target.revision !== input.projectRevision || roll.generatedAtCampaignMinute !== input.at
    || !same(roll.sourceDefinitionHashes, input.sourceDefinitionHashes)
    || !(roll.purpose in requestForPurpose)) {
    return fail('breeding.offspring-production.invalid-roll-set', 'Every roll must be exact command-bound persisted server randomness for this Project snapshot and campaign minute.')
  }
  return roll
}
interface BreedingOffspringProductionBaseInputV1 {
  readonly productionSnapshot: unknown
  readonly command: unknown
  readonly offers: readonly BreedingOptionOfferRecordV1[]
  readonly roleOverride: BreedingParentRoleOverride | null
  readonly roleOverrideEvidenceDefinitionSha256: string | null
}
const productionBase = (input: BreedingOffspringProductionBaseInputV1) => {
  const snapshot = parseAuthoritativeBreedingProductionSnapshotV1(input.productionSnapshot)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'produce-egg') return fail('breeding.offspring-production.wrong-command', 'Offspring resolution requires produce-egg.')
  const commandHash = createBreedingOperationCommandHash(command)
  if (command.operationId !== snapshot.operationId || commandHash !== snapshot.commandSha256
    || command.payload.projectId !== snapshot.projectId || command.payload.eggId === undefined
    || command.scopes.find(scope => scope.kind === 'breeding-project')?.expectedRevision !== snapshot.projectRevision) {
    return fail('breeding.offspring-production.stale-authority', 'Command and production snapshot must identify the exact Project revision and future Egg.')
  }
  const isReviewedSerpentsMarkContribution = (
    contribution: (typeof snapshot.providerSnapshot.contributions)[number],
  ): boolean => contribution.inventoryEntryId === 'ability:Serpent’s Mark'
    && contribution.providerKind === 'ability'
    && contribution.providerId === 'ability.serpents-mark'
    && contribution.subjectKind === 'pokemon-sheet'
    && contribution.checkpoint === 'egg-acceptance'
    && contribution.contributionId === 'arbok-pattern-inheritance'
    && contribution.value.kind === 'canonical-id-set'
    && contribution.value.values.length === 1
    && POKEMON_EGG_SERPENTS_MARK_PATTERN_IDS.includes(contribution.value.values[0] as never)
  const unsupportedProvider = snapshot.providerSnapshot.contributions.find(
    contribution => !isReviewedSerpentsMarkContribution(contribution),
  )
  if (unsupportedProvider) {
    return fail('breeding.offspring-production.unsupported-provider', 'Only the reviewed Serpent’s Mark Egg-acceptance contribution is active in BR-062 offspring production.')
  }
  // Distinct-parent ownership is a Serpent’s Mark mechanic, not a generic
  // provider rule. Future reviewed contributions from one subject must define
  // their own cardinality instead of inheriting this restriction.
  const serpentsMarkSubjects = new Set<string>()
  for (const contribution of snapshot.providerSnapshot.contributions.filter(isReviewedSerpentsMarkContribution)) {
    const parent = snapshot.parents.find(candidate => candidate.pokemonSheetSlug === contribution.subjectId)
    if (!parent || parent.sheetRevision !== contribution.subjectRevision || serpentsMarkSubjects.has(contribution.subjectId)) {
      return fail('breeding.offspring-production.stale-authority', 'Serpent’s Mark contributions must bind distinct exact frozen parent revisions.')
    }
    serpentsMarkSubjects.add(contribution.subjectId)
  }
  const options = breedingCampaignOptionsFromProductionSnapshotV1(snapshot)
  const parents = snapshot.parents.map(parent => ({
    parentRef: parent.pokemonSheetSlug,
    speciesId: parent.speciesId,
    genderId: parent.genderId,
    level: parent.level,
    eggGroupIds: parent.eggGroupIds,
    gmMaturityConfirmed: parent.maturity.policyId === 'gm-confirmed-per-parent' && parent.maturity.gmConfirmed === true,
  })) as never
  const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: input.roleOverride })
  if (compatibility.status !== 'compatible' || compatibility.parentRoles.some((assignment, index) => assignment.roleId !== snapshot.parents[index]!.roleId)) {
    return fail('breeding.offspring-production.stale-authority', 'Frozen parent roles must reproduce the exact compatible result.')
  }
  if (compatibility.compatibilityKind === 'gm-role-override'
    && (!input.roleOverrideEvidenceDefinitionSha256
      || snapshot.parents.some(parent => parent.roleEvidenceDefinitionSha256 !== input.roleOverrideEvidenceDefinitionSha256))) {
    return fail('breeding.offspring-production.stale-authority', 'GM parent roles require the exact frozen bounded evidence hash.')
  }
  const choices = validateSelectedOffers({
    offers: input.offers,
    selectedOptionIds: command.payload.resolutions.selectedOptionIds,
    projectId: snapshot.projectId,
    projectRevision: snapshot.projectRevision,
    chooserProfileId: command.actor.profileId,
    rank: snapshot.breeder.pokemonEducationRank,
    operationId: command.operationId,
    commandSha256: commandHash,
    at: snapshot.capturedAtCampaignMinute,
  })
  return Object.freeze({ snapshot, command, commandHash, options, parents, compatibility, choices })
}
const resolveProductionOffspring = (base: ReturnType<typeof productionBase>, familyRoll: BreedingRollRecordV1 | null) => {
  const familyChoice = base.choices.byKind.get('family')
  const speciesChoice = base.choices.byKind.get('species')
  const offspring = resolveBreedingOffspring({
    parents: base.parents,
    compatibility: base.compatibility,
    options: base.options,
    familyRoll: familyRoll?.total ?? null,
    familyChoice: familyChoice ? { optionId: familyChoice.optionId, familyId: familyChoice.canonicalValueId as never, evidenceId: familyChoice.authorityEvidenceIds[0]! } : null,
    speciesOverride: speciesChoice ? { optionId: speciesChoice.optionId, speciesId: speciesChoice.canonicalValueId as never, evidenceId: speciesChoice.authorityEvidenceIds[0]! } : null,
  })
  if (offspring.status !== 'resolved') return fail('breeding.offspring-production.unavailable', `Offspring species is unavailable: ${offspring.reasonIds.join(',')}`)
  return offspring
}
const serpentsMarkContributions = (snapshot: ReturnType<typeof parseAuthoritativeBreedingProductionSnapshotV1>) => snapshot.providerSnapshot.contributions
  .filter(contribution => contribution.inventoryEntryId === 'ability:Serpent’s Mark')
  .sort((left, right) => compare(left.subjectId, right.subjectId))

export interface BreedingOffspringRollRequirementsV1 {
  readonly requestedRollKinds: readonly ('offspring-family'|'nature'|'ability'|'gender'|'hatch-duration'|'provider')[]
  readonly abilityDieSides: number | null
  readonly sourceDefinitionHashes: readonly string[]
}
export const resolveBreedingOffspringRollRequirementsV1 = (input: BreedingOffspringProductionBaseInputV1 & {
  readonly familyRoll: BreedingRollRecordV1 | null
}): BreedingOffspringRollRequirementsV1 => {
  const base = productionBase(input)
  const sourceDefinitionHashes = breedingOffspringRollSourceDefinitionHashes(base.snapshot)
  const familyRoll = input.familyRoll === null ? null : checkRoll({
    roll: input.familyRoll,
    commandHash: base.commandHash,
    operationId: base.command.operationId,
    projectId: base.snapshot.projectId,
    projectRevision: base.snapshot.projectRevision,
    sourceDefinitionHashes,
    at: base.snapshot.capturedAtCampaignMinute,
  })
  const offspring = resolveProductionOffspring(base, familyRoll)
  const species = compiledBreedingSpeciesSpec(offspring.offspringSpeciesId)
  if (!species) return fail('breeding.offspring-production.unavailable', 'Resolved offspring Species is absent from the compiled registry.')
  const durationVariation = base.options.values['breeding.hatch-duration-variation']
  const durationChoice = base.choices.byKind.get('hatch-duration')
  if (durationVariation !== 'gm-within-half-to-double' && durationChoice) {
    return fail('breeding.offspring-production.invalid-choice', 'A hatch-duration offer is valid only for the bounded GM variation policy.')
  }
  if (durationVariation === 'gm-within-half-to-double' && !durationChoice) {
    return fail('breeding.offspring-production.invalid-choice', 'Bounded GM hatch-duration variation requires exactly one current selected duration offer.')
  }
  const requestedRollKinds: ('offspring-family'|'nature'|'ability'|'gender'|'hatch-duration'|'provider')[] = []
  if (offspring.selectionKind === 'core-d20') requestedRollKinds.push('offspring-family')
  if (!base.choices.byKind.has('nature')) requestedRollKinds.push('nature')
  if (!base.choices.byKind.has('ability')) requestedRollKinds.push('ability')
  if (species.genderPolicy.kind !== 'genderless' && !base.choices.byKind.has('gender')) requestedRollKinds.push('gender')
  if (durationVariation === 'server-random-half-to-double') requestedRollKinds.push('hatch-duration')
  const markContributions = offspring.compiledRootSpeciesId === 'ekans' ? serpentsMarkContributions(base.snapshot) : []
  if (markContributions.length === 2 && markContributions[0]!.value.kind === 'canonical-id-set'
    && markContributions[1]!.value.kind === 'canonical-id-set'
    && markContributions[0]!.value.values[0] !== markContributions[1]!.value.values[0]) requestedRollKinds.push('provider')
  if (!same(base.command.payload.resolutions.requestedRollKinds, requestedRollKinds)) {
    return fail('breeding.offspring-production.invalid-roll-set', 'Command roll declarations must exactly equal server-derived family and trait requirements.')
  }
  return Object.freeze({
    requestedRollKinds: Object.freeze(requestedRollKinds),
    abilityDieSides: base.choices.byKind.has('ability') ? null : species.basicAbilityIds.length,
    sourceDefinitionHashes,
  })
}
export interface PlanBreedingOffspringResolutionInputV1 extends BreedingOffspringProductionBaseInputV1 {
  readonly rolls: readonly BreedingRollRecordV1[]
}
export interface PlannedBreedingOffspringResolutionV1 {
  readonly record: BreedingOffspringResolutionRecordV1
  readonly consumedOffers: readonly BreedingOptionOfferRecordV1[]
}
export const planBreedingOffspringResolutionV1 = (
  input: PlanBreedingOffspringResolutionInputV1,
): PlannedBreedingOffspringResolutionV1 => {
  const base = productionBase(input)
  const { snapshot, command, commandHash, options, choices } = base
  const rollSourceDefinitionHashes = breedingOffspringRollSourceDefinitionHashes(snapshot)
  const rolls = input.rolls.map(roll => checkRoll({ roll, commandHash, operationId: command.operationId,
    projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
    sourceDefinitionHashes: rollSourceDefinitionHashes,
    at: snapshot.capturedAtCampaignMinute }))
  const ordinals = rolls.map(roll => roll.operationRollOrdinal)
  if (new Set(ordinals).size !== rolls.length || ordinals.some((ordinal, index) => ordinal !== index)) {
    return fail('breeding.offspring-production.invalid-roll-set', 'Operation rolls must form one gap-free ordinal sequence.')
  }
  const requested = command.payload.resolutions.requestedRollKinds
  const actualRequests = rolls.map(roll => requestForPurpose[roll.purpose]!)
  if (!same(requested, actualRequests)) return fail('breeding.offspring-production.invalid-roll-set', 'Requested roll kinds must exactly equal persisted rolls in declared order.')
  const familyChoice = choices.byKind.get('family')
  const speciesChoice = choices.byKind.get('species')
  const familyRoll = rollByPurpose(rolls, 'offspring-family-d20')
  const offspring = resolveProductionOffspring(base, familyRoll)
  resolveBreedingOffspringRollRequirementsV1({
    productionSnapshot: snapshot,
    command,
    offers: input.offers,
    roleOverride: input.roleOverride,
    roleOverrideEvidenceDefinitionSha256: input.roleOverrideEvidenceDefinitionSha256,
    familyRoll,
  })
  const natureChoice = choices.byKind.get('nature')
  const abilityChoice = choices.byKind.get('ability')
  const genderChoice = choices.byKind.get('gender')
  const natureRoll = rollByPurpose(rolls, 'nature-ordered-2d6')
  const abilityRoll = rollByPurpose(rolls, 'ability-uniform-index')
  const genderRoll = rollByPurpose(rolls, 'gender-d100')
  const hatchDurationRoll = rollByPurpose(rolls, 'hatch-duration-percentage')
  const providerRoll = rollByPurpose(rolls, 'provider-bounded')
  const offspringSpec = compiledBreedingSpeciesSpec(offspring.offspringSpeciesId)
  if (!offspringSpec || (abilityRoll !== null && abilityRoll.dieSides !== offspringSpec.basicAbilityIds.length)) {
    return fail('breeding.offspring-production.invalid-roll-set', 'Ability uniform-index die sides must equal the exact sorted Basic Ability inventory.')
  }
  const traits = resolveBreedingTraits({
    offspring,
    pokemonEducationRank: snapshot.breeder.pokemonEducationRank,
    natureRoll: natureRoll ? { firstDie: natureRoll.values[0]!, secondDie: natureRoll.values[1]! } : null,
    natureChoice: natureChoice ? { optionId: natureChoice.optionId, natureId: natureChoice.canonicalValueId as never, evidenceId: natureChoice.authorityEvidenceIds[0]! } : null,
    abilityRoll: abilityRoll?.total ?? null,
    abilityChoice: abilityChoice ? { optionId: abilityChoice.optionId, abilityId: abilityChoice.canonicalValueId as never, evidenceId: abilityChoice.authorityEvidenceIds[0]! } : null,
    genderRoll: genderRoll?.total ?? null,
    genderChoice: genderChoice ? { optionId: genderChoice.optionId, genderId: genderChoice.canonicalValueId as never, evidenceId: genderChoice.authorityEvidenceIds[0]! } : null,
  })
  if (traits.status !== 'resolved') return fail('breeding.offspring-production.unavailable', `Offspring traits are unavailable: ${traits.reasonIds.join(',')}`)
  const parentMoveSnapshots = snapshot.parents.map(parent => createBreedingInheritanceParentSnapshot({
    schemaVersion: 1,
    parentRef: parent.pokemonSheetSlug,
    speciesId: parent.speciesId,
    sourceSheetSha256: parent.sourceSheetSha256,
    effectiveKnownMoves: parent.effectiveKnownMoves,
  })) as unknown as Parameters<typeof buildBreedingInheritanceCandidates>[0]['parentSnapshots']
  if (parentMoveSnapshots.some((parent, index) => parent.definitionSha256 !== snapshot.parents[index]!.effectiveMoveSnapshotDefinitionSha256)) {
    return fail('breeding.offspring-production.stale-authority', 'Inheritance inputs must equal the frozen parent effective-Move snapshots.')
  }
  const inheritance = buildBreedingInheritanceCandidates({ offspring, parentSnapshots: parentMoveSnapshots })
  if (inheritance.status !== 'resolved') return fail('breeding.offspring-production.unavailable', `Inheritance is unavailable: ${inheritance.reasonIds.join(',')}`)
  const startingLevel = resolveBreedingHatchStartingLevel('breeding', options)
  const babyChoice = choices.byKind.get('baby-template')
  const marsupialBaby = offspring.offspringSpeciesId === 'kangaskhan'
  if (marsupialBaby && babyChoice) return fail('breeding.offspring-production.invalid-choice', 'Marsupial forces Baby Template authority and rejects a campaign-choice substitute.')
  let baby
  if (marsupialBaby) baby = resolveBreedingMarsupialBabyTemplateV1()
  else {
    let choice: Parameters<typeof resolveBreedingBabyTemplate>[1] = null
    if (babyChoice) {
      if (!babyChoice.authorityEvidenceIds.includes(BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID)
        || babyChoice.valueDefinitionSha256 !== breedingBabyTemplateOptionDefinitionSha256V1({
          canonicalValueId: babyChoice.canonicalValueId,
          campaignOptionSnapshotDefinitionSha256: options.definitionSha256,
        })) {
        return fail('breeding.offspring-production.invalid-choice', 'Optional Baby Template selection requires exact server-issued GM authority evidence and policy-bound option value.')
      }
      const applyMatch = /^baby-template:apply:size-percent:(50|5[1-9]|[6-9][0-9]|100)$/u.exec(babyChoice.canonicalValueId)
      const decline = babyChoice.canonicalValueId === 'baby-template:decline'
      if (!decline && !applyMatch) return fail('breeding.offspring-production.invalid-choice', 'Baby Template offer must bind decline or one bounded adult-size percentage.')
      choice = {
        optionId: babyChoice.optionId,
        evidenceId: BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID,
        apply: !decline,
        sizePercentOfAdult: applyMatch ? Number(applyMatch[1]) : null,
      }
    }
    baby = resolveBreedingBabyTemplate(options, choice)
  }
  if (startingLevel.status !== 'resolved' || baby.status !== 'resolved') return fail('breeding.offspring-production.unavailable', 'Starting Level or Baby Template policy is not currently resolvable.')
  const traitValue = <Value extends string>(trait: typeof traits.nature | typeof traits.ability | typeof traits.gender, roll: BreedingRollRecordV1 | null) => ({
    valueId: trait.id as Value,
    resolutionKind: trait.resolutionKind,
    rollRecordId: trait.resolutionKind === 'random' ? roll!.rollRecordId : null,
    optionId: trait.optionId,
    choiceEvidenceId: trait.choiceEvidenceId,
  })
  const markContributions = offspring.compiledRootSpeciesId === 'ekans' ? serpentsMarkContributions(snapshot) : []
  let providerTraits: PokemonEggProviderTraitsV1 = Object.freeze({
    serpentsMark: null,
    fossilRestoration: null,
    prehistoricBond: null,
    marsupial: marsupialBaby ? createBreedingMarsupialProviderTraitV1() : null,
    playingGod: null,
  })
  if (markContributions.length > 0) {
    const patterns = markContributions.map(contribution => contribution.value.kind === 'canonical-id-set' ? contribution.value.values[0]! : '')
    const differing = patterns.length === 2 && patterns[0] !== patterns[1]
    if ((differing && (!providerRoll || providerRoll.dieCount !== 1 || providerRoll.dieSides !== 2 || providerRoll.total < 1 || providerRoll.total > 2))
      || (!differing && providerRoll !== null)) return fail('breeding.offspring-production.invalid-roll-set', 'Serpent’s Mark requires exactly one d2 only when two frozen parent patterns differ.')
    const selectedIndex = differing ? providerRoll!.total - 1 : 0
    const selectedPattern = patterns[selectedIndex]!
    providerTraits = Object.freeze({
      serpentsMark: Object.freeze({
        patternId: selectedPattern as typeof POKEMON_EGG_SERPENTS_MARK_PATTERN_IDS[number],
        selectionKind: markContributions.length === 1 ? 'single-parent' : differing ? 'bounded-coin' : 'same-parent-pattern',
        sourceParentSheetSlugs: Object.freeze(markContributions.map(contribution => contribution.subjectId).sort(compare)),
        selectionRollRecordId: differing ? providerRoll!.rollRecordId : null,
        providerEvidenceDefinitionSha256s: Object.freeze(markContributions.map(contribution => contribution.definitionSha256).sort(compare)),
      }),
      fossilRestoration: null,
      prehistoricBond: null,
      marsupial: null,
      playingGod: null,
    })
  }
  else if (providerRoll) return fail('breeding.offspring-production.invalid-roll-set', 'Provider randomness is extraneous without an applicable Serpent’s Mark inheritance.')
  const candidates = inheritance.candidates.map(candidate => ({
    moveId: candidate.moveId,
    sources: candidate.sources.map(source => ({ kind: 'parent' as const, ...source })),
  }))
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: offspring.offspringSpeciesId,
    familyRootSpeciesId: offspring.compiledRootSpeciesId,
    speciesSpecDefinitionSha256: traits.speciesSpecDefinitionSha256,
    nature: traitValue(traits.nature, natureRoll),
    ability: traitValue(traits.ability, abilityRoll),
    gender: traitValue(traits.gender, genderRoll),
    inheritanceCandidates: candidates,
    providerTraits,
    startingLevel: startingLevel.startingLevel,
    babyTemplate: { applied: baby.applied, choiceOptionId: baby.choiceOptionId, choiceEvidenceId: baby.choiceEvidenceId, effects: baby.effects },
  })
  const normalizedBlueprintCandidates = blueprint.inheritanceCandidates.map(candidate => ({
    moveId: candidate.moveId,
    sources: candidate.sources.map(source => {
      if (source.kind !== 'parent') return source
      const { kind: _kind, ...parentSource } = source
      return parentSource
    }),
  }))
  if (sha256(normalizedBlueprintCandidates) !== inheritance.candidateSetDefinitionSha256) {
    return fail('breeding.offspring-production.hash-mismatch', 'Blueprint inheritance candidates must exactly equal the frozen resolved candidate set.')
  }
  const familyEvidence = {
    selectionKind: offspring.selectionKind,
    selectedParentIndex: offspring.selectedParentIndex,
    selectedRoleId: offspring.selectedRoleId,
    familyRollRecordId: familyRoll?.rollRecordId ?? null,
    familyChoiceOfferId: familyChoice?.offerId ?? null,
    familyChoiceOptionId: offspring.familyChoiceOptionId,
    familyChoiceEvidenceId: offspring.familyChoiceEvidenceId,
    selectedFamilyId: offspring.selectedFamilyId,
    compiledRootSpeciesId: offspring.compiledRootSpeciesId,
    offspringSpeciesId: offspring.offspringSpeciesId,
    speciesOverrideOfferId: speciesChoice?.offerId ?? null,
    speciesOverrideOptionId: offspring.speciesOverrideOptionId,
    speciesOverrideEvidenceId: offspring.speciesOverrideEvidenceId,
  }
  const sourceHashes = [
    ...snapshot.acceptedDefinitionHashes,
    snapshot.definitionSha256,
    blueprint.definitionSha256,
    BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256,
    BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
    BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
    BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256,
    BREEDING_NATURE_DEFINITION_SHA256,
    BREEDING_CANONICAL_ID_DEFINITION_SHA256,
    COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
    inheritance.candidateSetDefinitionSha256,
    startingLevel.resultDefinitionSha256,
    baby.resultDefinitionSha256,
    ...(marsupialBaby ? [
      BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
      BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderRecordSha256,
      BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderMechanicFieldsSha256,
    ] : []),
    ...rolls.map(roll => roll.definitionSha256),
    ...choices.selected.map(offer => offer.offerDefinitionSha256),
  ].filter((value, index, values) => values.indexOf(value) === index).sort(compare)
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    projectId: snapshot.projectId,
    projectRevision: snapshot.projectRevision,
    eggId: command.payload.eggId,
    operationId: command.operationId,
    commandSha256: commandHash,
    productionSnapshot: snapshot,
    family: familyEvidence,
    blueprint,
    hatchDurationRollRecordId: hatchDurationRoll?.rollRecordId ?? null,
    rollRecordIds: Object.freeze(rolls.map(roll => roll.rollRecordId).sort(compare)),
    selectedOffers: choices.selected,
    sourceEvidenceDefinitionHashes: Object.freeze(sourceHashes),
    resolvedAtCampaignMinute: snapshot.capturedAtCampaignMinute,
  })
  const record = parseAuthoritativeBreedingOffspringResolutionRecordV1({ ...definition, definitionSha256: sha256(definition) })
  return Object.freeze({ record, consumedOffers: choices.successors })
}
export const parseAuthoritativeBreedingOffspringResolutionRecordV1 = (value: unknown, path='offspringResolutionRecord'): BreedingOffspringResolutionRecordV1 => {
  const record = parseBreedingOffspringResolutionRecordV1(value, path)
  if (sha256(withoutHash(record)) !== record.definitionSha256) return fail('breeding.offspring-production.hash-mismatch', 'Offspring resolution record hash does not match its exact definition.')
  parseAuthoritativeBreedingProductionSnapshotV1(record.productionSnapshot, `${path}.productionSnapshot`)
  parseAuthoritativePokemonEggOffspringBlueprintV1(record.blueprint, `${path}.blueprint`)
  if (record.productionSnapshot.projectId !== record.projectId || record.productionSnapshot.projectRevision !== record.projectRevision
    || record.productionSnapshot.operationId !== record.operationId || record.productionSnapshot.commandSha256 !== record.commandSha256
    || record.family.offspringSpeciesId !== record.blueprint.speciesId
    || record.family.compiledRootSpeciesId !== record.blueprint.familyRootSpeciesId
    || !record.sourceEvidenceDefinitionHashes.includes(record.productionSnapshot.definitionSha256)
    || !record.sourceEvidenceDefinitionHashes.includes(record.blueprint.definitionSha256)) {
    return fail('breeding.offspring-production.hash-mismatch', 'Resolution record, production snapshot, family evidence, blueprint, and source hashes must agree.')
  }
  const usedRolls = [record.family.familyRollRecordId, record.blueprint.nature.rollRecordId,
    record.blueprint.ability.rollRecordId, record.blueprint.gender.rollRecordId, record.hatchDurationRollRecordId,
    record.blueprint.providerTraits.serpentsMark?.selectionRollRecordId ?? null]
    .filter((value): value is NonNullable<typeof value> => value !== null).sort(compare)
  if (!same(usedRolls, record.rollRecordIds)) return fail('breeding.offspring-production.hash-mismatch', 'Roll list must equal every family and trait roll reference exactly.')
  const selectedOptionIds = new Set(record.selectedOffers.map(value => value.optionId))
  for (const optionId of [record.family.familyChoiceOptionId, record.family.speciesOverrideOptionId,
    record.blueprint.nature.optionId, record.blueprint.ability.optionId, record.blueprint.gender.optionId,
    record.blueprint.babyTemplate.choiceOptionId, record.selectedOffers.find(value => value.choiceKind === 'hatch-duration')?.optionId ?? null].filter((value): value is NonNullable<typeof value> => value !== null)) {
    if (!selectedOptionIds.delete(optionId)) return fail('breeding.offspring-production.hash-mismatch', 'Every bounded option must have exactly one selected-offer evidence row.')
  }
  if (selectedOptionIds.size > 0) return fail('breeding.offspring-production.hash-mismatch', 'Selected offers cannot be extraneous to the frozen family, traits, or template.')
  const selectedOffer = (kind: BreedingOffspringSelectedOfferEvidenceV1['choiceKind']) => record.selectedOffers.find(value => value.choiceKind === kind) ?? null
  const optionMatches = (kind: BreedingOffspringSelectedOfferEvidenceV1['choiceKind'], optionId: string | null, valueId: string, evidenceId: string | null): boolean => {
    const offer = selectedOffer(kind)
    return optionId === null ? offer === null : Boolean(offer && offer.optionId === optionId
      && offer.canonicalValueId === valueId && evidenceId !== null && offer.authorityEvidenceIds.includes(evidenceId))
  }
  if (!optionMatches('family', record.family.familyChoiceOptionId, record.family.selectedFamilyId, record.family.familyChoiceEvidenceId)
    || !optionMatches('species', record.family.speciesOverrideOptionId, record.family.offspringSpeciesId, record.family.speciesOverrideEvidenceId)
    || !optionMatches('nature', record.blueprint.nature.optionId, record.blueprint.nature.valueId, record.blueprint.nature.choiceEvidenceId)
    || !optionMatches('ability', record.blueprint.ability.optionId, record.blueprint.ability.valueId, record.blueprint.ability.choiceEvidenceId)
    || !optionMatches('gender', record.blueprint.gender.optionId, record.blueprint.gender.valueId, record.blueprint.gender.choiceEvidenceId)
    || !optionMatches('baby-template', record.blueprint.babyTemplate.choiceOptionId,
      record.blueprint.babyTemplate.applied
        ? `baby-template:apply:size-percent:${record.blueprint.babyTemplate.effects!.sizePercentOfAdult}`
        : 'baby-template:decline',
      record.blueprint.babyTemplate.choiceEvidenceId)
    || (selectedOffer('hatch-duration') !== null && !/^campaign-minutes:[1-9][0-9]{0,7}$/u.test(selectedOffer('hatch-duration')!.canonicalValueId))) {
    return fail('breeding.offspring-production.hash-mismatch', 'Selected-offer canonical values and authority evidence must exactly match each bounded blueprint decision.')
  }
  const speciesSpec = compiledBreedingSpeciesSpec(record.blueprint.speciesId)
  const familySpec = compiledBreedingFamilySpec(record.family.selectedFamilyId)
  if (!speciesSpec || speciesSpec.definitionSha256 !== record.blueprint.speciesSpecDefinitionSha256
    || !familySpec || familySpec.offspringRootSpeciesId !== record.blueprint.familyRootSpeciesId
    || canonicalBreedingSpeciesIdentity(record.blueprint.speciesId) === null
    || canonicalBreedingAbilityIdentity(record.blueprint.ability.valueId) === null
    || !speciesSpec.basicAbilityIds.includes(record.blueprint.ability.valueId)
    || breedingNature(record.blueprint.nature.valueId) === null) {
    return fail('breeding.offspring-production.stale-authority', 'Blueprint species, Family, Nature, and Basic Ability must exist in the current app-owned compiled authorities.')
  }
  const marsupial = record.blueprint.providerTraits.marsupial ?? null
  if ((record.blueprint.speciesId === 'kangaskhan') !== (marsupial !== null)
    || (marsupial !== null && (!record.blueprint.babyTemplate.applied
      || record.blueprint.babyTemplate.effects?.baseStatPenaltyEach !== 5
      || marsupial.providerRecordSha256 !== BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderRecordSha256
      || marsupial.providerMechanicFieldsSha256 !== BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderMechanicFieldsSha256
      || !record.sourceEvidenceDefinitionHashes.includes(BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256)))) {
    return fail('breeding.offspring-production.stale-authority', 'Kangaskhan must retain the exact reviewed Marsupial Baby Template authority.')
  }
  const frozenMarks = record.blueprint.familyRootSpeciesId === 'ekans' ? serpentsMarkContributions(record.productionSnapshot) : []
  const inheritedMark = record.blueprint.providerTraits.serpentsMark
  if ((frozenMarks.length === 0) !== (inheritedMark === null)) {
    return fail('breeding.offspring-production.stale-authority', 'Serpent’s Mark inheritance must exist exactly for applicable frozen parent provider evidence.')
  }
  if (inheritedMark) {
    const sourceSlugs = frozenMarks.map(value => value.subjectId).sort(compare)
    const evidenceHashes = frozenMarks.map(value => value.definitionSha256).sort(compare)
    const patterns = frozenMarks.map(value => value.value.kind === 'canonical-id-set' ? value.value.values[0]! : '')
    const differing = patterns.length === 2 && patterns[0] !== patterns[1]
    if (!same(sourceSlugs, inheritedMark.sourceParentSheetSlugs)
      || !same(evidenceHashes, inheritedMark.providerEvidenceDefinitionSha256s)
      || (inheritedMark.selectionKind === 'single-parent') !== (frozenMarks.length === 1)
      || (inheritedMark.selectionKind === 'bounded-coin') !== differing
      || (!differing && inheritedMark.patternId !== patterns[0])
      || (differing && !patterns.includes(inheritedMark.patternId))) {
      return fail('breeding.offspring-production.stale-authority', 'Serpent’s Mark pattern, sources, selection kind, and evidence must reproduce the frozen provider snapshot.')
    }
  }
  for (const candidate of record.blueprint.inheritanceCandidates) {
    for (const source of candidate.sources) {
      if (source.kind !== 'parent') return fail('breeding.offspring-production.stale-authority', 'Breeding offspring inheritance accepts only frozen parent sources.')
      const parent = record.productionSnapshot.parents[source.parentIndex]
      const known = parent?.effectiveKnownMoves.find(move => move.moveId === candidate.moveId)
      const pathwayAllowed = source.pathwayId === 'child-egg-move'
        ? speciesSpec.eggMoveIds.includes(candidate.moveId)
        : speciesSpec.machineMoveIds.includes(candidate.moveId)
      if (!parent || source.parentRef !== parent.pokemonSheetSlug || source.parentSpeciesId !== parent.speciesId
        || !known || !same(source.knownMoveEvidence, known.evidence) || !pathwayAllowed) {
        return fail('breeding.offspring-production.stale-authority', 'Inheritance sources must exactly reproduce frozen parent known-Move evidence and a current compiled child pathway.')
      }
    }
  }
  const requiredHashes = [BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256,
    BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256, BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
    BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256, BREEDING_NATURE_DEFINITION_SHA256,
    BREEDING_CANONICAL_ID_DEFINITION_SHA256, COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
    ...(record.blueprint.providerTraits.marsupial ? [BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256, BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderRecordSha256, BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderMechanicFieldsSha256] : []),
    ...record.productionSnapshot.acceptedDefinitionHashes,
    ...record.selectedOffers.map(value => value.offerDefinitionSha256)]
  if (requiredHashes.some(hash => !record.sourceEvidenceDefinitionHashes.includes(hash))) {
    return fail('breeding.offspring-production.hash-mismatch', 'Resolution source evidence must retain the complete snapshot, policy, registry, and selected-offer hash closure.')
  }
  return record
}
export const projectBreedingOffspringResolutionV1 = (input: { readonly record: unknown, readonly audience: 'gm'|'owner' }): BreedingOffspringResolutionProjectionV1 => {
  const record = parseAuthoritativeBreedingOffspringResolutionRecordV1(input.record)
  return parseBreedingOffspringResolutionProjectionV1({ schemaVersion:1, audience:input.audience, status:'prepared', resolvedAtCampaignMinute:record.resolvedAtCampaignMinute, traitsResolved:true, inheritanceFrozen:true })
}

export const validateOffspringChoiceCanonicalValuesForDiagnostics = (recordValue: unknown): boolean => {
  const record = parseAuthoritativeBreedingOffspringResolutionRecordV1(recordValue)
  return canonicalBreedingSpeciesIdentity(record.blueprint.speciesId) !== null
    && canonicalBreedingAbilityIdentity(record.blueprint.ability.valueId) !== null
    && breedingNature(record.blueprint.nature.valueId) !== null
    && compiledBreedingSpeciesSpec(record.blueprint.speciesId)?.definitionSha256 === record.blueprint.speciesSpecDefinitionSha256
    && compiledBreedingFamilySpec(record.family.selectedFamilyId)?.offspringRootSpeciesId === record.family.compiledRootSpeciesId
}
