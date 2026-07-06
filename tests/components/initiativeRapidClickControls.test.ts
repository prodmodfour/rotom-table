/**
 * @vitest-environment happy-dom
 */
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import InitiativeControls from '~/components/map/InitiativeControls.vue'
import InitiativeInfoBar from '~/components/map/InitiativeInfoBar.vue'
import InitiativeMenuModal from '~/components/map/InitiativeMenuModal.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

const initiativeRows = (): InitiativeRow[] => [
  {
    id: 'token-a',
    name: 'Alpha',
    meta: 'Pokémon',
    sprite: { url: null, isSpriteSheet: false, frameWidth: 32, frameHeight: 32, scale: 1 },
    profileUrl: null,
    currentHp: 30,
    maxHp: 30,
    conditions: [],
    initiative: 30,
    baseSpeed: 30,
    speed: 30,
    speedCombatStage: 0,
    baseInitiative: 30,
    initiativeItemBonus: 0,
    initiativeTrainingBonus: 0,
    initiativeScore: 30,
  },
  {
    id: 'token-b',
    name: 'Bravo',
    meta: 'Trainer',
    sprite: { url: null, isSpriteSheet: false, frameWidth: 32, frameHeight: 32, scale: 1 },
    profileUrl: null,
    currentHp: 40,
    maxHp: 40,
    conditions: [],
    initiative: 20,
    baseSpeed: 20,
    speed: 20,
    speedCombatStage: 0,
    baseInitiative: 20,
    initiativeItemBonus: 0,
    initiativeTrainingBonus: 0,
    initiativeScore: 20,
  },
]

const normalizedText = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

const findButton = (wrapper: VueWrapper, accessibleName: string): DOMWrapper<HTMLButtonElement> => {
  const button = wrapper.findAll<HTMLButtonElement>('button').find((candidate) => {
    const element = candidate.element
    return element.getAttribute('aria-label') === accessibleName || normalizedText(element.textContent) === accessibleName
  })
  if (!button) throw new Error(`Button ${accessibleName} was not found`)
  return button
}

const click = async (button: DOMWrapper<HTMLButtonElement>): Promise<void> => {
  button.element.click()
  await nextTick()
}

describe('initiative rapid click controls', () => {
  it('top initiative bar disables pending controls and emits one rapid Next command', async () => {
    const ready = ref(true)
    const nextDispatch = vi.fn(() => {
      ready.value = false
    })
    const Harness = defineComponent({
      components: { InitiativeInfoBar },
      setup: () => ({ rows: initiativeRows(), ready, nextDispatch }),
      template: `
        <InitiativeInfoBar
          :rows="rows"
          active-id="token-a"
          :round="1"
          :can-manage="ready"
          @next="nextDispatch"
        />
      `,
    })
    const wrapper = mount(Harness)

    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(false)
    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(1)
    expect(findButton(wrapper, 'Previous turn').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(true)

    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(1)

    ready.value = true
    await nextTick()
    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(false)
    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(2)
  })

  it('initiative modal disables pending controls and dispatches one rapid Next command', async () => {
    const ready = ref(true)
    const nextDispatch = vi.fn(() => {
      ready.value = false
    })
    const rows = initiativeRows()
    const Harness = defineComponent({
      components: { InitiativeMenuModal },
      setup: () => ({ rows, ready, nextDispatch }),
      template: `
        <InitiativeMenuModal
          :rows="rows"
          :sorted-rows="rows"
          active-id="token-a"
          :round="1"
          selected-id="token-a"
          :can-manage="ready"
          :has-initiative-values="true"
          :manual-order-active="false"
          @next="nextDispatch"
        />
      `,
    })
    const wrapper = mount(Harness)

    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(false)
    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(1)
    expect(findButton(wrapper, 'Previous').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(true)

    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(1)

    ready.value = true
    await nextTick()
    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(false)
    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(2)
  })

  it('initiative controls guard disabled Next clicks after pending state is applied', async () => {
    const ready = ref(true)
    const nextDispatch = vi.fn(() => {
      ready.value = false
    })
    const Harness = defineComponent({
      components: { InitiativeControls },
      setup: () => ({ ready, nextDispatch }),
      template: `
        <InitiativeControls
          :row-count="2"
          active-id="token-a"
          :round="1"
          :can-manage="ready"
          :has-initiative-values="true"
          :manual-order-active="false"
          @next="nextDispatch"
        />
      `,
    })
    const wrapper = mount(Harness)

    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(false)
    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(1)
    expect(findButton(wrapper, 'Previous').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(true)

    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(1)

    ready.value = true
    await nextTick()
    expect(findButton(wrapper, 'Next turn').element.disabled).toBe(false)
    await click(findButton(wrapper, 'Next turn'))
    expect(nextDispatch).toHaveBeenCalledTimes(2)
  })
})
