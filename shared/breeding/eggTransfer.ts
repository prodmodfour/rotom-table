import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import { isSlug } from '../paths'
import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
  type PokemonEggTransferConsentId,
} from './ids'

export const POKEMON_EGG_TRANSFER_CONSENT_ROLES = Object.freeze([
  'source-gift', 'recipient-acceptance',
] as const)
export const POKEMON_EGG_TRANSFER_CONSENT_STATUSES = Object.freeze([
  'active', 'consumed', 'revoked', 'expired',
] as const)
export const POKEMON_EGG_TRANSFER_PROJECTION_STATES = Object.freeze([
  'offered', 'accepted', 'transferred', 'revoked', 'expired',
] as const)

export type PokemonEggTransferConsentRoleV1 = typeof POKEMON_EGG_TRANSFER_CONSENT_ROLES[number]
export type PokemonEggTransferConsentStatusV1 = typeof POKEMON_EGG_TRANSFER_CONSENT_STATUSES[number]
export type PokemonEggTransferProjectionStateV1 = typeof POKEMON_EGG_TRANSFER_PROJECTION_STATES[number]

export interface PokemonEggTransferConsentV1 {
  readonly schemaVersion: 1
  readonly consentId: PokemonEggTransferConsentId
  readonly revision: 0 | 1
  readonly status: PokemonEggTransferConsentStatusV1
  readonly role: PokemonEggTransferConsentRoleV1
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly sourceTrainerSlug: string
  readonly destinationTrainerSlug: string
  readonly consentingProfileId: PlayerProfileId
  readonly consentingTrainerSlug: string
  readonly consentingTrainerRevision: number
  readonly consentingTrainerDefinitionSha256: string
  readonly trainerControlDefinitionSha256: string
  readonly counterpartConsentId: PokemonEggTransferConsentId | null
  readonly grantedAtCampaignMinute: number
  readonly expiresAtCampaignMinute: number
  readonly settlementOperationId: BreedingOperationId | null
  readonly settledAtCampaignMinute: number | null
  readonly definitionSha256: string
}

export interface PokemonEggTransferProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'source-owner' | 'recipient'
  readonly offerConsentId: PokemonEggTransferConsentId
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly state: PokemonEggTransferProjectionStateV1
  readonly counterpartyTrainerSlug: string
  readonly canAccept: boolean
  readonly canTransfer: boolean
  readonly canRevoke: boolean
  readonly expiresAtCampaignMinute: number
  readonly generatedAtCampaignMinute: number
}

export type PokemonEggTransferValidationCode =
  | 'breeding.egg-transfer.invalid-document'
  | 'breeding.egg-transfer.unknown-field'
  | 'breeding.egg-transfer.invalid-id'
  | 'breeding.egg-transfer.invalid-invariant'

export class PokemonEggTransferValidationError extends Error {
  readonly code: PokemonEggTransferValidationCode
  readonly path: string

