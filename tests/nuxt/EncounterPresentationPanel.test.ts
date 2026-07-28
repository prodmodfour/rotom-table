import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import EncounterPresentationPanel from '../../src/components/map/EncounterPresentationPanel.vue'
import {
  parseEncounterPresentationProjection,
  type EncounterActionOffer,
} from '../../shared/encounterPresentation'

const offer: EncounterActionOffer = {
  schemaVersion: 1,
  offerId: 'offer:test:move',
  mapSlug: 'arena',
  mapRevision: 3,
  actor: {
    participantId: 'actor:one',
    displayName: 'Pikachu',
    portraitUrl: null,
    sideId: null,
    sideLabel: null,
    sideAccent: null,
    sheetKind: 'pokemon',
    statusLabels: [],
  },
  source: {
    sourceKind: 'move',
    canonicalId: 'Thunder Shock',
    instanceId: null,
    displayName: 'Thunder Shock',
    referenceHref: null,
  },
  roles: ['activated-action'],
  group: 'attack',
  groupOrder: 1,
  offerOrder: 1,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [],
  targeting: [],
  usage: {
    frequencyLabel: 'At-Will',
    remaining: null,
    maximum: null,
    cooldownLabel: null,
    resetLabel: null,
  },
  availability: { status: 'available', reasons: [] },
  presentation: { label: 'Thunder Shock', description: null, iconKey: 'source.move', tone: 'neutral' },
  intent: { actionId: 'move.declare', input: 'choices' },
}

const projection = parseEncounterPresentationProjection({
  schemaVersion: 1,
  projectionId: 'projection:arena:3:owner',
  audience: 'actor-owner',
  mapSlug: 'arena',
  mapRevision: 3,
  generatedAt: 10,
  offers: [offer],
  passives: [],
  affordances: [],
  pending: [],
  accepted: [],
  diagnostics: [],
})

describe('EncounterPresentationPanel in Nuxt', () => {
  it('renders and activates a server-issued generic offer', async () => {
    const wrapper = await mountSuspended(EncounterPresentationPanel, {
      props: { projection, accepted: [], selectedParticipantId: 'actor:one' },
    })
    await wrapper.get('.encounter-presentation__toggle').trigger('click')
    const action = wrapper.get('[data-action-id="move.declare"]')
    expect(action.text()).toContain('Thunder Shock')
    expect(action.text()).toContain('At-Will')
    await action.trigger('click')
    expect(wrapper.emitted('activate')?.[0]?.[0]).toMatchObject({ offerId: offer.offerId })
  })

  it('focuses a new authorized pending choice and emits exact server option identity', async () => {
    const pendingProjection = parseEncounterPresentationProjection({
      ...projection,
      projectionId: 'projection:arena:3:responder',
      audience: 'responder-owner',
      pending: [{
        schemaVersion: 1,
        projection: 'responder-owner',
        interactionId: 'pending:one',
        mapSlug: 'arena',
        mapRevision: 3,
        status: 'pending',
        source: null,
        actor: null,
        prompt: 'Choose a response.',
        choices: [{
          schemaVersion: 1,
          choiceOfferId: 'choice-offer:one',
          interactionId: 'pending:one',
          mapSlug: 'arena',
          mapRevision: 3,
          choiceId: 'choice:one',
          kind: 'branch',
          prompt: 'Use the response?',
          helpText: null,
          cardinality: { minimum: 1, maximum: 1 },
          ordering: 'server',
          options: [{
            optionId: 'option:yes', label: 'Use response', description: null,
            disabled: false, unavailableReason: null, preview: { kind: 'none' },
          }],
          defaultOptionIds: [],
          requiresConfirmation: false,
          allowPass: true,
          allowCancel: false,
          expiresAt: null,
        }],
        responseIdentity: {
          interactionId: 'pending:one', resolutionId: 'resolution:one',
          windowId: 'choice:one', retryKey: 'retry:one',
        },
        allowPass: true,
        allowCancel: false,
        expiresAt: null,
        recoveryActions: [],
        announcement: {
          announcementId: 'announcement:pending', priority: 'assertive',
          message: 'Choose a response.', dedupeKey: 'pending:one',
        },
      }],
    })
    const wrapper = await mountSuspended(EncounterPresentationPanel, {
      props: { projection, accepted: [] },
      attachTo: document.body,
    })
    await wrapper.setProps({ projection: pendingProjection })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(wrapper.get('h2[tabindex="-1"]').element).toBe(document.activeElement)
    const responseButton = wrapper.findAll('button').find(button => button.text() === 'Use response')
    if (!responseButton) throw new Error('Expected pending response option button.')
    await responseButton.trigger('click')
    expect(wrapper.emitted('respond')?.[0]?.[0]).toMatchObject({
      decision: 'choose', choiceId: 'choice:one', optionIds: ['option:yes'],
      interaction: { interactionId: 'pending:one' },
    })
    wrapper.unmount()
  })

  it('shows contract diagnostics only to the diagnostic audience', async () => {
    const diagnosticProjection = parseEncounterPresentationProjection({
      ...projection,
      audience: 'diagnostic',
      projectionId: 'projection:diagnostic',
      diagnostics: [{
        diagnosticId: 'diagnostic:one',
        label: 'Projection trace',
        detail: 'Private diagnostic evidence',
        source: null,
      }],
    })
    const wrapper = await mountSuspended(EncounterPresentationPanel, {
      props: { projection: diagnosticProjection, accepted: [] },
    })
    expect(wrapper.get('[data-testid="encounter-presentation-diagnostics"]').text())
      .toContain('Private diagnostic evidence')
    await wrapper.setProps({ projection })
    expect(wrapper.find('[data-testid="encounter-presentation-diagnostics"]').exists()).toBe(false)
  })

  it('announces unavailable reasons and prevents activation', async () => {
    const blocked = parseEncounterPresentationProjection({
      ...projection,
      projectionId: 'projection:arena:3:blocked',
      offers: [{
        ...offer,
        offerId: 'offer:test:blocked',
        availability: {
          status: 'unavailable',
          reasons: [{
            code: 'usage.frequency-exhausted',
            label: 'No uses remain',
            sources: [],
            diagnosticDetail: null,
          }],
        },
      }],
    })
    const wrapper = await mountSuspended(EncounterPresentationPanel, {
      props: { projection: blocked, accepted: [] },
    })
    await wrapper.get('.encounter-presentation__toggle').trigger('click')
    const action = wrapper.get('[data-action-id="move.declare"]')
    expect(action.attributes('disabled')).toBeDefined()
    expect(action.attributes('title')).toContain('No uses remain')
    await action.trigger('click')
    expect(wrapper.emitted('activate')).toBeUndefined()
  })
})
