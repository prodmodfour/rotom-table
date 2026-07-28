import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emptyEncounterPresentationProjection,
  encounterPresentationStableJson,
  parseEncounterPresentationProjection,
  projectEncounterPresentation,
  type EncounterActionOffer,
  type EncounterInteractionRole,
  type EncounterPassiveSummary,
  type EncounterProjectionAudience,
  type EncounterRuleSourceKind,
} from '../../shared/encounterPresentation'

interface AcceptanceScenario {
  readonly scenarioId: string
  readonly audience: EncounterProjectionAudience
  readonly sourceKinds: readonly EncounterRuleSourceKind[]
  readonly interactionRoles: readonly EncounterInteractionRole[]
  readonly expects: readonly string[]
}

interface AcceptanceScenarioFile {
  readonly schemaVersion: 1
  readonly scenarios: readonly AcceptanceScenario[]
  readonly evidence: Readonly<Record<string, readonly string[]>>
}

const root = resolve(import.meta.dirname, '../..')
const fixture = JSON.parse(readFileSync(
  resolve(root, 'data/encounter-presentation/acceptance-scenarios.json'),
  'utf8',
)) as AcceptanceScenarioFile

const actor = {
  participantId: 'participant:scenario-actor',
  displayName: 'Scenario actor',
  portraitUrl: null,
  sideId: 'side:scenario',
  sideLabel: 'Scenario side',
  sideAccent: null,
  sheetKind: null,
  statusLabels: [],
}

const offerFor = (
  scenario: AcceptanceScenario,
  sourceKind: EncounterRuleSourceKind,
  index: number,
): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: `offer:${scenario.scenarioId}:${index}`,
  mapSlug: 'acceptance-arena',
  mapRevision: 17,
  actor,
  source: {
    sourceKind,
    canonicalId: `${scenario.scenarioId}:${sourceKind}`,
    instanceId: null,
    displayName: `Canonical ${sourceKind} scenario source`,
    referenceHref: null,
  },
  roles: scenario.interactionRoles,
  group: 'support',
  groupOrder: index,
  offerOrder: index,
  timing: { kind: 'system', label: 'Scenario timing', triggerLabel: null, priority: null },
  costs: [],
  targeting: [],
  usage: {
    frequencyLabel: null,
    remaining: null,
    maximum: null,
    cooldownLabel: null,
    resetLabel: null,
  },
  availability: { status: 'available', reasons: [] },
  presentation: {
    label: `${sourceKind} scenario offer`,
    description: null,
    iconKey: null,
    tone: 'neutral',
  },
  intent: { actionId: 'scenario.declare', input: 'immediate' },
})

const passiveFor = (
  scenario: AcceptanceScenario,
  sourceKind: EncounterRuleSourceKind,
  index: number,
): EncounterPassiveSummary => ({
  schemaVersion: 1,
  summaryId: `passive:${scenario.scenarioId}:${index}`,
  participant: actor,
  source: {
    sourceKind,
    canonicalId: `${scenario.scenarioId}:${sourceKind}`,
    instanceId: null,
    displayName: `Canonical ${sourceKind} scenario source`,
    referenceHref: null,
  },
  roles: scenario.interactionRoles.some(role => [
    'passive-provider', 'triggered-automatic', 'triggered-optional', 'interrupt-reaction',
  ].includes(role))
    ? scenario.interactionRoles
    : [...scenario.interactionRoles, 'passive-provider'],
  active: true,
  facts: [],
  presentation: {
    label: `${sourceKind} scenario summary`,
    description: null,
    iconKey: null,
    tone: 'neutral',
  },
  explanation: null,
})

const INVOCABLE_ROLES = new Set<EncounterInteractionRole>([
  'activated-action', 'contextual-affordance', 'triggered-optional',
  'interrupt-reaction', 'choice-only', 'spatial-choice', 'campaign-operation',
])

describe('canonical encounter presentation acceptance scenarios', () => {
  it.each(fixture.scenarios)('$scenarioId passes every classified source through the generic projection', (scenario) => {
    const hasInvocableRole = scenario.interactionRoles.some(role => INVOCABLE_ROLES.has(role))
    const projection = parseEncounterPresentationProjection({
      ...emptyEncounterPresentationProjection({
        mapSlug: 'acceptance-arena',
        mapRevision: 17,
        audience: scenario.audience,
        generatedAt: 1_700_000_000_000,
      }),
      projectionId: `projection:${scenario.scenarioId}`,
      offers: hasInvocableRole
        ? scenario.sourceKinds.map((sourceKind, index) => offerFor(scenario, sourceKind, index))
        : [],
      passives: hasInvocableRole
        ? []
        : scenario.sourceKinds.map((sourceKind, index) => passiveFor(scenario, sourceKind, index)),
    })

    const projected = projectEncounterPresentation({
      source: projection,
      policy: {
        audience: scenario.audience,
        visibleParticipantIds: [actor.participantId],
        controlledParticipantIds: [actor.participantId],
      },
    })

    const projectedSources = [
      ...projected.offers.map(offer => offer.source.sourceKind),
      ...projected.passives.map(passive => passive.source.sourceKind),
    ]
    const projectedRoles = [
      ...projected.offers.flatMap(offer => offer.roles),
      ...projected.passives.flatMap(passive => passive.roles),
    ]
    expect(projectedSources).toEqual(scenario.sourceKinds)
    expect(scenario.interactionRoles.every(role => projectedRoles.includes(role))).toBe(true)
    expect(encounterPresentationStableJson(projected)).not.toContain('undefined')
    expect(scenario.expects.length).toBeGreaterThan(0)
    expect(fixture.evidence[scenario.scenarioId]?.length).toBeGreaterThan(0)
    for (const evidencePath of fixture.evidence[scenario.scenarioId] ?? []) {
      expect(existsSync(resolve(root, evidencePath)), evidencePath).toBe(true)
    }
  })
})
