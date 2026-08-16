import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_ACTION_GROUPS,
  ENCOUNTER_CHOICE_KINDS,
  ENCOUNTER_RULE_SOURCE_KINDS,
  type EncounterActionOffer,
  type EncounterChoiceOffer,
  type EncounterPendingInteractionAuthorizedView,
} from '../../shared/encounterPresentation'
import {
  ENCOUNTER_ACTION_DOCK_RECENT_LIMIT,
  encounterActionCostLabel,
  encounterActionRecencyKey,
  encounterActionTargetLabel,
  encounterActionUsageLabel,
  filterEncounterActionOffers,
  groupEncounterActionOffers,
  orderEncounterActionsByRecency,
  recordRecentEncounterAction,
} from '../../shared/encounterWorkspace/actionDock'
import {
  buildEncounterActionDecision,
  buildEncounterPendingDecision,
  encounterDecisionChoiceSelections,
  encounterDecisionSelectionsValid,
  initialEncounterDecisionSelections,
  toggleEncounterDecisionOption,
} from '../../shared/encounterWorkspace/decision'
import performanceBudgets from '../../data/encounter-workspace/performance-budgets.json'
import type {
  EncounterWorkspaceParticipant,
  EncounterWorkspaceSide,
} from '../../shared/encounterWorkspace/model'

const participant = (
  participantId: string,
  patch: Partial<EncounterWorkspaceParticipant> = {},
): EncounterWorkspaceParticipant => ({
  participantId,
  kind: 'pokemon',
  sheetSlug: participantId,
  displayName: participantId,
  roleLabel: 'Pokémon',
  portraitUrl: null,
  side: { id: 'heroes', label: 'Heroes', symbol: '◆', color: '#456789' },
  onMap: true,
  reserve: false,
  hidden: false,
  currentTurn: participantId === 'actor:one',
  controlled: participantId === 'actor:one',
  initiative: 10,
  position: { x: 1, y: 0, z: 1 },
  footprint: { base: 1, clearance: 1 },
  hp: { current: 10, maximum: 20, temporary: 0 },
  injuries: 0,
  conditions: [],
  resources: [],
  fainted: false,
  ...patch,
})

const sides: readonly EncounterWorkspaceSide[] = [{
  sideId: 'heroes',
  label: 'Heroes',
  accent: '#456789',
  symbol: '◆',
  status: 'active',
  participantIds: ['actor:one', 'ally:one'],
  hiddenParticipantCount: null,
}, {
  sideId: 'foes',
  label: 'Foes',
  accent: '#984f54',
  symbol: '▲',
  status: 'active',
  participantIds: ['target:one'],
  hiddenParticipantCount: null,
}]

const offer = (
  id: string,
  patch: Partial<EncounterActionOffer> = {},
): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: id,
  mapSlug: 'arena',
  mapRevision: 7,
  actor: {
    participantId: 'actor:one',
    displayName: 'Actor One',
    portraitUrl: null,
    sideId: 'heroes',
    sideLabel: 'Heroes',
    sideAccent: '#456789',
    sheetKind: 'pokemon',
    statusLabels: [],
  },
  source: {
    sourceKind: 'move',
    canonicalId: 'Move One',
    instanceId: null,
    displayName: 'Move One',
    referenceHref: null,
  },
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
    relationshipLabel: 'Any visible participant',
    requiresLineOfSight: true,
    requiresSpatialInput: false,
  }],
  usage: { frequencyLabel: 'Scene', remaining: 1, maximum: 2, cooldownLabel: null, resetLabel: 'Scene end' },
  availability: { status: 'available', reasons: [] },
  presentation: { label: `Action ${id}`, description: `Description ${id}`, iconKey: null, tone: 'neutral' },
  intent: { actionId: 'move.declare', input: 'choices' },
  ...patch,
})

const participants = [
  participant('actor:one'),
  participant('ally:one'),
  participant('target:one', {
    displayName: 'Target One',
    side: { id: 'foes', label: 'Foes', symbol: '▲', color: '#984f54' },
    fainted: true,
  }),
]

