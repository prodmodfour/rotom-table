import { findFeature, toSlug } from '~~/data/ptuReference'
import { resolvedSheetFeatureClosure, resolvedSheetFeatureInstances } from '#shared/featureAutomation/sheetFeatures'
import { FEATURE_GRANTED_ORDERS_BY_SOURCE } from '#shared/featureAutomation/orders'
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

const optionFromManualOrder = (order: TrainerOrder): TokenOrderMenuOption | null => {
  const reference = findFeature(order.name)
  if (!reference || !hasOrderUseTag(reference.tags)) return null
  return {
    name: reference.name,
    tags: normalizedTags(reference.tags),
    frequency: fallback(reference.frequency),
    trigger: fallback(reference.trigger),
    target: fallback(reference.target),
    condition: fallback(reference.condition),
    effect: fallback(reference.effect),
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

const grantedOrdersFromFeatureReference = (feature: OrderReference): FeatureOrderDefinition[] => (
  (FEATURE_GRANTED_ORDERS_BY_SOURCE.get(feature.name) ?? []).map(order => ({ ...order, tags: [...order.tags], sourceFeatureName: feature.name }))
)

const optionsFromFeature = (feature: TrainerFeatureEntry, sourceLabel = 'Feature'): TokenOrderMenuOption[] => {
  const reference = findFeature(feature.name)
  if (!reference) return []

  return [
    ...(featureCanBeUsedAsOrder(reference)
      ? [optionFromFeatureOrder(feature, reference, sourceLabel)]
      : []),
    ...grantedOrdersFromFeatureReference(reference).map(optionFromGrantedFeatureOrder),
  ]
}

export const trainerOrderOptionsForSheet = (sheet: TrainerSheet): TokenOrderMenuOption[] => {
  const directOrders = resolvedSheetFeatureInstances(sheet).flatMap(row => row.collection === 'orders' && row.data && (row.status === 'ready' || row.status === 'missing-required-data')
    ? [optionFromManualOrder({ name: row.data.canonicalId })].filter((option): option is TokenOrderMenuOption => Boolean(option))
    : [])
  const resolvedRows = resolvedSheetFeatureInstances(sheet)
  const directIds = new Set(resolvedRows.filter(row => row.collection === 'orders' && row.data).map(row => row.data!.canonicalId))
  const training = resolvedRows.flatMap(row => row.collection === 'training' && row.data && (row.status === 'ready' || row.status === 'missing-required-data')
    ? optionsFromFeature({ name: row.data.canonicalId }, 'Training Feature')
    : [])
  const trainingIds = new Set(resolvedRows.filter(row => row.collection === 'training' && row.data).map(row => row.data!.canonicalId))
  const effective = resolvedSheetFeatureClosure(sheet).flatMap(instance => directIds.has(instance.canonicalId) || trainingIds.has(instance.canonicalId) ? [] : optionsFromFeature({ name: instance.canonicalId }, instance.canonicalId))
  return dedupeOrderOptions([...directOrders, ...training, ...effective])
}

export const orderOptionsForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'> | null | undefined,
  sheets: MapTokenOrderSheetLookup,
): TokenOrderMenuOption[] => {
  if (!placement || placement.sheetKind !== 'trainer') return []
  const sheet = sheets.trainer?.get(placement.sheetSlug)
  return sheet ? trainerOrderOptionsForSheet(sheet) : []
}
