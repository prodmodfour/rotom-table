/**
 * @vitest-environment happy-dom
 */
import { performance } from 'node:perf_hooks'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import budgets from '../../data/complete-play-loop/performance-scale-budgets.v1.json'
import InventoryItemTable from '../../src/components/inventory/InventoryItemTable.vue'
import EncounterActionDock from '../../src/components/encounter/workspace/EncounterActionDock.vue'
import type { InventoryEntry } from '../../src/types/trainerSheet'
import type { EncounterActionOffer } from '../../shared/encounterPresentation'

const inventoryRows = (count: number): InventoryEntry[] => Array.from({ length: count }, (_, index) => ({
  id: `scale-row-${index}`,
  name: `Scale Item ${index + 1}`,
  qty: 1,
  cost: '₽100',
  description: 'Bounded scale fixture.',
}))

const actionOffer = (index: number): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: `offer:scale:${index}`,
  mapSlug: 'scale-arena',
  mapRevision: 42,
  actor: {
    participantId: 'actor:scale',
    displayName: 'Scale Actor',
    portraitUrl: null,
    sideId: 'side:party',
    sideLabel: 'Party',
    sideAccent: '#167f86',
    sheetKind: 'pokemon',
    statusLabels: [],
  },
  source: {
    sourceKind: index % 2 ? 'move' : 'ability',
    canonicalId: `Source ${index}`,
    instanceId: index % 2 ? null : `ability:${index}`,
    displayName: `Source ${index}`,
    referenceHref: null,
  },
  roles: ['activated-action'],
  group: index % 2 ? 'attack' : 'support',
  groupOrder: index % 2,
  offerOrder: index,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [],
  targeting: [],
  usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: `Source ${index}`, description: 'Projected action.', iconKey: null, tone: 'neutral' },
  intent: { actionId: 'action.declare', input: 'choices' },
})

afterEach(() => document.body.replaceChildren())

describe('P8-095 bounded large-surface rendering', () => {
  it('keeps a 5,000-row inventory at one 80-row semantic table page', async () => {
    const rows = inventoryRows(budgets.scenarios.largeInventory.storedRows)
    const startedAt = performance.now()
    const wrapper = mount(InventoryItemTable, {
      attachTo: document.body,
      props: {
        sectionKey: 'medicalKit',
        title: 'Medical Kit',
        items: rows,
        namePlaceholder: 'Item',
        variant: 'standard',
        readOnly: true,
      },
    })
    const duration = performance.now() - startedAt

    expect(wrapper.findAll('tbody tr')).toHaveLength(budgets.scenarios.largeInventory.renderPageSize)
    expect(wrapper.text()).toContain('Rows 1–80 of 5000')
    expect(wrapper.text()).toContain('Scale Item 1')
    expect(wrapper.text()).not.toContain('Scale Item 81')
    expect(duration).toBeLessThan(budgets.profiles.lowerEndLaptop.initialRenderTargetMs)

    await wrapper.get('button:last-of-type').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(80)
    expect(wrapper.text()).toContain('Rows 81–160 of 5000')
    expect(wrapper.text()).toContain('Scale Item 81')
    expect(wrapper.find('[data-inventory-row="0"]').exists()).toBe(false)

    await wrapper.setProps({ selectedRowIndex: 4999 })
    expect(wrapper.findAll('tbody tr')).toHaveLength(40)
    expect(wrapper.text()).toContain('Rows 4961–5000 of 5000')
    expect(wrapper.get('[data-inventory-row="4999"]').attributes('aria-current')).toBe('true')
  })

  it('keeps a dense 512-offer Action Dock to one 80-card initial batch', async () => {
    const offers = Array.from(
      { length: budgets.scenarios.actionDock.offerCount },
      (_, index) => actionOffer(index),
    )
    const startedAt = performance.now()
    const wrapper = mount(EncounterActionDock, {
      attachTo: document.body,
      props: {
        offers,
        actorParticipantId: 'actor:scale',
        actorLabel: 'Scale Actor',
        selectedOfferId: null,
        commandsBlocked: false,
      },
    })
    const duration = performance.now() - startedAt

    expect(wrapper.findAll('.encounter-offer-card')).toHaveLength(budgets.scenarios.actionDock.renderBatchSize)
    expect(wrapper.text()).toContain('80 of 512 shown')
    expect(duration).toBeLessThan(budgets.profiles.lowerEndLaptop.initialRenderTargetMs)

    await wrapper.get('.encounter-action-dock__more').trigger('click')
    expect(wrapper.findAll('.encounter-offer-card')).toHaveLength(160)
    expect(wrapper.text()).toContain('160 of 512 shown')
  })
})
