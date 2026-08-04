/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterParticipantCard from '~/components/encounter/EncounterParticipantCard.vue'
import EncounterBattleStage from '~/components/encounter/workspace/EncounterBattleStage.vue'
import EncounterSideRoster from '~/components/encounter/workspace/EncounterSideRoster.vue'
import EncounterTurnRail from '~/components/encounter/workspace/EncounterTurnRail.vue'
import type {
  EncounterWorkspaceParticipant,
  EncounterWorkspaceSide,
  EncounterWorkspaceTeam,
} from '#shared/encounterWorkspace/model'
import { workspaceParticipantSummary } from '#shared/encounterWorkspace/participantPresentation'

const participant = (id: string, patch: Partial<EncounterWorkspaceParticipant> = {}): EncounterWorkspaceParticipant => ({
  participantId: id,
  kind: 'pokemon',
  sheetSlug: id,
  displayName: id,
  roleLabel: 'Rattata',
  portraitUrl: null,
  side: { id: 'wild', label: 'Wild Pack', symbol: '▲', color: '#8f6c4b' },
  onMap: true,
  reserve: false,
  hidden: false,
  currentTurn: false,
  controlled: false,
  initiative: 10,
  position: { x: 1, y: 0, z: 1 },
  footprint: { base: 1, clearance: 1 },
  hp: { current: 12, maximum: 20, temporary: 2 },
  injuries: 1,
  conditions: ['Poisoned'],
  resources: [{ id: 'movement', label: 'Movement', current: 3, maximum: 5 }],
  fainted: false,
  ...patch,
})
const side: EncounterWorkspaceSide = {
  sideId: 'wild', label: 'Wild Pack', accent: '#8f6c4b', symbol: '▲', status: 'active',
  participantIds: ['wild:one', 'wild:two', 'wild:three', 'trainer:one'], hiddenParticipantCount: 2,
}
const trainer = participant('trainer:one', { kind: 'trainer', roleLabel: 'Trainer', controlled: true })
const team: EncounterWorkspaceTeam = {
  trainerParticipantId: 'trainer:one',
  sideId: 'wild',
  activeParticipantIds: ['wild:one'],
  reserves: [{
    reserveId: 'reserve:trainer:eevee', ownerParticipantId: 'trainer:one', sheetSlug: 'eevee',
    displayName: 'Eevee', portraitUrl: null, location: 'party',
  }],
}

afterEach(() => document.body.replaceChildren())

