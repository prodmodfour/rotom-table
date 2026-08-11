import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import {
  parseBreedingActorAuthorityV1,
  parseBreedingAuthorizationReceiptV1,
  parseBreedingBreederAuthorityEvidenceV1,
  parseBreedingCrossOwnerConsentEvidenceV1,
  parseBreedingGmOverrideEvidenceV1,
  parseBreedingParentControlEvidenceV1,
  parseBreedingTrainerControlEvidenceV1,
  type BreedingActorAuthorityV1,
  type BreedingAuthorizationReasonId,
  type BreedingAuthorizationReceiptV1,
  type BreedingBreederAuthorityEvidenceV1,
  type BreedingCrossOwnerConsentEvidenceV1,
  type BreedingGmOverrideEvidenceV1,
  type BreedingGmOverrideKind,
  type BreedingGmOverrideTargetV1,
  type BreedingParentControlEvidenceV1,
  type BreedingTrainerControlEvidenceV1,
} from '#shared/breeding/authorization'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1, type BreedingOperationCommandV1, type GrantBreedingConsentPayloadV1, type SettleEggTransferConsentPayloadV1 } from '#shared/breeding/operations'
import type { BreedingOverrideId } from '#shared/breeding/ids'
import type { BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import type { PokemonEggTransferConsentV1 } from '#shared/breeding/eggTransfer'
import { BREEDING_INCUBATION_PAUSE_REASON_IDS } from '#shared/breeding/incubation'
import { BREEDING_EGG_READY_CORRECTION_REASON_IDS } from '#shared/breeding/readinessCorrection'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { BREEDING_PROJECT_ACTIVE_STATUSES, parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingOperationReadSetV1 } from '#shared/breeding/readSets'
import { createBreedingOperationCommandHash } from './operations'
import { isBreedingConsentCurrentlyUsable, parseAuthoritativeBreedingConsentRecordV1 } from './ledgers'
import { parseAuthoritativePokemonEggTransferConsentV1 } from './eggTransfer'
import { parseAuthoritativeBreedingOperationReadSetV1, validateBreedingOperationReadSetCompleteness } from './readSets'
import {
  BREEDING_CAMPAIGN_CLOCK_BATCH_EVIDENCE_DEFINITION_SHA256,
  BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION_SHA256,
  BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID,
} from './campaignClockBatch'
import {
  BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256,
  BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256,
  BREEDING_READINESS_CORRECTION_PROVIDER_ID,
} from './readinessCorrection'
import {
  BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
  breedingInheritanceLearningOriginStateSha256,
} from './inheritanceLearning'
import { parseAuthoritativePokemonBreedingOriginV1 } from './lineage'

export type BreedingActorAuthorityDefinitionV1 = Omit<BreedingActorAuthorityV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingTrainerControlEvidenceDefinitionV1 = Omit<BreedingTrainerControlEvidenceV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingParentControlEvidenceDefinitionV1 = Omit<BreedingParentControlEvidenceV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingBreederAuthorityEvidenceDefinitionV1 = Omit<BreedingBreederAuthorityEvidenceV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingCrossOwnerConsentEvidenceDefinitionV1 = Omit<BreedingCrossOwnerConsentEvidenceV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingGmOverrideEvidenceDefinitionV1 = Omit<BreedingGmOverrideEvidenceV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingAuthorizationReceiptDefinitionV1 = Omit<BreedingAuthorizationReceiptV1, 'schemaVersion' | 'definitionSha256'>
export type BreedingAuthorizationEvidenceV1 = BreedingActorAuthorityV1 | BreedingTrainerControlEvidenceV1 | BreedingParentControlEvidenceV1 | BreedingBreederAuthorityEvidenceV1 | BreedingCrossOwnerConsentEvidenceV1 | BreedingGmOverrideEvidenceV1 | BreedingAuthorizationReceiptV1

export type BreedingAuthorizationAuthorityErrorCode =
  | 'breeding.authorization.hash-mismatch'
  | 'breeding.authorization.actor-mismatch'
  | 'breeding.authorization.profile-stale'
  | 'breeding.authorization.parent-link-stale'
  | 'breeding.authorization.consent-stale'
  | 'breeding.authorization.invalid-override'
  | 'breeding.authorization.unsupported-command'
export class BreedingAuthorizationAuthorityError extends Error {
  readonly code: BreedingAuthorizationAuthorityErrorCode
  readonly path: string
  constructor(code: BreedingAuthorizationAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingAuthorizationAuthorityError'
    this.code = code
    this.path = path
  }
}
const fail = (code: BreedingAuthorizationAuthorityErrorCode, path: string, message: string): never => { throw new BreedingAuthorizationAuthorityError(code, path, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => { const { definitionSha256: _definitionSha256, ...definition } = value; return definition }
const stripBuilderFields = <Value extends object>(value: Value): Omit<Value, 'schemaVersion' | 'definitionSha256'> => { const { schemaVersion: _schemaVersion, definitionSha256: _definitionSha256, ...definition } = value as Value & { readonly schemaVersion?: unknown, readonly definitionSha256?: unknown }; return definition }
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const compareCodePoint = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const verify = <Value extends { readonly definitionSha256: string }>(value: Value, path: string): Value => {
  if (sha256(withoutHash(value)) !== value.definitionSha256) fail('breeding.authorization.hash-mismatch', `${path}.definitionSha256`, 'does not match the strict authority evidence.')
  return value
}
const build = <Definition extends object, Value extends { readonly definitionSha256: string }>(definitionValue: Definition, parser: (value: unknown) => Value): Value => {
  const definition = { schemaVersion: 1 as const, ...stripBuilderFields(definitionValue) }
  return verify(parser({ ...definition, definitionSha256: sha256(definition) }), 'authorityEvidence')
}
export const parseAuthoritativeBreedingActorAuthorityV1 = (value: unknown, path = 'actorAuthority'): BreedingActorAuthorityV1 => verify(parseBreedingActorAuthorityV1(value, path), path)
export const parseAuthoritativeBreedingTrainerControlEvidenceV1 = (value: unknown, path = 'trainerControl'): BreedingTrainerControlEvidenceV1 => verify(parseBreedingTrainerControlEvidenceV1(value, path), path)
export const parseAuthoritativeBreedingParentControlEvidenceV1 = (value: unknown, path = 'parentControl'): BreedingParentControlEvidenceV1 => verify(parseBreedingParentControlEvidenceV1(value, path), path)
export const parseAuthoritativeBreedingBreederAuthorityEvidenceV1 = (value: unknown, path = 'breederAuthority'): BreedingBreederAuthorityEvidenceV1 => verify(parseBreedingBreederAuthorityEvidenceV1(value, path), path)
export const parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1 = (value: unknown, path = 'consentEvidence'): BreedingCrossOwnerConsentEvidenceV1 => verify(parseBreedingCrossOwnerConsentEvidenceV1(value, path), path)
export const parseAuthoritativeBreedingGmOverrideEvidenceV1 = (value: unknown, path = 'gmOverride'): BreedingGmOverrideEvidenceV1 => verify(parseBreedingGmOverrideEvidenceV1(value, path), path)
export const parseAuthoritativeBreedingAuthorizationReceiptV1 = (value: unknown, path = 'authorizationReceipt'): BreedingAuthorizationReceiptV1 => verify(parseBreedingAuthorizationReceiptV1(value, path), path)
export const breedingAuthorizationEvidenceDefinitionSha256 = (value: BreedingAuthorizationEvidenceV1): string => sha256(withoutHash(value))

export const createBreedingActorAuthorityV1 = (input: {
  readonly role: 'gm' | 'player'
  readonly command: unknown
  readonly authenticatedPrincipalSha256: string
  readonly authenticationPolicyDefinitionSha256: string
  readonly profile: PlayerProfile | null
  readonly evaluatedAtCampaignMinute: number
}): BreedingActorAuthorityV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  const profile = input.profile === null ? null : normalizePlayerProfile(input.profile)
  if (input.role === 'player' && (!profile || profile.id !== command.actor.profileId)) fail('breeding.authorization.actor-mismatch', 'command.actor.profileId', 'must match the authenticated current Player Profile.')
  if (input.role === 'gm' && profile !== null) fail('breeding.authorization.actor-mismatch', 'profile', 'GM principal authority cannot adopt a submitted player Profile.')
  return build({
    role: input.role,
    commandActorProfileId: command.actor.profileId,
    authenticatedProfileId: profile?.id ?? null,
    selectedTrainerSlug: command.actor.selectedTrainerSlug,
    profileDefinitionSha256: profile ? sha256(profile) : null,
    authenticatedPrincipalSha256: input.authenticatedPrincipalSha256,
    authenticationPolicyDefinitionSha256: input.authenticationPolicyDefinitionSha256,
    evaluatedAtCampaignMinute: input.evaluatedAtCampaignMinute,
  }, parseBreedingActorAuthorityV1)
}
export const createBreedingTrainerControlEvidenceV1 = (input: {
  readonly profile: PlayerProfile
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly trainerSheetDefinitionSha256: string
  readonly evaluatedAtCampaignMinute: number
}): BreedingTrainerControlEvidenceV1 => {
  const profile = normalizePlayerProfile(input.profile)
  const links = profile.linkedCharacters.filter(link => link.sheetKind === 'trainer' && link.sheetSlug === input.trainerSheetSlug)
  if (links.length !== 1) fail('breeding.authorization.profile-stale', 'profile.linkedCharacters', 'must link the controlled Trainer exactly once.')
  const profileDefinitionSha256 = sha256(profile)
  return build({
    profileId: profile.id,
    trainerSheetSlug: input.trainerSheetSlug,
    trainerSheetRevision: input.trainerSheetRevision,
    trainerSheetDefinitionSha256: input.trainerSheetDefinitionSha256,
    profileDefinitionSha256,
    linkedCharacterEvidenceSha256: sha256({ profileId: profile.id, linkedCharacter: links[0] }),
    evaluatedAtCampaignMinute: input.evaluatedAtCampaignMinute,
  }, parseBreedingTrainerControlEvidenceV1)
}
export const createBreedingParentControlEvidenceV1 = (input: {
  readonly parentSheetSlug: string
  readonly parentSheetRevision: number
  readonly parentSheetDefinitionSha256: string
  readonly ownerTrainer: { readonly slug: string, readonly revision: number, readonly definitionSha256: string, readonly currentTeam: readonly unknown[], readonly boxedPokemon: readonly unknown[] }
  readonly trainerControl: BreedingTrainerControlEvidenceV1 | null
  readonly verificationMode: 'gm-verified' | 'profile-control' | 'server-verified-link'
  readonly evaluatedAtCampaignMinute: number
}): BreedingParentControlEvidenceV1 => {
  const trainerControl = input.trainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  if (input.verificationMode === 'profile-control' && (!trainerControl || trainerControl.trainerSheetSlug !== input.ownerTrainer.slug || trainerControl.trainerSheetRevision !== input.ownerTrainer.revision || trainerControl.trainerSheetDefinitionSha256 !== input.ownerTrainer.definitionSha256)) fail('breeding.authorization.profile-stale', 'trainerControl', 'must bind the current parent-owner Trainer.')
  if (input.verificationMode !== 'profile-control' && trainerControl !== null) fail('breeding.authorization.profile-stale', 'trainerControl', 'server or GM link verification cannot impersonate Profile control.')
  const teamCount = input.ownerTrainer.currentTeam.filter(value => value === input.parentSheetSlug).length
  const boxCount = input.ownerTrainer.boxedPokemon.filter(value => value === input.parentSheetSlug).length
  if (teamCount + boxCount !== 1) fail('breeding.authorization.parent-link-stale', 'ownerTrainer', 'must link the parent exactly once in current team or boxed Pokémon.')
  const rosterField = teamCount === 1 ? 'current-team' as const : 'boxed-pokemon' as const
  return build({
    parentSheetSlug: input.parentSheetSlug,
    parentSheetRevision: input.parentSheetRevision,
    parentSheetDefinitionSha256: input.parentSheetDefinitionSha256,
    ownerTrainerSlug: input.ownerTrainer.slug,
    ownerTrainerRevision: input.ownerTrainer.revision,
    ownerTrainerDefinitionSha256: input.ownerTrainer.definitionSha256,
    rosterField,
    verificationMode: input.verificationMode,
    trainerControlEvidenceDefinitionSha256: trainerControl?.definitionSha256 ?? null,
    parentLinkEvidenceSha256: sha256({ ownerTrainerSlug: input.ownerTrainer.slug, ownerTrainerRevision: input.ownerTrainer.revision, rosterField, parentSheetSlug: input.parentSheetSlug }),
    evaluatedAtCampaignMinute: input.evaluatedAtCampaignMinute,
  }, parseBreedingParentControlEvidenceV1)
}
export const createBreedingBreederAuthorityEvidenceV1 = (value: BreedingBreederAuthorityEvidenceDefinitionV1): BreedingBreederAuthorityEvidenceV1 => build(value, parseBreedingBreederAuthorityEvidenceV1)
export const createBreedingCrossOwnerConsentEvidenceV1 = (input: {
  readonly consent: BreedingConsentRecordV1
  readonly projectId: string
  readonly parentControl: BreedingParentControlEvidenceV1
  readonly trainerControl: BreedingTrainerControlEvidenceV1
  readonly validationOperationId: string
  readonly validationCommandSha256: string
  readonly validatedAtCampaignMinute: number
}): BreedingCrossOwnerConsentEvidenceV1 => {
  const consent = parseAuthoritativeBreedingConsentRecordV1(input.consent)
  const parent = parseAuthoritativeBreedingParentControlEvidenceV1(input.parentControl)
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  if (parent.verificationMode !== 'profile-control' || parent.trainerControlEvidenceDefinitionSha256 !== control.definitionSha256 || parent.ownerTrainerSlug !== control.trainerSheetSlug
    || consent.status !== 'active' || consent.projectId !== input.projectId || consent.parentSheetSlug !== parent.parentSheetSlug || consent.parentSheetRevision !== parent.parentSheetRevision
    || consent.ownerTrainerSlug !== parent.ownerTrainerSlug || consent.consentingProfileId !== control.profileId || !same(consent.scopes, [...BREEDING_CONSENT_SCOPES].sort())
    || !isBreedingConsentCurrentlyUsable(consent, { projectId: input.projectId, parentSheetSlug: parent.parentSheetSlug, parentSheetRevision: parent.parentSheetRevision, ownerTrainerSlug: parent.ownerTrainerSlug, consentingProfileId: control.profileId, atCampaignMinute: input.validatedAtCampaignMinute })) {
    fail('breeding.authorization.consent-stale', 'consent', 'must be active, complete, current, and controlled at this exact project and parent revision.')
  }
  return build({
    consentId: consent.consentId,
    consentRevision: consent.revision,
    consentRecordDefinitionSha256: consent.definitionSha256,
    projectId: consent.projectId,
    parentSheetSlug: consent.parentSheetSlug,
    parentSheetRevision: consent.parentSheetRevision,
    ownerTrainerSlug: consent.ownerTrainerSlug,
    consentingProfileId: consent.consentingProfileId,
    scopes: consent.scopes,
    expiresAtCampaignMinute: consent.expiresAtCampaignMinute,
    trainerControlEvidenceDefinitionSha256: control.definitionSha256,
    validationOperationId: input.validationOperationId,
    validationCommandSha256: input.validationCommandSha256,
    validatedAtCampaignMinute: input.validatedAtCampaignMinute,
  } as BreedingCrossOwnerConsentEvidenceDefinitionV1, parseBreedingCrossOwnerConsentEvidenceV1)
}
export const validateBreedingCrossOwnerConsentEvidenceForOperationV1 = (input: {
  readonly consentEvidence: unknown
  readonly projectId: string
  readonly parentControl: unknown
  readonly trainerControl: unknown
  readonly command: unknown
  readonly readSet: unknown
}): BreedingCrossOwnerConsentEvidenceV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const commandSha256 = createBreedingOperationCommandHash(command)
  const consent = parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1(input.consentEvidence)
  const parent = parseAuthoritativeBreedingParentControlEvidenceV1(input.parentControl)
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const consentRead = readSet.resources.some(resource => resource.resourceKind === 'parent-consent' && resource.resourceId === consent.consentId && resource.existence === 'present' && resource.revision === consent.consentRevision && resource.definitionSha256 === consent.consentRecordDefinitionSha256 && resource.purposes.includes('consent'))
  if (consent.projectId !== input.projectId || consent.parentSheetSlug !== parent.parentSheetSlug || consent.parentSheetRevision !== parent.parentSheetRevision
    || consent.ownerTrainerSlug !== parent.ownerTrainerSlug || parent.verificationMode !== 'profile-control' || parent.trainerControlEvidenceDefinitionSha256 !== control.definitionSha256
    || consent.consentingProfileId !== control.profileId || consent.trainerControlEvidenceDefinitionSha256 !== control.definitionSha256
    || consent.validationOperationId !== command.operationId || consent.validationCommandSha256 !== commandSha256 || consent.validatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
    || (consent.expiresAtCampaignMinute !== null && readSet.capturedAtCampaignMinute >= consent.expiresAtCampaignMinute) || !consentRead
    || !readResourceMatches(readSet, 'pokemon-sheet', parent.parentSheetSlug, parent.parentSheetRevision, parent.parentSheetDefinitionSha256)
    || !readResourceMatches(readSet, 'trainer-sheet', parent.ownerTrainerSlug, parent.ownerTrainerRevision, parent.ownerTrainerDefinitionSha256)) fail('breeding.authorization.consent-stale', 'consentEvidence', 'must bind the current transactional read set, operation, project, parent revision, owner control, and campaign-time validity.')
  return consent
}

export const createBreedingGmOverrideEvidenceV1 = (input: {
  readonly overrideId: BreedingOverrideId
  readonly command: unknown
  readonly actorAuthority: BreedingActorAuthorityV1
  readonly overrideKind: BreedingGmOverrideKind
  readonly target: BreedingGmOverrideTargetV1
  readonly reasonId: string
  readonly createdAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
}): BreedingGmOverrideEvidenceV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  if (actor.role !== 'gm' || actor.evaluatedAtCampaignMinute !== input.createdAtCampaignMinute) fail('breeding.authorization.invalid-override', 'actorAuthority', 'GM override requires current authenticated GM principal authority.')
  return build({ overrideId: input.overrideId, operationId: command.operationId, commandSha256: createBreedingOperationCommandHash(command), actorAuthorityDefinitionSha256: actor.definitionSha256, overrideKind: input.overrideKind, target: input.target, reasonId: input.reasonId, createdAtCampaignMinute: input.createdAtCampaignMinute, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingGmOverrideEvidenceV1)
}
export const createBreedingAuthorizationReceiptV1 = (value: BreedingAuthorizationReceiptDefinitionV1): BreedingAuthorizationReceiptV1 => {
  const normalized = { ...value, evidenceDefinitionHashes: Object.freeze([...new Set(value.evidenceDefinitionHashes)].sort(compareCodePoint)), gmOverrideIds: Object.freeze([...new Set(value.gmOverrideIds)].sort(compareCodePoint)) }
  return build(normalized, parseBreedingAuthorizationReceiptV1)
}

const readResourceMatches = (readSet: BreedingOperationReadSetV1, kind: 'trainer-sheet' | 'pokemon-sheet', slug: string, revision: number, definitionSha256: string): boolean => readSet.resources.some(resource => resource.resourceKind === kind && resource.resourceId === slug && resource.existence === 'present' && resource.revision === revision && resource.definitionSha256 === definitionSha256)
const overrideMatches = (override: BreedingGmOverrideEvidenceV1, kind: BreedingGmOverrideKind, target: BreedingGmOverrideTargetV1): boolean => override.overrideKind === kind && same(override.target, target)
const receipt = (input: {
  readonly command: BreedingOperationCommandV1
  readonly actor: BreedingActorAuthorityV1
  readonly readSet: BreedingOperationReadSetV1
  readonly evidence: readonly BreedingAuthorizationEvidenceV1[]
  readonly overrides: readonly BreedingGmOverrideEvidenceV1[]
  readonly authorized: boolean
  readonly reasonId: BreedingAuthorizationReasonId
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => createBreedingAuthorizationReceiptV1({
  operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command),
  commandKind: input.command.commandKind,
  actorAuthorityDefinitionSha256: input.actor.definitionSha256,
  readSetDefinitionSha256: input.readSet.definitionSha256,
  evidenceDefinitionHashes: input.evidence.map(value => value.definitionSha256),
  gmOverrideIds: input.overrides.map(value => value.overrideId),
  authorized: input.authorized,
  reasonId: input.reasonId,
  evaluatedAtCampaignMinute: input.readSet.capturedAtCampaignMinute,
  securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
})
const deny = (input: Omit<Parameters<typeof receipt>[0], 'authorized' | 'reasonId'>, reasonId: Exclude<BreedingAuthorizationReasonId, 'breeding.authorization.authorized'>): BreedingAuthorizationReceiptV1 => receipt({ ...input, authorized: false, reasonId })
const validateOverrides = (values: readonly unknown[], command: BreedingOperationCommandV1, actor: BreedingActorAuthorityV1, minute: number, securityHash: string): readonly BreedingGmOverrideEvidenceV1[] => {
  const commandHash = createBreedingOperationCommandHash(command)
  const parsed = values.map((value, index) => parseAuthoritativeBreedingGmOverrideEvidenceV1(value, `gmOverrides[${index}]`)).sort((left, right) => compareCodePoint(left.overrideId, right.overrideId))
  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index]!
    if (index > 0 && parsed[index - 1]!.overrideId === value.overrideId) fail('breeding.authorization.invalid-override', 'gmOverrides', 'cannot repeat an override identity.')
    if (actor.role !== 'gm' || value.operationId !== command.operationId || value.commandSha256 !== commandHash || value.actorAuthorityDefinitionSha256 !== actor.definitionSha256 || value.createdAtCampaignMinute !== minute || value.securityPolicyDefinitionSha256 !== securityHash) fail('breeding.authorization.invalid-override', `gmOverrides[${index}]`, 'must bind this exact GM, command, campaign checkpoint, and security policy.')
  }
  return Object.freeze(parsed)
}
export const authorizeBreedingConsentGrantV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown
  readonly parentControl: unknown
  readonly project: unknown
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'grant-breeding-consent') {
    fail('breeding.authorization.unsupported-command', 'command.commandKind', 'consent grant authorization accepts grant-breeding-consent only.')
  }
  const payload = command.payload as GrantBreedingConsentPayloadV1
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const parent = parseAuthoritativeBreedingParentControlEvidenceV1(input.parentControl)
  const project = parseBreedingProjectDocumentV1(input.project)
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor, control, parent]
  const context = {
    command,
    actor,
    readSet,
    evidence,
    overrides: [] as readonly BreedingGmOverrideEvidenceV1[],
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  }
  const projectRead = readSet.resources.find(resource => resource.resourceKind === 'breeding-project'
    && resource.resourceId === project.projectId)
  const consentRead = readSet.resources.find(resource => resource.resourceKind === 'parent-consent'
    && resource.resourceId === payload.consentId)
  const commandParent = project.parentRefs.find(ref => ref.pokemonSheetSlug === payload.parentSheetSlug)
  const authorized = actor.role === 'player'
    && actor.authenticatedProfileId === control.profileId
    && actor.profileDefinitionSha256 === control.profileDefinitionSha256
    && actor.commandActorProfileId === control.profileId
    && actor.selectedTrainerSlug === control.trainerSheetSlug
    && actor.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && control.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && parent.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && parent.verificationMode === 'profile-control'
    && parent.trainerControlEvidenceDefinitionSha256 === control.definitionSha256
    && parent.ownerTrainerSlug === control.trainerSheetSlug
    && payload.projectId === project.projectId
    && commandParent !== undefined
    && commandParent.ownerTrainerSlug === parent.ownerTrainerSlug
    && commandParent.ownerTrainerSlug !== project.ownerTrainerSlug
    && commandParent.expectedSheetRevision === payload.parentSheetRevision
    && parent.parentSheetSlug === payload.parentSheetSlug
    && parent.parentSheetRevision === payload.parentSheetRevision
    && project.consentPolicy === 'cross-owner-current-revision-consent'
    && (BREEDING_PROJECT_ACTIVE_STATUSES as readonly string[]).includes(project.status)
    && same(payload.consentScopes, [...BREEDING_CONSENT_SCOPES].sort(compareCodePoint))
    && payload.expiresAtCampaignMinute !== null
    && payload.expiresAtCampaignMinute > readSet.capturedAtCampaignMinute
    && projectRead?.existence === 'present'
    && projectRead.revision === project.revision
    && projectRead.definitionSha256 === sha256(project)
    && projectRead.purposes.includes('mechanics')
    && consentRead?.existence === 'absent'
    && consentRead.purposes.includes('conflict')
    && readResourceMatches(readSet, 'pokemon-sheet', parent.parentSheetSlug, parent.parentSheetRevision, parent.parentSheetDefinitionSha256)
    && readResourceMatches(readSet, 'trainer-sheet', parent.ownerTrainerSlug, parent.ownerTrainerRevision, parent.ownerTrainerDefinitionSha256)
  return receipt({
    ...context,
    authorized,
    reasonId: authorized ? 'breeding.authorization.authorized' : 'breeding.authorization.consent-stale',
  })
}

