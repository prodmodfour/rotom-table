import { createHash } from 'node:crypto'
import edgesJson from '../../../data/reference/edges.json'
import featuresJson from '../../../data/reference/features.json'
import itemsJson from '../../../data/reference/items.json'
import pokedexJson from '../../../data/reference/pokedex.json'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import sourceAdjudicationsJson from '../../../data/breeding-automation/source-adjudications.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, type StrictJsonObject } from '#shared/automation/strictJson'
import type { PokemonEggDocumentV1, PokemonEggFossilStatId, PokemonEggProviderTraitsV1 } from '#shared/breeding/egg'
import {
  parseBreedingFossilEggCreationProjectionV1,
  parseBreedingFossilReanimationAuthorityV1,
  parseBreedingFossilSourceAuthorityV1,
  type BreedingFossilEggCreationProjectionV1,
  type BreedingFossilReanimationAuthorityV1,
  type BreedingFossilSourceAuthorityV1,
} from '#shared/breeding/fossilEgg'
import {
  parseBreedingAbilityIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingAbilityId,
  type BreedingOfferId,
  type BreedingOfferOptionId,
} from '#shared/breeding/ids'
import type { BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import type { EffectiveEdgeSet } from '#shared/edgeAutomation/effective'
import { normalizedEdgeIdentityKey } from '#shared/edgeAutomation/catalog'
import type { PokedexRecord } from '~/types/pokemon'
import type { InventoryEntry, SkillRank, TrainerSheet } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { adjustedNatureModForStat } from '~/utils/ptuNatures'
import { createBreedingOptionOfferRecordV1, createBreedingOptionOfferRevisionV1, parseAuthoritativeBreedingOptionOfferRecordV1, parseAuthoritativeBreedingRollRecordV1 } from './ledgers'
import { createBreedingOperationCommandHash } from './operations'
import { resolveEffectiveEdges } from '../edgeAutomation/effectiveEdges'
import { EDGE_AUTOMATION_RUNTIME_REGISTRY } from '../edgeAutomation/registry'
import { planTrainerEdgeCampaignOperation, type EdgeCampaignOperationPlan } from '../edgeAutomation/campaignOperations'
import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from '../featureAutomation/registry'
import { parseBreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import { parseAuthoritativeBreedingFeatureProviderHandoffV1 } from './featureProviderHandoff'
import { BREEDING_MODIFIER_PROVIDER_INVENTORY_DEFINITION_SHA256 } from './modifierProviderHandoff'
import { canonicalBreedingAbilityIdentity, canonicalBreedingMoveIdentity, canonicalBreedingSpeciesIdentity, BREEDING_CANONICAL_ABILITIES, BREEDING_CANONICAL_ID_DEFINITION_SHA256 } from './canonicalIds'
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

export const BREEDING_FOSSIL_EGG_POLICY_ID = 'breeding-fossil-egg-v1' as const
export const BREEDING_FOSSIL_SOURCE_PROVIDER_ID = 'breeding.fossil-source.v1' as const
export const BREEDING_FOSSIL_POLICY_PROVIDER_ID = 'breeding.fossil-egg.v1' as const
export const BREEDING_FOSSIL_SPECIES_PROVIDER_ID = 'breeding.fossil-species.v1' as const
export const BREEDING_FOSSIL_OPTIONS_PROVIDER_ID = 'breeding.fossil-options.v1' as const
export const BREEDING_FOSSIL_PALEONTOLOGIST_PROVIDER_ID = 'Paleontologist' as const
export const BREEDING_FOSSIL_REANIMATION_MACHINE_PROVIDER_ID = 'item.reanimation-machine' as const

const PREHISTORIC_BOND_HELD_ITEM_RESTRICTION = 'This Held Item may only be used by Pokémon revived from Fossils.' as const
const HELD_ITEM_BY_STAT = Object.freeze({
  hp: Object.freeze({ id: 'relic-crown', name: 'Relic Crown', effect: 'The holder gains a +2 Bonus to all Save Checks.' }),
  atk: Object.freeze({ id: 'primal-frame', name: 'Primal Frame', effect: 'The holder’s damaging attacks have their Critical Hit Range extended by +1.' }),
  def: Object.freeze({ id: 'prehistoric-razors', name: 'Prehistoric Razors', effect: 'When a foe hits the holder with a damaging Melee Attack, the holder may cause them to lose a Tick of Hit Points as a Reaction.' }),
  satk: Object.freeze({ id: 'primal-cloak', name: 'Primal Cloak', effect: 'The holder’s damaging attacks have their Effect Range extended by +1.' }),
  sdef: Object.freeze({ id: 'prehistoric-aegis', name: 'Prehistoric Aegis', effect: 'The holder gains 5 Damage Reduction against Ranged Attacks.' }),
  spd: Object.freeze({ id: 'relic-sash', name: 'Relic Sash', effect: 'The holder gains +2 Evasion against Status Moves.' }),
} satisfies Readonly<Record<PokemonEggFossilStatId, { readonly id: string, readonly name: string, readonly effect: string }>>)

export const BREEDING_FOSSIL_EGG_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: BREEDING_FOSSIL_EGG_POLICY_ID,
  sourceAdjudicationId: 'BR-SRC-012' as const,
  sourceAdjudicationsSha256: SOURCE_ADJUDICATIONS_SHA256,
  modifierInventoryDefinitionSha256: BREEDING_MODIFIER_PROVIDER_INVENTORY_DEFINITION_SHA256,
  sourceKind: 'fossil' as const,
  aggregate: 'shared-pokemon-egg-document-v1' as const,
  hatchPipeline: 'shared-incubation-special-child-lineage-and-reward' as const,
  requiredAuthorities: Object.freeze(['gm-designated-fossil-source','effective-paleontologist','reanimation-machine-custody'] as const),
  traits: 'bounded-gm-server-issued-offers' as const,
  parentSnapshots: 0 as const,
  breederSnapshot: null,
  inheritance: Object.freeze({ none: 'default', optional: 'gm-bounded-canonical-list', maximum: 9 }),
  providers: Object.freeze({ fossilRestoration: 'frozen-at-reanimation', prehistoricBond: 'frozen-at-reanimation' }),
  babyTemplate: 'disabled-or-one-current-bounded-per-egg-gm-choice-or-forced-marsupial' as const,
  babyTemplatePolicyDefinitionSha256: BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  heldItems: HELD_ITEM_BY_STAT,
  heldItemRestriction: PREHISTORIC_BOND_HELD_ITEM_RESTRICTION,
  sourceLossAfterAcceptance: 'non-mutating-frozen-authority' as const,
  clientAuthority: 'none' as const,
})

export const BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256 = sha256(BREEDING_FOSSIL_EGG_POLICY_DEFINITION)
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const RANK_VALUE: Readonly<Record<SkillRank, number>> = Object.freeze({ Pathetic: 1, Untrained: 2, Novice: 3, Adept: 4, Expert: 5, Master: 6 })

export type BreedingFossilEggAuthorityErrorCode =
  | 'breeding.fossil-egg.invalid-request'
  | 'breeding.fossil-egg.hash-mismatch'
  | 'breeding.fossil-egg.stale-authority'
  | 'breeding.fossil-egg.provider-ambiguous'
  | 'breeding.fossil-egg.provider-unavailable'
  | 'breeding.fossil-egg.contract-drift'
  | 'breeding.fossil-egg.invalid-choice'
  | 'breeding.fossil-egg.invalid-roll-set'
  | 'breeding.fossil-egg.wrong-command'

