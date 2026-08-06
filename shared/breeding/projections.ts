import { isSlug } from '../paths'
import {
  BREEDING_OFFER_OPTION_KINDS,
  parseBreedingAbilityIdSyntax,
  parseBreedingConsentIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingOfferIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingSpeciesIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingAbilityId,
  type BreedingConsentId,
  type BreedingMoveId,
  type BreedingOfferId,
  type BreedingOfferOptionId,
  type BreedingOfferOptionKind,
  type BreedingProjectId,
  type BreedingSpeciesId,
  type PokemonEggId,
} from './ids'
import { BREEDING_CONSENT_SCOPES, BREEDING_OPERATION_COMMAND_KINDS, type BreedingConsentScope, type BreedingOperationCommandKind } from './operations'
import { parseBreedingCheckRecordV1, parseBreedingConsentRecordV1, parseBreedingGmAdjudicationRecordV1, parseBreedingOptionOfferRecordV1, parseBreedingRollRecordV1, type BreedingCheckRecordV1, type BreedingConsentRecordV1, type BreedingGmAdjudicationRecordV1, type BreedingOptionOfferRecordV1, type BreedingRollRecordV1 } from './ledgers'
import { BREEDING_PROJECT_STATUSES, parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1, type BreedingProjectStatus } from './project'
import { POKEMON_EGG_STATUSES, parsePokemonEggDocumentV1, type PokemonEggDocumentV1, type PokemonEggSourceKind, type PokemonEggStatus } from './egg'
import { parseBreedingAuthorizationReceiptV1, type BreedingAuthorizationReceiptV1 } from './authorization'
import { parseBreedingOperationReadSetV1, type BreedingOperationReadSetV1 } from './readSets'

export const BREEDING_PROJECTION_SCHEMA_VERSION = 1 as const
export const BREEDING_PROJECTION_AUDIENCES = Object.freeze(['diagnostic', 'gm', 'owner', 'participating-owner', 'public'] as const)
export type BreedingProjectionAudience = typeof BREEDING_PROJECTION_AUDIENCES[number]
export type BreedingProjectionAggregateKind = 'breeding-project' | 'pokemon-egg'
export const BREEDING_COARSE_STATUSES = Object.freeze(['awaiting-consent', 'cancelled', 'completed', 'decision-required', 'hatching', 'incubating', 'in-progress', 'planning', 'ready', 'unavailable'] as const)
export type BreedingCoarseStatus = typeof BREEDING_COARSE_STATUSES[number]
export type BreedingProgressBand = 'complete' | 'early' | 'late' | 'middle' | 'none'
export interface BreedingPublicProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'public'
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly aggregateIdentitySha256: string
  readonly coarseStatus: BreedingCoarseStatus
  readonly summaryId: 'breeding.public.egg' | 'breeding.public.project'
  readonly progressBand: BreedingProgressBand
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}
export interface BreedingProjectedOfferOptionV1 { readonly optionId: BreedingOfferOptionId, readonly canonicalValueId: string }
export interface BreedingProjectedOfferV1 { readonly offerId: BreedingOfferId, readonly revision: number, readonly choiceKind: BreedingOfferOptionKind, readonly expiresAtCampaignMinute: number | null, readonly options: readonly BreedingProjectedOfferOptionV1[] }
export interface BreedingOwnerProjectParentSlotV1 { readonly parentIndex: 0 | 1, readonly relationship: 'owned' | 'participating', readonly pokemonSheetSlug: string | null, readonly sheetRevision: number | null, readonly consentStatus: 'active' | 'expired' | 'not-required' | 'revoked' | 'waiting' }
export interface BreedingOwnerProjectTimelineV1 { readonly initialRequiredCampaignMinutes: 240, readonly initialAccumulatedCampaignMinutes: number, readonly additionalRequiredCampaignMinutes: 240, readonly additionalAccumulatedCampaignMinutes: number, readonly checkReadyAtCampaignMinute: number | null, readonly readyToProduceAtCampaignMinute: number | null }
export interface BreedingOwnerProjectProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'owner'
  readonly aggregateKind: 'breeding-project'
  readonly projectId: BreedingProjectId
  readonly revision: number
  readonly status: BreedingProjectStatus
  readonly ownerTrainerSlug: string
  readonly breederTrainerSlug: string
  readonly parentSlots: readonly [BreedingOwnerProjectParentSlotV1, BreedingOwnerProjectParentSlotV1]
  readonly timeline: BreedingOwnerProjectTimelineV1
  readonly checkStatus: 'failure' | 'not-ready' | 'ready' | 'success'
  readonly offers: readonly BreedingProjectedOfferV1[]
  readonly availableActions: readonly BreedingOperationCommandKind[]
  readonly explanationReasonIds: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}
