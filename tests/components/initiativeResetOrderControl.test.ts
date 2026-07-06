/**
 * @vitest-environment happy-dom
 */
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InitiativeMenuModal from '~/components/map/InitiativeMenuModal.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

const initiativeRow = (id: string, name: string, initiativeScore: number): InitiativeRow => ({
  id,
  name,
  meta: 'Pokémon',
  sprite: { url: null, isSpriteSheet: false, frameWidth: 32, frameHeight: 32, scale: 1 },
  profileUrl: null,
  currentHp: 30,
  maxHp: 30,
  conditions: [],
  initiative: initiativeScore,
  baseSpeed: initiativeScore,
  speed: initiativeScore,
  speedCombatStage: 0,
  baseInitiative: initiativeScore,
  initiativeItemBonus: 0,
  initiativeTrainingBonus: 0,
  initiativeScore,
})

const initiativeRows = (): InitiativeRow[] => [
  initiativeRow('token-a', 'Alpha', 30),
  initiativeRow('token-b', 'Bravo', 20),
]

const normalizedText = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

const findButton = (wrapper: VueWrapper, label: string): DOMWrapper<HTMLButtonElement> | undefined =>
  wrapper.findAll<HTMLButtonElement>('button').find((candidate) => normalizedText(candidate.element.textContent) === label)

const getButton = (wrapper: VueWrapper, label: string): DOMWrapper<HTMLButtonElement> => {
  const button = findButton(wrapper, label)
  if (!button) throw new Error(`Button ${label} was not found`)
  return button
}

const mountModal = ({
  canManage = true,
  manualOrderActive = true,
}: {
  canManage?: boolean
  manualOrderActive?: boolean
} = {}): VueWrapper => {
  const rows = initiativeRows()
  return mount(InitiativeMenuModal, {
    props: {
      rows,
      sortedRows: rows,
      activeId: 'token-a',
      round: 2,
      selectedId: null,
      canManage,
      hasInitiativeValues: true,
      manualOrderActive,
    },
  })
}

describe('initiative reset order control', () => {
  it('renders only while manual order is active and emits a manual-order clear', async () => {
    const inactiveWrapper = mountModal({ manualOrderActive: false })
    expect(findButton(inactiveWrapper, 'Reset order')).toBeUndefined()

    const wrapper = mountModal({ manualOrderActive: true })
    const resetOrder = getButton(wrapper, 'Reset order')

    expect(resetOrder.attributes('title')).toBe('Return to calculated initiative order')
    expect(resetOrder.element.disabled).toBe(false)

    await resetOrder.trigger('click')

    expect(wrapper.emitted('clear-manual-order')).toEqual([[]])
    expect(wrapper.emitted('clear-values')).toBeUndefined()
    expect(wrapper.emitted('clear-active')).toBeUndefined()
  })

  it('keeps the reset order control disabled for read-only users', async () => {
    const wrapper = mountModal({ canManage: false, manualOrderActive: true })
    const resetOrder = getButton(wrapper, 'Reset order')

    expect(resetOrder.element.disabled).toBe(true)

    await resetOrder.trigger('click')

    expect(wrapper.emitted('clear-manual-order')).toBeUndefined()
  })
})
