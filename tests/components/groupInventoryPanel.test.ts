/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import GroupInventoryPanel from '~/components/inventory/GroupInventoryPanel.vue'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { GroupInventoryItemActorOptionV1 } from '#shared/itemAutomation/groupInventoryItemActions'

const IconStub = defineComponent({
  template: '<span aria-hidden="true" />',
})

const NameCellStub = defineComponent({
  name: 'TrainerInventoryItemNameCell',
  props: {
    modelValue: { type: String, default: '' },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: '' },
  },
  emits: ['commit'],
  template: `
    <button
      type="button"
      class="name-cell-stub"
      :data-options-count="options.length"
      :data-placeholder="placeholder"
      @click="$emit('commit', 'Potion')"
    >
      {{ modelValue || placeholder }}
    </button>
  `,
})

const EditableCellStub = defineComponent({
  name: 'EditableCell',
  props: {
    modelValue: { type: [String, Number], default: undefined },
    type: { type: String, default: 'text' },
    min: { type: Number, default: undefined },
    placeholder: { type: String, default: '' },
    multiline: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      type="button"
      class="editable-cell-stub"
      :data-type="type"
      :data-min="min ?? ''"
      :data-placeholder="placeholder"
      :data-multiline="multiline ? 'true' : 'false'"
      @click="$emit('update:modelValue', 7)"
    >
      {{ modelValue ?? placeholder ?? '—' }}
    </button>
  `,
})

const mountGlobal = {
  stubs: {
    EditableCell: EditableCellStub,
    TrainerInventoryItemNameCell: NameCellStub,
    PhPlus: IconStub,
    PhX: IconStub,
    InventoryHistoryPanel: defineComponent({ template: '<aside class="history-stub" />' }),
  },
}

const groupInventoryFixture = (): GroupInventoryDocument => {
  const document = createDefaultGroupInventoryDocument({ now: 1_700_000_000_000 })
  return {
    ...document,
    revision: 3,
    money: 1250,
    notes: 'Shared supplies are kept at the lodge.',
    inventory: {
      ...document.inventory,
      keyItems: [
        { id: 'map-row', name: 'Town Map', description: 'Shows the local trails.' },
      ],
      pokemonItems: [
        { id: 'potion-row', name: 'Potion', qty: 2, cost: '$200', description: 'Heals 20 Hit Points' },
      ],
      equipment: [
        { id: 'boots-row', name: 'Heavy Boots', slot: 'Feet', cost: '$500', description: 'Trail gear.' },
      ],
    },
  }
}

const transferOffer = (input: {
  sourceKind: 'group-inventory' | 'trainer-inventory'
  item: string
  container: string
  sourceHex: string
  destinationKind: 'trainer-inventory' | 'group-inventory'
  destination: string
}): InventoryActionOfferV1 => ({
  schemaVersion: 1,
  offerId: `inventory-action-offer:v1:${input.sourceHex.repeat(32)}`,
  action: 'transfer',
  label: 'Transfer',
  source: {
    sourceSelectionId: `inventory-source:v1:${input.sourceHex.repeat(32)}`,
    locationKind: input.sourceKind,
    containerLabel: input.container,
    section: 'pokemonItems',
    sectionLabel: 'Pokémon Items',
    rowLabel: 'Row 1',
    itemLabel: input.item,
    canonicalItemId: input.item,
    availableQuantity: 2,
    itemForm: 'stack',
  },
  authority: {
    requiredRole: 'player-or-gm',
    checks: [{ kind: 'authenticated-session', label: 'Signed in', satisfied: true }],
  },
  revisionRequirements: [{
    requirementId: `inventory-revision:v1:${input.sourceHex.repeat(32)}`,
    resourceKind: 'source-container',
    label: 'Source revision',
    expectedRevision: input.sourceKind === 'group-inventory' ? 3 : 8,
  }],
  quantity: { mode: 'bounded', minimum: 1, maximum: 2, defaultValue: 1, unitLabel: 'items' },
  destination: {
    mode: 'required',
    allowedKinds: ['trainer-inventory', 'group-inventory'],
    rules: ['Current authority is rechecked.'],
    options: [{
      destinationId: `inventory-destination:v1:${input.sourceHex.repeat(32)}`,
      kind: input.destinationKind,
      label: input.destination,
      description: 'Moves exact custody.',
      enabled: true,
      unavailableReason: null,
      revisionRequirements: [{
        requirementId: `inventory-revision:v1:${input.sourceHex === 'a' ? 'b'.repeat(32) : 'c'.repeat(32)}`,
        resourceKind: 'destination-container',
        label: 'Destination revision',
        expectedRevision: input.destinationKind === 'group-inventory' ? 3 : 8,
      }],
    }],
  },
  consequences: [{ kind: 'inventory-move', label: 'The selected quantity moves between inventories.', reversibility: 'reversible' }],
  confirmation: { mode: 'action-submit', label: 'Transfer exact quantity.', optionId: null },
  execution: { mode: 'command', handoff: 'inventory-transfer', href: null },
  enabled: true,
  unavailableReason: null,
})

const itemActor = (): GroupInventoryItemActorOptionV1 => ({
  actorSelectionId: `group-item-actor:v1:${'e'.repeat(32)}`,
  label: 'Ash', revision: 8, selected: true,
})
const groupItemUseOffer = (): SheetItemActionOfferV1 => ({
  schemaVersion: 1,
  offerId: `sheet-item-offer:v1:${'f'.repeat(32)}`,
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', revision: 8, label: 'Ash', href: '/sheets/trainers/ash' },
  source: {
    sourceSelectionId: `inventory-source:v1:${'e'.repeat(32)}`,
    containerKind: 'group', containerLabel: 'Group inventory', canonicalId: 'Potion', displayName: 'Potion',
    section: 'pokemonItems', sectionLabel: 'Pokémon Items', rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
  },
  context: 'sheet', description: 'Restore Hit Points.', timingLabel: 'Outside encounter', costs: [],
  acceptanceNotice: 'Consumes 1 only when accepted.', availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use', label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Potion' },
  ],
  targeting: {
    requirementId: 'target', minimum: 1, maximum: 1,
    options: [{
      targetId: 'sheet-target:v1:pokemon:pikachu', sheetKind: 'pokemon', sheetSlug: 'pikachu',
      label: 'Pikachu', kindLabel: 'Pokémon', summary: 'HP 7 / 30', description: 'Restore 20 HP.',
      href: '/sheets/pikachu', enabled: true, unavailableReason: null,
      previewFacts: [{ label: 'HP after use', value: '7 → 27', tone: 'positive' }], choices: [],
    }],
  },
})
const groupSourceOffer = () => transferOffer({
  sourceKind: 'group-inventory', item: 'Potion', container: 'Group inventory', sourceHex: 'a',
  destinationKind: 'trainer-inventory', destination: 'Ash · Pokémon Items',
})
const trainerSourceOffer = () => transferOffer({
  sourceKind: 'trainer-inventory', item: 'Antidote', container: 'Ash inventory', sourceHex: 'd',
  destinationKind: 'group-inventory', destination: 'Group inventory · Pokémon Items',
})
const groupStackOffer = (action: 'split' | 'merge' | 'discard', enabled = true): InventoryActionOfferV1 => {
  const base = groupSourceOffer()
  return {
    ...base,
    offerId: `inventory-action-offer:v1:${(action === 'split' ? '5' : action === 'merge' ? '6' : '7').repeat(32)}`,
    action,
    label: action[0]!.toUpperCase() + action.slice(1),
    authority: {
      requiredRole: 'gm',
      checks: [{ kind: 'gm-role', label: 'GM shared-inventory authority', satisfied: enabled }],
    },
    quantity: action === 'merge'
      ? { mode: 'whole-stack', minimum: 2, maximum: 2, defaultValue: 2, unitLabel: 'items' }
      : { mode: 'bounded', minimum: 1, maximum: action === 'split' ? 1 : 2, defaultValue: 1, unitLabel: 'items' },
    destination: action === 'merge'
      ? {
          mode: 'required', allowedKinds: ['same-container'], rules: ['Equal metadata only.'],
          options: [{
            destinationId: `inventory-destination:v1:${'8'.repeat(32)}`,
            kind: 'same-container', label: 'Pokémon Items · Row 2 · Potion', description: 'Keeps Row 2.',
            enabled: true, unavailableReason: null, revisionRequirements: [],
          }],
        }
      : { mode: action === 'split' ? 'server-determined' : 'none', allowedKinds: action === 'split' ? ['same-container'] : [], rules: [], options: [] },
    consequences: [{
      kind: action === 'discard' ? 'discard' : 'stack-shape',
      label: action === 'discard' ? 'The selected quantity is permanently removed.' : 'Stack shape changes.',
      reversibility: action === 'discard' ? 'irreversible' : 'reversible',
    }],
    confirmation: action === 'discard'
      ? {
          mode: 'explicit-choice',
          label: 'I understand these items cannot be recovered through ordinary inventory actions.',
          optionId: `inventory-confirmation:v1:${'9'.repeat(32)}`,
        }
      : { mode: 'action-submit', label: 'Submit stack action.', optionId: null },
    execution: { mode: 'command', handoff: 'inventory-stack-operation', href: null },
    enabled,
    unavailableReason: enabled ? null : { code: 'authority.unavailable', label: 'Only a GM can reorganize or discard shared inventory stacks.' },
  }
}

describe('GroupInventoryPanel', () => {
  it('renders money, section counts, and read-only rows from the authoritative document', async () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
      },
      global: mountGlobal,
    })

    expect(wrapper.find('[aria-label="Shared party inventory"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Group inventory summary"]').text()).toContain('$1,250')
    expect(wrapper.findAll('.inventory-subtab-count').map((count) => count.text())).toEqual(['1', '1', '0', '0', '0', '1'])
    expect(wrapper.find('.row-add').exists()).toBe(false)
    expect(wrapper.find('.row-remove').exists()).toBe(false)
    expect(wrapper.find('.name-cell-stub').exists()).toBe(false)
    expect(wrapper.find('.editable-cell-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('Town Map')
    expect(wrapper.text()).toContain('Shared supplies are kept at the lodge.')

    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')

    expect(wrapper.find('.block-title').text()).toContain('Pokémon Items')
    expect(wrapper.text()).toContain('Potion')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Qty',
      'Cost',
      'Description',
    ])

    await wrapper.findAll('.inventory-subtab')[5]?.trigger('click')

    expect(wrapper.find('.block-title').text()).toContain('Equipment')
    expect(wrapper.text()).toContain('Heavy Boots')
    expect(wrapper.text()).toContain('Feet')
    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Slot',
      'Cost',
      'Description',
    ])
  })

  it('lets GMs edit money and manage rows before emitting a save request', async () => {
    const document = groupInventoryFixture()
    const wrapper = mount(GroupInventoryPanel, {
      attachTo: globalThis.document.body,
      props: {
        document,
        canEdit: true,
        isDirty: true,
        saveStatus: 'idle',
      },
      global: mountGlobal,
    })

    expect(wrapper.find('[aria-label="Shared inventory save controls"]').exists()).toBe(true)
    const moneyInput = wrapper.find('.group-inventory-panel__money-editor input')
    expect((moneyInput.element as HTMLInputElement).value).toBe('1250')

    await moneyInput.setValue('1500')
    expect(document.money).toBe(1500)

    await wrapper.find('.row-add').trigger('click')
    await nextTick()
    await nextTick()
    expect(document.inventory.keyItems).toHaveLength(2)
    expect(document.inventory.keyItems?.[1]).toMatchObject({ name: '', qty: 1 })
    expect(document.inventory.keyItems?.[1]?.id).toMatch(/^group-item-/)

    const nameCells = wrapper.findAll<HTMLButtonElement>('.name-cell-stub')
    expect(globalThis.document.activeElement).toBe(nameCells[nameCells.length - 1]!.element)
    expect(wrapper.get('.inventory-row-announcement').text()).toContain('Added a blank row to Key Items.')
    await nameCells[nameCells.length - 1]?.trigger('click')
    expect(document.inventory.keyItems?.[1]).toMatchObject({
      name: 'Potion',
      qty: 1,
      cost: '$200',
    })

    const removeButtons = wrapper.findAll('.row-remove')
    await removeButtons[removeButtons.length - 1]?.trigger('click')
    await nextTick()
    await nextTick()
    expect(document.inventory.keyItems).toHaveLength(1)
    expect(globalThis.document.activeElement).toBe(wrapper.get('.name-cell-stub').element)
    expect(wrapper.get('.inventory-row-announcement').text()).toContain('Removed Potion from Key Items.')

    await wrapper.find('.group-inventory-panel__save-button').trigger('click')
    expect(wrapper.emitted('save')).toEqual([[]])
    wrapper.unmount()
  })

  it('opens the shared action decision for an exact group row without exposing or mutating its row identity', async () => {
    const document = groupInventoryFixture()
    const offer = groupSourceOffer()
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document,
        actionOffers: [offer, trainerSourceOffer()],
        actionCanBegin: true,
        selectedActionOffer: offer,
        selectedDestinationId: offer.destination.options[0]!.destinationId,
        selectedQuantity: 1,
        actionStatus: 'ready',
      },
      global: mountGlobal,
    })

    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')
    await wrapper.find('.group-inventory-panel__row-transfer-button').trigger('click')

    expect(wrapper.emitted('openAction')).toEqual([[offer]])
    const decision = wrapper.find('.inventory-action-decision')
    expect(decision.text()).toContain('Transfer items')
    expect(decision.text()).toContain('Group inventory · Pokémon Items · Row 1')
    expect(decision.text()).toContain('Ash · Pokémon Items')
    expect(decision.text()).toContain('Source and destination revisions are rechecked')
    expect(decision.text()).not.toContain('potion-row')
    await decision.find('input[type="number"]').setValue('2')
    expect(wrapper.emitted('setQuantity')).toEqual([[2]])
    await decision.find('.inventory-action-button--primary').trigger('click')
    expect(wrapper.emitted('confirmAction')).toEqual([[]])
    expect(document.inventory.pokemonItems?.[0]).toMatchObject({ id: 'potion-row', name: 'Potion', qty: 2 })
  })

  it('moves focus into an opened decision and restores it to the exact row action on cancel', async () => {
    const offer = groupSourceOffer()
    const wrapper = mount(GroupInventoryPanel, {
      attachTo: document.body,
      props: {
        document: groupInventoryFixture(),
        actionOffers: [offer],
        actionCanBegin: true,
      },
      global: mountGlobal,
    })
    await wrapper.findAll('.inventory-subtab')[1]!.trigger('click')
    const origin = wrapper.get<HTMLButtonElement>('.group-inventory-panel__row-transfer-button')
    origin.element.focus()
    await origin.trigger('click')
    await wrapper.setProps({
      selectedActionOffer: offer,
      selectedDestinationId: offer.destination.options[0]!.destinationId,
      actionStatus: 'ready',
    })
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('#inventory-action-decision-title').element)
    expect(wrapper.get('.inventory-selected-source-label').text()).toBe('Selected source')
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click')
    await nextTick()
    await nextTick()
    expect(wrapper.emitted('cancelAction')).toEqual([[]])
    expect(document.activeElement).toBe(origin.element)
    wrapper.unmount()
  })

  it('selects an acting Trainer and opens exact shared item use without exposing the stable row identity', async () => {
    const useOffer = groupItemUseOffer()
    const actor = itemActor()
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        itemActors: [actor],
        selectedItemActorId: actor.actorSelectionId,
        itemActionOffers: [useOffer],
        selectedItemOffer: useOffer,
        itemSelectedTargetIds: ['sheet-target:v1:pokemon:pikachu'],
        itemStatus: 'ready',
        itemCanBegin: true,
      },
      global: mountGlobal,
    })
    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')
    const actorSelect = wrapper.get('.group-inventory-panel__actor-picker select')
    expect((actorSelect.element as HTMLSelectElement).value).toBe(actor.actorSelectionId)
    const useButton = wrapper.get('.group-inventory-panel__row-use-button')
    expect(useButton.attributes('title')).toContain('Ash')
    await useButton.trigger('click')
    expect(wrapper.emitted('openItemUse')).toEqual([[useOffer]])
    const decision = wrapper.get('.sheet-item-decision')
    expect(decision.text()).toContain('Potion')
    expect(decision.text()).toContain('Use from shared inventory')
    expect(decision.text()).toContain('Group inventory · Pokémon Items · Row 1')
    expect(decision.text()).toContain('Acting Trainer')
    expect(decision.text()).toContain('Shared item custody')
    expect(decision.text()).toContain('Consumes 1 only when accepted.')
    expect(decision.text()).toContain('1 item is reserved on this exact shared row.')
    expect(decision.text()).toContain('Pikachu')
    expect(decision.text()).not.toContain('potion-row')
    await decision.get('[data-sheet-item-target-index="0"]').trigger('click')
    expect(wrapper.emitted('chooseItemTarget')).toEqual([['sheet-target:v1:pokemon:pikachu']])
  })

  it('opens GM stack controls in the same inline anatomy and requires explicit discard confirmation', async () => {
    const discard = groupStackOffer('discard')
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        actionOffers: [groupSourceOffer(), groupStackOffer('split'), groupStackOffer('merge'), discard],
        actionCanBegin: true,
        selectedActionOffer: discard,
        selectedDestinationId: null,
        selectedQuantity: 2,
        selectedConfirmationOptionId: discard.confirmation.optionId,
        actionStatus: 'ready',
      },
      global: mountGlobal,
    })
    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')
    const rowActions = wrapper.get('[aria-label="Row 1 inventory actions"]')
    expect(rowActions.text().replace(/\s+/gu, '')).toContain('TransferSplitMergeDiscard')
    await rowActions.findAll('button').find(button => button.text() === 'Discard')!.trigger('click')
    expect(wrapper.emitted('openAction')?.[0]?.[0]).toEqual(discard)
    const decision = wrapper.get('.inventory-action-decision')
    expect(decision.text()).toContain('Discard items')
    expect(decision.text()).toContain('Irreversible')
    expect(decision.text()).not.toContain('potion-row')
    await decision.get('input[type="checkbox"]').setValue(false)
    expect(wrapper.emitted('setConfirmation')).toEqual([[false]])
  })

  it('keeps shared stack controls visible but disabled with a textual GM-only reason for players', async () => {
    const discard = groupStackOffer('discard', false)
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        actionOffers: [groupSourceOffer(), discard],
        actionCanBegin: true,
      },
      global: mountGlobal,
    })
    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')
    const button = wrapper.findAll('.group-inventory-panel__row-stack-button').find(row => row.text() === 'Discard')!
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('Only a GM')
  })

  it('selects a safe server-issued Trainer source before using the same decision anatomy', async () => {
    const offer = trainerSourceOffer()
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        actionOffers: [groupSourceOffer(), offer],
        actionCanBegin: true,
        selectedActionOffer: offer,
        selectedDestinationId: offer.destination.options[0]!.destinationId,
        actionStatus: 'ready',
      },
      global: mountGlobal,
    })
    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')
    await wrapper.find('.group-inventory-panel__transfer-button').trigger('click')
    expect(wrapper.emitted('openAction')).toEqual([[offer]])
    expect(wrapper.find('.group-inventory-panel__source-picker').text()).toContain(
      'Ash inventory · Row 1 · Antidote · qty 2',
    )
    expect(wrapper.find('.inventory-action-decision').text()).toContain('Group inventory · Pokémon Items')
  })

  it('shows stale-action feedback and keeps the explicit refresh path', async () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        actionOffers: [groupSourceOffer()],
        actionStatus: 'conflict',
        actionMessage: 'Group inventory main changed before the transfer could be persisted; reload before transferring.',
      },
      global: mountGlobal,
    })

    expect(wrapper.find('[role="alert"]').text()).toContain('reload before transferring')
    const refresh = wrapper.findAll('.group-inventory-panel__reload-button')
      .find(button => button.text() === 'Refresh actions')!
    await refresh.trigger('click')
    expect(wrapper.emitted('refreshActions')).toEqual([[]])
  })

  it('shows conflict feedback with an explicit reload action', async () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        canEdit: true,
        isDirty: true,
        saveStatus: 'conflict',
        saveError: 'Group inventory main has changed; reload before saving.',
      },
      global: mountGlobal,
    })

    expect(wrapper.find('[role="alert"]').text()).toContain('reload before saving')
    await wrapper.find('.group-inventory-panel__reload-button').trigger('click')
    expect(wrapper.emitted('reloadAfterConflict')).toEqual([[]])
  })

  it('announces an accessible empty state when every section is empty', () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: createDefaultGroupInventoryDocument({ now: 1_700_000_000_000 }),
      },
      global: mountGlobal,
    })

    const emptyState = wrapper.find('[role="status"]')
    expect(emptyState.exists()).toBe(true)
    expect(emptyState.text()).toContain('No shared inventory rows yet.')
    expect(wrapper.findAll('.inventory-subtab-count').map((count) => count.text())).toEqual(['0', '0', '0', '0', '0', '0'])
  })
})
