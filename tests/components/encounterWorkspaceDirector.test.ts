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
