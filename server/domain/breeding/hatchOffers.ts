import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { CampaignOperationOfferDeclarationV1 } from '#shared/campaignOperationOffers'
import { parseCampaignOperationOfferDeclarationV1 } from '#shared/campaignOperationOffers'
import type { BreedingActorAuthorityV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  POKEMON_EGG_HATCH_TEAM_CAPACITY,
  parsePokemonEggHatchOfferAuthorityV1,
  parsePokemonEggHatchOfferProjectionV1,
  parsePokemonEggHatchOwnerTrainerFactV1,
  type PokemonEggHatchBlockerReasonIdV1,
  type PokemonEggHatchDestinationOptionV1,
  type PokemonEggHatchOfferAuthorityV1,
  type PokemonEggHatchOfferProjectionV1,
  type PokemonEggHatchOwnerTrainerFactV1,
} from '#shared/breeding/hatchOffers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  createCampaignOperationOfferV1,
  parseAuthoritativeCampaignOperationOfferV1,
} from '../campaignOperationOffers'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from './authorization'
import {
  POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION_SHA256,
  pokemonEggLifecycleDocumentDefinitionSha256,
  projectPokemonEggLifecycleV1,
} from './eggLifecyclePolicy'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { createBreedingOperationCommandHash } from './operations'
import { parseAuthoritativeBreedingReferenceVersionSnapshotV1 } from './readSets'

export type BeginPokemonEggHatchCommandV1 = Extract<BreedingOperationCommandV1, { readonly commandKind: 'begin-hatch' }>
export interface ProjectPokemonEggHatchOfferInputV1 {
  readonly command: unknown
  readonly egg: unknown
  readonly ownerTrainerFact: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown | null
  readonly referenceVersions: unknown
  readonly atCampaignMinute: unknown
  readonly securityPolicyDefinitionSha256: unknown
}
export interface ConsumePokemonEggHatchOfferInputV1 extends ProjectPokemonEggHatchOfferInputV1 {
  readonly declaration: unknown
}
export interface ConsumedPokemonEggHatchOfferV1 {
  readonly command: BeginPokemonEggHatchCommandV1
  readonly declaration: CampaignOperationOfferDeclarationV1
  readonly authority: PokemonEggHatchOfferAuthorityV1
  readonly selectedDestination: PokemonEggHatchDestinationOptionV1
}

export type PokemonEggHatchOfferAuthorityErrorCode =
  | 'breeding.hatch-offer.command-unavailable'
  | 'breeding.hatch-offer.stale-authority'
  | 'breeding.hatch-offer.unauthorized'
  | 'breeding.hatch-offer.invalid-trainer'
  | 'breeding.hatch-offer.unavailable'
  | 'breeding.hatch-offer.declaration-mismatch'
  | 'breeding.hatch-offer.hash-mismatch'
export class PokemonEggHatchOfferAuthorityError extends Error {
  readonly code: PokemonEggHatchOfferAuthorityErrorCode
  constructor(code: PokemonEggHatchOfferAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'PokemonEggHatchOfferAuthorityError'
    this.code = code
  }
}

const SHA256 = /^[0-9a-f]{64}$/u
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const fail = (code: PokemonEggHatchOfferAuthorityErrorCode, message: string): never => {
  throw new PokemonEggHatchOfferAuthorityError(code, message)
}
const minute = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER) {
    return fail('breeding.hatch-offer.stale-authority', 'Hatch offer authority requires a current nonnegative campaign minute.')
  }
  return value as number
}
const hash = (value: unknown, label: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.hatch-offer.hash-mismatch', `${label} must be a lowercase SHA-256 value.`)
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const strictInput = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-offer.command-unavailable', `${label} must be a plain data object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-offer.command-unavailable', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-offer.command-unavailable', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const strictRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-offer.invalid-trainer', `${label} must be a plain data object.`)
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-offer.invalid-trainer', `${label}.${key} must be an enumerable data field.`)
    }
  }
  return value as Record<string, unknown>
}
const roster = (value: unknown, label: string): readonly string[] => {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 10_000 || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.hatch-offer.invalid-trainer', `${label} must be a strict bounded Trainer roster.`)
  }
  const values: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    const entry = descriptor && 'value' in descriptor ? descriptor.value : null
    if (!descriptor?.enumerable || typeof entry !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/u.test(entry)) {
      return fail('breeding.hatch-offer.invalid-trainer', `${label}[${index}] must be a canonical Pokémon sheet slug.`)
    }
    values.push(entry)
  }
  if (new Set(values).size !== values.length) {
    return fail('breeding.hatch-offer.invalid-trainer', `${label} cannot contain duplicate Pokémon identities.`)
  }
  return Object.freeze(values)
}

