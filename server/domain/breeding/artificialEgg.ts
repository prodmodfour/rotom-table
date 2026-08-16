import { createHash } from 'node:crypto'
import pokedexJson from '../../../data/reference/pokedex.json'
import featureContractJson from '../../../data/breeding-automation/feature-provider-handoff-contract.json'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, type StrictJsonObject } from '#shared/automation/strictJson'
import {
  parseBreedingArtificialEggCreationProjectionV1,
  parseBreedingArtificialEggSourceAuthorityV1,
  type BreedingArtificialEggCreationProjectionV1,
  type BreedingArtificialEggSourceAuthorityV1,
} from '#shared/breeding/artificialEgg'
import {
  POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS,
  type PokemonEggDocumentV1,
  type PokemonEggPlayingGodBaseStatIncreasesV1,
} from '#shared/breeding/egg'
import {
  BREEDING_PLAYING_GOD_SPECIES_IDS,
  parseBreedingFeatureProviderHandoffV1,
  type BreedingFeatureProviderContributionEvidenceV1,
  type BreedingFeatureProviderHandoffV1,
} from '#shared/breeding/featureProviderHandoff'
import {
  parseBreedingAbilityIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingOfferId,
  type BreedingOfferOptionId,
} from '#shared/breeding/ids'
import type { BreedingOptionOfferRecordV1, BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import type { PokedexRecord } from '~/types/pokemon'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { createBreedingOptionOfferRecordV1, createBreedingOptionOfferRevisionV1, parseAuthoritativeBreedingOptionOfferRecordV1, parseAuthoritativeBreedingRollRecordV1 } from './ledgers'
import { createBreedingOperationCommandHash } from './operations'
import { parseBreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import {
  BREEDING_CANONICAL_ID_DEFINITION_SHA256,
  BREEDING_CANONICAL_MOVES,
  canonicalBreedingAbilityIdentity,
  canonicalBreedingMoveIdentity,
  canonicalBreedingSpeciesIdentity,
} from './canonicalIds'
import { BREEDING_NATURES, BREEDING_NATURE_DEFINITION_SHA256, breedingNature } from './natures'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256, compiledBreedingSpeciesSpec } from './registry'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { parseAuthoritativeBreedingFeatureProviderHandoffV1 } from './featureProviderHandoff'
import {
  BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
  resolveBreedingBabyTemplate,
  resolveBreedingHatchDuration,
  resolveBreedingHatchStartingLevel,
} from './eggRuleHelpers'
import { BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256 } from './babyTemplate'

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const chemistryInventory = modifierInventoryJson.definition.entries.find(entry => entry.id === 'item:Chemistry Set')
if (!chemistryInventory || chemistryInventory.clientAuthority !== 'none' || chemistryInventory.canonicalId !== 'Chemistry Set') throw new Error('Reviewed Chemistry Set inventory authority is unavailable.')
const playingGodSpecies = new Set<string>(BREEDING_PLAYING_GOD_SPECIES_IDS)
const canonicalMoveIdByName = new Map(BREEDING_CANONICAL_MOVES.map(entry => [entry.sourceName, entry.id]))
const pokedex = pokedexJson as readonly PokedexRecord[]

export const BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-artificial-egg-v1' as const,
  sourceKind: 'feature-artificial' as const,
  featureProvider: 'Playing God' as const,
  featureContractDefinitionSha256: featureContractJson.definitionSha256,
  chemistrySetRecordSha256: chemistryInventory.recordSha256,
  chemistrySetMechanicFieldsSha256: chemistryInventory.mechanicFieldsSha256,
  cost: 3500 as const,
  baseHatchCampaignMinutes: 720 as const,
  maximumHatchCampaignMinutes: 1440 as const,
  startingLevel: 5 as const,
  upgradeCount: 'exact-current-technology-education-rank-5-or-6' as const,
  upgradeLimits: Object.freeze({ coloration: 1, inheritanceMoves: 3, vitamins: 5 }),
  clientAuthority: 'none' as const,
  hatchPipeline: 'ordinary-pokemon-egg-document-v1' as const,
})
export const BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256 = sha256(BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION)
export const BREEDING_ARTIFICIAL_EGG_PROVIDER_ID = 'feature.playing-god' as const
export const BREEDING_ARTIFICIAL_EGG_SOURCE_PROVIDER_ID = 'breeding.artificial-egg-source.v1' as const
export const BREEDING_ARTIFICIAL_EGG_OPTIONS_PROVIDER_ID = 'breeding.artificial-egg-options.v1' as const
export const BREEDING_ARTIFICIAL_EGG_SPECIES_PROVIDER_ID = 'breeding.artificial-egg-species.v1' as const

export type BreedingArtificialEggAuthorityErrorCode =
  | 'breeding.artificial-egg.invalid-request'
  | 'breeding.artificial-egg.hash-mismatch'
  | 'breeding.artificial-egg.stale-authority'
  | 'breeding.artificial-egg.provider-unavailable'
  | 'breeding.artificial-egg.invalid-choice'
  | 'breeding.artificial-egg.invalid-roll-set'
  | 'breeding.artificial-egg.wrong-command'
