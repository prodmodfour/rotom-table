import {
  parseBreedingAdjudicationIdSyntax,
  parseBreedingOfferIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingRollRecordIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingAdjudicationId,
  type BreedingOfferId,
  type BreedingOfferOptionId,
  type BreedingRollRecordId,
  type PokemonEggId,
} from './ids'
import type { PokemonEggSpecialStateId, PokemonEggSpecialTriggerId, PokemonEggStatus } from './egg'

export const BREEDING_HATCH_SPECIAL_OUTCOME_IDS = Object.freeze([
  'breeding.hatch-special.outcome.campaign-significance',
  'breeding.hatch-special.outcome.distinctive-appearance',
  'breeding.hatch-special.outcome.distinctive-temperament',
] as const)
export type BreedingHatchSpecialOutcomeId = typeof BREEDING_HATCH_SPECIAL_OUTCOME_IDS[number]
export const BREEDING_HATCH_SPECIAL_GM_CHOOSER_ID = 'campaign-gm' as const

export interface BreedingHatchSpecialProjectedOptionV1 {
  readonly optionId: BreedingOfferOptionId
  readonly outcomeId: BreedingHatchSpecialOutcomeId
  readonly labelId: string
  readonly descriptionId: string
}
interface PokemonEggHatchSpecialProjectionBaseV1 {
  readonly schemaVersion: 1
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly eggStatus: PokemonEggStatus
  readonly specialState: Exclude<PokemonEggSpecialStateId, 'not-rolled'>
  readonly requiresGmAdjudication: boolean
  readonly outcomeId: BreedingHatchSpecialOutcomeId | null
  readonly generatedAtCampaignMinute: number
}
export interface PokemonEggHatchSpecialOwnerProjectionV1 extends PokemonEggHatchSpecialProjectionBaseV1 {
  readonly audience: 'owner'
}
export interface PokemonEggHatchSpecialGmProjectionV1 extends PokemonEggHatchSpecialProjectionBaseV1 {
  readonly audience: 'gm'
  readonly rollRecordId: BreedingRollRecordId
  readonly rollTotal: number
  readonly triggerIds: readonly PokemonEggSpecialTriggerId[]
  readonly adjudicationId: BreedingAdjudicationId | null
  readonly adjudicationStatus: 'pending' | 'resolved' | null
  readonly offerId: BreedingOfferId | null
  readonly offerStatus: 'active' | 'consumed' | null
  readonly options: readonly BreedingHatchSpecialProjectedOptionV1[]
}
export type PokemonEggHatchSpecialProjectionV1 = PokemonEggHatchSpecialOwnerProjectionV1 | PokemonEggHatchSpecialGmProjectionV1

export type PokemonEggHatchSpecialValidationCode =
  | 'breeding.hatch-special.invalid-document'
  | 'breeding.hatch-special.unknown-field'
  | 'breeding.hatch-special.invalid-id'
  | 'breeding.hatch-special.invalid-invariant'
