/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterActionDock from '~/components/encounter/workspace/EncounterActionDock.vue'
import EncounterDecisionLayer from '~/components/encounter/workspace/EncounterDecisionLayer.vue'
import EncounterEventFeed from '~/components/encounter/workspace/EncounterEventFeed.vue'
import EncounterResolutionStack from '~/components/encounter/workspace/EncounterResolutionStack.vue'
import type {
  AcceptedEncounterPresentation,
  EncounterActionOffer,
  EncounterChoiceOffer,
  EncounterPendingInteractionAuthorizedView,
  EncounterPendingInteractionPublicView,
  EncounterPendingInteractionView,
} from '#shared/encounterPresentation'
import type { EncounterDecisionModel } from '#shared/encounterWorkspace/decision'

const offer = (id: string, available = true): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: id,
  mapSlug: 'arena',
  mapRevision: 7,
  actor: {
    participantId: 'actor:one', displayName: 'Pikachu', portraitUrl: null,
    sideId: 'heroes', sideLabel: 'Heroes', sideAccent: '#345678', sheetKind: 'pokemon', statusLabels: [],
  },
  source: { sourceKind: 'move', canonicalId: id, instanceId: null, displayName: id, referenceHref: null },
  roles: ['activated-action'],
  group: id === 'support' ? 'support' : 'attack',
  groupOrder: id === 'support' ? 20 : 10,
  offerOrder: 0,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }],
  targeting: [{
    requirementId: 'target', kind: 'participant', minSelections: 1, maxSelections: 1,
    rangeLabel: 'Range 6', relationshipLabel: 'Any creature', requiresLineOfSight: true, requiresSpatialInput: false,
  }],
  usage: { frequencyLabel: 'At-Will', remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: available
    ? { status: 'available', reasons: [] }
    : {
        status: 'unavailable',
        reasons: [{
          code: 'timing.not-actors-turn', label: 'Not this actor’s turn',
          sources: [{ sourceKind: 'feature', canonicalId: 'Lock', instanceId: null, displayName: 'Turn Lock', referenceHref: null }],
          diagnosticDetail: null,
        }],
      },
  presentation: { label: id === 'support' ? 'Helping Hand' : 'Thunder Shock', description: 'Projected outcome summary.', iconKey: null, tone: 'neutral' },
  intent: { actionId: 'move.declare', input: 'choices' },
})

const participantChoice = (): EncounterChoiceOffer => ({
  schemaVersion: 1,
  choiceOfferId: 'choice-offer:target',
  interactionId: 'decision:one',
  mapSlug: 'arena',
  mapRevision: 7,
  choiceId: 'target',
  kind: 'participant',
  prompt: 'Choose a participant',
  helpText: 'Server-authorized visible candidates',
  cardinality: { minimum: 1, maximum: 1 },
  ordering: 'initiative',
  options: [{
    optionId: 'target:one',
    label: 'Bulbasaur',
    description: 'Foes · 12/20 HP',
    disabled: false,
    unavailableReason: null,
    preview: {
      kind: 'participant',
      participant: {
        participantId: 'target:one', displayName: 'Bulbasaur', portraitUrl: null,
        sideId: 'foes', sideLabel: 'Foes', sideAccent: '#984f54', sheetKind: 'pokemon', statusLabels: ['Poisoned'],
      },
    },
  }],
  defaultOptionIds: [],
  requiresConfirmation: true,
  allowPass: false,
  allowCancel: true,
  expiresAt: null,
})

