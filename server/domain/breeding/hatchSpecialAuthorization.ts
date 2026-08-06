import { createHash } from 'node:crypto'
import securityPolicyJson from '../../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import {
  createBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from './authorization'
import { parseBreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import {
  parseAuthoritativePokemonEggHatchOfferAuthorityV1,
  parseAuthoritativePokemonEggHatchOwnerTrainerFactV1,
} from './hatchOffers'
import {
  BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_PROVIDER_ID,
} from './hatchSpecial'
import {
  parseAuthoritativeBreedingGmAdjudicationRecordV1,
  parseAuthoritativeBreedingOptionOfferRecordV1,
  validateBreedingAdjudicationOfferLink,
} from './ledgers'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from './eggLifecyclePolicy'
import { createBreedingOperationCommandHash } from './operations'
import { validateBreedingOperationReadSetCompleteness } from './readSets'

export type BreedingHatchSpecialAuthorizationErrorCode =
  | 'breeding.hatch-special-authorization.invalid-request'
  | 'breeding.hatch-special-authorization.wrong-command'
export class BreedingHatchSpecialAuthorizationError extends Error {
  readonly code: BreedingHatchSpecialAuthorizationErrorCode
  constructor(code: BreedingHatchSpecialAuthorizationErrorCode, message: string) {
    super(message)
    this.name = 'BreedingHatchSpecialAuthorizationError'
    this.code = code
  }
}
const fail = (code: BreedingHatchSpecialAuthorizationErrorCode, message: string): never => {
  throw new BreedingHatchSpecialAuthorizationError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const strictInput = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-special-authorization.invalid-request', `${label} must be a plain exact object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-special-authorization.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-special-authorization.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const resource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string) => (
  readSet.resources.find(value => value.resourceKind === kind && value.resourceId === id) ?? null
)
const resourceMatches = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly kind: BreedingReadResourceV1['resourceKind']
  readonly id: string
  readonly revision: number
  readonly definitionSha256: string
  readonly purposes: readonly BreedingReadResourceV1['purposes'][number][]
  readonly observedCampaignMinute?: number
}): boolean => {
  const found = resource(input.readSet, input.kind, input.id)
  return found?.existence === 'present' && found.revision === input.revision
    && found.definitionSha256 === input.definitionSha256
    && input.purposes.every(purpose => found.purposes.includes(purpose))
    && (input.observedCampaignMinute === undefined || found.observedCampaignMinute === input.observedCampaignMinute)
}
const dependenciesMatch = (readSet: BreedingOperationReadSetV1, input: {
  readonly eggId: string
  readonly eggRevision: number
  readonly checkpoint: 'begin-hatch' | 'hatch-transaction'
}): boolean => {
  const effective = readSet.dependencyEvidence.filter(value => value.providerId !== 'breeding-effective-dependency-set-v1')
  return effective.length === 1
    && effective[0]?.providerKind === 'system'
    && effective[0].providerId === BREEDING_HATCH_SPECIAL_PROVIDER_ID
    && effective[0].subjectKind === 'pokemon-egg'
    && effective[0].subjectId === input.eggId
    && effective[0].subjectRevision === input.eggRevision
    && effective[0].checkpoint === input.checkpoint
    && effective[0].providerDefinitionSha256 === BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256
    && effective[0].effectiveEvidenceSha256 === BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256
}
const makeReceipt = (input: {
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly actorDefinitionSha256: string
  readonly evidenceDefinitionHashes: readonly string[]
  readonly authorized: boolean
  readonly reasonId: 'breeding.authorization.authorized' | 'breeding.authorization.owner-control-required' | 'breeding.authorization.gm-override-invalid'
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => createBreedingAuthorizationReceiptV1({
  operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command),
  commandKind: input.command.commandKind,
  actorAuthorityDefinitionSha256: input.actorDefinitionSha256,
  readSetDefinitionSha256: input.readSet.definitionSha256,
  evidenceDefinitionHashes: input.evidenceDefinitionHashes,
  gmOverrideIds: [],
  authorized: input.authorized,
  reasonId: input.reasonId,
  evaluatedAtCampaignMinute: input.readSet.capturedAtCampaignMinute,
  securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
})

export const authorizeBreedingBeginHatchV1 = (inputValue: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown | null
  readonly egg: unknown
  readonly ownerTrainerFact: unknown
  readonly hatchOfferAuthority: unknown
  readonly campaignOptionSnapshot: unknown
  readonly currentClock: unknown
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  strictInput(inputValue, [
    'command', 'readSet', 'actorAuthority', 'ownerTrainerControl', 'egg', 'ownerTrainerFact',
    'hatchOfferAuthority', 'campaignOptionSnapshot', 'currentClock', 'securityPolicyDefinitionSha256',
  ], 'beginHatchAuthorizationInput')
  const command = requireCommand(inputValue.command)
  if (command.commandKind !== 'begin-hatch') {
    return fail('breeding.hatch-special-authorization.wrong-command', 'Begin-hatch authorization accepts begin-hatch only.')
  }
  const readSet = validateBreedingOperationReadSetCompleteness(command, inputValue.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(inputValue.actorAuthority)
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const fact = parseAuthoritativePokemonEggHatchOwnerTrainerFactV1(inputValue.ownerTrainerFact)
  const authority = parseAuthoritativePokemonEggHatchOfferAuthorityV1(inputValue.hatchOfferAuthority)
  const options = parseBreedingCampaignOptionSnapshotV1(inputValue.campaignOptionSnapshot)
  const clock = parseCampaignClockV1(inputValue.currentClock)
  const control = inputValue.ownerTrainerControl === null ? null
    : parseAuthoritativeBreedingTrainerControlEvidenceV1(inputValue.ownerTrainerControl)
  const evidenceHashes = [actor.definitionSha256, fact.factDefinitionSha256, authority.authorityDefinitionSha256,
    options.definitionSha256, BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
    BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256, ...(control ? [control.definitionSha256] : [])]
  const common = {
    command,
    readSet,
    actorDefinitionSha256: actor.definitionSha256,
    evidenceDefinitionHashes: evidenceHashes,
    securityPolicyDefinitionSha256: inputValue.securityPolicyDefinitionSha256,
  }
  const eggHash = pokemonEggLifecycleDocumentDefinitionSha256(egg)
  const selected = authority.destinations.find(value => value.optionId === authority.selectedDestinationOptionId)
  const actorMatches = actor.commandActorProfileId === command.actor.profileId
    && actor.selectedTrainerSlug === command.actor.selectedTrainerSlug
    && actor.evaluatedAtCampaignMinute === clock.campaignMinute
    && readSet.capturedAtCampaignMinute === clock.campaignMinute
  const baseMatches = inputValue.securityPolicyDefinitionSha256 === securityPolicyJson.definitionSha256
    && actorMatches
    && command.scopes.length === 1 && command.scopes[0]?.kind === 'pokemon-egg'
    && command.scopes[0].eggId === egg.eggId && command.scopes[0].expectedRevision === egg.revision
    && command.payload.eggId === egg.eggId && command.payload.requestSpecialRoll === true
    && command.payload.destination.trainerSheetSlug === egg.ownerTrainerSlug
    && egg.status === 'ready' && egg.special.state === 'not-rolled' && egg.hatchOperationId === null
    && authority.commandOperationId === command.operationId
    && authority.commandSha256 === createBreedingOperationCommandHash(command)
    && authority.eggId === egg.eggId && authority.eggRevision === egg.revision
    && authority.eggDefinitionSha256 === eggHash
    && authority.ownerTrainerFactDefinitionSha256 === fact.factDefinitionSha256
    && authority.actorAuthorityDefinitionSha256 === actor.definitionSha256
    && authority.referenceVersionsDefinitionSha256 === readSet.referenceVersions.definitionSha256
    && authority.securityPolicyDefinitionSha256 === inputValue.securityPolicyDefinitionSha256
    && authority.offer.availability.status === 'available'
    && authority.offer.issuedAtCampaignMinute === clock.campaignMinute
    && authority.offer.expiresAtCampaignMinute !== null
    && clock.campaignMinute < authority.offer.expiresAtCampaignMinute
    && selected?.kind === command.payload.destination.kind && selected.availability.status === 'available'
    && fact.trainerSheetSlug === egg.ownerTrainerSlug
    && selected.trainerSheetSlug === fact.trainerSheetSlug
    && selected.trainerSheetRevision === fact.trainerSheetRevision
    && options.definitionSha256 === readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256
    && options.rulesetDefinitionSha256 === egg.ruleset.definitionSha256
    && egg.definitionHashes.includes(options.definitionSha256)
    && resourceMatches({ readSet, kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision, definitionSha256: eggHash, purposes: ['mechanics', 'conflict'] })
    && resourceMatches({ readSet, kind: 'trainer-sheet', id: fact.trainerSheetSlug, revision: fact.trainerSheetRevision, definitionSha256: fact.trainerSheetDefinitionSha256, purposes: ['write-destination'] })
    && resourceMatches({ readSet, kind: 'campaign-clock', id: 'campaign-clock', revision: clock.revision, definitionSha256: sha256(clock), purposes: ['campaign-time'], observedCampaignMinute: clock.campaignMinute })
    && dependenciesMatch(readSet, { eggId: egg.eggId, eggRevision: egg.revision, checkpoint: 'begin-hatch' })
  if (!baseMatches) {
    return makeReceipt({ ...common, authorized: false, reasonId: actor.role === 'gm' ? 'breeding.authorization.gm-override-invalid' : 'breeding.authorization.owner-control-required' })
  }
  if (actor.role === 'player') {
    const ownerMatches = control !== null
      && authority.ownerTrainerControlDefinitionSha256 === control.definitionSha256
      && actor.authenticatedProfileId === control.profileId
      && actor.profileDefinitionSha256 === control.profileDefinitionSha256
      && actor.selectedTrainerSlug === fact.trainerSheetSlug
      && control.trainerSheetSlug === fact.trainerSheetSlug
      && control.trainerSheetRevision === fact.trainerSheetRevision
      && control.trainerSheetDefinitionSha256 === fact.trainerSheetDefinitionSha256
      && control.evaluatedAtCampaignMinute === clock.campaignMinute
      && resource(readSet, 'trainer-sheet', fact.trainerSheetSlug)?.purposes.includes('authorization') === true
    return makeReceipt({ ...common, authorized: ownerMatches, reasonId: ownerMatches ? 'breeding.authorization.authorized' : 'breeding.authorization.owner-control-required' })
  }
  const gmMatches = control === null && authority.ownerTrainerControlDefinitionSha256 === null
    && actor.authenticatedProfileId === null && actor.selectedTrainerSlug === null
  return makeReceipt({ ...common, authorized: gmMatches, reasonId: gmMatches ? 'breeding.authorization.authorized' : 'breeding.authorization.gm-override-invalid' })
}

export const authorizeBreedingResolveHatchSpecialV1 = (inputValue: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly egg: unknown
  readonly adjudication: unknown
  readonly offer: unknown
  readonly currentClock: unknown
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  strictInput(inputValue, ['command', 'readSet', 'actorAuthority', 'egg', 'adjudication', 'offer', 'currentClock', 'securityPolicyDefinitionSha256'], 'resolveHatchSpecialAuthorizationInput')
  const command = requireCommand(inputValue.command)
  if (command.commandKind !== 'resolve-hatch-special') {
    return fail('breeding.hatch-special-authorization.wrong-command', 'Hatch-special authorization accepts resolve-hatch-special only.')
  }
  const readSet = validateBreedingOperationReadSetCompleteness(command, inputValue.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(inputValue.actorAuthority)
  const egg = parseAuthoritativePokemonEggDocumentV1(inputValue.egg)
  const adjudication = parseAuthoritativeBreedingGmAdjudicationRecordV1(inputValue.adjudication)
  const offer = parseAuthoritativeBreedingOptionOfferRecordV1(inputValue.offer)
  const clock = parseCampaignClockV1(inputValue.currentClock)
  const evidenceHashes = [actor.definitionSha256, adjudication.definitionSha256, offer.definitionSha256,
    BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256, BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256]
  const common = {
    command,
    readSet,
    actorDefinitionSha256: actor.definitionSha256,
    evidenceDefinitionHashes: evidenceHashes,
    securityPolicyDefinitionSha256: inputValue.securityPolicyDefinitionSha256,
  }
  let linked = true
  try { validateBreedingAdjudicationOfferLink(adjudication, offer) }
  catch { linked = false }
  const eggHash = pokemonEggLifecycleDocumentDefinitionSha256(egg)
  const authorized = inputValue.securityPolicyDefinitionSha256 === securityPolicyJson.definitionSha256
    && actor.role === 'gm' && actor.authenticatedProfileId === null && actor.selectedTrainerSlug === null
    && actor.commandActorProfileId === command.actor.profileId
    && actor.evaluatedAtCampaignMinute === clock.campaignMinute
    && command.actor.selectedTrainerSlug === null
    && readSet.capturedAtCampaignMinute === clock.campaignMinute
    && command.scopes.length === 1 && command.scopes[0]?.kind === 'pokemon-egg'
    && command.scopes[0].eggId === egg.eggId && command.scopes[0].expectedRevision === egg.revision
    && command.payload.eggId === egg.eggId
    && egg.status === 'awaiting-special-adjudication' && egg.special.state === 'pending-adjudication'
    && adjudication.status === 'pending' && offer.status === 'active' && linked
    && adjudication.target.kind === 'pokemon-egg' && adjudication.target.eggId === egg.eggId && adjudication.target.revision === egg.revision
    && offer.options.some(value => value.optionId === command.payload.adjudicationOptionId)
    && resourceMatches({ readSet, kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision, definitionSha256: eggHash, purposes: ['mechanics', 'conflict'] })
    && resourceMatches({ readSet, kind: 'breeding-adjudication', id: adjudication.adjudicationId, revision: adjudication.revision, definitionSha256: adjudication.definitionSha256, purposes: ['authorization', 'mechanics'] })
    && resourceMatches({ readSet, kind: 'breeding-offer', id: offer.offerId, revision: offer.revision, definitionSha256: offer.definitionSha256, purposes: ['authorization', 'mechanics'] })
    && resourceMatches({ readSet, kind: 'campaign-clock', id: 'campaign-clock', revision: clock.revision, definitionSha256: sha256(clock), purposes: ['campaign-time'], observedCampaignMinute: clock.campaignMinute })
    && dependenciesMatch(readSet, { eggId: egg.eggId, eggRevision: egg.revision, checkpoint: 'hatch-transaction' })
  return makeReceipt({ ...common, authorized, reasonId: authorized ? 'breeding.authorization.authorized' : 'breeding.authorization.gm-override-invalid' })
}

const requireCommand = (value: unknown): BreedingOperationCommandV1 => {
  try { return parseBreedingOperationCommandV1(value) }
  catch { return fail('breeding.hatch-special-authorization.invalid-request', 'Command must be one strict breeding operation command.') }
}
