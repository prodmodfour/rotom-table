import { describe, expect, it } from 'vitest'
import type {
  EncounterActionOffer,
  EncounterChoiceOffer,
} from '../../shared/encounterPresentation'
import type {
  EncounterWorkspaceEnvironmentEntry,
  EncounterWorkspaceParticipant,
} from '../../shared/encounterWorkspace/model'
import {
  encounterCompactSpatialPreviews,
  encounterProjectedDistance,
  encounterRelationshipRows,
  encounterSpatialPresentationForChoice,
  encounterSpatialPresentationForOffer,
  encounterTacticalStartupWithinBudget,
} from '../../shared/encounterWorkspace/spatiality'

const action = (target: EncounterActionOffer['targeting'][number]): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: `offer:${target.kind}`,
  mapSlug: 'arena',
  mapRevision: 4,
  actor: {
    participantId: 'actor', displayName: 'Actor', portraitUrl: null,
    sideId: 'heroes', sideLabel: 'Heroes', sideAccent: '#456789', sheetKind: 'pokemon', statusLabels: [],
  },
  source: { sourceKind: 'move', canonicalId: 'Test', instanceId: null, displayName: 'Test', referenceHref: null },
  roles: ['activated-action'],
  group: 'attack',
  groupOrder: 1,
  offerOrder: 1,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [],
  targeting: [target],
  usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: 'Test', description: null, iconKey: null, tone: 'neutral' },
  intent: { actionId: 'move.declare', input: target.requiresSpatialInput ? 'spatial' : 'choices' },
})
const target = (patch: Partial<EncounterActionOffer['targeting'][number]> = {}): EncounterActionOffer['targeting'][number] => ({
  requirementId: 'target', kind: 'none', minSelections: 0, maxSelections: 0,
  rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  ...patch,
})
const choice = (patch: Partial<EncounterChoiceOffer> = {}): EncounterChoiceOffer => ({
  schemaVersion: 1,
  choiceOfferId: 'choice-offer:spatial',
  interactionId: 'interaction:one',
  mapSlug: 'arena',
  mapRevision: 4,
  choiceId: 'space',
  kind: 'cell',
  prompt: 'Choose a cell',
  helpText: null,
  cardinality: { minimum: 1, maximum: 1 },
  ordering: 'spatial',
  options: [],
  defaultOptionIds: [],
  requiresConfirmation: true,
  allowPass: false,
  allowCancel: true,
  expiresAt: null,
  ...patch,
})
const participant = (
  participantId: string,
  x: number,
  z: number,
  patch: Partial<EncounterWorkspaceParticipant> = {},
): EncounterWorkspaceParticipant => ({
  participantId,
  kind: 'pokemon',
  sheetSlug: participantId,
  displayName: participantId,
  roleLabel: 'Pokémon',
  portraitUrl: null,
  side: { id: 'heroes', label: 'Heroes', color: '#456789', symbol: '◆' },
  onMap: true,
  reserve: false,
  hidden: false,
  currentTurn: participantId === 'actor',
  controlled: participantId === 'actor',
  initiative: 10,
  position: { x, y: 0, z },
  footprint: { base: 1, clearance: 1 },
  hp: { current: 10, maximum: 10, temporary: 0 },
  injuries: 0,
  conditions: [],
  resources: [],
  fainted: false,
  ...patch,
})

describe('encounter progressive spatiality', () => {
  it('uses the least-spatial view justified by authoritative requirements', () => {
    expect(encounterTacticalStartupWithinBudget(4_999)).toBe(true)
    expect(encounterTacticalStartupWithinBudget(5_001)).toBe(false)
    expect(encounterSpatialPresentationForOffer(action(target()))).toBe('card')
    expect(encounterSpatialPresentationForOffer(action(target({
      kind: 'participant', minSelections: 1, maxSelections: 1,
    })))).toBe('relationship')
    expect(encounterSpatialPresentationForOffer(action(target({
      kind: 'path', minSelections: 1, maxSelections: 1, requiresSpatialInput: true,
    })))).toBe('full-tactical')
    expect(encounterSpatialPresentationForChoice(choice())).toBe('full-tactical')
    expect(encounterSpatialPresentationForChoice(choice({ kind: 'participant', ordering: 'initiative' }))).toBe('relationship')
  })

  it('uses compact previews only for explicit server-issued spatial payloads and never parses IDs', () => {
    const spatial = choice({
      kind: 'path',
      options: [{
        optionId: 'looks-like-cell:99:99:99',
        label: 'North path',
        description: null,
        disabled: false,
        unavailableReason: null,
        preview: {
          kind: 'spatial',
          cells: [{ x: 2, y: 0, z: 2 }],
          destination: { x: 3, y: 0, z: 2 },
          path: [{ x: 2, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }],
          direction: 'north',
        },
      }],
    })
    expect(encounterSpatialPresentationForChoice(spatial)).toBe('compact-tactical')
    expect(encounterCompactSpatialPreviews(spatial)).toEqual([expect.objectContaining({
      optionId: 'looks-like-cell:99:99:99',
      cells: [{ x: 2, y: 0, z: 2 }],
      destination: { x: 3, y: 0, z: 2 },
    })])
    expect(encounterCompactSpatialPreviews(choice({
      options: [{
        optionId: 'cell:4:0:4', label: 'Opaque option', description: null, disabled: false,
        unavailableReason: null, preview: { kind: 'none' },
      }],
    }))).toEqual([])
  })

  it('derives distances and ally/foe presentation only from projected footprints and keeps eligibility server-owned', () => {
    const actor = participant('actor', 0, 0)
    const adjacent = participant('ally', 1, 0)
    const diagonal = participant('foe', 3, 2, {
      side: { id: 'foes', label: 'Foes', color: '#984f54', symbol: '▲' },
    })
    const hiddenGeometry = participant('unknown', 2, 2, { position: null, footprint: null, side: null })
    expect(encounterProjectedDistance(actor, adjacent)).toBe(1)
    expect(encounterProjectedDistance(actor, diagonal)).toBe(4)
    expect(encounterProjectedDistance(actor, hiddenGeometry)).toBeNull()
    const environment: EncounterWorkspaceEnvironmentEntry[] = [{
      environmentId: 'weather:rain', kind: 'weather', label: 'Rainy', rounds: 3, scopeLabel: 'Battlefield',
    }]
    const rows = encounterRelationshipRows({
      actor,
      participants: [actor, adjacent, diagonal, hiddenGeometry],
      targeting: [target({
        kind: 'participant', minSelections: 1, maxSelections: 1,
        rangeLabel: 'Range 6', relationshipLabel: 'Any creature', requiresLineOfSight: true,
      })],
      environment,
    })
    expect(rows.find(row => row.participantId === 'ally')).toMatchObject({ relation: 'ally', adjacent: true })
    expect(rows.find(row => row.participantId === 'foe')).toMatchObject({
      relation: 'foe', distanceMeters: 4, lineOfSight: 'server-validation-required',
      eligibility: 'server-validation-required', rangeLabels: ['Range 6'], zoneLabels: ['Rainy'],
    })
    expect(rows.find(row => row.participantId === 'unknown')).toMatchObject({ relation: 'unaligned', distanceMeters: null })
  })
})