export interface BreedingOwnerEggOffspringV1 { readonly speciesId: BreedingSpeciesId, readonly natureId: string, readonly abilityId: BreedingAbilityId, readonly genderId: 'female' | 'genderless' | 'male', readonly startingLevel: number, readonly babyTemplateApplied: boolean }
export interface BreedingOwnerEggIncubationV1 { readonly targetCampaignMinutes: number, readonly accumulatedCampaignMinutes: number, readonly readyAtCampaignMinute: number | null, readonly paused: boolean }
export interface BreedingOwnerEggProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'owner'
  readonly aggregateKind: 'pokemon-egg'
  readonly eggId: PokemonEggId
  readonly revision: number
  readonly status: PokemonEggStatus
  readonly ownerTrainerSlug: string
  readonly sourceKind: PokemonEggSourceKind
  readonly offspring: BreedingOwnerEggOffspringV1
  readonly incubation: BreedingOwnerEggIncubationV1
  readonly specialStatus: 'normal' | 'not-rolled' | 'pending-adjudication' | 'resolved'
  readonly specialOutcomeId: string | null
  readonly inheritanceMoveIds: readonly BreedingMoveId[]
  readonly childSheetSlug: string | null
  readonly offers: readonly BreedingProjectedOfferV1[]
  readonly availableActions: readonly BreedingOperationCommandKind[]
  readonly explanationReasonIds: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}
export type BreedingOwnerProjectionV1 = BreedingOwnerProjectProjectionV1 | BreedingOwnerEggProjectionV1
export interface BreedingParticipantParentSummaryV1 { readonly pokemonSheetSlug: string, readonly sheetRevision: number, readonly displayName: string, readonly speciesId: BreedingSpeciesId }
export interface BreedingParticipantConsentSummaryV1 { readonly consentId: BreedingConsentId, readonly status: 'active' | 'expired' | 'revoked' | 'waiting', readonly scopes: readonly BreedingConsentScope[], readonly expiresAtCampaignMinute: number | null }
export interface BreedingParticipatingOwnerProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'participating-owner'
  readonly aggregateKind: 'breeding-project'
  readonly projectId: BreedingProjectId
  readonly revision: number
  readonly coarseStatus: BreedingCoarseStatus
  readonly breederTrainerSlug: string
  readonly ownParent: BreedingParticipantParentSummaryV1
  readonly consent: BreedingParticipantConsentSummaryV1
  readonly ownContributionMoveIds: readonly BreedingMoveId[]
  readonly otherParentPresent: true
  readonly availableActions: readonly ('grant-breeding-consent' | 'revoke-breeding-consent')[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}
export interface BreedingGmProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm'
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly document: BreedingProjectDocumentV1 | PokemonEggDocumentV1
  readonly rolls: readonly BreedingRollRecordV1[]
  readonly checks: readonly BreedingCheckRecordV1[]
  readonly offers: readonly BreedingOptionOfferRecordV1[]
  readonly consents: readonly BreedingConsentRecordV1[]
  readonly adjudications: readonly BreedingGmAdjudicationRecordV1[]
  readonly authorizationReceipts: readonly BreedingAuthorizationReceiptV1[]
  readonly readSets: readonly BreedingOperationReadSetV1[]
  readonly availableActions: readonly BreedingOperationCommandKind[]
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}
export interface BreedingDiagnosticTraceV1 { readonly stage: 'authorize' | 'load' | 'persist' | 'publish' | 'recover' | 'resolve', readonly status: 'failed' | 'ok' | 'pending', readonly definitionHashes: readonly string[] }
export interface BreedingDiagnosticProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'diagnostic'
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly aggregateIdentitySha256: string
  readonly revision: number
  readonly aggregateDefinitionSha256: string
  readonly rulesetDefinitionSha256: string
  readonly operationDefinitionHashes: readonly string[]
  readonly traces: readonly BreedingDiagnosticTraceV1[]
  readonly reasonIds: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly operatorAuthorizationDefinitionSha256: string
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}
export type BreedingPresentationProjectionV1 = BreedingPublicProjectionV1 | BreedingOwnerProjectionV1 | BreedingParticipatingOwnerProjectionV1 | BreedingGmProjectionV1 | BreedingDiagnosticProjectionV1

