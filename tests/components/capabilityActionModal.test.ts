/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CapabilityActionModal from '~/components/maps/CapabilityActionModal.vue'
import type { EncounterActionOffer, EncounterTargetingSummary } from '#shared/encounterPresentation/contracts'

const offer = (
  targeting: readonly EncounterTargetingSummary[],
  selectionOptions: EncounterActionOffer['selectionOptions'] = [],
): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: 'capability-offer',
  mapSlug: 'arena',
  mapRevision: 4,
  actor: {
    participantId: 'actor', displayName: 'Actor', portraitUrl: null,
    sideId: null, sideLabel: null, sideAccent: null, sheetKind: 'pokemon', statusLabels: [],
  },
  source: {
    sourceKind: 'capability', canonicalId: 'Groundshaper', instanceId: 'capability:actor:Groundshaper:base',
    displayName: 'Groundshaper', referenceHref: null,
  },
  roles: ['activated-action'],
  group: 'field', groupOrder: 1, offerOrder: 1,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }],
  targeting,
  usage: { frequencyLabel: 'At-Will', remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: 'Use Capability', description: null, iconKey: null, tone: 'neutral' },
  intent: { actionId: 'capability.execute', input: targeting.some(entry => entry.requiresSpatialInput) ? 'spatial' : 'choices' },
  selectionOptions,
})

const cellTarget = (maximum = 4): EncounterTargetingSummary => ({
  requirementId: 'cells', kind: 'area', minSelections: 1, maxSelections: maximum,
  rangeLabel: 'Adjacent', relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
})

const mountModal = (actionId: string, actionOffer: EncounterActionOffer) => mount(CapabilityActionModal, {
  props: {
    offer: actionOffer,
    actionId,
    participants: [{ id: 'target', label: 'Target' }],
    trainerSlugs: ['trainer'],
    canConfirmAsGm: true,
  },
})

describe('CapabilityActionModal typed serialization', () => {
  it('serializes independent Groundshaper cell choices without raw option authoring', async () => {
    const wrapper = mountModal('shape-ground', offer([cellTarget()]))
    await wrapper.get('input[placeholder="x,y,z; x,y,z"]').setValue('1,0,0; 0,0,1')
    await wrapper.get('select').setValue('per-cell')
    await wrapper.vm.$nextTick()
    const terrainSelects = wrapper.findAll('fieldset select')
    expect(terrainSelects).toHaveLength(2)
    await terrainSelects[0]!.setValue('rough')
    await terrainSelects[1]!.setValue('basic')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      cells: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
      optionId: 'per-cell:1,0,0=rough;0,0,1=basic',
    })
  })

  it('serializes server-issued world-object identities from checkboxes', async () => {
    const actionOffer = offer([cellTarget(1)], [
      { kind: 'object', value: 'iron-crate', label: 'Iron crate' },
      { kind: 'object', value: 'steel-ball', label: 'Steel ball' },
    ])
    const wrapper = mountModal('manipulate-object', actionOffer)
    await wrapper.get('input[placeholder="x,y,z; x,y,z"]').setValue('2,0,2')
    for (const checkbox of wrapper.findAll('fieldset input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      cells: [{ x: 2, y: 0, z: 2 }],
      optionId: 'objects:iron-crate,steel-ball',
    })
  })

  it('requires and serializes an explicit linked Trainer for Juicer collection', async () => {
    const wrapper = mountModal('collect-juicer-output', offer([], [
      { kind: 'trainer', value: 'linked-trainer', label: 'Linked Trainer' },
    ]))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('Select the explicitly linked Trainer inventory')

    expect(wrapper.find('option[value="trainer"]').exists()).toBe(false)
    await wrapper.get('select').setValue('linked-trainer')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ recipientTrainerSlug: 'linked-trainer' })
  })

  it('serializes a GM-confirmed Tracker branch with an exact prey identity', async () => {
    const wrapper = mountModal('track-scent', offer([]))
    await wrapper.get('select').setValue('specific')
    await wrapper.get('input[placeholder="pokemon:species-or-campaign-id"]').setValue('pokemon:eevee-42')
    await wrapper.get('textarea').setValue('The trail leads north.')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      optionId: 'specific;prey:pokemon:eevee-42',
      description: 'The trail leads north.',
      gmConfirmed: true,
    })
  })

  it('serializes Dream Mist viewers as a bounded canonical option', async () => {
    const participantTarget: EncounterTargetingSummary = {
      requirementId: 'target', kind: 'participant', minSelections: 1, maxSelections: 1,
      rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
    }
    const wrapper = mountModal('read-dream', offer([participantTarget]))
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('select').setValue('dream-mist-image')
    await wrapper.vm.$nextTick()
    const viewer = wrapper.findAll('input[type="checkbox"]')[1]!
    await viewer.setValue(true)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      targetPlacementIds: ['target'],
      optionId: 'dream-mist-image:viewers:target',
    })
  })
})
