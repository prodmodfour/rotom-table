import { createHash } from 'node:crypto'
import breedingItemsJson from '../../../data/complete-play-loop/breeding-items.v1.json'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import pokedexJson from '../../../data/reference/pokedex.json'
import type { PokedexRecord } from '~/types/pokemon'
import {
  BREEDING_ITEM_CHOICE_ID_PREFIX,
  BREEDING_ITEM_OPTION_ID_PREFIX,
  parseItemBreedingState,
  type ItemBreedingChoiceV1,
  type ItemBreedingOptionV1,
  type ItemBreedingWorkflowProjectionV1,
} from '#shared/breeding/itemWorkflows'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import {
  BREEDING_CANONICAL_ABILITIES,
  canonicalBreedingAbilityIdentity,
  canonicalBreedingMoveIdentity,
  canonicalBreedingSpeciesIdentity,
} from './canonicalIds'
import { BREEDING_NATURES } from './natures'
import { COMPILED_BREEDING_SPECIES, compiledBreedingSpeciesSpec } from './registry'
import { parseAuthoritativeBreedingFeatureProviderHandoffV1 } from './featureProviderHandoff'
import { resolveCanonicalItemId } from '../itemAutomation/registry'

interface ContractRow {
  readonly canonicalId: string
  readonly recordSha256: string
  readonly modifierMechanicFieldsSha256: string
  readonly consumption: { readonly phase: string, readonly quantity: number, readonly reusable: boolean }
  readonly mechanics: Readonly<Record<string, unknown>>
}
interface ContractDocument {
  readonly schemaVersion: number
  readonly ticket: string
  readonly status: string
  readonly itemCount: number
  readonly canonicalAuthority: { readonly runtimeDocumentaryParsingForbidden: boolean }
  readonly runtimePolicies: Readonly<Record<string, string>>
  readonly items: readonly ContractRow[]
}
const contract = breedingItemsJson as unknown as ContractDocument
const contractRows = new Map(contract.items.map(row => [row.canonicalId, row]))
if (contract.schemaVersion !== 1 || contract.ticket !== 'P8-058' || contract.status !== 'reviewed-native'
  || contract.itemCount !== 3 || contract.canonicalAuthority.runtimeDocumentaryParsingForbidden !== true
  || contractRows.size !== 3
  || contractRows.get('Egg Warmer')?.consumption.phase !== 'never'
  || contractRows.get('Egg Warmer')?.mechanics.capacity !== 4
  || contractRows.get('Egg Warmer')?.mechanics.campaignProgressRateNumerator !== 2
  || contractRows.get('Reanimation Machine')?.consumption.quantity !== 0
  || contractRows.get('Chemistry Set')?.mechanics.moneyCost !== 3500) {
  throw new Error('Reviewed P8-058 breeding-item integration contract is unavailable or stale.')
}

export const BREEDING_ITEM_WORKFLOW_CONTRACT = contract
export const BREEDING_ITEM_WORKFLOW_DEFINITION_SHA256 = createHash('sha256')
  .update(stableJsonStringify(contract)).digest('hex')
export const BREEDING_ITEM_WORKFLOW_CAPACITY = 4 as const
export const BREEDING_ITEM_WORKFLOW_MONEY_COST = 3500 as const

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const MAX_PROJECTED_TOOL_UNITS = 256
const MAX_PROJECTED_SOURCE_UNITS = 1_024
const stableId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u
const safeLabel = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value.normalize('NFKC') : ''
  const cleaned = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
  return Array.from(cleaned || fallback).slice(0, 120).join('') || fallback
}
const hashId = (prefix: string, namespace: string, value: unknown): string => `${prefix}${createHash('sha256')
  .update(`${namespace}\0${stableJsonStringify(value)}`).digest('hex').slice(0, 32)}`
export const breedingItemOptionId = (namespace: string, value: unknown): string => hashId(
  BREEDING_ITEM_OPTION_ID_PREFIX, namespace, value,
)
export const breedingItemChoiceId = (operationId: string, slot: string): string => hashId(
  BREEDING_ITEM_CHOICE_ID_PREFIX, 'choice', { operationId, slot },
)

