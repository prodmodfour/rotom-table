import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import type { PokemonEggTransferConsentV1, PokemonEggTransferProjectionV1 } from '#shared/breeding/eggTransfer'
import { parsePokemonEggIdSyntax, parsePokemonEggTransferConsentIdSyntax } from '#shared/breeding/ids'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  createPokemonEggTransferConsentV1,
  projectPokemonEggTransferV1,
} from '../domain/breeding/eggTransfer'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqlitePokemonEggTransferConsentRepository } from '../storage/pokemonEggTransferConsentRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'

export interface GrantPokemonEggTransferConsentInputV1 {
  readonly consentId: unknown
  readonly role: 'source-gift' | 'recipient-acceptance'
  readonly eggId: unknown
  readonly destinationTrainerSlug: unknown
  readonly sourceConsentId: unknown | null
  readonly expiresAtCampaignMinute: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown
}

export interface QueryPokemonEggTransferConsentInputV1 {
  readonly sourceConsentId: unknown
  readonly audience: 'source-owner' | 'recipient'
  readonly trainerControl: unknown
}

export interface PokemonEggTransferConsentOptions {
  readonly database?: RotomDatabase
  readonly validateCurrentProfileControl: (input: {
    readonly actorAuthority: BreedingActorAuthorityV1 | null
    readonly trainerControl: BreedingTrainerControlEvidenceV1
  }) => boolean
}

export type PokemonEggTransferConsentUseCaseErrorCode =
  | 'breeding.egg-transfer-consent.invalid-request'
  | 'breeding.egg-transfer-consent.invalid-authority'
  | 'breeding.egg-transfer-consent.not-found'
  | 'breeding.egg-transfer-consent.repository-mismatch'

export class PokemonEggTransferConsentUseCaseError extends Error {
  readonly code: PokemonEggTransferConsentUseCaseErrorCode

  constructor(code: PokemonEggTransferConsentUseCaseErrorCode, message: string) {
    super(message)
    this.name = 'PokemonEggTransferConsentUseCaseError'
    this.code = code
  }
}

const fail = (code: PokemonEggTransferConsentUseCaseErrorCode, message: string): never => {
  throw new PokemonEggTransferConsentUseCaseError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const strictObject = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg-transfer-consent.invalid-request', `${label} must be one plain data object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.egg-transfer-consent.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-transfer-consent.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const validateProfileControl = (
  options: PokemonEggTransferConsentOptions,
  actor: BreedingActorAuthorityV1 | null,
  control: BreedingTrainerControlEvidenceV1,
): void => {
  let result: unknown
  try {
    result = options.validateCurrentProfileControl({ actorAuthority: actor, trainerControl: control })
  }
  catch {
    return fail('breeding.egg-transfer-consent.invalid-authority', 'Current Profile control validation failed closed.')
  }
  if (promiseLike(result) || result !== true) {
    return fail('breeding.egg-transfer-consent.invalid-authority', 'Current Profile control validation must synchronously return exact true.')
  }
}
const currentTrainerFact = (database: RotomDatabase, trainerSlug: string) => {
  const sheet = createSqliteSheetRepository(database).get('trainer', trainerSlug)
    ?? fail('breeding.egg-transfer-consent.not-found', 'The current Trainer is unavailable.')
  return Object.freeze({
    slug: sheet.slug,
    revision: sheet.revision,
    definitionSha256: sha256(sheet.document),
  })
}
const controlMatchesFact = (
  control: BreedingTrainerControlEvidenceV1,
  fact: ReturnType<typeof currentTrainerFact>,
  campaignMinute: number,
): boolean => control.trainerSheetSlug === fact.slug
  && control.trainerSheetRevision === fact.revision
  && control.trainerSheetDefinitionSha256 === fact.definitionSha256
  && control.evaluatedAtCampaignMinute === campaignMinute

