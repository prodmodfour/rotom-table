// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseItemBreedingWorkflowProjection } from '#shared/breeding/itemWorkflows'
import BreedingItemWorkflowPanel from '../../src/components/breeding/BreedingItemWorkflowPanel.vue'

const optionId = (value: number) => `breeding-item-option:v1:${value.toString(16).padStart(32, '0')}`
const baseOption = (value: number, label: string) => ({ optionId: optionId(value), label, description: null, disabled: false, unavailableReason: null })
const projection = parseItemBreedingWorkflowProjection({
  schemaVersion: 1,
  audience: 'gm',
  trainer: { trainerSheetSlug: 'trainer-mira', trainerRevision: 7, displayName: 'Mira Chen' },
  generatedAtCampaignMinute: 38_760,
  commandsBlocked: false,
  eggWarmer: {
    availability: { enabled: true, unavailableReason: null }, capacity: 4,
    progressRateNumerator: 2, progressRateDenominator: 1,
    units: [{ ...baseOption(1, 'Egg Warmer · unit 1'), assignedEggOptionIds: [optionId(2),optionId(3)] }],
    eggs: [
      { ...baseOption(2, 'Togepi Egg'), status: 'incubating', accumulatedCampaignMinutes: 6_240, targetCampaignMinutes: 7_200, percent: 86 },
      { ...baseOption(3, 'Eevee Egg'), status: 'incubating', accumulatedCampaignMinutes: 3_420, targetCampaignMinutes: 7_200, percent: 47 },
      { ...baseOption(4, 'Castform Egg'), status: 'incubating', accumulatedCampaignMinutes: 1_080, targetCampaignMinutes: 7_200, percent: 15 },
    ],
  },
  fossil: {
    availability: { enabled: true, unavailableReason: null },
    sourceOptions: [baseOption(5, 'Helix Fossil')], machineOptions: [baseOption(6, 'Reanimation Machine')],
    speciesOptions: [baseOption(7, 'Omanyte')], consumesFossilSource: 1, consumesMachine: 0,
  },
  artificial: {
    availability: { enabled: false, unavailableReason: 'Playing God with one reviewed Species choice is required.' },
    chemistryOptions: [], moneyCost: 3500, consumesChemistrySet: 0,
  },
})

describe('BreedingItemWorkflowPanel', () => {
  it('renders accepted target hierarchy, exact requirements, and unmistakably disabled unavailable creation', () => {
    const wrapper = mount(BreedingItemWorkflowPanel, { props: { projection, preview: null, status: 'idle', message: null } })
    expect(wrapper.text()).toContain('Egg & restoration tools')
    expect(wrapper.text()).toContain('2 / 4 assigned')
    expect(wrapper.text()).toContain('Each campaign day counts as two hatch-rate days')
    expect(wrapper.text()).toContain('Consumes one explicitly GM-designated Fossil source')
    expect(wrapper.text()).toContain('Playing God with one reviewed Species choice is required.')
    const creation = wrapper.findAll('button').find(button => button.text().includes('Review creation'))
    expect(creation?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('breeding-item-option')
  })

  it('supports keyboard-native Egg selection and emits one bounded assignment', async () => {
    const wrapper = mount(BreedingItemWorkflowPanel, { props: { projection, preview: null, status: 'idle', message: null } })
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes.map(value => value.element.checked)).toEqual([true,true,false])
    await checkboxes[2]!.setValue(true)
    expect(wrapper.text()).toContain('3 / 4 assigned')
    const save = wrapper.findAll('button').find(button => button.text().includes('Save assignment'))!
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    expect(wrapper.emitted('saveWarmer')).toEqual([[optionId(1), [optionId(2),optionId(3),optionId(4)]]])
  })

  it('keeps uncertain mutation recovery dominant and blocks competing controls', () => {
    const wrapper = mount(BreedingItemWorkflowPanel, { props: {
      projection, preview: null, status: 'uncertain',
      message: 'The breeding item result is uncertain. Retry this exact command.',
    } })
    const retry = wrapper.findAll('button').find(button => button.text().includes('Retry exact command'))!
    expect(retry.exists()).toBe(true)
    expect(wrapper.findAll('select').every(select => select.attributes('disabled') !== undefined)).toBe(true)
  })
})