export interface ItemBreedingInventoryUnitAuthority {
  readonly optionId: string
  readonly inventoryEntryId: string
  readonly unitOrdinal: number
  readonly row: InventoryEntry
  readonly label: string
}
export interface ItemBreedingEggAuthority {
  readonly optionId: string
  readonly egg: PokemonEggDocumentV1
  readonly label: string
}
export interface ItemBreedingSpeciesAuthority {
  readonly optionId: string
  readonly speciesId: string
  readonly label: string
}
export interface ItemBreedingProjectionAuthority {
  readonly projection: ItemBreedingWorkflowProjectionV1
  readonly warmerUnits: ReadonlyMap<string, ItemBreedingInventoryUnitAuthority>
  readonly fossilSources: ReadonlyMap<string, ItemBreedingInventoryUnitAuthority>
  readonly machines: ReadonlyMap<string, ItemBreedingInventoryUnitAuthority>
  readonly chemistrySets: ReadonlyMap<string, ItemBreedingInventoryUnitAuthority>
  readonly eggs: ReadonlyMap<string, ItemBreedingEggAuthority>
  readonly species: ReadonlyMap<string, ItemBreedingSpeciesAuthority>
}

const inventoryRows = (sheet: TrainerSheet): readonly InventoryEntry[] => Object.values(sheet.inventory ?? {})
  .flatMap(value => Array.isArray(value) ? value : [])
const exactRows = (sheet: TrainerSheet): readonly InventoryEntry[] => {
  const rows = inventoryRows(sheet)
  const counts = new Map<string, number>()
  for (const row of rows) if (typeof row?.id === 'string') counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  return rows.filter(row => typeof row?.id === 'string' && stableId.test(row.id)
    && counts.get(row.id) === 1 && Number.isSafeInteger(row.qty ?? 1) && Number(row.qty ?? 1) > 0)
}
const unitsFor = (input: {
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly rows: readonly InventoryEntry[]
  readonly kind: 'warmer' | 'fossil-source' | 'machine' | 'chemistry'
  readonly predicate: (row: InventoryEntry) => boolean
  readonly maximumUnits: number
}): ReadonlyMap<string, ItemBreedingInventoryUnitAuthority> => {
  const result = new Map<string, ItemBreedingInventoryUnitAuthority>()
  for (const row of input.rows.filter(input.predicate).sort((a, b) => compare(a.id!, b.id!))) {
    if (result.size >= input.maximumUnits) break
    const quantity = Number(row.qty ?? 1)
    for (let unitOrdinal = 0; unitOrdinal < quantity && result.size < input.maximumUnits; unitOrdinal += 1) {
      const optionId = breedingItemOptionId(input.kind, {
        trainerSlug: input.trainerSlug, trainerRevision: input.trainerRevision,
        inventoryEntryId: row.id, unitOrdinal,
      })
      const base = safeLabel(row.name, 'Inventory item')
      result.set(optionId, Object.freeze({
        optionId, inventoryEntryId: row.id!, unitOrdinal, row,
        label: quantity > 1 ? `${base} · unit ${unitOrdinal + 1}` : base,
      }))
    }
  }
  return result
}
const reviewedToolIdentity = (row: InventoryEntry): string | null => {
  const canonicalId = resolveCanonicalItemId(row.serializedEquipment?.canonicalItemId ?? row.name)
  return canonicalId && contractRows.has(canonicalId) ? canonicalId : null
}
const option = (value: { readonly optionId: string, readonly label: string, readonly description?: string | null, readonly unavailableReason?: string | null }): ItemBreedingOptionV1 => Object.freeze({
  optionId: value.optionId,
  label: value.label,
  description: value.description ?? null,
  disabled: value.unavailableReason !== undefined && value.unavailableReason !== null,
  unavailableReason: value.unavailableReason ?? null,
})
const availability = (reason: string | null) => Object.freeze({ enabled: reason === null, unavailableReason: reason })
const mapOptions = (values: ReadonlyMap<string, ItemBreedingInventoryUnitAuthority>, description: string): readonly ItemBreedingOptionV1[] => Object.freeze(
  [...values.values()].map(value => option({ optionId: value.optionId, label: value.label, description })),
)

