import { createHash } from 'node:crypto'
import securityPolicyJson from '../../../data/breeding-automation/security-policy.json'
import lineageContractJson from '../../../data/breeding-automation/lineage-contract.json'
import initializedSheetContractJson from '../../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import speciesAcquisitionContractJson from '../../../data/breeding-automation/species-acquisition-reward-contract.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  parsePokemonEggHatchCompletionProjectionV1,
  type PokemonEggHatchCompletionAudienceV1,
  type PokemonEggHatchCompletionProjectionV1,
} from '#shared/breeding/hatchCompletion'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import {
  createBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from './authorization'
import { BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256 } from './childSheetConstruction'
import { validatePokemonEggRevisionSuccessor } from './eggLifecycle'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from './eggLifecyclePolicy'
import { parseAuthoritativePokemonEggHatchOwnerTrainerFactV1 } from './hatchOffers'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { createBreedingOperationCommandHash } from './operations'
import { validateBreedingOperationReadSetCompleteness } from './readSets'

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const field of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[field])
  return Object.freeze(value)
}
export const BREEDING_HATCH_COMPLETION_PROVIDER_ID = 'breeding-hatch-completion-v1' as const
export const BREEDING_HATCH_COMPLETION_POLICY_DEFINITION = deepFreeze({
  schemaVersion: 1 as const,
  policyId: BREEDING_HATCH_COMPLETION_PROVIDER_ID,
  transaction: 'one-top-level-synchronous-SQLite-transaction' as const,
  writes: Object.freeze([
    'initialized-child-sheet', 'optional-atomic-mirrored-Marsupial-pouch-link', 'destination-Trainer-link', 'settled-Egg', 'immutable-lineage-origin',
    'species-acquisition-history-and-first-reward', 'terminal-operation-result', 'restricted-realtime-refreshes',
  ] as const),
  destinationKinds: Object.freeze(['box', 'team'] as const),
  teamCapacity: 6 as const,
  exactRetry: 'authority-revalidated-publication-silent' as const,
  rollback: 'no-partial-hatch-writes' as const,
  childConstructionPolicyDefinitionSha256: BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256,
  initializedSheetContractDefinitionSha256: initializedSheetContractJson.definitionSha256,
  lineageContractDefinitionSha256: lineageContractJson.definitionSha256,
  speciesAcquisitionContractDefinitionSha256: speciesAcquisitionContractJson.definitionSha256,
})
export const BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256 = sha256(BREEDING_HATCH_COMPLETION_POLICY_DEFINITION)
export const BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256 = sha256({
  providerId: BREEDING_HATCH_COMPLETION_PROVIDER_ID,
  policyDefinitionSha256: BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
  sourceDefinitionHashes: [
    BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256,
    initializedSheetContractJson.definitionSha256,
    lineageContractJson.definitionSha256,
    speciesAcquisitionContractJson.definitionSha256,
  ].sort(),
})

export type PokemonEggHatchCompletionAuthorityErrorCode =
  | 'breeding.hatch-completion.invalid-request'
  | 'breeding.hatch-completion.wrong-command'
  | 'breeding.hatch-completion.stale-authority'
  | 'breeding.hatch-completion.unavailable'