export class BreedingFossilEggAuthorityError extends Error {
  readonly code: BreedingFossilEggAuthorityErrorCode
  constructor(code: BreedingFossilEggAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingFossilEggAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingFossilEggAuthorityErrorCode, message: string): never => { throw new BreedingFossilEggAuthorityError(code, message) }
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function'
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.fossil-egg.invalid-request', `${label} must be one plain data object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.fossil-egg.invalid-request', `${label} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.fossil-egg.invalid-request', `${label}.${field} must be an enumerable data field.`) }
  return row
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.fossil-egg.invalid-request', `${label} must be one dense plain array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.fossil-egg.invalid-request', `${label}[${index}] must be an enumerable data entry.`) }
  return value
}
const stringChoices = (value: unknown, maximum: number, label: string): readonly string[] => Object.freeze(
  strictArray(value, maximum, label).map((entry, index) => typeof entry === 'string' && ID.test(entry)
    ? entry
    : fail('breeding.fossil-egg.invalid-choice', `${label}[${index}] must be one bounded string identifier.`)),
)
const durationChoices = (value: unknown, maximum: number, label: string): readonly string[] => Object.freeze(
  strictArray(value, maximum, label).map((entry, index) => Number.isSafeInteger(entry) && Number(entry) >= 1 && Number(entry) <= 99_999_999
    ? `campaign-minutes:${String(entry)}`
    : fail('breeding.fossil-egg.invalid-choice', `${label}[${index}] must be one bounded positive campaign-minute integer.`)),
)
const strictDocument = (value: unknown, label: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, label, {
    limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
    rootLabel: label, valueLabel: label,
    failNotJson: (_path, detail) => fail('breeding.fossil-egg.invalid-request', `${label} ${detail}`),
    failLimit: (_path, detail) => fail('breeding.fossil-egg.invalid-request', detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return fail('breeding.fossil-egg.invalid-request', `${label} must be one strict JSON object.`)
  return cloned
}
const storedTrainer = (value: unknown, label: string): { readonly slug: string, readonly revision: number, readonly document: StrictJsonObject } => {
  const row = exact(value, ['slug','revision','document'], label)
  if (typeof row.slug !== 'string' || !ID.test(row.slug) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || Number(row.revision) > 2_147_483_647) return fail('breeding.fossil-egg.invalid-request', `${label} identity and revision must be bounded values.`)
  const document = strictDocument(row.document, `${label}.document`)
  if (document.slug !== row.slug || document.revision !== row.revision) return fail('breeding.fossil-egg.stale-authority', `${label} storage identity and embedded document revision must agree exactly.`)
  return Object.freeze({ slug: row.slug, revision: Number(row.revision), document })
}
const minute = (value: unknown, label: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail('breeding.fossil-egg.invalid-request', `${label} must be a nonnegative campaign minute.`)
const inventoryEntries = (sheet: TrainerSheet): readonly InventoryEntry[] => {
  const inventory = sheet.inventory
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)
    || (Object.getPrototypeOf(inventory) !== Object.prototype && Object.getPrototypeOf(inventory) !== null)
    || Object.getOwnPropertySymbols(inventory).length > 0) {
    return fail('breeding.fossil-egg.provider-unavailable', 'Fossil authority requires one plain current Trainer inventory container.')
  }
  const entries: InventoryEntry[] = []
  for (const [category, value] of Object.entries(inventory)) {
    const rows = strictArray(value, 10_000, `trainer.inventory.${category}`)
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || (Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null)
        || Object.getOwnPropertySymbols(row).length > 0) {
        return fail('breeding.fossil-egg.invalid-request', `trainer.inventory.${category}[${index}] must be one plain inventory row.`)
      }
      const entry = row as Record<string, unknown>
      for (const field of Object.getOwnPropertyNames(entry)) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, field)
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.fossil-egg.invalid-request', `trainer.inventory.${category}[${index}].${field} must be an enumerable data field.`)
      }
      if (typeof entry.id !== 'string' || !ID.test(entry.id) || typeof entry.name !== 'string' || entry.name.length < 1 || entry.name.length > 240
        || (entry.qty !== undefined && (!Number.isSafeInteger(entry.qty) || Number(entry.qty) < 0 || Number(entry.qty) > 2_147_483_647))) {
        return fail('breeding.fossil-egg.invalid-request', `trainer.inventory.${category}[${index}] must have one bounded ID, name, and optional nonnegative quantity.`)
      }
      entries.push(row as InventoryEntry)
    }
  }
  return Object.freeze(entries)
}
const exactInventoryEntry = (trainer: ReturnType<typeof storedTrainer>, inventoryEntryId: unknown, unitOrdinal: unknown, label: string): { readonly row: InventoryEntry, readonly unitOrdinal: number } => {
  if (typeof inventoryEntryId !== 'string' || !ID.test(inventoryEntryId) || !Number.isSafeInteger(unitOrdinal) || Number(unitOrdinal) < 0 || Number(unitOrdinal) > 2_147_483_647) return fail('breeding.fossil-egg.invalid-request', `${label} must identify one bounded inventory row and unit.`)
  const matches = inventoryEntries(trainer.document as unknown as TrainerSheet).filter(row => row.id === inventoryEntryId)
  if (matches.length !== 1) return fail('breeding.fossil-egg.provider-ambiguous', `${label} must resolve exactly one current Trainer inventory row.`)
  const row = matches[0]!
  const quantity = row.qty === undefined ? 1 : Number.isSafeInteger(row.qty) ? Number(row.qty) : 0
  if (quantity < 1 || Number(unitOrdinal) >= quantity) return fail('breeding.fossil-egg.provider-unavailable', `${label} unit is not backed by current positive quantity.`)
  return Object.freeze({ row, unitOrdinal: Number(unitOrdinal) })
}
const mechanicFields = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(['prerequisites','frequency','trigger','target','condition','effect','effects','text'].filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]))
const invoke = <Value>(label: string, callback: () => Value): Value => {
  let value: Value
  try { value = callback() }
  catch (error) { if (error instanceof BreedingFossilEggAuthorityError) throw error; return fail('breeding.fossil-egg.provider-unavailable', `${label} failed closed.`) }
  if (promiseLike(value)) return fail('breeding.fossil-egg.provider-unavailable', `${label} must be synchronous.`)
  return value
}

interface ModifierInventoryEntry {
  readonly id: string
  readonly sourceKind: string
  readonly canonicalId: string
  readonly recordSha256: string
  readonly mechanicFieldsSha256: string
  readonly contributionIds: readonly string[]
  readonly snapshotCheckpoint: string
  readonly authorityOwner: string
  readonly integrationStatus: string
  readonly clientAuthority: string
}
const modifierInventory = modifierInventoryJson as unknown as { readonly definitionSha256: string, readonly definition: { readonly entries: readonly ModifierInventoryEntry[] } }
const inventoryEntry = (id: string): ModifierInventoryEntry => modifierInventory.definition.entries.find(entry => entry.id === id) ?? fail('breeding.fossil-egg.contract-drift', `Modifier inventory entry ${id} is unavailable.`)
const sourceAdjudication = (sourceAdjudicationsJson.entries as readonly { readonly id: string, readonly status: string }[]).find(entry => entry.id === 'BR-SRC-012')

const validateStaticBoundary = (): void => {
  const paleontologistRecord = (edgesJson as Readonly<Record<string, Record<string, unknown>>>)['Paleontologist']
  const machineRecord = (itemsJson as Readonly<Record<string, Record<string, unknown>>>)['Reanimation Machine']
  const restorationRecord = (featuresJson as Readonly<Record<string, Record<string, unknown>>>)['Fossil Restoration']
  const bondRecord = (featuresJson as Readonly<Record<string, Record<string, unknown>>>)['Prehistoric Bond']
  const paleontologistEntry = inventoryEntry('trainer-edge:Paleontologist')
  const machineEntry = inventoryEntry('item:Reanimation Machine')
  const restorationEntry = inventoryEntry('feature:Fossil Restoration')
  const bondEntry = inventoryEntry('feature:Prehistoric Bond')
  const runtime = EDGE_AUTOMATION_RUNTIME_REGISTRY.require('trainer', 'Paleontologist')
  const adjudicationHash = sha256(sourceAdjudicationsJson)
  const sourceAdjudicationHash = (sourceAdjudicationsJson as { readonly definitionSha256?: string }).definitionSha256
  if (modifierInventory.definitionSha256 !== BREEDING_MODIFIER_PROVIDER_INVENTORY_DEFINITION_SHA256
    || SOURCE_ADJUDICATIONS_SHA256 !== adjudicationHash
    || !sourceAdjudication || sourceAdjudication.status !== 'accepted' || !paleontologistRecord || !machineRecord || !restorationRecord || !bondRecord
    || (sourceAdjudicationHash !== undefined && sourceAdjudicationHash !== adjudicationHash)
    || paleontologistEntry.recordSha256 !== sha256(paleontologistRecord) || paleontologistEntry.mechanicFieldsSha256 !== sha256(mechanicFields(paleontologistRecord))
    || paleontologistEntry.snapshotCheckpoint !== 'egg-acceptance' || paleontologistEntry.authorityOwner !== 'edge-automation' || paleontologistEntry.clientAuthority !== 'none'
    || machineEntry.recordSha256 !== sha256(machineRecord) || machineEntry.mechanicFieldsSha256 !== sha256(mechanicFields(machineRecord))
    || machineEntry.snapshotCheckpoint !== 'egg-acceptance' || machineEntry.authorityOwner !== 'item-custody' || machineEntry.clientAuthority !== 'none'
    || restorationEntry.recordSha256 !== sha256(restorationRecord) || restorationEntry.mechanicFieldsSha256 !== sha256(mechanicFields(restorationRecord))
    || bondEntry.recordSha256 !== sha256(bondRecord) || bondEntry.mechanicFieldsSha256 !== sha256(mechanicFields(bondRecord))
    || !runtime.spec.actions.some(action => action.id === 'reanimate-fossil')
    || typeof bondRecord.effect !== 'string'
    || !String(bondRecord.effect).includes(PREHISTORIC_BOND_HELD_ITEM_RESTRICTION)
    || Object.values(HELD_ITEM_BY_STAT).some(item => !String(bondRecord.effect).includes(`${item.name}: ${item.effect}`))) {
    return fail('breeding.fossil-egg.contract-drift', 'Fossil adjudication, canonical providers, runtime declarations, held-item table, or modifier inventory drifted.')
  }
}