export class BreedingArtificialEggAuthorityError extends Error {
  readonly code: BreedingArtificialEggAuthorityErrorCode
  constructor(code: BreedingArtificialEggAuthorityErrorCode, message: string) { super(message); this.name = 'BreedingArtificialEggAuthorityError'; this.code = code }
}
const fail = (code: BreedingArtificialEggAuthorityErrorCode, message: string): never => { throw new BreedingArtificialEggAuthorityError(code, message) }
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.artificial-egg.invalid-request', `${path} must be one plain object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.artificial-egg.invalid-request', `${path} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.artificial-egg.invalid-request', `${path}.${field} must be an enumerable data field.`) }
  return row
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.artificial-egg.invalid-request', `${path} must be one strict bounded array.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.artificial-egg.invalid-request', `${path}[${index}] must be an enumerable data entry.`) }
  return value
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value,'definitionSha256'> => { const { definitionSha256: _hash, ...definition } = value; return definition }
const inventoryRows = (document: TrainerSheet): readonly InventoryEntry[] => Object.values(document.inventory ?? {}).flatMap(value => Array.isArray(value) ? value : [])
const strictStoredTrainer = (value: unknown): { readonly slug: string, readonly revision: number, readonly document: StrictJsonObject } => {
  const row = exact(value, ['slug','revision','document'], 'trainerSheet')
  if (typeof row.slug !== 'string' || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0) return fail('breeding.artificial-egg.invalid-request', 'Trainer storage identity is malformed.')
  const documentValue = cloneStrictJson(row.document, 'trainerSheet.document', {
    limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
    rootLabel: 'Trainer document', valueLabel: 'Trainer document',
    failNotJson: (_path, detail) => fail('breeding.artificial-egg.invalid-request', `Trainer document ${detail}`),
    failLimit: (_path, detail) => fail('breeding.artificial-egg.invalid-request', detail),
  })
  if (!documentValue || typeof documentValue !== 'object' || Array.isArray(documentValue)) {
    return fail('breeding.artificial-egg.stale-authority', 'Trainer document must be one strict object.')
  }
  const document = documentValue as StrictJsonObject
  if (document.slug !== row.slug || document.revision !== row.revision) return fail('breeding.artificial-egg.stale-authority', 'Trainer document identity and storage revision must agree exactly.')
  return Object.freeze({ slug: row.slug, revision: row.revision as number, document })
}
const contributionValue = (contribution: BreedingFeatureProviderContributionEvidenceV1, id: string) => contribution.values.find(value => value.contributionId === id)?.value ?? null
export const playingGodContributionV1 = (handoffValue: unknown): BreedingFeatureProviderContributionEvidenceV1 => {
  const handoff = parseAuthoritativeBreedingFeatureProviderHandoffV1(handoffValue)
  const matches = handoff.contributions.filter(entry => entry.providerCanonicalId === 'Playing God' && entry.inventoryEntryId === 'feature:Playing God' && entry.checkpoint === 'egg-acceptance' && entry.disposition === 'active-provider-evidence')
  if (matches.length !== 1) return fail('breeding.artificial-egg.provider-unavailable', 'Exactly one current effective Playing God contribution is required.')
  const contribution = matches[0]!
  const species = contributionValue(contribution, 'artificial-species-options')
  const source = contributionValue(contribution, 'artificial-egg-source')
  const duration = contributionValue(contribution, 'hatch-within-one-day')
  const level = contributionValue(contribution, 'starting-level-5')
  const nature = contributionValue(contribution, 'nature-choice')
  const ability = contributionValue(contribution, 'basic-ability-choice')
  const upgrades = contributionValue(contribution, 'bounded-artificial-upgrades')
  if (source?.kind !== 'flag' || source.enabled !== true || species?.kind !== 'canonical-id-set' || species.values.length !== 1 || !playingGodSpecies.has(species.values[0]!)
    || duration?.kind !== 'integer' || duration.value !== 1440 || level?.kind !== 'integer' || level.value !== 5
    || nature?.kind !== 'flag' || nature.enabled !== true || ability?.kind !== 'flag' || ability.enabled !== true
    || upgrades?.kind !== 'integer' || (upgrades.value !== 5 && upgrades.value !== 6)) return fail('breeding.artificial-egg.provider-unavailable', 'Playing God typed values do not match the reviewed artificial-Egg policy.')
  return contribution
}

export const parseAuthoritativeBreedingArtificialEggSourceAuthorityV1 = (value: unknown): BreedingArtificialEggSourceAuthorityV1 => {
  const parsed = parseBreedingArtificialEggSourceAuthorityV1(value)
  if (sha256(withoutHash(parsed)) !== parsed.definitionSha256) return fail('breeding.artificial-egg.hash-mismatch', 'Artificial source authority hash does not match its exact frozen evidence.')
  return parsed
}
export const createBreedingArtificialEggSourceAuthorityV1 = (inputValue: {
  readonly eggId: unknown
  readonly ownerTrainerSheet: unknown
  readonly createdByGmProfileId: unknown
  readonly featureProviderHandoff: unknown
  readonly chemistryCustody: unknown
  readonly capturedAtCampaignMinute: unknown
}): BreedingArtificialEggSourceAuthorityV1 => {
  const input = exact(inputValue, ['eggId','ownerTrainerSheet','createdByGmProfileId','featureProviderHandoff','chemistryCustody','capturedAtCampaignMinute'], 'artificialSourceInput')
  const trainer = strictStoredTrainer(input.ownerTrainerSheet)
  const handoff = parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff)
  const feature = playingGodContributionV1(handoff)
  const custody = exact(input.chemistryCustody, ['inventoryEntryId','unitOrdinal'], 'artificialSourceInput.chemistryCustody')
  if (handoff.trainerSheetSlug !== trainer.slug || handoff.trainerSheetRevision !== trainer.revision || handoff.trainerSheetDefinitionSha256 !== sha256(trainer.document)
    || handoff.accessMode !== 'gm-authority' || handoff.capturedAtCampaignMinute !== input.capturedAtCampaignMinute
    || typeof input.createdByGmProfileId !== 'string' || typeof input.eggId !== 'string'
    || typeof custody.inventoryEntryId !== 'string' || !Number.isSafeInteger(custody.unitOrdinal) || (custody.unitOrdinal as number) < 0) return fail('breeding.artificial-egg.stale-authority', 'Artificial source must bind the exact current Trainer, GM Feature handoff, future Egg, tool unit, and campaign checkpoint.')
  const matching = inventoryRows(trainer.document as unknown as TrainerSheet).filter(row => row.id === custody.inventoryEntryId)
  const inventory = matching.length === 1 ? matching[0]! : null
  const quantity = inventory && Number.isSafeInteger(inventory.qty ?? 1) ? Number(inventory.qty ?? 1) : 0
  const money = Number((trainer.document as unknown as TrainerSheet).money ?? 0)
  if (!inventory || inventory.name !== 'Chemistry Set' || quantity < 1 || (custody.unitOrdinal as number) >= quantity
    || !Number.isSafeInteger(money) || money < 3500) return fail('breeding.artificial-egg.provider-unavailable', 'One unambiguous current Chemistry Set unit and at least $3500 are required.')
  const definition = Object.freeze({ schemaVersion:1 as const, eggId:input.eggId, ownerTrainerSlug:trainer.slug, ownerTrainerRevision:trainer.revision, ownerTrainerDefinitionSha256:sha256(trainer.document), createdByGmProfileId:input.createdByGmProfileId, featureHandoffDefinitionSha256:handoff.definitionSha256, featureContributionDefinitionSha256:feature.definitionSha256, chemistryInventoryEntryId:custody.inventoryEntryId, chemistryUnitOrdinal:custody.unitOrdinal, chemistryInventoryRowDefinitionSha256:sha256(inventory), cost:3500 as const, moneyBefore:money, moneyAfter:money-3500, capturedAtCampaignMinute:input.capturedAtCampaignMinute })
  return parseAuthoritativeBreedingArtificialEggSourceAuthorityV1({ ...definition, definitionSha256:sha256(definition) })
}