export const createPokemonEggHatchOwnerTrainerFactV1 = (input: {
  readonly trainerSheetSlug: unknown
  readonly trainerSheetRevision: unknown
  readonly trainerSheetDocument: unknown
}): PokemonEggHatchOwnerTrainerFactV1 => {
  const inputRow = strictRecord(input, 'ownerTrainerFactInput')
  if (Object.getOwnPropertyNames(inputRow).length !== 3
    || !Object.hasOwn(inputRow, 'trainerSheetSlug')
    || !Object.hasOwn(inputRow, 'trainerSheetRevision')
    || !Object.hasOwn(inputRow, 'trainerSheetDocument')) {
    return fail('breeding.hatch-offer.invalid-trainer', 'Owner Trainer fact input must contain exactly the declared fields.')
  }
  const trainerSheetSlug = inputRow.trainerSheetSlug
  const trainerSheetRevision = inputRow.trainerSheetRevision
  if (typeof trainerSheetSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/u.test(trainerSheetSlug)
    || !Number.isSafeInteger(trainerSheetRevision) || (trainerSheetRevision as number) < 0
    || (trainerSheetRevision as number) > 2_147_483_647) {
    return fail('breeding.hatch-offer.invalid-trainer', 'Trainer identity and revision must be canonical bounded values.')
  }
  const document = strictRecord(inputRow.trainerSheetDocument, 'trainerSheetDocument')
  if (document.slug !== trainerSheetSlug) {
    return fail('breeding.hatch-offer.invalid-trainer', 'Trainer document slug must match its storage identity exactly.')
  }
  const currentTeam = roster(document.currentTeam, 'trainerSheetDocument.currentTeam')
  const boxedPokemon = roster(document.boxedPokemon, 'trainerSheetDocument.boxedPokemon')
  if (currentTeam.length > POKEMON_EGG_HATCH_TEAM_CAPACITY
    || currentTeam.some(sheetSlug => boxedPokemon.includes(sheetSlug))) {
    return fail('breeding.hatch-offer.invalid-trainer', 'Trainer rosters must respect team capacity and contain no cross-roster duplicates.')
  }
  const definition = {
    schemaVersion: 1 as const,
    trainerSheetSlug,
    trainerSheetRevision: trainerSheetRevision as number,
    trainerSheetDefinitionSha256: sha256(document),
    currentTeamCount: currentTeam.length,
    boxedPokemonCount: boxedPokemon.length,
    teamCapacity: POKEMON_EGG_HATCH_TEAM_CAPACITY,
    remainingTeamSlots: POKEMON_EGG_HATCH_TEAM_CAPACITY - currentTeam.length,
  }
  return parseAuthoritativePokemonEggHatchOwnerTrainerFactV1({
    ...definition,
    factDefinitionSha256: sha256(definition),
  })
}

export const parseAuthoritativePokemonEggHatchOwnerTrainerFactV1 = (
  value: unknown,
  path = 'pokemonEggHatchOwnerTrainerFact',
): PokemonEggHatchOwnerTrainerFactV1 => {
  const fact = parsePokemonEggHatchOwnerTrainerFactV1(value, path)
  const { factDefinitionSha256: _definitionSha256, ...definition } = fact
  if (sha256(definition) !== fact.factDefinitionSha256) {
    return fail('breeding.hatch-offer.hash-mismatch', `${path}.factDefinitionSha256 does not match the exact Trainer destination fact.`)
  }
  return fact
}

