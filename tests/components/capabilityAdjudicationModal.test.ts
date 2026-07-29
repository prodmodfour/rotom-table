/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CapabilityAdjudicationModal from '~/components/maps/CapabilityAdjudicationModal.vue'
import type { EncounterActionOffer } from '#shared/encounterPresentation/contracts'

const offer = (canonicalId: string): EncounterActionOffer => ({
  schemaVersion: 1, offerId: `adjudication-${canonicalId}`, mapSlug: 'arena', mapRevision: 2,
  actor: { participantId: 'actor', displayName: 'Actor', portraitUrl: null, sideId: null, sideLabel: null, sideAccent: null, sheetKind: 'pokemon', statusLabels: [] },
  source: { sourceKind: 'capability', canonicalId, instanceId: 'request', displayName: canonicalId, referenceHref: null },
  roles: ['choice-only'], group: 'support', groupOrder: 1, offerOrder: 1,
  timing: { kind: 'free', label: 'Adjudication', triggerLabel: null, priority: null }, costs: [], targeting: [],
  usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: 'Resolve result', description: null, iconKey: null, tone: 'warning' },
  intent: { actionId: 'capability.adjudication:request', input: 'choices' }, selectionOptions: [],
})

const participants = [
  { id: 'viewer-one', label: 'Viewer One' },
  { id: 'viewer-two', label: 'Viewer Two' },
]

describe('CapabilityAdjudicationModal typed serialization', () => {
  it('serializes a Dream Mist image using selected authoritative viewers', async () => {
    const wrapper = mount(CapabilityAdjudicationModal, {
      props: { offer: offer('Dream Reader'), participants },
    })
    const mode = wrapper.findAll('select')[0]!
    await mode.setValue('dream-mist-image')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await wrapper.get('textarea').setValue('A retained image of a moonlit lake.')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      decision: 'accept',
      optionId: 'dream-mist-image:viewers:viewer-one',
      description: 'A retained image of a moonlit lake.',
    })
  })

  it('rejects without leaking stale option or description values', async () => {
    const wrapper = mount(CapabilityAdjudicationModal, {
      props: { offer: offer('Fortune'), participants },
    })
    await wrapper.get('textarea').setValue('Would have returned.')
    await wrapper.find('input[type="radio"][value="reject"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({ decision: 'reject', optionId: null, description: null })
  })
})