function pending(projection: 'public', interactionId?: string): EncounterPendingInteractionPublicView
function pending(projection: 'gm', interactionId?: string): EncounterPendingInteractionAuthorizedView
function pending(
  projection: 'public' | 'gm',
  interactionId = 'pending:one',
): EncounterPendingInteractionView {
  return projection === 'public'
    ? {
      schemaVersion: 1, projection: 'public', interactionId, mapSlug: 'arena', mapRevision: 7,
      status: 'pending', source: null, actor: null, prompt: 'A response is required', outstandingChoiceCount: 1,
      allowPass: false, allowCancel: false, expiresAt: null,
      announcement: { announcementId: 'announcement:public', priority: 'polite', message: 'Waiting', dedupeKey: 'waiting' },
    }
  : {
      schemaVersion: 1, projection: 'gm', interactionId, mapSlug: 'arena', mapRevision: 7,
      status: 'pending', source: null, actor: null, prompt: 'Choose a reaction', choices: [participantChoice()],
      responseIdentity: { interactionId, resolutionId: 'resolution:one', windowId: 'target', retryKey: 'retry:one' },
      allowPass: true, allowCancel: true, expiresAt: null,
      recoveryActions: [{ action: 'force-pass', actionId: 'recovery:force', label: 'Force pass', enabled: true, unavailableReason: null }],
      announcement: { announcementId: 'announcement:gm', priority: 'assertive', message: 'Choose', dedupeKey: 'choose' },
    }
}

const accepted = (): AcceptedEncounterPresentation => ({
  schemaVersion: 1,
  presentationId: 'accepted:corrected',
  operationId: 'operation:corrected',
  mapSlug: 'arena',
  previousRevision: 7,
  revision: 8,
  source: { sourceKind: 'move', canonicalId: 'Thunder Shock', instanceId: null, displayName: 'Thunder Shock', referenceHref: null },
  actor: offer('one').actor,
  affectedParticipants: [offer('one').actor],
  outcomes: [{ outcomeId: 'outcome:hit', kind: 'hit', label: 'The attack hit.', participant: offer('one').actor, value: null }],
  changes: [{
    changeId: 'change:hp', participant: offer('one').actor, kind: 'hp', operation: 'decrease',
    label: 'HP changed', previous: 20, next: 12, delta: -8, unit: 'HP', private: false,
  }],
  explanations: [{
    schemaVersion: 1,
    explanationId: 'explanation:damage',
    subjectId: 'target:one',
    label: 'Damage calculation',
    result: { kind: 'number', numberValue: 8, textValue: null, booleanValue: null, unit: 'HP' },
    contributions: [{
      contributionId: 'contribution:base',
      order: 0,
      kind: 'base',
      source: null,
      label: 'Rolled damage',
      value: { kind: 'number', numberValue: 8, textValue: null, booleanValue: null, unit: 'HP' },
      applied: true,
      private: false,
      preventionReason: null,
    }],
  }],
  causal: { groupId: 'group:one', parentPresentationId: null, depth: 0, sequence: 0 },
  headline: { label: 'Thunder Shock hit', description: null, iconKey: null, tone: 'success' },
  splash: null,
  vfx: [],
  announcements: [],
  history: [],
  correction: { correctsPresentationId: 'accepted:old', reasonLabel: 'GM correction' },
})

afterEach(() => document.body.replaceChildren())

