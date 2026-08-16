/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterDirectorPanel from '~/components/encounter/workspace/EncounterDirectorPanel.vue'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'

const workspace = (): EncounterWorkspaceViewModel => ({
  schemaVersion: 1,
  source: {
    workspaceId: 'workspace:arena:7:gm', encounterId: 'arena', encounterRevision: null, mapSlug: 'arena', mapRevision: 7,
    presentationProjectionId: 'projection:arena:7', presentationAudience: 'gm', generatedAt: 100,
  },
  viewer: {
    audience: 'gm', controlledParticipantIds: ['actor'], canUseDirector: true,
    canInspectDiagnostics: false, canUseExactGeometry: true,
  },
  scene: { active: true, name: 'Canal ambush', startedAt: 10 },
  turn: { round: 2, currentParticipantId: 'actor', entries: [{ participantId: 'actor', initiative: 12, state: 'current', waitingDecisionCount: 0 }] },
  sides: [{
    sideId: 'heroes', label: 'Canal Watch', accent: '#456789', symbol: '◆', status: 'active',
    participantIds: ['actor'], hiddenParticipantCount: 2,
  }],
  participants: [{
    participantId: 'actor', kind: 'pokemon', sheetSlug: 'actor', displayName: 'Luxray', roleLabel: 'Pokémon',
    portraitUrl: null, side: { id: 'heroes', label: 'Canal Watch', color: '#456789', symbol: '◆' },
    onMap: true, reserve: false, hidden: false, currentTurn: true, controlled: true, initiative: 12,
    position: { x: 1, y: 0, z: 1 }, footprint: { base: 1, clearance: 1 },
    hp: { current: 30, maximum: 40, temporary: 0 }, injuries: 0, conditions: [], resources: [], fainted: false,
  }],
  teams: [], environment: [], objectives: [], clocks: [], phase: null, stakes: null, director: null,
  offers: [], passives: [], affordances: [], pending: [], accepted: [], diagnostics: [],
  system: { connection: 'ready', replayGap: false, commandsBlocked: false, blockingMessage: null, lastAdoptedRevision: 7 },
  mapBackedLimitations: ['objectives', 'phases', 'stakes', 'notes', 'waves'],
})

afterEach(() => document.body.replaceChildren())