const destinationDefinition = (
  value: PokemonEggHatchDestinationOptionV1,
): Omit<PokemonEggHatchDestinationOptionV1, 'optionDefinitionSha256'> => {
  const { optionDefinitionSha256: _definitionSha256, ...definition } = value
  return definition
}
const authorityDefinition = (
  value: PokemonEggHatchOfferAuthorityV1,
): Omit<PokemonEggHatchOfferAuthorityV1, 'authorityDefinitionSha256'> => {
  const { authorityDefinitionSha256: _definitionSha256, ...definition } = value
  return definition
}
export const parseAuthoritativePokemonEggHatchOfferAuthorityV1 = (
  value: unknown,
  path = 'pokemonEggHatchOfferAuthority',
): PokemonEggHatchOfferAuthorityV1 => {
  const authority = parsePokemonEggHatchOfferAuthorityV1(value, path)
  parseAuthoritativeCampaignOperationOfferV1(authority.offer, `${path}.offer`)
  for (const [index, destination] of authority.destinations.entries()) {
    if (sha256(destinationDefinition(destination)) !== destination.optionDefinitionSha256) {
      return fail('breeding.hatch-offer.hash-mismatch', `${path}.destinations[${index}].optionDefinitionSha256 does not match its destination option.`)
    }
  }
  if (sha256(authorityDefinition(authority)) !== authority.authorityDefinitionSha256) {
    return fail('breeding.hatch-offer.hash-mismatch', `${path}.authorityDefinitionSha256 does not match the exact hatch offer authority.`)
  }
  return authority
}

const beginCommand = (input: unknown): BeginPokemonEggHatchCommandV1 => {
  const command = (() => {
    try { return parseBreedingOperationCommandV1(input) }
    catch { return fail('breeding.hatch-offer.command-unavailable', 'Hatch offers require one strict begin-hatch command.') }
  })()
  if (command.commandKind !== 'begin-hatch') {
    return fail('breeding.hatch-offer.command-unavailable', 'Hatch offers require begin-hatch only.')
  }
  return command
}
const currentPlayerControl = (input: {
  readonly actor: BreedingActorAuthorityV1
  readonly command: BeginPokemonEggHatchCommandV1
  readonly ownerTrainerFact: PokemonEggHatchOwnerTrainerFactV1
  readonly ownerTrainerControl: unknown | null
  readonly atCampaignMinute: number
}): BreedingTrainerControlEvidenceV1 => {
  if (input.ownerTrainerControl === null) {
    return fail('breeding.hatch-offer.unauthorized', 'Owner hatch offers require current owner Trainer control.')
  }
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.ownerTrainerControl)
  if (!input.actor.authenticatedProfileId
    || input.actor.authenticatedProfileId !== control.profileId
    || input.actor.profileDefinitionSha256 !== control.profileDefinitionSha256
    || input.actor.selectedTrainerSlug !== input.ownerTrainerFact.trainerSheetSlug
    || input.command.actor.selectedTrainerSlug !== input.ownerTrainerFact.trainerSheetSlug
    || control.trainerSheetSlug !== input.ownerTrainerFact.trainerSheetSlug
    || control.trainerSheetRevision !== input.ownerTrainerFact.trainerSheetRevision
    || control.trainerSheetDefinitionSha256 !== input.ownerTrainerFact.trainerSheetDefinitionSha256
    || control.evaluatedAtCampaignMinute !== input.atCampaignMinute) {
    return fail('breeding.hatch-offer.unauthorized', 'Owner hatch authority must bind the exact current Profile and owner Trainer revision.')
  }
  return control
}
const createDestination = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly fact: PokemonEggHatchOwnerTrainerFactV1
  readonly kind: 'box' | 'team'
  readonly lifecycleBlocker: PokemonEggHatchBlockerReasonIdV1 | null
  readonly commandSha256: string
  readonly atCampaignMinute: number
}): PokemonEggHatchDestinationOptionV1 => {
  const capacityBlocker = input.kind === 'team' && input.fact.remainingTeamSlots === 0
    ? 'breeding.hatch-offer.team-full' as const
    : null
  const reasonId = input.lifecycleBlocker ?? capacityBlocker
  const optionId = `option:v1:${sha256({
    policyId: 'pokemon-egg-hatch-destination-v1',
    eggId: input.egg.eggId,
    eggRevision: input.egg.revision,
    trainerSheetSlug: input.fact.trainerSheetSlug,
    trainerSheetRevision: input.fact.trainerSheetRevision,
    kind: input.kind,
    commandSha256: input.commandSha256,
    atCampaignMinute: input.atCampaignMinute,
  }).slice(0, 32)}` as const
  const definition = {
    schemaVersion: 1 as const,
    optionId,
    kind: input.kind,
    trainerSheetSlug: input.fact.trainerSheetSlug,
    trainerSheetRevision: input.fact.trainerSheetRevision,
    availability: reasonId === null
      ? { status: 'available' as const, reasonId: null }
      : { status: 'unavailable' as const, reasonId },
    remainingTeamSlots: input.kind === 'team' ? input.fact.remainingTeamSlots : null,
  }
  return Object.freeze({ ...definition, optionDefinitionSha256: sha256(definition) })
}