describe('encounter action and resolution components', () => {
  it('supports search, groups, unavailable explanations, recents, and numeric keyboard activation', async () => {
    const wrapper = mount(EncounterActionDock, {
      attachTo: document.body,
      props: {
        offers: [offer('attack'), offer('support'), offer('blocked', false)],
        actorParticipantId: 'actor:one',
        actorLabel: 'Pikachu',
        selectedOfferId: null,
        commandsBlocked: false,
      },
    })
    expect(wrapper.text()).toContain('Thunder Shock')
    expect(wrapper.text()).toContain('Helping Hand')
    expect(wrapper.text()).toContain('Why unavailable?')
    await wrapper.get('input[type="search"]').setValue('helping')
    expect(wrapper.findAllComponents({ name: 'EncounterOfferCard' })).toHaveLength(1)
    await wrapper.get('input[type="search"]').setValue('')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))
    expect(wrapper.emitted('activate')?.[0]?.[0]).toMatchObject({ offerId: 'attack' })
    await wrapper.get('.encounter-action-dock__recent').trigger('click')
    expect(wrapper.findAllComponents({ name: 'EncounterOfferCard' })).toHaveLength(1)
  })

  it('renders Inventory as a labelled compact touch group with projected quantity', async () => {
    const potion: EncounterActionOffer = {
      ...offer('potion'),
      source: {
        sourceKind: 'item', canonicalId: 'Potion', instanceId: 'item:private',
        displayName: 'Potion', referenceHref: '/items/potion',
      },
      group: 'inventory',
      usage: { frequencyLabel: null, remaining: 2, maximum: 2, cooldownLabel: null, resetLabel: null },
      sourceContextLabel: 'Rowan · Medical Kit',
      presentation: { label: 'Use Potion', description: 'Restore HP.', iconKey: 'source.item', tone: 'positive' },
    }
    const wrapper = mount(EncounterActionDock, {
      props: {
        offers: [offer('attack'), potion], actorParticipantId: 'actor:one', actorLabel: 'Pikachu',
        selectedOfferId: null, commandsBlocked: false,
      },
    })
    const inventoryTab = wrapper.get('button[data-action-group="inventory"]')
    expect(inventoryTab.text()).toBe('Inventory')
    await inventoryTab.trigger('click')
    const card = wrapper.getComponent({ name: 'EncounterOfferCard' })
    expect(card.classes()).toContain('encounter-offer-card--compact')
    expect(card.attributes('tabindex')).toBe('-1')
    expect(card.text()).toContain('2 available')
    expect(card.text()).toContain('Rowan · Medical Kit')
  })

  it('renders typed choice previews, enforces confirmation, and emits generic selections', async () => {
    const decision: EncounterDecisionModel = {
      kind: 'pending',
      interactionId: 'decision:one',
      title: 'Reaction',
      prompt: 'Choose safely',
      interaction: pending('gm'),
      choices: [participantChoice()],
      allowPass: true,
      allowCancel: true,
    }
    const wrapper = mount(EncounterDecisionLayer, { props: { decision } })
    expect(wrapper.get('[role="dialog"]').attributes('aria-labelledby')).toContain('decision-title')
    expect(wrapper.text()).toContain('Bulbasaur')
    expect(wrapper.get('.encounter-decision-layer__confirm').attributes()).toHaveProperty('disabled')
    await wrapper.get('.encounter-decision-layer__options button').trigger('click')
    expect(wrapper.get('.encounter-decision-layer__options button').attributes('aria-pressed')).toBe('true')
    await wrapper.get('.encounter-decision-layer__confirm').trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[[{ choiceId: 'target', optionIds: ['target:one'] }]]])
  })

  it('renders server-authored healing and overheal previews without client calculation', () => {
    const healingChoice = participantChoice()
    healingChoice.options = [{
      ...healingChoice.options[0]!,
      description: '7/27 HP · 20 HP requested · 20 HP restored · 0 overheal',
    }]
    const decision: EncounterDecisionModel = {
      kind: 'pending', interactionId: 'decision:healing-preview', title: 'Use Potion', prompt: 'Choose 1 target',
      interaction: pending('gm'), choices: [healingChoice], allowPass: false, allowCancel: true,
    }
    const wrapper = mount(EncounterDecisionLayer, { props: { decision } })
    expect(wrapper.text()).toContain('20 HP restored')
    expect(wrapper.text()).toContain('0 overheal')
  })

  it('labels an authoritative item confirmation as use rather than a declaration-only handoff', () => {
    const itemOffer: EncounterActionOffer = {
      ...offer('item-potion'),
      source: {
        sourceKind: 'item', canonicalId: 'Potion',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
        displayName: 'Potion', referenceHref: '/items/potion',
      },
      group: 'inventory',
      presentation: { label: 'Use Potion', description: 'Restore HP.', iconKey: 'source.item', tone: 'positive' },
      intent: { actionId: 'item.use:item-instance:trainer:ash:medicalKit:potion-row', input: 'choices' },
    }
    const decision: EncounterDecisionModel = {
      kind: 'action', interactionId: 'decision:item', title: 'Use Potion', prompt: 'Review exact target.',
      offer: itemOffer, choices: [participantChoice()], allowPass: false, allowCancel: true,
    }
    const wrapper = mount(EncounterDecisionLayer, { props: { decision } })
    expect(wrapper.get('.encounter-decision-layer__confirm').text()).toBe('Use item')
    expect(wrapper.text()).toContain('1 Standard Action')
  })

  it('renders the accepted Mega Evolution preview boundary and explicit Scene consequences', () => {
    const megaOffer: EncounterActionOffer = {
      ...offer('mega-evolve'),
      source: {
        sourceKind: 'item', canonicalId: 'Mega Ring', instanceId: 'form-source:public',
        displayName: 'Mega Ring', referenceHref: '/items/Mega%20Ring',
      },
      group: 'inventory',
      timing: { kind: 'swift', label: 'Swift Action', triggerLabel: null, priority: null },
      costs: [{ kind: 'swift-action', resourceId: 'swift', amount: 1, label: '1 Swift Action' }],
      usage: {
        frequencyLabel: '1 Mega Evolution this Scene', remaining: 1, maximum: 1,
        cooldownLabel: null, resetLabel: 'Next Scene',
      },
      presentation: {
        label: 'Mega Evolve', description: 'Emberwing becomes Mega Charizard X for this Scene.',
        iconKey: 'source.item', tone: 'positive',
      },
      intent: { actionId: 'item.form-change.mega-evolve', input: 'choices' },
      sourceContextLabel: 'Alex · Mega Ring + Mega Stone',
      formChangePreview: {
        kind: 'item-form-change',
        fromFormLabel: 'Charizard', toFormLabel: 'Mega Charizard X',
        fromTypes: ['Fire', 'Flying'], toTypes: ['Fire', 'Dragon'],
        abilityLabel: 'Tough Claws', abilityRequiresChoice: false,
        statDeltas: [
          { statId: 'atk', label: 'Attack', delta: 5 },
          { statId: 'def', label: 'Defense', delta: 3 },
          { statId: 'satk', label: 'Special Attack', delta: 2 },
          { statId: 'sdef', label: 'Special Defense', delta: 0 },
          { statId: 'spd', label: 'Speed', delta: 0 },
        ],
        durationLabel: 'Scene',
        reversalLabel: 'Reverts automatically when the Scene ends.',
        acceptanceBoundaryLabel: 'No change until accepted.',
      },
    }
    const target = participantChoice()
    target.options = [{
      ...target.options[0]!, optionId: 'mega-charizard-token', label: 'Emberwing',
      description: 'Charizard → Mega Charizard X · Fire / Dragon · Scene',
    }]
    target.defaultOptionIds = ['mega-charizard-token']
    const decision: EncounterDecisionModel = {
      kind: 'action', interactionId: 'decision:mega-evolve', title: 'Mega Evolve',
      prompt: 'Review this Scene transformation before accepting.', offer: megaOffer,
      choices: [target], allowPass: false, allowCancel: true,
    }
    const wrapper = mount(EncounterDecisionLayer, { props: { decision } })
    expect(wrapper.get('.encounter-decision-layer__confirm').text()).toBe('Mega Evolve')
    expect(wrapper.text()).toContain('Charizard → Mega Charizard X')
    expect(wrapper.text()).toContain('Fire / Flying')
    expect(wrapper.text()).toContain('Fire / Dragon')
    expect(wrapper.text()).toContain('AbilityTough Claws')
    expect(wrapper.text()).toContain('Attack+5')
    expect(wrapper.text()).toContain('Special Defense—')
    expect(wrapper.text()).toContain('Swift Action')
    expect(wrapper.text()).toContain('one Mega Evolution this Scene')
    expect(wrapper.text()).toContain('Reverts automatically when the Scene ends.')
    expect(wrapper.text()).toContain('No change until accepted.')
    expect(wrapper.text()).not.toContain('recordSha256')
    expect(wrapper.text()).not.toContain('equipped-item:')
  })

  it('shows safe item source, quantity, target costs, selection, and unavailable target reasons', async () => {
    const itemOffer: EncounterActionOffer = {
      ...offer('item-target-details'),
      source: {
        sourceKind: 'item', canonicalId: 'Potion',
        instanceId: 'item-instance:trainer:private:medicalKit:private-row',
        displayName: 'Potion', referenceHref: '/items/potion',
      },
      group: 'inventory',
      sourceContextLabel: 'Rowan · Medical Kit',
      usage: { frequencyLabel: null, remaining: 2, maximum: 2, cooldownLabel: null, resetLabel: null },
      selectionOptions: [{
        kind: 'participant', value: 'target:one', label: 'Bulbasaur',
        description: '7/27 HP · 20 HP requested · 20 HP restored · 0 expected overheal',
        costs: [
          { kind: 'standard-action', resourceId: 'standard', amount: 1, label: '1 Standard Action' },
          { kind: 'item', resourceId: null, amount: 1, label: 'Consume 1 Potion' },
          { kind: 'resource', resourceId: 'item.restorative.target-next-turn-forfeit', amount: 1, label: 'Target forfeits next Standard + Shift' },
        ],
        disabled: false, unavailableReason: null,
      }, {
        kind: 'participant', value: 'actor:one', label: 'Pikachu', description: '20/20 HP · At full HP.',
        costs: [{ kind: 'full-action', resourceId: 'full', amount: 1, label: '1 Full Action' }],
        disabled: true,
        unavailableReason: { code: 'target.invalid', label: 'That target is not eligible', sources: [], diagnosticDetail: null },
      }],
      presentation: { label: 'Use Potion', description: 'Restore HP.', iconKey: 'source.item', tone: 'positive' },
      intent: { actionId: 'item.use:private-source', input: 'choices' },
    }
    const choice = participantChoice()
    choice.options = [{
      ...choice.options[0]!,
      description: itemOffer.selectionOptions?.[0]?.description ?? null,
    }, {
      optionId: 'actor:one', label: 'Pikachu', description: '20/20 HP · At full HP.', disabled: true,
      unavailableReason: itemOffer.selectionOptions?.[1]?.unavailableReason ?? null,
      preview: { kind: 'participant', participant: itemOffer.actor },
    }]
    const decision: EncounterDecisionModel = {
      kind: 'action', interactionId: 'decision:item-target-details', title: 'Use Potion', prompt: 'Choose 1 target',
      offer: itemOffer, choices: [choice], allowPass: false, allowCancel: true,
    }
    const wrapper = mount(EncounterDecisionLayer, { props: { decision } })
    expect(wrapper.text()).toContain('Rowan · Medical Kit · 2 available')
    expect(wrapper.text()).toContain('At full HP.')
    expect(wrapper.text()).toContain('Unavailable')
    expect(wrapper.text()).not.toContain('private-row')
    await wrapper.get('.encounter-decision-layer__options button:not(:disabled)').trigger('click')
    expect(wrapper.text()).toContain('✓ Selected')
    expect(wrapper.text()).toContain('Target forfeits next Standard + Shift')
    expect(wrapper.get('.encounter-decision-layer__confirm').attributes('disabled')).toBeUndefined()
  })

  it('keeps public waiting summaries structurally separate from private options and exposes bounded recovery', async () => {
    const wrapper = mount(EncounterResolutionStack, {
      props: {
        pending: [pending('public'), pending('gm', 'pending:gm')],
        primaryInteractionId: 'pending:gm',
        activeInteractionId: null,
      },
    })
    expect(wrapper.text()).toContain('Private options are not present')
    expect(wrapper.text()).toContain('Force pass')
    await wrapper.get('[data-primary="true"] .encounter-resolution-stack__open').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['pending:gm']])
    await wrapper.get('[data-primary="true"] .encounter-resolution-stack__actions button:last-child').trigger('click')
    expect(wrapper.emitted('recover')).toEqual([['pending:gm', 'force-pass']])
  })

  it('presents corrections, structured facts, and distinct retry/abandon affordances for uncertainty', async () => {
    const wrapper = mount(EncounterEventFeed, {
      props: {
        accepted: [accepted()],
        activePresentationId: 'accepted:corrected',
        uncertain: [{ operationId: 'op_uncertain', label: 'Reaction', message: 'Outcome unknown', canRetry: true, canAbandon: true }],
      },
    })
    expect(wrapper.text()).toContain('Corrects accepted:old')
    expect(wrapper.text()).toContain('Outcome unknown')
    expect(wrapper.text()).toContain('Damage calculation')
    expect(wrapper.get('[data-corrected="true"]').attributes('data-active')).toBe('true')
    await wrapper.get('.encounter-event-feed__uncertain button').trigger('click')
    await wrapper.get('.encounter-event-feed__uncertain button:last-child').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['op_uncertain']])
    expect(wrapper.emitted('abandon')).toEqual([['op_uncertain']])
  })
})
