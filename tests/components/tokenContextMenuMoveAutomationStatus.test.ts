/**
 * @vitest-environment happy-dom
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TokenContextMenu from '~/components/isometric/TokenContextMenu.vue'
import type { MoveAutomationSemanticStatus } from '~/utils/moveAutomationSemanticStatus'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

const semanticStatus = (
  baseStatus: MoveAutomationSemanticStatus['baseStatus'],
  overrides: Partial<MoveAutomationSemanticStatus> = {},
): MoveAutomationSemanticStatus => ({
  canonicalId: 'Test Move',
  baseStatus,
  baseStatusLabel: baseStatus === 'complete' ? 'Complete' : baseStatus === 'assisted' ? 'Assisted' : 'Blocked',
  interactionStatus: 'unassessed',
  interactionStatusLabel: 'Unassessed',
  runtimeKind: baseStatus === 'blocked' ? 'unimplemented' : 'legacy-v1',
  blockerCodes: [],
  limitations: [],
  manualSteps: [],
  details: [],
  ...overrides,
})

const moveOption = (
  name: string,
  automation: MoveAutomationSemanticStatus,
): TokenMoveMenuOption => ({
  name,
  type: 'Normal',
  damageClass: 'Physical',
  frequency: 'At-Will',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: null,
  special: null,
  damageBase: 4,
  hasStab: false,
  damageAverage: 18,
  damageFormula: '1d8+6+8',
  attackStat: 8,
  baseAttackStat: 8,
  attackStage: 0,
  attackStatKey: 'atk',
  attackStatLabel: 'Attack',
  attackStatAbility: null,
  additionalAttackStat: null,
  additionalBaseAttackStat: null,
  additionalAttackStage: null,
  additionalAttackStatKey: null,
  additionalAttackStatLabel: null,
  automatic: false,
  moveList: {
    source: 'placement',
    effectId: null,
    copiedSpecHash: null,
    available: true,
    blockReason: null,
    blockingEffectIds: [],
  },
  disabledByMoveList: false,
  // Keep this true for every fixture to prove registry presence cannot enable blocked rows.
  hasAutomationScript: true,
  automation,
  disabledByAutomation: automation.baseStatus === 'blocked',
  conditionUseBlock: null,
  disabledByCondition: false,
  usage: null,
  disabledByUsage: false,
})

const mountMenu = (moves?: TokenMoveMenuOption[]): VueWrapper => mount(TokenContextMenu, {
  props: {
    menu: {
      id: 'token',
      x: 20,
      y: 20,
      canTurn: false,
      canViewPokedex: true,
      canGrantExperience: true,
      canUseOrders: false,
      canThrowPokeball: false,
    },
    moves: moves ?? [
      moveOption('Complete Move', semanticStatus('complete', {
        canonicalId: 'Complete Move',
        interactionStatus: 'partial',
        interactionStatusLabel: 'Partial',
      })),
      moveOption('Assisted Move', semanticStatus('assisted', {
        canonicalId: 'Assisted Move',
        limitations: [{ code: 'choice.manual', summary: 'Choose the secondary effect manually.' }],
        details: [{
          kind: 'limitation',
          label: 'Limitation',
          code: 'choice.manual',
          summary: 'Choose the secondary effect manually.',
        }],
      })),
      moveOption('Blocked Move', semanticStatus('blocked', {
        canonicalId: 'Blocked Move',
        blockerCodes: ['reactions.durable'],
        details: [{
          kind: 'blocker',
          label: 'Capability blocker',
          code: 'reactions.durable',
          summary: 'Reactions · Durable is planned for Phase 5.',
        }],
      })),
    ],
  },
  global: {
    stubs: {
      Teleport: true,
      ReferenceTooltip: true,
      TypeBadge: true,
      DamageClassBadge: true,
      ItemSprite: true,
    },
  },
})

const createUseStateStub = () => {
  const states = new Map<string, Ref<unknown>>()
  return <T>(key: string, init: () => T): Ref<T> => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key) as Ref<T>
  }
}

describe('TokenContextMenu move semantic status', () => {
  beforeEach(() => {
    vi.stubGlobal('useState', createUseStateStub())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows complete, assisted, and blocked states with interaction coverage separate', async () => {
    const wrapper = mountMenu()
    const openMoves = wrapper.findAll('button').find((button) => button.text().includes('Use Move'))
    if (!openMoves) throw new Error('Use Move button was not found')
    await openMoves.trigger('click')

    const moveButtons = wrapper.findAll<HTMLButtonElement>('.action-submenu__item')
    expect(moveButtons.map((button) => button.attributes('data-automation-status'))).toEqual([
      'complete',
      'assisted',
      'blocked',
    ])
    expect(moveButtons[0]?.text()).toContain('Complete automation')
    expect(moveButtons[0]?.text()).toContain('Interactions: Partial')
    expect(moveButtons[1]?.text()).toContain('Assisted · partial automation')
    expect(moveButtons[1]?.text()).toContain('Interactions: Unassessed')
    expect(moveButtons[2]?.text()).toContain('Blocked automation')
    expect(moveButtons[2]?.text()).toContain('Interactions: Unassessed')
  })

  it('shows temporary move sources and enforces encounter disable/restriction results', async () => {
    const temporary = {
      ...moveOption('Temporary Move', semanticStatus('complete')),
      moveList: {
        source: 'encounter-overlay' as const,
        effectId: 'effect.move-list.copy',
        copiedSpecHash: 'a'.repeat(64),
        available: true,
        blockReason: null,
        blockingEffectIds: [],
      },
    }
    const disabled = {
      ...moveOption('Disabled Move', semanticStatus('complete')),
      moveList: {
        source: 'placement' as const,
        effectId: null,
        copiedSpecHash: null,
        available: false,
        blockReason: 'move-list-disabled' as const,
        blockingEffectIds: ['effect.move-list.disable'],
      },
      disabledByMoveList: true,
    }
    const wrapper = mountMenu([temporary, disabled])
    const openMoves = wrapper.findAll('button').find(button => button.text().includes('Use Move'))
    if (!openMoves) throw new Error('Use Move button was not found')
    await openMoves.trigger('click')

    const moveButtons = wrapper.findAll<HTMLButtonElement>('.action-submenu__item')
    expect(moveButtons[0]?.text()).toContain('Temporary')
    expect(moveButtons[0]?.element.disabled).toBe(false)
    expect(moveButtons[1]?.text()).toContain('Disabled')
    expect(moveButtons[1]?.attributes('title')).toContain('disabled by an active encounter effect')
    expect(moveButtons[1]?.element.disabled).toBe(true)

    await moveButtons[0]?.trigger('click')
    await moveButtons[1]?.trigger('click')
    expect(wrapper.emitted('use-move')).toEqual([['Temporary Move']])
  })

  it('keeps assisted limitations visible before use and disables blocked registry entries', async () => {
    const wrapper = mountMenu()
    const openMoves = wrapper.findAll('button').find((button) => button.text().includes('Use Move'))
    if (!openMoves) throw new Error('Use Move button was not found')
    await openMoves.trigger('click')

    const moveButtons = wrapper.findAll<HTMLButtonElement>('.action-submenu__item')
    const complete = moveButtons[0]!
    const assisted = moveButtons[1]!
    const blocked = moveButtons[2]!

    expect(complete.element.disabled).toBe(false)
    expect(assisted.element.disabled).toBe(false)
    expect(assisted.text()).toContain('Limitation · choice.manual')
    expect(assisted.text()).toContain('Choose the secondary effect manually.')
    expect(assisted.attributes('title')).toContain('Assisted partial automation')
    expect(assisted.attributes('title')).toContain('Limitation choice.manual')

    expect(blocked.element.disabled).toBe(true)
    expect(blocked.text()).toContain('Capability blocker · reactions.durable')
    expect(blocked.text()).toContain('Reactions · Durable is planned for Phase 5.')
    expect(blocked.attributes('title')).toContain('Capability blocker reactions.durable')

    await complete.trigger('click')
    await assisted.trigger('click')
    await blocked.trigger('click')
    expect(wrapper.emitted('use-move')).toEqual([
      ['Complete Move'],
      ['Assisted Move'],
    ])
  })
})
