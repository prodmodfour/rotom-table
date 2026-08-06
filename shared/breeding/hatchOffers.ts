import { parseCampaignOperationOfferV1, type CampaignOperationOfferV1 } from '../campaignOperationOffers'
import { isPokemonEggStatus, type PokemonEggStatus } from './egg'
import { isSlug } from '../paths'
import {
  parseBreedingOfferOptionIdSyntax,
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOfferOptionId,
  type BreedingOperationId,
  type PokemonEggId,
} from './ids'

export const POKEMON_EGG_HATCH_DESTINATION_KINDS = Object.freeze(['box', 'team'] as const)
export const POKEMON_EGG_HATCH_BLOCKER_REASON_IDS = Object.freeze([
  'breeding.egg-lifecycle.already-hatched',
  'breeding.egg-lifecycle.cancelled',
  'breeding.egg-lifecycle.hatch-already-started',
  'breeding.egg-lifecycle.invalidated-by-gm',
  'breeding.egg-lifecycle.not-ready',
  'breeding.hatch-offer.team-full',
] as const)
export const POKEMON_EGG_HATCH_TEAM_CAPACITY = 6 as const
export type PokemonEggHatchDestinationKindV1 = typeof POKEMON_EGG_HATCH_DESTINATION_KINDS[number]
export type PokemonEggHatchBlockerReasonIdV1 = typeof POKEMON_EGG_HATCH_BLOCKER_REASON_IDS[number]

export interface PokemonEggHatchOwnerTrainerFactV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly trainerSheetDefinitionSha256: string
  readonly currentTeamCount: number
  readonly boxedPokemonCount: number
  readonly teamCapacity: 6
  readonly remainingTeamSlots: number
  readonly factDefinitionSha256: string
}
export interface PokemonEggHatchDestinationOptionV1 {
  readonly schemaVersion: 1
  readonly optionId: BreedingOfferOptionId
  readonly optionDefinitionSha256: string
  readonly kind: PokemonEggHatchDestinationKindV1
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly availability: {
    readonly status: 'available' | 'unavailable'
    readonly reasonId: PokemonEggHatchBlockerReasonIdV1 | null
  }
  readonly remainingTeamSlots: number | null
}
export interface PokemonEggHatchProjectedDestinationV1 {
  readonly optionId: BreedingOfferOptionId
  readonly kind: PokemonEggHatchDestinationKindV1
  readonly trainerSheetSlug: string
  readonly availability: {
    readonly status: 'available' | 'unavailable'
    readonly reasonId: PokemonEggHatchBlockerReasonIdV1 | null
  }
  readonly remainingTeamSlots: number | null
}
export interface PokemonEggHatchOfferProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly eggStatus: PokemonEggStatus
  readonly offer: CampaignOperationOfferV1
  readonly destinations: readonly [PokemonEggHatchProjectedDestinationV1, PokemonEggHatchProjectedDestinationV1]
  readonly selectedDestinationOptionId: BreedingOfferOptionId
  readonly blockerReasonIds: readonly PokemonEggHatchBlockerReasonIdV1[]
  readonly canSubmit: boolean
  readonly generatedAtCampaignMinute: number
}
export interface PokemonEggHatchOfferAuthorityV1 {
  readonly schemaVersion: 1
  readonly offer: CampaignOperationOfferV1
  readonly commandOperationId: BreedingOperationId
  readonly commandSha256: string
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly eggDefinitionSha256: string
  readonly ownerTrainerFactDefinitionSha256: string
  readonly actorAuthorityDefinitionSha256: string
  readonly ownerTrainerControlDefinitionSha256: string | null
  readonly referenceVersionsDefinitionSha256: string
  readonly lifecyclePolicyDefinitionSha256: string
  readonly securityPolicyDefinitionSha256: string
  readonly destinations: readonly [PokemonEggHatchDestinationOptionV1, PokemonEggHatchDestinationOptionV1]
  readonly selectedDestinationOptionId: BreedingOfferOptionId
  readonly blockerReasonIds: readonly PokemonEggHatchBlockerReasonIdV1[]
  readonly authorityDefinitionSha256: string
}