export class PokemonEggHatchCompletionAuthorityError extends Error {
  readonly code: PokemonEggHatchCompletionAuthorityErrorCode
  constructor(code: PokemonEggHatchCompletionAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'PokemonEggHatchCompletionAuthorityError'
    this.code = code
  }
}
const fail = (code: PokemonEggHatchCompletionAuthorityErrorCode, message: string): never => {
  throw new PokemonEggHatchCompletionAuthorityError(code, message)
}
const strict = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.hatch-completion.invalid-request', `${label} must be one plain exact object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-completion.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.hatch-completion.invalid-request', `${label}.${field} must be an enumerable data field.`)
  }
  return row
}
const resource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string) => readSet.resources.find(entry => entry.resourceKind === kind && entry.resourceId === id) ?? null
const present = (readSet: BreedingOperationReadSetV1, input: {
  readonly kind: BreedingReadResourceV1['resourceKind'], readonly id: string, readonly revision: number | null,
  readonly hash: string, readonly purposes: readonly BreedingReadResourceV1['purposes'][number][], readonly minute?: number,
}): boolean => {
  const found = resource(readSet, input.kind, input.id)
  return found?.existence === 'present' && found.revision === input.revision && found.definitionSha256 === input.hash
    && input.purposes.every(purpose => found.purposes.includes(purpose))
    && (input.minute === undefined || found.observedCampaignMinute === input.minute)
}
const dependenciesMatch = (
  readSet: BreedingOperationReadSetV1,
  egg: PokemonEggDocumentV1,
  command: BreedingOperationCommandV1,
): boolean => {
  const dependencies = readSet.dependencyEvidence.filter(entry => entry.providerId !== 'breeding-effective-dependency-set-v1')
  const lifecycle = dependencies.find(entry => entry.providerId === BREEDING_HATCH_COMPLETION_PROVIDER_ID)
  if (lifecycle?.providerKind !== 'system'
    || lifecycle.providerDefinitionSha256 !== BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256
    || lifecycle.subjectKind !== 'pokemon-egg' || lifecycle.subjectId !== egg.eggId
    || lifecycle.subjectRevision !== egg.revision || lifecycle.checkpoint !== 'hatch-transaction'
    || lifecycle.effectiveEvidenceSha256 !== BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256) return false
  const providerDependencies = dependencies.filter(entry => entry !== lifecycle)
  const marsupial = egg.offspring.providerTraits.marsupial ?? null
  const pouchScopes = command.scopes.filter(scope => scope.kind === 'pokemon-sheet' && scope.fields.length === 1 && scope.fields[0] === 'marsupial-pouch')
  if (!marsupial) return pouchScopes.length === 0 && providerDependencies.length === 0
  const pouchScope = pouchScopes.length === 1 ? pouchScopes[0]! : null
  if (!pouchScope || pouchScope.kind !== 'pokemon-sheet' || providerDependencies.length < 1 || providerDependencies.length > 2) return false
  const capability = providerDependencies.find(entry => entry.providerKind === 'capability' && entry.providerId === 'capability.marsupial')
  if (!capability || capability.subjectKind !== 'pokemon-sheet' || capability.subjectId !== pouchScope.sheetSlug
    || capability.subjectRevision !== pouchScope.expectedRevision || capability.checkpoint !== 'hatch-transaction'
    || capability.providerDefinitionSha256 !== marsupial.providerRecordSha256) return false
  const remaining = providerDependencies.filter(entry => entry !== capability)
  return remaining.length === 0 || (remaining.length === 1
    && remaining[0]!.providerKind === 'ability' && remaining[0]!.providerId === 'ability.parental-bond'
    && remaining[0]!.subjectKind === 'pokemon-sheet' && remaining[0]!.subjectId === pouchScope.sheetSlug
    && remaining[0]!.subjectRevision === pouchScope.expectedRevision && remaining[0]!.checkpoint === 'hatch-transaction')
}
const receipt = (input: {
  readonly command: BreedingOperationCommandV1, readonly readSet: BreedingOperationReadSetV1,
  readonly actorHash: string, readonly evidenceHashes: readonly string[], readonly authorized: boolean,
  readonly reasonId: 'breeding.authorization.authorized' | 'breeding.authorization.owner-control-required' | 'breeding.authorization.gm-override-invalid',
  readonly securityHash: string,
}): BreedingAuthorizationReceiptV1 => createBreedingAuthorizationReceiptV1({
  operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command),
  commandKind: input.command.commandKind,
  actorAuthorityDefinitionSha256: input.actorHash,
  readSetDefinitionSha256: input.readSet.definitionSha256,
  evidenceDefinitionHashes: input.evidenceHashes,
  gmOverrideIds: [],
  authorized: input.authorized,
  reasonId: input.reasonId,
  evaluatedAtCampaignMinute: input.readSet.capturedAtCampaignMinute,
  securityPolicyDefinitionSha256: input.securityHash,
})

