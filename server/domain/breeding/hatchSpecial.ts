import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  BREEDING_HATCH_SPECIAL_GM_CHOOSER_ID,
  BREEDING_HATCH_SPECIAL_OUTCOME_IDS,
  parsePokemonEggHatchSpecialProjectionV1,
  type BreedingHatchSpecialOutcomeId,
  type PokemonEggHatchSpecialProjectionV1,
} from '#shared/breeding/hatchSpecial'
import type {
  BreedingGmAdjudicationRecordV1,
  BreedingOptionOfferRecordV1,
  BreedingRollRecordV1,
} from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  parseAuthoritativePokemonEggHatchOfferAuthorityV1,
} from './hatchOffers'
import {
  parseBreedingCampaignOptionSnapshotV1,
  type BreedingCampaignOptionSnapshotV1,
} from './campaignOptions'
import { validatePokemonEggRevisionSuccessor } from './eggLifecycle'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from './eggLifecyclePolicy'
import { resolveBreedingHatchSpecial } from './eggRuleHelpers'
import {
  createBreedingGmAdjudicationRecordV1,
  createBreedingOptionOfferRecordV1,
  createBreedingOptionOfferRevisionV1,
  parseAuthoritativeBreedingGmAdjudicationRecordV1,
  parseAuthoritativeBreedingOptionOfferRecordV1,
  parseAuthoritativeBreedingRollRecordV1,
  validateBreedingAdjudicationOfferLink,
  validateBreedingGmAdjudicationSuccessor,
  validateBreedingOptionOfferSuccessor,
} from './ledgers'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { createBreedingOperationCommandHash } from './operations'

export const BREEDING_HATCH_SPECIAL_PROVIDER_ID = 'breeding-hatch-special-policy-v1' as const
export const BREEDING_HATCH_SPECIAL_EVIDENCE_ID = 'breeding-hatch-special-outcome-policy-v1' as const
export const BREEDING_HATCH_SPECIAL_OUTCOME_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  policyId: BREEDING_HATCH_SPECIAL_PROVIDER_ID,
  roll: Object.freeze({ purpose: 'hatch-special-d100' as const, formula: '1d100' as const, countPerEgg: 1 as const }),
  triggers: Object.freeze([1, 100] as const),
  providerForceIntegration: 'unavailable-until-br-062' as const,
  configuredBoundedTable: 'unavailable-until-reviewed' as const,
  gmChooserId: BREEDING_HATCH_SPECIAL_GM_CHOOSER_ID,
  automaticShiny: false as const,
  outcomes: Object.freeze([
    Object.freeze({
      outcomeId: 'breeding.hatch-special.outcome.campaign-significance' as const,
      labelId: 'breeding.hatch-special.outcome.campaign-significance.label',
      descriptionId: 'breeding.hatch-special.outcome.campaign-significance.description',
      mechanicsPolicy: 'no-automatic-mechanical-change' as const,
    }),
    Object.freeze({
      outcomeId: 'breeding.hatch-special.outcome.distinctive-appearance' as const,
      labelId: 'breeding.hatch-special.outcome.distinctive-appearance.label',
      descriptionId: 'breeding.hatch-special.outcome.distinctive-appearance.description',
      mechanicsPolicy: 'no-automatic-mechanical-change' as const,
    }),
    Object.freeze({
      outcomeId: 'breeding.hatch-special.outcome.distinctive-temperament' as const,
      labelId: 'breeding.hatch-special.outcome.distinctive-temperament.label',
      descriptionId: 'breeding.hatch-special.outcome.distinctive-temperament.description',
      mechanicsPolicy: 'no-automatic-mechanical-change' as const,
    }),
  ]),
})

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const uniqueHashes = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)].sort(compare))
export const BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256 = sha256(BREEDING_HATCH_SPECIAL_OUTCOME_POLICY)
export const BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256 = sha256({
  schemaVersion: 1,
  policyDefinitionSha256: BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
  reducerId: 'resolve-breeding-hatch-special-v1',
  providerContributions: 'fail-closed-until-br-062',
})