export const buildItemBreedingProjectionAuthority = (input: {
  readonly audience: 'gm' | 'owner'
  readonly trainer: { readonly slug: string, readonly revision: number, readonly document: TrainerSheet }
  readonly eggs: readonly PokemonEggDocumentV1[]
  readonly campaignMinute: number
  readonly commandsBlocked?: boolean
  readonly fossilPrerequisiteReason?: string | null
  readonly artificialPrerequisiteReason?: string | null
}): ItemBreedingProjectionAuthority => {
  const trainerSheet = input.trainer.document
  const rows = exactRows(trainerSheet)
  const common = { trainerSlug: input.trainer.slug, trainerRevision: input.trainer.revision, rows }
  const canonicalItems = new Map(rows.map(row => [row, reviewedToolIdentity(row)]))
  const warmers = unitsFor({ ...common, kind: 'warmer', predicate: row => canonicalItems.get(row) === 'Egg Warmer', maximumUnits: MAX_PROJECTED_TOOL_UNITS })
  const machines = unitsFor({ ...common, kind: 'machine', predicate: row => canonicalItems.get(row) === 'Reanimation Machine', maximumUnits: MAX_PROJECTED_TOOL_UNITS })
  const chemistry = unitsFor({ ...common, kind: 'chemistry', predicate: row => canonicalItems.get(row) === 'Chemistry Set', maximumUnits: MAX_PROJECTED_TOOL_UNITS })
  const sources = unitsFor({ ...common, kind: 'fossil-source', predicate: row => canonicalItems.get(row) === null, maximumUnits: MAX_PROJECTED_SOURCE_UNITS })
  const state = parseItemBreedingState(trainerSheet.serverPrivate?.itemBreeding)
  const eggMap = new Map<string, ItemBreedingEggAuthority>()
  for (const egg of [...input.eggs].sort((a, b) => compare(a.eggId, b.eggId))) {
    if (eggMap.size >= 256) break
    if (egg.ownerTrainerSlug !== input.trainer.slug || egg.status !== 'incubating') continue
    const optionId = breedingItemOptionId('egg', {
      trainerSlug: input.trainer.slug, trainerRevision: input.trainer.revision,
      eggId: egg.eggId, eggRevision: egg.revision,
    })
    const speciesName = canonicalBreedingSpeciesIdentity(egg.offspring.speciesId)?.sourceName ?? 'Pokémon'
    eggMap.set(optionId, Object.freeze({ optionId, egg, label: `${speciesName} Egg` }))
  }
  const eggIdToOption = new Map<string, string>([...eggMap.values()].map(value => [value.egg.eggId, value.optionId]))
  const assignmentByUnit = new Map(state.eggWarmerAssignments.map(value => [
    `${value.inventoryEntryId}\0${value.unitOrdinal}`, value,
  ]))
  const assignedElsewhere = new Map<string, string>()
  for (const assignment of state.eggWarmerAssignments) {
    const unitKey = `${assignment.inventoryEntryId}\0${assignment.unitOrdinal}`
    for (const eggId of assignment.eggIds) assignedElsewhere.set(eggId, unitKey)
  }
  const warmerOptions = [...warmers.values()].map(value => {
    const unitKey = `${value.inventoryEntryId}\0${value.unitOrdinal}`
    const assignedEggOptionIds = (assignmentByUnit.get(unitKey)?.eggIds ?? [])
      .map(eggId => eggIdToOption.get(eggId)).filter((entry): entry is string => Boolean(entry)).sort(compare)
    return Object.freeze({
      ...option({ optionId: value.optionId, label: value.label, description: 'Reusable · up to four current Eggs' }),
      assignedEggOptionIds: Object.freeze(assignedEggOptionIds),
    })
  })
  const warmerEggOptions = [...eggMap.values()].map(value => {
    const otherUnit = assignedElsewhere.get(value.egg.eggId)
    const unavailableReason = otherUnit && ![...warmers.values()].some(unit => (
      `${unit.inventoryEntryId}\0${unit.unitOrdinal}` === otherUnit
    )) ? 'Assigned to an unavailable Egg Warmer unit.' : null
    const accumulated = value.egg.incubation.accumulatedCampaignMinutes
    const target = value.egg.incubation.targetCampaignMinutes
    return Object.freeze({
      ...option({ optionId: value.optionId, label: value.label, description: `Campaign minute ${accumulated} of ${target}`, unavailableReason }),
      status: 'incubating' as const,
      accumulatedCampaignMinutes: accumulated,
      targetCampaignMinutes: target,
      percent: target === 0 ? 100 : Math.min(100, Math.floor((accumulated * 100) / target)),
    })
  })
  const speciesMap = new Map<string, ItemBreedingSpeciesAuthority>()
  for (const spec of COMPILED_BREEDING_SPECIES) {
    const identity = canonicalBreedingSpeciesIdentity(spec.speciesId)
    if (!identity) continue
    const optionId = breedingItemOptionId('species', { trainerSlug: input.trainer.slug, trainerRevision: input.trainer.revision, speciesId: spec.speciesId })
    speciesMap.set(optionId, Object.freeze({ optionId, speciesId: spec.speciesId, label: identity.sourceName }))
  }
  const commandsBlocked = input.commandsBlocked === true
  const warmerReason = commandsBlocked ? 'Wait for the current Workshop command to settle.'
    : warmers.size === 0 ? 'Add one exact Egg Warmer inventory unit.'
      : eggMap.size === 0 ? 'No current owned incubating Eggs are available.' : null
  const fossilReason = input.audience !== 'gm' ? 'A GM must designate and restore Fossils.'
    : commandsBlocked ? 'Wait for the current Workshop command to settle.'
      : sources.size === 0 ? 'No inventory row is available for explicit fossil designation.'
        : machines.size === 0 ? 'Add one exact Reanimation Machine inventory unit.'
          : input.fossilPrerequisiteReason
            ?? (speciesMap.size === 0 ? 'No reviewed Species restoration options are available.' : null)
  const money = Number(trainerSheet.money ?? 0)
  const artificialReason = input.audience !== 'gm' ? 'A GM must authorize Playing God creation.'
    : commandsBlocked ? 'Wait for the current Workshop command to settle.'
      : chemistry.size === 0 ? 'Add one exact Chemistry Set inventory unit.'
        : !Number.isSafeInteger(money) || money < BREEDING_ITEM_WORKFLOW_MONEY_COST ? 'At least $3,500 is required.'
          : input.artificialPrerequisiteReason ?? null
  const projection: ItemBreedingWorkflowProjectionV1 = Object.freeze({
    schemaVersion: 1,
    audience: input.audience,
    trainer: Object.freeze({
      trainerSheetSlug: input.trainer.slug,
      trainerRevision: input.trainer.revision,
      displayName: safeLabel(trainerSheet.name, input.trainer.slug),
    }),
    generatedAtCampaignMinute: input.campaignMinute,
    commandsBlocked,
    eggWarmer: Object.freeze({
      availability: availability(warmerReason), capacity: 4,
      progressRateNumerator: 2, progressRateDenominator: 1,
      units: Object.freeze(warmerOptions), eggs: Object.freeze(warmerEggOptions),
    }),
    fossil: Object.freeze({
      availability: availability(fossilReason),
      sourceOptions: mapOptions(sources, 'GM designation consumes exactly this source unit.'),
      machineOptions: mapOptions(machines, 'Reusable restoration tool; not consumed.'),
      speciesOptions: Object.freeze([...speciesMap.values()].sort((a, b) => compare(a.label, b.label))
        .map(value => option({ optionId: value.optionId, label: value.label, description: 'Creates one ordinary incubating Egg through the shared lifecycle.' }))),
      consumesFossilSource: 1, consumesMachine: 0,
    }),
    artificial: Object.freeze({
      availability: availability(artificialReason),
      chemistryOptions: mapOptions(chemistry, 'Reusable creation tool; not consumed.'),
      moneyCost: 3500, consumesChemistrySet: 0,
    }),
  })
  return Object.freeze({
    projection,
    warmerUnits: warmers, fossilSources: sources, machines, chemistrySets: chemistry,
    eggs: eggMap, species: speciesMap,
  })
}