describe('EncounterDirectorPanel', () => {
  it('stays absent until explicit Director mode opens and exposes bounded GM sections', async () => {
    const wrapper = mount(EncounterDirectorPanel, {
      attachTo: document.body,
      props: { workspace: workspace(), open: false },
    })
    expect(wrapper.find('aside').exists()).toBe(false)
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('aside').attributes('aria-labelledby')).toBe('encounter-director-heading')
    expect(wrapper.text()).toContain('Hidden cast2')
    expect(wrapper.text()).toContain('Map revision 7')
    expect(document.activeElement).toBe(wrapper.get('aside').element)

    await wrapper.get('#director-tab-story').trigger('click')
    expect(wrapper.text()).toContain('Awaiting encounter authoring')
    expect(wrapper.text()).toContain('Objectives, Phases, Stakes, Notes, Waves')
  })

  it('offers reveal, reserve, and wave controls only from an encounter-backed Director projection', async () => {
    const base = workspace()
    const authored: EncounterWorkspaceViewModel = {
      ...base,
      source: { ...base.source, encounterRevision: 2 },
      activeEffects: [],
      director: {
        encounterRevision: 2,
        name: 'Canal ambush',
        lifecycle: 'active',
        recipe: 'ambush',
        hiddenParticipantIds: [],
        castRoles: [],
        reserves: [{
          reserveId: 'reserve-zubat', sheetKind: 'pokemon', sheetSlug: 'zubat', displayName: 'Reserve Zubat',
          sideId: 'heroes', ownerParticipantId: null, visibility: 'gm', status: 'ready', placementId: null,
        }],
        waves: [{ waveId: 'wave-one', label: 'Reinforcements', status: 'ready', participantIds: ['actor'], reserveIds: [], revealOnDeploy: true }],
        objectives: [{ objectiveId: 'goal', label: 'Reach the gate', visibility: 'public', status: 'active', progress: null, maximum: null }],
        clocks: [{ clockId: 'gate', label: 'Gate closes', visibility: 'public', status: 'active', progress: 1, maximum: 4 }],
        phases: [{ phaseId: 'pursuit', label: 'Pursuit', visibility: 'public', status: 'upcoming', summary: null }],
        activePhaseId: null, stakes: { public: null, gm: null }, notes: null,
      },
      mapBackedLimitations: [],
    }
    const wrapper = mount(EncounterDirectorPanel, { props: { workspace: authored, open: true } })
    await wrapper.get('#director-tab-cast').trigger('click')
    await wrapper.get('[aria-label="Hide Luxray"]').trigger('click')
    await wrapper.get('.encounter-director__wave button').trigger('click')
    expect(wrapper.text()).toContain('Reserve Zubat')
    expect(wrapper.emitted('setParticipantVisibility')).toEqual([['actor', 'hidden']])
    expect(wrapper.emitted('setWaveStatus')).toEqual([['wave-one', 'deployed']])

    await wrapper.get('#director-tab-story').trigger('click')
    const increment = wrapper.findAll('button').find(button => button.text() === '+')
    await increment!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Activate')!.trigger('click')
    await wrapper.get('form.encounter-director__story').trigger('submit')
    expect(wrapper.emitted('upsertClock')?.[0]?.[0]).toMatchObject({ clockId: 'gate', progress: 2 })
    expect(wrapper.emitted('activatePhase')).toEqual([['pursuit']])
    expect(wrapper.emitted('setStory')?.[0]?.[0]).toMatchObject({ name: 'Canal ambush', lifecycle: 'active' })
    await wrapper.get('#director-tab-system').trigger('click')
    expect(wrapper.get('a[download]').attributes('href')).toBe('/api/encounter-documents/export?encounterId=arena')
    expect(wrapper.get('a[download]').text()).toContain('Export encounter backup')
  })

  it('exposes explicit pending abandonment and accepted item correction controls only in GM system recovery', async () => {
    const base = workspace()
    const recoveryWorkspace: EncounterWorkspaceViewModel = {
      ...base,
      pending: [{
        schemaVersion: 1, projection: 'gm', interactionId: 'item-pending:one', mapSlug: 'arena', mapRevision: 7,
        status: 'pending', source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: null, displayName: 'Potion', referenceHref: null },
        actor: null, prompt: 'Complete the Potion decision.', choices: [],
        responseIdentity: { interactionId: 'item-pending:one', resolutionId: 'op_item_pending_0001', windowId: 'item-decision:one', retryKey: 'op_item_pending_0001' },
        allowPass: false, allowCancel: false, expiresAt: null,
        recoveryActions: [{ action: 'cancel', actionId: 'item-abandon:one', label: 'Abandon and release item', enabled: true, unavailableReason: null }],
        announcement: { announcementId: 'announcement:item', priority: 'assertive', message: 'Potion requires a decision.', dedupeKey: 'item-pending' },
      }],
      accepted: [{
        schemaVersion: 1, presentationId: 'accepted-item:one', operationId: 'op_item_accepted_0001', mapSlug: 'arena',
        previousRevision: 6, revision: 7,
        source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: null, displayName: 'Potion', referenceHref: null },
        actor: null, affectedParticipants: [], outcomes: [], changes: [], explanations: [],
        causal: { groupId: 'item-group:one', parentPresentationId: null, depth: 0, sequence: 0 },
        headline: { label: 'Potion resolved', description: null, iconKey: 'source.item', tone: 'positive' },
        splash: null, vfx: [], announcements: [], history: [], correction: null,
      }],
    }
    const wrapper = mount(EncounterDirectorPanel, { props: { workspace: recoveryWorkspace, open: true } })
    await wrapper.get('#director-tab-system').trigger('click')
    expect(wrapper.text()).toContain('Abandon and release item')
    expect(wrapper.text()).toContain('Correct item use')
    await wrapper.findAll('.encounter-director__recovery button').find(button => button.text() === 'Abandon and release item')!.trigger('click')
    await wrapper.findAll('.encounter-director__recovery button').find(button => button.text() === 'Correct item use')!.trigger('click')
    expect(wrapper.emitted('recover')).toEqual([['item-pending:one', 'cancel']])
    expect(wrapper.emitted('correctItem')).toEqual([['op_item_accepted_0001']])
  })

  it('renders server-authored durations and emits only projected lifecycle authority', async () => {
    const base = workspace()
    const durationWorkspace: EncounterWorkspaceViewModel = {
      ...base,
      activeEffects: [{
        effectRef: 'effect-ref:v1:one', label: 'Critical range bonus', sourceLabel: 'Luxray',
        affectedLabel: 'Luxray', durationKind: 'encounter', durationLabel: 'Until encounter ends',
        dismissalRef: null, dismissible: false,
      }, {
        effectRef: 'effect-ref:v1:two', label: 'Stage-change protection', sourceLabel: 'Luxray',
        affectedLabel: 'Luxray', durationKind: 'turns', durationLabel: '3 target turns remaining',
        dismissalRef: null, dismissible: false,
      }, {
        effectRef: 'effect-ref:v1:three', label: 'Focus stance', sourceLabel: 'Luxray',
        affectedLabel: 'Luxray', durationKind: 'explicit-dismissal', durationLabel: 'Until GM dismisses',
        dismissalRef: 'effect-ref:v1:three', dismissible: true,
      }],
    }
    const wrapper = mount(EncounterDirectorPanel, { props: { workspace: durationWorkspace, open: true } })
    await wrapper.get('#director-tab-system').trigger('click')
    expect(wrapper.text()).toContain('Active effects3')
    expect(wrapper.text()).toContain('Until encounter ends')
    expect(wrapper.text()).toContain('3 target turns remaining')
    expect(wrapper.text()).toContain('Until GM dismisses')
    expect(wrapper.findAll('.encounter-director__effect button')).toHaveLength(1)
    await wrapper.get('.encounter-director__effect button').trigger('click')
    expect(wrapper.emitted('dismissEffect')).toEqual([['effect-ref:v1:three']])

    const boundary = wrapper.get('section.encounter-director__encounter-boundary')
    expect(boundary.text()).toContain('Review persistent consequences, rewards, outcomes, and temporary cleanup together before one atomic commit.')
    await boundary.get('.encounter-director__finish').trigger('click')
    expect(wrapper.emitted('finishEncounter')).toEqual([[]])
  })

  it('disables lifecycle controls while commands are blocked or busy', async () => {
    const base = workspace()
    const durationWorkspace: EncounterWorkspaceViewModel = {
      ...base,
      activeEffects: [{
        effectRef: 'effect-ref:v1:three', label: 'Focus stance', sourceLabel: 'Luxray',
        affectedLabel: 'Luxray', durationKind: 'explicit-dismissal', durationLabel: 'Until GM dismisses',
        dismissalRef: 'effect-ref:v1:three', dismissible: true,
      }],
    }
    const wrapper = mount(EncounterDirectorPanel, {
      props: { workspace: durationWorkspace, open: true, commandsBlocked: true },
    })
    await wrapper.get('#director-tab-system').trigger('click')
    expect(wrapper.get('.encounter-director__effect button').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('.encounter-director__finish').attributes()).toHaveProperty('disabled')
  })

  it('supports Escape, refresh, and Workshop controls without presenting mechanics as player actions', async () => {
    const wrapper = mount(EncounterDirectorPanel, {
      attachTo: document.body,
      props: { workspace: workspace(), open: true },
    })
    await wrapper.get('#director-tab-system').trigger('click')
    const initiative = wrapper.get('[aria-label="Director initiative controls"]').findAll('button')
    await initiative[0]!.trigger('click')
    await initiative[1]!.trigger('click')
    const forms = wrapper.findAll('form.encounter-director__inline-form')
    await forms[0]!.get('input').setValue('Moonlit rooftop')
    await forms[0]!.trigger('submit')
    await forms[1]!.trigger('submit')
    const actions = wrapper.findAll('.encounter-director__actions').at(-1)!.findAll('button')
    await actions[0]!.trigger('click')
    await actions[1]!.trigger('click')
    expect(wrapper.emitted('previousInitiative')).toEqual([[]])
    expect(wrapper.emitted('nextInitiative')).toEqual([[]])
    expect(wrapper.emitted('setScene')).toEqual([['Moonlit rooftop']])
    expect(wrapper.emitted('setFieldEffect')?.[0]?.[0]).toMatchObject({ category: 'weather', kind: 'rainy' })
    expect(wrapper.emitted('refresh')).toEqual([[]])
    expect(wrapper.emitted('openWorkshop')).toContainEqual([])
    await wrapper.get('aside').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })
})
