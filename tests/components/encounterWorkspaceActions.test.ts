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
    await wrapper.get('button[aria-pressed="false"]').trigger('click')
    expect(wrapper.findAllComponents({ name: 'EncounterOfferCard' })).toHaveLength(1)
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
