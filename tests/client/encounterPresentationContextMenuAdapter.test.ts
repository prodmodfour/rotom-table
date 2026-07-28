import { describe, expect, it } from 'vitest'
import { parseEncounterPresentationProjection } from '../../shared/encounterPresentation'
import {
  contextMenuItemOptionsFromEncounterAffordances,
  contextMenuOptionsFromEncounterOffers,
} from '../../src/utils/encounterPresentation/legacyContextMenuProjection'

const actor = {
  participantId: 'actor:one', displayName: 'Actor', portraitUrl: null, sideId: null,
  sideLabel: null, sideAccent: null, sheetKind: 'trainer' as const, statusLabels: [],
}
const source = {
  sourceKind: 'move' as const, canonicalId: 'Ember', instanceId: null,
  displayName: 'Ember', referenceHref: null,
}
const projection = parseEncounterPresentationProjection({
  schemaVersion: 1,
  projectionId: 'projection:adapter',
  audience: 'actor-owner',
  mapSlug: 'arena',
  mapRevision: 2,
  generatedAt: 10,
  offers: [{
    schemaVersion: 1,
    offerId: 'offer:ember',
    mapSlug: 'arena',
    mapRevision: 2,
    actor,
    source,
    roles: ['activated-action'],
    group: 'attack',
    groupOrder: 0,
    offerOrder: 0,
    timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
    costs: [], targeting: [],
    usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
    availability: { status: 'available', reasons: [] },
    presentation: { label: 'Ember', description: null, iconKey: null, tone: 'neutral' },
    intent: { actionId: 'move.declare', input: 'choices' },
  }, {
    schemaVersion: 1,
    offerId: 'offer:capture',
    mapSlug: 'arena',
    mapRevision: 2,
    actor,
    source: { sourceKind: 'capture', canonicalId: 'throw-poke-ball', instanceId: null, displayName: 'Throw Poké Ball', referenceHref: null },
    roles: ['activated-action'],
    group: 'capture', groupOrder: 1, offerOrder: 0,
    timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
    costs: [], targeting: [],
    usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
    availability: { status: 'available', reasons: [] },
    presentation: { label: 'Throw Poké Ball', description: null, iconKey: null, tone: 'neutral' },
    intent: { actionId: 'capture.throw', input: 'choices' },
  }],
  passives: [],
  affordances: [{
    schemaVersion: 1,
    affordanceId: 'affordance:poke-ball',
    contextKind: 'inventory',
    contextId: 'inventory:actor',
    source: { sourceKind: 'item', canonicalId: 'Poké Ball', instanceId: 'item:one', displayName: 'Poké Ball', referenceHref: null },
    actor,
    linkedOfferId: null,
    availability: { status: 'available', reasons: [] },
    presentation: { label: 'Poké Ball', description: null, iconKey: null, tone: 'neutral' },
  }],
  pending: [], accepted: [], diagnostics: [],
})

describe('generic encounter context-menu compatibility adapter', () => {
  it('uses server offers as the inclusion authority while preserving decorative rows', () => {
    const options = contextMenuOptionsFromEncounterOffers({
      projection,
      sourceKind: 'move',
      optionsByParticipantId: {
        'actor:one': [
          { name: 'Ember', detail: 'decorative reference copy' },
          { name: 'Hydro Pump', detail: 'must not become legal from local metadata' },
        ],
      },
    })
    expect(options['actor:one']).toEqual([{ name: 'Ember', detail: 'decorative reference copy' }])
  })

  it('requires both a capture offer and a server-projected item affordance', () => {
    const options = contextMenuItemOptionsFromEncounterAffordances({
      projection,
      optionsByParticipantId: {
        'actor:one': [{ name: 'Poké Ball' }, { name: 'Great Ball' }],
      },
    })
    expect(options['actor:one']).toEqual([{ name: 'Poké Ball' }])
  })
})