const labelForValue = (value: string): string => {
  if (value.startsWith('coloration:')) return `Coloration · ${value.slice(11).replace(/-/gu, ' ')}`
  if (value.startsWith('move:')) return `Move · ${canonicalBreedingMoveIdentity(value.slice(5))?.sourceName ?? value.slice(5)}`
  if (value.startsWith('base-stat:')) return `Base Stat · ${value.slice(10).toLocaleUpperCase('en-US')}`
  if (value.startsWith('fossil-held-item-stat:')) return `Tied highest stat · ${value.slice(24).toLocaleUpperCase('en-US')}`
  if (value === 'baby-template:decline') return 'Do not apply Baby Template'
  const baby = /^baby-template:apply:size-percent:(\d+)$/u.exec(value)
  if (baby) return `Apply Baby Template · ${baby[1]}% adult size`
  if (value.startsWith('campaign-minutes:')) return `${value.slice(17)} campaign minutes`
  if (value === 'female') return 'Female'
  if (value === 'male') return 'Male'
  if (value === 'genderless') return 'Genderless'
  return canonicalBreedingSpeciesIdentity(value)?.sourceName
    ?? canonicalBreedingAbilityIdentity(value)?.sourceName
    ?? canonicalBreedingMoveIdentity(value)?.sourceName
    ?? BREEDING_NATURES.find(entry => entry.id === value)?.label
    ?? value.replace(/-/gu, ' ')
}