export type BeginHatchCommandV1 = Extract<BreedingOperationCommandV1, { readonly commandKind: 'begin-hatch' }>
export type ResolveHatchSpecialCommandV1 = Extract<BreedingOperationCommandV1, { readonly commandKind: 'resolve-hatch-special' }>
export interface PlannedPokemonEggHatchSpecialBeginV1 {
  readonly egg: PokemonEggDocumentV1
  readonly roll: BreedingRollRecordV1
  readonly resultDefinitionSha256: string
  readonly adjudication: BreedingGmAdjudicationRecordV1 | null
  readonly offer: BreedingOptionOfferRecordV1 | null
}
export interface PlannedPokemonEggHatchSpecialResolutionV1 {
  readonly egg: PokemonEggDocumentV1
  readonly adjudication: BreedingGmAdjudicationRecordV1
  readonly offer: BreedingOptionOfferRecordV1
  readonly outcomeId: BreedingHatchSpecialOutcomeId
}

export type PokemonEggHatchSpecialAuthorityErrorCode =
  | 'breeding.hatch-special.invalid-request'
  | 'breeding.hatch-special.wrong-command'
  | 'breeding.hatch-special.stale-authority'
  | 'breeding.hatch-special.invalid-roll'
  | 'breeding.hatch-special.invalid-adjudication'
  | 'breeding.hatch-special.unavailable'
export class PokemonEggHatchSpecialAuthorityError extends Error {
  readonly code: PokemonEggHatchSpecialAuthorityErrorCode
  constructor(code: PokemonEggHatchSpecialAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'PokemonEggHatchSpecialAuthorityError'
    this.code = code
  }
}
const fail = (code: PokemonEggHatchSpecialAuthorityErrorCode, message: string): never => {
  throw new PokemonEggHatchSpecialAuthorityError(code, message)
}
const strictInput = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-special.invalid-request', `${label} must be a plain exact object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-special.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-special.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const minute = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('breeding.hatch-special.stale-authority', 'Campaign minute must be a nonnegative safe integer.')
  }
  return value as number
}
const operationIdPart = (kind: string, operationId: string, eggId: string): string => (
  createHash('sha256').update(`${kind}\0${operationId}\0${eggId}`).digest('hex').slice(0, 32)
)
export const deriveBreedingHatchSpecialRollRecordIdV1 = (operationId: string, eggId: string): `breeding-roll:v1:${string}` => (
  `breeding-roll:v1:${operationIdPart('breeding-hatch-special-roll-v1', operationId, eggId)}`
)
export const deriveBreedingHatchSpecialOfferIdV1 = (operationId: string, eggId: string): `breeding-offer:v1:${string}` => (
  `breeding-offer:v1:${operationIdPart('breeding-hatch-special-offer-v1', operationId, eggId)}`
)
export const deriveBreedingHatchSpecialAdjudicationIdV1 = (operationId: string, eggId: string): `breeding-adjudication:v1:${string}` => (
  `breeding-adjudication:v1:${operationIdPart('breeding-hatch-special-adjudication-v1', operationId, eggId)}`
)
const deriveOptionId = (operationId: string, eggId: string, outcomeId: BreedingHatchSpecialOutcomeId): `option:v1:${string}` => (
  `option:v1:${createHash('sha256').update(`breeding-hatch-special-option-v1\0${operationId}\0${eggId}\0${outcomeId}`).digest('hex').slice(0, 32)}`
)
const outcome = (outcomeId: BreedingHatchSpecialOutcomeId) => BREEDING_HATCH_SPECIAL_OUTCOME_POLICY.outcomes.find(value => value.outcomeId === outcomeId)!
const optionDefinitions = (operationId: string, eggId: string) => Object.freeze(
  BREEDING_HATCH_SPECIAL_OUTCOME_IDS.map(outcomeId => {
    const definition = outcome(outcomeId)
    return Object.freeze({
      optionId: deriveOptionId(operationId, eggId, outcomeId),
      kind: 'special-result' as const,
      canonicalValueId: outcomeId,
      valueDefinitionSha256: sha256(definition),
      authorityEvidenceIds: Object.freeze([BREEDING_HATCH_SPECIAL_EVIDENCE_ID]),
    })
  }).sort((left, right) => compare(left.optionId, right.optionId)),
)

export const breedingHatchSpecialRollSourceDefinitionHashesV1 = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly campaignOptionSnapshot: BreedingCampaignOptionSnapshotV1
  readonly hatchOfferAuthorityDefinitionSha256: string
}): readonly string[] => uniqueHashes([
  input.egg.ruleset.definitionSha256,
  pokemonEggLifecycleDocumentDefinitionSha256(input.egg),
  input.campaignOptionSnapshot.definitionSha256,
  input.hatchOfferAuthorityDefinitionSha256,
  BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
])

