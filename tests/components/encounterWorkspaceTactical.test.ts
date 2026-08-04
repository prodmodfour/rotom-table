/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterCompactSpatialPreview from '~/components/encounter/workspace/EncounterCompactSpatialPreview.vue'
import EncounterRelationshipView from '~/components/encounter/workspace/EncounterRelationshipView.vue'
import EncounterTacticalLens from '~/components/encounter/workspace/EncounterTacticalLens.vue'
import type { EncounterActionOffer, EncounterChoiceOffer } from '#shared/encounterPresentation'
import type { EncounterWorkspaceParticipant } from '#shared/encounterWorkspace/model'

const participant = (id: string, x: number, sideId = 'heroes'): EncounterWorkspaceParticipant => ({
  participantId: id,
  kind: 'pokemon',
  sheetSlug: id,
  displayName: id,
  roleLabel: 'Pokémon',
  portraitUrl: null,
  side: { id: sideId, label: sideId, color: sideId === 'heroes' ? '#456789' : '#984f54', symbol: sideId === 'heroes' ? '◆' : '▲' },
  onMap: true,
  reserve: false,
  hidden: false,
  currentTurn: id === 'actor',
  controlled: id === 'actor',
  initiative: 10,
  position: { x, y: 0, z: 0 },
  footprint: { base: 1, clearance: 1 },
  hp: { current: 10, maximum: 10, temporary: 0 },
  injuries: 0,
  conditions: [],
  resources: [],
  fainted: false,
})
const actor = participant('actor', 0)
const target = participant('target', 3, 'foes')
const offer: EncounterActionOffer = {
  schemaVersion: 1,
  offerId: 'offer:range',
  mapSlug: 'arena',
  mapRevision: 7,
  actor: {
    participantId: actor.participantId, displayName: actor.displayName, portraitUrl: null,
    sideId: 'heroes', sideLabel: 'heroes', sideAccent: '#456789', sheetKind: 'pokemon', statusLabels: [],
  },
  source: { sourceKind: 'move', canonicalId: 'Range', instanceId: null, displayName: 'Range', referenceHref: null },
  roles: ['activated-action'],
  group: 'attack', groupOrder: 1, offerOrder: 1,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [],
  targeting: [{
    requirementId: 'target', kind: 'participant', minSelections: 1, maxSelections: 1,
    rangeLabel: 'Range 6', relationshipLabel: 'Foe', requiresLineOfSight: true, requiresSpatialInput: false,
  }],
  usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: 'Range', description: null, iconKey: null, tone: 'neutral' },
  intent: { actionId: 'move.declare', input: 'choices' },
}
const spatialChoice: EncounterChoiceOffer = {
  schemaVersion: 1,
  choiceOfferId: 'choice-offer:path',
  interactionId: 'interaction:path',
  mapSlug: 'arena',
  mapRevision: 7,
  choiceId: 'path',
  kind: 'path',
  prompt: 'Choose path',
  helpText: null,
  cardinality: { minimum: 1, maximum: 1 },
  ordering: 'spatial',
  options: [{
    optionId: 'path:north',
    label: 'North path',
    description: null,
    disabled: false,
    unavailableReason: null,
    preview: {
      kind: 'spatial',
      cells: [],
      destination: { x: 2, y: 0, z: 0 },
      path: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      direction: 'north',
    },
  }],
  defaultOptionIds: [],
  requiresConfirmation: true,
  allowPass: false,
  allowCancel: true,
  expiresAt: null,
}

afterEach(() => document.body.replaceChildren())

describe('encounter relationship and tactical presentation', () => {
  it('shows projected distance while labeling eligibility and line of sight as server-owned', async () => {
    const wrapper = mount(EncounterRelationshipView, {
      props: {
        offer,
        actor,
        participants: [actor, target],
        environment: [{ environmentId: 'weather:rain', kind: 'weather', label: 'Rainy', rounds: 2, scopeLabel: 'Battlefield' }],
        selectedParticipantIds: [],
      },
    })
    expect(wrapper.text()).toContain('3 m')
    expect(wrapper.text()).toContain('Server validates')
    expect(wrapper.text()).toContain('Rainy')
    await wrapper.get('[aria-label^="target, foe"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['target']])
    await wrapper.get('[aria-label="Inspect target"]').trigger('click')
    expect(wrapper.emitted('inspect')).toEqual([['target']])
  })

  it('renders explicit path/destination geometry and emits only the opaque option identity', async () => {
    const wrapper = mount(EncounterCompactSpatialPreview, {
      props: { choice: spatialChoice, selectedOptionIds: [] },
    })
    expect(wrapper.find('polyline').exists()).toBe(true)
    expect(wrapper.find('rect.encounter-compact-spatial-preview__destination').exists()).toBe(true)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['path:north']])
  })

  it('loads the compatibility renderer lazily and exposes compact, split, picture-in-picture, full-screen, and return controls', async () => {
    const wrapper = mount(EncounterTacticalLens, {
      props: {
        mapSlug: 'arena',
        mapRevision: 7,
        open: false,
        mode: 'embedded',
        selectedParticipantId: 'actor',
        selectedTargetIds: ['target'],
        actionOfferId: 'offer:range',
      },
    })
    expect(wrapper.find('iframe').exists()).toBe(false)
    await wrapper.setProps({ open: true })
    const frame = wrapper.get('iframe')
    expect(frame.attributes('src')).toContain('/maps/arena?')
    expect(frame.attributes('src')).toContain('encounterLens=1')
    expect(frame.attributes('src')).toContain('expectedRevision=7')
    await wrapper.get('[aria-label="Tactical lens layout"] button:nth-child(2)').trigger('click')
    expect(wrapper.emitted('updateMode')).toEqual([['split']])
    await wrapper.get('.encounter-tactical-lens__close').trigger('click')
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})
