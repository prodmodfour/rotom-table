import specsJson from '../../../data/feature-automation/specs.json'
import { resolveEffectiveFeatures } from './effectiveFeatures'
import type { TrainerSheet } from '~/types/trainerSheet'

export type FeatureEventKind = 'capture' | 'recovery' | 'combat-hit' | 'combat-state' | 'movement' | 'item' | 'lifecycle' | 'orders' | 'reviewed-event'
export interface AcceptedFeatureEvent {
  readonly eventId: string
  readonly kind: FeatureEventKind
  readonly actorId: string
  readonly targetIds: readonly string[]
  readonly occurredAt: number
  readonly causalDepth: number
  readonly sourceIds: readonly string[]
}
export interface FeatureEventSubscription {
  readonly subscriptionId: string
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly eventId: string
  readonly optional: boolean
  readonly orderingKey: string
  readonly targetIds: readonly string[]
}
interface FrozenTriggerRow { readonly canonicalId: string, readonly trigger: { readonly required: boolean, readonly kind: FeatureEventKind | null } }
const rows = specsJson as unknown as { entries: readonly FrozenTriggerRow[] }
const triggerById = new Map(rows.entries.map(row => [row.canonicalId, row.trigger]))

/** Route only accepted typed events; browser-authored trigger prose is ignored. */
export const featureSubscriptionsForEvent = (input: {
  readonly sheet: TrainerSheet
  readonly event: AcceptedFeatureEvent
  readonly controlledActorIds: ReadonlySet<string>
  readonly maximumCausalDepth?: number
}): readonly FeatureEventSubscription[] => {
  if (!/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(input.event.eventId) || input.event.causalDepth < 0 || input.event.causalDepth > (input.maximumCausalDepth ?? 24) || input.event.sourceIds.length > 64 || input.event.targetIds.length > 64 || new Set(input.event.targetIds).size !== input.event.targetIds.length || !input.controlledActorIds.has(input.event.actorId)) return Object.freeze([])
  const subscriptions = resolveEffectiveFeatures({ ownerId: input.sheet.slug, sheet: input.sheet }).instances.flatMap(feature => {
    if (!feature.effective || input.event.sourceIds.includes(feature.instanceId)) return []
    const trigger = triggerById.get(feature.canonicalId)
    if (!trigger?.required || trigger.kind !== input.event.kind) return []
    const optional = !feature.mechanics.some(mechanic => mechanic.kind === 'event-subscription' && mechanic.parameters.automatic === true)
    return [Object.freeze({ subscriptionId: `feature-trigger:${feature.instanceId}:${input.event.eventId}`, canonicalId: feature.canonicalId, sourceInstanceId: feature.instanceId, eventId: input.event.eventId, optional, orderingKey: `${optional ? '1' : '0'}:${feature.canonicalId}:${feature.instanceId}`, targetIds: Object.freeze([...input.event.targetIds]) })]
  })
  return Object.freeze(subscriptions.sort((a, b) => a.orderingKey.localeCompare(b.orderingKey)))
}
