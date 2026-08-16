// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MedicalTreatmentStatusCard from '~/components/sheets/MedicalTreatmentStatusCard.vue'
import type { ItemMedicalTreatmentProjectionV1 } from '#shared/itemAutomation/medicalTreatments'

const active = (): ItemMedicalTreatmentProjectionV1 => ({
  schemaVersion: 1,
  treatmentId: `item-treatment:v1:${'a'.repeat(32)}`,
  revision: 1,
  itemLabel: 'Bandages',
  status: 'active',
  appliedAtCampaignMinute: 100,
  nextTickCampaignMinute: 160,
  endsAtCampaignMinute: 460,
  elapsedMinutes: 30,
  remainingMinutes: 330,
  ticksApplied: 1,
  hitPointsRestored: 4,
  injuryRemoved: false,
  terminalMessage: null,
})

describe('MedicalTreatmentStatusCard', () => {
  it('renders authoritative active progress and HP-loss interruption without controls or private evidence', () => {
    const wrapper = mount(MedicalTreatmentStatusCard, { props: { treatments: [active()] } })
    expect(wrapper.text()).toContain('Bandages active')
    expect(wrapper.text()).toContain('Minute 130 → 460')
    expect(wrapper.text()).toContain('30 of 360 minutes')
    expect(wrapper.text()).toContain('1 / 12')
    expect(wrapper.text()).toContain('4')
    expect(wrapper.text()).toContain('1 Injury · daily limit applies')
    expect(wrapper.text()).toContain('Any HP loss stops this treatment.')
    expect(wrapper.find('progress').attributes()).toMatchObject({ value: '30', max: '360' })
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.html()).not.toContain('canonicalDefinitionSha256')
    expect(wrapper.html()).not.toContain('sourceOperationId')
  })

  it('renders completed and cancelled terminal status without implying more progress', async () => {
    const wrapper = mount(MedicalTreatmentStatusCard, {
      props: {
        treatments: [{
          ...active(), status: 'completed', nextTickCampaignMinute: null,
          elapsedMinutes: 360, remainingMinutes: 0, ticksApplied: 12,
          injuryRemoved: true, terminalMessage: 'Bandages completed after 6 hours; 1 Injury was removed.',
        }],
      },
    })
    expect(wrapper.text()).toContain('Bandages completed')
    expect(wrapper.text()).toContain('1 Injury was removed')
    expect(wrapper.find('progress').exists()).toBe(false)

    await wrapper.setProps({ treatments: [{
      ...active(), status: 'cancelled', nextTickCampaignMinute: null,
      remainingMinutes: 0, terminalMessage: 'Bandages stopped when the target lost HP.',
    }] })
    expect(wrapper.text()).toContain('Bandages stopped')
    expect(wrapper.text()).toContain('target lost HP')
  })

  it('renders nothing when no projected treatment exists', () => {
    expect(mount(MedicalTreatmentStatusCard, { props: { treatments: [] } }).html()).toBe('<!--v-if-->')
  })
})
