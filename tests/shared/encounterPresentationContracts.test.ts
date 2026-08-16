import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_AVAILABILITY_REASON_CODES,
  ENCOUNTER_PRESENTATION_LIMITS,
  EncounterPresentationValidationError,
  encounterAvailabilityReason,
  computeEncounterPresentationSha256,
  emptyEncounterPresentationProjection,
  encounterPresentationStableId,
  encounterPresentationStableJson,
  parseEncounterActionDeclarationIntent,
  parseEncounterActionOffer,
  parseEncounterInteractionResponseIntent,
  parseEncounterPresentationProjection,
  projectEncounterPresentation,
  type EncounterActionOffer,
} from '../../shared/encounterPresentation'

const participant = {
  participantId: 'actor:one',
  displayName: 'Pikachu',
  portraitUrl: null,
  sideId: 'side:heroes',
  sideLabel: 'Heroes',
  sideAccent: '#7658ff',
  sheetKind: 'pokemon' as const,
  statusLabels: [],
}
const source = {
  sourceKind: 'move' as const,
  canonicalId: 'Thunder Shock',
  instanceId: null,
  displayName: 'Thunder Shock',
  referenceHref: '/moves/thunder-shock',
}
const offer = (): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: 'offer:one',
  mapSlug: 'arena',
  mapRevision: 7,
  actor: participant,
  source,
  roles: ['activated-action'],
  group: 'attack',
  groupOrder: 10,
  offerOrder: 0,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }],
  targeting: [{
    requirementId: 'target',
    kind: 'participant',
    minSelections: 1,
    maxSelections: 1,
    rangeLabel: 'Range 6',
    relationshipLabel: 'Any creature',
    requiresLineOfSight: true,
    requiresSpatialInput: false,
  }],
  usage: {
    frequencyLabel: 'At-Will',
    remaining: null,
    maximum: null,
    cooldownLabel: null,
    resetLabel: null,
  },
  availability: { status: 'available', reasons: [] },
  presentation: {
    label: 'Thunder Shock',
    description: 'A small electrical attack.',
    iconKey: 'source.move',
    tone: 'neutral',
  },
  intent: { actionId: 'move.declare', input: 'choices' },
})

const projectionWithOffer = () => parseEncounterPresentationProjection({
  ...emptyEncounterPresentationProjection({
    mapSlug: 'arena',
    mapRevision: 7,
    audience: 'gm',
    generatedAt: 100,
  }),
  offers: [offer()],
})

