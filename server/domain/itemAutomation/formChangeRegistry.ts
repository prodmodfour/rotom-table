import { createHash } from 'node:crypto'
import abilitiesJson from '~~/data/reference/abilities.json'
import pokedexJson from '~~/data/reference/pokedex.json'
import rulesJson from '~~/data/reference/rules.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  PtuItemFormChangeMechanicsV1,
  PtuItemFormChangeRecordV1,
  PtuRule,
} from '~/types/ptuReference'
import type { PokedexRecord } from '~/types/pokemon'

export interface ReviewedItemFormChange extends PtuItemFormChangeRecordV1 {
  readonly recordSha256: string
}

const fail = (): never => {
  throw new Error('Canonical item-driven form-change authority is unavailable or stale.')
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const rule = (rulesJson as unknown as Record<string, PtuRule>)['Item-Driven Form Changes']
const EXPECTED_RULE_RECORD_SHA256 = '2263efe28b4816477ddc26e37fc564c15465875491ee44d741d5472dfe57fef1'
const mechanics = rule?.itemFormChangeMechanics as PtuItemFormChangeMechanicsV1 | undefined
const pokedex = pokedexJson as unknown as readonly PokedexRecord[]
const speciesById = new Map(pokedex.map(record => [record.species, record]))
const canonicalAbilities = abilitiesJson as Record<string, unknown>
const canonicalAbilityIds = new Set(Object.keys(canonicalAbilities))
const typeIds = new Set([
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost',
  'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon',
  'Dark', 'Fairy',
])
const formIdPattern = /^mega-[a-z0-9]+(?:-[a-z0-9]+)*$/
const statIds = ['atk', 'def', 'satk', 'sdef', 'spd'] as const

if (!rule || !mechanics
  || sha256(rule) !== EXPECTED_RULE_RECORD_SHA256
  || mechanics.schemaVersion !== 1
  || mechanics.triggerKind !== 'mega-evolution'
  || mechanics.ringItemId !== 'Mega Ring'
  || mechanics.stoneItemId !== 'Mega Stone'
  || mechanics.timing !== 'swift-action-on-trainer-or-pokemon-turn'
  || mechanics.duration !== 'scene'
  || mechanics.trainerSceneLimit !== 1
  || mechanics.hpPolicy !== 'unchanged'
  || mechanics.statPolicy !== 'add-reviewed-non-hp-deltas-to-effective-stats'
  || mechanics.typePolicy !== 'replace-only-when-form-record-declares-types'
  || mechanics.abilityPolicy !== 'add-reviewed-ability-or-select-distinct-natural-ability-on-duplicate'
  || mechanics.identityPolicy !== 'retain-sheet-character-history-and-customization'
  || mechanics.sourcePolicy !== 'active-matching-ring-and-form-bound-stone-or-reviewed-delta-exception'
  || mechanics.sourceLossPolicy !== 'accepted-scene-form-survives-suppression-and-stone-is-removal-locked'
  || mechanics.reversalPolicy !== 'automatic-at-scene-end'
  || mechanics.persistentFormPolicy !== 'supported-by-state-model-but-no-reviewed-item-trigger'
  || mechanics.formCount !== 50
  || mechanics.forms.length !== 50) fail()

const reviewedMechanics = mechanics as PtuItemFormChangeMechanicsV1
const seen = new Set<string>()
const forms: ReviewedItemFormChange[] = reviewedMechanics.forms.map((form) => {
  if (!formIdPattern.test(form.formId) || seen.has(form.formId)
    || !speciesById.has(form.baseSpeciesId)
    || !form.displayName.startsWith('Mega ')
    || !canonicalAbilityIds.has(form.abilityId)
    || (form.types !== null && (form.types.length === 0
      || form.types.length > 2
      || new Set(form.types).size !== form.types.length
      || form.types.some(type => !typeIds.has(type))))
    || Object.keys(form.statDeltas).length !== statIds.length
    || statIds.some(stat => !Number.isSafeInteger(form.statDeltas[stat])
      || Math.abs(form.statDeltas[stat]) > 20)
    || form.requiresMegaStone !== (form.baseSpeciesId !== 'Rayquaza')) fail()
  seen.add(form.formId)
  return Object.freeze({ ...form, recordSha256: sha256(form) })
})
if (forms.filter(form => form.baseSpeciesId === 'Rayquaza').length !== 1) fail()

const byId = new Map(forms.map(form => [form.formId, form]))
const bySpecies = new Map<string, ReviewedItemFormChange[]>()
for (const form of forms) {
  const current = bySpecies.get(form.baseSpeciesId) ?? []
  current.push(form)
  bySpecies.set(form.baseSpeciesId, current)
}
for (const values of bySpecies.values()) values.sort((left, right) => left.formId.localeCompare(right.formId))

export const ITEM_FORM_CHANGE_RULE_RECORD_SHA256 = EXPECTED_RULE_RECORD_SHA256
export const ITEM_FORM_CHANGE_RULE_ID = 'Item-Driven Form Changes' as const
export const ITEM_FORM_CHANGE_FORM_COUNT = 50 as const

export const reviewedItemFormChanges = (): readonly ReviewedItemFormChange[] => forms
export const reviewedItemFormChangeForId = (formId: string): ReviewedItemFormChange | null => byId.get(formId) ?? null
export const reviewedItemFormChangesForSpecies = (speciesId: string): readonly ReviewedItemFormChange[] => bySpecies.get(speciesId) ?? []
export const canonicalItemFormChangeSpeciesRecord = (speciesId: string): PokedexRecord | null => speciesById.get(speciesId) ?? null
export const canonicalItemFormChangeSpeciesRecordSha256 = (speciesId: string): string | null => {
  const record = speciesById.get(speciesId)
  return record ? sha256(record) : null
}
export const canonicalItemFormChangeAbilityRecordSha256 = (abilityId: string): string | null => {
  const record = canonicalAbilities[abilityId]
  return record ? sha256(record) : null
}

export const canonicalNaturalAbilityIdsForItemFormChange = (speciesId: string): readonly string[] => {
  const abilities = speciesById.get(speciesId)?.abilities
  return [...new Set([
    ...(abilities?.basic ?? []),
    ...(abilities?.advanced ?? []),
    ...(abilities?.high ?? []),
  ])]
}