const commandEggScope = (command: BeginHatchCommandV1 | ResolveHatchSpecialCommandV1, egg: PokemonEggDocumentV1): boolean => (
  command.scopes.length === 1
  && command.scopes[0]?.kind === 'pokemon-egg'
  && command.scopes[0].eggId === egg.eggId
  && command.scopes[0].expectedRevision === egg.revision
  && command.payload.eggId === egg.eggId
  && command.ruleset.rulesetId === egg.ruleset.rulesetId
  && command.ruleset.definitionSha256 === egg.ruleset.definitionSha256
)

export const planPokemonEggHatchSpecialBeginV1 = (inputValue: {
  readonly egg: unknown
  readonly command: unknown
  readonly persistedRoll: unknown
  readonly campaignOptionSnapshot: unknown
  readonly hatchOfferAuthority: unknown
  readonly campaignMinute: unknown
}): PlannedPokemonEggHatchSpecialBeginV1 => {
  strictInput(inputValue, ['egg', 'command', 'persistedRoll', 'campaignOptionSnapshot', 'hatchOfferAuthority', 'campaignMinute'], 'hatchSpecialBeginInput')
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const command = parseBreedingOperationCommandV1(inputValue.command)
  if (command.commandKind !== 'begin-hatch') {
    return fail('breeding.hatch-special.wrong-command', 'Hatch-special begin accepts begin-hatch only.')
  }
  const roll = parseAuthoritativeBreedingRollRecordV1(inputValue.persistedRoll)
  const options = parseBreedingCampaignOptionSnapshotV1(inputValue.campaignOptionSnapshot)
  const authority = parseAuthoritativePokemonEggHatchOfferAuthorityV1(inputValue.hatchOfferAuthority)
  const campaignMinute = minute(inputValue.campaignMinute)
  const commandSha256 = createBreedingOperationCommandHash(command)
  if (egg.status !== 'ready' || egg.special.state !== 'not-rolled' || egg.hatchOperationId !== null
    || !commandEggScope(command, egg)
    || command.payload.requestSpecialRoll !== true
    || command.payload.destination.trainerSheetSlug !== egg.ownerTrainerSlug
    || authority.offer.availability.status !== 'available'
    || authority.commandOperationId !== command.operationId
    || authority.commandSha256 !== commandSha256
    || authority.eggId !== egg.eggId || authority.eggRevision !== egg.revision
    || authority.eggDefinitionSha256 !== pokemonEggLifecycleDocumentDefinitionSha256(egg)
    || authority.selectedDestinationOptionId !== authority.destinations.find(value => value.kind === command.payload.destination.kind)?.optionId
    || authority.offer.issuedAtCampaignMinute !== campaignMinute
    || authority.offer.expiresAtCampaignMinute === null
    || campaignMinute >= authority.offer.expiresAtCampaignMinute
    || options.rulesetDefinitionSha256 !== egg.ruleset.definitionSha256
    || !egg.definitionHashes.includes(options.definitionSha256)) {
    return fail('breeding.hatch-special.stale-authority', 'Ready Egg, command, destination, campaign options, and consumed hatch offer must agree exactly.')
  }
  const expectedSourceHashes = breedingHatchSpecialRollSourceDefinitionHashesV1({
    egg,
    campaignOptionSnapshot: options,
    hatchOfferAuthorityDefinitionSha256: authority.authorityDefinitionSha256,
  })
  if (roll.rollRecordId !== deriveBreedingHatchSpecialRollRecordIdV1(command.operationId, egg.eggId)
    || roll.operationId !== command.operationId || roll.commandSha256 !== commandSha256
    || roll.operationRollOrdinal !== 0 || roll.purpose !== 'hatch-special-d100'
    || roll.formula !== '1d100' || roll.target.kind !== 'pokemon-egg'
    || roll.target.eggId !== egg.eggId || roll.target.revision !== egg.revision
    || roll.generatedAtCampaignMinute !== campaignMinute
    || stableJsonStringify(roll.sourceDefinitionHashes) !== stableJsonStringify(expectedSourceHashes)) {
    return fail('breeding.hatch-special.invalid-roll', 'Exactly one command-bound persisted d100 roll must target this ready Egg revision.')
  }
  const specialResult = resolveBreedingHatchSpecial(options, { rollId: roll.rollRecordId, total: roll.total }, null)
  if (specialResult.status !== 'resolved') {
    return fail('breeding.hatch-special.unavailable', `Hatch-special reducer is unavailable: ${specialResult.reasonIds.join(',')}`)
  }
  const nextRevision = egg.revision + 1
  if (!specialResult.isSpecial) {
    const next = validatePokemonEggRevisionSuccessor(egg, {
      ...egg,
      revision: nextRevision,
      status: 'hatching',
      special: {
        state: 'normal',
        rollRecordId: roll.rollRecordId,
        rollTotal: roll.total,
        triggerIds: [],
        adjudicationId: null,
        outcomeId: null,
        automaticShiny: false,
      },
      hatchOperationId: command.operationId,
      updatedAtCampaignMinute: campaignMinute,
      statusChangedAtCampaignMinute: campaignMinute,
      lastOperationId: command.operationId,
    })
    return Object.freeze({ egg: next, roll, resultDefinitionSha256: specialResult.resultDefinitionSha256, adjudication: null, offer: null })
  }
  const target = Object.freeze({ kind: 'pokemon-egg' as const, eggId: egg.eggId, revision: nextRevision })
  const offer = createBreedingOptionOfferRecordV1({
    schemaVersion: 1,
    offerId: deriveBreedingHatchSpecialOfferIdV1(command.operationId, egg.eggId),
    choiceKind: 'special-result',
    target,
    chooserProfileId: BREEDING_HATCH_SPECIAL_GM_CHOOSER_ID,
    minimumPokemonEducationRank: null,
    options: optionDefinitions(command.operationId, egg.eggId),
    issuedOperationId: command.operationId,
    issuedCommandSha256: commandSha256,
    issuedAtCampaignMinute: campaignMinute,
    expiresAtCampaignMinute: null,
  })
  const adjudication = createBreedingGmAdjudicationRecordV1({
    schemaVersion: 1,
    adjudicationId: deriveBreedingHatchSpecialAdjudicationIdV1(command.operationId, egg.eggId),
    revision: 0,
    status: 'pending',
    adjudicationKind: 'hatch-special-result',
    decisionMode: 'bounded-option',
    target,
    createdByProfileId: command.actor.profileId,
    reasonId: 'breeding.hatch-special.triggered',
    offerId: offer.offerId,
    decision: null,
    createdOperationId: command.operationId,
    createdCommandSha256: commandSha256,
    createdAtCampaignMinute: campaignMinute,
    resolvedByProfileId: null,
    settlementOperationId: null,
    settlementCommandSha256: null,
    settledAtCampaignMinute: null,
    settlementReasonId: null,
    authorityDefinitionHashes: uniqueHashes([
      pokemonEggLifecycleDocumentDefinitionSha256(egg),
      roll.definitionSha256,
      options.definitionSha256,
      authority.authorityDefinitionSha256,
      authority.securityPolicyDefinitionSha256,
      specialResult.resultDefinitionSha256,
      BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
      BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
    ]),
  })
  validateBreedingAdjudicationOfferLink(adjudication, offer)
  const next = validatePokemonEggRevisionSuccessor(egg, {
    ...egg,
    revision: nextRevision,
    status: 'awaiting-special-adjudication',
    special: {
      state: 'pending-adjudication',
      rollRecordId: roll.rollRecordId,
      rollTotal: roll.total,
      triggerIds: specialResult.triggerIds,
      adjudicationId: null,
      outcomeId: null,
      automaticShiny: false,
    },
    hatchOperationId: command.operationId,
    updatedAtCampaignMinute: campaignMinute,
    statusChangedAtCampaignMinute: campaignMinute,
    lastOperationId: command.operationId,
  })
  return Object.freeze({ egg: next, roll, resultDefinitionSha256: specialResult.resultDefinitionSha256, adjudication, offer })
}

