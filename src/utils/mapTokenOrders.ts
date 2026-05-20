import { findFeature, toSlug } from '~~/data/ptuReference'
import type { PtuFeature } from '~/types/ptuReference'
import type { SheetPlacement } from '~/types/map'
import type { TrainerFeatureEntry, TrainerOrder, TrainerSheet } from '~/types/trainerSheet'

export type TokenOrderSource = 'sheet-order' | 'feature' | 'granted-feature'

export interface TokenOrderMenuOption {
  name: string
  tags: string[]
  frequency: string | null
  trigger: string | null
  target: string | null
  condition: string | null
  effect: string | null
  source: TokenOrderSource
  /** Human-readable origin shown in tooltips/badges, e.g. "Sheet Order" or "Ravager Orders". */
  sourceLabel: string
}

export interface MapTokenOrderSheetLookup {
  trainer?: Map<string, TrainerSheet>
}

type OrderReference = Pick<
  PtuFeature,
  'name' | 'tags' | 'frequency' | 'trigger' | 'target' | 'condition' | 'effect'
>

interface FeatureOrderDefinition extends OrderReference {
  sourceFeatureName: string
}

const ORDER_TAG_NAMES = new Set(['order', 'orders', 'training'])

const fallback = <T>(...values: T[]): NonNullable<T> | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as NonNullable<T>
  }
  return null
}

const normalizedTags = (tags: readonly string[] | null | undefined): string[] =>
  (tags ?? []).map((tag) => tag.trim()).filter(Boolean)

const hasOrderUseTag = (tags: readonly string[] | null | undefined): boolean =>
  normalizedTags(tags).some((tag) => ORDER_TAG_NAMES.has(tag.toLocaleLowerCase()))

export const featureCanBeUsedAsOrder = (feature: Pick<PtuFeature, 'tags'>): boolean =>
  hasOrderUseTag(feature.tags)

const dedupeOrderOptions = (orders: TokenOrderMenuOption[]): TokenOrderMenuOption[] => {
  const seen = new Set<string>()
  const out: TokenOrderMenuOption[] = []
  for (const order of orders) {
    const key = toSlug(order.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(order)
  }
  return out
}

const optionFromManualOrder = (order: TrainerOrder): TokenOrderMenuOption => {
  const reference = findFeature(order.name)
  return {
    name: reference?.name ?? order.name,
    tags: normalizedTags(order.tags?.length ? order.tags : reference?.tags),
    frequency: fallback(reference?.frequency),
    trigger: fallback(reference?.trigger),
    target: fallback(reference?.target),
    condition: fallback(reference?.condition),
    effect: fallback(order.effect, reference?.effect),
    source: 'sheet-order',
    sourceLabel: 'Sheet Order',
  }
}

const optionFromFeatureOrder = (
  feature: Pick<TrainerFeatureEntry, 'name' | 'tags' | 'frequency' | 'notes'>,
  reference: OrderReference,
  sourceLabel = 'Feature',
): TokenOrderMenuOption => ({
  name: reference.name,
  tags: normalizedTags(feature.tags?.length ? feature.tags : reference.tags),
  frequency: fallback(feature.frequency, reference.frequency),
  trigger: fallback(reference.trigger),
  target: fallback(reference.target),
  condition: fallback(reference.condition),
  effect: fallback(reference.effect, feature.notes),
  source: 'feature',
  sourceLabel,
})

const optionFromGrantedFeatureOrder = (order: FeatureOrderDefinition): TokenOrderMenuOption => ({
  name: order.name,
  tags: normalizedTags(order.tags),
  frequency: fallback(order.frequency),
  trigger: fallback(order.trigger),
  target: fallback(order.target),
  condition: fallback(order.condition),
  effect: fallback(order.effect),
  source: 'granted-feature',
  sourceLabel: order.sourceFeatureName,
})

const splitGrantedOrderNames = (rawNames: string): string[] => rawNames
  .replace(/\s+and\s+/gi, ', ')
  .split(',')
  .map((name) => name.trim().replace(/^the\s+/i, ''))
  .filter(Boolean)

const grantedOrderNamesFromEffect = (effect: string | null | undefined): string[] => {
  const match = effect?.match(/^You gain\s+(?:the\s+)?(.+?)\s+Orders?\./i)
  return match?.[1] ? splitGrantedOrderNames(match[1]) : []
}

const fieldStartIndex = (text: string): number => {
  const starts = ['Trigger:', 'Target:', 'Condition:']
    .map((label) => text.search(new RegExp(`\\b${label}`, 'i')))
    .filter((index) => index >= 0)
  return starts.length ? Math.min(...starts) : -1
}

const readDefinitionField = (text: string, label: 'Trigger' | 'Target' | 'Condition'): string | null => {
  const match = text.match(new RegExp(`\\b${label}:\\s*([\\s\\S]*?)(?=\\b(?:Trigger|Target|Condition):|$)`, 'i'))
  return fallback(match?.[1]?.trim())
}

const parseGrantedOrderSegment = (
  sourceFeatureName: string,
  name: string,
  segment: string,
): FeatureOrderDefinition | null => {
  let rest = segment.slice(name.length).trim()
  const tags: string[] = []
  while (rest.startsWith('[')) {
    const tagMatch = rest.match(/^\[([^\]]+)\]\s*/)
    if (!tagMatch) break
    tags.push(tagMatch[1]?.trim() ?? '')
    rest = rest.slice(tagMatch[0].length).trim()
  }

  if (!hasOrderUseTag(tags)) return null

  const effectMatch = rest.match(/\bEffect:\s*/i)
  const beforeEffect = (effectMatch ? rest.slice(0, effectMatch.index) : rest).trim()
  const effect = effectMatch ? fallback(rest.slice((effectMatch.index ?? 0) + effectMatch[0].length).trim()) : null
  const firstFieldIndex = fieldStartIndex(beforeEffect)
  const frequency = firstFieldIndex >= 0
    ? fallback(beforeEffect.slice(0, firstFieldIndex).trim())
    : fallback(beforeEffect)

  return {
    sourceFeatureName,
    name,
    tags: normalizedTags(tags),
    frequency,
    trigger: readDefinitionField(beforeEffect, 'Trigger'),
    target: readDefinitionField(beforeEffect, 'Target'),
    condition: readDefinitionField(beforeEffect, 'Condition'),
    effect,
  }
}