export interface BreedingProjectSetupParentAuthorityInputV1 {
  readonly parentControl: BreedingParentControlEvidenceV1
  readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null
  readonly consentEvidence: BreedingCrossOwnerConsentEvidenceV1 | null
}
type BreedingCommandOfKind<Kind extends BreedingOperationCommandV1['commandKind']> = Extract<
  BreedingOperationCommandV1,
  { readonly commandKind: Kind }
>

export const authorizeBreedingProjectSetupV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: BreedingActorAuthorityV1
  readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null
  readonly breederAuthority: BreedingBreederAuthorityEvidenceV1 | null
  readonly breederTrainerControl: BreedingTrainerControlEvidenceV1 | null
  readonly parents: readonly [BreedingProjectSetupParentAuthorityInputV1, BreedingProjectSetupParentAuthorityInputV1]
  readonly gmOverrides: readonly unknown[]
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'preview-breeding' && commandValue.commandKind !== 'create-breeding-project') fail('breeding.authorization.unsupported-command', 'command.commandKind', 'project setup authorization accepts preview or create only.')
  const command = commandValue as BreedingCommandOfKind<'preview-breeding' | 'create-breeding-project'>
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const baseEvidence: BreedingAuthorizationEvidenceV1[] = [actor]
  const common = { command, actor, readSet, evidence: baseEvidence, overrides: [] as readonly BreedingGmOverrideEvidenceV1[], securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }
  if (actor.commandActorProfileId !== command.actor.profileId || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) return deny(common, 'breeding.authorization.actor-mismatch')
  const overrides = validateOverrides(input.gmOverrides, command, actor, readSet.capturedAtCampaignMinute, input.securityPolicyDefinitionSha256)
  const usedOverrides = new Set<string>()
  const findOverride = (kind: BreedingGmOverrideKind, target: BreedingGmOverrideTargetV1): BreedingGmOverrideEvidenceV1 | null => {
    const found = overrides.find(value => overrideMatches(value, kind, target)) ?? null
    if (found) usedOverrides.add(found.overrideId)
    return found
  }
  const context = { ...common, overrides }
  const payload = command.payload
  const ownerControl = input.ownerTrainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.ownerTrainerControl)
  if (ownerControl) baseEvidence.push(ownerControl)
  if (actor.role === 'player') {
    if (!ownerControl || ownerControl.profileId !== actor.authenticatedProfileId || ownerControl.profileDefinitionSha256 !== actor.profileDefinitionSha256 || ownerControl.trainerSheetSlug !== payload.ownerTrainerSlug || actor.selectedTrainerSlug !== payload.ownerTrainerSlug || ownerControl.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute || !readResourceMatches(readSet, 'trainer-sheet', ownerControl.trainerSheetSlug, ownerControl.trainerSheetRevision, ownerControl.trainerSheetDefinitionSha256)) return deny(context, 'breeding.authorization.owner-control-required')
  } else if (!findOverride('owner-control', { kind: 'trainer-sheet', trainerSheetSlug: payload.ownerTrainerSlug })) return deny(context, 'breeding.authorization.owner-control-required')
  const breeder = input.breederAuthority === null ? null : parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.breederAuthority)
  if (!breeder) {
    if (actor.role !== 'gm' || !findOverride('breeder-permission', { kind: 'trainer-sheet', trainerSheetSlug: payload.breederTrainerSlug })) return deny(context, 'breeding.authorization.breeder-edge-required')
  } else {
    baseEvidence.push(breeder)
    if (breeder.breederTrainerSlug !== payload.breederTrainerSlug || breeder.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute || !readResourceMatches(readSet, 'trainer-sheet', breeder.breederTrainerSlug, breeder.breederTrainerRevision, breeder.breederTrainerDefinitionSha256)) return deny(context, 'breeding.authorization.breeder-edge-required')
    const edgeDependency = readSet.dependencyEvidence.find(value => value.providerKind === 'edge' && value.providerId === 'Breeder' && value.subjectKind === 'trainer-sheet' && value.subjectId === breeder.breederTrainerSlug && value.subjectRevision === breeder.breederTrainerRevision && value.providerDefinitionSha256 === breeder.edgeRecordSha256 && value.effectiveEvidenceSha256 === breeder.effectiveEdgeProjectionSha256)
    if (!edgeDependency) return deny(context, 'breeding.authorization.breeder-edge-required')
    if (breeder.accessMode === 'profile-control') {
      const control = input.breederTrainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.breederTrainerControl)
      if (control) baseEvidence.push(control)
      if (!control || control.definitionSha256 !== breeder.accessEvidenceDefinitionSha256 || control.profileId !== actor.authenticatedProfileId || control.profileDefinitionSha256 !== actor.profileDefinitionSha256 || control.trainerSheetSlug !== breeder.breederTrainerSlug || control.trainerSheetRevision !== breeder.breederTrainerRevision || control.trainerSheetDefinitionSha256 !== breeder.breederTrainerDefinitionSha256 || control.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) return deny(context, 'breeding.authorization.breeder-access-required')
    } else if (breeder.accessMode === 'gm-authority' && (actor.role !== 'gm' || !findOverride('breeder-access', { kind: 'trainer-sheet', trainerSheetSlug: breeder.breederTrainerSlug }))) return deny(context, 'breeding.authorization.breeder-access-required')
    else if (breeder.accessMode === 'campaign-shared-service' && !readSet.dependencyEvidence.some(value => (value.providerKind === 'facility' || value.providerKind === 'system') && value.subjectKind === 'trainer-sheet' && value.subjectId === breeder.breederTrainerSlug && value.subjectRevision === breeder.breederTrainerRevision && value.providerDefinitionSha256 === breeder.accessEvidenceDefinitionSha256)) return deny(context, 'breeding.authorization.breeder-access-required')
  }
  const seenParents = new Set<string>()
  let hasCrossOwnerParent = false
  for (let index = 0; index < input.parents.length; index += 1) {
    const parentInput = input.parents[index]!
    const parent = parseAuthoritativeBreedingParentControlEvidenceV1(parentInput.parentControl, `parents[${index}].parentControl`)
    baseEvidence.push(parent)
    const commandParent = payload.parentRefs[index]!
    if (parent.parentSheetSlug !== commandParent.pokemonSheetSlug || parent.parentSheetRevision !== commandParent.expectedSheetRevision || parent.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute || seenParents.has(parent.parentSheetSlug) || !readResourceMatches(readSet, 'pokemon-sheet', parent.parentSheetSlug, parent.parentSheetRevision, parent.parentSheetDefinitionSha256)) return deny(context, 'breeding.authorization.parent-link-stale')
    seenParents.add(parent.parentSheetSlug)
    const control = parentInput.ownerTrainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(parentInput.ownerTrainerControl, `parents[${index}].ownerTrainerControl`)
    if (control) baseEvidence.push(control)
    if (!readResourceMatches(readSet, 'trainer-sheet', parent.ownerTrainerSlug, parent.ownerTrainerRevision, parent.ownerTrainerDefinitionSha256)) return deny(context, 'breeding.authorization.parent-link-stale')
    if (parent.verificationMode === 'profile-control' && (!control || parent.trainerControlEvidenceDefinitionSha256 !== control.definitionSha256 || control.trainerSheetSlug !== parent.ownerTrainerSlug || control.trainerSheetRevision !== parent.ownerTrainerRevision || control.trainerSheetDefinitionSha256 !== parent.ownerTrainerDefinitionSha256 || control.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute)) return deny(context, 'breeding.authorization.parent-control-required')
    if (parent.verificationMode !== 'profile-control' && control !== null) return deny(context, 'breeding.authorization.parent-control-required')
    if (parent.ownerTrainerSlug === payload.ownerTrainerSlug) {
      if (actor.role === 'player' && (parent.verificationMode !== 'profile-control' || parent.trainerControlEvidenceDefinitionSha256 !== ownerControl?.definitionSha256)) return deny(context, 'breeding.authorization.parent-control-required')
      if (actor.role === 'gm' && (parent.verificationMode !== 'gm-verified' || !findOverride('parent-control', { kind: 'parent-sheet', parentSheetSlug: parent.parentSheetSlug, parentSheetRevision: parent.parentSheetRevision }))) return deny(context, 'breeding.authorization.parent-control-required')
      if (parentInput.consentEvidence !== null) return deny(context, 'breeding.authorization.consent-stale')
      continue
    }
    hasCrossOwnerParent = true
    if (actor.role === 'gm') {
      if (parent.verificationMode !== 'gm-verified' || !findOverride('parent-control', { kind: 'parent-sheet', parentSheetSlug: parent.parentSheetSlug, parentSheetRevision: parent.parentSheetRevision }) || !findOverride('cross-owner-consent', { kind: 'parent-sheet', parentSheetSlug: parent.parentSheetSlug, parentSheetRevision: parent.parentSheetRevision })) return deny(context, 'breeding.authorization.consent-required')
      continue
    }
    if (command.commandKind !== 'create-breeding-project' || parent.verificationMode !== 'server-verified-link' || control !== null || parentInput.consentEvidence !== null) return deny(context, 'breeding.authorization.consent-required')
  }
  if (command.commandKind === 'create-breeding-project' && (hasCrossOwnerParent !== (command.payload.consentPolicy === 'cross-owner-current-revision-consent'))) return deny(context, 'breeding.authorization.consent-required')
  if (overrides.some(value => !usedOverrides.has(value.overrideId))) return deny(context, 'breeding.authorization.gm-override-invalid')
  return receipt({ ...context, evidence: baseEvidence, overrides, authorized: true, reasonId: 'breeding.authorization.authorized' })
}