describe('encounter action dock model', () => {
  it('filters source-agnostic offers by actor, group, availability, and searchable anatomy', () => {
    const values = [
      offer('move'),
      offer('item', {
        actor: { ...offer('base').actor, participantId: 'ally:one', displayName: 'Ally One' },
        group: 'inventory',
        groupOrder: 20,
        source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: null, displayName: 'Super Potion', referenceHref: null },
        availability: {
          status: 'unavailable',
          reasons: [{ code: 'source.item-unavailable', label: 'No potion remains', sources: [], diagnosticDetail: null }],
        },
        selectionOptions: [{
          kind: 'participant', value: 'ally:one', label: 'Ally One', description: 'At full HP.',
          disabled: true,
          unavailableReason: { code: 'target.invalid', label: 'That target is not eligible', sources: [], diagnosticDetail: null },
        }],
      }),
    ]
    expect(filterEncounterActionOffers({
      offers: values,
      actorParticipantId: 'actor:one',
      filters: { query: 'range 6', group: 'attack', availability: 'available' },
    }).map(value => value.offerId)).toEqual(['move'])
    expect(filterEncounterActionOffers({
      offers: values,
      actorParticipantId: null,
      filters: { query: 'super potion', group: 'all', availability: 'unavailable' },
    }).map(value => value.offerId)).toEqual(['item'])
    expect(filterEncounterActionOffers({
      offers: values,
      actorParticipantId: null,
      filters: { query: 'at full hp', group: 'inventory', availability: 'unavailable' },
    }).map(value => value.offerId)).toEqual(['item'])
    expect(groupEncounterActionOffers(values).map(value => value.group)).toEqual(['attack', 'inventory'])
  })

  it('keeps runtime recents bounded and presents cost, usage, and targeting without deriving mechanics', () => {
    let recent: readonly string[] = []
    for (let index = 0; index < ENCOUNTER_ACTION_DOCK_RECENT_LIMIT + 5; index += 1) {
      recent = recordRecentEncounterAction(recent, `offer:${index}`)
    }
    expect(recent).toHaveLength(ENCOUNTER_ACTION_DOCK_RECENT_LIMIT)
    expect(recent[0]).toBe(`offer:${ENCOUNTER_ACTION_DOCK_RECENT_LIMIT + 4}`)
    expect(encounterActionCostLabel(offer('one'))).toBe('1 Standard Action')
    expect(encounterActionUsageLabel(offer('one'))).toBe('1/2 Scene')
    expect(encounterActionTargetLabel(offer('one'))).toContain('Range 6')
    expect(encounterActionUsageLabel(offer('potion', {
      source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: 'item:one', displayName: 'Potion', referenceHref: null },
      usage: { frequencyLabel: null, remaining: 2, maximum: 2, cooldownLabel: null, resetLabel: null },
    }))).toBe('2 available')
  })

  it('keeps a recent action recognizable across authoritative map revisions without persistence', () => {
    const first = offer('revision:7', {
      source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: 'item:stable', displayName: 'Potion', referenceHref: null },
      intent: { actionId: 'item.use:item:stable', input: 'choices' },
    })
    const refreshed = { ...first, offerId: 'revision:8', mapRevision: 8 }
    const other = offer('other', { offerOrder: -1 })
    const recent = recordRecentEncounterAction([], encounterActionRecencyKey(first))
    expect(orderEncounterActionsByRecency([other, refreshed], recent).map(value => value.offerId))
      .toEqual(['revision:8', 'other'])
  })

  it('filters the maximum projected offer inventory inside the local interaction p95 budget', () => {
    const values = Array.from({ length: 2_048 }, (_, index) => offer(`scale:${index}`, {
      presentation: { label: index % 5 === 0 ? `Expected action ${index}` : `Other action ${index}`, description: null, iconKey: null, tone: 'neutral' },
      offerOrder: index,
    }))
    const run = (): number => {
      const startedAt = performance.now()
      const result = filterEncounterActionOffers({
        offers: values,
        actorParticipantId: 'actor:one',
        filters: { query: 'expected action', group: 'attack', availability: 'available' },
      })
      expect(result.length).toBeGreaterThan(0)
      return performance.now() - startedAt
    }
    for (let index = 0; index < 5; index += 1) run()
    const samples = Array.from({ length: 30 }, run).sort((left, right) => left - right)
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!
    expect(p95).toBeLessThanOrEqual(performanceBudgets.runtime.interactionP95Ms)
  })

  it('accepts every canonical source and action group without source-specific branches', () => {
    const values = ENCOUNTER_RULE_SOURCE_KINDS.map((sourceKind, index) => offer(`offer:${sourceKind}`, {
      source: { sourceKind, canonicalId: sourceKind, instanceId: null, displayName: sourceKind, referenceHref: null },
      group: ENCOUNTER_ACTION_GROUPS[index % ENCOUNTER_ACTION_GROUPS.length]!,
      groupOrder: index,
    }))
    expect(filterEncounterActionOffers({
      offers: values,
      actorParticipantId: null,
      filters: { query: '', group: 'all', availability: 'all' },
    })).toHaveLength(ENCOUNTER_RULE_SOURCE_KINDS.length)
  })
})