export const projectPokemonEggHatchOfferV1 = (
  input: ProjectPokemonEggHatchOfferInputV1,
): PokemonEggHatchOfferAuthorityV1 => {
  strictInput(input, [
    'command', 'egg', 'ownerTrainerFact', 'actorAuthority', 'ownerTrainerControl',
    'referenceVersions', 'atCampaignMinute', 'securityPolicyDefinitionSha256',
  ], 'hatchOfferInput')
  const atCampaignMinute = minute(input.atCampaignMinute)
  const command = beginCommand(input.command)
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  const ownerTrainerFact = parseAuthoritativePokemonEggHatchOwnerTrainerFactV1(input.ownerTrainerFact)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const references = parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions)
  const securityPolicyDefinitionSha256 = hash(input.securityPolicyDefinitionSha256, 'securityPolicyDefinitionSha256')
  const eggScope = command.scopes[0]
  if (command.actor.profileId !== actor.commandActorProfileId
    || command.actor.selectedTrainerSlug !== actor.selectedTrainerSlug) {
    return fail('breeding.hatch-offer.unauthorized', 'Command actor and current authenticated authority must match exactly.')
  }
  if (actor.evaluatedAtCampaignMinute !== atCampaignMinute
    || command.scopes.length !== 1
    || command.payload.eggId !== egg.eggId
    || eggScope?.kind !== 'pokemon-egg'
    || eggScope.eggId !== egg.eggId
    || eggScope.expectedRevision !== egg.revision
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256
    || command.ruleset.rulesetId !== references.rulesetId
    || command.ruleset.definitionSha256 !== references.rulesetDefinitionSha256
    || command.payload.destination.trainerSheetSlug !== egg.ownerTrainerSlug
    || ownerTrainerFact.trainerSheetSlug !== egg.ownerTrainerSlug) {
    return fail('breeding.hatch-offer.stale-authority', 'Hatch offer must bind the exact current Egg, ruleset, owner Trainer, references, and campaign minute.')
  }
  let ownerControl: BreedingTrainerControlEvidenceV1 | null = null
  if (actor.role === 'gm') {
    if (actor.authenticatedProfileId !== null || actor.selectedTrainerSlug !== null
      || input.ownerTrainerControl !== null) {
      return fail('breeding.hatch-offer.unauthorized', 'GM hatch offers use only current campaign-principal authority.')
    }
  }
  else {
    ownerControl = currentPlayerControl({
      actor,
      command,
      ownerTrainerFact,
      ownerTrainerControl: input.ownerTrainerControl,
      atCampaignMinute,
    })
  }
  const commandSha256 = createBreedingOperationCommandHash(command)
  const lifecycle = projectPokemonEggLifecycleV1({
    egg,
    audience: actor.role === 'gm' ? 'gm' : 'owner',
    generatedAtCampaignMinute: atCampaignMinute,
  })
  const lifecycleBlocker = lifecycle.canBeginHatch
    ? null
    : lifecycle.blockerReasonIds[0] ?? fail('breeding.hatch-offer.unavailable', 'Unavailable lifecycle state is missing its closed hatch blocker.')
  const destinations = Object.freeze([
    createDestination({ egg, fact: ownerTrainerFact, kind: 'box', lifecycleBlocker, commandSha256, atCampaignMinute }),
    createDestination({ egg, fact: ownerTrainerFact, kind: 'team', lifecycleBlocker, commandSha256, atCampaignMinute }),
  ]) as readonly [PokemonEggHatchDestinationOptionV1, PokemonEggHatchDestinationOptionV1]
  const selected = destinations.find(option => option.kind === command.payload.destination.kind)!
  const selectedReason = selected.availability.reasonId
  const offer = createCampaignOperationOfferV1({
    identityMaterial: {
      policyId: 'pokemon-egg-hatch-offer-v1',
      commandOperationId: command.operationId,
      commandSha256,
      eggDefinitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg),
      ownerTrainerFactDefinitionSha256: ownerTrainerFact.factDefinitionSha256,
      actorAuthorityDefinitionSha256: actor.definitionSha256,
      ownerTrainerControlDefinitionSha256: ownerControl?.definitionSha256 ?? null,
      referenceVersionsDefinitionSha256: references.definitionSha256,
      lifecyclePolicyDefinitionSha256: POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION_SHA256,
      securityPolicyDefinitionSha256,
      selectedDestinationOptionId: selected.optionId,
      atCampaignMinute,
    },
    definition: {
      audience: actor.role === 'gm' ? 'gm' : 'owner',
      role: 'campaign-operation',
      workspaceId: 'breeding',
      operationFamilyId: 'pokemon-egg-hatch',
      actionId: 'breeding.egg.begin-hatch',
      actor: actor.role === 'gm'
        ? { kind: 'campaign', resourceId: 'campaign', revision: null }
        : {
            kind: 'trainer-sheet',
            resourceId: ownerTrainerFact.trainerSheetSlug,
            revision: ownerTrainerFact.trainerSheetRevision,
          },
      source: { kind: 'system', canonicalId: 'breeding.v1' },
      availability: selectedReason === null
        ? { status: 'available', reasonId: null }
        : { status: 'unavailable', reasonId: selectedReason },
      requiredInputKinds: ['confirmation'],
      presentation: {
        labelId: 'breeding.egg.begin-hatch.label',
        descriptionId: 'breeding.egg.begin-hatch.description',
        tone: selectedReason === null ? 'primary' : 'warning',
      },
      issuedAtCampaignMinute: atCampaignMinute,
      expiresAtCampaignMinute: atCampaignMinute + 1,
    },
  })
  const definition = {
    schemaVersion: 1 as const,
    offer,
    commandOperationId: command.operationId,
    commandSha256,
    eggId: egg.eggId,
    eggRevision: egg.revision,
    eggDefinitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg),
    ownerTrainerFactDefinitionSha256: ownerTrainerFact.factDefinitionSha256,
    actorAuthorityDefinitionSha256: actor.definitionSha256,
    ownerTrainerControlDefinitionSha256: ownerControl?.definitionSha256 ?? null,
    referenceVersionsDefinitionSha256: references.definitionSha256,
    lifecyclePolicyDefinitionSha256: POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION_SHA256,
    securityPolicyDefinitionSha256,
    destinations,
    selectedDestinationOptionId: selected.optionId,
    blockerReasonIds: selectedReason === null ? Object.freeze([]) : Object.freeze([selectedReason]),
  }
  return parseAuthoritativePokemonEggHatchOfferAuthorityV1({
    ...definition,
    authorityDefinitionSha256: sha256(definition),
  })
}