export const authorizeBreedingEggIncubationV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly egg: PokemonEggDocumentV1
  readonly gmOverrides: readonly unknown[]
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'advance-egg-incubation' && commandValue.commandKind !== 'set-egg-incubation-pause'
    && commandValue.commandKind !== 'apply-egg-warmer-capability') {
    fail('breeding.authorization.unsupported-command', 'command.commandKind', 'Egg incubation authorization accepts progress, explicit pause control, or the reviewed Egg Warmer Capability operation only.')
  }
  const command = commandValue as BreedingCommandOfKind<'advance-egg-incubation' | 'set-egg-incubation-pause' | 'apply-egg-warmer-capability'>
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const egg = parsePokemonEggDocumentV1(input.egg)
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor]
  const emptyOverrides: readonly BreedingGmOverrideEvidenceV1[] = []
  const common = {
    command,
    actor,
    readSet,
    evidence,
    overrides: emptyOverrides,
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  }
  if (actor.commandActorProfileId !== command.actor.profileId
    || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug
    || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) {
    return deny(common, 'breeding.authorization.actor-mismatch')
  }
  const eggResource = readSet.resources.find(resource => (
    resource.resourceKind === 'pokemon-egg' && resource.resourceId === egg.eggId
  ))
  const eggScope = command.scopes[0]
  if (command.payload.eggId !== egg.eggId
    || eggScope?.kind !== 'pokemon-egg' || eggScope.eggId !== egg.eggId
    || eggScope.expectedRevision !== egg.revision
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256
    || eggResource?.existence !== 'present' || eggResource.revision !== egg.revision
    || eggResource.definitionSha256 !== sha256(egg)
    || !eggResource.purposes.includes('mechanics') || !eggResource.purposes.includes('conflict')) {
    return deny(common, 'breeding.authorization.owner-control-required')
  }
  const control = input.trainerControl === null
    ? null
    : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  if (control) evidence.push(control)
  const overrides = validateOverrides(
    input.gmOverrides,
    command,
    actor,
    readSet.capturedAtCampaignMinute,
    input.securityPolicyDefinitionSha256,
  )
  const context = { ...common, overrides }
  if (command.commandKind === 'set-egg-incubation-pause' && command.payload.paused) {
    const closedReason = BREEDING_INCUBATION_PAUSE_REASON_IDS.includes(
      command.payload.reasonId as typeof BREEDING_INCUBATION_PAUSE_REASON_IDS[number],
    )
    if (!closedReason || (actor.role === 'player' && command.payload.reasonId !== 'breeding.incubation-pause.owner-request')) {
      return deny(context, 'breeding.authorization.gm-override-invalid')
    }
  }
  if (actor.role === 'player') {
    const trainerResource = control
      ? readSet.resources.find(resource => resource.resourceKind === 'trainer-sheet'
        && resource.resourceId === control.trainerSheetSlug)
      : null
    if (overrides.length !== 0 || !control
      || actor.authenticatedProfileId !== control.profileId
      || actor.profileDefinitionSha256 !== control.profileDefinitionSha256
      || actor.selectedTrainerSlug !== egg.ownerTrainerSlug
      || control.trainerSheetSlug !== egg.ownerTrainerSlug
      || control.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
      || trainerResource?.existence !== 'present'
      || trainerResource.revision !== control.trainerSheetRevision
      || trainerResource.definitionSha256 !== control.trainerSheetDefinitionSha256
      || !trainerResource.purposes.includes('authorization')) {
      return deny(context, 'breeding.authorization.owner-control-required')
    }
    return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
  }
  if (control !== null || overrides.length !== 1
    || !overrideMatches(overrides[0]!, 'owner-control', {
      kind: 'trainer-sheet',
      trainerSheetSlug: egg.ownerTrainerSlug,
    })) {
    return deny(context, 'breeding.authorization.gm-override-invalid')
  }
  return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
}