describe('encounter generic decision model', () => {
  it('builds participant, side, self, resource, and spatial choices only from projected identities', () => {
    const participantDecision = buildEncounterActionDecision({ offer: offer('participant'), participants, sides })
    expect(participantDecision.choices[0]?.options.map(value => value.optionId)).toEqual([
      'actor:one', 'ally:one', 'target:one',
    ])
    // Fainted state is presentation, not enough information for the browser to infer target legality.
    expect(participantDecision.choices[0]?.options.find(value => value.optionId === 'target:one')?.disabled).toBe(false)

    const authoritativeParticipantDecision = buildEncounterActionDecision({
      offer: offer('authoritative-participants', {
        selectionOptions: [{
          kind: 'participant', value: 'ally:one', label: 'Ally One',
          description: '10/20 HP · 20 HP requested · 10 HP restored · 10 overheal',
          costs: [{ kind: 'item', resourceId: null, amount: 1, label: 'Consume 1 Potion' }],
          disabled: false,
          unavailableReason: null,
        }, {
          kind: 'participant', value: 'target:one', label: 'Target One',
          description: '20/20 HP · At full HP.',
          costs: [{ kind: 'item', resourceId: null, amount: 1, label: 'Consume 1 Potion' }],
          disabled: true,
          unavailableReason: {
            code: 'target.invalid', label: 'That target is not eligible', sources: [], diagnosticDetail: null,
          },
        }],
      }),
      participants,
      sides,
    })
    expect(authoritativeParticipantDecision.choices[0]?.options).toEqual([
      expect.objectContaining({
        optionId: 'ally:one', disabled: false,
        description: '10/20 HP · 20 HP requested · 10 HP restored · 10 overheal',
      }),
      expect.objectContaining({
        optionId: 'target:one', disabled: true,
        description: '20/20 HP · At full HP.',
        unavailableReason: expect.objectContaining({ code: 'target.invalid' }),
      }),
    ])
    const authoritativeChoice = authoritativeParticipantDecision.choices[0]!
    expect(toggleEncounterDecisionOption({
      selections: initialEncounterDecisionSelections(authoritativeParticipantDecision),
      choice: authoritativeChoice,
      optionId: 'target:one',
    })).toEqual({ target: [] })

    const emptyItemDecision = buildEncounterActionDecision({
      offer: offer('empty-item-targets', {
        source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: 'item:one', displayName: 'Potion', referenceHref: null },
        selectionOptions: [],
      }),
      participants,
      sides,
    })
    expect(emptyItemDecision.choices[0]?.options).toEqual([])
    expect(encounterDecisionSelectionsValid(emptyItemDecision, initialEncounterDecisionSelections(emptyItemDecision))).toBe(false)

    const sideDecision = buildEncounterActionDecision({
      offer: offer('side', { targeting: [{ ...offer('base').targeting[0]!, kind: 'side' }] }),
      participants,
      sides,
    })
    expect(sideDecision.choices[0]?.options.map(value => value.optionId)).toEqual(['heroes', 'foes'])

    const ownedDecision = buildEncounterActionDecision({
      offer: offer('owned', { targeting: [{ ...offer('base').targeting[0]!, relationshipLabel: 'owned' }] }),
      participants,
      sides,
    })
    expect(ownedDecision.choices[0]?.options.map(value => value.optionId)).toEqual(['actor:one'])

    const selfDecision = buildEncounterActionDecision({
      offer: offer('self', { targeting: [{ ...offer('base').targeting[0]!, kind: 'self' }] }),
      participants,
      sides,
    })
    expect(selfDecision.choices[0]?.defaultOptionIds).toEqual(['actor:one'])
    expect(encounterDecisionSelectionsValid(selfDecision, initialEncounterDecisionSelections(selfDecision))).toBe(true)

    const resourceDecision = buildEncounterActionDecision({
      offer: offer('resource', {
        targeting: [],
        selectionOptions: [{ kind: 'device', value: 'device:one', label: 'Snag Machine' }],
      }),
      participants,
      sides,
    })
    expect(resourceDecision.choices[0]).toMatchObject({ kind: 'item', options: [{ optionId: 'device:one' }] })

    const spatialDecision = buildEncounterActionDecision({
      offer: offer('spatial', {
        targeting: [{ ...offer('base').targeting[0]!, kind: 'path', requiresSpatialInput: true }],
        intent: { actionId: 'movement.shift', input: 'spatial' },
      }),
      participants,
      sides,
    })
    expect(spatialDecision.choices[0]).toMatchObject({ kind: 'path', ordering: 'spatial', options: [] })
    expect(encounterDecisionSelectionsValid(spatialDecision, initialEncounterDecisionSelections(spatialDecision))).toBe(false)
  })

  it('enforces server-issued cardinality and emits stable generic selections', () => {
    const decision = buildEncounterActionDecision({
      offer: offer('multi', { targeting: [{ ...offer('base').targeting[0]!, minSelections: 1, maxSelections: 2 }] }),
      participants,
      sides,
    })
    const choice = decision.choices[0]!
    let selections = initialEncounterDecisionSelections(decision)
    selections = toggleEncounterDecisionOption({ selections, choice, optionId: 'actor:one' })
    selections = toggleEncounterDecisionOption({ selections, choice, optionId: 'ally:one' })
    selections = toggleEncounterDecisionOption({ selections, choice, optionId: 'target:one' })
    expect(selections.target).toEqual(['actor:one', 'ally:one'])
    expect(encounterDecisionSelectionsValid(decision, selections)).toBe(true)
    expect(encounterDecisionChoiceSelections(decision, selections)).toEqual([
      { choiceId: 'target', optionIds: ['actor:one', 'ally:one'] },
    ])
  })

  it('preserves all canonical authorized choice kinds and confirmation metadata in one pending model', () => {
    const choices: EncounterChoiceOffer[] = ENCOUNTER_CHOICE_KINDS.map((kind, index) => ({
      schemaVersion: 1,
      choiceOfferId: `choice-offer:${kind}`,
      interactionId: 'pending:all-kinds',
      mapSlug: 'arena',
      mapRevision: 7,
      choiceId: `choice:${kind}`,
      kind,
      prompt: `Choose ${kind}`,
      helpText: null,
      cardinality: { minimum: 1, maximum: 1 },
      ordering: ['cell', 'area', 'direction', 'destination', 'path'].includes(kind) ? 'spatial' : 'server',
      options: [{
        optionId: `option:${index}`,
        label: `Option ${kind}`,
        description: null,
        disabled: false,
        unavailableReason: null,
        preview: kind === 'participant'
          ? { kind: 'participant', participant: offer('base').actor }
          : kind === 'side'
            ? { kind: 'side', sideId: 'heroes', label: 'Heroes', accent: '#456789' }
            : ['ability', 'capability', 'feature', 'edge', 'move'].includes(kind)
              ? { kind: 'reference', source: offer('base').source }
              : { kind: 'none' },
      }],
      defaultOptionIds: [],
      requiresConfirmation: index % 2 === 0,
      allowPass: false,
      allowCancel: true,
      expiresAt: null,
    }))
    const pending: EncounterPendingInteractionAuthorizedView = {
      schemaVersion: 1,
      projection: 'gm',
      interactionId: 'pending:all-kinds',
      mapSlug: 'arena',
      mapRevision: 7,
      status: 'pending',
      source: null,
      actor: null,
      prompt: 'Resolve all kinds',
      choices,
      responseIdentity: {
        interactionId: 'pending:all-kinds',
        resolutionId: 'resolution:all-kinds',
        windowId: 'choice:participant',
        retryKey: 'retry:all-kinds',
      },
      allowPass: true,
      allowCancel: true,
      expiresAt: null,
      recoveryActions: [],
      announcement: {
        announcementId: 'announcement:all-kinds',
        priority: 'assertive',
        message: 'Resolve all kinds',
        dedupeKey: 'pending:all-kinds',
      },
    }
    const decision = buildEncounterPendingDecision(pending)
    expect(decision.choices.map(value => value.kind)).toEqual(ENCOUNTER_CHOICE_KINDS)
    expect(decision.choices.filter(value => value.requiresConfirmation)).toHaveLength(Math.ceil(ENCOUNTER_CHOICE_KINDS.length / 2))
  })
})
