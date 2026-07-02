/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PokemonStatsPanel from '~/components/sheets/PokemonStatsPanel.vue'
import type {
  BaseRelationViolation,
  ResolvedStat,
} from '~/utils/sheets/pokemonDerived'
const stat = (overrides: Partial<ResolvedStat> & Pick<ResolvedStat, 'key' | 'label'>): ResolvedStat => ({
  species: 5,
  mod: 0,
  vitaminAdjustment: 0,
  base: 5,
  added: 0,
  stage: 0,
  manualStage: 0,
  conditionStageModifier: 0,
  effectiveStage: 0,
  baseTotal: 5,
  total: 5,
  ...overrides,
})

const mountPanel = (options: {
  stats: ResolvedStat[]
  baseRelationViolations?: BaseRelationViolation[]
  statPointsLeft?: number
}) => mount(PokemonStatsPanel, {
  props: {
    stats: options.stats,
    statPointsLeft: options.statPointsLeft ?? 8,
    statPointsSpent: 12,
    statPointsBudget: 20,
    baseRelationViolations: options.baseRelationViolations ?? [],
    visibleBaseRelationViolations: options.baseRelationViolations ?? [],
    remainingBaseRelationViolationCount: 0,
  },
  global: {
    stubs: {
      EditableCell: {
        props: ['modelValue'],
        template: '<span class="editable-cell-stub">{{ modelValue }}</span>',
      },
      RefLink: {
        props: ['name'],
        template: '<span>{{ name }}</span>',
      },
      StatAllocationSlider: {
        props: ['modelValue', 'pointsLeft', 'label', 'min', 'max', 'constraintLabel'],
        template: `
          <div
            class="stat-slider-stub"
            :data-label="label"
            :data-has-min="min === undefined ? 'false' : 'true'"
            :data-has-max="max === undefined ? 'false' : 'true'"
            :data-points-left="pointsLeft"
          />
        `,
      },
    },
  },
})

describe('PokemonStatsPanel', () => {
  it('keeps BSR as a warning without constraining Added stat sliders', () => {
    const hp = stat({ key: 'hp', label: 'HP', base: 7, added: 0, baseTotal: 7, total: 7 })
    const atk = stat({ key: 'atk', label: 'Attack', base: 4, added: 5, baseTotal: 9, total: 9 })
    const wrapper = mountPanel({
      stats: [hp, atk],
      baseRelationViolations: [{ higher: hp, lower: atk }],
    })

    const sliders = wrapper.findAll('.stat-slider-stub')
    expect(sliders).toHaveLength(2)
    expect(sliders[0]!.attributes('data-has-min')).toBe('false')
    expect(sliders[0]!.attributes('data-has-max')).toBe('false')
    expect(sliders[1]!.attributes('data-has-min')).toBe('false')
    expect(sliders[1]!.attributes('data-has-max')).toBe('false')

    expect(wrapper.text()).toContain('Base Relations')
    expect(wrapper.text()).toContain('HP')
    expect(wrapper.text()).toContain('must stay above Attack')
  })
})