export const authorizeBreedingEggReadinessCorrectionV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly egg: PokemonEggDocumentV1
  readonly gmOverrides: readonly unknown[]
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'mark-egg-ready') {
    fail('breeding.authorization.unsupported-command', 'command.commandKind', 'Egg readiness correction accepts mark-egg-ready only.')
  }
  const command = commandValue as BreedingCommandOfKind<'mark-egg-ready'>
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const egg = parsePokemonEggDocumentV1(input.egg)
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor]
  const emptyOverrides: readonly BreedingGmOverrideEvidenceV1[] = []
  const common = {
    command,
    actor,
    readSet,
    evidence,
    overrides: emptyOverrides,
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  }
  if (actor.commandActorProfileId !== command.actor.profileId
    || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug
    || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) {
    return deny(common, 'breeding.authorization.actor-mismatch')
  }
  const eggResource = readSet.resources.find(resource => (
    resource.resourceKind === 'pokemon-egg' && resource.resourceId === egg.eggId
  ))
  const eggScope = command.scopes[0]
  const reasonIsClosed = BREEDING_EGG_READY_CORRECTION_REASON_IDS.includes(
    command.payload.reasonId as typeof BREEDING_EGG_READY_CORRECTION_REASON_IDS[number],
  )
  const correctionDependencies = readSet.dependencyEvidence.filter(dependency => (
    dependency.providerKind === 'system'
    && dependency.providerId === BREEDING_READINESS_CORRECTION_PROVIDER_ID
    && dependency.subjectKind === 'pokemon-egg'
    && dependency.subjectId === egg.eggId
    && dependency.subjectRevision === egg.revision
    && dependency.checkpoint === 'incubation-operation'
    && dependency.providerDefinitionSha256 === BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256
    && dependency.effectiveEvidenceSha256 === BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256
  ))
  if (!reasonIsClosed || command.payload.eggId !== egg.eggId
    || eggScope?.kind !== 'pokemon-egg' || eggScope.eggId !== egg.eggId
    || eggScope.expectedRevision !== egg.revision
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256
    || eggResource?.existence !== 'present' || eggResource.revision !== egg.revision
    || eggResource.definitionSha256 !== sha256(egg)
    || !eggResource.purposes.includes('mechanics') || !eggResource.purposes.includes('conflict')
    || correctionDependencies.length !== 1 || readSet.dependencyEvidence.length !== 2) {
    return deny(common, 'breeding.authorization.gm-override-invalid')
  }
  const overrides = validateOverrides(
    input.gmOverrides,
    command,
    actor,
    readSet.capturedAtCampaignMinute,
    input.securityPolicyDefinitionSha256,
  )
  const context = { ...common, overrides }
  if (actor.role !== 'gm' || overrides.length !== 1
    || !overrideMatches(overrides[0]!, 'operation-recovery', {
      kind: 'breeding-operation',
      operationId: command.operationId,
    })) {
    return deny(context, 'breeding.authorization.gm-override-invalid')
  }
  return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
}

