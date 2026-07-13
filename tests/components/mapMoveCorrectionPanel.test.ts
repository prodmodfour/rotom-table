/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapMoveCorrectionPanel from '~/components/map/MapMoveCorrectionPanel.vue'
import type { GmMoveCorrectionDetails } from '#shared/moveAutomation/correctionViews'

const details = (): GmMoveCorrectionDetails => ({
  schemaVersion: 1,
  mapSlug: 'arena',
  originOperationId: 'op_panelorigin01',
  moveName: 'Swords Dance',
  acceptedAt: 1_000,
  acceptedRevision: 8,
  operations: [
    {
      operationId: 'inverse.state-change.1.combatStages',
      effectKind: 'combat-stages',
      reasonCode: 'combat-stage-changed',
      resource: {
        kind: 'sheet',
        sheetKind: 'pokemon',
        sheetSlug: 'actor',
        acceptedRevision: 5,
      },
      availability: 'available',
    },
    {
      operationId: 'inverse.state-change.2.hp',
      effectKind: 'hp',
      reasonCode: 'damage-applied',
      resource: {
        kind: 'sheet',
        sheetKind: 'pokemon',
        sheetSlug: 'target',
        acceptedRevision: 4,
      },
      availability: 'available',
    },
    {
      operationId: 'unavailable.state-change.3',
      effectKind: 'history',
      reasonCode: 'accepted-move-log-projection',
      resource: { kind: 'map', mapSlug: 'arena', acceptedRevision: 8 },
      availability: 'unavailable',
      safety: 'externally-observed',
      unavailableReasonCode: 'accepted-log-may-be-observed',
    },
  ],
  corrections: [{
    correctionOperationId: 'op_panelaccepted1',
    originOperationId: 'op_panelorigin01',
    operationIds: ['inverse.state-change.2.hp'],
    status: 'accepted',
    createdAt: 2_000,
    mapRevision: 9,
  }, {
    correctionOperationId: 'op_panelconflict1',
    originOperationId: 'op_panelorigin01',
    operationIds: ['inverse.state-change.1.combatStages'],
    status: 'conflicted',
    createdAt: 3_000,
    mapRevision: 9,
    reasonCode: 'conflict',
    message: 'The affected resource changed.',
  }],
})

describe('MapMoveCorrectionPanel', () => {
  it('shows eligible resources, warnings, terminal states, and causal history', async () => {
    const wrapper = mount(MapMoveCorrectionPanel, {
      props: {
        details: details(),
        status: 'conflicted',
        message: 'The affected resource changed.',
      },
    })

    expect(wrapper.text()).toContain('Swords Dance')
    expect(wrapper.text()).toContain('Original operation')
    expect(wrapper.text()).toContain('op_panelorigin01')
    expect(wrapper.text()).toContain('Combat Stages')
    expect(wrapper.text()).toContain('Pokémon sheet actor · accepted revision 5')
    expect(wrapper.text()).toContain('Non-reversible warnings')
    expect(wrapper.text()).toContain('may already have been observed')
    expect(wrapper.text()).toContain('Accepted correction')
    expect(wrapper.text()).toContain('Conflicted correction')
    expect(wrapper.text()).toContain('Corrects original')
    expect(wrapper.find('.move-correction-panel__state').attributes('data-state')).toBe('conflicted')

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[1]!.attributes('disabled')).toBeDefined()
    await checkboxes[0]!.setValue(true)
    await wrapper.get('.move-correction-panel__apply').trigger('click')

    expect(wrapper.emitted('apply')).toEqual([[['inverse.state-change.1.combatStages']]])
  })

  it('renders pending and accepted states without exposing mechanics values', () => {
    const pending = mount(MapMoveCorrectionPanel, {
      props: { details: details(), status: 'pending' },
    })
    expect(pending.find('.move-correction-panel__state').attributes('data-state')).toBe('pending')
    expect(pending.get('.move-correction-panel__apply').attributes('disabled')).toBeDefined()

    const accepted = mount(MapMoveCorrectionPanel, {
      props: {
        details: details(),
        status: 'accepted',
        message: 'Correction accepted.',
      },
    })
    expect(accepted.find('.move-correction-panel__state').attributes('data-state')).toBe('accepted')
    expect(accepted.text()).toContain('Correction accepted.')
    expect(accepted.html()).not.toContain('expectedCurrent')
    expect(accepted.html()).not.toContain('currentHp')
    expect(accepted.html()).not.toContain('Private nickname')
  })
})