export type BreedingArtificialEggOfferSlot = 'species'|'nature'|'primary-ability'|'hatch-duration'|'baby-template'|`upgrade-${1|2|3|4|5|6}`
const kindForSlot = (slot: BreedingArtificialEggOfferSlot): BreedingOptionOfferRecordV1['choiceKind'] => slot === 'species' ? 'species' : slot === 'nature' ? 'nature' : slot === 'primary-ability' ? 'ability' : slot === 'hatch-duration' ? 'hatch-duration' : slot === 'baby-template' ? 'baby-template' : 'inheritance-slot'
export const breedingArtificialEggOfferId = (operationId:string, slot:BreedingArtificialEggOfferSlot):BreedingOfferId => `breeding-offer:v1:${sha256(`breeding-artificial-egg-offer-v1\0${operationId}\0${slot}`).slice(0,32)}` as BreedingOfferId
export const breedingArtificialEggOfferOptionId = (operationId:string, slot:BreedingArtificialEggOfferSlot, value:string):BreedingOfferOptionId => `option:v1:${sha256(`breeding-artificial-egg-option-v1\0${operationId}\0${slot}\0${value}`).slice(0,32)}` as BreedingOfferOptionId
const slotEvidenceId = (slot:BreedingArtificialEggOfferSlot):string => `artificial-egg-choice:${slot}`
const optionHash = (slot:BreedingArtificialEggOfferSlot,value:string,sourceHash:string,campaignOptionSnapshotDefinitionSha256:string):string => sha256({schemaVersion:1,policyDefinitionSha256:BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256,sourceDefinitionSha256:sourceHash,slot,canonicalValueId:value,...(slot==='baby-template'?{babyTemplatePolicyDefinitionSha256:BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,campaignOptionSnapshotDefinitionSha256}:{})})
export const breedingArtificialEggSpeciesIdV1 = (feature:BreedingFeatureProviderContributionEvidenceV1):string => {
  const value = contributionValue(feature,'artificial-species-options'); if (value?.kind !== 'canonical-id-set' || value.values.length !== 1) return fail('breeding.artificial-egg.provider-unavailable','Playing God Species is unavailable.'); return value.values[0]!
}
export const breedingArtificialEggTechnologyRankV1 = (feature:BreedingFeatureProviderContributionEvidenceV1):5|6 => {
  const value=contributionValue(feature,'bounded-artificial-upgrades'); return value?.kind==='integer'&&(value.value===5||value.value===6)?value.value:fail('breeding.artificial-egg.provider-unavailable','Playing God upgrade rank is unavailable.')
}
const legalMoveIds = (speciesId:string):readonly string[] => {
  const identity=canonicalBreedingSpeciesIdentity(speciesId);const record=identity?pokedex[identity.sourceIndex]:null
  if(!identity||!record||sha256(record)!==identity.sourceRecordSha256)return fail('breeding.artificial-egg.stale-authority','Artificial Species record is stale.')
  const names=[...(record.egg_moves??[]),...(record.tutor_moves??[]).map(row=>row.name)]
  const ids=names.map(name=>canonicalMoveIdByName.get(name)??fail('breeding.artificial-egg.stale-authority',`Artificial Move ${name} is not canonical.`))
  return Object.freeze([...new Set(ids)].sort(compare))
}
export const createBreedingArtificialEggOptionOffersV1 = (inputValue:{readonly command:unknown,readonly sourceAuthority:unknown,readonly featureProviderHandoff:unknown,readonly campaignOptionSnapshot:unknown,readonly issuedAtCampaignMinute:unknown,readonly expiresAtCampaignMinute:unknown}):readonly BreedingOptionOfferRecordV1[] => {
  const input=exact(inputValue,['command','sourceAuthority','featureProviderHandoff','campaignOptionSnapshot','issuedAtCampaignMinute','expiresAtCampaignMinute'],'artificialOfferInput');const command=parseBreedingOperationCommandV1(input.command);if(command.commandKind!=='create-source-egg'||command.payload.source.kind!=='feature-artificial')return fail('breeding.artificial-egg.wrong-command','Artificial offers require feature-artificial create-source-egg.');const source=parseAuthoritativeBreedingArtificialEggSourceAuthorityV1(input.sourceAuthority);const handoff=parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff);const feature=playingGodContributionV1(handoff);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);if(command.payload.source.providerId!==BREEDING_ARTIFICIAL_EGG_PROVIDER_ID||command.payload.source.evidenceDefinitionSha256!==source.definitionSha256||command.payload.eggId!==source.eggId||command.payload.ownerTrainerSlug!==source.ownerTrainerSlug||source.featureHandoffDefinitionSha256!==handoff.definitionSha256)return fail('breeding.artificial-egg.stale-authority','Artificial command, source, and Feature authority must agree.');const issued=Number(input.issuedAtCampaignMinute),expires=Number(input.expiresAtCampaignMinute);if(!Number.isSafeInteger(issued)||issued!==source.capturedAtCampaignMinute||!Number.isSafeInteger(expires)||expires<=issued||expires>issued+525_600)return fail('breeding.artificial-egg.invalid-request','Artificial offers require a bounded future campaign expiry.')
  const speciesId=breedingArtificialEggSpeciesIdV1(feature);const spec=compiledBreedingSpeciesSpec(speciesId)??fail('breeding.artificial-egg.provider-unavailable','Artificial Species is absent from the compiled registry.');const rank=breedingArtificialEggTechnologyRankV1(feature);const upgrades=[...POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS.map(id=>`coloration:${id}`),...legalMoveIds(speciesId).map(id=>`move:${id}`),...['hp','atk','def','satk','sdef','spd'].map(id=>`base-stat:${id}`)].sort(compare);const values=new Map<BreedingArtificialEggOfferSlot,readonly string[]>([['species',[speciesId]],['nature',BREEDING_NATURES.map(entry=>entry.id)],['primary-ability',spec.basicAbilityIds],...Array.from({length:rank},(_,index)=>[`upgrade-${index+1}` as BreedingArtificialEggOfferSlot,upgrades] as const)]);if(options.values['breeding.hatch-duration-variation']==='gm-within-half-to-double')values.set('hatch-duration',[360,720,1080,1440].map(value=>`campaign-minutes:${value}`));if(options.values['breeding.baby-template-policy']==='per-egg-gm-choice')values.set('baby-template',['baby-template:decline',...Array.from({length:51},(_,index)=>`baby-template:apply:size-percent:${index+50}`)])
  const commandHash=createBreedingOperationCommandHash(command);const offers:BreedingOptionOfferRecordV1[]=[];for(const [slot,slotValues] of values){const offerOptions=slotValues.map(value=>({optionId:breedingArtificialEggOfferOptionId(command.operationId,slot,value),kind:kindForSlot(slot),canonicalValueId:value,valueDefinitionSha256:optionHash(slot,value,source.definitionSha256,options.definitionSha256),authorityEvidenceIds:[slotEvidenceId(slot),`artificial-egg-source:${source.definitionSha256.slice(0,32)}`].sort(compare)})).sort((a,b)=>compare(a.optionId,b.optionId));offers.push(createBreedingOptionOfferRecordV1({schemaVersion:1,offerId:breedingArtificialEggOfferId(command.operationId,slot),choiceKind:kindForSlot(slot),target:{kind:'pokemon-egg',eggId:command.payload.eggId,revision:0},chooserProfileId:command.actor.profileId,minimumPokemonEducationRank:null,options:offerOptions,issuedOperationId:command.operationId,issuedCommandSha256:commandHash,issuedAtCampaignMinute:issued,expiresAtCampaignMinute:expires}))}return Object.freeze(offers.sort((a,b)=>compare(a.offerId,b.offerId)))
}