export const authorizeBreedingCompleteHatchV1 = (inputValue: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown | null
  readonly egg: unknown
  readonly ownerTrainerFact: unknown
  readonly currentClock: unknown
  readonly beginHatchCommand: unknown
  readonly currentSpeciesAcquisitionDefinitionSha256: string | null
  readonly childPlanDefinitionSha256: string
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  strict(inputValue, ['command', 'readSet', 'actorAuthority', 'ownerTrainerControl', 'egg', 'ownerTrainerFact', 'currentClock', 'beginHatchCommand', 'currentSpeciesAcquisitionDefinitionSha256', 'childPlanDefinitionSha256', 'securityPolicyDefinitionSha256'], 'completeHatchAuthorizationInput')
  const command = parseBreedingOperationCommandV1(inputValue.command)
  if (command.commandKind !== 'complete-hatch') return fail('breeding.hatch-completion.wrong-command', 'Hatch completion accepts complete-hatch only.')
  const begin = parseBreedingOperationCommandV1(inputValue.beginHatchCommand)
  if (begin.commandKind !== 'begin-hatch') return fail('breeding.hatch-completion.stale-authority', 'The Egg hatch operation must identify one begin-hatch command.')
  const readSet = validateBreedingOperationReadSetCompleteness(command, inputValue.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(inputValue.actorAuthority)
  const control = inputValue.ownerTrainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(inputValue.ownerTrainerControl)
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const fact = parseAuthoritativePokemonEggHatchOwnerTrainerFactV1(inputValue.ownerTrainerFact)
  const clock = parseCampaignClockV1(inputValue.currentClock)
  const acquisitionHash = inputValue.currentSpeciesAcquisitionDefinitionSha256
  if (acquisitionHash !== null && (typeof acquisitionHash !== 'string' || !/^[0-9a-f]{64}$/u.test(acquisitionHash))) {
    return fail('breeding.hatch-completion.invalid-request', 'Current Species-acquisition hash must be null or lowercase SHA-256.')
  }
  if (typeof inputValue.childPlanDefinitionSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(inputValue.childPlanDefinitionSha256)) {
    return fail('breeding.hatch-completion.invalid-request', 'Child construction plan hash must be lowercase SHA-256.')
  }
  const evidenceHashes = [actor.definitionSha256, fact.factDefinitionSha256, BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
    BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256, createBreedingOperationCommandHash(begin), inputValue.childPlanDefinitionSha256,
    ...(control ? [control.definitionSha256] : []), ...(acquisitionHash ? [acquisitionHash] : [])]
  const common = { command, readSet, actorHash: actor.definitionSha256, evidenceHashes, securityHash: inputValue.securityPolicyDefinitionSha256 }
  const eggScope = command.scopes.find(scope => scope.kind === 'pokemon-egg')
  const trainerScope = command.scopes.find(scope => scope.kind === 'trainer-sheet')
  const acquisitionScope = command.scopes.find(scope => scope.kind === 'species-acquisition')
  const acquisitionRead = resource(readSet, 'species-acquisition', `${fact.trainerSheetSlug}/${egg.offspring.speciesId}`)
  const beginRead = resource(readSet, 'breeding-operation', begin.operationId)
  const acquisitionMatches = acquisitionHash === null
    ? acquisitionRead?.existence === 'absent' && acquisitionRead.revision === null && acquisitionRead.definitionSha256 === null
    : acquisitionRead?.existence === 'present' && acquisitionRead.revision === null && acquisitionRead.definitionSha256 === acquisitionHash
  const baseMatches = inputValue.securityPolicyDefinitionSha256 === securityPolicyJson.definitionSha256
    && actor.commandActorProfileId === command.actor.profileId && actor.selectedTrainerSlug === command.actor.selectedTrainerSlug
    && actor.evaluatedAtCampaignMinute === clock.campaignMinute && readSet.capturedAtCampaignMinute === clock.campaignMinute
    && egg.status === 'hatching' && egg.childSheetSlug === null && egg.terminal === null
    && (egg.special.state === 'normal' || egg.special.state === 'resolved') && egg.hatchOperationId === begin.operationId
    && begin.payload.eggId === egg.eggId && stableJsonStringify(begin.payload.destination) === stableJsonStringify(command.payload.destination)
    && command.payload.eggId === egg.eggId && command.payload.originId !== null
    && command.payload.destination.trainerSheetSlug === egg.ownerTrainerSlug
    && eggScope?.kind === 'pokemon-egg' && eggScope.expectedRevision === egg.revision
    && trainerScope?.kind === 'trainer-sheet' && trainerScope.expectedRevision === fact.trainerSheetRevision
    && acquisitionScope?.kind === 'species-acquisition' && acquisitionScope.trainerSheetSlug === fact.trainerSheetSlug
    && acquisitionScope.speciesId === egg.offspring.speciesId
    && fact.trainerSheetSlug === egg.ownerTrainerSlug
    && (command.payload.destination.kind === 'box' || fact.remainingTeamSlots > 0)
    && present(readSet, { kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision, hash: pokemonEggLifecycleDocumentDefinitionSha256(egg), purposes: ['mechanics', 'conflict'] })
    && present(readSet, { kind: 'trainer-sheet', id: fact.trainerSheetSlug, revision: fact.trainerSheetRevision, hash: fact.trainerSheetDefinitionSha256, purposes: ['write-destination', 'conflict'] })
    && present(readSet, { kind: 'campaign-clock', id: 'campaign-clock', revision: clock.revision, hash: sha256(clock), purposes: ['campaign-time'], minute: clock.campaignMinute })
    && beginRead?.existence === 'present' && beginRead.revision === null && beginRead.definitionSha256 === createBreedingOperationCommandHash(begin) && beginRead.purposes.includes('idempotency')
    && resource(readSet, 'pokemon-sheet-allocation', 'pokemon')?.existence === 'present'
    && resource(readSet, 'pokemon-sheet-allocation', 'pokemon')?.revision === 0
    && resource(readSet, 'pokemon-sheet-allocation', 'pokemon')?.definitionSha256 === initializedSheetContractJson.definitionSha256
    && resource(readSet, 'pokemon-sheet-allocation', 'pokemon')?.purposes.includes('write-destination') === true
    && resource(readSet, 'pokemon-sheet-allocation', 'pokemon')?.purposes.includes('conflict') === true
    && acquisitionMatches && acquisitionRead?.purposes.includes('conflict') === true
    && dependenciesMatch(readSet, egg, command)
  if (!baseMatches) return receipt({ ...common, authorized: false, reasonId: actor.role === 'gm' ? 'breeding.authorization.gm-override-invalid' : 'breeding.authorization.owner-control-required' })
  if (actor.role === 'player') {
    const ownerMatches = control !== null && actor.authenticatedProfileId === control.profileId
      && actor.profileDefinitionSha256 === control.profileDefinitionSha256 && actor.selectedTrainerSlug === fact.trainerSheetSlug
      && control.trainerSheetSlug === fact.trainerSheetSlug && control.trainerSheetRevision === fact.trainerSheetRevision
      && control.trainerSheetDefinitionSha256 === fact.trainerSheetDefinitionSha256 && control.evaluatedAtCampaignMinute === clock.campaignMinute
      && resource(readSet, 'trainer-sheet', fact.trainerSheetSlug)?.purposes.includes('authorization') === true
    return receipt({ ...common, authorized: ownerMatches, reasonId: ownerMatches ? 'breeding.authorization.authorized' : 'breeding.authorization.owner-control-required' })
  }
  const gmMatches = control === null && actor.authenticatedProfileId === null && actor.selectedTrainerSlug === null
  return receipt({ ...common, authorized: gmMatches, reasonId: gmMatches ? 'breeding.authorization.authorized' : 'breeding.authorization.gm-override-invalid' })
}

export const planPokemonEggHatchSettlementV1 = (inputValue: {
  readonly egg: unknown, readonly command: unknown, readonly childSheetSlug: unknown, readonly atCampaignMinute: unknown,
}): PokemonEggDocumentV1 => {
  strict(inputValue, ['egg', 'command', 'childSheetSlug', 'atCampaignMinute'], 'hatchSettlementInput')
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const command = parseBreedingOperationCommandV1(inputValue.command)
  if (command.commandKind !== 'complete-hatch') return fail('breeding.hatch-completion.wrong-command', 'Hatch settlement accepts complete-hatch only.')
  if (typeof inputValue.childSheetSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,159}$/u.test(inputValue.childSheetSlug)) return fail('breeding.hatch-completion.invalid-request', 'Allocated child slug must be canonical.')
  if (!Number.isSafeInteger(inputValue.atCampaignMinute) || Number(inputValue.atCampaignMinute) < egg.updatedAtCampaignMinute || Number(inputValue.atCampaignMinute) > 2_147_483_647) return fail('breeding.hatch-completion.stale-authority', 'Hatch settlement campaign minute must be current and monotonic.')
  return validatePokemonEggRevisionSuccessor(egg, {
    ...egg,
    revision: egg.revision + 1,
    status: 'hatched',
    childSheetSlug: inputValue.childSheetSlug,
    updatedAtCampaignMinute: inputValue.atCampaignMinute,
    statusChangedAtCampaignMinute: inputValue.atCampaignMinute,
    lastOperationId: command.operationId,
  })
}