export const parseAuthoritativeBreedingFossilSourceAuthorityV1 = (value: unknown, path = 'fossilSourceAuthority'): BreedingFossilSourceAuthorityV1 => {
  const parsed = parseBreedingFossilSourceAuthorityV1(value, path)
  const { definitionSha256: _hash, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.fossil-egg.hash-mismatch', `${path} definition hash is not authoritative.`)
  return parsed
}
export const parseAuthoritativeBreedingFossilReanimationAuthorityV1 = (value: unknown, path = 'fossilReanimationAuthority'): BreedingFossilReanimationAuthorityV1 => {
  const parsed = parseBreedingFossilReanimationAuthorityV1(value, path)
  const { definitionSha256: _hash, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.fossil-egg.hash-mismatch', `${path} definition hash is not authoritative.`)
  return parsed
}

export const createBreedingFossilSourceAuthorityV1 = (inputValue: {
  readonly eggId: unknown
  readonly sourceId: unknown
  readonly ownerTrainerSheet: unknown
  readonly custody: unknown
  readonly capturedAtCampaignMinute: unknown
}): BreedingFossilSourceAuthorityV1 => {
  validateStaticBoundary()
  const input = exact(inputValue, ['eggId','sourceId','ownerTrainerSheet','custody','capturedAtCampaignMinute'], 'fossilSourceAuthorityInput')
  const trainer = storedTrainer(input.ownerTrainerSheet, 'fossilSourceAuthorityInput.ownerTrainerSheet')
  const custody = exact(input.custody, ['inventoryEntryId','unitOrdinal'], 'fossilSourceAuthorityInput.custody')
  const source = exactInventoryEntry(trainer, custody.inventoryEntryId, custody.unitOrdinal, 'fossilSourceAuthorityInput.custody')
  const parsedEggId = typeof input.eggId === 'string' ? input.eggId : ''
  const parsedSourceId = typeof input.sourceId === 'string' && ID.test(input.sourceId) ? input.sourceId : ''
  if (!/^pokemon-egg:v1:[0-9a-f]{32}$/u.test(parsedEggId) || !parsedSourceId) return fail('breeding.fossil-egg.invalid-request', 'Fossil source must bind one future Egg and stable source identity.')
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    eggId: parsedEggId,
    sourceId: parsedSourceId,
    ownerTrainerSlug: trainer.slug,
    ownerTrainerRevision: trainer.revision,
    ownerTrainerDefinitionSha256: sha256(trainer.document),
    sourceInventoryEntryId: source.row.id,
    sourceUnitOrdinal: source.unitOrdinal,
    sourceInventoryEntryDefinitionSha256: sha256(source.row),
    designationReasonId: 'breeding.fossil-source.gm-designated' as const,
    capturedAtCampaignMinute: minute(input.capturedAtCampaignMinute, 'fossilSourceAuthorityInput.capturedAtCampaignMinute'),
  })
  return parseAuthoritativeBreedingFossilSourceAuthorityV1({ ...definition, definitionSha256: sha256(definition) })
}

export interface BreedingFossilReanimationDependencies {
  readonly resolveEffectiveEdges?: (input: Parameters<typeof resolveEffectiveEdges>[0]) => EffectiveEdgeSet
  readonly resolveTrainerSkills?: typeof resolveTrainerSkills
  readonly planTrainerEdgeCampaignOperation?: typeof planTrainerEdgeCampaignOperation
}
export const createBreedingFossilReanimationAuthorityV1 = (inputValue: {
  readonly ownerTrainerSheet: unknown
  readonly sourceAuthority: unknown
  readonly reanimationMachineCustody: unknown
  readonly capturedAtCampaignMinute: unknown
}, dependencies: BreedingFossilReanimationDependencies = {}): BreedingFossilReanimationAuthorityV1 => {
  validateStaticBoundary()
  const input = exact(inputValue, ['ownerTrainerSheet','sourceAuthority','reanimationMachineCustody','capturedAtCampaignMinute'], 'fossilReanimationAuthorityInput')
  const trainer = storedTrainer(input.ownerTrainerSheet, 'fossilReanimationAuthorityInput.ownerTrainerSheet')
  const source = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  const captured = minute(input.capturedAtCampaignMinute, 'fossilReanimationAuthorityInput.capturedAtCampaignMinute')
  if (source.ownerTrainerSlug !== trainer.slug || source.ownerTrainerRevision !== trainer.revision
    || source.ownerTrainerDefinitionSha256 !== sha256(trainer.document) || source.capturedAtCampaignMinute !== captured) return fail('breeding.fossil-egg.stale-authority', 'Fossil source, Trainer document, and campaign checkpoint must agree exactly.')
  const currentSource = exactInventoryEntry(trainer, source.sourceInventoryEntryId, source.sourceUnitOrdinal, 'fossilReanimationAuthorityInput.sourceAuthority')
  if (sha256(currentSource.row) !== source.sourceInventoryEntryDefinitionSha256) return fail('breeding.fossil-egg.stale-authority', 'GM-designated fossil source inventory evidence changed before reanimation.')
  const custody = exact(input.reanimationMachineCustody, ['inventoryEntryId','unitOrdinal'], 'fossilReanimationAuthorityInput.reanimationMachineCustody')
  const tool = exactInventoryEntry(trainer, custody.inventoryEntryId, custody.unitOrdinal, 'fossilReanimationAuthorityInput.reanimationMachineCustody')
  if (tool.row.id === source.sourceInventoryEntryId || tool.row.name !== 'Reanimation Machine') return fail('breeding.fossil-egg.provider-unavailable', 'Reanimation Machine custody must resolve one distinct exact canonical item row.')
  const sheet = trainer.document as unknown as TrainerSheet
  const resolver = dependencies.resolveEffectiveEdges ?? resolveEffectiveEdges
  const effectiveSet = cloneStrictJson(invoke('Effective Paleontologist Edge resolution', () => resolver({ ownerId: trainer.slug, family: 'trainer', sheet })), 'effectivePaleontologistEdges', {
    limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
    rootLabel: 'Effective Paleontologist Edge projection', valueLabel: 'Effective Paleontologist Edge projection',
    failNotJson: (_path, detail) => fail('breeding.fossil-egg.provider-unavailable', `Effective Paleontologist Edge projection ${detail}`),
    failLimit: (_path, detail) => fail('breeding.fossil-egg.provider-unavailable', detail),
  }) as unknown as EffectiveEdgeSet
  if (!effectiveSet || effectiveSet.ownerId !== trainer.slug || effectiveSet.family !== 'trainer' || !Array.isArray(effectiveSet.instances) || !Array.isArray(effectiveSet.unresolved)) return fail('breeding.fossil-egg.provider-unavailable', 'Effective Paleontologist Edge resolver returned an invalid projection.')
  if (effectiveSet.unresolved.some(entry => typeof entry?.rawName === 'string' && normalizedEdgeIdentityKey(entry.rawName) === normalizedEdgeIdentityKey('Paleontologist'))) return fail('breeding.fossil-egg.provider-ambiguous', 'Paleontologist identity must have no unresolved current duplicate.')
  const candidates = effectiveSet.instances.filter(entry => entry.family === 'trainer' && entry.canonicalId === 'Paleontologist')
  if (candidates.length !== 1 || !candidates[0]!.effective || candidates[0]!.parameterStatus !== 'ready') return fail(candidates.length > 1 ? 'breeding.fossil-egg.provider-ambiguous' : 'breeding.fossil-egg.provider-unavailable', 'Exactly one current effective parameter-ready Paleontologist Edge is required.')
  const candidate = candidates[0]!
  const runtime = EDGE_AUTOMATION_RUNTIME_REGISTRY.require('trainer', 'Paleontologist')
  const edgeEntry = inventoryEntry('trainer-edge:Paleontologist')
  if (candidate.definitionHash !== runtime.definitionHash || !same(candidate.mechanics, runtime.spec.mechanics) || !same(candidate.actions, runtime.spec.actions)) return fail('breeding.fossil-egg.contract-drift', 'Effective Paleontologist projection drifted from the reviewed Edge runtime.')
  const skills = cloneStrictJson(invoke('Paleontologist Skill resolution', () => (dependencies.resolveTrainerSkills ?? resolveTrainerSkills)(sheet)), 'paleontologistSkills', {
    limits: { depth: 8, nodes: 2_000, objectFields: 100, arrayEntries: 100, stringLength: 1_000, objectKeyLength: 120 },
    rootLabel: 'Paleontologist Skill projection', valueLabel: 'Paleontologist Skill projection',
    failNotJson: (_path, detail) => fail('breeding.fossil-egg.provider-unavailable', `Paleontologist Skill projection ${detail}`),
    failLimit: (_path, detail) => fail('breeding.fossil-egg.provider-unavailable', detail),
  }) as unknown as ReturnType<typeof resolveTrainerSkills>
  if (!Array.isArray(skills)) return fail('breeding.fossil-egg.provider-unavailable', 'Paleontologist Skill projection must be one current array.')
  const pokeEd = skills.find(skill => skill.key === 'pokeEd')
  const survival = skills.find(skill => skill.key === 'survival')
  if (!pokeEd || !survival || !(pokeEd.rank in RANK_VALUE) || !(survival.rank in RANK_VALUE)) return fail('breeding.fossil-egg.provider-unavailable', 'Current Pokémon Education and Survival ranks are required.')
  const selected = RANK_VALUE[pokeEd.rank] >= RANK_VALUE.Novice ? { id: 'pokemon-education' as const, skill: pokeEd }
    : RANK_VALUE[survival.rank] >= RANK_VALUE.Novice ? { id: 'survival' as const, skill: survival } : null
  if (!selected) return fail('breeding.fossil-egg.provider-unavailable', 'Paleontologist requires current Novice Pokémon Education or Novice Survival.')
  const resources = {
    money: 0,
    items: Object.freeze(Object.fromEntries(inventoryEntries(sheet).map(entry => [entry.name, Number.isSafeInteger(entry.qty) ? Number(entry.qty) : 1]))),
    tools: new Set(['reanimation-machine'] as const),
    dailyUses: Object.freeze({}),
  }
  const plan = invoke('Paleontologist Edge campaign planning', () => (dependencies.planTrainerEdgeCampaignOperation ?? planTrainerEdgeCampaignOperation)(sheet, { actionId: 'reanimate-fossil' }, resources, { effectiveEdgeSet: effectiveSet }))
  if (!plan || plan.ok !== true || plan.sourceEdge !== 'Paleontologist' || plan.actionId !== 'reanimate-fossil' || plan.reasonCode !== null
    || plan.moneyDelta !== 0 || Object.keys(plan.itemDeltas).length !== 0 || Object.keys(plan.dailyUseDeltas).length !== 0
    || !same(plan.permissionFacts, ['fossil-reanimation-permitted']) || plan.delegatedRequest !== null) return fail('breeding.fossil-egg.contract-drift', 'Edge automation did not return the exact reviewed fossil reanimation permission.')
  const machineEntry = inventoryEntry('item:Reanimation Machine')
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    sourceAuthorityDefinitionSha256: source.definitionSha256,
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: sha256(trainer.document),
    paleontologistEdgeInstanceId: candidate.instanceId,
    paleontologistEdgeRecordSha256: edgeEntry.recordSha256,
    paleontologistRuntimeDefinitionSha256: runtime.definitionHash,
    effectiveEdgeProjectionSha256: sha256(effectiveSet),
    prerequisiteSkillId: selected.id,
    prerequisiteSkillRank: selected.skill.rank as BreedingFossilReanimationAuthorityV1['prerequisiteSkillRank'],
    pokemonEducationRank: pokeEd.rank,
    survivalRank: survival.rank,
    reanimationMachineInventoryEntryId: tool.row.id,
    reanimationMachineUnitOrdinal: tool.unitOrdinal,
    reanimationMachineInventoryEntryDefinitionSha256: sha256(tool.row),
    reanimationMachineRecordSha256: machineEntry.recordSha256,
    reanimationMachineMechanicFieldsSha256: machineEntry.mechanicFieldsSha256,
    edgeOperationPlanDefinitionSha256: sha256(plan satisfies EdgeCampaignOperationPlan),
    capturedAtCampaignMinute: captured,
  })
  return parseAuthoritativeBreedingFossilReanimationAuthorityV1({ ...definition, definitionSha256: sha256(definition) })
}