interface Selected {readonly slot:BreedingArtificialEggOfferSlot,readonly offer:BreedingOptionOfferRecordV1,readonly option:BreedingOptionOfferRecordV1['options'][number]}
const select = (command:Extract<BreedingOperationCommandV1,{readonly commandKind:'create-source-egg'}>,source:BreedingArtificialEggSourceAuthorityV1,offers:readonly BreedingOptionOfferRecordV1[],at:number,campaignOptionSnapshotDefinitionSha256:string):{readonly values:readonly Selected[],readonly successors:readonly BreedingOptionOfferRecordV1[]} => {
  const ids=[command.payload.speciesOptionId,...command.payload.resolutions.selectedOptionIds];if(new Set(ids).size!==ids.length)return fail('breeding.artificial-egg.invalid-choice','Artificial option IDs must be globally unique.');const values:Selected[]=[];const successors:BreedingOptionOfferRecordV1[]=[];const used=new Set<string>();const commandHash=createBreedingOperationCommandHash(command)
  for(const optionId of ids){const matches=offers.filter(offer=>offer.options.some(option=>option.optionId===optionId));if(matches.length!==1)return fail('breeding.artificial-egg.invalid-choice','Every artificial choice must resolve exactly one offer.');const offer=parseAuthoritativeBreedingOptionOfferRecordV1(matches[0]!);const option=offer.options.find(value=>value.optionId===optionId)!;const slots=(['species','nature','primary-ability','hatch-duration','baby-template','upgrade-1','upgrade-2','upgrade-3','upgrade-4','upgrade-5','upgrade-6'] as BreedingArtificialEggOfferSlot[]).filter(slot=>offer.offerId===breedingArtificialEggOfferId(command.operationId,slot)&&option.authorityEvidenceIds.includes(slotEvidenceId(slot)));if(slots.length!==1||used.has(offer.offerId)||offer.status!=='active'||offer.revision!==0||offer.target.kind!=='pokemon-egg'||offer.target.eggId!==command.payload.eggId||offer.target.revision!==0||offer.chooserProfileId!==command.actor.profileId||offer.issuedOperationId!==command.operationId||offer.issuedCommandSha256!==commandHash||offer.expiresAtCampaignMinute===null||at>=offer.expiresAtCampaignMinute||offer.choiceKind!==kindForSlot(slots[0]!)||option.valueDefinitionSha256!==optionHash(slots[0]!,option.canonicalValueId,source.definitionSha256,campaignOptionSnapshotDefinitionSha256)||option.optionId!==breedingArtificialEggOfferOptionId(command.operationId,slots[0]!,option.canonicalValueId))return fail('breeding.artificial-egg.invalid-choice','Artificial offer identity or authority drifted.');used.add(offer.offerId);values.push(Object.freeze({slot:slots[0]!,offer,option}));successors.push(createBreedingOptionOfferRevisionV1({...offer,revision:1,status:'consumed',selectedOptionId:option.optionId,settlementOperationId:command.operationId,settlementCommandSha256:commandHash,settledAtCampaignMinute:at,settlementReasonId:null}))}
  if(values.find(value=>value.option.optionId===command.payload.speciesOptionId)?.slot!=='species')return fail('breeding.artificial-egg.invalid-choice','speciesOptionId must select the exact artificial Species offer.');return Object.freeze({values:Object.freeze(values),successors:Object.freeze(successors)})
}
const one=(values:readonly Selected[],slot:BreedingArtificialEggOfferSlot,required:boolean):Selected|null=>{const found=values.filter(value=>value.slot===slot);if(found.length>1||(required&&found.length!==1))return fail('breeding.artificial-egg.invalid-choice',`${slot} requires ${required?'exactly one':'at most one'} choice.`);return found[0]??null}
const verifyRoll=(rollValue:unknown,command:Extract<BreedingOperationCommandV1,{readonly commandKind:'create-source-egg'}>,ordinal:number,purpose:'gender-d100'|'hatch-duration-percentage',sourceHashes:readonly string[],minute:number):BreedingRollRecordV1=>{const roll=parseAuthoritativeBreedingRollRecordV1(rollValue);if(roll.operationId!==command.operationId||roll.commandSha256!==createBreedingOperationCommandHash(command)||roll.operationRollOrdinal!==ordinal||roll.purpose!==purpose||roll.target.kind!=='pokemon-egg'||roll.target.eggId!==command.payload.eggId||roll.target.revision!==0||roll.generatedAtCampaignMinute!==minute||!same(roll.sourceDefinitionHashes,sourceHashes))return fail('breeding.artificial-egg.invalid-roll-set','Artificial roll must be exact persisted command-bound randomness.');return roll}
export const breedingArtificialEggRollSourceDefinitionHashes=(input:{readonly command:unknown,readonly sourceAuthority:unknown,readonly featureProviderHandoff:unknown,readonly campaignOptionSnapshot:unknown,readonly offers:readonly unknown[]}):readonly string[]=>{const command=parseBreedingOperationCommandV1(input.command);if(command.commandKind!=='create-source-egg'||command.payload.source.kind!=='feature-artificial')return fail('breeding.artificial-egg.wrong-command','Artificial roll hashes require a source-Egg command.');const source=parseAuthoritativeBreedingArtificialEggSourceAuthorityV1(input.sourceAuthority);const handoff=parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);const offers=array(input.offers,'offers',32).map(value=>parseAuthoritativeBreedingOptionOfferRecordV1(value));return Object.freeze([BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256,source.definitionSha256,handoff.definitionSha256,options.definitionSha256,...offers.map(value=>value.definitionSha256)].filter((value,index,all)=>all.indexOf(value)===index).sort(compare))}