export class PokemonEggHatchSpecialValidationError extends Error {
  readonly code: PokemonEggHatchSpecialValidationCode
  readonly path: string
  constructor(code: PokemonEggHatchSpecialValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggHatchSpecialValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const OUTCOME_SET = new Set<string>(BREEDING_HATCH_SPECIAL_OUTCOME_IDS)
const TRIGGER_ORDER: Readonly<Record<PokemonEggSpecialTriggerId, number>> = Object.freeze({
  'roll-1': 0,
  'roll-100': 1,
  'provider-force': 2,
})
const EGG_STATUS_SET = new Set<string>(['awaiting-special-adjudication', 'hatching', 'hatched'])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const fail = (code: PokemonEggHatchSpecialValidationCode, path: string, message: string): never => {
  throw new PokemonEggHatchSpecialValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.hatch-special.invalid-document', path, 'must be a plain data object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-special.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-special.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-special.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.hatch-special.invalid-document', path, `must be a strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-special.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail('breeding.hatch-special.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return value as number
}
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value)
  ? value
  : fail('breeding.hatch-special.invalid-id', path, 'must be a bounded stable identifier.')
const outcomeId = (value: unknown, path: string): BreedingHatchSpecialOutcomeId => typeof value === 'string' && OUTCOME_SET.has(value)
  ? value as BreedingHatchSpecialOutcomeId
  : fail('breeding.hatch-special.invalid-id', path, 'must be a closed hatch-special outcome ID.')
const nullableOutcomeId = (value: unknown, path: string): BreedingHatchSpecialOutcomeId | null => value === null ? null : outcomeId(value, path)
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const parseOption = (value: unknown, path: string): BreedingHatchSpecialProjectedOptionV1 => {
  const row = exact(value, ['optionId', 'outcomeId', 'labelId', 'descriptionId'], path)
  return Object.freeze({
    optionId: parseBreedingOfferOptionIdSyntax(row.optionId)
      ?? fail('breeding.hatch-special.invalid-id', `${path}.optionId`, 'must be a breeding offer-option ID.'),
    outcomeId: outcomeId(row.outcomeId, `${path}.outcomeId`),
    labelId: identifier(row.labelId, `${path}.labelId`),
    descriptionId: identifier(row.descriptionId, `${path}.descriptionId`),
  })
}
const validateState = (input: {
  readonly state: 'normal' | 'pending-adjudication' | 'resolved'
  readonly eggStatus: PokemonEggStatus
  readonly requires: boolean
  readonly outcome: BreedingHatchSpecialOutcomeId | null
  readonly path: string
}): void => {
  if (input.state === 'normal') {
    if ((input.eggStatus !== 'hatching' && input.eggStatus !== 'hatched') || input.requires || input.outcome !== null) {
      fail('breeding.hatch-special.invalid-invariant', input.path, 'normal special state must be terminal without an outcome or GM decision.')
    }
    return
  }
  if (input.state === 'pending-adjudication') {
    if (input.eggStatus !== 'awaiting-special-adjudication' || !input.requires || input.outcome !== null) {
      fail('breeding.hatch-special.invalid-invariant', input.path, 'pending special state must await one GM decision without an outcome.')
    }
    return
  }
  if ((input.eggStatus !== 'hatching' && input.eggStatus !== 'hatched') || input.requires || input.outcome === null) {
    fail('breeding.hatch-special.invalid-invariant', input.path, 'resolved special state must retain one closed outcome and no pending decision.')
  }
}

export const parsePokemonEggHatchSpecialProjectionV1 = (
  value: unknown,
  path = 'pokemonEggHatchSpecialProjection',
): PokemonEggHatchSpecialProjectionV1 => {
  const baseFields = [
    'schemaVersion', 'audience', 'eggId', 'eggRevision', 'eggStatus', 'specialState',
    'requiresGmAdjudication', 'outcomeId', 'generatedAtCampaignMinute',
  ] as const
  const probe = record(value, path)
  const fields = probe.audience === 'gm'
    ? [...baseFields, 'rollRecordId', 'rollTotal', 'triggerIds', 'adjudicationId', 'adjudicationStatus', 'offerId', 'offerStatus', 'options']
    : baseFields
  const row = exact(probe, fields, path)
  if (row.schemaVersion !== 1 || (row.audience !== 'owner' && row.audience !== 'gm')
    || (row.specialState !== 'normal' && row.specialState !== 'pending-adjudication' && row.specialState !== 'resolved')
    || typeof row.eggStatus !== 'string' || !EGG_STATUS_SET.has(row.eggStatus)
    || typeof row.requiresGmAdjudication !== 'boolean') {
    return fail('breeding.hatch-special.invalid-document', path, 'must be a schema-v1 owner or GM hatch-special projection.')
  }
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.hatch-special.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const eggRevision = integer(row.eggRevision, `${path}.eggRevision`, 0, 2_147_483_647)
  const outcome = nullableOutcomeId(row.outcomeId, `${path}.outcomeId`)
  const state = row.specialState as 'normal' | 'pending-adjudication' | 'resolved'
  const eggStatus = row.eggStatus as PokemonEggStatus
  const requires = row.requiresGmAdjudication as boolean
  validateState({ state, eggStatus, requires, outcome, path })
  const generatedAtCampaignMinute = integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`)
  const base = { schemaVersion: 1 as const, eggId, eggRevision, eggStatus, specialState: state, requiresGmAdjudication: requires, outcomeId: outcome, generatedAtCampaignMinute }
  if (row.audience === 'owner') return freeze({ ...base, audience: 'owner' as const })

  const rollRecordId = parseBreedingRollRecordIdSyntax(row.rollRecordId)
    ?? fail('breeding.hatch-special.invalid-id', `${path}.rollRecordId`, 'must be one persisted breeding roll ID.')
  const rollTotal = integer(row.rollTotal, `${path}.rollTotal`, 1, 100)
  const triggerIds = array(row.triggerIds, `${path}.triggerIds`, 3).map((entry, index) => {
    if (entry !== 'roll-1' && entry !== 'roll-100' && entry !== 'provider-force') {
      return fail('breeding.hatch-special.invalid-id', `${path}.triggerIds[${index}]`, 'must be a closed special trigger ID.')
    }
    return entry
  })
  for (let index = 1; index < triggerIds.length; index += 1) {
    if (TRIGGER_ORDER[triggerIds[index - 1]!] >= TRIGGER_ORDER[triggerIds[index]!]) {
      fail('breeding.hatch-special.invalid-invariant', `${path}.triggerIds`, 'must be unique in canonical trigger order.')
    }
  }
  if ((rollTotal === 1) !== triggerIds.includes('roll-1') || (rollTotal === 100) !== triggerIds.includes('roll-100')) {
    fail('breeding.hatch-special.invalid-invariant', path, 'roll triggers must exactly match the persisted d100 total.')
  }
  const adjudicationId = row.adjudicationId === null ? null : parseBreedingAdjudicationIdSyntax(row.adjudicationId)
  const offerId = row.offerId === null ? null : parseBreedingOfferIdSyntax(row.offerId)
  if ((row.adjudicationId !== null && !adjudicationId) || (row.offerId !== null && !offerId)) {
    fail('breeding.hatch-special.invalid-id', path, 'contains an invalid adjudication or offer ID.')
  }
  const adjudicationStatus = row.adjudicationStatus === null ? null
    : row.adjudicationStatus === 'pending' || row.adjudicationStatus === 'resolved' ? row.adjudicationStatus
      : fail('breeding.hatch-special.invalid-document', `${path}.adjudicationStatus`, 'must be pending, resolved, or null.')
  const offerStatus = row.offerStatus === null ? null
    : row.offerStatus === 'active' || row.offerStatus === 'consumed' ? row.offerStatus
      : fail('breeding.hatch-special.invalid-document', `${path}.offerStatus`, 'must be active, consumed, or null.')
  const options = array(row.options, `${path}.options`, BREEDING_HATCH_SPECIAL_OUTCOME_IDS.length)
    .map((entry, index) => parseOption(entry, `${path}.options[${index}]`))
  if (new Set(options.map(option => option.optionId)).size !== options.length
    || new Set(options.map(option => option.outcomeId)).size !== options.length) {
    fail('breeding.hatch-special.invalid-invariant', `${path}.options`, 'must contain unique option and outcome identities.')
  }
  const hasDecision = state !== 'normal'
  if (!hasDecision && (triggerIds.length !== 0 || adjudicationId !== null || adjudicationStatus !== null
    || offerId !== null || offerStatus !== null || options.length !== 0)
    || hasDecision && (!adjudicationId || !offerId || options.length !== BREEDING_HATCH_SPECIAL_OUTCOME_IDS.length)
    || state === 'pending-adjudication' && (adjudicationStatus !== 'pending' || offerStatus !== 'active')
    || state === 'resolved' && (adjudicationStatus !== 'resolved' || offerStatus !== 'consumed')) {
    fail('breeding.hatch-special.invalid-invariant', path, 'GM audit fields must exactly match normal, pending, or resolved special state.')
  }
  return freeze({
    ...base,
    audience: 'gm' as const,
    rollRecordId,
    rollTotal,
    triggerIds: Object.freeze(triggerIds),
    adjudicationId,
    adjudicationStatus,
    offerId,
    offerStatus,
    options: Object.freeze(options),
  })
}
