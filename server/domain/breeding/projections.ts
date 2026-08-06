import { createHash, createHmac } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingDiagnosticProjectionV1,
  parseBreedingGmProjectionV1,
  parseBreedingOwnerEggProjectionV1,
  parseBreedingOwnerProjectProjectionV1,
  parseBreedingParticipatingOwnerProjectionV1,
  parseBreedingPresentationProjectionV1,
  parseBreedingPublicProjectionV1,
  type BreedingCoarseStatus,
  type BreedingDiagnosticProjectionV1,
  type BreedingGmProjectionV1,
  type BreedingOwnerEggProjectionV1,
  type BreedingOwnerProjectProjectionV1,
  type BreedingParticipatingOwnerProjectionV1,
  type BreedingPresentationProjectionV1,
  type BreedingProgressBand,
  type BreedingProjectedOfferV1,
  type BreedingProjectionAggregateKind,
  type BreedingPublicProjectionV1,
} from '#shared/breeding/projections'
import { BREEDING_PROJECT_STATUSES, parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1, type BreedingProjectStatus } from '#shared/breeding/project'
import { POKEMON_EGG_STATUSES, parsePokemonEggDocumentV1, type PokemonEggStatus } from '#shared/breeding/egg'
import type { BreedingOperationCommandKind } from '#shared/breeding/operations'
import { parseBreedingProjectIdSyntax, parsePokemonEggIdSyntax, type BreedingMoveId, type BreedingOfferId } from '#shared/breeding/ids'
import type { BreedingActorAuthorityV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import { parseAuthoritativeBreedingActorAuthorityV1, parseAuthoritativeBreedingAuthorizationReceiptV1, parseAuthoritativeBreedingParentControlEvidenceV1, parseAuthoritativeBreedingTrainerControlEvidenceV1 } from './authorization'
import { parseAuthoritativeBreedingCheckRecordV1, parseAuthoritativeBreedingConsentRecordV1, parseAuthoritativeBreedingGmAdjudicationRecordV1, parseAuthoritativeBreedingOptionOfferRecordV1, parseAuthoritativeBreedingRollRecordV1 } from './ledgers'
import { parseAuthoritativeBreedingOperationReadSetV1 } from './readSets'

export type BreedingProjectionAuthorityErrorCode = 'breeding.projection.hash-mismatch' | 'breeding.projection.unauthorized' | 'breeding.projection.invalid-source'
export class BreedingProjectionAuthorityError extends Error { readonly code: BreedingProjectionAuthorityErrorCode; readonly path: string; constructor(code: BreedingProjectionAuthorityErrorCode, path: string, message: string) { super(`${path}: ${message}`); this.name = 'BreedingProjectionAuthorityError'; this.code = code; this.path = path } }
const fail = (code: BreedingProjectionAuthorityErrorCode, path: string, message: string): never => { throw new BreedingProjectionAuthorityError(code, path, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const equal = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const withoutProjectionHash = <Value extends { readonly projectionDefinitionSha256: string }>(value: Value): Omit<Value, 'projectionDefinitionSha256'> => { const { projectionDefinitionSha256: _hash, ...definition } = value; return definition }
export const breedingProjectionDefinitionSha256 = (value: BreedingPresentationProjectionV1): string => sha256(withoutProjectionHash(value))
export const parseAuthoritativeBreedingPresentationProjectionV1 = (value: unknown, path = 'projection'): BreedingPresentationProjectionV1 => { const parsed = parseBreedingPresentationProjectionV1(value, path); if (breedingProjectionDefinitionSha256(parsed) !== parsed.projectionDefinitionSha256) fail('breeding.projection.hash-mismatch', `${path}.projectionDefinitionSha256`, 'does not match the strict audience projection.'); return parsed }
const build = <Value extends BreedingPresentationProjectionV1>(definitionValue: Omit<Value, 'schemaVersion' | 'projectionDefinitionSha256'>, parser: (value: unknown) => Value): Value => {
  const { schemaVersion: _schemaVersion, projectionDefinitionSha256: _projectionDefinitionSha256, ...input } = definitionValue as typeof definitionValue & { readonly schemaVersion?: unknown, readonly projectionDefinitionSha256?: unknown }
  const definition = { schemaVersion: 1 as const, ...input }
  const parsed = parser({ ...definition, projectionDefinitionSha256: sha256(definition) })
  return parseAuthoritativeBreedingPresentationProjectionV1(parsed) as Value
}
export const breedingProjectionAggregateIdentitySha256 = (
  key: Buffer | string,
  kind: BreedingProjectionAggregateKind,
  id: string,
): string => {
  const bytes = typeof key === 'string' ? Buffer.from(key) : key
  if (bytes.byteLength < 32) fail('breeding.projection.invalid-source', 'campaignProjectionKey', 'must contain at least 32 bytes.')
  return createHmac('sha256', bytes).update(`${kind}\u0000${id}`).digest('hex')
}
export const coarseBreedingProjectStatus = (status: BreedingProjectStatus): BreedingCoarseStatus => {
  if (status === 'draft') return 'planning'
  if (status === 'awaiting-parent-consent') return 'awaiting-consent'
  if (status === 'initial-time-in-progress' || status === 'additional-time-in-progress') return 'in-progress'
  if (status === 'check-ready') return 'decision-required'
  if (status === 'ready-to-produce') return 'ready'
  if (status === 'egg-produced') return 'completed'
  if (status === 'cancelled' || status === 'expired' || status === 'abandoned') return 'cancelled'
  return 'unavailable'
}
export const coarsePokemonEggStatus = (status: PokemonEggStatus): BreedingCoarseStatus => {
  if (status === 'incubating') return 'incubating'
  if (status === 'ready') return 'ready'
  if (status === 'awaiting-special-adjudication') return 'decision-required'
  if (status === 'hatching') return 'hatching'
  if (status === 'hatched') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  return 'unavailable'
}
const progressBand = (accumulated: number, target: number, complete: boolean): BreedingProgressBand => { if (complete) return 'complete'; if (target <= 0 || accumulated <= 0) return 'none'; const ratio = accumulated / target; return ratio < 1 / 3 ? 'early' : ratio < 2 / 3 ? 'middle' : 'late' }
export const buildBreedingPublicProjectionV1 = (input: {
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly aggregateId: string
  readonly status: BreedingProjectStatus | PokemonEggStatus
  readonly accumulatedCampaignMinutes: number
  readonly targetCampaignMinutes: number
  readonly campaignProjectionKey: Buffer | string
  readonly securityPolicyDefinitionSha256: string
}): BreedingPublicProjectionV1 => {
  const isProject = input.aggregateKind === 'breeding-project'
  if ((isProject && (!parseBreedingProjectIdSyntax(input.aggregateId) || !(BREEDING_PROJECT_STATUSES as readonly string[]).includes(input.status)))
    || (!isProject && (!parsePokemonEggIdSyntax(input.aggregateId) || !(POKEMON_EGG_STATUSES as readonly string[]).includes(input.status)))
    || !Number.isSafeInteger(input.accumulatedCampaignMinutes) || input.accumulatedCampaignMinutes < 0
    || !Number.isSafeInteger(input.targetCampaignMinutes) || input.targetCampaignMinutes < 0 || input.accumulatedCampaignMinutes > input.targetCampaignMinutes) fail('breeding.projection.invalid-source', 'publicProjection', 'must use a canonical aggregate identity, status, and bounded progress facts.')
  const coarseStatus = isProject ? coarseBreedingProjectStatus(input.status as BreedingProjectStatus) : coarsePokemonEggStatus(input.status as PokemonEggStatus)
  return build({ audience: 'public', aggregateKind: input.aggregateKind, aggregateIdentitySha256: breedingProjectionAggregateIdentitySha256(input.campaignProjectionKey, input.aggregateKind, input.aggregateId), coarseStatus, summaryId: isProject ? 'breeding.public.project' : 'breeding.public.egg', progressBand: progressBand(input.accumulatedCampaignMinutes, input.targetCampaignMinutes, coarseStatus === 'completed'), securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingPublicProjectionV1)
}
const validateOwnerAccess = (actorValue: unknown, controlValue: unknown, ownerTrainerSlug: string, minute: number): { actor: BreedingActorAuthorityV1, control: BreedingTrainerControlEvidenceV1 } => {
  const actor = parseAuthoritativeBreedingActorAuthorityV1(actorValue)
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(controlValue)
  if (actor.role !== 'player' || actor.authenticatedProfileId !== control.profileId || actor.profileDefinitionSha256 !== control.profileDefinitionSha256 || control.trainerSheetSlug !== ownerTrainerSlug || actor.evaluatedAtCampaignMinute !== minute || control.evaluatedAtCampaignMinute !== minute) fail('breeding.projection.unauthorized', 'ownerAccess', 'requires current owner-Trainer Profile control.')
  return { actor, control }
}
const projectOffer = (offerValue: unknown, profileId: string, minute: number): BreedingProjectedOfferV1 | null => { const offer = parseAuthoritativeBreedingOptionOfferRecordV1(offerValue); if (offer.status !== 'active' || offer.chooserProfileId !== profileId || (offer.expiresAtCampaignMinute !== null && minute >= offer.expiresAtCampaignMinute)) return null; return Object.freeze({ offerId: offer.offerId, revision: offer.revision, choiceKind: offer.choiceKind, expiresAtCampaignMinute: offer.expiresAtCampaignMinute, options: Object.freeze(offer.options.map(option => Object.freeze({ optionId: option.optionId, canonicalValueId: option.canonicalValueId }))) }) }
const ownerOffers = (values: readonly unknown[], profileId: string, minute: number): readonly BreedingProjectedOfferV1[] => Object.freeze(values.map(value => projectOffer(value, profileId, minute)).filter((value): value is BreedingProjectedOfferV1 => value !== null).sort((left, right) => compare(left.offerId, right.offerId)))
const canonicalActions = (actions: readonly BreedingOperationCommandKind[]): readonly BreedingOperationCommandKind[] => Object.freeze([...new Set(actions)].sort(compare))
const canonicalReasons = (reasons: readonly string[]): readonly string[] => Object.freeze([...new Set(reasons)].sort(compare))
const consentStatusForParent = (project: BreedingProjectDocumentV1, parentIndex: number, consentValues: readonly unknown[], minute: number): 'active' | 'expired' | 'not-required' | 'revoked' | 'waiting' => {
  const parent = project.parentRefs[parentIndex]!
  if (parent.ownerTrainerSlug === project.ownerTrainerSlug) return 'not-required'
  const records = consentValues.map(value => parseAuthoritativeBreedingConsentRecordV1(value)).filter(consent => consent.projectId === project.projectId && consent.parentSheetSlug === parent.pokemonSheetSlug && consent.parentSheetRevision === parent.expectedSheetRevision)
  if (!records.length) return 'waiting'
  const latest = [...records].sort((left, right) => right.revision - left.revision)[0]!
  if (latest.status === 'active') return latest.expiresAtCampaignMinute !== null && minute >= latest.expiresAtCampaignMinute ? 'expired' : 'active'
  return latest.status === 'superseded' ? 'revoked' : latest.status
}
export const buildBreedingOwnerProjectProjectionV1 = (input: {
  readonly project: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown
  readonly consents: readonly unknown[]
  readonly offers: readonly unknown[]
  readonly availableActions: readonly BreedingOperationCommandKind[]
  readonly explanationReasonIds: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
}): BreedingOwnerProjectProjectionV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const { actor } = validateOwnerAccess(input.actorAuthority, input.ownerTrainerControl, project.ownerTrainerSlug, input.generatedAtCampaignMinute)
  const parentSlots = project.parentRefs.map((parent, parentIndex) => { const owned = parent.ownerTrainerSlug === project.ownerTrainerSlug; return Object.freeze({ parentIndex: parentIndex as 0 | 1, relationship: owned ? 'owned' as const : 'participating' as const, pokemonSheetSlug: owned ? parent.pokemonSheetSlug : null, sheetRevision: owned ? parent.expectedSheetRevision : null, consentStatus: consentStatusForParent(project, parentIndex, input.consents, input.generatedAtCampaignMinute) }) }) as unknown as BreedingOwnerProjectProjectionV1['parentSlots']
  const checkStatus = project.check ? project.check.outcome : project.status === 'check-ready' ? 'ready' : 'not-ready'
  return build({ audience: 'owner', aggregateKind: 'breeding-project', projectId: project.projectId, revision: project.revision, status: project.status, ownerTrainerSlug: project.ownerTrainerSlug, breederTrainerSlug: project.breederTrainerSlug, parentSlots, timeline: { initialRequiredCampaignMinutes: 240, initialAccumulatedCampaignMinutes: project.timeline.initialAccumulatedCampaignMinutes, additionalRequiredCampaignMinutes: 240, additionalAccumulatedCampaignMinutes: project.timeline.additionalAccumulatedCampaignMinutes, checkReadyAtCampaignMinute: project.timeline.checkReadyAtCampaignMinute, readyToProduceAtCampaignMinute: project.timeline.readyToProduceAtCampaignMinute }, checkStatus, offers: ownerOffers(input.offers, actor.authenticatedProfileId!, input.generatedAtCampaignMinute), availableActions: canonicalActions(input.availableActions), explanationReasonIds: canonicalReasons(input.explanationReasonIds), generatedAtCampaignMinute: input.generatedAtCampaignMinute, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingOwnerProjectProjectionV1)
}
export const buildBreedingOwnerEggProjectionV1 = (input: {
  readonly egg: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown
  readonly offers: readonly unknown[]
  readonly availableActions: readonly BreedingOperationCommandKind[]
  readonly explanationReasonIds: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
}): BreedingOwnerEggProjectionV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const { actor } = validateOwnerAccess(input.actorAuthority, input.ownerTrainerControl, egg.ownerTrainerSlug, input.generatedAtCampaignMinute)
  const moves = [...new Set(egg.offspring.inheritanceCandidates.map(candidate => candidate.moveId))].sort(compare) as BreedingMoveId[]
  return build({ audience: 'owner', aggregateKind: 'pokemon-egg', eggId: egg.eggId, revision: egg.revision, status: egg.status, ownerTrainerSlug: egg.ownerTrainerSlug, sourceKind: egg.source.kind, offspring: { speciesId: egg.offspring.speciesId, natureId: egg.offspring.nature.valueId, abilityId: egg.offspring.ability.valueId, genderId: egg.offspring.gender.valueId, startingLevel: egg.offspring.startingLevel, babyTemplateApplied: egg.offspring.babyTemplate.applied }, incubation: { targetCampaignMinutes: egg.incubation.targetCampaignMinutes, accumulatedCampaignMinutes: egg.incubation.accumulatedCampaignMinutes, readyAtCampaignMinute: egg.incubation.readyAtCampaignMinute, paused: egg.incubation.paused }, specialStatus: egg.special.state, specialOutcomeId: egg.special.outcomeId, inheritanceMoveIds: Object.freeze(moves), childSheetSlug: egg.childSheetSlug, offers: ownerOffers(input.offers, actor.authenticatedProfileId!, input.generatedAtCampaignMinute), availableActions: canonicalActions(input.availableActions), explanationReasonIds: canonicalReasons(input.explanationReasonIds), generatedAtCampaignMinute: input.generatedAtCampaignMinute, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingOwnerEggProjectionV1)
}
export const buildBreedingParticipatingOwnerProjectionV1 = (input: {
  readonly project: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown
  readonly parentControl: unknown
  readonly ownParentSafeSummary: { readonly pokemonSheetSlug: string, readonly sheetRevision: number, readonly displayName: string, readonly speciesId: string }
  readonly consentRequest: { readonly consentId: string, readonly scopes: readonly string[], readonly expiresAtCampaignMinute: number | null }
  readonly consentRecord: unknown | null
  readonly ownContributionMoveIds: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
}): BreedingParticipatingOwnerProjectionV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const parent = parseAuthoritativeBreedingParentControlEvidenceV1(input.parentControl)
  if (actor.role !== 'player' || actor.authenticatedProfileId !== control.profileId || actor.profileDefinitionSha256 !== control.profileDefinitionSha256 || actor.evaluatedAtCampaignMinute !== input.generatedAtCampaignMinute || control.evaluatedAtCampaignMinute !== input.generatedAtCampaignMinute || parent.verificationMode !== 'profile-control' || parent.trainerControlEvidenceDefinitionSha256 !== control.definitionSha256 || parent.ownerTrainerSlug !== control.trainerSheetSlug || parent.ownerTrainerSlug === project.ownerTrainerSlug || !project.parentRefs.some(ref => ref.pokemonSheetSlug === parent.parentSheetSlug && ref.ownerTrainerSlug === parent.ownerTrainerSlug && ref.expectedSheetRevision === parent.parentSheetRevision) || input.ownParentSafeSummary.pokemonSheetSlug !== parent.parentSheetSlug || input.ownParentSafeSummary.sheetRevision !== parent.parentSheetRevision) fail('breeding.projection.unauthorized', 'participantAccess', 'requires current control of exactly one participating parent.')
  const consent = input.consentRecord === null ? null : parseAuthoritativeBreedingConsentRecordV1(input.consentRecord)
  if (consent && (consent.consentId !== input.consentRequest.consentId || consent.projectId !== project.projectId || consent.parentSheetSlug !== parent.parentSheetSlug || consent.parentSheetRevision !== parent.parentSheetRevision || consent.ownerTrainerSlug !== parent.ownerTrainerSlug || consent.consentingProfileId !== control.profileId || !equal(consent.scopes, [...input.consentRequest.scopes].sort(compare)) || consent.expiresAtCampaignMinute !== input.consentRequest.expiresAtCampaignMinute)) fail('breeding.projection.unauthorized', 'consentRecord', 'must belong to only this participating parent, Profile, scope request, and expiry.')
  const consentStatus = !consent ? 'waiting' : consent.status === 'active' ? (consent.expiresAtCampaignMinute !== null && input.generatedAtCampaignMinute >= consent.expiresAtCampaignMinute ? 'expired' : 'active') : consent.status === 'expired' ? 'expired' : 'revoked'
  const moves = [...new Set(input.ownContributionMoveIds)].sort(compare)
  return build({ audience: 'participating-owner', aggregateKind: 'breeding-project', projectId: project.projectId, revision: project.revision, coarseStatus: coarseBreedingProjectStatus(project.status), breederTrainerSlug: project.breederTrainerSlug, ownParent: input.ownParentSafeSummary, consent: { consentId: input.consentRequest.consentId, status: consentStatus, scopes: Object.freeze([...input.consentRequest.scopes].sort(compare)), expiresAtCampaignMinute: input.consentRequest.expiresAtCampaignMinute }, ownContributionMoveIds: Object.freeze(moves), otherParentPresent: true, availableActions: consentStatus === 'waiting' ? ['grant-breeding-consent'] : consentStatus === 'active' ? ['revoke-breeding-consent'] : [], generatedAtCampaignMinute: input.generatedAtCampaignMinute, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingParticipatingOwnerProjectionV1)
}
const validateGmAccess = (actorValue: unknown, minute: number): BreedingActorAuthorityV1 => { const actor = parseAuthoritativeBreedingActorAuthorityV1(actorValue); if (actor.role !== 'gm' || actor.evaluatedAtCampaignMinute !== minute) fail('breeding.projection.unauthorized', 'gmAccess', 'requires current authenticated GM principal authority.'); return actor }
export const buildBreedingGmProjectionV1 = (input: Omit<BreedingGmProjectionV1, 'schemaVersion' | 'audience' | 'projectionDefinitionSha256'> & { readonly actorAuthority: unknown }): BreedingGmProjectionV1 => {
  validateGmAccess(input.actorAuthority, input.generatedAtCampaignMinute)
  const document = input.aggregateKind === 'breeding-project' ? parseBreedingProjectDocumentV1(input.document) : parsePokemonEggDocumentV1(input.document)
  if ((input.aggregateKind === 'breeding-project') !== ('projectId' in document)) fail('breeding.projection.invalid-source', 'document', 'must match the aggregate kind.')
  input.rolls.forEach(value => parseAuthoritativeBreedingRollRecordV1(value)); input.checks.forEach(value => parseAuthoritativeBreedingCheckRecordV1(value)); input.offers.forEach(value => parseAuthoritativeBreedingOptionOfferRecordV1(value)); input.consents.forEach(value => parseAuthoritativeBreedingConsentRecordV1(value)); input.adjudications.forEach(value => parseAuthoritativeBreedingGmAdjudicationRecordV1(value)); input.authorizationReceipts.forEach(value => parseAuthoritativeBreedingAuthorizationReceiptV1(value)); input.readSets.forEach(value => parseAuthoritativeBreedingOperationReadSetV1(value))
  return build({ audience: 'gm', aggregateKind: input.aggregateKind, document, rolls: input.rolls, checks: input.checks, offers: input.offers, consents: input.consents, adjudications: input.adjudications, authorizationReceipts: input.authorizationReceipts, readSets: input.readSets, availableActions: canonicalActions(input.availableActions), generatedAtCampaignMinute: input.generatedAtCampaignMinute, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingGmProjectionV1)
}
export interface BreedingDiagnosticOperatorAuthorityV1 { readonly authorized: true, readonly principalSha256: string, readonly policyDefinitionSha256: string, readonly evaluatedAtCampaignMinute: number, readonly definitionSha256: string }
export const createBreedingDiagnosticOperatorAuthorityV1 = (value: Omit<BreedingDiagnosticOperatorAuthorityV1, 'authorized' | 'definitionSha256'>): BreedingDiagnosticOperatorAuthorityV1 => { const definition = { authorized: true as const, principalSha256: value.principalSha256, policyDefinitionSha256: value.policyDefinitionSha256, evaluatedAtCampaignMinute: value.evaluatedAtCampaignMinute }; return validateDiagnosticAuthority(Object.freeze({ ...definition, definitionSha256: sha256(definition) }), value.evaluatedAtCampaignMinute) }
const validateDiagnosticAuthority = (value: BreedingDiagnosticOperatorAuthorityV1, minute: number): BreedingDiagnosticOperatorAuthorityV1 => { if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).some(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return !descriptor?.enumerable || !('value' in descriptor) }) || Object.keys(value).sort(compare).join(',') !== ['authorized','definitionSha256','evaluatedAtCampaignMinute','policyDefinitionSha256','principalSha256'].sort(compare).join(',')) fail('breeding.projection.unauthorized', 'diagnosticAccess', 'must be strict plain operator authority evidence.'); const { definitionSha256, ...definition } = value; if (value.authorized !== true || value.evaluatedAtCampaignMinute !== minute || !Number.isSafeInteger(value.evaluatedAtCampaignMinute) || value.evaluatedAtCampaignMinute < 0 || sha256(definition) !== definitionSha256 || !/^[0-9a-f]{64}$/.test(value.principalSha256) || !/^[0-9a-f]{64}$/.test(value.policyDefinitionSha256)) fail('breeding.projection.unauthorized', 'diagnosticAccess', 'requires current authorized operator evidence.'); return value }
export const buildBreedingDiagnosticProjectionV1 = (input: Omit<BreedingDiagnosticProjectionV1, 'schemaVersion' | 'audience' | 'aggregateIdentitySha256' | 'operatorAuthorizationDefinitionSha256' | 'projectionDefinitionSha256'> & { readonly aggregateId: string, readonly campaignProjectionKey: Buffer | string, readonly operatorAuthority: BreedingDiagnosticOperatorAuthorityV1 }): BreedingDiagnosticProjectionV1 => {
  const authority = validateDiagnosticAuthority(input.operatorAuthority, input.generatedAtCampaignMinute)
  return build({ audience: 'diagnostic', aggregateKind: input.aggregateKind, aggregateIdentitySha256: breedingProjectionAggregateIdentitySha256(input.campaignProjectionKey, input.aggregateKind, input.aggregateId), revision: input.revision, aggregateDefinitionSha256: input.aggregateDefinitionSha256, rulesetDefinitionSha256: input.rulesetDefinitionSha256, operationDefinitionHashes: Object.freeze([...new Set(input.operationDefinitionHashes)].sort(compare)), traces: Object.freeze([...input.traces].sort((left, right) => compare(left.stage, right.stage))), reasonIds: canonicalReasons(input.reasonIds), generatedAtCampaignMinute: input.generatedAtCampaignMinute, operatorAuthorizationDefinitionSha256: authority.definitionSha256, securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256 }, parseBreedingDiagnosticProjectionV1)
}
export const assertBreedingProjectionAudience = <Audience extends BreedingPresentationProjectionV1['audience']>(value: unknown, audience: Audience): Extract<BreedingPresentationProjectionV1, { readonly audience: Audience }> => { const projection = parseAuthoritativeBreedingPresentationProjectionV1(value); if (projection.audience !== audience) fail('breeding.projection.unauthorized', 'projection.audience', 'cannot adopt a projection from another audience.'); return projection as Extract<BreedingPresentationProjectionV1, { readonly audience: Audience }> }
export const collectProjectedOfferIds = (projection: BreedingOwnerProjectProjectionV1 | BreedingOwnerEggProjectionV1): ReadonlySet<BreedingOfferId> => new Set(projection.offers.map(offer => offer.offerId))