export interface PlannedBreedingArtificialEggV1 {readonly egg:PokemonEggDocumentV1,readonly consumedOffers:readonly BreedingOptionOfferRecordV1[]}
export const planBreedingArtificialEggV1=(inputValue:{readonly command:unknown,readonly sourceAuthority:unknown,readonly featureProviderHandoff:unknown,readonly campaignOptionSnapshot:unknown,readonly offers:readonly unknown[],readonly campaignClock:unknown,readonly rolls:readonly unknown[]}):PlannedBreedingArtificialEggV1=>{
  const input=exact(inputValue,['command','sourceAuthority','featureProviderHandoff','campaignOptionSnapshot','offers','campaignClock','rolls'],'artificialPlanInput');const command=parseBreedingOperationCommandV1(input.command);if(command.commandKind!=='create-source-egg'||command.payload.source.kind!=='feature-artificial')return fail('breeding.artificial-egg.wrong-command','Artificial planning requires feature-artificial create-source-egg.');const source=parseAuthoritativeBreedingArtificialEggSourceAuthorityV1(input.sourceAuthority);const handoff=parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff);const feature=playingGodContributionV1(handoff);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);const clock=parseCampaignClockV1(input.campaignClock);if(command.payload.source.providerId!==BREEDING_ARTIFICIAL_EGG_PROVIDER_ID||command.payload.source.evidenceDefinitionSha256!==source.definitionSha256||command.payload.eggId!==source.eggId||command.payload.ownerTrainerSlug!==source.ownerTrainerSlug||source.featureHandoffDefinitionSha256!==handoff.definitionSha256||source.featureContributionDefinitionSha256!==feature.definitionSha256||source.capturedAtCampaignMinute!==clock.campaignMinute)return fail('breeding.artificial-egg.stale-authority','Artificial command and all source authority must share one exact checkpoint.');const offers=array(input.offers,'artificialPlanInput.offers',32).map(value=>parseAuthoritativeBreedingOptionOfferRecordV1(value));const selected=select(command,source,offers,clock.campaignMinute,options.definitionSha256);const speciesId=parseBreedingSpeciesIdSyntax(one(selected.values,'species',true)!.option.canonicalValueId)??fail('breeding.artificial-egg.invalid-choice','Artificial Species must be canonical.');if(speciesId!==breedingArtificialEggSpeciesIdV1(feature))return fail('breeding.artificial-egg.invalid-choice','Artificial Species must equal the current Playing God parameter.');const spec=compiledBreedingSpeciesSpec(speciesId)??fail('breeding.artificial-egg.provider-unavailable','Artificial Species is absent from the registry.');const natureChoice=one(selected.values,'nature',true)!;const nature=breedingNature(natureChoice.option.canonicalValueId)??fail('breeding.artificial-egg.invalid-choice','Artificial Nature must be canonical.');const abilityChoice=one(selected.values,'primary-ability',true)!;const abilityId=parseBreedingAbilityIdSyntax(abilityChoice.option.canonicalValueId);if(!abilityId||!spec.basicAbilityIds.includes(abilityId)||!canonicalBreedingAbilityIdentity(abilityId))return fail('breeding.artificial-egg.invalid-choice','Artificial Ability must be a current Basic Ability.');const rank=breedingArtificialEggTechnologyRankV1(feature);const upgradeChoices=selected.values.filter(value=>value.slot.startsWith('upgrade-')).sort((left,right)=>compare(left.slot,right.slot));if(upgradeChoices.length!==rank||upgradeChoices.some((value,index)=>value.slot!==`upgrade-${index+1}`))return fail('breeding.artificial-egg.invalid-choice',`Artificial upgrades must select every rank-bound ordinal exactly once: ${upgradeChoices.map(value=>value.slot).join(',')} rank ${rank}.`);let coloration:null|typeof POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS[number]=null;const moves:string[]=[];const stats:{-readonly [Key in keyof PokemonEggPlayingGodBaseStatIncreasesV1]:number}={hp:0,atk:0,def:0,satk:0,sdef:0,spd:0};for(const choice of upgradeChoices){const value=choice.option.canonicalValueId;if(value.startsWith('coloration:')){const id=value.slice(11);if(coloration!==null||!POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS.includes(id as never))return fail('breeding.artificial-egg.invalid-choice','Artificial coloration may be selected at most once.');coloration=id as typeof POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS[number]}else if(value.startsWith('move:')){const id=parseBreedingMoveIdSyntax(value.slice(5));if(!id||!legalMoveIds(speciesId).includes(id)||moves.includes(id)||moves.length>=3)return fail('breeding.artificial-egg.invalid-choice','Artificial Move upgrades must be unique legal Egg/Tutor Moves, at most three.');moves.push(id)}else if(value.startsWith('base-stat:')){const id=value.slice(10) as keyof PokemonEggPlayingGodBaseStatIncreasesV1;if(!Object.hasOwn(stats,id)||Object.values(stats).reduce((sum,current)=>sum+current,0)>=5)return fail('breeding.artificial-egg.invalid-choice','Artificial Base Stat upgrades are bounded to five Vitamins.');stats[id]+=1}else return fail('breeding.artificial-egg.invalid-choice','Artificial upgrade kind is unknown.')}
  moves.sort(compare);const genderRequired=spec.genderPolicy.kind!=='genderless';const durationRandom=options.values['breeding.hatch-duration-variation']==='server-random-half-to-double';const expectedKinds=[...(genderRequired?['gender' as const]:[]),...(durationRandom?['hatch-duration' as const]:[])];if(!same(command.payload.resolutions.requestedRollKinds,expectedKinds))return fail('breeding.artificial-egg.invalid-roll-set','Artificial requested roll kinds must exactly match Gender and duration policy.');const sourceHashes=breedingArtificialEggRollSourceDefinitionHashes({command,sourceAuthority:source,featureProviderHandoff:handoff,campaignOptionSnapshot:options,offers});const rawRolls=array(input.rolls,'artificialPlanInput.rolls',2);if(rawRolls.length!==expectedKinds.length)return fail('breeding.artificial-egg.invalid-roll-set','Artificial persisted roll count must match exact requirements.');let ordinal=0;const genderRoll=genderRequired?verifyRoll(rawRolls[ordinal],command,ordinal++,'gender-d100',sourceHashes,clock.campaignMinute):null;const durationRoll=durationRandom?verifyRoll(rawRolls[ordinal],command,ordinal++,'hatch-duration-percentage',sourceHashes,clock.campaignMinute):null;let gender:'female'|'male'|'genderless'='genderless';if(spec.genderPolicy.kind!=='genderless'){if(!genderRoll||genderRoll.formula!=='1d100'||genderRoll.dieSides!==100)return fail('breeding.artificial-egg.invalid-roll-set','Artificial Gender requires one d100.');gender=genderRoll.total<=spec.genderPolicy.femalePercent?'female':'male'}
  const durationChoice=one(selected.values,'hatch-duration',false);if((options.values['breeding.hatch-duration-variation']==='gm-within-half-to-double')!==(durationChoice!==null))return fail('breeding.artificial-egg.invalid-choice','Artificial GM duration policy requires exactly one bounded target.');const durationMatch=durationChoice?.option.canonicalValueId.match(/^campaign-minutes:(360|720|1080|1440)$/u)??null;const duration=resolveBreedingHatchDuration({speciesId,sourceKind:'feature-artificial',options,durationOverride:{authorityKind:'authoritative-provider',authorityId:BREEDING_ARTIFICIAL_EGG_PROVIDER_ID,evidenceId:source.featureContributionDefinitionSha256.slice(0,32),authorityDefinitionSha256:source.featureContributionDefinitionSha256,campaignMinutes:720},variationRoll:durationRoll?{rollId:durationRoll.rollRecordId,total:durationRoll.total}:null,gmTarget:durationChoice&&durationMatch?{optionId:durationChoice.option.optionId,evidenceId:slotEvidenceId('hatch-duration'),targetCampaignMinutes:Number(durationMatch[1])}:null});if(duration.status!=='resolved'||duration.targetCampaignMinutes>1440)return fail('breeding.artificial-egg.provider-unavailable','Artificial hatch duration must resolve within one campaign day.');const babyChoice=one(selected.values,'baby-template',false);let babyInput:Parameters<typeof resolveBreedingBabyTemplate>[1]=null;if(babyChoice){const match=/^baby-template:apply:size-percent:(50|5[1-9]|[6-9][0-9]|100)$/u.exec(babyChoice.option.canonicalValueId);const decline=babyChoice.option.canonicalValueId==='baby-template:decline';if(!decline&&!match)return fail('breeding.artificial-egg.invalid-choice','Artificial Baby Template option is malformed.');babyInput={optionId:babyChoice.option.optionId,evidenceId:slotEvidenceId('baby-template'),apply:!decline,sizePercentOfAdult:match?Number(match[1]):null}}const baby=resolveBreedingBabyTemplate(options,babyInput);const starting=resolveBreedingHatchStartingLevel('feature-artificial',options);if(baby.status!=='resolved'||starting.status!=='resolved')return fail('breeding.artificial-egg.provider-unavailable','Artificial starting Level and Baby Template policy must resolve.');const candidates=moves.map(moveId=>({moveId:parseBreedingMoveIdSyntax(moveId)!,sources:[{kind:'source-authority' as const,authorityKind:'feature-provider' as const,authorityId:BREEDING_ARTIFICIAL_EGG_PROVIDER_ID,evidenceDefinitionSha256:feature.definitionSha256}] }));const bounded=<Value extends string>(choice:Selected,valueId:Value)=>({valueId,resolutionKind:'rank-choice' as const,rollRecordId:null,optionId:choice.option.optionId,choiceEvidenceId:slotEvidenceId(choice.slot)});const blueprint=createPokemonEggOffspringBlueprintV1({schemaVersion:1,speciesId,familyRootSpeciesId:spec.familyRootSpeciesId,speciesSpecDefinitionSha256:spec.definitionSha256,nature:bounded(natureChoice,nature.id),ability:bounded(abilityChoice,abilityId),gender:{valueId:gender,resolutionKind:'random',rollRecordId:genderRoll?.rollRecordId??null,optionId:null,choiceEvidenceId:null},inheritanceCandidates:candidates,providerTraits:{serpentsMark:null,fossilRestoration:null,prehistoricBond:null,marsupial:null,playingGod:{sourceTrainerSlug:source.ownerTrainerSlug,sourceTrainerRevision:source.ownerTrainerRevision,featureContributionDefinitionSha256:feature.definitionSha256,featureHandoffDefinitionSha256:handoff.definitionSha256,chemistryAuthorityDefinitionSha256:source.definitionSha256,technologyEducationRank:rank,colorationContestStatId:coloration,inheritanceMoveIds:moves.map(id=>parseBreedingMoveIdSyntax(id)!),baseStatIncreases:stats,upgradeOptionIds:upgradeChoices.map(value=>value.option.optionId).sort(compare)}},startingLevel:5,babyTemplate:{applied:baby.applied,choiceOptionId:baby.choiceOptionId,choiceEvidenceId:baby.choiceEvidenceId,effects:baby.effects}});const identity=canonicalBreedingSpeciesIdentity(speciesId)!;const definitionHashes=[BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256,BREEDING_CANONICAL_ID_DEFINITION_SHA256,BREEDING_NATURE_DEFINITION_SHA256,COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256,source.definitionSha256,handoff.definitionSha256,feature.definitionSha256,options.definitionSha256,spec.definitionSha256,identity.sourceRecordSha256,blueprint.definitionSha256,starting.resultDefinitionSha256,baby.resultDefinitionSha256,duration.resultDefinitionSha256,...(baby.applied?[BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256]:[]),...offers.map(value=>value.definitionSha256),...rawRolls.map(value=>parseAuthoritativeBreedingRollRecordV1(value).definitionSha256),...moves.map(id=>canonicalBreedingMoveIdentity(id)!.sourceRecordSha256)].filter((value,index,all)=>all.indexOf(value)===index).sort(compare);const egg=parseAuthoritativePokemonEggDocumentV1({schemaVersion:1,eggId:command.payload.eggId,revision:0,status:'incubating',ownerTrainerSlug:source.ownerTrainerSlug,source:command.payload.source,ruleset:command.ruleset,definitionHashes,parents:[],breeder:null,offspring:blueprint,incubation:{averageCampaignMinutes:duration.averageCampaignMinutes,targetCampaignMinutes:duration.targetCampaignMinutes,accumulatedCampaignMinutes:0,variationPolicyId:duration.variationPolicyId,durationResultDefinitionSha256:duration.resultDefinitionSha256,lastAppliedClockRevision:clock.revision,lastAppliedClockMinute:clock.campaignMinute,readyAtCampaignMinute:null,readinessKind:null,readyOperationId:null,paused:false,pauseReasonId:null,pauseOperationId:null},special:{state:'not-rolled',rollRecordId:null,rollTotal:null,triggerIds:[],adjudicationId:null,outcomeId:null,automaticShiny:false},hatchOperationId:null,childSheetSlug:null,terminal:null,createdAtCampaignMinute:clock.campaignMinute,updatedAtCampaignMinute:clock.campaignMinute,statusChangedAtCampaignMinute:clock.campaignMinute,lastOperationId:command.operationId});return Object.freeze({egg,consumedOffers:selected.successors})
}

