import { describe, expect, it } from 'vitest'
import {
  emptyEncounterPresentationProjection,
  parseEncounterPresentationProjection,
  type EncounterActionOffer,
} from '../../shared/encounterPresentation'
import { declareEncounterActionUseCase } from '../../server/useCases/declareEncounterAction'

const offer = (available = true): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: 'offer:server-authorized',
  mapSlug: 'arena',
  mapRevision: 7,
  actor: {
    participantId: 'actor:one', displayName: 'Pikachu', portraitUrl: null,
    sideId: null, sideLabel: null, sideAccent: null, sheetKind: 'pokemon', statusLabels: [],
  },
  source: {
    sourceKind: 'move', canonicalId: 'Ember', instanceId: null,
    displayName: 'Ember', referenceHref: '/moves/ember',
  },
  roles: ['activated-action'],
  group: 'attack', groupOrder: 0, offerOrder: 0,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }],
  targeting: [{
    requirementId: 'target', kind: 'participant', minSelections: 1, maxSelections: 1,
    rangeLabel: 'Range 4', relationshipLabel: null, requiresLineOfSight: true,
    requiresSpatialInput: false,
  }],
  usage: { frequencyLabel: 'At-Will', remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: available
    ? { status: 'available', reasons: [] }
    : {
        status: 'unavailable',
        reasons: [{ code: 'usage.scene-exhausted', label: 'Already used this scene', sources: [], diagnosticDetail: null }],
      },
  presentation: { label: 'Ember', description: null, iconKey: 'source.move', tone: 'neutral' },
  intent: { actionId: 'move.declare', input: 'choices' },
})
const projection = (candidate = offer()) => parseEncounterPresentationProjection({
  ...emptyEncounterPresentationProjection({ mapSlug: 'arena', mapRevision: 7, audience: 'actor-owner' }),
  offers: [candidate],
})
const intent = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  intentId: 'intent:one',
  offerId: 'offer:server-authorized',
  mapSlug: 'arena',
  baseRevision: 7,
  actorParticipantId: 'actor:one',
  actionId: 'move.declare',
  selections: [],
  ...overrides,
})

describe('generic encounter action declaration authorization', () => {
  it('returns only the exact current server offer', () => {
    const result = declareEncounterActionUseCase({ role: 'player', intent: intent() }, {
      loadProjection: () => projection(),
    })
    expect(result.offerId).toBe('offer:server-authorized')
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each([
    ['stale revision', { baseRevision: 6 }],
    ['spoofed actor', { actorParticipantId: 'actor:other' }],
    ['spoofed action', { actionId: 'system.delete' }],
    ['unknown offer', { offerId: 'offer:unknown' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => declareEncounterActionUseCase({ role: 'player', intent: intent(overrides) }, {
      loadProjection: () => projection(),
    })).toThrow()
  })

  it('rejects an unavailable offer with its safe server reason', () => {
    expect(() => declareEncounterActionUseCase({ role: 'gm', intent: intent() }, {
      loadProjection: () => projection(offer(false)),
    })).toThrow('Already used this scene')
  })
})