export type BreedingFossilOfferSlot = 'species' | 'nature' | 'primary-ability' | 'gender' | 'inheritance-move' | 'restoration-extra-ability' | 'prehistoric-bond-stat' | 'hatch-duration' | 'baby-template'
const OFFER_KIND_BY_SLOT = Object.freeze({
  species: 'species', nature: 'nature', 'primary-ability': 'ability', gender: 'gender', 'inheritance-move': 'move',
  'restoration-extra-ability': 'ability', 'prehistoric-bond-stat': 'special-result', 'hatch-duration': 'hatch-duration',
  'baby-template': 'baby-template',
} as const)
export const breedingFossilOfferId = (operationId: string, slot: BreedingFossilOfferSlot): BreedingOfferId => (
  `breeding-offer:v1:${sha256(`breeding-fossil-offer-v1\0${operationId}\0${slot}`).slice(0,32)}` as BreedingOfferId
)
export const breedingFossilOfferOptionId = (operationId: string, slot: BreedingFossilOfferSlot, canonicalValueId: string): BreedingOfferOptionId => (
  `option:v1:${sha256(`breeding-fossil-option-v1\0${operationId}\0${slot}\0${canonicalValueId}`).slice(0,32)}` as BreedingOfferOptionId
)
const optionValueHash = (slot: BreedingFossilOfferSlot, canonicalValueId: string, sourceAuthorityDefinitionSha256: string, campaignOptionSnapshotDefinitionSha256: string): string => sha256({ schemaVersion: 1, policyDefinitionSha256: BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, sourceAuthorityDefinitionSha256, slot, canonicalValueId, ...(slot === 'baby-template' ? { babyTemplatePolicyDefinitionSha256: BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256, campaignOptionSnapshotDefinitionSha256 } : {}) })
const slotEvidenceId = (slot: BreedingFossilOfferSlot): string => `fossil-choice:${slot}`

export interface CreateBreedingFossilEggOptionOffersInputV1 {
  readonly command: unknown
  readonly sourceAuthority: unknown
  readonly trainerSheetRevision: unknown
  readonly campaignOptionSnapshot: unknown
  readonly choices: unknown
  readonly issuedAtCampaignMinute: unknown
  readonly expiresAtCampaignMinute: unknown
}
export const createBreedingFossilEggOptionOffersV1 = (inputValue: CreateBreedingFossilEggOptionOffersInputV1): readonly BreedingOptionOfferRecordV1[] => {
  validateStaticBoundary()
  const input = exact(inputValue, ['command','sourceAuthority','trainerSheetRevision','campaignOptionSnapshot','choices','issuedAtCampaignMinute','expiresAtCampaignMinute'], 'fossilOfferInput')
  const command = parseBreedingOperationCommandV1(input.command)
  const source = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  const campaignOptions = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  if (command.commandKind !== 'create-source-egg' || command.payload.source.kind !== 'fossil') return fail('breeding.fossil-egg.wrong-command', 'Fossil offers require one fossil create-source-egg command.')
  if (command.payload.eggId !== source.eggId || command.payload.source.sourceId !== source.sourceId || command.payload.source.evidenceDefinitionSha256 !== source.definitionSha256) return fail('breeding.fossil-egg.stale-authority', 'Fossil offer command and source evidence must agree exactly.')
  if (!Number.isSafeInteger(input.trainerSheetRevision) || Number(input.trainerSheetRevision) !== source.ownerTrainerRevision) return fail('breeding.fossil-egg.stale-authority', 'Fossil offer target must use the exact source-owner Trainer revision.')
  const choiceFields = ['species','nature','primaryAbility','gender','inheritanceMoves','restorationExtraAbility','prehistoricBondStat','hatchDuration',
    ...(input.choices && typeof input.choices === 'object' && Object.hasOwn(input.choices, 'babyTemplate') ? ['babyTemplate'] : []),
  ]
  const choices = exact(input.choices, choiceFields, 'fossilOfferInput.choices')
  const valuesBySlot: Readonly<Record<BreedingFossilOfferSlot, readonly string[]>> = Object.freeze({
    species: stringChoices(choices.species, 32, 'fossilOfferInput.choices.species'),
    nature: stringChoices(choices.nature, 36, 'fossilOfferInput.choices.nature'),
    'primary-ability': stringChoices(choices.primaryAbility, 16, 'fossilOfferInput.choices.primaryAbility'),
    gender: stringChoices(choices.gender, 3, 'fossilOfferInput.choices.gender'),
    'inheritance-move': stringChoices(choices.inheritanceMoves, 9, 'fossilOfferInput.choices.inheritanceMoves'),
    'restoration-extra-ability': stringChoices(choices.restorationExtraAbility, 16, 'fossilOfferInput.choices.restorationExtraAbility'),
    'prehistoric-bond-stat': stringChoices(choices.prehistoricBondStat, 6, 'fossilOfferInput.choices.prehistoricBondStat'),
    'hatch-duration': durationChoices(choices.hatchDuration, 32, 'fossilOfferInput.choices.hatchDuration'),
    'baby-template': Object.hasOwn(choices, 'babyTemplate')
      ? stringChoices(choices.babyTemplate, 52, 'fossilOfferInput.choices.babyTemplate')
      : Object.freeze([]),
  })
  const selectedSpeciesValues = valuesBySlot.species.filter(value => breedingFossilOfferOptionId(command.operationId, 'species', value) === command.payload.speciesOptionId)
  if (selectedSpeciesValues.length !== 1) return fail('breeding.fossil-egg.invalid-choice', 'Fossil Species option must identify exactly one current server Species value before dependent offers are issued.')
  const babyValues = valuesBySlot['baby-template']
  const babyChoiceRequired = campaignOptions.values['breeding.baby-template-policy'] === 'per-egg-gm-choice'
    && selectedSpeciesValues[0] !== 'kangaskhan'
  if (babyChoiceRequired !== (babyValues.length > 0)
    || (babyValues.length > 0 && (!babyValues.includes('baby-template:decline')
      || babyValues.some(value => value !== 'baby-template:decline' && !/^baby-template:apply:size-percent:(50|5[1-9]|[6-9][0-9]|100)$/u.test(value))))) {
    return fail('breeding.fossil-egg.invalid-choice', 'Fossil Baby Template offers must exist exactly under the per-Egg policy and contain only bounded decline/application values; Marsupial rejects a substitute offer.')
  }
  const issuedAt = minute(input.issuedAtCampaignMinute, 'fossilOfferInput.issuedAtCampaignMinute')
  const expiresAt = minute(input.expiresAtCampaignMinute, 'fossilOfferInput.expiresAtCampaignMinute')
  if (issuedAt !== source.capturedAtCampaignMinute || expiresAt <= issuedAt || expiresAt > issuedAt + 525_600) return fail('breeding.fossil-egg.invalid-request', 'Fossil offers must have a future bounded campaign-time expiry from the source checkpoint.')
  const commandHash = createBreedingOperationCommandHash(command)
  const sourceEvidenceId = `fossil-source:${source.definitionSha256.slice(0,32)}`
  const offers: BreedingOptionOfferRecordV1[] = []
  for (const slot of Object.keys(valuesBySlot) as BreedingFossilOfferSlot[]) {
    const values = valuesBySlot[slot]
    if (values.length === 0) continue
    if (values.some(value => !ID.test(value)) || new Set(values).size !== values.length) return fail('breeding.fossil-egg.invalid-choice', `Fossil ${slot} choices must be unique bounded canonical values.`)
    const offerId = breedingFossilOfferId(command.operationId, slot)
    const options = values.map(canonicalValueId => ({
      optionId: breedingFossilOfferOptionId(command.operationId, slot, canonicalValueId),
      kind: OFFER_KIND_BY_SLOT[slot], canonicalValueId,
      valueDefinitionSha256: optionValueHash(slot, canonicalValueId, source.definitionSha256, campaignOptions.definitionSha256),
      authorityEvidenceIds: [slotEvidenceId(slot), sourceEvidenceId].sort(compare),
    })).sort((left, right) => compare(left.optionId, right.optionId))
    offers.push(createBreedingOptionOfferRecordV1({
      schemaVersion: 1, offerId, choiceKind: OFFER_KIND_BY_SLOT[slot],
      target: { kind: 'pokemon-egg', eggId: command.payload.eggId, revision: 0 },
      chooserProfileId: command.actor.profileId, minimumPokemonEducationRank: null,
      options, issuedOperationId: command.operationId, issuedCommandSha256: commandHash,
      issuedAtCampaignMinute: issuedAt, expiresAtCampaignMinute: expiresAt,
    }))
  }
  return Object.freeze(offers.sort((left, right) => compare(`${left.choiceKind}\0${left.offerId}`, `${right.choiceKind}\0${right.offerId}`)))
}