const grantedOrdersFromFeatureReference = (feature: OrderReference): FeatureOrderDefinition[] => {
  const effect = feature.effect ?? ''
  const names = grantedOrderNamesFromEffect(effect)
  if (!names.length) return []

  const starts = names
    .map((name) => ({ name, index: effect.indexOf(`${name} [`) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)

  return starts.flatMap((entry, index): FeatureOrderDefinition[] => {
    const next = starts[index + 1]
    const segment = effect.slice(entry.index, next?.index ?? effect.length).trim()
    const parsed = parseGrantedOrderSegment(feature.name, entry.name, segment)
    return parsed ? [parsed] : []
  })
}

const optionFromTrainingFeature = (trainingFeature: string | null | undefined): TokenOrderMenuOption[] => {
  const name = trainingFeature?.trim()
  if (!name) return []

  const reference = findFeature(name)
  if (reference) {
    return featureCanBeUsedAsOrder(reference)
      ? [optionFromFeatureOrder({ name }, reference, 'Training Feature')]
      : []
  }

  return [optionFromFeatureOrder({ name }, {
    name,
    tags: ['Training', 'Orders'],
    frequency: null,
    trigger: null,
    target: null,
    condition: null,
    effect: null,
  }, 'Training Feature')]
}

const optionsFromFeature = (feature: TrainerFeatureEntry): TokenOrderMenuOption[] => {
  const reference = findFeature(feature.name)
  if (!reference) {
    if (!hasOrderUseTag(feature.tags)) return []
    return [optionFromFeatureOrder(feature, {
      name: feature.name,
      tags: normalizedTags(feature.tags),
      frequency: feature.frequency ?? null,
      trigger: null,
      target: null,
      condition: null,
      effect: feature.notes ?? null,
    })]
  }

  return [
    ...(featureCanBeUsedAsOrder(reference) || hasOrderUseTag(feature.tags)
      ? [optionFromFeatureOrder(feature, reference)]
      : []),
    ...grantedOrdersFromFeatureReference(reference).map(optionFromGrantedFeatureOrder),
  ]
}

export const trainerOrderOptionsForSheet = (sheet: TrainerSheet): TokenOrderMenuOption[] =>
  dedupeOrderOptions([
    ...(sheet.orders ?? []).map(optionFromManualOrder),
    ...optionFromTrainingFeature(sheet.trainingFeature),
    ...(sheet.features ?? []).flatMap(optionsFromFeature),
  ])

export const orderOptionsForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'> | null | undefined,
  sheets: MapTokenOrderSheetLookup,
): TokenOrderMenuOption[] => {
  if (!placement || placement.sheetKind !== 'trainer') return []
  const sheet = sheets.trainer?.get(placement.sheetSlug)
  return sheet ? trainerOrderOptionsForSheet(sheet) : []
}