export type PokemonEggHatchOfferValidationCode =
  | 'breeding.hatch-offer.invalid-document'
  | 'breeding.hatch-offer.unknown-field'
  | 'breeding.hatch-offer.invalid-id'
  | 'breeding.hatch-offer.invalid-invariant'
export class PokemonEggHatchOfferValidationError extends Error {
  readonly code: PokemonEggHatchOfferValidationCode
  readonly path: string
  constructor(code: PokemonEggHatchOfferValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggHatchOfferValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const blockers = new Set<string>(POKEMON_EGG_HATCH_BLOCKER_REASON_IDS)
const fail = (code: PokemonEggHatchOfferValidationCode, path: string, message: string): never => {
  throw new PokemonEggHatchOfferValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.hatch-offer.invalid-document', path, 'must be a plain data object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-offer.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-offer.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-offer.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, length: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== length + 1) {
    return fail('breeding.hatch-offer.invalid-document', path, `must be a strict ${length}-entry array.`)
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-offer.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const boundedArray = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.hatch-offer.invalid-document', path, `must be a strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-offer.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    return fail('breeding.hatch-offer.invalid-document', path, `must be a safe integer from 0 through ${maximum}.`)
  }
  return value as number
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.hatch-offer.invalid-document', path, 'must be a lowercase SHA-256 value.')
const nullableHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.hatch-offer.invalid-id', path, 'must be a canonical bounded Trainer slug.')
const reason = (value: unknown, path: string): PokemonEggHatchBlockerReasonIdV1 => (
  typeof value === 'string' && blockers.has(value)
    ? value as PokemonEggHatchBlockerReasonIdV1
    : fail('breeding.hatch-offer.invalid-id', path, 'must be a closed hatch blocker reason.')
)
const parseAvailability = (value: unknown, path: string): PokemonEggHatchDestinationOptionV1['availability'] => {
  const row = exact(value, ['status', 'reasonId'], path)
  if (row.status !== 'available' && row.status !== 'unavailable') {
    return fail('breeding.hatch-offer.invalid-document', `${path}.status`, 'must be available or unavailable.')
  }
  const reasonId = row.reasonId === null ? null : reason(row.reasonId, `${path}.reasonId`)
  if ((row.status === 'available') !== (reasonId === null)) {
    return fail('breeding.hatch-offer.invalid-invariant', path, 'only unavailable options carry one blocker reason.')
  }
  return Object.freeze({ status: row.status, reasonId })
}
const parseDestination = (value: unknown, index: number, path: string): PokemonEggHatchDestinationOptionV1 => {
  const row = exact(value, [
    'schemaVersion', 'optionId', 'optionDefinitionSha256', 'kind', 'trainerSheetSlug',
    'trainerSheetRevision', 'availability', 'remainingTeamSlots',
  ], path)
  if (row.schemaVersion !== 1 || row.kind !== POKEMON_EGG_HATCH_DESTINATION_KINDS[index]) {
    return fail('breeding.hatch-offer.invalid-invariant', path, 'destinations must be ordered box then team.')
  }
  const remaining = row.remainingTeamSlots === null
    ? null
    : integer(row.remainingTeamSlots, `${path}.remainingTeamSlots`, POKEMON_EGG_HATCH_TEAM_CAPACITY)
  if ((row.kind === 'box') !== (remaining === null)) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.remainingTeamSlots`, 'only team destinations expose remaining slots.')
  }
  return Object.freeze({
    schemaVersion: 1,
    optionId: parseBreedingOfferOptionIdSyntax(row.optionId)
      ?? fail('breeding.hatch-offer.invalid-id', `${path}.optionId`, 'must be a breeding option ID.'),
    optionDefinitionSha256: hash(row.optionDefinitionSha256, `${path}.optionDefinitionSha256`),
    kind: row.kind,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerSheetRevision: integer(row.trainerSheetRevision, `${path}.trainerSheetRevision`, 2_147_483_647),
    availability: parseAvailability(row.availability, `${path}.availability`),
    remainingTeamSlots: remaining,
  }) as PokemonEggHatchDestinationOptionV1
}
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const parsePokemonEggHatchOwnerTrainerFactV1 = (
  value: unknown,
  path = 'pokemonEggHatchOwnerTrainerFact',
): PokemonEggHatchOwnerTrainerFactV1 => {
  const row = exact(value, [
    'schemaVersion', 'trainerSheetSlug', 'trainerSheetRevision', 'trainerSheetDefinitionSha256',
    'currentTeamCount', 'boxedPokemonCount', 'teamCapacity', 'remainingTeamSlots',
    'factDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || row.teamCapacity !== POKEMON_EGG_HATCH_TEAM_CAPACITY) {
    return fail('breeding.hatch-offer.invalid-document', path, 'must be a schema-v1 six-slot Trainer fact.')
  }
  const teamCount = integer(row.currentTeamCount, `${path}.currentTeamCount`, POKEMON_EGG_HATCH_TEAM_CAPACITY)
  const remaining = integer(row.remainingTeamSlots, `${path}.remainingTeamSlots`, POKEMON_EGG_HATCH_TEAM_CAPACITY)
  if (remaining !== POKEMON_EGG_HATCH_TEAM_CAPACITY - teamCount) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.remainingTeamSlots`, 'must equal capacity minus current team count.')
  }
  return freeze({
    schemaVersion: 1,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerSheetRevision: integer(row.trainerSheetRevision, `${path}.trainerSheetRevision`, 2_147_483_647),
    trainerSheetDefinitionSha256: hash(row.trainerSheetDefinitionSha256, `${path}.trainerSheetDefinitionSha256`),
    currentTeamCount: teamCount,
    boxedPokemonCount: integer(row.boxedPokemonCount, `${path}.boxedPokemonCount`, 10_000),
    teamCapacity: POKEMON_EGG_HATCH_TEAM_CAPACITY,
    remainingTeamSlots: remaining,
    factDefinitionSha256: hash(row.factDefinitionSha256, `${path}.factDefinitionSha256`),
  })
}