export const breedingArtificialEggDependencyEvidenceV1=(input:{readonly sourceAuthority:unknown,readonly campaignOptionSnapshot:unknown,readonly speciesId:unknown}):readonly BreedingDependencyEvidenceV1[]=>{const source=parseAuthoritativeBreedingArtificialEggSourceAuthorityV1(input.sourceAuthority);const options=parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot);const speciesId=parseBreedingSpeciesIdSyntax(input.speciesId)??fail('breeding.artificial-egg.invalid-request','Artificial dependency Species must be canonical.');const species=compiledBreedingSpeciesSpec(speciesId)??fail('breeding.artificial-egg.provider-unavailable','Artificial dependency Species unavailable.');const values:BreedingDependencyEvidenceV1[]=[{providerKind:'feature',providerId:BREEDING_ARTIFICIAL_EGG_PROVIDER_ID,subjectKind:'trainer-sheet',subjectId:source.ownerTrainerSlug,subjectRevision:source.ownerTrainerRevision,checkpoint:'egg-acceptance',providerDefinitionSha256:featureContractJson.definitionSha256,effectiveEvidenceSha256:source.featureContributionDefinitionSha256},{providerKind:'item',providerId:'item.chemistry-set',subjectKind:'trainer-sheet',subjectId:source.ownerTrainerSlug,subjectRevision:source.ownerTrainerRevision,checkpoint:'egg-acceptance',providerDefinitionSha256:chemistryInventory.recordSha256,effectiveEvidenceSha256:source.chemistryInventoryRowDefinitionSha256},{providerKind:'system',providerId:BREEDING_ARTIFICIAL_EGG_SOURCE_PROVIDER_ID,subjectKind:'trainer-sheet',subjectId:source.ownerTrainerSlug,subjectRevision:source.ownerTrainerRevision,checkpoint:'egg-acceptance',providerDefinitionSha256:BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256,effectiveEvidenceSha256:source.definitionSha256},{providerKind:'campaign-option',providerId:BREEDING_ARTIFICIAL_EGG_OPTIONS_PROVIDER_ID,subjectKind:'campaign',subjectId:'campaign',subjectRevision:null,checkpoint:'egg-acceptance',providerDefinitionSha256:options.rulesetDefinitionSha256,effectiveEvidenceSha256:options.definitionSha256},{providerKind:'species-registry',providerId:BREEDING_ARTIFICIAL_EGG_SPECIES_PROVIDER_ID,subjectKind:'campaign',subjectId:'campaign',subjectRevision:null,checkpoint:'egg-acceptance',providerDefinitionSha256:COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,effectiveEvidenceSha256:species.definitionSha256}];return Object.freeze(values.sort((a,b)=>compare(`${a.providerKind}\0${a.providerId}`,`${b.providerKind}\0${b.providerId}`)).map(value=>Object.freeze(value)))}
export const spendBreedingArtificialEggCostV1=(input:{readonly trainerSheet:unknown,readonly sourceAuthority:unknown,readonly operationId:unknown,readonly updatedAt:unknown}):Record<string,unknown>=>{const trainer=strictStoredTrainer(input.trainerSheet);const source=parseAuthoritativeBreedingArtificialEggSourceAuthorityV1(input.sourceAuthority);if(trainer.slug!==source.ownerTrainerSlug||trainer.revision!==source.ownerTrainerRevision||sha256(trainer.document)!==source.ownerTrainerDefinitionSha256||typeof input.operationId!=='string'||!Number.isSafeInteger(input.updatedAt))return fail('breeding.artificial-egg.stale-authority','Artificial cost mutation requires the exact frozen Trainer revision and operation metadata.');const currentMoney=Number((trainer.document as unknown as TrainerSheet).money??0);const matches=inventoryRows(trainer.document as unknown as TrainerSheet).filter(row=>row.id===source.chemistryInventoryEntryId);const row=matches.length===1?matches[0]:null;const quantity=row&&Number.isSafeInteger(row.qty??1)?Number(row.qty??1):0;if(currentMoney!==source.moneyBefore||!row||row.name!=='Chemistry Set'||sha256(row)!==source.chemistryInventoryRowDefinitionSha256||source.chemistryUnitOrdinal>=quantity)return fail('breeding.artificial-egg.stale-authority','Artificial cost or Chemistry Set custody changed before settlement.');return Object.freeze({...trainer.document,money:source.moneyAfter,revision:trainer.revision+1,updatedAt:input.updatedAt,lastBreedingOperationId:input.operationId})}
export const projectBreedingArtificialEggCreationV1=(input:{readonly egg:unknown,readonly audience:'gm'|'owner'}):BreedingArtificialEggCreationProjectionV1=>{const egg=parseAuthoritativePokemonEggDocumentV1(input.egg);if((input.audience!=='gm'&&input.audience!=='owner')||egg.source.kind!=='feature-artificial'||egg.status!=='incubating'||egg.revision!==0||egg.offspring.startingLevel!==5||!egg.offspring.providerTraits.playingGod)return fail('breeding.artificial-egg.stale-authority','Artificial projection requires one committed revision-zero source Egg.');return parseBreedingArtificialEggCreationProjectionV1({schemaVersion:1,audience:input.audience,eggId:egg.eggId,eggRevision:0,sourceKind:'feature-artificial',status:'incubating',startingLevel:5,upgradeCount:egg.offspring.providerTraits.playingGod.technologyEducationRank,createdAtCampaignMinute:egg.createdAtCampaignMinute,operationId:egg.lastOperationId})}