describe('encounter presentation contracts', () => {
  it('strictly parses, detaches, freezes, and preserves a generic action offer', () => {
    const input = offer()
    const parsed = parseEncounterActionOffer(input)
    expect(parsed.source.sourceKind).toBe('move')
    expect(parsed.intent).toEqual({ actionId: 'move.declare', input: 'choices' })
    expect(Object.isFrozen(parsed)).toBe(true)
    input.presentation.label = 'mutated'
    expect(parsed.presentation.label).toBe('Thunder Shock')
  })

  it('strictly preserves safe item target availability and target-specific costs', () => {
    const unavailable = encounterAvailabilityReason('target.invalid')
    const parsed = parseEncounterActionOffer({
      ...offer(),
      sourceContextLabel: 'Rowan · Medical Kit',
      selectionOptions: [{
        kind: 'participant', value: 'target:one', label: 'Pikachu', description: '20/20 HP · At full HP.',
        costs: [{ kind: 'full-action', resourceId: 'full', amount: 1, label: '1 Full Action' }],
        disabled: true,
        unavailableReason: unavailable,
      }],
    })
    expect(parsed.sourceContextLabel).toBe('Rowan · Medical Kit')
    expect(parsed.selectionOptions?.[0]).toMatchObject({
      kind: 'participant', disabled: true, unavailableReason: { code: 'target.invalid' },
      costs: [{ kind: 'full-action', label: '1 Full Action' }],
    })
    expect(() => parseEncounterActionOffer({
      ...offer(),
      selectionOptions: [{
        kind: 'participant', value: 'target:one', label: 'Pikachu', description: null,
        costs: [], disabled: true, unavailableReason: null,
      }],
    })).toThrow(/require exactly one safe unavailable reason/i)
  })

  it('rejects unknown fields, inconsistent availability, and bounded-array overflow', () => {
    expect(() => parseEncounterActionOffer({ ...offer(), mechanicsProgram: 'roll damage' })).toThrow(
      EncounterPresentationValidationError,
    )
    expect(() => parseEncounterActionOffer({ ...offer(), itemCommand: {} })).toThrow(/unknown itemCommand/i)
    expect(() => parseEncounterActionOffer({
      ...offer(),
      availability: { status: 'unavailable', reasons: [] },
    })).toThrow(/at least one reason/i)
    expect(() => parseEncounterPresentationProjection({
      ...projectionWithOffer(),
      offers: Array.from({ length: ENCOUNTER_PRESENTATION_LIMITS.offers + 1 }, (_, index) => ({
        ...offer(),
        offerId: `offer:${index}`,
      })),
    })).toThrow(/at most/i)
  })

  it('conforms every closed unavailable reason and rejects diagnostic evidence in non-diagnostic projections', () => {
    for (const code of ENCOUNTER_AVAILABILITY_REASON_CODES) {
      const parsed = parseEncounterActionOffer({
        ...offer(),
        availability: {
          status: 'unavailable',
          reasons: [encounterAvailabilityReason(code, {
            sources: [source],
            diagnosticDetail: 'private server evidence',
          })],
        },
      })
      expect(parsed.availability.reasons[0]?.code).toBe(code)
      const projected = projectEncounterPresentation({
        source: parseEncounterPresentationProjection({
          ...emptyEncounterPresentationProjection({
            mapSlug: 'arena', mapRevision: 7, audience: 'diagnostic', generatedAt: 100,
          }),
          offers: [parsed],
        }),
        policy: { audience: 'actor-owner', controlledParticipantIds: ['actor:one'] },
      })
      expect(projected.offers[0]?.availability.reasons[0]?.diagnosticDetail).toBeNull()
    }
  })

  it('redacts private diagnostic evidence from unavailable action options', () => {
    const projected = projectEncounterPresentation({
      source: parseEncounterPresentationProjection({
        ...emptyEncounterPresentationProjection({
          mapSlug: 'arena', mapRevision: 7, audience: 'diagnostic', generatedAt: 100,
        }),
        offers: [{
          ...offer(),
          selectionOptions: [{
            kind: 'participant', value: 'target:one', label: 'Target One', description: 'At full HP.',
            disabled: true,
            unavailableReason: encounterAvailabilityReason('target.invalid', {
              sources: [source], diagnosticDetail: 'private target-state evidence',
            }),
          }],
        }],
      }),
      policy: {
        audience: 'actor-owner', controlledParticipantIds: ['actor:one'],
        hiddenSourceKeys: ['move:Thunder Shock:'],
      },
    })
    expect(projected.offers[0]?.selectionOptions?.[0]?.unavailableReason).toMatchObject({
      diagnosticDetail: null,
      sources: [{ sourceKind: 'system', canonicalId: 'private-rule' }],
    })
  })

  it('strictly validates action and pending-response intents', () => {
    const action = parseEncounterActionDeclarationIntent({
      schemaVersion: 1,
      intentId: 'intent:one',
      offerId: 'offer:one',
      mapSlug: 'arena',
      baseRevision: 7,
      actorParticipantId: 'actor:one',
      actionId: 'move.declare',
      selections: [{ choiceId: 'target', optionIds: ['target:one'] }],
    })
    expect(action.selections[0]?.optionIds).toEqual(['target:one'])
    expect(() => parseEncounterInteractionResponseIntent({
      schemaVersion: 1,
      responseId: 'response:one',
      interactionId: 'pending:one',
      resolutionId: 'resolution:one',
      windowId: 'window:one',
      retryKey: 'retry:one',
      mapSlug: 'arena',
      baseRevision: 7,
      decision: 'pass',
      selections: [{ choiceId: 'branch', optionIds: ['yes'] }],
    })).toThrow(/required only for choose/i)
  })

  it('uses deterministic bounded identities and canonical fingerprints', async () => {
    const id = encounterPresentationStableId('offer', 'x'.repeat(500), 'Thunder Shock')
    expect(id.length).toBeLessThanOrEqual(ENCOUNTER_PRESENTATION_LIMITS.identifierLength)
    const left = projectionWithOffer()
    const right = { ...left, offers: [...left.offers] }
    expect(encounterPresentationStableJson(left)).toBe(encounterPresentationStableJson(right))
    expect(await computeEncounterPresentationSha256(left)).toMatch(/^[a-f0-9]{64}$/)
    expect(await computeEncounterPresentationSha256(left)).toBe(await computeEncounterPresentationSha256(right))
  })

  it('redacts private contribution rows into one safe explanation without changing the result', () => {
    const sourceProjection = parseEncounterPresentationProjection({
      ...emptyEncounterPresentationProjection({
        mapSlug: 'arena', mapRevision: 7, audience: 'diagnostic', generatedAt: 100,
      }),
      projectionId: 'projection:private-contribution',
      passives: [{
        schemaVersion: 1,
        summaryId: 'passive:private',
        participant,
        source: {
          sourceKind: 'capability', canonicalId: 'Defense', instanceId: null,
          displayName: 'Defense', referenceHref: null,
        },
        roles: ['passive-provider'],
        active: true,
        facts: [{
          factId: 'fact:defense', factKey: 'defense', label: 'Defense',
          value: { kind: 'number', numberValue: 12, textValue: null, booleanValue: null, unit: null },
        }],
        presentation: { label: 'Defense', description: null, iconKey: null, tone: 'neutral' },
        explanation: {
          schemaVersion: 1,
          explanationId: 'explanation:defense',
          subjectId: 'actor:one',
          label: 'Defense total',
          result: { kind: 'number', numberValue: 12, textValue: null, booleanValue: null, unit: null },
          contributions: [{
            contributionId: 'contribution:base', order: 0, kind: 'base', source: null,
            label: 'Base Defense',
            value: { kind: 'number', numberValue: 10, textValue: null, booleanValue: null, unit: null },
            applied: true, private: false, preventionReason: null,
          }, {
            contributionId: 'contribution:secret', order: 1, kind: 'add',
            source: {
              sourceKind: 'ability', canonicalId: 'Secret Guard', instanceId: 'ability:secret',
              displayName: 'Secret Guard', referenceHref: null,
            },
            label: 'Secret Guard',
            value: { kind: 'number', numberValue: 2, textValue: null, booleanValue: null, unit: null },
            applied: true, private: true, preventionReason: null,
          }],
        },
      }],
    })
    const projected = projectEncounterPresentation({
      source: sourceProjection,
      policy: { audience: 'public', visibleParticipantIds: ['actor:one'] },
    })
    const explanation = projected.passives[0]?.explanation
    expect(explanation?.result.numberValue).toBe(12)
    expect(explanation?.contributions.map(row => row.label)).toEqual([
      'Base Defense', 'A private rule affected this result',
    ])
    expect(encounterPresentationStableJson(projected)).not.toContain('Secret Guard')
  })

  it('removes actions and diagnostics at a public privacy boundary', () => {
    const sourceProjection = parseEncounterPresentationProjection({
      ...projectionWithOffer(),
      audience: 'diagnostic',
      projectionId: 'projection:diagnostic',
      diagnostics: [{
        diagnosticId: 'diagnostic:one',
        label: 'Private trace',
        detail: 'GM-only runtime detail',
        source,
      }],
    })
    const projected = projectEncounterPresentation({
      source: sourceProjection,
      policy: { audience: 'public' },
    })
    expect(projected.offers).toEqual([])
    expect(projected.diagnostics).toEqual([])
    expect(encounterPresentationStableJson(projected)).not.toContain('GM-only runtime detail')
  })
})