export type BreedingProjectionValidationCode = 'breeding.projection.invalid-document' | 'breeding.projection.unknown-field' | 'breeding.projection.invalid-id' | 'breeding.projection.invalid-invariant'
export class BreedingProjectionValidationError extends Error { readonly code: BreedingProjectionValidationCode; readonly path: string; constructor(code: BreedingProjectionValidationCode, path: string, message: string) { super(`${path}: ${message}`); this.name = 'BreedingProjectionValidationError'; this.code = code; this.path = path } }
type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const REASON = /^breeding\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const COARSE = new Set<string>(BREEDING_COARSE_STATUSES)
const ACTIONS = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)
const PROJECT_STATUSES = new Set<string>(BREEDING_PROJECT_STATUSES)
const EGG_STATUSES = new Set<string>(POKEMON_EGG_STATUSES)
const OPTION_KINDS = new Set<string>(BREEDING_OFFER_OPTION_KINDS)
const fail = (code: BreedingProjectionValidationCode, path: string, message: string): never => { throw new BreedingProjectionValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.projection.invalid-document', path, 'must be a plain object.'); const prototype = Object.getPrototypeOf(value); if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) return fail('breeding.projection.invalid-document', path, 'must be plain data without symbols.'); for (const key of Object.getOwnPropertyNames(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.projection.invalid-document', `${path}.${key}`, 'must be an enumerable data field.') } return value as UnknownRecord }
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => { const row = record(value, path); const allowed = new Set(fields); if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.projection.unknown-field', path, 'must contain exactly the declared fields.'); return row }
const array = (value: unknown, path: string, maximum: number): unknown[] => { if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length) return fail('breeding.projection.invalid-document', path, `must be an array of at most ${maximum} entries.`); for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.projection.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.') } if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.projection.unknown-field', path, 'cannot contain enriched fields.'); return value }
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum ? value as number : fail('breeding.projection.invalid-document', path, 'must be a bounded nonnegative safe integer.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.projection.invalid-document', path, 'must be a lowercase SHA-256 value.')
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('breeding.projection.invalid-id', path, 'must be a bounded stable identifier.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160 ? value : fail('breeding.projection.invalid-id', path, 'must be a canonical sheet slug.')
const text = (value: unknown, path: string, maximum = 160): string => typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fail('breeding.projection.invalid-document', path, 'must be bounded safe text.')
const freeze = <Value>(value: Value): Value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value) } return value }
const sortedUnique = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => { for (let i = 1; i < values.length; i += 1) if (values[i - 1]! >= values[i]!) fail('breeding.projection.invalid-invariant', path, 'must be unique in strict code-point order.'); return Object.freeze([...values]) }
const parseActions = (value: unknown, path: string): readonly BreedingOperationCommandKind[] => { const values = array(value, path, BREEDING_OPERATION_COMMAND_KINDS.length).map((entry, i) => typeof entry === 'string' && ACTIONS.has(entry) ? entry as BreedingOperationCommandKind : fail('breeding.projection.invalid-document', `${path}[${i}]`, 'must be a breeding action.')); return sortedUnique(values, path) }
const parseReasons = (value: unknown, path: string): readonly string[] => sortedUnique(array(value, path, 32).map((entry, i) => typeof entry === 'string' && REASON.test(entry) && entry.length <= 160 ? entry : fail('breeding.projection.invalid-id', `${path}[${i}]`, 'must be a typed breeding reason ID.')), path)
const parseHashes = (value: unknown, path: string, maximum = 256): readonly string[] => sortedUnique(array(value, path, maximum).map((entry, i) => hash(entry, `${path}[${i}]`)), path)
const parseCoarse = (value: unknown, path: string): BreedingCoarseStatus => typeof value === 'string' && COARSE.has(value) ? value as BreedingCoarseStatus : fail('breeding.projection.invalid-document', path, 'must be a coarse status.')
const parseOffer = (value: unknown, path: string): BreedingProjectedOfferV1 => { const row = exact(value, ['offerId', 'revision', 'choiceKind', 'expiresAtCampaignMinute', 'options'], path); if (typeof row.choiceKind !== 'string' || !OPTION_KINDS.has(row.choiceKind)) fail('breeding.projection.invalid-document', `${path}.choiceKind`, 'must be an option kind.'); const kind = row.choiceKind as BreedingOfferOptionKind; const options = array(row.options, `${path}.options`, 64).map((entry, i) => { const option = exact(entry, ['optionId', 'canonicalValueId'], `${path}.options[${i}]`); return freeze({ optionId: parseBreedingOfferOptionIdSyntax(option.optionId) ?? fail('breeding.projection.invalid-id', `${path}.options[${i}].optionId`, 'must be an option ID.'), canonicalValueId: identifier(option.canonicalValueId, `${path}.options[${i}].canonicalValueId`) }) }); if (!options.length) fail('breeding.projection.invalid-invariant', `${path}.options`, 'cannot be empty.'); sortedUnique(options.map(option => option.optionId), `${path}.options`); return freeze({ offerId: parseBreedingOfferIdSyntax(row.offerId) ?? fail('breeding.projection.invalid-id', `${path}.offerId`, 'must be an offer ID.'), revision: integer(row.revision, `${path}.revision`, 1), choiceKind: kind, expiresAtCampaignMinute: row.expiresAtCampaignMinute === null ? null : integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`), options: Object.freeze(options) }) }
const parseOffers = (value: unknown, path: string): readonly BreedingProjectedOfferV1[] => { const offers = array(value, path, 32).map((entry, i) => parseOffer(entry, `${path}[${i}]`)); sortedUnique(offers.map(offer => offer.offerId), path); return Object.freeze(offers) }
const common = (row: UnknownRecord, path: string) => ({ generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`), securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`), projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`) })
export const parseBreedingPublicProjectionV1 = (value: unknown, path = 'projection'): BreedingPublicProjectionV1 => { const row = exact(value, ['schemaVersion','audience','aggregateKind','aggregateIdentitySha256','coarseStatus','summaryId','progressBand','securityPolicyDefinitionSha256','projectionDefinitionSha256'], path); if (row.schemaVersion !== 1 || row.audience !== 'public' || (row.aggregateKind !== 'breeding-project' && row.aggregateKind !== 'pokemon-egg') || (row.summaryId !== 'breeding.public.project' && row.summaryId !== 'breeding.public.egg') || !['complete','early','late','middle','none'].includes(row.progressBand as string) || (row.aggregateKind === 'breeding-project') !== (row.summaryId === 'breeding.public.project')) fail('breeding.projection.invalid-invariant', path, 'must be a strict public projection.'); return freeze({ schemaVersion: 1, audience: 'public', aggregateKind: row.aggregateKind, aggregateIdentitySha256: hash(row.aggregateIdentitySha256, `${path}.aggregateIdentitySha256`), coarseStatus: parseCoarse(row.coarseStatus, `${path}.coarseStatus`), summaryId: row.summaryId, progressBand: row.progressBand, securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`), projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`) }) as BreedingPublicProjectionV1 }
const parseParentSlot = (value: unknown, index: number, path: string): BreedingOwnerProjectParentSlotV1 => { const row = exact(value, ['parentIndex','relationship','pokemonSheetSlug','sheetRevision','consentStatus'], path); if (row.parentIndex !== index || (row.relationship !== 'owned' && row.relationship !== 'participating') || !['active','expired','not-required','revoked','waiting'].includes(row.consentStatus as string)) fail('breeding.projection.invalid-invariant', path, 'must be a canonical parent slot.'); const sheetSlug = row.pokemonSheetSlug === null ? null : slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`); const revision = row.sheetRevision === null ? null : integer(row.sheetRevision, `${path}.sheetRevision`); if ((row.relationship === 'owned') !== (sheetSlug !== null && revision !== null) || (row.relationship === 'owned') !== (row.consentStatus === 'not-required')) fail('breeding.projection.invalid-invariant', path, 'owned slot alone exposes its sheet and needs no consent.'); return freeze({ parentIndex: index as 0|1, relationship: row.relationship, pokemonSheetSlug: sheetSlug, sheetRevision: revision, consentStatus: row.consentStatus }) as BreedingOwnerProjectParentSlotV1 }
export const parseBreedingOwnerProjectProjectionV1 = (value: unknown, path = 'projection'): BreedingOwnerProjectProjectionV1 => { const row = exact(value, ['schemaVersion','audience','aggregateKind','projectId','revision','status','ownerTrainerSlug','breederTrainerSlug','parentSlots','timeline','checkStatus','offers','availableActions','explanationReasonIds','generatedAtCampaignMinute','securityPolicyDefinitionSha256','projectionDefinitionSha256'], path); if (row.schemaVersion !== 1 || row.audience !== 'owner' || row.aggregateKind !== 'breeding-project' || typeof row.status !== 'string' || !PROJECT_STATUSES.has(row.status) || !['failure','not-ready','ready','success'].includes(row.checkStatus as string)) fail('breeding.projection.invalid-document', path, 'must be an owner project projection.'); const slots = array(row.parentSlots, `${path}.parentSlots`, 2); if (slots.length !== 2) fail('breeding.projection.invalid-invariant', `${path}.parentSlots`, 'must have two slots.'); const timeline = exact(row.timeline, ['initialRequiredCampaignMinutes','initialAccumulatedCampaignMinutes','additionalRequiredCampaignMinutes','additionalAccumulatedCampaignMinutes','checkReadyAtCampaignMinute','readyToProduceAtCampaignMinute'], `${path}.timeline`); if (timeline.initialRequiredCampaignMinutes !== 240 || timeline.additionalRequiredCampaignMinutes !== 240) fail('breeding.projection.invalid-invariant', `${path}.timeline`, 'must retain canonical durations.'); return freeze({ schemaVersion:1,audience:'owner',aggregateKind:'breeding-project',projectId:parseBreedingProjectIdSyntax(row.projectId) ?? fail('breeding.projection.invalid-id',`${path}.projectId`,'must be a project ID.'),revision:integer(row.revision,`${path}.revision`),status:row.status as BreedingProjectStatus,ownerTrainerSlug:slug(row.ownerTrainerSlug,`${path}.ownerTrainerSlug`),breederTrainerSlug:slug(row.breederTrainerSlug,`${path}.breederTrainerSlug`),parentSlots:Object.freeze([parseParentSlot(slots[0],0,`${path}.parentSlots[0]`),parseParentSlot(slots[1],1,`${path}.parentSlots[1]`)]),timeline:freeze({initialRequiredCampaignMinutes:240,initialAccumulatedCampaignMinutes:integer(timeline.initialAccumulatedCampaignMinutes,`${path}.timeline.initialAccumulatedCampaignMinutes`,240),additionalRequiredCampaignMinutes:240,additionalAccumulatedCampaignMinutes:integer(timeline.additionalAccumulatedCampaignMinutes,`${path}.timeline.additionalAccumulatedCampaignMinutes`,240),checkReadyAtCampaignMinute:timeline.checkReadyAtCampaignMinute===null?null:integer(timeline.checkReadyAtCampaignMinute,`${path}.timeline.checkReadyAtCampaignMinute`),readyToProduceAtCampaignMinute:timeline.readyToProduceAtCampaignMinute===null?null:integer(timeline.readyToProduceAtCampaignMinute,`${path}.timeline.readyToProduceAtCampaignMinute`)}),checkStatus:row.checkStatus,offers:parseOffers(row.offers,`${path}.offers`),availableActions:parseActions(row.availableActions,`${path}.availableActions`),explanationReasonIds:parseReasons(row.explanationReasonIds,`${path}.explanationReasonIds`),...common(row,path)}) as BreedingOwnerProjectProjectionV1 }
export const parseBreedingOwnerEggProjectionV1 = (value: unknown, path = 'projection'): BreedingOwnerEggProjectionV1 => { const row=exact(value,['schemaVersion','audience','aggregateKind','eggId','revision','status','ownerTrainerSlug','sourceKind','offspring','incubation','specialStatus','specialOutcomeId','inheritanceMoveIds','childSheetSlug','offers','availableActions','explanationReasonIds','generatedAtCampaignMinute','securityPolicyDefinitionSha256','projectionDefinitionSha256'],path); if(row.schemaVersion!==1||row.audience!=='owner'||row.aggregateKind!=='pokemon-egg'||typeof row.status!=='string'||!EGG_STATUSES.has(row.status)||!['breeding','fossil','gm','feature-artificial'].includes(row.sourceKind as string)||!['normal','not-rolled','pending-adjudication','resolved'].includes(row.specialStatus as string))fail('breeding.projection.invalid-document',path,'must be an owner Egg projection.'); const offspring=exact(row.offspring,['speciesId','natureId','abilityId','genderId','startingLevel','babyTemplateApplied'],`${path}.offspring`); if(!['female','genderless','male'].includes(offspring.genderId as string)||typeof offspring.babyTemplateApplied!=='boolean')fail('breeding.projection.invalid-document',`${path}.offspring`,'must contain resolved owner-safe offspring facts.'); const startingLevel=integer(offspring.startingLevel,`${path}.offspring.startingLevel`,100);if(startingLevel<1)fail('breeding.projection.invalid-invariant',`${path}.offspring.startingLevel`,'must be from 1 through 100.');const specialOutcome=row.specialOutcomeId===null?null:identifier(row.specialOutcomeId,`${path}.specialOutcomeId`);if((row.specialStatus==='resolved')!==(specialOutcome!==null))fail('breeding.projection.invalid-invariant',`${path}.specialOutcomeId`,'must exist exactly for a resolved special result.'); const incubation=exact(row.incubation,['targetCampaignMinutes','accumulatedCampaignMinutes','readyAtCampaignMinute','paused'],`${path}.incubation`); if(typeof incubation.paused!=='boolean')fail('breeding.projection.invalid-document',`${path}.incubation.paused`,'must be boolean.'); const target=integer(incubation.targetCampaignMinutes,`${path}.incubation.targetCampaignMinutes`); const accumulated=integer(incubation.accumulatedCampaignMinutes,`${path}.incubation.accumulatedCampaignMinutes`,target); const moves=array(row.inheritanceMoveIds,`${path}.inheritanceMoveIds`,256).map((entry,i)=>parseBreedingMoveIdSyntax(entry)??fail('breeding.projection.invalid-id',`${path}.inheritanceMoveIds[${i}]`,'must be a Move ID.')); sortedUnique(moves,`${path}.inheritanceMoveIds`); return freeze({schemaVersion:1,audience:'owner',aggregateKind:'pokemon-egg',eggId:parsePokemonEggIdSyntax(row.eggId)??fail('breeding.projection.invalid-id',`${path}.eggId`,'must be an Egg ID.'),revision:integer(row.revision,`${path}.revision`),status:row.status as PokemonEggStatus,ownerTrainerSlug:slug(row.ownerTrainerSlug,`${path}.ownerTrainerSlug`),sourceKind:row.sourceKind as PokemonEggSourceKind,offspring:freeze({speciesId:parseBreedingSpeciesIdSyntax(offspring.speciesId)??fail('breeding.projection.invalid-id',`${path}.offspring.speciesId`,'must be Species ID.'),natureId:identifier(offspring.natureId,`${path}.offspring.natureId`),abilityId:parseBreedingAbilityIdSyntax(offspring.abilityId)??fail('breeding.projection.invalid-id',`${path}.offspring.abilityId`,'must be Ability ID.'),genderId:offspring.genderId,startingLevel,babyTemplateApplied:offspring.babyTemplateApplied}),incubation:freeze({targetCampaignMinutes:target,accumulatedCampaignMinutes:accumulated,readyAtCampaignMinute:incubation.readyAtCampaignMinute===null?null:integer(incubation.readyAtCampaignMinute,`${path}.incubation.readyAtCampaignMinute`),paused:incubation.paused}),specialStatus:row.specialStatus,specialOutcomeId:specialOutcome,inheritanceMoveIds:Object.freeze(moves),childSheetSlug:row.childSheetSlug===null?null:slug(row.childSheetSlug,`${path}.childSheetSlug`),offers:parseOffers(row.offers,`${path}.offers`),availableActions:parseActions(row.availableActions,`${path}.availableActions`),explanationReasonIds:parseReasons(row.explanationReasonIds,`${path}.explanationReasonIds`),...common(row,path)}) as BreedingOwnerEggProjectionV1 }
export const parseBreedingParticipatingOwnerProjectionV1 = (value: unknown,path='projection'):BreedingParticipatingOwnerProjectionV1=>{const row=exact(value,['schemaVersion','audience','aggregateKind','projectId','revision','coarseStatus','breederTrainerSlug','ownParent','consent','ownContributionMoveIds','otherParentPresent','availableActions','generatedAtCampaignMinute','securityPolicyDefinitionSha256','projectionDefinitionSha256'],path);if(row.schemaVersion!==1||row.audience!=='participating-owner'||row.aggregateKind!=='breeding-project'||row.otherParentPresent!==true)fail('breeding.projection.invalid-document',path,'must be a participating-owner projection.');const own=exact(row.ownParent,['pokemonSheetSlug','sheetRevision','displayName','speciesId'],`${path}.ownParent`);const consent=exact(row.consent,['consentId','status','scopes','expiresAtCampaignMinute'],`${path}.consent`);if(!['active','expired','revoked','waiting'].includes(consent.status as string))fail('breeding.projection.invalid-document',`${path}.consent.status`,'must be safe consent status.');const scopes=array(consent.scopes,`${path}.consent.scopes`,3).map((entry,i)=>typeof entry==='string'&&(BREEDING_CONSENT_SCOPES as readonly string[]).includes(entry)?entry as BreedingConsentScope:fail('breeding.projection.invalid-document',`${path}.consent.scopes[${i}]`,'must be consent scope.'));sortedUnique(scopes,`${path}.consent.scopes`);if(scopes.length!==BREEDING_CONSENT_SCOPES.length||BREEDING_CONSENT_SCOPES.some(scope=>!scopes.includes(scope)))fail('breeding.projection.invalid-invariant',`${path}.consent.scopes`,'must request all positive participant scopes.');const moves=array(row.ownContributionMoveIds,`${path}.ownContributionMoveIds`,256).map((entry,i)=>parseBreedingMoveIdSyntax(entry)??fail('breeding.projection.invalid-id',`${path}.ownContributionMoveIds[${i}]`,'must be Move ID.'));sortedUnique(moves,`${path}.ownContributionMoveIds`);const actions=array(row.availableActions,`${path}.availableActions`,2).map((entry,i)=>entry==='grant-breeding-consent'||entry==='revoke-breeding-consent'?entry:fail('breeding.projection.invalid-document',`${path}.availableActions[${i}]`,'must be own consent action.'));sortedUnique(actions,`${path}.availableActions`);return freeze({schemaVersion:1,audience:'participating-owner',aggregateKind:'breeding-project',projectId:parseBreedingProjectIdSyntax(row.projectId)??fail('breeding.projection.invalid-id',`${path}.projectId`,'must be project ID.'),revision:integer(row.revision,`${path}.revision`),coarseStatus:parseCoarse(row.coarseStatus,`${path}.coarseStatus`),breederTrainerSlug:slug(row.breederTrainerSlug,`${path}.breederTrainerSlug`),ownParent:freeze({pokemonSheetSlug:slug(own.pokemonSheetSlug,`${path}.ownParent.pokemonSheetSlug`),sheetRevision:integer(own.sheetRevision,`${path}.ownParent.sheetRevision`),displayName:text(own.displayName,`${path}.ownParent.displayName`,120),speciesId:parseBreedingSpeciesIdSyntax(own.speciesId)??fail('breeding.projection.invalid-id',`${path}.ownParent.speciesId`,'must be Species ID.')}),consent:freeze({consentId:parseBreedingConsentIdSyntax(consent.consentId)??fail('breeding.projection.invalid-id',`${path}.consent.consentId`,'must be consent ID.'),status:consent.status,scopes:Object.freeze(scopes),expiresAtCampaignMinute:consent.expiresAtCampaignMinute===null?null:integer(consent.expiresAtCampaignMinute,`${path}.consent.expiresAtCampaignMinute`)}),ownContributionMoveIds:Object.freeze(moves),otherParentPresent:true,availableActions:Object.freeze(actions),...common(row,path)}) as BreedingParticipatingOwnerProjectionV1}
const parseList=<Value>(value:unknown,path:string,maximum:number,parser:(value:unknown,path:string)=>Value):readonly Value[]=>Object.freeze(array(value,path,maximum).map((entry,i)=>parser(entry,`${path}[${i}]`)))
export const parseBreedingGmProjectionV1=(value:unknown,path='projection'):BreedingGmProjectionV1=>{const row=exact(value,['schemaVersion','audience','aggregateKind','document','rolls','checks','offers','consents','adjudications','authorizationReceipts','readSets','availableActions','generatedAtCampaignMinute','securityPolicyDefinitionSha256','projectionDefinitionSha256'],path);if(row.schemaVersion!==1||row.audience!=='gm'||(row.aggregateKind!=='breeding-project'&&row.aggregateKind!=='pokemon-egg'))fail('breeding.projection.invalid-document',path,'must be a GM projection.');const document=row.aggregateKind==='breeding-project'?parseBreedingProjectDocumentV1(row.document,`${path}.document`):parsePokemonEggDocumentV1(row.document,`${path}.document`);return freeze({schemaVersion:1,audience:'gm',aggregateKind:row.aggregateKind,document,rolls:parseList(row.rolls,`${path}.rolls`,32,parseBreedingRollRecordV1),checks:parseList(row.checks,`${path}.checks`,4,parseBreedingCheckRecordV1),offers:parseList(row.offers,`${path}.offers`,64,parseBreedingOptionOfferRecordV1),consents:parseList(row.consents,`${path}.consents`,2,parseBreedingConsentRecordV1),adjudications:parseList(row.adjudications,`${path}.adjudications`,64,parseBreedingGmAdjudicationRecordV1),authorizationReceipts:parseList(row.authorizationReceipts,`${path}.authorizationReceipts`,128,parseBreedingAuthorizationReceiptV1),readSets:parseList(row.readSets,`${path}.readSets`,128,parseBreedingOperationReadSetV1),availableActions:parseActions(row.availableActions,`${path}.availableActions`),...common(row,path)}) as BreedingGmProjectionV1}
export const parseBreedingDiagnosticProjectionV1=(value:unknown,path='projection'):BreedingDiagnosticProjectionV1=>{const row=exact(value,['schemaVersion','audience','aggregateKind','aggregateIdentitySha256','revision','aggregateDefinitionSha256','rulesetDefinitionSha256','operationDefinitionHashes','traces','reasonIds','generatedAtCampaignMinute','operatorAuthorizationDefinitionSha256','securityPolicyDefinitionSha256','projectionDefinitionSha256'],path);if(row.schemaVersion!==1||row.audience!=='diagnostic'||(row.aggregateKind!=='breeding-project'&&row.aggregateKind!=='pokemon-egg'))fail('breeding.projection.invalid-document',path,'must be a diagnostic projection.');const traces=array(row.traces,`${path}.traces`,6).map((entry,i)=>{const trace=exact(entry,['stage','status','definitionHashes'],`${path}.traces[${i}]`);if(!['authorize','load','persist','publish','recover','resolve'].includes(trace.stage as string)||!['failed','ok','pending'].includes(trace.status as string))fail('breeding.projection.invalid-document',`${path}.traces[${i}]`,'must be a closed diagnostic trace.');return freeze({stage:trace.stage,status:trace.status,definitionHashes:parseHashes(trace.definitionHashes,`${path}.traces[${i}].definitionHashes`,32)}) as BreedingDiagnosticTraceV1});sortedUnique(traces.map(trace=>trace.stage),`${path}.traces`);return freeze({schemaVersion:1,audience:'diagnostic',aggregateKind:row.aggregateKind,aggregateIdentitySha256:hash(row.aggregateIdentitySha256,`${path}.aggregateIdentitySha256`),revision:integer(row.revision,`${path}.revision`),aggregateDefinitionSha256:hash(row.aggregateDefinitionSha256,`${path}.aggregateDefinitionSha256`),rulesetDefinitionSha256:hash(row.rulesetDefinitionSha256,`${path}.rulesetDefinitionSha256`),operationDefinitionHashes:parseHashes(row.operationDefinitionHashes,`${path}.operationDefinitionHashes`),traces:Object.freeze(traces),reasonIds:parseReasons(row.reasonIds,`${path}.reasonIds`),operatorAuthorizationDefinitionSha256:hash(row.operatorAuthorizationDefinitionSha256,`${path}.operatorAuthorizationDefinitionSha256`),...common(row,path)}) as BreedingDiagnosticProjectionV1}
export const parseBreedingPresentationProjectionV1=(value:unknown,path='projection'):BreedingPresentationProjectionV1=>{const row=record(value,path);if(row.audience==='public')return parseBreedingPublicProjectionV1(row,path);if(row.audience==='owner')return row.aggregateKind==='breeding-project'?parseBreedingOwnerProjectProjectionV1(row,path):parseBreedingOwnerEggProjectionV1(row,path);if(row.audience==='participating-owner')return parseBreedingParticipatingOwnerProjectionV1(row,path);if(row.audience==='gm')return parseBreedingGmProjectionV1(row,path);if(row.audience==='diagnostic')return parseBreedingDiagnosticProjectionV1(row,path);return fail('breeding.projection.invalid-document',`${path}.audience`,'must be a closed audience.')}