export const breedingFossilEggDependencyEvidenceV1 = (inputValue: {
  readonly sourceAuthority: unknown
  readonly reanimationAuthority: unknown
  readonly featureProviderHandoff: unknown
  readonly campaignOptionSnapshot: unknown
  readonly speciesId: unknown
}): readonly BreedingDependencyEvidenceV1[] => {
  const input = exact(inputValue, ['sourceAuthority','reanimationAuthority','featureProviderHandoff','campaignOptionSnapshot','speciesId'], 'fossilDependencyInput')
  const source = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  const reanimation = parseAuthoritativeBreedingFossilReanimationAuthorityV1(input.reanimationAuthority)
  const feature = parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff)
  const options = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  const speciesId = parseBreedingSpeciesIdSyntax(input.speciesId) ?? fail('breeding.fossil-egg.invalid-request', 'Fossil dependency Species must be canonical syntax.')
  const species = compiledBreedingSpeciesSpec(speciesId) ?? fail('breeding.fossil-egg.provider-unavailable', 'Fossil dependency Species is absent from the compiled registry.')
  if (reanimation.sourceAuthorityDefinitionSha256 !== source.definitionSha256 || feature.trainerSheetSlug !== source.ownerTrainerSlug
    || feature.trainerSheetRevision !== source.ownerTrainerRevision || feature.checkpoint !== 'hatch-transaction'
    || feature.capturedAtCampaignMinute !== source.capturedAtCampaignMinute) return fail('breeding.fossil-egg.stale-authority', 'Fossil dependency authorities do not share one Trainer and campaign checkpoint.')
  const values: BreedingDependencyEvidenceV1[] = [
    { providerKind: 'system', providerId: BREEDING_FOSSIL_SOURCE_PROVIDER_ID, subjectKind: 'trainer-sheet', subjectId: source.ownerTrainerSlug, subjectRevision: source.ownerTrainerRevision, checkpoint: 'egg-acceptance', providerDefinitionSha256: BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, effectiveEvidenceSha256: source.definitionSha256 },
    { providerKind: 'system', providerId: BREEDING_FOSSIL_POLICY_PROVIDER_ID, subjectKind: 'pokemon-egg', subjectId: source.eggId, subjectRevision: 0, checkpoint: 'egg-acceptance', providerDefinitionSha256: BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, effectiveEvidenceSha256: reanimation.definitionSha256 },
    { providerKind: 'edge', providerId: BREEDING_FOSSIL_PALEONTOLOGIST_PROVIDER_ID, subjectKind: 'trainer-sheet', subjectId: source.ownerTrainerSlug, subjectRevision: source.ownerTrainerRevision, checkpoint: 'egg-acceptance', providerDefinitionSha256: reanimation.paleontologistEdgeRecordSha256, effectiveEvidenceSha256: reanimation.effectiveEdgeProjectionSha256 },
    { providerKind: 'item', providerId: BREEDING_FOSSIL_REANIMATION_MACHINE_PROVIDER_ID, subjectKind: 'trainer-sheet', subjectId: source.ownerTrainerSlug, subjectRevision: source.ownerTrainerRevision, checkpoint: 'egg-acceptance', providerDefinitionSha256: reanimation.reanimationMachineRecordSha256, effectiveEvidenceSha256: reanimation.reanimationMachineInventoryEntryDefinitionSha256 },
    { providerKind: 'campaign-option', providerId: BREEDING_FOSSIL_OPTIONS_PROVIDER_ID, subjectKind: 'campaign', subjectId: 'campaign', subjectRevision: null, checkpoint: 'egg-acceptance', providerDefinitionSha256: options.rulesetDefinitionSha256, effectiveEvidenceSha256: options.definitionSha256 },
    { providerKind: 'species-registry', providerId: BREEDING_FOSSIL_SPECIES_PROVIDER_ID, subjectKind: 'campaign', subjectId: 'campaign', subjectRevision: null, checkpoint: 'egg-acceptance', providerDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256, effectiveEvidenceSha256: species.definitionSha256 },
    ...feature.dependencyEvidence,
  ]
  values.sort((left, right) => compare(`${left.checkpoint}\0${left.providerKind}\0${left.providerId}\0${left.subjectKind}\0${left.subjectId}`, `${right.checkpoint}\0${right.providerKind}\0${right.providerId}\0${right.subjectKind}\0${right.subjectId}`))
  return Object.freeze(values.map(value => Object.freeze(value)))
}

interface SelectedFossilOption { readonly slot: BreedingFossilOfferSlot, readonly offer: BreedingOptionOfferRecordV1, readonly option: BreedingOptionOfferRecordV1['options'][number] }
const selectedFossilOptions = (input: { readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>, readonly source: BreedingFossilSourceAuthorityV1, readonly offers: readonly BreedingOptionOfferRecordV1[], readonly at: number, readonly campaignOptionSnapshotDefinitionSha256: string }): { readonly selected: readonly SelectedFossilOption[], readonly successors: readonly BreedingOptionOfferRecordV1[] } => {
  const commandHash = createBreedingOperationCommandHash(input.command)
  const optionIds = [input.command.payload.speciesOptionId, ...input.command.payload.resolutions.selectedOptionIds]
  if (new Set(optionIds).size !== optionIds.length) return fail('breeding.fossil-egg.invalid-choice', 'Fossil species and resolution option IDs must be globally unique.')
  const selected: SelectedFossilOption[] = []
  const successors: BreedingOptionOfferRecordV1[] = []
  const usedOffers = new Set<string>()
  for (const optionId of optionIds) {
    const matches = input.offers.map(value => parseAuthoritativeBreedingOptionOfferRecordV1(value)).filter(offer => offer.options.some(option => option.optionId === optionId))
    if (matches.length !== 1) return fail('breeding.fossil-egg.invalid-choice', 'Every fossil choice must resolve exactly one current server-issued offer.')
    const offer = matches[0]!
    if (usedOffers.has(offer.offerId) || offer.status !== 'active' || offer.revision !== 0 || offer.target.kind !== 'pokemon-egg'
      || offer.target.eggId !== input.command.payload.eggId || offer.target.revision !== 0 || offer.chooserProfileId !== input.command.actor.profileId
      || offer.issuedOperationId !== input.command.operationId || offer.issuedCommandSha256 !== commandHash
      || offer.issuedAtCampaignMinute > input.at || offer.expiresAtCampaignMinute === null || input.at >= offer.expiresAtCampaignMinute) return fail('breeding.fossil-egg.invalid-choice', 'Fossil offers must be active, unexpired, command-bound, GM-bound, and targeted to this future Egg.')
    const option = offer.options.find(value => value.optionId === optionId)!
    const slot = (Object.keys(OFFER_KIND_BY_SLOT) as BreedingFossilOfferSlot[]).find(candidate => option.authorityEvidenceIds.includes(slotEvidenceId(candidate)))
    if (!slot || offer.choiceKind !== OFFER_KIND_BY_SLOT[slot] || option.kind !== OFFER_KIND_BY_SLOT[slot]
      || option.valueDefinitionSha256 !== optionValueHash(slot, option.canonicalValueId, input.source.definitionSha256, input.campaignOptionSnapshotDefinitionSha256)
      || option.optionId !== breedingFossilOfferOptionId(input.command.operationId, slot, option.canonicalValueId)
      || offer.offerId !== breedingFossilOfferId(input.command.operationId, slot)) return fail('breeding.fossil-egg.invalid-choice', 'Fossil option identity, kind, canonical value, source, or policy hash drifted.')
    usedOffers.add(offer.offerId)
    selected.push(Object.freeze({ slot, offer, option }))
    successors.push(createBreedingOptionOfferRevisionV1({ ...offer, revision: 1, status: 'consumed', selectedOptionId: option.optionId, settlementOperationId: input.command.operationId, settlementCommandSha256: commandHash, settledAtCampaignMinute: input.at, settlementReasonId: null }))
  }
  if (selected.find(entry => entry.option.optionId === input.command.payload.speciesOptionId)?.slot !== 'species') return fail('breeding.fossil-egg.invalid-choice', 'speciesOptionId must select exactly one fossil Species offer.')
  return Object.freeze({ selected: Object.freeze(selected), successors: Object.freeze(successors) })
}
const one = (selected: readonly SelectedFossilOption[], slot: BreedingFossilOfferSlot, required: boolean): SelectedFossilOption | null => {
  const values = selected.filter(value => value.slot === slot)
  if (values.length > 1 || (required && values.length !== 1)) return fail('breeding.fossil-egg.invalid-choice', `Fossil ${slot} requires ${required ? 'exactly one' : 'at most one'} bounded choice.`)
  return values[0] ?? null
}
const featureContribution = (handoff: ReturnType<typeof parseAuthoritativeBreedingFeatureProviderHandoffV1>, canonicalId: 'Fossil Restoration' | 'Prehistoric Bond') => {
  const values = handoff.contributions.filter(value => value.providerCanonicalId === canonicalId)
  if (values.length > 1) return fail('breeding.fossil-egg.provider-ambiguous', `${canonicalId} must resolve at most one current effective instance.`)
  const value = values[0] ?? null
  if (!value) return null
  const inventory = inventoryEntry(`feature:${canonicalId}`)
  const runtime = FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
  const expectedValues = canonicalId === 'Fossil Restoration'
    ? [
        { contributionId: 'fossil-tutor-point-delta-minus-2', value: { kind: 'integer', value: -2 } },
        { contributionId: 'fossil-extra-basic-or-advanced-ability', value: { kind: 'flag', enabled: true } },
      ]
    : [{ contributionId: 'fossil-remnant-held-item', value: { kind: 'flag', enabled: true } }]
  if (inventory.sourceKind !== 'feature' || inventory.canonicalId !== canonicalId
    || inventory.snapshotCheckpoint !== 'hatch-transaction' || inventory.authorityOwner !== 'feature-automation'
    || inventory.integrationStatus !== 'requires-breeding-integration' || inventory.clientAuthority !== 'none'
    || value.inventoryEntryId !== inventory.id || value.providerRecordSha256 !== inventory.recordSha256
    || value.runtimeDefinitionSha256 !== runtime.definitionHash
    || value.effectiveFeatureProjectionSha256 !== handoff.effectiveFeatureProjectionSha256
    || value.trainerSheetSlug !== handoff.trainerSheetSlug || value.trainerSheetRevision !== handoff.trainerSheetRevision
    || value.trainerSheetDefinitionSha256 !== handoff.trainerSheetDefinitionSha256
    || value.checkpoint !== 'hatch-transaction' || value.readSetCheckpoint !== 'hatch-transaction'
    || value.disposition !== 'reserved-br-065' || value.capturedAtCampaignMinute !== handoff.capturedAtCampaignMinute
    || !same(value.contributionIds, inventory.contributionIds)
    || !same(value.values, expectedValues)) {
    return fail('breeding.fossil-egg.contract-drift', `${canonicalId} contribution drifted from current canonical Feature, runtime, inventory, or typed-value authority.`)
  }
  return value
}
const adjustedBaseStats = (record: PokedexRecord, natureId: string): Readonly<Record<PokemonEggFossilStatId, number>> => {
  const nature = breedingNature(natureId) ?? fail('breeding.fossil-egg.invalid-choice', 'Fossil Nature choice is not current canonical authority.')
  const source = record.base_stats
  if (!source || Object.values(source).some(value => !Number.isSafeInteger(value) || value < 1)) return fail('breeding.fossil-egg.provider-unavailable', 'Prehistoric Bond requires complete current app-owned Species Base Stats.')
  const values: Record<PokemonEggFossilStatId, number> = { hp: source.hp, atk: source.atk, def: source.def, satk: source.spatk, sdef: source.spdef, spd: source.spd }
  for (const stat of Object.keys(values) as PokemonEggFossilStatId[]) values[stat] += adjustedNatureModForStat(values[stat], stat, nature.raisesStatId, nature.lowersStatId)
  return Object.freeze(values)
}