export interface FossilOfferChoiceValues {
  readonly species: readonly string[]
  readonly nature: readonly string[]
  readonly primaryAbility: readonly string[]
  readonly gender: readonly string[]
  readonly inheritanceMoves: readonly string[]
  readonly restorationExtraAbility: readonly string[]
  readonly prehistoricBondStat: readonly string[]
  readonly hatchDuration: readonly string[]
}
export const fossilOfferChoiceValues = (input: {
  readonly speciesId: string
  readonly featureProviderHandoff: unknown
}): FossilOfferChoiceValues => {
  const spec = compiledBreedingSpeciesSpec(input.speciesId)
  if (!spec) throw new Error('The selected Species is unavailable from the reviewed breeding registry.')
  const identity = canonicalBreedingSpeciesIdentity(spec.speciesId)
  const record = identity ? (awaitlessPokedexRecord(identity.sourceIndex)) : null
  const handoff = parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff)
  const providerIds = new Set(handoff.contributions.map(value => value.providerCanonicalId))
  const restoration: string[] = providerIds.has('Fossil Restoration') && spec.basicAbilityIds.length === 1
    ? (record?.abilities?.advanced ?? []).flatMap((name) => {
        const abilityId = BREEDING_CANONICAL_ABILITIES.find(value => value.sourceName === name)?.id
        return abilityId ? [String(abilityId)] : []
      }).slice(0, 16).sort(compare)
    : []
  return Object.freeze({
    species: Object.freeze([spec.speciesId]),
    nature: Object.freeze(BREEDING_NATURES.map(value => value.id)),
    primaryAbility: Object.freeze([...spec.basicAbilityIds]),
    gender: Object.freeze(spec.genderPolicy.kind === 'genderless' ? ['genderless'] : ['female', 'male']),
    inheritanceMoves: Object.freeze([]),
    restorationExtraAbility: Object.freeze(restoration),
    prehistoricBondStat: Object.freeze(providerIds.has('Prehistoric Bond')
      ? ['hp','atk','def','satk','sdef','spd'].map(value => `fossil-held-item-stat:${value}`) : []),
    hatchDuration: Object.freeze([]),
  })
}

// Canonical records are addressed through the reviewed identity index.
const pokedex = pokedexJson as readonly PokedexRecord[]
const awaitlessPokedexRecord = (index: number): PokedexRecord | null => pokedex[index] ?? null

export const choicesFromOffers = (input: {
  readonly operationId: string
  readonly offers: readonly {
    readonly offerId: string
    readonly choiceKind: string
    readonly options: readonly { readonly optionId: string, readonly canonicalValueId: string }[]
  }[]
  readonly slots: readonly { readonly slot: string, readonly offerId: string, readonly label: string, readonly minimum: number, readonly maximum: number, readonly description?: string }[]
}): readonly ItemBreedingChoiceV1[] => Object.freeze(input.slots.flatMap(slot => {
  const matches = input.offers.filter(offer => offer.offerId === slot.offerId)
  if (matches.length !== 1) return []
  return [Object.freeze({
    choiceId: breedingItemChoiceId(input.operationId, slot.slot),
    label: slot.label,
    minimum: slot.minimum,
    maximum: slot.maximum,
    options: Object.freeze(matches[0]!.options.map(entry => option({
      optionId: breedingItemOptionId('source-choice', {
        operationId: input.operationId, slot: slot.slot, offerOptionId: entry.optionId,
      }),
      label: labelForValue(entry.canonicalValueId),
      description: slot.description ?? null,
    }))),
  })]
}))

export const sourceChoiceProjectionId = (operationId: string, slot: string, offerOptionId: string): string => breedingItemOptionId(
  'source-choice', { operationId, slot, offerOptionId },
)

export const resolveProjectedSourceChoices = (input: {
  readonly operationId: string
  readonly offers: readonly { readonly offerId: string, readonly options: readonly { readonly optionId: string }[] }[]
  readonly slots: readonly { readonly slot: string, readonly offerId: string }[]
  readonly selectedOptionIds: readonly string[]
}): readonly string[] => {
  const projected = new Map<string, string>()
  for (const slot of input.slots) {
    const matches = input.offers.filter(offer => offer.offerId === slot.offerId)
    if (matches.length === 0) continue
    if (matches.length !== 1) throw new Error('The current source workflow offer map is unavailable.')
    for (const candidate of matches[0]!.options) {
      const id = sourceChoiceProjectionId(input.operationId, slot.slot, candidate.optionId)
      if (projected.has(id)) throw new Error('The current source workflow option map is ambiguous.')
      projected.set(id, candidate.optionId)
    }
  }
  const values = input.selectedOptionIds.map(id => projected.get(id) ?? (() => { throw new Error('A selected source workflow option is stale or unavailable.') })())
  if (new Set(values).size !== values.length) throw new Error('Source workflow selections must be unique.')
  return Object.freeze([...values].sort(compare))
}

export const sourceChoiceLabel = labelForValue
