/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import InventoryActionDecision from '~/components/inventory/InventoryActionDecision.vue'
import TrainerInventoryRowItemActions from '~/components/sheets/TrainerInventoryRowItemActions.vue'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'

const hex = (value: string) => value.repeat(32)
const actionOffer = (action: 'equip' | 'give' | 'transfer' | 'inspect'): InventoryActionOfferV1 => ({
  schemaVersion: 1,
  offerId: `inventory-action-offer:v1:${hex(action === 'give' ? '1' : action === 'equip' ? '2' : action === 'transfer' ? '3' : '4')}`,
  action,
  label: action[0]!.toUpperCase() + action.slice(1),
  source: {
    sourceSelectionId: `inventory-source:v1:${hex('a')}`,
    locationKind: 'trainer-inventory', containerLabel: 'Trainer inventory',
    section: 'equipment', sectionLabel: 'Equipment', rowLabel: 'Row 1',
    itemLabel: 'Re-Breather', canonicalItemId: 'Re-Breather', availableQuantity: 1, itemForm: 'whole-item',
  },
  authority: {
    requiredRole: 'player-or-gm',
    checks: [{ kind: 'authenticated-session', label: 'Authenticated campaign session', satisfied: true }],
  },
  revisionRequirements: [{
    requirementId: `inventory-revision:v1:${hex('b')}`,
    resourceKind: 'source-container', label: 'Trainer inventory revision', expectedRevision: 3,
  }],
  quantity: action === 'inspect'
    ? { mode: 'none', minimum: null, maximum: null, defaultValue: null, unitLabel: null }
    : action === 'transfer'
      ? { mode: 'bounded', minimum: 1, maximum: 1, defaultValue: 1, unitLabel: 'whole item' }
      : { mode: 'fixed', minimum: 1, maximum: 1, defaultValue: 1, unitLabel: 'whole item' },
  destination: action === 'inspect'
    ? { mode: 'none', allowedKinds: [], rules: [], options: [] }
    : {
        mode: 'required',
        allowedKinds: action === 'give' ? ['pokemon-equipment'] : action === 'equip' ? ['trainer-equipment'] : ['trainer-inventory', 'group-inventory'],
        rules: ['Choose one current destination.'],
        options: action === 'give' ? [
          {
            destinationId: `inventory-destination:v1:${hex('c')}`, kind: 'pokemon-equipment',
            label: 'Pikachu · Held Item', description: 'Moves one whole item.', enabled: true, unavailableReason: null,
            revisionRequirements: [
              { requirementId: `inventory-revision:v1:${hex('d')}`, resourceKind: 'destination-sheet', label: 'Pokémon destination revision', expectedRevision: 2 },
              { requirementId: `inventory-revision:v1:${hex('e')}`, resourceKind: 'destination-equipment', label: 'Pokémon equipment revision', expectedRevision: 0 },
            ],
          },
          {
            destinationId: `inventory-destination:v1:${hex('f')}`, kind: 'pokemon-equipment',
            label: 'Eevee · Held Item', description: 'Held Item is occupied.', enabled: false,
            unavailableReason: { code: 'equipment.slot-occupied', label: 'Held Item is occupied.' },
            revisionRequirements: [],
          },
        ] : [{
          destinationId: `inventory-destination:v1:${hex('c')}`,
          kind: action === 'equip' ? 'trainer-equipment' : 'group-inventory',
          label: action === 'equip' ? 'Ash · compatible gear slot' : 'Group inventory',
          description: 'Current destination.', enabled: true, unavailableReason: null, revisionRequirements: [],
        }],
      },
  consequences: action === 'inspect'
    ? [{ kind: 'none', label: 'No campaign state changes.', reversibility: 'reversible' }]
    : action === 'transfer'
      ? [{ kind: 'inventory-move', label: 'One whole item moves to group inventory.', reversibility: 'reversible' }]
      : [
          { kind: 'inventory-move', label: 'One whole item leaves Trainer inventory.', reversibility: 'reversible' },
          { kind: 'equipment-custody', label: 'The same whole item enters equipment custody.', reversibility: 'reversible' },
        ],
  confirmation: action === 'inspect'
    ? { mode: 'none', label: null, optionId: null }
    : { mode: 'action-submit', label: 'Review and submit.', optionId: null },
  execution: action === 'inspect'
    ? { mode: 'navigation', handoff: 'inspect-navigation', href: '/items/Re-Breather' }
    : { mode: 'command', handoff: action === 'transfer' ? 'inventory-transfer' : 'equipment-operation', href: null },
  enabled: true,
  unavailableReason: null,
})