export const grantPokemonEggTransferConsent = (
  input: GrantPokemonEggTransferConsentInputV1,
  options: PokemonEggTransferConsentOptions,
): PokemonEggTransferConsentV1 => {
  strictObject(input, [
    'consentId', 'role', 'eggId', 'destinationTrainerSlug', 'sourceConsentId',
    'expiresAtCampaignMinute', 'actorAuthority', 'trainerControl',
  ], 'grantEggTransferConsentInput')
  const consentId = parsePokemonEggTransferConsentIdSyntax(input.consentId)
    ?? fail('breeding.egg-transfer-consent.invalid-request', 'consentId must be one Egg-transfer consent ID.')
  const eggId = parsePokemonEggIdSyntax(input.eggId)
    ?? fail('breeding.egg-transfer-consent.invalid-request', 'eggId must be one Pokémon Egg ID.')
  if (input.role !== 'source-gift' && input.role !== 'recipient-acceptance') {
    return fail('breeding.egg-transfer-consent.invalid-request', 'role must be source-gift or recipient-acceptance.')
  }
  if (typeof input.destinationTrainerSlug !== 'string' || !/^[a-z0-9-]+$/.test(input.destinationTrainerSlug)) {
    return fail('breeding.egg-transfer-consent.invalid-request', 'destinationTrainerSlug must be one canonical Trainer slug.')
  }
  const sourceConsentId = input.sourceConsentId === null
    ? null
    : parsePokemonEggTransferConsentIdSyntax(input.sourceConsentId)
      ?? fail('breeding.egg-transfer-consent.invalid-request', 'sourceConsentId must be null or one Egg-transfer consent ID.')
  if ((input.role === 'source-gift') !== (sourceConsentId === null)) {
    return fail('breeding.egg-transfer-consent.invalid-request', 'Only recipient acceptance must cite one source gift consent.')
  }
  const database = options.database ?? getRotomDatabase()
  return database.withTransaction(() => {
    const clock = createSqliteCampaignClockRepository(database).get()
    const egg = createSqlitePokemonEggRepository(database).get(eggId)
      ?? fail('breeding.egg-transfer-consent.not-found', 'The current Egg is unavailable.')
    const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
    const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
    const sourceTrainer = currentTrainerFact(database, egg.ownerTrainerSlug)
    const destinationTrainer = currentTrainerFact(database, input.destinationTrainerSlug)
    const expectedTrainer = input.role === 'source-gift' ? sourceTrainer : destinationTrainer
    if (actor.role !== 'player'
      || actor.authenticatedProfileId !== control.profileId
      || actor.profileDefinitionSha256 !== control.profileDefinitionSha256
      || actor.commandActorProfileId !== control.profileId
      || actor.selectedTrainerSlug !== expectedTrainer.slug
      || actor.evaluatedAtCampaignMinute !== clock.campaignMinute
      || !controlMatchesFact(control, expectedTrainer, clock.campaignMinute)) {
      return fail('breeding.egg-transfer-consent.invalid-authority', 'Consent requires exact current Profile control of its consenting Trainer.')
    }
    validateProfileControl(options, actor, control)
    const repository = createSqlitePokemonEggTransferConsentRepository(database)
    const counterpart = sourceConsentId ? repository.get(sourceConsentId)
      ?? fail('breeding.egg-transfer-consent.not-found', 'The source gift consent is unavailable.')
      : null
    const consent = createPokemonEggTransferConsentV1({
      consentId,
      role: input.role,
      egg,
      sourceTrainer,
      destinationTrainer,
      trainerControl: control,
      counterpartConsent: counterpart,
      grantedAtCampaignMinute: clock.campaignMinute,
      expiresAtCampaignMinute: input.expiresAtCampaignMinute,
    })
    return repository.insert(consent)
  })
}

export const queryPokemonEggTransferConsent = (
  input: QueryPokemonEggTransferConsentInputV1,
  options: PokemonEggTransferConsentOptions,
): PokemonEggTransferProjectionV1 => {
  strictObject(input, ['sourceConsentId', 'audience', 'trainerControl'], 'queryEggTransferConsentInput')
  const sourceConsentId = parsePokemonEggTransferConsentIdSyntax(input.sourceConsentId)
    ?? fail('breeding.egg-transfer-consent.invalid-request', 'sourceConsentId must be one Egg-transfer consent ID.')
  if (input.audience !== 'source-owner' && input.audience !== 'recipient') {
    return fail('breeding.egg-transfer-consent.invalid-request', 'audience must be source-owner or recipient.')
  }
  const database = options.database ?? getRotomDatabase()
  const clock = createSqliteCampaignClockRepository(database).get()
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const repository = createSqlitePokemonEggTransferConsentRepository(database)
  const source = repository.get(sourceConsentId)
    ?? fail('breeding.egg-transfer-consent.not-found', 'The transfer offer is unavailable.')
  if (source.role !== 'source-gift') {
    return fail('breeding.egg-transfer-consent.invalid-request', 'sourceConsentId must identify the source gift.')
  }
  const expectedTrainer = input.audience === 'source-owner'
    ? source.sourceTrainerSlug
    : source.destinationTrainerSlug
  const fact = currentTrainerFact(database, expectedTrainer)
  if (!controlMatchesFact(control, fact, clock.campaignMinute)) {
    return fail('breeding.egg-transfer-consent.invalid-authority', 'Projection requires exact current control of the targeted participant.')
  }
  validateProfileControl(options, null, control)
  const recipient = repository.listByEgg(source.eggId, 32).find(value => (
    value.role === 'recipient-acceptance' && value.counterpartConsentId === source.consentId
  )) ?? null
  return projectPokemonEggTransferV1({
    sourceConsent: source,
    recipientConsent: recipient,
    audience: input.audience,
    generatedAtCampaignMinute: clock.campaignMinute,
  })
}