export const planPokemonEggHatchSpecialResolutionV1 = (inputValue: {
  readonly egg: unknown
  readonly command: unknown
  readonly adjudication: unknown
  readonly offer: unknown
  readonly campaignMinute: unknown
}): PlannedPokemonEggHatchSpecialResolutionV1 => {
  strictInput(inputValue, ['egg', 'command', 'adjudication', 'offer', 'campaignMinute'], 'hatchSpecialResolutionInput')
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const command = parseBreedingOperationCommandV1(inputValue.command)
  if (command.commandKind !== 'resolve-hatch-special') {
    return fail('breeding.hatch-special.wrong-command', 'Hatch-special resolution accepts resolve-hatch-special only.')
  }
  const adjudication = parseAuthoritativeBreedingGmAdjudicationRecordV1(inputValue.adjudication)
  const offer = parseAuthoritativeBreedingOptionOfferRecordV1(inputValue.offer)
  const campaignMinute = minute(inputValue.campaignMinute)
  const commandSha256 = createBreedingOperationCommandHash(command)
  if (egg.status !== 'awaiting-special-adjudication' || egg.special.state !== 'pending-adjudication'
    || !egg.hatchOperationId || !commandEggScope(command, egg)
    || egg.updatedAtCampaignMinute > campaignMinute
    || adjudication.adjudicationId !== deriveBreedingHatchSpecialAdjudicationIdV1(egg.hatchOperationId, egg.eggId)
    || offer.offerId !== deriveBreedingHatchSpecialOfferIdV1(egg.hatchOperationId, egg.eggId)
    || adjudication.status !== 'pending' || offer.status !== 'active'
    || adjudication.target.kind !== 'pokemon-egg' || adjudication.target.eggId !== egg.eggId
    || adjudication.target.revision !== egg.revision
    || offer.target.kind !== 'pokemon-egg' || offer.target.eggId !== egg.eggId || offer.target.revision !== egg.revision
    || adjudication.createdAtCampaignMinute !== egg.statusChangedAtCampaignMinute
    || offer.issuedAtCampaignMinute !== adjudication.createdAtCampaignMinute
    || offer.expiresAtCampaignMinute !== null
    || offer.chooserProfileId !== BREEDING_HATCH_SPECIAL_GM_CHOOSER_ID) {
    return fail('breeding.hatch-special.stale-authority', 'Pending Egg, adjudication, offer, and resolution command must agree exactly.')
  }
  try { validateBreedingAdjudicationOfferLink(adjudication, offer) }
  catch { return fail('breeding.hatch-special.invalid-adjudication', 'Pending GM adjudication and offer link is invalid.') }
  const expectedOptions = optionDefinitions(egg.hatchOperationId, egg.eggId)
  if (stableJsonStringify(offer.options) !== stableJsonStringify(expectedOptions)) {
    return fail('breeding.hatch-special.invalid-adjudication', 'GM choice must use the immutable closed hatch-special outcome inventory.')
  }
  const selected = offer.options.find(value => value.optionId === command.payload.adjudicationOptionId)
  if (!selected || !BREEDING_HATCH_SPECIAL_OUTCOME_IDS.some(value => value === selected.canonicalValueId)) {
    return fail('breeding.hatch-special.invalid-adjudication', 'Resolution must select one option from the active bounded offer.')
  }
  const outcomeId = selected.canonicalValueId as BreedingHatchSpecialOutcomeId
  const nextOffer = validateBreedingOptionOfferSuccessor(offer, createBreedingOptionOfferRevisionV1({
    ...offer,
    revision: 1,
    status: 'consumed',
    selectedOptionId: selected.optionId,
    settlementOperationId: command.operationId,
    settlementCommandSha256: commandSha256,
    settledAtCampaignMinute: campaignMinute,
    settlementReasonId: null,
  }))
  const nextAdjudication = validateBreedingGmAdjudicationSuccessor(adjudication, createBreedingGmAdjudicationRecordV1({
    ...adjudication,
    revision: 1,
    status: 'resolved',
    decision: { kind: 'option', optionId: selected.optionId },
    resolvedByProfileId: BREEDING_HATCH_SPECIAL_GM_CHOOSER_ID,
    settlementOperationId: command.operationId,
    settlementCommandSha256: commandSha256,
    settledAtCampaignMinute: campaignMinute,
    settlementReasonId: null,
  }))
  validateBreedingAdjudicationOfferLink(nextAdjudication, nextOffer)
  const nextEgg = validatePokemonEggRevisionSuccessor(egg, {
    ...egg,
    revision: egg.revision + 1,
    status: 'hatching',
    special: {
      ...egg.special,
      state: 'resolved',
      adjudicationId: adjudication.adjudicationId,
      outcomeId,
      automaticShiny: false,
    },
    updatedAtCampaignMinute: campaignMinute,
    statusChangedAtCampaignMinute: campaignMinute,
    lastOperationId: command.operationId,
  })
  return Object.freeze({ egg: nextEgg, adjudication: nextAdjudication, offer: nextOffer, outcomeId })
}