const stackActionOffer = (action: 'split' | 'merge' | 'discard'): InventoryActionOfferV1 => {
  const base = actionOffer('transfer')
  return {
    ...base,
    offerId: `inventory-action-offer:v1:${hex(action === 'split' ? '5' : action === 'merge' ? '6' : '7')}`,
    action,
    label: action[0]!.toUpperCase() + action.slice(1),
    source: {
      ...base.source,
      section: 'medicalKit', sectionLabel: 'Medical Kit', itemLabel: 'Potion',
      canonicalItemId: 'Potion', availableQuantity: 5, itemForm: 'stack',
    },
    quantity: action === 'merge'
      ? { mode: 'whole-stack', minimum: 5, maximum: 5, defaultValue: 5, unitLabel: 'items' }
      : { mode: 'bounded', minimum: 1, maximum: action === 'split' ? 4 : 5, defaultValue: 1, unitLabel: 'items' },
    destination: action === 'merge'
      ? {
          mode: 'required', allowedKinds: ['same-container'], rules: ['Exact metadata only.'],
          options: [{
            destinationId: `inventory-destination:v1:${hex('8')}`, kind: 'same-container',
            label: 'Medical Kit · Row 2 · Potion', description: 'Keeps Row 2.', enabled: true,
            unavailableReason: null, revisionRequirements: [],
          }],
        }
      : {
          mode: action === 'split' ? 'server-determined' : 'none',
          allowedKinds: action === 'split' ? ['same-container'] : [], rules: [], options: [],
        },
    consequences: [{
      kind: action === 'discard' ? 'discard' : 'stack-shape',
      label: action === 'discard'
        ? 'The selected quantity is permanently removed from this inventory.'
        : 'The stack shape changes without changing item identity.',
      reversibility: action === 'discard' ? 'irreversible' : 'reversible',
    }],
    confirmation: action === 'discard'
      ? {
          mode: 'explicit-choice',
          label: 'I understand these items cannot be recovered through ordinary inventory actions.',
          optionId: `inventory-confirmation:v1:${hex('9')}`,
        }
      : { mode: 'action-submit', label: `${action === 'split' ? 'Create' : 'Merge'} this stack.`, optionId: null },
    execution: { mode: 'command', handoff: 'inventory-stack-operation', href: null },
  }
}

const itemOffer: SheetItemActionOfferV1 = {
  schemaVersion: 1, offerId: 'offer:sheet-item:re-breather',
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', revision: 3, label: 'Ash', href: '/sheets/trainers/ash' },
  source: {
    sourceSelectionId: `inventory-source:v1:${hex('a')}`, containerKind: 'trainer', containerLabel: 'Trainer inventory',
    canonicalId: 'Re-Breather', displayName: 'Re-Breather', section: 'equipment', sectionLabel: 'Equipment',
    rowIndex: 0, rowLabel: 'Row 1', quantity: 1,
  },
  context: 'sheet', description: null, timingLabel: 'Outside encounter', costs: [],
  acceptanceNotice: 'No item use will be submitted.', availability: { enabled: false, unavailableReason: { code: 'action.unsupported', label: 'Use unavailable.' } },
  actions: [
    { kind: 'use', label: 'Use', enabled: false, unavailableReason: { code: 'action.unsupported', label: 'Use unavailable.' }, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Re-Breather' },
  ],
  targeting: null,
}

const linkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }
afterEach(() => document.body.replaceChildren())