export const authorizeBreedingCampaignClockBatchV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly currentClock: unknown
  readonly eggs: readonly PokemonEggDocumentV1[]
  readonly gmOverrides: readonly unknown[]
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'advance-campaign-clock') {
    fail('breeding.authorization.unsupported-command', 'command.commandKind', 'Campaign-clock Egg batching accepts advance-campaign-clock only.')
  }
  const command = commandValue as BreedingCommandOfKind<'advance-campaign-clock'>
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const currentClock = parseCampaignClockV1(input.currentClock)
  const eggs = input.eggs.map((value, index) => parsePokemonEggDocumentV1(value, `eggs[${index}]`))
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor]
  const emptyOverrides: readonly BreedingGmOverrideEvidenceV1[] = []
  const common = {
    command,
    actor,
    readSet,
    evidence,
    overrides: emptyOverrides,
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  }
  const clockResource = readSet.resources.find(resource => (
    resource.resourceKind === 'campaign-clock' && resource.resourceId === 'campaign-clock'
  ))
  const eggScopes = command.scopes.slice(1)
  const dependency = readSet.dependencyEvidence.filter(value => (
    value.providerKind === 'system'
    && value.providerId === BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID
    && value.subjectKind === 'campaign'
    && value.subjectId === 'campaign'
    && value.subjectRevision === null
    && value.checkpoint === 'campaign-clock-segment'
    && value.providerDefinitionSha256 === BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION_SHA256
    && value.effectiveEvidenceSha256 === BREEDING_CAMPAIGN_CLOCK_BATCH_EVIDENCE_DEFINITION_SHA256
  ))
  const eggsMatch = eggs.length === eggScopes.length && eggs.every((egg, index) => {
    const scope = eggScopes[index]
    const resource = readSet.resources.find(value => (
      value.resourceKind === 'pokemon-egg' && value.resourceId === egg.eggId
    ))
    return scope?.kind === 'pokemon-egg' && scope.eggId === egg.eggId
      && scope.expectedRevision === egg.revision
      && resource?.existence === 'present' && resource.revision === egg.revision
      && resource.definitionSha256 === sha256(egg)
      && resource.purposes.includes('mechanics') && resource.purposes.includes('conflict')
  })
  if (actor.commandActorProfileId !== command.actor.profileId
    || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug
    || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
    || actor.role !== 'gm' || command.actor.selectedTrainerSlug !== null
    || command.scopes[0]?.kind !== 'campaign-clock'
    || command.scopes[0].expectedRevision !== currentClock.revision
    || command.payload.targetCampaignMinute < currentClock.campaignMinute
    || readSet.capturedAtCampaignMinute !== currentClock.campaignMinute
    || clockResource?.existence !== 'present' || clockResource.revision !== currentClock.revision
    || clockResource.observedCampaignMinute !== currentClock.campaignMinute
    || clockResource.definitionSha256 !== sha256(currentClock)
    || !clockResource.purposes.includes('campaign-time') || !clockResource.purposes.includes('conflict')
    || !eggsMatch || dependency.length !== 1 || readSet.dependencyEvidence.length !== 2) {
    return deny(common, 'breeding.authorization.gm-override-invalid')
  }
  const overrides = validateOverrides(
    input.gmOverrides,
    command,
    actor,
    readSet.capturedAtCampaignMinute,
    input.securityPolicyDefinitionSha256,
  )
  const context = { ...common, overrides }
  if (overrides.length !== 1 || !overrideMatches(overrides[0]!, 'operation-recovery', {
    kind: 'breeding-operation',
    operationId: command.operationId,
  })) {
    return deny(context, 'breeding.authorization.gm-override-invalid')
  }
  return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
}

