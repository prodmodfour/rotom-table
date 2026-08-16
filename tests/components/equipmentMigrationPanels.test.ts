/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import PokemonEquipmentPanel from '~/components/sheets/PokemonEquipmentPanel.vue'
import TrainerEquippedGearPanel from '~/components/sheets/TrainerEquippedGearPanel.vue'
import {
  createEmptySheetEquipmentState,
  parseSheetEquipmentStateForOwner,
  projectSheetEquipmentStateForPlayer,
  type EquipmentOwnerKind,
  type EquipmentSlotId,
} from '#shared/itemAutomation/equipment'

const ItemSpriteStub = defineComponent({
  name: 'ItemSprite',
  props: { item: { type: String, default: '' } },
  template: '<span class="item-sprite-stub" :data-item="item" />',
})
const EditableCellStub = defineComponent({
  name: 'EditableCell',
  template: '<span class="editable-cell-stub" />',
})

const unresolvedState = (kind: EquipmentOwnerKind, slug: string, slotId: EquipmentSlotId) => (
  parseSheetEquipmentStateForOwner({
    ...createEmptySheetEquipmentState({ ownerKind: kind, ownerSlug: slug }),
    unresolved: [{
      issueId: `equipment-issue:v1:${'4'.repeat(32)}`,
      slotId,
      legacyDisplayName: 'Quick Claw',
      reason: 'ambiguous-source',
      candidateCanonicalItemIds: ['Quick Claw'],
      candidateSourceInstanceIds: [
        'item-instance:trainer:ash:equipment:private-row-one',
        'item-instance:trainer:ash:equipment:private-row-two',
      ],
    }],
  }, { kind, slug })
)

const migratedTrainerState = () => parseSheetEquipmentStateForOwner({
  ...createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
  slots: [
    { slotId: 'mainHand', instanceId: null },
    { slotId: 'offHand', instanceId: null },
    { slotId: 'head', instanceId: null },
    { slotId: 'body', instanceId: `equipped-item:v1:${'5'.repeat(32)}` },
    { slotId: 'feet', instanceId: null },
    { slotId: 'accessory', instanceId: null },
  ],
  instances: [{
    instanceId: `equipped-item:v1:${'5'.repeat(32)}`,
    revision: 0,
    canonicalItemId: 'Light Armor',
    canonicalRecordSha256: 'a'.repeat(64),
    equipmentDefinitionSha256: null,
    source: {
      kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment',
      rowId: 'private-armor-row',
      sourceInstanceId: 'item-instance:trainer:ash:equipment:private-armor-row',
      sourceRevision: 7, quantity: 1,
    },
    configuration: null,
    activity: {
      status: 'inactive',
      reasons: [{ code: 'equipment.definition-pending', sourceId: 'equipment-migration:v1:fixture' }],
    },
    equippedByOperationId: 'equipment-migration:v1:fixture',
    equippedAt: 100,
  }],
  unresolved: [],
}, { kind: 'trainer', slug: 'ash' })

const mountOptions = {
  global: { stubs: { ItemSprite: ItemSpriteStub, EditableCell: EditableCellStub } },
}

describe('equipment migration sheet panels', () => {
  it('shows GM-safe Trainer issue details and never renders raw candidate source identities', () => {
    const state = unresolvedState('trainer', 'ash', 'accessory')
    const wrapper = mount(TrainerEquippedGearPanel, {
      props: { equipmentSlots: { accessory: 'Quick Claw' }, equipmentState: state },
      ...mountOptions,
    })

    expect(wrapper.text()).toContain('Equipment review required')
    expect(wrapper.text()).toContain('Accessory · Quick Claw')
    expect(wrapper.text()).toContain('More than one inventory source could match. 2 candidate sources.')
    expect(wrapper.text()).toContain('Review required')
    expect(wrapper.html()).not.toContain('private-row-one')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('[contenteditable="true"]').exists()).toBe(false)
  })

  it('shows only aggregate unresolved state in a player projection', () => {
    const projection = projectSheetEquipmentStateForPlayer(unresolvedState('trainer', 'ash', 'accessory'))
    const wrapper = mount(TrainerEquippedGearPanel, {
      props: { equipmentSlots: {}, equipmentProjection: projection },
      ...mountOptions,
    })

    expect(wrapper.text()).toContain('1 legacy choice is inactive')
    expect(wrapper.text()).not.toContain('Quick Claw')
    expect(wrapper.text()).not.toContain('candidate source')
  })

  it('renders a recovered Trainer source as explicitly inactive when its definition is unavailable', () => {
    const wrapper = mount(TrainerEquippedGearPanel, {
      props: { equipmentSlots: { body: 'Light Armor' }, equipmentState: migratedTrainerState() },
      ...mountOptions,
    })

    expect(wrapper.text()).toContain('Definition unavailable')
    expect(wrapper.text()).toContain('Light Armor')
    expect(wrapper.text()).toContain('Awaiting compatibility')
    expect(wrapper.html()).not.toContain('private-armor-row')
  })

  it('offers a keyboard-accessible whole-item return command without exposing provenance', async () => {
    const pending = migratedTrainerState()
    const state = parseSheetEquipmentStateForOwner({
      ...pending,
      instances: pending.instances.map(instance => ({
        ...instance,
        equipmentDefinitionSha256: 'b'.repeat(64),
        activity: { status: 'active', reasons: [] },
      })),
    }, { kind: 'trainer', slug: 'ash' })
    const wrapper = mount(TrainerEquippedGearPanel, {
      props: { equipmentSlots: {}, equipmentState: state, canManage: true },
      ...mountOptions,
    })
    const button = wrapper.get('button[aria-label="Return Light Armor from Body to inventory"]')
    expect(button.text()).toBe('Return')
    await button.trigger('click')
    expect(wrapper.emitted('unequip')).toEqual([[state.instances[0]!.instanceId]])
    expect(wrapper.html()).not.toContain('private-armor-row')
  })

  it('retires direct held-item text editing and surfaces the Pokémon GM migration issue', () => {
    const state = unresolvedState('pokemon', 'pikachu', 'held')
    const wrapper = mount(PokemonEquipmentPanel, {
      props: {
        sheet: {
          slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 10,
          items: { held: 'Quick Claw', extraItems: [] },
          weapon: {},
          equipmentState: state,
        },
        heldItemName: 'Quick Claw',
      },
      ...mountOptions,
    })

    expect(wrapper.text()).toContain('Held-item review required')
    expect(wrapper.text()).toContain('More than one inventory source could match. 2 candidate sources.')
    expect(wrapper.text()).toContain('Quick Claw')
    expect(wrapper.find('.held-item-value button').exists()).toBe(false)
    expect(wrapper.find('.held-item-value input').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('private-row-one')
  })
})