describe('unified inventory action components', () => {
  it('presents exact safe source, bounded destinations, consequences, and one commit action', async () => {
    const offer = actionOffer('give')
    const wrapper = mount(InventoryActionDecision, {
      attachTo: document.body,
      props: {
        offer, selectedDestinationId: offer.destination.options[0]!.destinationId,
        quantity: 1, status: 'ready', message: null, busy: false,
      },
    })
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('#inventory-action-decision-title').element)
    expect(wrapper.text()).toContain('Give whole item')
    expect(wrapper.text()).toContain('Trainer inventory · Equipment · Row 1')
    expect(wrapper.text()).toContain('Moves 1 whole item')
    expect(wrapper.text()).toContain('Pikachu · Held Item')
    expect(wrapper.text()).toContain('Held Item is occupied.')
    expect(wrapper.text()).toContain('Source and destination revisions are rechecked when submitted.')
    expect(wrapper.text()).not.toMatch(/inventory-(?:source|destination|revision)|profile_|sha256|operation/i)
    expect(wrapper.findAll('input[type="radio"]')[0]!.attributes('checked')).toBeDefined()
    expect(wrapper.findAll('input[type="radio"]')[1]!.attributes('disabled')).toBeDefined()
    const confirm = wrapper.findAll('button').find(button => button.text() === 'Give item')!
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('requires explicit non-colour confirmation before an irreversible bounded discard', async () => {
    const offer = stackActionOffer('discard')
    const wrapper = mount(InventoryActionDecision, {
      props: {
        offer,
        selectedDestinationId: null,
        selectedConfirmationOptionId: null,
        quantity: 2,
        status: 'ready',
        message: null,
        busy: false,
      },
    })
    expect(wrapper.text()).toContain('Discard items')
    expect(wrapper.text()).toContain('Trainer inventory · Medical Kit · Row 1')
    expect(wrapper.text()).toContain('Permanently removes 2 items')
    expect(wrapper.text()).toContain('5 currently available · 3 remain after acceptance')
    expect(wrapper.text()).toContain('Irreversible')
    expect(wrapper.text()).toContain('2 items will be permanently removed from this inventory.')
    expect(wrapper.text()).toContain('I understand these items cannot be recovered through ordinary inventory actions.')
    expect(wrapper.text()).not.toMatch(/inventory-(?:source|confirmation|revision)|operation|sha256/i)

    const confirmation = wrapper.get('input[type="checkbox"]')
    const submit = wrapper.findAll('button').find(button => button.text() === 'Discard 2 items')!
    expect(submit.attributes('disabled')).toBeDefined()
    await confirmation.setValue(true)
    expect(wrapper.emitted('setConfirmation')).toEqual([[true]])
    await wrapper.setProps({ selectedConfirmationOptionId: offer.confirmation.optionId })
    expect(submit.attributes('disabled')).toBeUndefined()
    await submit.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('makes exact retry dominant and removes cancellation while uncertain', () => {
    const wrapper = mount(InventoryActionDecision, {
      props: {
        offer: actionOffer('give'), selectedDestinationId: null, quantity: 1,
        status: 'uncertain', message: 'The result is uncertain.', busy: false,
      },
    })
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Retry exact action'])
    expect(wrapper.text()).not.toContain('Cancel')
  })

  it('shows reserved-stack authority as text rather than hiding it in a disabled-button tooltip', () => {
    const split = stackActionOffer('split')
    const reserved = {
      ...split,
      enabled: false,
      unavailableReason: {
        code: 'stack.reserved',
        label: 'Pending item decisions leave no quantity available to split.',
      },
    } satisfies InventoryActionOfferV1
    const wrapper = mount(TrainerInventoryRowItemActions, {
      props: {
        offer: itemOffer,
        inventoryOffers: [reserved],
        canBegin: true,
        busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('Reserved: Pending item decisions leave no quantity available to split.')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('routes Equip, Give, Transfer, and Inspect through one compact row anatomy', async () => {
    const offers = ['equip', 'give', 'transfer', 'inspect'].map(action => actionOffer(action as 'equip' | 'give' | 'transfer' | 'inspect'))
    const wrapper = mount(TrainerInventoryRowItemActions, {
      props: {
        offer: itemOffer, inventoryOffers: offers,
        selectedInventoryOfferId: offers[1]!.offerId, canBegin: true, busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('EquipGiveTransferInspect')
    const give = wrapper.findAll('button').find(button => button.text() === 'Give')!
    expect(give.attributes('aria-pressed')).toBe('true')
    await give.trigger('click')
    expect(wrapper.emitted('action')?.[0]?.[0]).toMatchObject({ action: 'give' })
    expect(wrapper.get('a').attributes('href')).toBe('/items/Re-Breather')
  })

  it('keeps ordinary and stack actions in two scan-friendly groups with only the selected discard emphasized', async () => {
    const discard = stackActionOffer('discard')
    const offers = [actionOffer('transfer'), actionOffer('inspect'), stackActionOffer('split'), stackActionOffer('merge'), discard]
    const wrapper = mount(TrainerInventoryRowItemActions, {
      props: {
        offer: itemOffer,
        inventoryOffers: offers,
        selectedInventoryOfferId: discard.offerId,
        canBegin: true,
        busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    const groups = wrapper.findAll('[role="group"]')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.text()).toContain('TransferInspect')
    expect(groups[0]!.text()).not.toContain('Split')
    expect(groups[1]!.text()).toContain('SplitMergeDiscard')
    const discardButton = groups[1]!.findAll('button').find(button => button.text() === 'Discard')!
    expect(discardButton.classes()).toContain('is-selected')
    expect(discardButton.attributes('aria-pressed')).toBe('true')
    await discardButton.trigger('click')
    expect(wrapper.emitted('action')?.[0]?.[0]).toEqual(discard)
  })
})
