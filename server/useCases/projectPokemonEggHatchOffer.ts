import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1 } from '#shared/breeding/authorization'
import type { PokemonEggHatchOfferAuthorityV1, PokemonEggHatchOfferProjectionV1 } from '#shared/breeding/hatchOffers'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { parseAuthoritativeBreedingActorAuthorityV1 } from '../domain/breeding/authorization'
import {
  consumePokemonEggHatchOfferV1,
  createPokemonEggHatchOwnerTrainerFactV1,
  projectPokemonEggHatchOfferProjectionV1,
  projectPokemonEggHatchOfferV1,
  type ConsumePokemonEggHatchOfferInputV1,
  type ProjectPokemonEggHatchOfferInputV1,
  type ConsumedPokemonEggHatchOfferV1,
} from '../domain/breeding/hatchOffers'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from '../domain/breeding/eggLifecyclePolicy'
import { parseAuthoritativeBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/readSets'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'

export interface ProjectCurrentPokemonEggHatchOfferInputV1 {
  readonly command: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown | null
  readonly referenceVersions: unknown
}
export interface ConsumeCurrentPokemonEggHatchOfferInputV1 extends ProjectCurrentPokemonEggHatchOfferInputV1 {
  readonly declaration: unknown
}
export interface ProjectCurrentPokemonEggHatchOfferOptions {
  readonly database?: RotomDatabase
  readonly resolveCurrentReferenceVersions: () => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}

export type ProjectPokemonEggHatchOfferErrorCode =
  | 'breeding.hatch-offer-use-case.invalid-request'
  | 'breeding.hatch-offer-use-case.invalid-authority'
  | 'breeding.hatch-offer-use-case.unavailable'
  | 'breeding.hatch-offer-use-case.stale-authority'
export class ProjectPokemonEggHatchOfferError extends Error {
  readonly code: ProjectPokemonEggHatchOfferErrorCode
  constructor(code: ProjectPokemonEggHatchOfferErrorCode, message: string) {
    super(message)
    this.name = 'ProjectPokemonEggHatchOfferError'
    this.code = code
  }
}

const fail = (code: ProjectPokemonEggHatchOfferErrorCode, message: string): never => {
  throw new ProjectPokemonEggHatchOfferError(code, message)
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const strictObject = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-offer-use-case.invalid-request', `${label} must be a plain data object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-offer-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-offer-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)

const currentInput = (
  input: ProjectCurrentPokemonEggHatchOfferInputV1,
  options: ProjectCurrentPokemonEggHatchOfferOptions,
): ProjectPokemonEggHatchOfferInputV1 => {
  strictObject(input, ['command', 'actorAuthority', 'ownerTrainerControl', 'referenceVersions'], 'hatchOfferInput')
  if (typeof options.resolveCurrentReferenceVersions !== 'function') {
    return fail('breeding.hatch-offer-use-case.invalid-request', 'A server-owned current reference resolver is required.')
  }
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'begin-hatch') {
    return fail('breeding.hatch-offer-use-case.invalid-request', 'Hatch offer projection accepts begin-hatch only.')
  }
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const database = options.database ?? getRotomDatabase()
  const clock = createSqliteCampaignClockRepository(database).get()
  if (actor.evaluatedAtCampaignMinute !== clock.campaignMinute) {
    return fail('breeding.hatch-offer-use-case.stale-authority', 'Actor authority must use the exact current campaign minute.')
  }
  if (actor.role === 'gm') {
    if (!options.validateCurrentGmAuthority) {
      return fail('breeding.hatch-offer-use-case.invalid-authority', 'Current GM authority verifier is required.')
    }
    let authorized: unknown
    try { authorized = options.validateCurrentGmAuthority(actor) }
    catch { return fail('breeding.hatch-offer-use-case.invalid-authority', 'Current GM authority verifier failed closed.') }
    if (promiseLike(authorized) || authorized !== true) {
      return fail('breeding.hatch-offer-use-case.invalid-authority', 'Current authenticated GM authority is required.')
    }
  }
  else if (options.validateCurrentGmAuthority !== undefined) {
    return fail('breeding.hatch-offer-use-case.invalid-authority', 'Owner offer projection rejects extraneous GM authority callbacks.')
  }
  let currentReferencesValue: unknown
  try { currentReferencesValue = options.resolveCurrentReferenceVersions() }
  catch { return fail('breeding.hatch-offer-use-case.stale-authority', 'Current reference resolver failed closed.') }
  if (promiseLike(currentReferencesValue)) {
    return fail('breeding.hatch-offer-use-case.stale-authority', 'Current reference resolution must be synchronous.')
  }
  const suppliedReferences = parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions)
  const currentReferences = parseAuthoritativeBreedingReferenceVersionSnapshotV1(currentReferencesValue)
  if (!same(suppliedReferences, currentReferences)) {
    return fail('breeding.hatch-offer-use-case.stale-authority', 'Hatch offer references must exactly match the current app-owned snapshot.')
  }
  const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.hatch-offer-use-case.unavailable', 'Hatch offer is unavailable for this Egg.')
  const trainer = createSqliteSheetRepository(database).get('trainer', egg.ownerTrainerSlug)
    ?? fail('breeding.hatch-offer-use-case.unavailable', 'Hatch offer is unavailable for this owner destination.')
  const ownerTrainerFact = createPokemonEggHatchOwnerTrainerFactV1({
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDocument: trainer.document,
  })
  return Object.freeze({
    command,
    egg,
    ownerTrainerFact,
    actorAuthority: actor,
    ownerTrainerControl: input.ownerTrainerControl,
    referenceVersions: suppliedReferences,
    atCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
}
const ensureStillCurrent = (
  projectedInput: ProjectPokemonEggHatchOfferInputV1,
  authority: PokemonEggHatchOfferAuthorityV1,
  database: RotomDatabase,
): void => {
  const command = parseBreedingOperationCommandV1(projectedInput.command)
  if (command.commandKind !== 'begin-hatch') {
    return fail('breeding.hatch-offer-use-case.invalid-request', 'Projected hatch command changed kind.')
  }
  const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
  const trainer = egg ? createSqliteSheetRepository(database).get('trainer', egg.ownerTrainerSlug) : null
  const clock = createSqliteCampaignClockRepository(database).get()
  if (!egg || !trainer
    || clock.campaignMinute !== projectedInput.atCampaignMinute
    || egg.revision !== authority.eggRevision
    || pokemonEggLifecycleDocumentDefinitionSha256(egg) !== authority.eggDefinitionSha256) {
    return fail('breeding.hatch-offer-use-case.stale-authority', 'Egg changed during hatch offer projection.')
  }
  const fact = createPokemonEggHatchOwnerTrainerFactV1({
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDocument: trainer.document,
  })
  if (fact.factDefinitionSha256 !== authority.ownerTrainerFactDefinitionSha256) {
    return fail('breeding.hatch-offer-use-case.stale-authority', 'Owner destination changed during hatch offer projection.')
  }
}

export const projectCurrentPokemonEggHatchOffer = (
  input: ProjectCurrentPokemonEggHatchOfferInputV1,
  options: ProjectCurrentPokemonEggHatchOfferOptions,
): PokemonEggHatchOfferAuthorityV1 => {
  const database = options.database ?? getRotomDatabase()
  const projectedInput = currentInput(input, { ...options, database })
  const authority = projectPokemonEggHatchOfferV1(projectedInput)
  ensureStillCurrent(projectedInput, authority, database)
  return authority
}

export const projectCurrentPokemonEggHatchOfferProjection = (
  input: ProjectCurrentPokemonEggHatchOfferInputV1,
  options: ProjectCurrentPokemonEggHatchOfferOptions,
): PokemonEggHatchOfferProjectionV1 => {
  const database = options.database ?? getRotomDatabase()
  const authority = projectCurrentPokemonEggHatchOffer(input, { ...options, database })
  const egg = createSqlitePokemonEggRepository(database).get(authority.eggId)
    ?? fail('breeding.hatch-offer-use-case.stale-authority', 'Egg changed before hatch offer projection.')
  if (egg.revision !== authority.eggRevision) {
    return fail('breeding.hatch-offer-use-case.stale-authority', 'Egg changed before hatch offer projection.')
  }
  return projectPokemonEggHatchOfferProjectionV1({ authority, egg })
}

export const consumeCurrentPokemonEggHatchOffer = (
  input: ConsumeCurrentPokemonEggHatchOfferInputV1,
  options: ProjectCurrentPokemonEggHatchOfferOptions,
): ConsumedPokemonEggHatchOfferV1 => {
  strictObject(input, ['command', 'actorAuthority', 'ownerTrainerControl', 'referenceVersions', 'declaration'], 'hatchOfferConsumeInput')
  const database = options.database ?? getRotomDatabase()
  const projectedInput = currentInput({
    command: input.command,
    actorAuthority: input.actorAuthority,
    ownerTrainerControl: input.ownerTrainerControl,
    referenceVersions: input.referenceVersions,
  }, { ...options, database })
  const consumed = consumePokemonEggHatchOfferV1({
    ...projectedInput,
    declaration: input.declaration,
  } as ConsumePokemonEggHatchOfferInputV1)
  ensureStillCurrent(projectedInput, consumed.authority, database)
  return consumed
}