export const projectPokemonEggHatchCompletionV1 = (inputValue: {
  readonly audience: PokemonEggHatchCompletionAudienceV1, readonly egg: unknown,
  readonly childSheetRevision: unknown, readonly ownerTrainerRevision: unknown, readonly destinationKind: unknown,
}): PokemonEggHatchCompletionProjectionV1 => {
  strict(inputValue, ['audience', 'egg', 'childSheetRevision', 'ownerTrainerRevision', 'destinationKind'], 'hatchCompletionProjectionInput')
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  if (egg.status !== 'hatched' || !egg.childSheetSlug) return fail('breeding.hatch-completion.unavailable', 'Only a settled hatched Egg can be projected.')
  return parsePokemonEggHatchCompletionProjectionV1({
    schemaVersion: 1, audience: inputValue.audience, status: 'hatched', eggId: egg.eggId, eggRevision: egg.revision,
    childSheetSlug: egg.childSheetSlug, childSheetRevision: inputValue.childSheetRevision,
    ownerTrainerSlug: egg.ownerTrainerSlug, ownerTrainerRevision: inputValue.ownerTrainerRevision,
    destinationKind: inputValue.destinationKind, hatchedAtCampaignMinute: egg.updatedAtCampaignMinute,
    settlementOperationId: egg.lastOperationId,
  })
}
