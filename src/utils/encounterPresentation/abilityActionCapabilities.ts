import {
  parseAbilityClientCapabilityBundle,
  type AbilityClientCapability,
  type AbilityClientCapabilityBundle,
  type AbilityClientModeCapability,
} from '#shared/abilityAutomation/clientCapabilities'
import type { AbilitySpecTargetingKind } from '#shared/abilityAutomation/spec'
import type {
  EncounterActionOffer,
  EncounterPresentationProjection,
  EncounterTargetingSummary,
} from '#shared/encounterPresentation'

const ABILITY_ACTION_PREFIX = 'ability.declare:'

const modeIdForOffer = (offer: EncounterActionOffer): string | null => (
  offer.intent.actionId.startsWith(ABILITY_ACTION_PREFIX)
    ? offer.intent.actionId.slice(ABILITY_ACTION_PREFIX.length) || null
    : null
)

const targetingKind = (target: EncounterTargetingSummary): AbilitySpecTargetingKind => {
  const mapping: Readonly<Partial<Record<EncounterTargetingSummary['kind'], AbilitySpecTargetingKind>>> = {
    none: 'none',
    self: 'self',
    participant: 'token',
    side: 'side',
    item: 'item',
    move: 'move',
    cell: 'cell',
    area: 'area',
    direction: 'direction',
  }
  return mapping[target.kind] ?? 'none'
}

const modeForOffer = (offer: EncounterActionOffer): AbilityClientModeCapability | null => {
  const modeId = modeIdForOffer(offer)
  if (!modeId) return null
  return {
    modeId,
    kind: offer.roles.includes('choice-only') ? 'configuration' : 'activated',
    invocable: offer.availability.status === 'available',
    targeting: offer.targeting.map(target => ({
      id: target.requirementId,
      kind: targetingKind(target),
      minSelections: target.minSelections,
      maxSelections: target.maxSelections,
    })),
  }
}

const capabilityForOffers = (
  offers: readonly EncounterActionOffer[],
  passive: boolean,
): AbilityClientCapability | null => {
  const first = offers[0]
  if (!first || first.source.instanceId === null) return null
  const modes = offers.flatMap(offer => {
    const mode = modeForOffer(offer)
    return mode ? [mode] : []
  })
  const available = modes.some(mode => mode.invocable)
  const reasonCode = offers.flatMap(offer => offer.availability.reasons)[0]?.code ?? null
  const status: AbilityClientCapability['status'] = available
    ? 'ready'
    : reasonCode === 'source.suppressed'
      ? 'suppressed'
      : reasonCode === 'action.parameters-required'
        ? 'parameters-required'
        : reasonCode === 'action.runtime-drift'
          ? 'runtime-drift'
          : passive
            ? 'passive'
            : 'blocked'
  return {
    instanceId: first.source.instanceId,
    canonicalId: first.source.canonicalId,
    displayName: first.source.displayName,
    effective: status !== 'suppressed',
    baseStatus: status === 'blocked' ? 'blocked' : 'complete',
    interactionStatus: 'complete',
    status,
    statusBadgeKey: `ability.status.${status}`,
    unavailableReasonCode: status === 'ready' || status === 'passive' ? null : reasonCode ?? 'action.unsupported',
    modes,
  }
}

/**
 * Local view-model adapter for the existing map controls. The server wire input
 * is exclusively the generic encounter bundle; no legality is reconstructed
 * from labels or sheet text here.
 */
export const abilityActionCapabilitiesFromEncounterPresentation = (
  projection: EncounterPresentationProjection,
): AbilityClientCapabilityBundle => {
  const abilityOffers = projection.offers.filter(offer => offer.source.sourceKind === 'ability')
  const passiveKeys = new Set(projection.passives
    .filter(summary => summary.source.sourceKind === 'ability')
    .map(summary => `${summary.participant.participantId}:${summary.source.instanceId ?? ''}`))
  const offersByKey = new Map<string, EncounterActionOffer[]>()
  for (const offer of abilityOffers) {
    const key = `${offer.actor.participantId}:${offer.source.instanceId ?? ''}`
    const values = offersByKey.get(key) ?? []
    values.push(offer)
    offersByKey.set(key, values)
  }
  for (const summary of projection.passives) {
    if (summary.source.sourceKind !== 'ability' || summary.source.instanceId === null) continue
    const key = `${summary.participant.participantId}:${summary.source.instanceId}`
    if (!offersByKey.has(key)) {
      offersByKey.set(key, [{
        schemaVersion: 1,
        offerId: `adapter:${key}`,
        mapSlug: projection.mapSlug,
        mapRevision: projection.mapRevision,
        actor: summary.participant,
        source: summary.source,
        roles: ['activated-action'],
        group: 'support',
        groupOrder: 0,
        offerOrder: 0,
        timing: { kind: 'passive', label: 'Passive', triggerLabel: null, priority: null },
        costs: [],
        targeting: [],
        usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
        availability: { status: 'unavailable', reasons: [{
          code: 'action.unsupported',
          label: 'This action is not automated yet',
          sources: [],
          diagnosticDetail: null,
        }] },
        presentation: summary.presentation,
        intent: { actionId: 'ability.passive', input: 'immediate' },
      }])
    }
  }
  const placements = new Map<string, AbilityClientCapability[]>()
  for (const [key, offers] of offersByKey) {
    const separator = key.indexOf(':')
    const placementId = key.slice(0, separator)
    const capability = capabilityForOffers(offers, passiveKeys.has(key))
    if (!capability) continue
    const values = placements.get(placementId) ?? []
    values.push(capability)
    placements.set(placementId, values)
  }
  return parseAbilityClientCapabilityBundle({
    schemaVersion: 1,
    mapSlug: projection.mapSlug,
    mapRevision: projection.mapRevision,
    placements: [...placements].map(([placementId, abilities]) => ({ placementId, abilities })),
  })
}