export const authorizeBreedingInheritanceLearningV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly ownerTrainer: {
    readonly slug: string
    readonly revision: number
    readonly definitionSha256: string
    readonly currentTeam: readonly unknown[]
    readonly boxedPokemon: readonly unknown[]
  }
  readonly childSheet: { readonly slug: string, readonly revision: number, readonly definitionSha256: string }
  readonly origin: unknown
  readonly gmOverrides: readonly unknown[]
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'record-inheritance-learning') {
    fail('breeding.authorization.unsupported-command', 'command.commandKind', 'inheritance learning authorization accepts record-inheritance-learning only.')
  }
  const command = commandValue as BreedingCommandOfKind<'record-inheritance-learning'>
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const origin = parseAuthoritativePokemonBreedingOriginV1(input.origin)
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor]
  const emptyOverrides: readonly BreedingGmOverrideEvidenceV1[] = []
  const common = { command, actor, readSet, evidence, overrides: emptyOverrides, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }
  if (actor.commandActorProfileId !== command.actor.profileId
    || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug
    || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) {
    return deny(common, 'breeding.authorization.actor-mismatch')
  }
  const scope = command.scopes[0]
  const childRead = readSet.resources.find(value => value.resourceKind === 'pokemon-sheet' && value.resourceId === input.childSheet.slug)
  const trainerRead = readSet.resources.find(value => value.resourceKind === 'trainer-sheet' && value.resourceId === input.ownerTrainer.slug)
  const childLinks = [...input.ownerTrainer.currentTeam, ...input.ownerTrainer.boxedPokemon]
    .filter(value => value === input.childSheet.slug).length
  const lineageDependencies = readSet.dependencyEvidence.filter(value => (
    value.providerKind === 'system'
    && value.providerId === 'breeding.inheritance-learning'
    && value.subjectKind === 'pokemon-sheet'
    && value.subjectId === input.childSheet.slug
    && value.subjectRevision === input.childSheet.revision
    && value.checkpoint === 'inheritance-learning'
    && value.providerDefinitionSha256 === BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256
    && value.effectiveEvidenceSha256 === breedingInheritanceLearningOriginStateSha256(origin)
  ))
  if (command.payload.originId !== origin.originId || command.payload.eggId !== origin.eggId
    || command.payload.childSheetSlug !== origin.childSheetSlug || input.childSheet.slug !== origin.childSheetSlug
    || scope?.kind !== 'pokemon-sheet' || scope.sheetSlug !== input.childSheet.slug || scope.expectedRevision !== input.childSheet.revision
    || command.ruleset.rulesetId !== origin.ruleset.rulesetId || command.ruleset.definitionSha256 !== origin.ruleset.definitionSha256
    || childLinks !== 1
    || childRead?.existence !== 'present' || childRead.revision !== input.childSheet.revision
    || childRead.definitionSha256 !== input.childSheet.definitionSha256
    || !childRead.purposes.includes('mechanics') || !childRead.purposes.includes('conflict')
    || trainerRead?.existence !== 'present' || trainerRead.revision !== input.ownerTrainer.revision
    || trainerRead.definitionSha256 !== input.ownerTrainer.definitionSha256 || !trainerRead.purposes.includes('authorization')
    || lineageDependencies.length !== 1) {
    return deny(common, 'breeding.authorization.owner-control-required')
  }
  const control = input.trainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  if (control) evidence.push(control)
  const overrides = validateOverrides(input.gmOverrides, command, actor, readSet.capturedAtCampaignMinute, input.securityPolicyDefinitionSha256)
  const context = { ...common, overrides }
  if (actor.role === 'player') {
    if (overrides.length !== 0 || !control || actor.authenticatedProfileId !== control.profileId
      || actor.profileDefinitionSha256 !== control.profileDefinitionSha256
      || actor.selectedTrainerSlug !== input.ownerTrainer.slug || control.trainerSheetSlug !== input.ownerTrainer.slug
      || control.trainerSheetRevision !== input.ownerTrainer.revision
      || control.trainerSheetDefinitionSha256 !== input.ownerTrainer.definitionSha256
      || control.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) {
      return deny(context, 'breeding.authorization.owner-control-required')
    }
    return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
  }
  if (control !== null || overrides.length !== 1 || !overrideMatches(overrides[0]!, 'owner-control', {
    kind: 'trainer-sheet', trainerSheetSlug: input.ownerTrainer.slug,
  })) return deny(context, 'breeding.authorization.gm-override-invalid')
  return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
}

