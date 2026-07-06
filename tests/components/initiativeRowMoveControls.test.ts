/**
 * @vitest-environment happy-dom
 */
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InitiativeList from '~/components/map/InitiativeList.vue'
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
  initiativeRow('token-c', 'Charlie', 10),
]

const findButton = (wrapper: VueWrapper, accessibleName: string): DOMWrapper<HTMLButtonElement> => {
  const button = wrapper.findAll<HTMLButtonElement>('button').find((candidate) => {
    return candidate.element.getAttribute('aria-label') === accessibleName
  })
  if (!button) throw new Error(`Button ${accessibleName} was not found`)
  return button
}

const mountList = (canManage: boolean): VueWrapper => mount(InitiativeList, {
  props: {
    rows: initiativeRows(),
    activeId: null,
    selectedId: null,
    canManage,
    manualOrderActive: false,
  },
})

describe('initiative row move controls', () => {
  it('disables impossible edge moves and emits requested row moves', async () => {
    const wrapper = mountList(true)

    expect(findButton(wrapper, 'Move Alpha earlier in initiative').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Move Alpha later in initiative').element.disabled).toBe(false)
    expect(findButton(wrapper, 'Move Charlie earlier in initiative').element.disabled).toBe(false)
    expect(findButton(wrapper, 'Move Charlie later in initiative').element.disabled).toBe(true)

    await findButton(wrapper, 'Move Bravo earlier in initiative').trigger('click')
    await findButton(wrapper, 'Move Bravo later in initiative').trigger('click')

    expect(wrapper.emitted('move-row')).toEqual([
      ['token-b', -1],
      ['token-b', 1],
    ])
  })

  it('keeps row move controls visible but disabled for read-only users', () => {
    const wrapper = mountList(false)

    expect(findButton(wrapper, 'Move Alpha earlier in initiative').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Move Alpha later in initiative').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Move Bravo earlier in initiative').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Move Bravo later in initiative').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Move Charlie earlier in initiative').element.disabled).toBe(true)
    expect(findButton(wrapper, 'Move Charlie later in initiative').element.disabled).toBe(true)
  })
})