export interface PlannedBreedingFossilEggV1 { readonly egg: PokemonEggDocumentV1, readonly consumedOffers: readonly BreedingOptionOfferRecordV1[] }
export const planBreedingFossilEggV1 = (inputValue: {
  readonly command: unknown
  readonly sourceAuthority: unknown
  readonly reanimationAuthority: unknown
  readonly featureProviderHandoff: unknown
  readonly campaignOptionSnapshot: unknown
  readonly offers: readonly unknown[]
  readonly campaignClock: unknown
  readonly hatchDurationRoll: unknown | null
}): PlannedBreedingFossilEggV1 => {
  validateStaticBoundary()
  const input = exact(inputValue, ['command','sourceAuthority','reanimationAuthority','featureProviderHandoff','campaignOptionSnapshot','offers','campaignClock','hatchDurationRoll'], 'fossilEggPlanInput')
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'create-source-egg' || command.payload.source.kind !== 'fossil') return fail('breeding.fossil-egg.wrong-command', 'Fossil Egg planning requires one fossil create-source-egg command.')
  const source = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  const reanimation = parseAuthoritativeBreedingFossilReanimationAuthorityV1(input.reanimationAuthority)
  const feature = parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff)
  const options = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  const clock = parseCampaignClockV1(input.campaignClock)
  if (command.payload.eggId !== source.eggId || command.payload.ownerTrainerSlug !== source.ownerTrainerSlug
    || command.payload.source.sourceId !== source.sourceId || command.payload.source.evidenceDefinitionSha256 !== source.definitionSha256
    || command.ruleset.definitionSha256 !== options.rulesetDefinitionSha256
    || source.capturedAtCampaignMinute !== clock.campaignMinute || reanimation.sourceAuthorityDefinitionSha256 !== source.definitionSha256
    || reanimation.trainerSheetSlug !== source.ownerTrainerSlug || reanimation.trainerSheetRevision !== source.ownerTrainerRevision
    || reanimation.trainerSheetDefinitionSha256 !== source.ownerTrainerDefinitionSha256 || reanimation.capturedAtCampaignMinute !== clock.campaignMinute
    || feature.trainerSheetSlug !== source.ownerTrainerSlug || feature.trainerSheetRevision !== source.ownerTrainerRevision
    || feature.trainerSheetDefinitionSha256 !== source.ownerTrainerDefinitionSha256 || feature.checkpoint !== 'hatch-transaction'
    || feature.capturedAtCampaignMinute !== clock.campaignMinute) return fail('breeding.fossil-egg.stale-authority', 'Fossil command, source, providers, ruleset, Trainer, and clock must share one exact checkpoint.')
  const offers = strictArray(input.offers, 16, 'fossilEggPlanInput.offers')
    .map((value, index) => parseAuthoritativeBreedingOptionOfferRecordV1(value, `fossilEggPlanInput.offers[${index}]`))
  const choices = selectedFossilOptions({ command, source, offers, at: clock.campaignMinute, campaignOptionSnapshotDefinitionSha256: options.definitionSha256 })
  const speciesChoice = one(choices.selected, 'species', true)!
  const speciesId = parseBreedingSpeciesIdSyntax(speciesChoice.option.canonicalValueId) ?? fail('breeding.fossil-egg.invalid-choice', 'Fossil Species choice must be canonical syntax.')
  const speciesSpec = compiledBreedingSpeciesSpec(speciesId)
  const speciesIdentity = canonicalBreedingSpeciesIdentity(speciesId)
  const speciesRecord = speciesIdentity ? (pokedexJson as readonly PokedexRecord[])[speciesIdentity.sourceIndex] : null
  if (!speciesSpec || !speciesIdentity || !speciesRecord || speciesRecord.species !== speciesIdentity.sourceName || sha256(speciesRecord) !== speciesIdentity.sourceRecordSha256) return fail('breeding.fossil-egg.provider-unavailable', 'Fossil Species must resolve exact compiled and app-owned canonical authority.')
  const natureChoice = one(choices.selected, 'nature', true)!
  const nature = breedingNature(natureChoice.option.canonicalValueId)
  if (!nature) return fail('breeding.fossil-egg.invalid-choice', 'Fossil Nature must be a current canonical Nature offer.')
  const primaryChoice = one(choices.selected, 'primary-ability', true)!
  const primaryAbility = parseBreedingAbilityIdSyntax(primaryChoice.option.canonicalValueId)
  if (!primaryAbility || !speciesSpec.basicAbilityIds.includes(primaryAbility) || !canonicalBreedingAbilityIdentity(primaryAbility)) return fail('breeding.fossil-egg.invalid-choice', 'Fossil primary Ability must be one current compiled Basic Ability.')
  const genderChoice = one(choices.selected, 'gender', true)!
  const gender = genderChoice.option.canonicalValueId
  if (speciesSpec.genderPolicy.kind === 'genderless' ? gender !== 'genderless' : gender !== 'female' && gender !== 'male') return fail('breeding.fossil-egg.invalid-choice', 'Fossil Gender must match the compiled Species policy.')
  const moveChoices = choices.selected.filter(value => value.slot === 'inheritance-move')
  const inheritancePolicy = options.values['breeding.fossil-inheritance-policy']
  if (inheritancePolicy === 'none' && moveChoices.length !== 0 || inheritancePolicy === 'gm-bounded-canonical-list' && moveChoices.length > 9) return fail('breeding.fossil-egg.invalid-choice', 'Fossil inheritance choices must match the frozen campaign policy and nine-candidate bound.')
  const inheritanceCandidates = moveChoices.map(value => {
    const moveId = parseBreedingMoveIdSyntax(value.option.canonicalValueId)
    const identity = moveId ? canonicalBreedingMoveIdentity(moveId) : null
    if (!moveId || !identity) return fail('breeding.fossil-egg.invalid-choice', 'Fossil inheritance choices must be app-owned canonical Move IDs.')
    return Object.freeze({ moveId, sources: Object.freeze([{ kind: 'source-authority' as const, authorityKind: 'fossil' as const, authorityId: source.sourceId, evidenceDefinitionSha256: source.definitionSha256 }]) })
  }).sort((left, right) => compare(left.moveId, right.moveId))
  if (new Set(inheritanceCandidates.map(value => value.moveId)).size !== inheritanceCandidates.length) return fail('breeding.fossil-egg.invalid-choice', 'Fossil inheritance Move choices must be unique.')
  const restoration = featureContribution(feature, 'Fossil Restoration')
  const bond = featureContribution(feature, 'Prehistoric Bond')
  if (restoration && RANK_VALUE[reanimation.pokemonEducationRank] < RANK_VALUE.Novice) return fail('breeding.fossil-egg.provider-unavailable', 'Fossil Restoration requires current Novice Pokémon Education and Paleontologist authority.')
  if (bond && (!restoration || RANK_VALUE[reanimation.pokemonEducationRank] < RANK_VALUE.Expert)) return fail('breeding.fossil-egg.provider-unavailable', 'Prehistoric Bond requires current Fossil Restoration and Expert Pokémon Education.')
  let fossilRestoration: PokemonEggProviderTraitsV1['fossilRestoration'] = null
  const extraChoice = one(choices.selected, 'restoration-extra-ability', false)
  if (restoration) {
    let extraAbilityId: BreedingAbilityId
    let extraAbilityTier: 'basic' | 'advanced'
    if (speciesSpec.basicAbilityIds.length === 2) {
      if (extraChoice) return fail('breeding.fossil-egg.invalid-choice', 'A Species with two Basic Abilities rejects an extraneous Restoration Ability choice.')
      extraAbilityId = speciesSpec.basicAbilityIds.find(value => value !== primaryAbility) ?? fail('breeding.fossil-egg.provider-unavailable', 'Fossil Restoration could not resolve the second distinct Basic Ability.')
      extraAbilityTier = 'basic'
    }
    else if (speciesSpec.basicAbilityIds.length === 1) {
      if (!extraChoice) return fail('breeding.fossil-egg.invalid-choice', 'A Species with one Basic Ability requires one bounded GM Advanced Ability choice for Fossil Restoration.')
      const parsed = parseBreedingAbilityIdSyntax(extraChoice.option.canonicalValueId)
      const advancedNames = speciesRecord.abilities?.advanced ?? []
      const advancedNameSet = new Set(advancedNames)
      const advancedIds = BREEDING_CANONICAL_ABILITIES.filter(identity => advancedNameSet.has(identity.sourceName)).map(identity => identity.id)
      if (!parsed || !advancedIds.includes(parsed) || !canonicalBreedingAbilityIdentity(parsed)) return fail('breeding.fossil-egg.invalid-choice', 'Fossil Restoration extra Ability must be one current Species Advanced Ability offer.')
      extraAbilityId = parsed
      extraAbilityTier = 'advanced'
    }
    else return fail('breeding.fossil-egg.provider-unavailable', 'Fossil Restoration supports exactly one or two compiled Basic Abilities.')
    fossilRestoration = Object.freeze({ tutorPointDelta: -2, extraAbilityId, extraAbilityTier, sourceTrainerSlug: source.ownerTrainerSlug, providerEvidenceDefinitionSha256: restoration.definitionSha256, providerHandoffDefinitionSha256: feature.definitionSha256 })
  }
  else if (extraChoice) return fail('breeding.fossil-egg.invalid-choice', 'Restoration Ability choice is unavailable without one current effective Fossil Restoration Feature.')
  let prehistoricBond: PokemonEggProviderTraitsV1['prehistoricBond'] = null
  const statChoice = one(choices.selected, 'prehistoric-bond-stat', false)
  if (bond) {
    const stats = adjustedBaseStats(speciesRecord, nature.id)
    const maximum = Math.max(...Object.values(stats))
    const tied = (Object.keys(stats) as PokemonEggFossilStatId[]).filter(stat => stats[stat] === maximum)
    let selectedStat: PokemonEggFossilStatId
    let selectionKind: 'unique-highest' | 'bounded-gm-tie'
    if (tied.length === 1) {
      if (statChoice) return fail('breeding.fossil-egg.invalid-choice', 'Unique highest Nature-adjusted Base Stat rejects an extraneous Prehistoric Bond tie choice.')
      selectedStat = tied[0]!
      selectionKind = 'unique-highest'
    }
    else {
      const parsed = statChoice?.option.canonicalValueId.match(/^fossil-held-item-stat:(hp|atk|def|satk|sdef|spd)$/u)?.[1] as PokemonEggFossilStatId | undefined
      if (!statChoice || !parsed || !tied.includes(parsed)) return fail('breeding.fossil-egg.invalid-choice', 'Prehistoric Bond ties require one current bounded GM choice among the exact tied Nature-adjusted Base Stats.')
      selectedStat = parsed
      selectionKind = 'bounded-gm-tie'
    }
    const held = HELD_ITEM_BY_STAT[selectedStat]
    prehistoricBond = Object.freeze({
      highestBaseStatId: selectedStat, selectionKind,
      selectionOptionId: statChoice?.option.optionId ?? null,
      choiceEvidenceId: statChoice?.option.authorityEvidenceIds.find(value => value === slotEvidenceId('prehistoric-bond-stat')) ?? null,
      heldItemId: held.id, heldItemName: held.name,
      heldItemEffect: `${held.effect} ${PREHISTORIC_BOND_HELD_ITEM_RESTRICTION}`,
      heldItemEffectDefinitionSha256: sha256({ statId: selectedStat, ...held, restriction: PREHISTORIC_BOND_HELD_ITEM_RESTRICTION, featureRecordSha256: bond.providerRecordSha256 }),
      sourceTrainerSlug: source.ownerTrainerSlug,
      providerEvidenceDefinitionSha256: bond.definitionSha256,
      providerHandoffDefinitionSha256: feature.definitionSha256,
    })
  }
  else if (statChoice) return fail('breeding.fossil-egg.invalid-choice', 'Prehistoric Bond stat choice is unavailable without one current effective Feature.')
  const startingLevel = resolveBreedingHatchStartingLevel('fossil', options)
  const babyChoice = one(choices.selected, 'baby-template', false)
  const marsupialBaby = speciesId === 'kangaskhan'
  if (marsupialBaby && babyChoice) return fail('breeding.fossil-egg.invalid-choice', 'Marsupial forces its Baby Template and rejects a fossil campaign-choice substitute.')
  let baby
  if (marsupialBaby) baby = resolveBreedingMarsupialBabyTemplateV1()
  else {
    let babyInput: Parameters<typeof resolveBreedingBabyTemplate>[1] = null
    if (babyChoice) {
      const match = /^baby-template:apply:size-percent:(50|5[1-9]|[6-9][0-9]|100)$/u.exec(babyChoice.option.canonicalValueId)
      const decline = babyChoice.option.canonicalValueId === 'baby-template:decline'
      if (!decline && !match) return fail('breeding.fossil-egg.invalid-choice', 'Fossil Baby Template choice must bind decline or one bounded adult-size percentage.')
      babyInput = { optionId: babyChoice.option.optionId, evidenceId: slotEvidenceId('baby-template'), apply: !decline, sizePercentOfAdult: match ? Number(match[1]) : null }
    }
    baby = resolveBreedingBabyTemplate(options, babyInput)
  }
  if (startingLevel.status !== 'resolved' || baby.status !== 'resolved') return fail('breeding.fossil-egg.provider-unavailable', 'Fossil starting Level and Baby Template policy must resolve exactly at creation.')
  const durationChoice = one(choices.selected, 'hatch-duration', false)
  const durationMatch = durationChoice?.option.canonicalValueId.match(/^campaign-minutes:([1-9][0-9]{0,7})$/u) ?? null
  const durationRoll = input.hatchDurationRoll === null ? null : parseAuthoritativeBreedingRollRecordV1(input.hatchDurationRoll)
  const requestedRolls = options.values['breeding.hatch-duration-variation'] === 'server-random-half-to-double' ? ['hatch-duration'] : []
  if (!same(command.payload.resolutions.requestedRollKinds, requestedRolls)) return fail('breeding.fossil-egg.invalid-roll-set', 'Fossil commands request exactly the campaign-policy hatch-duration randomness and no trait randomness.')
  if ((requestedRolls.length === 1) !== (durationRoll !== null)) return fail('breeding.fossil-egg.invalid-roll-set', 'Persisted fossil hatch-duration randomness must exist exactly when requested.')
  const rollSourceHashes = [BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, source.definitionSha256, reanimation.definitionSha256, options.definitionSha256, speciesSpec.definitionSha256, ...offers.map(value => value.definitionSha256)].filter((value,index,values)=>values.indexOf(value)===index).sort(compare)
  if (durationRoll && (durationRoll.operationId !== command.operationId || durationRoll.commandSha256 !== createBreedingOperationCommandHash(command)
    || durationRoll.operationRollOrdinal !== 0 || durationRoll.purpose !== 'hatch-duration-percentage' || durationRoll.formula !== 'percentage-50-to-200'
    || durationRoll.target.kind !== 'pokemon-egg' || durationRoll.target.eggId !== command.payload.eggId || durationRoll.target.revision !== 0
    || durationRoll.generatedAtCampaignMinute !== clock.campaignMinute || !same(durationRoll.sourceDefinitionHashes, rollSourceHashes))) return fail('breeding.fossil-egg.invalid-roll-set', 'Fossil duration roll must be exact command-bound persisted future-Egg randomness.')
  const duration = resolveBreedingHatchDuration({
    speciesId, sourceKind: 'fossil', options, durationOverride: null,
    variationRoll: durationRoll ? { rollId: durationRoll.rollRecordId, total: durationRoll.total } : null,
    gmTarget: durationChoice && durationMatch ? { optionId: durationChoice.option.optionId, evidenceId: slotEvidenceId('hatch-duration'), targetCampaignMinutes: Number(durationMatch[1]) } : null,
  })
  if (duration.status !== 'resolved' || duration.speciesSpecDefinitionSha256 !== speciesSpec.definitionSha256) return fail('breeding.fossil-egg.provider-unavailable', `Fossil hatch duration is unavailable${duration.status === 'unavailable' ? `: ${duration.reasonIds.join(',')}` : '.'}`)
  const bounded = <Value extends string>(choice: SelectedFossilOption, valueId: Value) => Object.freeze({ valueId, resolutionKind: 'rank-choice' as const, rollRecordId: null, optionId: choice.option.optionId, choiceEvidenceId: slotEvidenceId(choice.slot) })
  const providerTraits: PokemonEggProviderTraitsV1 = Object.freeze({ serpentsMark: null, fossilRestoration, prehistoricBond, marsupial: marsupialBaby ? createBreedingMarsupialProviderTraitV1() : null, playingGod: null })
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1, speciesId, familyRootSpeciesId: speciesSpec.familyRootSpeciesId,
    speciesSpecDefinitionSha256: speciesSpec.definitionSha256,
    nature: bounded(natureChoice, nature.id), ability: bounded(primaryChoice, primaryAbility), gender: bounded(genderChoice, gender as 'female'|'male'|'genderless'),
    inheritanceCandidates, providerTraits, startingLevel: startingLevel.startingLevel,
    babyTemplate: { applied: baby.applied, choiceOptionId: baby.choiceOptionId, choiceEvidenceId: baby.choiceEvidenceId, effects: baby.effects },
  })
  const definitionHashes = [
    BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, BREEDING_CANONICAL_ID_DEFINITION_SHA256, BREEDING_NATURE_DEFINITION_SHA256,
    COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256, BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
    source.definitionSha256, reanimation.definitionSha256, feature.definitionSha256, options.definitionSha256,
    speciesSpec.definitionSha256, speciesIdentity.sourceRecordSha256, blueprint.definitionSha256,
    startingLevel.resultDefinitionSha256, baby.resultDefinitionSha256, duration.resultDefinitionSha256,
    ...(baby.applied ? [BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256] : []),
    ...(marsupialBaby ? [BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderRecordSha256, BREEDING_BABY_TEMPLATE_POLICY_DEFINITION.marsupialProviderMechanicFieldsSha256] : []),
    ...feature.contributions.map(value => value.definitionSha256), ...feature.dependencyEvidence.map(value => value.effectiveEvidenceSha256),
    ...choices.selected.map(value => value.offer.definitionSha256), ...(durationRoll ? [durationRoll.definitionSha256] : []),
    ...inheritanceCandidates.map(value => canonicalBreedingMoveIdentity(value.moveId)!.sourceRecordSha256),
    ...(fossilRestoration ? [canonicalBreedingAbilityIdentity(fossilRestoration.extraAbilityId)!.sourceRecordSha256] : []),
    ...(prehistoricBond ? [prehistoricBond.heldItemEffectDefinitionSha256] : []),
  ].filter((value,index,values)=>values.indexOf(value)===index).sort(compare)
  const egg = parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1, eggId: command.payload.eggId, revision: 0, status: 'incubating', ownerTrainerSlug: source.ownerTrainerSlug,
    source: command.payload.source, ruleset: command.ruleset, definitionHashes, parents: [], breeder: null, offspring: blueprint,
    incubation: { averageCampaignMinutes: duration.averageCampaignMinutes, targetCampaignMinutes: duration.targetCampaignMinutes, accumulatedCampaignMinutes: 0, variationPolicyId: duration.variationPolicyId, durationResultDefinitionSha256: duration.resultDefinitionSha256, lastAppliedClockRevision: clock.revision, lastAppliedClockMinute: clock.campaignMinute, readyAtCampaignMinute: null, readinessKind: null, readyOperationId: null, paused: false, pauseReasonId: null, pauseOperationId: null },
    special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: null, childSheetSlug: null, terminal: null,
    createdAtCampaignMinute: clock.campaignMinute, updatedAtCampaignMinute: clock.campaignMinute, statusChangedAtCampaignMinute: clock.campaignMinute, lastOperationId: command.operationId,
  })
  return Object.freeze({ egg, consumedOffers: choices.successors })
}