export const authorizeBreedingLifecycleControlV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly project: BreedingProjectDocumentV1 | null
  readonly consent: BreedingConsentRecordV1 | null
  readonly gmOverrides: readonly unknown[]
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'cancel-breeding-project' && commandValue.commandKind !== 'revoke-breeding-consent' && commandValue.commandKind !== 'recover-breeding-operation') fail('breeding.authorization.unsupported-command', 'command.commandKind', 'lifecycle control accepts Project cancellation, consent settlement, or operation recovery only.')
  const command = commandValue as BreedingCommandOfKind<'cancel-breeding-project' | 'revoke-breeding-consent' | 'recover-breeding-operation'>
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const project = input.project === null ? null : parseBreedingProjectDocumentV1(input.project)
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor]
  const emptyOverrides: readonly BreedingGmOverrideEvidenceV1[] = []
  const common = { command, actor, readSet, evidence, overrides: emptyOverrides, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }
  if (actor.commandActorProfileId !== command.actor.profileId || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) return deny(common, 'breeding.authorization.actor-mismatch')
  const payloadProjectId = command.commandKind === 'recover-breeding-operation' ? null : command.payload.projectId
  if ((command.commandKind === 'recover-breeding-operation') !== (project === null) || (payloadProjectId !== null && payloadProjectId !== project?.projectId)) return deny(common, 'breeding.authorization.owner-control-required')
  const projectResource = project === null ? null : readSet.resources.find(value => value.resourceKind === 'breeding-project' && value.resourceId === project.projectId)
  if (project !== null && (!projectResource || projectResource.existence !== 'present' || projectResource.revision !== project.revision || projectResource.definitionSha256 !== sha256(project))) return deny(common, 'breeding.authorization.owner-control-required')
  const consent = input.consent === null ? null : parseAuthoritativeBreedingConsentRecordV1(input.consent)
  if (command.commandKind === 'revoke-breeding-consent') {
    const consentResource = consent ? readSet.resources.find(value => value.resourceKind === 'parent-consent' && value.resourceId === consent.consentId) : null
    if (!project || !consent || consent.projectId !== project.projectId || consent.consentId !== command.payload.consentId || !consentResource || consentResource.existence !== 'present' || consentResource.revision !== consent.revision || consentResource.definitionSha256 !== consent.definitionSha256) return deny(common, 'breeding.authorization.consent-stale')
  } else if (consent !== null) return deny(common, 'breeding.authorization.consent-stale')
  const control = input.trainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  if (control) evidence.push(control)
  const overrides = validateOverrides(input.gmOverrides, command, actor, readSet.capturedAtCampaignMinute, input.securityPolicyDefinitionSha256)
  const context = { ...common, overrides }
  if (actor.role === 'player') {
    if (overrides.length !== 0 || command.commandKind === 'recover-breeding-operation' || (command.commandKind === 'cancel-breeding-project' && command.payload.reasonId !== 'breeding.project-terminal.cancelled') || (command.commandKind === 'revoke-breeding-consent' && command.payload.reasonId !== 'breeding.consent.revoked')) return deny(context, 'breeding.authorization.gm-override-invalid')
    const ownerTrainerSlug = command.commandKind === 'revoke-breeding-consent' ? consent!.ownerTrainerSlug : project!.ownerTrainerSlug
    const expectedProfileId = command.commandKind === 'revoke-breeding-consent' ? consent!.consentingProfileId : actor.authenticatedProfileId
    if (!control || actor.authenticatedProfileId !== expectedProfileId || control.profileId !== expectedProfileId || control.profileDefinitionSha256 !== actor.profileDefinitionSha256 || actor.selectedTrainerSlug !== ownerTrainerSlug || control.trainerSheetSlug !== ownerTrainerSlug || control.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute || !readResourceMatches(readSet, 'trainer-sheet', control.trainerSheetSlug, control.trainerSheetRevision, control.trainerSheetDefinitionSha256)) return deny(context, command.commandKind === 'revoke-breeding-consent' ? 'breeding.authorization.consent-stale' : 'breeding.authorization.owner-control-required')
    return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
  }
  if (control !== null || overrides.length !== 1) return deny(context, 'breeding.authorization.gm-override-invalid')
  const expectedKind: BreedingGmOverrideKind = command.commandKind === 'cancel-breeding-project' && command.payload.reasonId === 'breeding.project-terminal.cancelled' ? 'owner-control' : 'operation-recovery'
  const expectedTarget: BreedingGmOverrideTargetV1 = expectedKind === 'owner-control'
    ? { kind: 'trainer-sheet', trainerSheetSlug: project!.ownerTrainerSlug }
    : { kind: 'breeding-operation', operationId: command.commandKind === 'recover-breeding-operation' ? command.payload.targetOperationId : command.operationId }
  if (!overrideMatches(overrides[0]!, expectedKind, expectedTarget)) return deny(context, 'breeding.authorization.gm-override-invalid')
  return receipt({ ...context, authorized: true, reasonId: 'breeding.authorization.authorized' })
}