export const projectPokemonEggHatchOfferProjectionV1 = (input: {
  readonly authority: unknown
  readonly egg: unknown
}): PokemonEggHatchOfferProjectionV1 => {
  strictInput(input, ['authority', 'egg'], 'hatchOfferProjectionInput')
  const authority = parseAuthoritativePokemonEggHatchOfferAuthorityV1(input.authority)
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  if (egg.eggId !== authority.eggId || egg.revision !== authority.eggRevision
    || pokemonEggLifecycleDocumentDefinitionSha256(egg) !== authority.eggDefinitionSha256) {
    return fail('breeding.hatch-offer.stale-authority', 'Hatch projection requires the exact authority-bound current Egg.')
  }
  return parsePokemonEggHatchOfferProjectionV1({
    schemaVersion: 1,
    audience: authority.offer.audience,
    eggId: authority.eggId,
    eggRevision: authority.eggRevision,
    eggStatus: egg.status,
    offer: authority.offer,
    destinations: authority.destinations.map(destination => ({
      optionId: destination.optionId,
      kind: destination.kind,
      trainerSheetSlug: destination.trainerSheetSlug,
      availability: destination.availability,
      remainingTeamSlots: destination.remainingTeamSlots,
    })),
    selectedDestinationOptionId: authority.selectedDestinationOptionId,
    blockerReasonIds: authority.blockerReasonIds,
    canSubmit: authority.offer.availability.status === 'available',
    generatedAtCampaignMinute: authority.offer.issuedAtCampaignMinute,
  })
}