describe('encounter participant, roster, turn, and stage components', () => {
  it('shows complete owner anatomy but structurally omits private injuries/resources from public cards', () => {
    const summary = workspaceParticipantSummary(participant('wild:one', { controlled: true, currentTurn: true }))
    const owner = mount(EncounterParticipantCard, { props: { participant: summary, variant: 'owner' } })
    const publicCard = mount(EncounterParticipantCard, { props: { participant: summary, variant: 'public' } })
    expect(owner.text()).toMatch(/HP 12\/20\s+\+2/)
    expect(owner.text()).toContain('Injuries 1')
    expect(owner.text()).toContain('Movement 3/5')
    expect(owner.text()).toContain('Controlled')
    expect(owner.attributes('aria-label')).toContain('1 injuries')
    expect(publicCard.text()).not.toContain('Injuries')
    expect(publicCard.text()).not.toContain('Movement 3')
    expect(publicCard.attributes('aria-label')).not.toContain('injuries')
  })

  it('presents past/current/upcoming/fainted/waiting turn semantics and bounded GM advancement controls', async () => {
    const participants = [
      participant('past:one'),
      participant('current:one', { currentTurn: true }),
      participant('upcoming:one'),
      participant('fainted:one', { fainted: true }),
    ]
    const wrapper = mount(EncounterTurnRail, {
      props: {
        turn: {
          round: 4,
          currentParticipantId: 'current:one',
          entries: [
            { participantId: 'past:one', initiative: 18, state: 'past', waitingDecisionCount: 0 },
            { participantId: 'current:one', initiative: 15, state: 'current', waitingDecisionCount: 2 },
            { participantId: 'upcoming:one', initiative: 12, state: 'upcoming', waitingDecisionCount: 0 },
            { participantId: 'fainted:one', initiative: 8, state: 'fainted', waitingDecisionCount: 0 },
          ],
        },
        participants,
        canAdvance: true,
      },
    })
    expect(wrapper.text()).toContain('2 waiting')
    expect(wrapper.get('[data-state="current"] button').attributes('aria-current')).toBe('step')
    expect(wrapper.get('[data-state="fainted"] button').attributes('aria-label')).toContain('fainted')
    await wrapper.get('[aria-label="Previous initiative turn"]').trigger('click')
    await wrapper.get('[aria-label="Next initiative turn"]').trigger('click')
    expect(wrapper.emitted('previous')).toEqual([[]])
    expect(wrapper.emitted('next')).toEqual([[]])
  })

  it('groups wild members, expands to individual cards, and presents hidden/reserve team state', async () => {
    const participants = [participant('wild:one'), participant('wild:two'), participant('wild:three'), trainer]
    const wrapper = mount(EncounterSideRoster, {
      props: {
        side,
        participants,
        teams: [team],
        audience: 'gm',
        selectedParticipantId: null,
        inspectedParticipantId: null,
        acceptedStates: new Map(),
      },
    })
    expect(wrapper.text()).toContain('Rattata ×3')
    expect(wrapper.text()).toContain('2 hidden participants')
    expect(wrapper.text()).toContain('trainer:one’s team')
    expect(wrapper.text()).toContain('1 reserve')
    expect(wrapper.findAllComponents(EncounterParticipantCard)).toHaveLength(1)
    await wrapper.get('.encounter-wild-group > button').trigger('click')
    expect(wrapper.findAllComponents(EncounterParticipantCard)).toHaveLength(4)
    expect(wrapper.text()).toContain('wild:one')
  })

  it('keeps current actor, accepted/corrected state, environment, objectives, and inspector hierarchy on the Battle Stage', () => {
    const current = participant('current:one', { currentTurn: true, controlled: true })
    const target = participant('target:one')
    const wrapper = mount(EncounterBattleStage, {
      props: {
        participants: [current, target],
        currentParticipantId: current.participantId,
        selectedParticipantId: target.participantId,
        inspectedParticipantId: target.participantId,
        audience: 'gm',
        environment: [{ environmentId: 'weather:rain', kind: 'weather', label: 'Rainy', rounds: 3, scopeLabel: 'Battlefield' }],
        objectives: [{ objectiveId: 'objective:escape', label: 'Escape', status: 'active', progress: 1, maximum: 3 }],
        clocks: [{ clockId: 'clock:escape', label: 'Gate closes', status: 'active', progress: 1, maximum: 4 }],
        phase: { phaseId: 'phase:one', label: 'Pursuit', status: 'active', summary: 'Reach the gate.' },
        stakes: 'The route closes at dawn.',
        limitations: ['phases', 'stakes', 'notes', 'waves'],
        acceptedStates: new Map([['target:one', { state: 'corrected', presentationId: 'accepted:correction', labels: ['HP corrected'] }]]),
      },
    })
    expect(wrapper.get('h1').text()).toBe('current:one')
    expect(wrapper.text()).toContain('Inspected participant')
    expect(wrapper.text()).toContain('Rainy')
    expect(wrapper.text()).toContain('Escape')
    expect(wrapper.text()).toContain('Gate closes')
    expect(wrapper.text()).toContain('Pursuit')
    expect(wrapper.text()).toContain('The route closes at dawn.')
    expect(wrapper.get('button[data-state="corrected"]').text()).toContain('target:one')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('HP corrected')
  })
})
