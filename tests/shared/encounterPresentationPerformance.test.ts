import { describe, expect, it } from 'vitest'
import {
  encounterPresentationStableJson,
  parseEncounterPresentationProjection,
  type EncounterActionOffer,
} from '../../shared/encounterPresentation'

const makeOffer = (index: number): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: `offer:scale:${index}`,
  mapSlug: 'scale-arena',
  mapRevision: 42,
  actor: {
    participantId: `actor:${index % 64}`,
    displayName: `Participant ${index % 64}`,
    portraitUrl: null,
    sideId: null,
    sideLabel: null,
    sideAccent: null,
    sheetKind: 'pokemon',
    statusLabels: [],
  },
  source: {
    sourceKind: index % 2 ? 'move' : 'ability',
    canonicalId: `Source ${index}`,
    instanceId: index % 2 ? null : `ability:${index}`,
    displayName: `Source ${index}`,
    referenceHref: null,
  },
  roles: ['activated-action'],
  group: index % 2 ? 'attack' : 'support',
  groupOrder: index % 2,
  offerOrder: index,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [],
  targeting: [],
  usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: `Source ${index}`, description: null, iconKey: null, tone: 'neutral' },
  intent: { actionId: 'action.declare', input: 'choices' },
})

describe('encounter presentation catalog-scale budget', () => {
  it('strictly projects a crowded 512-offer encounter within the realtime and latency budgets', () => {
    const started = performance.now()
    const projection = parseEncounterPresentationProjection({
      schemaVersion: 1,
      projectionId: 'projection:scale-arena:42:gm',
      audience: 'gm',
      mapSlug: 'scale-arena',
      mapRevision: 42,
      generatedAt: 100,
      offers: Array.from({ length: 512 }, (_, index) => makeOffer(index)),
      passives: [],
      affordances: [],
      pending: [],
      accepted: [],
      diagnostics: [],
    })
    const elapsed = performance.now() - started
    const bytes = new TextEncoder().encode(encounterPresentationStableJson(projection)).byteLength
    expect(projection.offers).toHaveLength(512)
    expect(bytes).toBeLessThanOrEqual(1_048_576)
    expect(elapsed).toBeLessThan(2_000)
  })
})