export const parsePokemonEggHatchOfferAuthorityV1 = (
  value: unknown,
  path = 'pokemonEggHatchOfferAuthority',
): PokemonEggHatchOfferAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion', 'offer', 'commandOperationId', 'commandSha256', 'eggId', 'eggRevision',
    'eggDefinitionSha256', 'ownerTrainerFactDefinitionSha256', 'actorAuthorityDefinitionSha256',
    'ownerTrainerControlDefinitionSha256', 'referenceVersionsDefinitionSha256',
    'lifecyclePolicyDefinitionSha256', 'securityPolicyDefinitionSha256', 'destinations',
    'selectedDestinationOptionId', 'blockerReasonIds', 'authorityDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1) return fail('breeding.hatch-offer.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  const offer = parseCampaignOperationOfferV1(row.offer, `${path}.offer`)
  if (offer.workspaceId !== 'breeding' || offer.operationFamilyId !== 'pokemon-egg-hatch'
    || offer.actionId !== 'breeding.egg.begin-hatch' || offer.source.kind !== 'system'
    || offer.source.canonicalId !== 'breeding.v1'
    || offer.requiredInputKinds.length !== 1 || offer.requiredInputKinds[0] !== 'confirmation'
    || offer.presentation.labelId !== 'breeding.egg.begin-hatch.label'
    || offer.presentation.descriptionId !== 'breeding.egg.begin-hatch.description'
    || offer.expiresAtCampaignMinute !== offer.issuedAtCampaignMinute + 1) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.offer`, 'must use the bounded Egg hatch campaign-offer contract.')
  }
  const destinationsValue = array(row.destinations, `${path}.destinations`, 2)
  const destinations = Object.freeze([
    parseDestination(destinationsValue[0], 0, `${path}.destinations[0]`),
    parseDestination(destinationsValue[1], 1, `${path}.destinations[1]`),
  ]) as readonly [PokemonEggHatchDestinationOptionV1, PokemonEggHatchDestinationOptionV1]
  if (destinations[0].trainerSheetSlug !== destinations[1].trainerSheetSlug
    || destinations[0].trainerSheetRevision !== destinations[1].trainerSheetRevision
    || destinations[0].optionId === destinations[1].optionId) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.destinations`, 'must target one exact Trainer revision with distinct option IDs.')
  }
  const selectedId = parseBreedingOfferOptionIdSyntax(row.selectedDestinationOptionId)
    ?? fail('breeding.hatch-offer.invalid-id', `${path}.selectedDestinationOptionId`, 'must be a breeding option ID.')
  const selected = destinations.find(option => option.optionId === selectedId)
    ?? fail('breeding.hatch-offer.invalid-invariant', `${path}.selectedDestinationOptionId`, 'must select one projected destination.')
  const blockerValues = boundedArray(row.blockerReasonIds, `${path}.blockerReasonIds`, 1).map((entry, index) => reason(entry, `${path}.blockerReasonIds[${index}]`))
  const selectedReason = selected.availability.reasonId
  if ((offer.availability.status === 'available') !== (selected.availability.status === 'available')
    || offer.availability.reasonId !== selectedReason
    || JSON.stringify(blockerValues) !== JSON.stringify(selectedReason === null ? [] : [selectedReason])
    || offer.presentation.tone !== (selectedReason === null ? 'primary' : 'warning')) {
    return fail('breeding.hatch-offer.invalid-invariant', path, 'offer, selected destination, blockers, and presentation tone must agree exactly.')
  }
  const lifecycleBlocker = selectedReason !== null && selectedReason !== 'breeding.hatch-offer.team-full'
  if (lifecycleBlocker) {
    if (destinations.some(option => option.availability.status !== 'unavailable'
      || option.availability.reasonId !== selectedReason)) {
      return fail('breeding.hatch-offer.invalid-invariant', `${path}.destinations`, 'lifecycle blockers apply to every destination.')
    }
  }
  else {
    if (destinations[0].availability.status !== 'available'
      || destinations[0].availability.reasonId !== null
      || (destinations[1].remainingTeamSlots === 0) !== (destinations[1].availability.reasonId === 'breeding.hatch-offer.team-full')) {
      return fail('breeding.hatch-offer.invalid-invariant', `${path}.destinations`, 'box is available and team availability follows remaining capacity when lifecycle-ready.')
    }
  }
  if (offer.audience === 'gm') {
    if (offer.actor.kind !== 'campaign' || offer.actor.resourceId !== 'campaign'
      || offer.actor.revision !== null || row.ownerTrainerControlDefinitionSha256 !== null) {
      return fail('breeding.hatch-offer.invalid-invariant', path, 'GM hatch offers use current campaign authority without owner-control evidence.')
    }
  }
  else if (offer.actor.kind !== 'trainer-sheet'
    || offer.actor.resourceId !== destinations[0].trainerSheetSlug
    || offer.actor.revision !== destinations[0].trainerSheetRevision
    || row.ownerTrainerControlDefinitionSha256 === null) {
    return fail('breeding.hatch-offer.invalid-invariant', path, 'owner hatch offers require the exact owner Trainer revision and control evidence.')
  }
  return freeze({
    schemaVersion: 1,
    offer,
    commandOperationId: parseBreedingOperationIdSyntax(row.commandOperationId)
      ?? fail('breeding.hatch-offer.invalid-id', `${path}.commandOperationId`, 'must be a breeding operation ID.'),
    commandSha256: hash(row.commandSha256, `${path}.commandSha256`),
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.hatch-offer.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'),
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`, 2_147_483_647),
    eggDefinitionSha256: hash(row.eggDefinitionSha256, `${path}.eggDefinitionSha256`),
    ownerTrainerFactDefinitionSha256: hash(row.ownerTrainerFactDefinitionSha256, `${path}.ownerTrainerFactDefinitionSha256`),
    actorAuthorityDefinitionSha256: hash(row.actorAuthorityDefinitionSha256, `${path}.actorAuthorityDefinitionSha256`),
    ownerTrainerControlDefinitionSha256: nullableHash(row.ownerTrainerControlDefinitionSha256, `${path}.ownerTrainerControlDefinitionSha256`),
    referenceVersionsDefinitionSha256: hash(row.referenceVersionsDefinitionSha256, `${path}.referenceVersionsDefinitionSha256`),
    lifecyclePolicyDefinitionSha256: hash(row.lifecyclePolicyDefinitionSha256, `${path}.lifecyclePolicyDefinitionSha256`),
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    destinations,
    selectedDestinationOptionId: selectedId,
    blockerReasonIds: Object.freeze(blockerValues),
    authorityDefinitionSha256: hash(row.authorityDefinitionSha256, `${path}.authorityDefinitionSha256`),
  })
}

const parseProjectedDestination = (
  value: unknown,
  index: number,
  path: string,
): PokemonEggHatchProjectedDestinationV1 => {
  const row = exact(value, ['optionId', 'kind', 'trainerSheetSlug', 'availability', 'remainingTeamSlots'], path)
  if (row.kind !== POKEMON_EGG_HATCH_DESTINATION_KINDS[index]) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.kind`, 'projected destinations must be ordered box then team.')
  }
  const remaining = row.remainingTeamSlots === null
    ? null
    : integer(row.remainingTeamSlots, `${path}.remainingTeamSlots`, POKEMON_EGG_HATCH_TEAM_CAPACITY)
  if ((row.kind === 'box') !== (remaining === null)) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.remainingTeamSlots`, 'only team destinations expose remaining slots.')
  }
  return freeze({
    optionId: parseBreedingOfferOptionIdSyntax(row.optionId)
      ?? fail('breeding.hatch-offer.invalid-id', `${path}.optionId`, 'must be a breeding option ID.'),
    kind: row.kind,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    availability: parseAvailability(row.availability, `${path}.availability`),
    remainingTeamSlots: remaining,
  }) as PokemonEggHatchProjectedDestinationV1
}

export const parsePokemonEggHatchOfferProjectionV1 = (
  value: unknown,
  path = 'pokemonEggHatchOfferProjection',
): PokemonEggHatchOfferProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'eggId', 'eggRevision', 'eggStatus', 'offer',
    'destinations', 'selectedDestinationOptionId', 'blockerReasonIds', 'canSubmit',
    'generatedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || !isPokemonEggStatus(row.eggStatus)) {
    return fail('breeding.hatch-offer.invalid-document', path, 'must be a schema-v1 owner or GM Egg hatch projection.')
  }
  const offer = parseCampaignOperationOfferV1(row.offer, `${path}.offer`)
  if (offer.audience !== row.audience
    || offer.workspaceId !== 'breeding'
    || offer.operationFamilyId !== 'pokemon-egg-hatch'
    || offer.actionId !== 'breeding.egg.begin-hatch'
    || offer.source.kind !== 'system'
    || offer.source.canonicalId !== 'breeding.v1'
    || offer.requiredInputKinds.length !== 1
    || offer.requiredInputKinds[0] !== 'confirmation'
    || offer.presentation.labelId !== 'breeding.egg.begin-hatch.label'
    || offer.presentation.descriptionId !== 'breeding.egg.begin-hatch.description'
    || offer.issuedAtCampaignMinute !== row.generatedAtCampaignMinute
    || offer.expiresAtCampaignMinute !== offer.issuedAtCampaignMinute + 1) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.offer`, 'must match the bounded hatch offer audience, action, source, input, presentation, and campaign minute.')
  }
  const values = array(row.destinations, `${path}.destinations`, 2)
  const destinations = Object.freeze([
    parseProjectedDestination(values[0], 0, `${path}.destinations[0]`),
    parseProjectedDestination(values[1], 1, `${path}.destinations[1]`),
  ]) as readonly [PokemonEggHatchProjectedDestinationV1, PokemonEggHatchProjectedDestinationV1]
  if (destinations[0].trainerSheetSlug !== destinations[1].trainerSheetSlug
    || destinations[0].optionId === destinations[1].optionId) {
    return fail('breeding.hatch-offer.invalid-invariant', `${path}.destinations`, 'must contain distinct choices for one owner Trainer.')
  }
  const selectedDestinationOptionId = parseBreedingOfferOptionIdSyntax(row.selectedDestinationOptionId)
    ?? fail('breeding.hatch-offer.invalid-id', `${path}.selectedDestinationOptionId`, 'must be a breeding option ID.')
  const selected = destinations.find(option => option.optionId === selectedDestinationOptionId)
    ?? fail('breeding.hatch-offer.invalid-invariant', `${path}.selectedDestinationOptionId`, 'must select one projected destination.')
  const blockerReasonIds = boundedArray(row.blockerReasonIds, `${path}.blockerReasonIds`, 1)
    .map((entry, index) => reason(entry, `${path}.blockerReasonIds[${index}]`))
  const lifecycleReason = row.eggStatus === 'incubating'
    ? 'breeding.egg-lifecycle.not-ready'
    : row.eggStatus === 'awaiting-special-adjudication' || row.eggStatus === 'hatching'
      ? 'breeding.egg-lifecycle.hatch-already-started'
      : row.eggStatus === 'hatched'
        ? 'breeding.egg-lifecycle.already-hatched'
        : row.eggStatus === 'cancelled'
          ? 'breeding.egg-lifecycle.cancelled'
          : row.eggStatus === 'invalidated-by-gm'
            ? 'breeding.egg-lifecycle.invalidated-by-gm'
            : null
  const actorMatches = row.audience === 'gm'
    ? offer.actor.kind === 'campaign' && offer.actor.resourceId === 'campaign' && offer.actor.revision === null
    : offer.actor.kind === 'trainer-sheet'
      && offer.actor.resourceId === destinations[0].trainerSheetSlug
      && offer.actor.revision !== null
  if (!actorMatches
    || offer.presentation.tone !== (selected.availability.status === 'available' ? 'primary' : 'warning')
    || (lifecycleReason !== null && destinations.some(destination => destination.availability.reasonId !== lifecycleReason))
    || (row.eggStatus === 'ready' && destinations[0].availability.status !== 'available')
    || typeof row.canSubmit !== 'boolean'
    || row.canSubmit !== (selected.availability.status === 'available')
    || row.canSubmit !== (offer.availability.status === 'available')
    || offer.availability.reasonId !== selected.availability.reasonId
    || JSON.stringify(blockerReasonIds) !== JSON.stringify(selected.availability.reasonId === null ? [] : [selected.availability.reasonId])) {
    return fail('breeding.hatch-offer.invalid-invariant', path, 'selected choice, blocker, offer, and submit state must agree exactly.')
  }
  return freeze({
    schemaVersion: 1,
    audience: row.audience,
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.hatch-offer.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'),
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`, 2_147_483_647),
    eggStatus: row.eggStatus,
    offer,
    destinations,
    selectedDestinationOptionId,
    blockerReasonIds: Object.freeze(blockerReasonIds),
    canSubmit: row.canSubmit,
    generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`),
  }) as PokemonEggHatchOfferProjectionV1
}
