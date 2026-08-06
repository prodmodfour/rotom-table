import { createHash } from 'node:crypto'
import sourceAdjudicationsJson from '../../../data/breeding-automation/source-adjudications.json'
import pokedexJson from '../../../data/reference/pokedex.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, type StrictJsonObject } from '#shared/automation/strictJson'
import {
  parsePokemonEggGmSourceProvenanceV1,
  type PokemonEggDocumentV1,
  type PokemonEggGmProvenanceKind,
  type PokemonEggGmSourceProvenanceV1,
  type PokemonEggTypedGmSourceV1,
} from '#shared/breeding/egg'
import {
  parseBreedingGmEggCreationProjectionV1,
  parseBreedingGmEggImportEvidenceV1,
  type BreedingGmEggCreationProjectionV1,
  type BreedingGmEggImportEvidenceV1,
} from '#shared/breeding/gmEgg'
import {
  parseBreedingAbilityIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingOfferId,
  type BreedingOfferOptionId,
} from '#shared/breeding/ids'
import type { BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import type { PokedexRecord } from '~/types/pokemon'
import { createBreedingOptionOfferRecordV1, createBreedingOptionOfferRevisionV1, parseAuthoritativeBreedingOptionOfferRecordV1, parseAuthoritativeBreedingRollRecordV1 } from './ledgers'
import { createBreedingOperationCommandHash } from './operations'
import { parseBreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import { canonicalBreedingAbilityIdentity, canonicalBreedingMoveIdentity, canonicalBreedingSpeciesIdentity, BREEDING_CANONICAL_ID_DEFINITION_SHA256 } from './canonicalIds'
import { breedingNature, BREEDING_NATURE_DEFINITION_SHA256 } from './natures'
import { compiledBreedingSpeciesSpec, COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from './registry'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { resolveBreedingBabyTemplate, resolveBreedingHatchDuration, resolveBreedingHatchStartingLevel, BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256 } from './eggRuleHelpers'
import {
  BREEDING_BABY_TEMPLATE_POLICY_DEFINITION,
  BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  createBreedingMarsupialProviderTraitV1,
  resolveBreedingMarsupialBabyTemplateV1,
} from './babyTemplate'

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const SOURCE_ADJUDICATIONS_SHA256 = sha256(sourceAdjudicationsJson)
export const BREEDING_GM_EGG_POLICY_ID = 'breeding-gm-egg-v1' as const
export const BREEDING_GM_EGG_SOURCE_PROVIDER_ID = 'breeding.gm-egg-source.v1' as const
export const BREEDING_GM_EGG_OPTIONS_PROVIDER_ID = 'breeding.gm-egg-options.v1' as const
export const BREEDING_GM_EGG_SPECIES_PROVIDER_ID = 'breeding.gm-egg-species.v1' as const
export const BREEDING_GM_EGG_REASON_BY_PROVENANCE = Object.freeze({
  'gm-authored': 'breeding.egg-source.gm-authored',
  mysterious: 'breeding.egg-source.mysterious',
  'campaign-gift': 'breeding.egg-source.campaign-gift',
  imported: 'breeding.egg-source.imported',
} as const satisfies Readonly<Record<PokemonEggGmProvenanceKind, string>>)
export const BREEDING_GM_EGG_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: BREEDING_GM_EGG_POLICY_ID,
  sourceAdjudicationId: 'BR-SRC-020' as const,
  sourceAdjudicationsSha256: SOURCE_ADJUDICATIONS_SHA256,
  sourceKind: 'gm' as const,
  provenanceKinds: Object.freeze(['gm-authored','mysterious','campaign-gift','imported'] as const),
  legacyGmSource: 'read-only-never-new-authority' as const,
  aggregate: 'shared-pokemon-egg-document-v1' as const,
  hatchPipeline: 'shared-incubation-special-child-lineage-and-reward' as const,
  startingLevel: 1 as const,
  parentSnapshots: 0 as const,
  breederSnapshot: null,
  inheritance: Object.freeze({ default: 'none', optional: 'gm-bounded-canonical-list', maximum: 9 }),
  imported: 'requires-current-reviewed-source-record-and-import-receipt-evidence' as const,
  gift: 'campaign-gift-creation-or-BR-064-transfer-with-source-preservation' as const,
  babyTemplate: 'campaign-option-or-forced-marsupial' as const,
  clientAuthority: 'none' as const,
})
export const BREEDING_GM_EGG_POLICY_DEFINITION_SHA256 = sha256(BREEDING_GM_EGG_POLICY_DEFINITION)

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
export type BreedingGmEggAuthorityErrorCode =
  | 'breeding.gm-egg.invalid-request'
  | 'breeding.gm-egg.hash-mismatch'
  | 'breeding.gm-egg.stale-authority'
  | 'breeding.gm-egg.provider-unavailable'
  | 'breeding.gm-egg.contract-drift'
  | 'breeding.gm-egg.invalid-choice'
  | 'breeding.gm-egg.invalid-roll-set'
  | 'breeding.gm-egg.wrong-command'
export class BreedingGmEggAuthorityError extends Error {
  readonly code: BreedingGmEggAuthorityErrorCode
  constructor(code: BreedingGmEggAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingGmEggAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingGmEggAuthorityErrorCode, message: string): never => { throw new BreedingGmEggAuthorityError(code, message) }
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.gm-egg.invalid-request', `${label} must be one plain data object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.gm-egg.invalid-request', `${label} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.gm-egg.invalid-request', `${label}.${field} must be an enumerable data field.`) }
  return row
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.gm-egg.invalid-request', `${label} must be one dense plain array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.gm-egg.invalid-request', `${label}[${index}] must be an enumerable data entry.`) }
  return value
}
const stringChoices = (value: unknown, maximum: number, label: string): readonly string[] => Object.freeze(strictArray(value, maximum, label).map((entry, index) => typeof entry === 'string' && ID.test(entry) ? entry : fail('breeding.gm-egg.invalid-choice', `${label}[${index}] must be one bounded string identifier.`)))
const minuteChoices = (value: unknown, maximum: number, label: string): readonly string[] => Object.freeze(strictArray(value, maximum, label).map((entry, index) => Number.isSafeInteger(entry) && Number(entry) >= 1 && Number(entry) <= 99_999_999 ? `campaign-minutes:${String(entry)}` : fail('breeding.gm-egg.invalid-choice', `${label}[${index}] must be one bounded positive campaign-minute integer.`)))
const minute = (value: unknown, label: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail('breeding.gm-egg.invalid-request', `${label} must be a nonnegative campaign minute.`)
const strictDocument = (value: unknown, label: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, label, {
    limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
    rootLabel: label, valueLabel: label,
    failNotJson: (_path, detail) => fail('breeding.gm-egg.invalid-request', `${label} ${detail}`),
    failLimit: (_path, detail) => fail('breeding.gm-egg.invalid-request', detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return fail('breeding.gm-egg.invalid-request', `${label} must be one strict JSON object.`)
  return cloned
}
const storedTrainer = (value: unknown, label: string): { readonly slug: string, readonly revision: number, readonly document: StrictJsonObject } => {
  const row = exact(value, ['slug','revision','document'], label)
  if (typeof row.slug !== 'string' || !ID.test(row.slug) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || Number(row.revision) > 2_147_483_647) return fail('breeding.gm-egg.invalid-request', `${label} identity and revision must be bounded values.`)
  const document = strictDocument(row.document, `${label}.document`)
  if (document.slug !== row.slug || document.revision !== row.revision) return fail('breeding.gm-egg.stale-authority', `${label} storage identity and embedded document revision must agree exactly.`)
  return Object.freeze({ slug: row.slug, revision: Number(row.revision), document })
}
const sourceAdjudication = (sourceAdjudicationsJson.entries as readonly { readonly id: string, readonly status: string }[]).find(entry => entry.id === 'BR-SRC-020')
const validateStaticBoundary = (): void => {
  if (SOURCE_ADJUDICATIONS_SHA256 !== sha256(sourceAdjudicationsJson) || !sourceAdjudication || sourceAdjudication.status !== 'accepted') return fail('breeding.gm-egg.contract-drift', 'The reviewed non-breeding Egg source adjudication drifted.')
}

export const parseAuthoritativeBreedingGmEggImportEvidenceV1 = (value: unknown, path = 'gmEggImportEvidence'): BreedingGmEggImportEvidenceV1 => {
  const parsed = parseBreedingGmEggImportEvidenceV1(value, path)
  const { definitionSha256: _hash, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.gm-egg.hash-mismatch', `${path} definition hash is not authoritative.`)
  return parsed
}
export const createBreedingGmEggImportEvidenceV1 = (inputValue: {
  readonly sourceSystemId: unknown
  readonly sourceRecordId: unknown
  readonly sourceRecordDefinitionSha256: unknown
  readonly importReceiptDefinitionSha256: unknown
  readonly reviewedAtCampaignMinute: unknown
}): BreedingGmEggImportEvidenceV1 => {
  const input = exact(inputValue, ['sourceSystemId','sourceRecordId','sourceRecordDefinitionSha256','importReceiptDefinitionSha256','reviewedAtCampaignMinute'], 'gmEggImportEvidenceInput')
  if (typeof input.sourceSystemId !== 'string' || !ID.test(input.sourceSystemId) || typeof input.sourceRecordId !== 'string' || !ID.test(input.sourceRecordId)
    || typeof input.sourceRecordDefinitionSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(input.sourceRecordDefinitionSha256)
    || typeof input.importReceiptDefinitionSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(input.importReceiptDefinitionSha256)) return fail('breeding.gm-egg.invalid-request', 'Imported Egg evidence requires bounded source identities and exact lowercase hashes.')
  const definition = Object.freeze({ schemaVersion: 1 as const, sourceSystemId: input.sourceSystemId, sourceRecordId: input.sourceRecordId, sourceRecordDefinitionSha256: input.sourceRecordDefinitionSha256, importReceiptDefinitionSha256: input.importReceiptDefinitionSha256, reviewedAtCampaignMinute: minute(input.reviewedAtCampaignMinute, 'gmEggImportEvidenceInput.reviewedAtCampaignMinute') })
  return parseAuthoritativeBreedingGmEggImportEvidenceV1({ ...definition, definitionSha256: sha256(definition) })
}
export const parseAuthoritativePokemonEggGmSourceProvenanceV1 = (value: unknown, path = 'gmEggProvenance'): PokemonEggGmSourceProvenanceV1 => {
  const parsed = parsePokemonEggGmSourceProvenanceV1(value, path)
  const { definitionSha256: _hash, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.gm-egg.hash-mismatch', `${path} definition hash is not authoritative.`)
  return parsed
}
export const createBreedingGmEggSourceProvenanceV1 = (inputValue: {
  readonly eggId: unknown
  readonly provenanceKind: unknown
  readonly provenanceId: unknown
  readonly ownerTrainerSheet: unknown
  readonly createdByGmProfileId: unknown
  readonly importEvidence: unknown | null
  readonly capturedAtCampaignMinute: unknown
}): PokemonEggGmSourceProvenanceV1 => {
  validateStaticBoundary()
  const input = exact(inputValue, ['eggId','provenanceKind','provenanceId','ownerTrainerSheet','createdByGmProfileId','importEvidence','capturedAtCampaignMinute'], 'gmEggSourceInput')
  const trainer = storedTrainer(input.ownerTrainerSheet, 'gmEggSourceInput.ownerTrainerSheet')
  if (typeof input.eggId !== 'string' || !/^pokemon-egg:v1:[0-9a-f]{32}$/u.test(input.eggId)
    || typeof input.provenanceKind !== 'string' || !Object.hasOwn(BREEDING_GM_EGG_REASON_BY_PROVENANCE, input.provenanceKind)
    || typeof input.provenanceId !== 'string' || !ID.test(input.provenanceId)
    || typeof input.createdByGmProfileId !== 'string' || !ID.test(input.createdByGmProfileId)) return fail('breeding.gm-egg.invalid-request', 'GM Egg source must bind one future Egg, closed provenance kind, stable provenance ID, and GM profile identity.')
  const provenanceKind = input.provenanceKind as PokemonEggGmProvenanceKind
  const imported = provenanceKind === 'imported'
  const importEvidence = input.importEvidence === null ? null : parseAuthoritativeBreedingGmEggImportEvidenceV1(input.importEvidence)
  const captured = minute(input.capturedAtCampaignMinute, 'gmEggSourceInput.capturedAtCampaignMinute')
  if (imported !== (importEvidence !== null) || (importEvidence && importEvidence.reviewedAtCampaignMinute > captured)) return fail('breeding.gm-egg.stale-authority', 'Imported provenance alone requires current reviewed import evidence no later than the creation checkpoint.')
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    provenanceKind,
    provenanceId: input.provenanceId,
    eggId: input.eggId,
    ownerTrainerSlug: trainer.slug,
    ownerTrainerRevision: trainer.revision,
    ownerTrainerDefinitionSha256: sha256(trainer.document),
    createdByGmProfileId: input.createdByGmProfileId,
    sourceSystemId: importEvidence?.sourceSystemId ?? null,
    sourceRecordId: importEvidence?.sourceRecordId ?? null,
    sourceRecordDefinitionSha256: importEvidence?.sourceRecordDefinitionSha256 ?? null,
    importReceiptDefinitionSha256: importEvidence?.importReceiptDefinitionSha256 ?? null,
    importEvidenceDefinitionSha256: importEvidence?.definitionSha256 ?? null,
    capturedAtCampaignMinute: captured,
  })
  return parseAuthoritativePokemonEggGmSourceProvenanceV1({ ...definition, definitionSha256: sha256(definition) })
}
export const breedingGmEggSourceV1 = (provenanceValue: unknown): PokemonEggTypedGmSourceV1 => {
  const provenance = parseAuthoritativePokemonEggGmSourceProvenanceV1(provenanceValue)
  return Object.freeze({ kind: 'gm', reasonId: BREEDING_GM_EGG_REASON_BY_PROVENANCE[provenance.provenanceKind], provenance, evidenceDefinitionSha256: provenance.definitionSha256 })
}

export type BreedingGmEggOfferSlot = 'species'|'nature'|'primary-ability'|'gender'|'inheritance-move'|'base-hatch-duration'|'hatch-duration'|'baby-template'
const OFFER_KIND_BY_SLOT = Object.freeze({ species:'species', nature:'nature', 'primary-ability':'ability', gender:'gender', 'inheritance-move':'move', 'base-hatch-duration':'hatch-duration', 'hatch-duration':'hatch-duration', 'baby-template':'baby-template' } as const)
export const breedingGmEggOfferId = (operationId: string, slot: BreedingGmEggOfferSlot): BreedingOfferId => `breeding-offer:v1:${sha256(`breeding-gm-egg-offer-v1\0${operationId}\0${slot}`).slice(0,32)}` as BreedingOfferId
export const breedingGmEggOfferOptionId = (operationId: string, slot: BreedingGmEggOfferSlot, canonicalValueId: string): BreedingOfferOptionId => `option:v1:${sha256(`breeding-gm-egg-option-v1\0${operationId}\0${slot}\0${canonicalValueId}`).slice(0,32)}` as BreedingOfferOptionId
const slotEvidenceId = (slot: BreedingGmEggOfferSlot): string => `gm-egg-choice:${slot}`
const optionValueHash = (slot: BreedingGmEggOfferSlot, canonicalValueId: string, sourceHash: string, campaignOptionSnapshotDefinitionSha256: string): string => sha256({ schemaVersion:1, policyDefinitionSha256:BREEDING_GM_EGG_POLICY_DEFINITION_SHA256, sourceDefinitionSha256:sourceHash, slot, canonicalValueId, ...(slot === 'baby-template' ? { babyTemplatePolicyDefinitionSha256: BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256, campaignOptionSnapshotDefinitionSha256 } : {}) })
export const createBreedingGmEggOptionOffersV1 = (inputValue: {
  readonly command: unknown
  readonly trainerSheetRevision: unknown
  readonly campaignOptionSnapshot: unknown
  readonly choices: unknown
  readonly issuedAtCampaignMinute: unknown
  readonly expiresAtCampaignMinute: unknown
}): readonly BreedingOptionOfferRecordV1[] => {
  validateStaticBoundary()
  const input = exact(inputValue, ['command','trainerSheetRevision','campaignOptionSnapshot','choices','issuedAtCampaignMinute','expiresAtCampaignMinute'], 'gmEggOfferInput')
  const command = parseBreedingOperationCommandV1(input.command)
  const campaignOptions = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  if (command.commandKind !== 'create-source-egg' || command.payload.source.kind !== 'gm' || !('provenance' in command.payload.source)) return fail('breeding.gm-egg.wrong-command', 'GM Egg offers require one typed GM create-source-egg command.')
  const provenance = parseAuthoritativePokemonEggGmSourceProvenanceV1(command.payload.source.provenance)
  if (command.payload.source.evidenceDefinitionSha256 !== provenance.definitionSha256 || command.payload.eggId !== provenance.eggId || command.payload.ownerTrainerSlug !== provenance.ownerTrainerSlug) return fail('breeding.gm-egg.stale-authority', 'GM Egg offer command and provenance must agree exactly.')
  if (!Number.isSafeInteger(input.trainerSheetRevision) || Number(input.trainerSheetRevision) !== provenance.ownerTrainerRevision) return fail('breeding.gm-egg.stale-authority', 'GM Egg offer target must use the exact owner Trainer revision.')
  if (!input.choices || typeof input.choices !== 'object' || Array.isArray(input.choices)
    || (Object.getPrototypeOf(input.choices) !== Object.prototype && Object.getPrototypeOf(input.choices) !== null)
    || Object.getOwnPropertySymbols(input.choices).length > 0) return fail('breeding.gm-egg.invalid-request', 'gmEggOfferInput.choices must be one plain object.')
  const choiceKeys = Object.getOwnPropertyNames(input.choices)
  const requiredChoiceKeys = ['species','nature','primaryAbility','gender','inheritanceMoves','baseHatchDuration','hatchDuration'] as const
  const allowedChoiceKeys = new Set([...requiredChoiceKeys, 'babyTemplate'])
  if (requiredChoiceKeys.some(key => !Object.hasOwn(input.choices as object, key)) || choiceKeys.some(key => !allowedChoiceKeys.has(key))) return fail('breeding.gm-egg.invalid-request', 'gmEggOfferInput.choices contains missing or unknown fields.')
  for (const key of choiceKeys) { const descriptor = Object.getOwnPropertyDescriptor(input.choices, key); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.gm-egg.invalid-request', `gmEggOfferInput.choices.${key} must be an enumerable data field.`) }
  const choices = input.choices as Record<string, unknown>
  const valuesBySlot: Readonly<Record<BreedingGmEggOfferSlot, readonly string[]>> = Object.freeze({
    species:stringChoices(choices.species,32,'gmEggOfferInput.choices.species'), nature:stringChoices(choices.nature,36,'gmEggOfferInput.choices.nature'),
    'primary-ability':stringChoices(choices.primaryAbility,16,'gmEggOfferInput.choices.primaryAbility'), gender:stringChoices(choices.gender,3,'gmEggOfferInput.choices.gender'),
    'inheritance-move':stringChoices(choices.inheritanceMoves,9,'gmEggOfferInput.choices.inheritanceMoves'),
    'base-hatch-duration':minuteChoices(choices.baseHatchDuration,32,'gmEggOfferInput.choices.baseHatchDuration'),
    'hatch-duration':minuteChoices(choices.hatchDuration,32,'gmEggOfferInput.choices.hatchDuration'),
    'baby-template':Object.hasOwn(choices, 'babyTemplate') ? stringChoices(choices.babyTemplate,52,'gmEggOfferInput.choices.babyTemplate') : Object.freeze([]),
  })
  const selectedSpeciesValues=valuesBySlot.species.filter(value=>breedingGmEggOfferOptionId(command.operationId,'species',value)===command.payload.speciesOptionId)
  if(selectedSpeciesValues.length!==1)return fail('breeding.gm-egg.invalid-choice','GM Egg Species option must identify exactly one server Species value before dependent offers are issued.')
  const babyValues=valuesBySlot['baby-template'];const babyChoiceRequired=campaignOptions.values['breeding.baby-template-policy']==='per-egg-gm-choice'&&selectedSpeciesValues[0]!=='kangaskhan'
  if(babyChoiceRequired!==(babyValues.length>0)||(babyValues.length>0&&(!babyValues.includes('baby-template:decline')||babyValues.some(value=>value!=='baby-template:decline'&&!/^baby-template:apply:size-percent:(50|5[1-9]|[6-9][0-9]|100)$/u.test(value)))))return fail('breeding.gm-egg.invalid-choice','GM Baby Template offers must exist exactly under the per-Egg policy and contain only bounded decline/application values; Marsupial rejects a substitute offer.')
  const issuedAt = minute(input.issuedAtCampaignMinute,'gmEggOfferInput.issuedAtCampaignMinute'); const expiresAt = minute(input.expiresAtCampaignMinute,'gmEggOfferInput.expiresAtCampaignMinute')
  if (issuedAt !== provenance.capturedAtCampaignMinute || expiresAt <= issuedAt || expiresAt > issuedAt + 525_600) return fail('breeding.gm-egg.invalid-request','GM Egg offers must have a future bounded campaign-time expiry from the provenance checkpoint.')
  const commandHash=createBreedingOperationCommandHash(command); const sourceEvidenceId=`gm-egg-source:${provenance.definitionSha256.slice(0,32)}`; const offers:BreedingOptionOfferRecordV1[]=[]
  for(const slot of Object.keys(valuesBySlot) as BreedingGmEggOfferSlot[]){const values=valuesBySlot[slot];if(values.length===0)continue;if(new Set(values).size!==values.length)return fail('breeding.gm-egg.invalid-choice',`GM Egg ${slot} choices must be unique.`)
    const offerId=breedingGmEggOfferId(command.operationId,slot);const options=values.map(canonicalValueId=>({optionId:breedingGmEggOfferOptionId(command.operationId,slot,canonicalValueId),kind:OFFER_KIND_BY_SLOT[slot],canonicalValueId,valueDefinitionSha256:optionValueHash(slot,canonicalValueId,provenance.definitionSha256,campaignOptions.definitionSha256),authorityEvidenceIds:[slotEvidenceId(slot),sourceEvidenceId].sort(compare)})).sort((a,b)=>compare(a.optionId,b.optionId))
    offers.push(createBreedingOptionOfferRecordV1({schemaVersion:1,offerId,choiceKind:OFFER_KIND_BY_SLOT[slot],target:{kind:'pokemon-egg',eggId:command.payload.eggId,revision:0},chooserProfileId:command.actor.profileId,minimumPokemonEducationRank:null,options,issuedOperationId:command.operationId,issuedCommandSha256:commandHash,issuedAtCampaignMinute:issuedAt,expiresAtCampaignMinute:expiresAt}))}
  return Object.freeze(offers.sort((a,b)=>compare(`${a.choiceKind}\0${a.offerId}`,`${b.choiceKind}\0${b.offerId}`)))
}

export const breedingGmEggDependencyEvidenceV1 = (inputValue:{readonly provenance:unknown,readonly campaignOptionSnapshot:unknown,readonly speciesId:unknown}):readonly BreedingDependencyEvidenceV1[]=>{
  const input=exact(inputValue,['provenance','campaignOptionSnapshot','speciesId'],'gmEggDependencyInput');const provenance=parseAuthoritativePokemonEggGmSourceProvenanceV1(input.provenance);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);const speciesId=parseBreedingSpeciesIdSyntax(input.speciesId)??fail('breeding.gm-egg.invalid-request','GM Egg dependency Species must be canonical syntax.');const species=compiledBreedingSpeciesSpec(speciesId)??fail('breeding.gm-egg.provider-unavailable','GM Egg dependency Species is absent from the compiled registry.')
  const values:BreedingDependencyEvidenceV1[]=[
    {providerKind:'system',providerId:BREEDING_GM_EGG_SOURCE_PROVIDER_ID,subjectKind:'trainer-sheet',subjectId:provenance.ownerTrainerSlug,subjectRevision:provenance.ownerTrainerRevision,checkpoint:'egg-acceptance',providerDefinitionSha256:BREEDING_GM_EGG_POLICY_DEFINITION_SHA256,effectiveEvidenceSha256:provenance.definitionSha256},
    {providerKind:'campaign-option',providerId:BREEDING_GM_EGG_OPTIONS_PROVIDER_ID,subjectKind:'campaign',subjectId:'campaign',subjectRevision:null,checkpoint:'egg-acceptance',providerDefinitionSha256:options.rulesetDefinitionSha256,effectiveEvidenceSha256:options.definitionSha256},
    {providerKind:'species-registry',providerId:BREEDING_GM_EGG_SPECIES_PROVIDER_ID,subjectKind:'campaign',subjectId:'campaign',subjectRevision:null,checkpoint:'egg-acceptance',providerDefinitionSha256:COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,effectiveEvidenceSha256:species.definitionSha256},
  ];values.sort((a,b)=>compare(`${a.checkpoint}\0${a.providerKind}\0${a.providerId}\0${a.subjectKind}\0${a.subjectId}`,`${b.checkpoint}\0${b.providerKind}\0${b.providerId}\0${b.subjectKind}\0${b.subjectId}`));return Object.freeze(values.map(Object.freeze))
}
interface SelectedOption{readonly slot:BreedingGmEggOfferSlot,readonly offer:BreedingOptionOfferRecordV1,readonly option:BreedingOptionOfferRecordV1['options'][number]}
const selectedOptions=(input:{readonly command:Extract<BreedingOperationCommandV1,{readonly commandKind:'create-source-egg'}>,readonly provenance:PokemonEggGmSourceProvenanceV1,readonly offers:readonly BreedingOptionOfferRecordV1[],readonly at:number,readonly campaignOptionSnapshotDefinitionSha256:string}):{readonly selected:readonly SelectedOption[],readonly successors:readonly BreedingOptionOfferRecordV1[]}=>{
  const commandHash=createBreedingOperationCommandHash(input.command);const ids=[input.command.payload.speciesOptionId,...input.command.payload.resolutions.selectedOptionIds];if(new Set(ids).size!==ids.length)return fail('breeding.gm-egg.invalid-choice','GM Egg choice IDs must be globally unique.');const selected:SelectedOption[]=[];const successors:BreedingOptionOfferRecordV1[]=[];const used=new Set<string>()
  for(const optionId of ids){const matches=input.offers.map(v=>parseAuthoritativeBreedingOptionOfferRecordV1(v)).filter(o=>o.options.some(v=>v.optionId===optionId));if(matches.length!==1)return fail('breeding.gm-egg.invalid-choice','Every GM Egg choice must resolve exactly one server offer.');const offer=matches[0]!;if(used.has(offer.offerId)||offer.status!=='active'||offer.revision!==0||offer.target.kind!=='pokemon-egg'||offer.target.eggId!==input.command.payload.eggId||offer.target.revision!==0||offer.chooserProfileId!==input.command.actor.profileId||offer.issuedOperationId!==input.command.operationId||offer.issuedCommandSha256!==commandHash||offer.issuedAtCampaignMinute>input.at||offer.expiresAtCampaignMinute===null||input.at>=offer.expiresAtCampaignMinute)return fail('breeding.gm-egg.invalid-choice','GM Egg offers must be active, unexpired, command-bound, GM-bound, and future-Egg-targeted.');const option=offer.options.find(v=>v.optionId===optionId)!;const slot=(Object.keys(OFFER_KIND_BY_SLOT) as BreedingGmEggOfferSlot[]).find(v=>option.authorityEvidenceIds.includes(slotEvidenceId(v)));if(!slot||offer.choiceKind!==OFFER_KIND_BY_SLOT[slot]||option.kind!==OFFER_KIND_BY_SLOT[slot]||option.valueDefinitionSha256!==optionValueHash(slot,option.canonicalValueId,input.provenance.definitionSha256,input.campaignOptionSnapshotDefinitionSha256)||option.optionId!==breedingGmEggOfferOptionId(input.command.operationId,slot,option.canonicalValueId)||offer.offerId!==breedingGmEggOfferId(input.command.operationId,slot))return fail('breeding.gm-egg.invalid-choice','GM Egg option identity, kind, source, or policy hash drifted.');used.add(offer.offerId);selected.push(Object.freeze({slot,offer,option}));successors.push(createBreedingOptionOfferRevisionV1({...offer,revision:1,status:'consumed',selectedOptionId:option.optionId,settlementOperationId:input.command.operationId,settlementCommandSha256:commandHash,settledAtCampaignMinute:input.at,settlementReasonId:null}))}
  if(selected.find(v=>v.option.optionId===input.command.payload.speciesOptionId)?.slot!=='species')return fail('breeding.gm-egg.invalid-choice','speciesOptionId must select exactly one GM Egg Species offer.');return Object.freeze({selected:Object.freeze(selected),successors:Object.freeze(successors)})
}
const one=(selected:readonly SelectedOption[],slot:BreedingGmEggOfferSlot,required:boolean):SelectedOption|null=>{const values=selected.filter(v=>v.slot===slot);if(values.length>1||(required&&values.length!==1))return fail('breeding.gm-egg.invalid-choice',`GM Egg ${slot} requires ${required?'exactly one':'at most one'} bounded choice.`);return values[0]??null}
export interface PlannedBreedingGmEggV1{readonly egg:PokemonEggDocumentV1,readonly consumedOffers:readonly BreedingOptionOfferRecordV1[]}
export const planBreedingGmEggV1=(inputValue:{readonly command:unknown,readonly campaignOptionSnapshot:unknown,readonly offers:readonly unknown[],readonly campaignClock:unknown,readonly hatchDurationRoll:unknown|null}):PlannedBreedingGmEggV1=>{
  validateStaticBoundary();const input=exact(inputValue,['command','campaignOptionSnapshot','offers','campaignClock','hatchDurationRoll'],'gmEggPlanInput');const command=parseBreedingOperationCommandV1(input.command);if(command.commandKind!=='create-source-egg'||command.payload.source.kind!=='gm'||!('provenance' in command.payload.source))return fail('breeding.gm-egg.wrong-command','GM Egg planning requires one typed GM create-source-egg command.');const provenance=parseAuthoritativePokemonEggGmSourceProvenanceV1(command.payload.source.provenance);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);const clock=parseCampaignClockV1(input.campaignClock)
  if(command.payload.eggId!==provenance.eggId||command.payload.ownerTrainerSlug!==provenance.ownerTrainerSlug||command.payload.source.reasonId!==BREEDING_GM_EGG_REASON_BY_PROVENANCE[provenance.provenanceKind]||command.payload.source.evidenceDefinitionSha256!==provenance.definitionSha256||command.ruleset.definitionSha256!==options.rulesetDefinitionSha256||provenance.capturedAtCampaignMinute!==clock.campaignMinute)return fail('breeding.gm-egg.stale-authority','GM Egg command, provenance, options, and clock must share one exact checkpoint.')
  const offers=strictArray(input.offers,16,'gmEggPlanInput.offers').map((v,i)=>parseAuthoritativeBreedingOptionOfferRecordV1(v,`gmEggPlanInput.offers[${i}]`));const choices=selectedOptions({command,provenance,offers,at:clock.campaignMinute,campaignOptionSnapshotDefinitionSha256:options.definitionSha256});const speciesChoice=one(choices.selected,'species',true)!;const speciesId=parseBreedingSpeciesIdSyntax(speciesChoice.option.canonicalValueId)??fail('breeding.gm-egg.invalid-choice','GM Egg Species choice must be canonical syntax.');const speciesSpec=compiledBreedingSpeciesSpec(speciesId);const speciesIdentity=canonicalBreedingSpeciesIdentity(speciesId);const speciesRecord=speciesIdentity?(pokedexJson as readonly PokedexRecord[])[speciesIdentity.sourceIndex]:null;if(!speciesSpec||!speciesIdentity||!speciesRecord||speciesRecord.species!==speciesIdentity.sourceName||sha256(speciesRecord)!==speciesIdentity.sourceRecordSha256)return fail('breeding.gm-egg.provider-unavailable','GM Egg Species must resolve exact compiled app authority.')
  const natureChoice=one(choices.selected,'nature',true)!;const nature=breedingNature(natureChoice.option.canonicalValueId);if(!nature)return fail('breeding.gm-egg.invalid-choice','GM Egg Nature must be current canonical authority.');const abilityChoice=one(choices.selected,'primary-ability',true)!;const abilityId=parseBreedingAbilityIdSyntax(abilityChoice.option.canonicalValueId);if(!abilityId||!speciesSpec.basicAbilityIds.includes(abilityId)||!canonicalBreedingAbilityIdentity(abilityId))return fail('breeding.gm-egg.invalid-choice','GM Egg Ability must be one current compiled Basic Ability.');const genderChoice=one(choices.selected,'gender',true)!;const gender=genderChoice.option.canonicalValueId;const genderAllowed=speciesSpec.genderPolicy.kind==='genderless'
    ? gender==='genderless'
    : (gender==='female'&&speciesSpec.genderPolicy.femalePercent>0)||(gender==='male'&&speciesSpec.genderPolicy.femalePercent<100)
  if(!genderAllowed)return fail('breeding.gm-egg.invalid-choice','GM Egg Gender must match the compiled Species policy.')
  const moveChoices=choices.selected.filter(v=>v.slot==='inheritance-move');if(moveChoices.length>9)return fail('breeding.gm-egg.invalid-choice','GM Egg inheritance is bounded to nine explicit canonical Moves.');const inheritanceCandidates=moveChoices.map(v=>{const moveId=parseBreedingMoveIdSyntax(v.option.canonicalValueId);const identity=moveId?canonicalBreedingMoveIdentity(moveId):null;if(!moveId||!identity)return fail('breeding.gm-egg.invalid-choice','GM Egg inheritance choices must be app-owned canonical Move IDs.');return Object.freeze({moveId,sources:Object.freeze([{kind:'source-authority' as const,authorityKind:'gm' as const,authorityId:provenance.provenanceId,evidenceDefinitionSha256:provenance.definitionSha256}])})}).sort((a,b)=>compare(a.moveId,b.moveId));if(new Set(inheritanceCandidates.map(v=>v.moveId)).size!==inheritanceCandidates.length)return fail('breeding.gm-egg.invalid-choice','GM Egg inheritance Move choices must be unique.')
  const startingLevel=resolveBreedingHatchStartingLevel('gm',options);const babyChoice=one(choices.selected,'baby-template',false);const marsupialBaby=speciesId==='kangaskhan';if(marsupialBaby&&babyChoice)return fail('breeding.gm-egg.invalid-choice','Marsupial forces its Baby Template and rejects a campaign-choice substitute.');let baby;if(marsupialBaby)baby=resolveBreedingMarsupialBabyTemplateV1();else{let selectedBaby:Parameters<typeof resolveBreedingBabyTemplate>[1]=null;if(babyChoice){const match=/^baby-template:apply:size-percent:(50|5[1-9]|[6-9][0-9]|100)$/u.exec(babyChoice.option.canonicalValueId);const decline=babyChoice.option.canonicalValueId==='baby-template:decline';if(!decline&&!match)return fail('breeding.gm-egg.invalid-choice','GM Baby Template choice must bind decline or one bounded size percentage.');selectedBaby={optionId:babyChoice.option.optionId,evidenceId:slotEvidenceId('baby-template'),apply:!decline,sizePercentOfAdult:match?Number(match[1]):null}}baby=resolveBreedingBabyTemplate(options,selectedBaby)}if(startingLevel.status!=='resolved'||startingLevel.startingLevel!==1||baby.status!=='resolved')return fail('breeding.gm-egg.provider-unavailable','GM Egg Level and Baby Template policy must resolve exactly at this creation checkpoint.')
  const baseChoice=one(choices.selected,'base-hatch-duration',true)!;const baseMatch=baseChoice.option.canonicalValueId.match(/^campaign-minutes:([1-9][0-9]{0,7})$/u);if(!baseMatch)return fail('breeding.gm-egg.invalid-choice','GM Egg base hatch duration must be bounded campaign minutes.');const targetChoice=one(choices.selected,'hatch-duration',false);const targetMatch=targetChoice?.option.canonicalValueId.match(/^campaign-minutes:([1-9][0-9]{0,7})$/u)??null;const variation=options.values['breeding.hatch-duration-variation'];if((variation==='gm-within-half-to-double')!==(targetChoice!==null))return fail('breeding.gm-egg.invalid-choice','GM duration variation requires exactly one target offer only under the matching campaign policy.')
  const durationRoll=input.hatchDurationRoll===null?null:parseAuthoritativeBreedingRollRecordV1(input.hatchDurationRoll);const requested=variation==='server-random-half-to-double'?['hatch-duration']:[];if(!same(command.payload.resolutions.requestedRollKinds,requested)||((requested.length===1)!==(durationRoll!==null)))return fail('breeding.gm-egg.invalid-roll-set','GM Egg duration randomness must match the frozen campaign policy exactly.');const rollHashes=[BREEDING_GM_EGG_POLICY_DEFINITION_SHA256,provenance.definitionSha256,options.definitionSha256,speciesSpec.definitionSha256,...offers.map(v=>v.definitionSha256)].filter((v,i,a)=>a.indexOf(v)===i).sort(compare);if(durationRoll&&(durationRoll.operationId!==command.operationId||durationRoll.commandSha256!==createBreedingOperationCommandHash(command)||durationRoll.operationRollOrdinal!==0||durationRoll.purpose!=='hatch-duration-percentage'||durationRoll.formula!=='percentage-50-to-200'||durationRoll.target.kind!=='pokemon-egg'||durationRoll.target.eggId!==command.payload.eggId||durationRoll.target.revision!==0||durationRoll.generatedAtCampaignMinute!==clock.campaignMinute||!same(durationRoll.sourceDefinitionHashes,rollHashes)))return fail('breeding.gm-egg.invalid-roll-set','GM Egg duration roll must be exact command-bound persisted randomness.')
  const duration=resolveBreedingHatchDuration({speciesId,sourceKind:'gm',options,durationOverride:{authorityKind:'gm-adjudication',authorityId:provenance.provenanceId,evidenceId:baseChoice.option.optionId,authorityDefinitionSha256:provenance.definitionSha256,campaignMinutes:Number(baseMatch[1])},variationRoll:durationRoll?{rollId:durationRoll.rollRecordId,total:durationRoll.total}:null,gmTarget:targetChoice&&targetMatch?{optionId:targetChoice.option.optionId,evidenceId:slotEvidenceId('hatch-duration'),targetCampaignMinutes:Number(targetMatch[1])}:null});if(duration.status!=='resolved'||duration.speciesSpecDefinitionSha256!==speciesSpec.definitionSha256)return fail('breeding.gm-egg.provider-unavailable',`GM Egg hatch duration is unavailable${duration.status==='unavailable'?`: ${duration.reasonIds.join(',')}`:'.'}`)
  const bounded=<Value extends string>(choice:SelectedOption,valueId:Value)=>Object.freeze({valueId,resolutionKind:'rank-choice' as const,rollRecordId:null,optionId:choice.option.optionId,choiceEvidenceId:slotEvidenceId(choice.slot)});const blueprint=createPokemonEggOffspringBlueprintV1({schemaVersion:1,speciesId,familyRootSpeciesId:speciesSpec.familyRootSpeciesId,speciesSpecDefinitionSha256:speciesSpec.definitionSha256,nature:bounded(natureChoice,nature.id),ability:bounded(abilityChoice,abilityId),gender:bounded(genderChoice,gender as 'female'|'male'|'genderless'),inheritanceCandidates,providerTraits:{serpentsMark:null,fossilRestoration:null,prehistoricBond:null,marsupial:marsupialBaby?createBreedingMarsupialProviderTraitV1():null,playingGod:null},startingLevel:startingLevel.startingLevel,babyTemplate:{applied:baby.applied,choiceOptionId:baby.choiceOptionId,choiceEvidenceId:baby.choiceEvidenceId,effects:baby.effects}})
  const definitionHashes=[BREEDING_GM_EGG_POLICY_DEFINITION_SHA256,BREEDING_CANONICAL_ID_DEFINITION_SHA256,BREEDING_NATURE_DEFINITION_SHA256,COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,provenance.definitionSha256,options.definitionSha256,speciesSpec.definitionSha256,speciesIdentity.sourceRecordSha256,blueprint.definitionSha256,startingLevel.resultDefinitionSha256,baby.resultDefinitionSha256,duration.resultDefinitionSha256,...(marsupialBaby?[BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderRecordSha256,BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderMechanicFieldsSha256]:[]),...choices.selected.map(v=>v.offer.definitionSha256),...(durationRoll?[durationRoll.definitionSha256]:[]),...inheritanceCandidates.map(v=>canonicalBreedingMoveIdentity(v.moveId)!.sourceRecordSha256),...(provenance.sourceRecordDefinitionSha256?[provenance.sourceRecordDefinitionSha256]:[]),...(provenance.importReceiptDefinitionSha256?[provenance.importReceiptDefinitionSha256]:[]),...(provenance.importEvidenceDefinitionSha256?[provenance.importEvidenceDefinitionSha256]:[])].filter((v,i,a)=>a.indexOf(v)===i).sort(compare)
  const egg=parseAuthoritativePokemonEggDocumentV1({schemaVersion:1,eggId:command.payload.eggId,revision:0,status:'incubating',ownerTrainerSlug:provenance.ownerTrainerSlug,source:command.payload.source,ruleset:command.ruleset,definitionHashes,parents:[],breeder:null,offspring:blueprint,incubation:{averageCampaignMinutes:duration.averageCampaignMinutes,targetCampaignMinutes:duration.targetCampaignMinutes,accumulatedCampaignMinutes:0,variationPolicyId:duration.variationPolicyId,durationResultDefinitionSha256:duration.resultDefinitionSha256,lastAppliedClockRevision:clock.revision,lastAppliedClockMinute:clock.campaignMinute,readyAtCampaignMinute:null,readinessKind:null,readyOperationId:null,paused:false,pauseReasonId:null,pauseOperationId:null},special:{state:'not-rolled',rollRecordId:null,rollTotal:null,triggerIds:[],adjudicationId:null,outcomeId:null,automaticShiny:false},hatchOperationId:null,childSheetSlug:null,terminal:null,createdAtCampaignMinute:clock.campaignMinute,updatedAtCampaignMinute:clock.campaignMinute,statusChangedAtCampaignMinute:clock.campaignMinute,lastOperationId:command.operationId})
  return Object.freeze({egg,consumedOffers:choices.successors})
}
export const projectBreedingGmEggCreationV1=(inputValue:{readonly egg:unknown,readonly audience:'gm'|'owner'}):BreedingGmEggCreationProjectionV1=>{const input=exact(inputValue,['egg','audience'],'gmEggProjectionInput');if(input.audience!=='gm'&&input.audience!=='owner')return fail('breeding.gm-egg.invalid-request','GM Egg projection audience must be owner or GM.');const egg=parseAuthoritativePokemonEggDocumentV1(input.egg);if(egg.source.kind!=='gm'||!('provenance' in egg.source)||egg.revision!==0||egg.status!=='incubating'||egg.parents.length!==0||egg.breeder!==null)return fail('breeding.gm-egg.stale-authority','GM Egg projection requires one committed typed revision-zero parentless incubating Egg.');const provenance=parseAuthoritativePokemonEggGmSourceProvenanceV1(egg.source.provenance);const gm=input.audience==='gm';return parseBreedingGmEggCreationProjectionV1({schemaVersion:1,audience:input.audience,eggId:egg.eggId,eggRevision:0,sourceKind:'gm',provenanceKind:gm?provenance.provenanceKind:null,status:'incubating',startingLevel:egg.offspring.startingLevel,parentSnapshotCount:0,traitsBounded:true,imported:gm?provenance.provenanceKind==='imported':null,createdAtCampaignMinute:egg.createdAtCampaignMinute,operationId:egg.lastOperationId})}
export const breedingGmEggRollSourceDefinitionHashes=(inputValue:{readonly command:unknown,readonly campaignOptionSnapshot:unknown,readonly offers:readonly unknown[],readonly speciesId:unknown}):readonly string[]=>{const input=exact(inputValue,['command','campaignOptionSnapshot','offers','speciesId'],'gmEggRollSourceInput');const command=parseBreedingOperationCommandV1(input.command);if(command.commandKind!=='create-source-egg'||command.payload.source.kind!=='gm'||!('provenance' in command.payload.source))return fail('breeding.gm-egg.wrong-command','GM Egg roll hashes require typed GM create-source-egg.');const provenance=parseAuthoritativePokemonEggGmSourceProvenanceV1(command.payload.source.provenance);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);const species=compiledBreedingSpeciesSpec(parseBreedingSpeciesIdSyntax(input.speciesId)??'')??fail('breeding.gm-egg.provider-unavailable','GM Egg roll Species is unavailable.');const offers=strictArray(input.offers,16,'gmEggRollSourceInput.offers').map(v=>parseAuthoritativeBreedingOptionOfferRecordV1(v));return Object.freeze([BREEDING_GM_EGG_POLICY_DEFINITION_SHA256,provenance.definitionSha256,options.definitionSha256,species.definitionSha256,...offers.map(v=>v.definitionSha256)].filter((v,i,a)=>a.indexOf(v)===i).sort(compare))}