export const authorizePokemonEggTransferConsentSettlementV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown
  readonly consent: PokemonEggTransferConsentV1
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'settle-egg-transfer-consent') {
    fail('breeding.authorization.unsupported-command', 'command.commandKind', 'Egg-transfer consent settlement accepts its dedicated command only.')
  }
  const payload = command.payload as SettleEggTransferConsentPayloadV1
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const consent = parseAuthoritativePokemonEggTransferConsentV1(input.consent)
  const evidence: BreedingAuthorizationEvidenceV1[] = [actor, control]
  const context = {
    command,
    actor,
    readSet,
    evidence,
    overrides: [] as readonly BreedingGmOverrideEvidenceV1[],
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  }
  const consentResource = readSet.resources.find(resource => resource.resourceKind === 'egg-transfer-consent'
    && resource.resourceId === consent.consentId)
  const scope = command.scopes[0]
  const expiredAtCheckpoint = readSet.capturedAtCampaignMinute >= consent.expiresAtCampaignMinute
  const reasonMatchesTime = payload.reasonId === (expiredAtCheckpoint
    ? 'breeding.egg-transfer-consent.expired'
    : 'breeding.egg-transfer-consent.revoked')
  const authorized = actor.role === 'player'
    && consent.status === 'active'
    && payload.consentId === consent.consentId
    && reasonMatchesTime
    && scope?.kind === 'egg-transfer-consent'
    && scope.consentId === consent.consentId
    && scope.expectedRevision === consent.revision
    && actor.authenticatedProfileId === consent.consentingProfileId
    && actor.authenticatedProfileId === control.profileId
    && actor.profileDefinitionSha256 === control.profileDefinitionSha256
    && actor.commandActorProfileId === control.profileId
    && actor.selectedTrainerSlug === consent.consentingTrainerSlug
    && control.trainerSheetSlug === consent.consentingTrainerSlug
    && actor.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && control.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && consentResource?.existence === 'present'
    && consentResource.revision === consent.revision
    && consentResource.definitionSha256 === consent.definitionSha256
    && consentResource.purposes.includes('conflict')
    && consentResource.purposes.includes('consent')
    && readResourceMatches(readSet, 'trainer-sheet', control.trainerSheetSlug, control.trainerSheetRevision, control.trainerSheetDefinitionSha256)
  return receipt({
    ...context,
    authorized,
    reasonId: authorized ? 'breeding.authorization.authorized' : 'breeding.authorization.consent-stale',
  })
}

export const assertBreedingAuthorizationReceiptExactReplay = (existingValue: unknown, attemptedValue: unknown): BreedingAuthorizationReceiptV1 => {
  const existing = parseAuthoritativeBreedingAuthorizationReceiptV1(existingValue, 'existingReceipt')
  const attempted = parseAuthoritativeBreedingAuthorizationReceiptV1(attemptedValue, 'attemptedReceipt')
  if (existing.operationId !== attempted.operationId || !same(existing, attempted)) fail('breeding.authorization.hash-mismatch', 'authorizationReceipt', 'operation authorization receipt permits exact replay only.')
  return existing
}
export const parseAuthoritativeReadSetForAuthorization = (value: unknown): BreedingOperationReadSetV1 => parseAuthoritativeBreedingOperationReadSetV1(value)