export const consumePokemonEggHatchOfferV1 = (
  input: ConsumePokemonEggHatchOfferInputV1,
): ConsumedPokemonEggHatchOfferV1 => {
  strictInput(input, [
    'command', 'egg', 'ownerTrainerFact', 'actorAuthority', 'ownerTrainerControl',
    'referenceVersions', 'atCampaignMinute', 'securityPolicyDefinitionSha256', 'declaration',
  ], 'hatchOfferConsumeInput')
  const declaration = parseCampaignOperationOfferDeclarationV1(input.declaration)
  const authority = projectPokemonEggHatchOfferV1({
    command: input.command,
    egg: input.egg,
    ownerTrainerFact: input.ownerTrainerFact,
    actorAuthority: input.actorAuthority,
    ownerTrainerControl: input.ownerTrainerControl,
    referenceVersions: input.referenceVersions,
    atCampaignMinute: input.atCampaignMinute,
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  })
  if (authority.offer.availability.status !== 'available') {
    return fail('breeding.hatch-offer.unavailable', 'Unavailable hatch offers cannot be consumed.')
  }
  if (declaration.offerId !== authority.offer.offerId
    || declaration.offerDefinitionSha256 !== authority.offer.offerDefinitionSha256
    || declaration.operationId !== authority.commandOperationId) {
    return fail('breeding.hatch-offer.declaration-mismatch', 'Hatch declaration must reuse the exact current command-bound offer identity.')
  }
  const selectedDestination = authority.destinations.find(option => option.optionId === authority.selectedDestinationOptionId)!
  return Object.freeze({ command: beginCommand(input.command), declaration, authority, selectedDestination })
}

export const assertPokemonEggHatchOfferAuthorityExactReplayV1 = (
  existingValue: unknown,
  replayedValue: unknown,
): PokemonEggHatchOfferAuthorityV1 => {
  const existing = parseAuthoritativePokemonEggHatchOfferAuthorityV1(existingValue, 'existingHatchOfferAuthority')
  const replayed = parseAuthoritativePokemonEggHatchOfferAuthorityV1(replayedValue, 'replayedHatchOfferAuthority')
  if (!same(existing, replayed)) {
    return fail('breeding.hatch-offer.declaration-mismatch', 'Hatch offer authority permits exact stable-JSON replay only.')
  }
  return existing
}