export const projectBreedingFossilEggCreationV1 = (inputValue: { readonly egg: unknown, readonly audience: 'gm'|'owner' }): BreedingFossilEggCreationProjectionV1 => {
  const input = exact(inputValue, ['egg','audience'], 'fossilEggProjectionInput')
  if (input.audience !== 'gm' && input.audience !== 'owner') return fail('breeding.fossil-egg.invalid-request', 'Fossil Egg projection audience must be owner or GM.')
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  if (egg.source.kind !== 'fossil' || egg.revision !== 0 || egg.status !== 'incubating' || egg.parents.length !== 0 || egg.breeder !== null) return fail('breeding.fossil-egg.stale-authority', 'Fossil Egg projection requires one committed revision-zero parentless incubating Egg.')
  return parseBreedingFossilEggCreationProjectionV1({
    schemaVersion: 1, audience: input.audience, eggId: egg.eggId, eggRevision: 0, sourceKind: 'fossil', status: 'incubating',
    startingLevel: egg.offspring.startingLevel, parentSnapshotCount: 0, traitsBounded: true,
    fossilRestorationApplied: egg.offspring.providerTraits.fossilRestoration !== null,
    prehistoricBondApplied: egg.offspring.providerTraits.prehistoricBond !== null,
    createdAtCampaignMinute: egg.createdAtCampaignMinute, operationId: egg.lastOperationId,
  })
}