export const projectPokemonEggHatchSpecialV1 = (inputValue: {
  readonly egg: unknown
  readonly audience: 'gm' | 'owner'
  readonly adjudication: unknown | null
  readonly offer: unknown | null
  readonly generatedAtCampaignMinute: unknown
}): PokemonEggHatchSpecialProjectionV1 => {
  strictInput(inputValue, ['egg', 'audience', 'adjudication', 'offer', 'generatedAtCampaignMinute'], 'hatchSpecialProjectionInput')
  if (inputValue.audience !== 'gm' && inputValue.audience !== 'owner') {
    return fail('breeding.hatch-special.invalid-request', 'Hatch-special projection audience must be owner or GM.')
  }
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const generatedAtCampaignMinute = minute(inputValue.generatedAtCampaignMinute)
  if (egg.special.state === 'not-rolled' || egg.updatedAtCampaignMinute > generatedAtCampaignMinute
    || !egg.special.rollRecordId || egg.special.rollTotal === null) {
    return fail('breeding.hatch-special.unavailable', 'Hatch-special projection requires a current Egg after its one persisted roll.')
  }
  const hasAdjudication = egg.special.state === 'pending-adjudication' || egg.special.state === 'resolved'
  const adjudication = inputValue.adjudication === null ? null : parseAuthoritativeBreedingGmAdjudicationRecordV1(inputValue.adjudication)
  const offer = inputValue.offer === null ? null : parseAuthoritativeBreedingOptionOfferRecordV1(inputValue.offer)
  if (hasAdjudication !== (adjudication !== null && offer !== null)) {
    return fail('breeding.hatch-special.invalid-adjudication', 'Projection records must exist exactly for a triggered special workflow.')
  }
  if (adjudication && offer) {
    validateBreedingAdjudicationOfferLink(adjudication, offer)
    if (adjudication.target.kind !== 'pokemon-egg' || adjudication.target.eggId !== egg.eggId
      || adjudication.target.revision > egg.revision
      || offer.target.kind !== 'pokemon-egg' || offer.target.eggId !== egg.eggId
      || egg.hatchOperationId !== adjudication.createdOperationId
      || (egg.special.state === 'pending-adjudication' && (adjudication.status !== 'pending' || offer.status !== 'active'
        || adjudication.target.revision !== egg.revision))
      || (egg.special.state === 'resolved' && (adjudication.status !== 'resolved' || offer.status !== 'consumed'
        || egg.special.adjudicationId !== adjudication.adjudicationId
        || egg.special.outcomeId !== offer.options.find(value => value.optionId === offer.selectedOptionId)?.canonicalValueId))) {
      return fail('breeding.hatch-special.invalid-adjudication', 'Projection requires the exact Egg-linked adjudication and offer state.')
    }
  }
  const outcomeId = egg.special.outcomeId === null ? null
    : BREEDING_HATCH_SPECIAL_OUTCOME_IDS.find(value => value === egg.special.outcomeId)
      ?? fail('breeding.hatch-special.invalid-adjudication', 'Resolved Egg contains an unknown special outcome.')
  const base = {
    schemaVersion: 1 as const,
    audience: inputValue.audience,
    eggId: egg.eggId,
    eggRevision: egg.revision,
    eggStatus: egg.status,
    specialState: egg.special.state,
    requiresGmAdjudication: egg.special.state === 'pending-adjudication',
    outcomeId,
    generatedAtCampaignMinute,
  }
  if (inputValue.audience === 'owner') {
    return parsePokemonEggHatchSpecialProjectionV1({ ...base, audience: 'owner' })
  }
  return parsePokemonEggHatchSpecialProjectionV1({
    ...base,
    audience: 'gm',
    rollRecordId: egg.special.rollRecordId,
    rollTotal: egg.special.rollTotal,
    triggerIds: egg.special.triggerIds,
    adjudicationId: adjudication?.adjudicationId ?? null,
    adjudicationStatus: adjudication?.status ?? null,
    offerId: offer?.offerId ?? null,
    offerStatus: offer?.status ?? null,
    options: offer?.options.map(value => {
      const definition = outcome(value.canonicalValueId as BreedingHatchSpecialOutcomeId)
      return { optionId: value.optionId, outcomeId: definition.outcomeId, labelId: definition.labelId, descriptionId: definition.descriptionId }
    }) ?? [],
  })
}
