import { createHash } from 'node:crypto'
import conditionsJson from '~~/data/reference/conditions.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  ItemConditionRemovalMode,
  ItemConditionRemovalSelection,
} from '#shared/itemAutomation/spec'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { sheetConditionNames } from '~/utils/sheetConditions'
import {
  conditionBaseName,
  conditionByName,
  conditionDisplayName,
  isStatusAfflictionCondition,
  normalizeConditionName,
  normalizeConditionNames,
} from '~/utils/statusConditions'

const CONDITION_CATALOG_SHA256 = 'a3ddc1b832304df106d1e1587b3208a51b7806e5a764e773103b0f29da838fb0'
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
if (sha256(stableJsonStringify(conditionsJson)) !== CONDITION_CATALOG_SHA256) {
  throw new Error('Canonical condition authority drifted; reviewed item cure scopes must be revalidated.')
}

export interface ItemConditionRemovalSpec {
  readonly conditionIds: readonly string[]
  readonly mode: ItemConditionRemovalMode
  readonly selection: ItemConditionRemovalSelection
}

export interface ItemRemovableConditionOption {
  /** Canonical condition identity. Detail-bearing instances share their canonical option. */
  readonly conditionId: string
  readonly label: string
  readonly matchingEntries: readonly string[]
  readonly matchingCount: number
}

export interface ItemConditionRemovalPreview {
  readonly options: readonly ItemRemovableConditionOption[]
  readonly removableConditionIds: readonly string[]
  readonly removableLabels: readonly string[]
  readonly removableEntryCount: number
  readonly hasApplicableCondition: boolean
  readonly description: string
}

const canonicalListedIds = (values: readonly string[]): readonly string[] => Object.freeze(values.map((value) => {
  const canonical = normalizeConditionName(value)
  if (!canonical || !conditionByName.has(canonical)) {
    throw new Error(`Reviewed item condition identity ${value} is not canonical.`)
  }
  return canonical
}))

const conditionInScope = (
  condition: string,
  spec: ItemConditionRemovalSpec,
  listed: ReadonlySet<string>,
): boolean => {
  const base = conditionBaseName(condition)
  if (!base) return false
  if (spec.mode === 'listed') return listed.has(base)
  if (spec.mode === 'persistent') return conditionByName.get(base)?.category === 'Persistent Affliction'
  if (spec.mode === 'volatile') return conditionByName.get(base)?.category === 'Volatile Affliction'
  return isStatusAfflictionCondition(base)
}

const currentConditions = (sheetKind: SheetKind, sheet: AnyLiveSheet): readonly string[] => normalizeConditionNames(
  sheetConditionNames(sheetKind, sheet as CharacterSheet | TrainerSheet),
)

/** Derive exact canonical removable options from the authoritative target sheet. */
export const previewItemConditionRemoval = (input: {
  readonly spec: ItemConditionRemovalSpec
  readonly sheetKind: SheetKind
  readonly sheet: AnyLiveSheet
}): ItemConditionRemovalPreview => {
  const listedIds = canonicalListedIds(input.spec.conditionIds)
  const listed = new Set(listedIds)
  const matching = currentConditions(input.sheetKind, input.sheet)
    .filter(condition => conditionInScope(condition, input.spec, listed))
  const byCanonical = new Map<string, string[]>()
  for (const condition of matching) {
    const canonical = conditionBaseName(condition)
    if (!canonical) continue
    const values = byCanonical.get(canonical) ?? []
    values.push(condition)
    byCanonical.set(canonical, values)
  }
  const options = [...byCanonical].map(([conditionId, entries]): ItemRemovableConditionOption => Object.freeze({
    conditionId,
    label: conditionDisplayName(conditionId),
    matchingEntries: Object.freeze([...entries]),
    matchingCount: entries.length,
  }))
  const labels = options.map(option => option.matchingCount > 1
    ? `${option.label} ×${option.matchingCount}`
    : option.label)
  const selectionLabel = input.spec.selection === 'choose-one' ? 'Choose one to cure' : 'Cures'
  return Object.freeze({
    options: Object.freeze(options),
    removableConditionIds: Object.freeze(options.map(option => option.conditionId)),
    removableLabels: Object.freeze(labels),
    removableEntryCount: matching.length,
    hasApplicableCondition: matching.length > 0,
    description: matching.length > 0
      ? `${selectionLabel}: ${labels.join(', ')}`
      : 'No applicable condition to cure',
  })
}

/** Resolve only an option from the current authoritative preview; clients never supply removal mechanics. */
export const resolveItemConditionRemoval = (input: {
  readonly spec: ItemConditionRemovalSpec
  readonly sheetKind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly selectedConditionIds?: readonly string[]
  /** Compound effects may retain exact empty cure evidence when another effect is applicable. */
  readonly allowNoApplicable?: boolean
}): {
  readonly currentConditions: readonly string[]
  readonly removedConditionIds: readonly string[]
  readonly removedEntries: readonly string[]
  readonly resultingConditions: readonly string[]
} => {
  const current = currentConditions(input.sheetKind, input.sheet)
  const preview = previewItemConditionRemoval(input)
  const selected = input.selectedConditionIds ?? []
  const removableIds = new Set(preview.removableConditionIds)
  let removeIds: ReadonlySet<string>
  if (input.spec.selection === 'choose-one') {
    if (selected.length !== 1 || !removableIds.has(selected[0]!)) {
      throw new Error('Item condition choice is incomplete or no longer authorized.')
    }
    removeIds = new Set(selected)
  }
  else {
    if (selected.length > 0) throw new Error('This item does not accept a condition choice.')
    removeIds = removableIds
  }
  const removedEntries = current.filter(condition => {
    const canonical = conditionBaseName(condition)
    return canonical !== null && removeIds.has(canonical)
  })
  if (removedEntries.length === 0 && !input.allowNoApplicable) {
    throw new Error('The target has no applicable condition to cure.')
  }
  const removedEntryKeys = new Set(removedEntries.map((condition) => {
    const canonical = conditionBaseName(condition) ?? condition
    return `${canonical}:${condition}`
  }))
  const resultingConditions = current.filter((condition) => {
    const canonical = conditionBaseName(condition) ?? condition
    return !removedEntryKeys.has(`${canonical}:${condition}`)
  })
  return Object.freeze({
    currentConditions: Object.freeze([...current]),
    removedConditionIds: Object.freeze([...removeIds]),
    removedEntries: Object.freeze([...removedEntries]),
    resultingConditions: Object.freeze([...resultingConditions]),
  })
}