export const breedingFossilRollSourceDefinitionHashes = (inputValue: {
  readonly command: unknown
  readonly sourceAuthority: unknown
  readonly reanimationAuthority: unknown
  readonly campaignOptionSnapshot: unknown
  readonly offers: readonly unknown[]
  readonly speciesId: unknown
}): readonly string[] => {
  const input = exact(inputValue, ['command','sourceAuthority','reanimationAuthority','campaignOptionSnapshot','offers','speciesId'], 'fossilRollSourceInput')
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'create-source-egg') return fail('breeding.fossil-egg.wrong-command', 'Fossil roll hashes require create-source-egg.')
  const source = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  const reanimation = parseAuthoritativeBreedingFossilReanimationAuthorityV1(input.reanimationAuthority)
  const options = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  const species = compiledBreedingSpeciesSpec(parseBreedingSpeciesIdSyntax(input.speciesId) ?? '') ?? fail('breeding.fossil-egg.provider-unavailable', 'Fossil roll Species is unavailable.')
  const offers = strictArray(input.offers, 16, 'fossilRollSourceInput.offers').map(value => parseAuthoritativeBreedingOptionOfferRecordV1(value))
  return Object.freeze([BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, source.definitionSha256, reanimation.definitionSha256, options.definitionSha256, species.definitionSha256, ...offers.map(value => value.definitionSha256)].filter((value,index,values)=>values.indexOf(value)===index).sort(compare))
}

export const consumeBreedingFossilSourceInventoryV1 = (inputValue: {
  readonly trainerSheet: unknown
  readonly sourceAuthority: unknown
  readonly operationId: unknown
  readonly updatedAt: unknown
}): StrictJsonObject => {
  const input = exact(inputValue, ['trainerSheet','sourceAuthority','operationId','updatedAt'], 'fossilSourceConsumptionInput')
  const trainer = storedTrainer(input.trainerSheet, 'fossilSourceConsumptionInput.trainerSheet')
  const source = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  if (typeof input.operationId !== 'string' || !/^breeding-operation:v1:[0-9a-f]{32}$/u.test(input.operationId)
    || !Number.isSafeInteger(input.updatedAt) || Number(input.updatedAt) < 0) {
    return fail('breeding.fossil-egg.invalid-request', 'Fossil source consumption requires one operation ID and nonnegative storage timestamp.')
  }
  if (source.ownerTrainerSlug !== trainer.slug || source.ownerTrainerRevision !== trainer.revision
    || source.ownerTrainerDefinitionSha256 !== sha256(trainer.document)) {
    return fail('breeding.fossil-egg.stale-authority', 'Fossil source consumption must use the exact frozen pre-consumption Trainer document.')
  }
  const current = exactInventoryEntry(trainer, source.sourceInventoryEntryId, source.sourceUnitOrdinal, 'fossilSourceConsumptionInput.sourceAuthority')
  if (sha256(current.row) !== source.sourceInventoryEntryDefinitionSha256) {
    return fail('breeding.fossil-egg.stale-authority', 'The designated fossil inventory row changed before atomic consumption.')
  }
  const document = strictDocument(trainer.document, 'fossilSourceConsumptionInput.trainerSheet.document')
  const inventory = document.inventory
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return fail('breeding.fossil-egg.stale-authority', 'The designated fossil inventory container is unavailable.')
  }
  let found = 0
  const nextInventory: Record<string, unknown> = {}
  for (const [category, categoryValue] of Object.entries(inventory)) {
    if (!Array.isArray(categoryValue)) {
      return fail('breeding.fossil-egg.invalid-request', `Trainer inventory category ${category} must be one strict array.`)
    }
    const nextRows: unknown[] = []
    for (const rowValue of categoryValue) {
      if (!rowValue || typeof rowValue !== 'object' || Array.isArray(rowValue)) {
        return fail('breeding.fossil-egg.invalid-request', `Trainer inventory category ${category} contains a malformed row.`)
      }
      const row = rowValue as Record<string, unknown>
      if (row.id !== source.sourceInventoryEntryId) {
        nextRows.push(rowValue)
        continue
      }
      found += 1
      if (sha256(rowValue) !== source.sourceInventoryEntryDefinitionSha256) {
        return fail('breeding.fossil-egg.stale-authority', 'The designated fossil row no longer matches frozen custody evidence.')
      }
      const quantity = row.qty === undefined ? 1 : Number(row.qty)
      if (!Number.isSafeInteger(quantity) || quantity < 1 || source.sourceUnitOrdinal >= quantity) {
        return fail('breeding.fossil-egg.provider-unavailable', 'The designated fossil unit is no longer quantity-backed.')
      }
      if (quantity > 1) nextRows.push(Object.freeze({ ...row, qty: quantity - 1 }))
    }
    nextInventory[category] = Object.freeze(nextRows)
  }
  if (found !== 1) return fail('breeding.fossil-egg.provider-ambiguous', 'Fossil source consumption must remove exactly one designated inventory row unit.')
  return strictDocument({
    ...document,
    inventory: Object.freeze(nextInventory),
    updatedAt: Number(input.updatedAt),
  }, 'fossilSourceConsumptionResult')
}