  constructor(code: PokemonEggTransferValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggTransferValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const ROLE_SET = new Set<string>(POKEMON_EGG_TRANSFER_CONSENT_ROLES)
const STATUS_SET = new Set<string>(POKEMON_EGG_TRANSFER_CONSENT_STATUSES)
const STATE_SET = new Set<string>(POKEMON_EGG_TRANSFER_PROJECTION_STATES)

const fail = (code: PokemonEggTransferValidationCode, path: string, message: string): never => {
  throw new PokemonEggTransferValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.egg-transfer.invalid-document', path, 'must be a plain data object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg-transfer.invalid-document', path, 'must be a plain data object without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-transfer.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    return fail('breeding.egg-transfer.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    return fail('breeding.egg-transfer.invalid-document', path, `must be a safe integer from 0 through ${maximum}.`)
  }
  return value as number
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.egg-transfer.invalid-document', path, 'must be one lowercase SHA-256 value.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.egg-transfer.invalid-id', path, 'must be one bounded canonical Trainer slug.')
const profileId = (value: unknown, path: string): PlayerProfileId => isPlayerProfileId(value)
  ? value
  : fail('breeding.egg-transfer.invalid-id', path, 'must be one stored Player Profile ID.')
const consentId = (value: unknown, path: string): PokemonEggTransferConsentId => (
  parsePokemonEggTransferConsentIdSyntax(value)
  ?? fail('breeding.egg-transfer.invalid-id', path, 'must be one Egg-transfer consent ID.')
)
const eggId = (value: unknown, path: string): PokemonEggId => parsePokemonEggIdSyntax(value)
  ?? fail('breeding.egg-transfer.invalid-id', path, 'must be one Pokémon Egg ID.')
const nullableConsentId = (value: unknown, path: string): PokemonEggTransferConsentId | null => value === null
  ? null
  : consentId(value, path)
const nullableOperationId = (value: unknown, path: string): BreedingOperationId | null => value === null
  ? null
  : parseBreedingOperationIdSyntax(value)
    ?? fail('breeding.egg-transfer.invalid-id', path, 'must be null or one Breeding operation ID.')
const nullableInteger = (value: unknown, path: string): number | null => value === null
  ? null
  : integer(value, path)
const boolean = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail('breeding.egg-transfer.invalid-document', path, 'must be a boolean.')
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const parsePokemonEggTransferConsentV1 = (
  value: unknown,
  path = 'pokemonEggTransferConsent',
): PokemonEggTransferConsentV1 => {
  const row = exact(value, [
    'schemaVersion', 'consentId', 'revision', 'status', 'role', 'eggId', 'eggRevision',
    'sourceTrainerSlug', 'destinationTrainerSlug', 'consentingProfileId',
    'consentingTrainerSlug', 'consentingTrainerRevision', 'consentingTrainerDefinitionSha256',
    'trainerControlDefinitionSha256', 'counterpartConsentId', 'grantedAtCampaignMinute',
    'expiresAtCampaignMinute', 'settlementOperationId', 'settledAtCampaignMinute',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || typeof row.role !== 'string' || !ROLE_SET.has(row.role)
    || typeof row.status !== 'string' || !STATUS_SET.has(row.status)) {
    return fail('breeding.egg-transfer.invalid-document', path, 'must be one closed schema-v1 transfer consent.')
  }
  const revision = integer(row.revision, `${path}.revision`, 1)
  const role = row.role as PokemonEggTransferConsentRoleV1
  const status = row.status as PokemonEggTransferConsentStatusV1
  const sourceTrainerSlug = slug(row.sourceTrainerSlug, `${path}.sourceTrainerSlug`)
  const destinationTrainerSlug = slug(row.destinationTrainerSlug, `${path}.destinationTrainerSlug`)
  const consentingTrainerSlug = slug(row.consentingTrainerSlug, `${path}.consentingTrainerSlug`)
  const counterpartConsentId = nullableConsentId(row.counterpartConsentId, `${path}.counterpartConsentId`)
  const grantedAtCampaignMinute = integer(row.grantedAtCampaignMinute, `${path}.grantedAtCampaignMinute`)
  const expiresAtCampaignMinute = integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  const settlementOperationId = nullableOperationId(row.settlementOperationId, `${path}.settlementOperationId`)
  const settledAtCampaignMinute = nullableInteger(row.settledAtCampaignMinute, `${path}.settledAtCampaignMinute`)
  const isActive = status === 'active'
  if (sourceTrainerSlug === destinationTrainerSlug
    || consentingTrainerSlug !== (role === 'source-gift' ? sourceTrainerSlug : destinationTrainerSlug)
    || (role === 'source-gift') !== (counterpartConsentId === null)
    || expiresAtCampaignMinute <= grantedAtCampaignMinute
    || (isActive && (revision !== 0 || settlementOperationId !== null || settledAtCampaignMinute !== null))
    || (!isActive && (revision !== 1 || settlementOperationId === null || settledAtCampaignMinute === null))
    || (settledAtCampaignMinute !== null && settledAtCampaignMinute < grantedAtCampaignMinute)
    || (status === 'consumed' && settledAtCampaignMinute !== null
      && settledAtCampaignMinute >= expiresAtCampaignMinute)) {
    return fail('breeding.egg-transfer.invalid-invariant', path, 'role, participants, expiry, revision, status, and settlement facts must agree exactly.')
  }
  const parsedConsentId = consentId(row.consentId, `${path}.consentId`)
  if (counterpartConsentId === parsedConsentId) {
    return fail('breeding.egg-transfer.invalid-invariant', `${path}.counterpartConsentId`, 'cannot reference itself.')
  }
  return deepFreeze({
    schemaVersion: 1,
    consentId: parsedConsentId,
    revision: revision as 0 | 1,
    status,
    role,
    eggId: eggId(row.eggId, `${path}.eggId`),
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`, 2_147_483_647),
    sourceTrainerSlug,
    destinationTrainerSlug,
    consentingProfileId: profileId(row.consentingProfileId, `${path}.consentingProfileId`),
    consentingTrainerSlug,
    consentingTrainerRevision: integer(row.consentingTrainerRevision, `${path}.consentingTrainerRevision`, 2_147_483_647),
    consentingTrainerDefinitionSha256: hash(row.consentingTrainerDefinitionSha256, `${path}.consentingTrainerDefinitionSha256`),
    trainerControlDefinitionSha256: hash(row.trainerControlDefinitionSha256, `${path}.trainerControlDefinitionSha256`),
    counterpartConsentId,
    grantedAtCampaignMinute,
    expiresAtCampaignMinute,
    settlementOperationId,
    settledAtCampaignMinute,
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

export const parsePokemonEggTransferProjectionV1 = (
  value: unknown,
  path = 'pokemonEggTransferProjection',
): PokemonEggTransferProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'offerConsentId', 'eggId', 'eggRevision', 'state',
    'counterpartyTrainerSlug', 'canAccept', 'canTransfer', 'canRevoke',
    'expiresAtCampaignMinute', 'generatedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'source-owner' && row.audience !== 'recipient')
    || typeof row.state !== 'string' || !STATE_SET.has(row.state)) {
    return fail('breeding.egg-transfer.invalid-document', path, 'must be one closed schema-v1 transfer projection.')
  }
  const state = row.state as PokemonEggTransferProjectionStateV1
  const audience = row.audience as 'source-owner' | 'recipient'
  const canAccept = boolean(row.canAccept, `${path}.canAccept`)
  const canTransfer = boolean(row.canTransfer, `${path}.canTransfer`)
  const canRevoke = boolean(row.canRevoke, `${path}.canRevoke`)
  if (canAccept !== (state === 'offered' && audience === 'recipient')
    || canTransfer !== (state === 'accepted')
    || canRevoke !== (state === 'offered' || state === 'accepted')) {
    return fail('breeding.egg-transfer.invalid-invariant', path, 'state and available actions must agree exactly.')
  }
  const expiresAtCampaignMinute = integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  const generatedAtCampaignMinute = integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`)
  if ((state === 'offered' || state === 'accepted') && generatedAtCampaignMinute >= expiresAtCampaignMinute) {
    return fail('breeding.egg-transfer.invalid-invariant', path, 'an active projection must be strictly before expiry.')
  }
  return deepFreeze({
    schemaVersion: 1,
    audience,
    offerConsentId: consentId(row.offerConsentId, `${path}.offerConsentId`),
    eggId: eggId(row.eggId, `${path}.eggId`),
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`, 2_147_483_647),
    state,
    counterpartyTrainerSlug: slug(row.counterpartyTrainerSlug, `${path}.counterpartyTrainerSlug`),
    canAccept,
    canTransfer,
    canRevoke,
    expiresAtCampaignMinute,
    generatedAtCampaignMinute,
  })
}
