/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import TrainerInventoryRowItemActions from '~/components/sheets/TrainerInventoryRowItemActions.vue'
import TrainerSheetItemDecision from '~/components/sheets/TrainerSheetItemDecision.vue'
import TrainerItemExtendedActionCard from '~/components/sheets/TrainerItemExtendedActionCard.vue'
import { sheetItemTargetId, type SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { ItemExtendedActionProjectionV1 } from '#shared/itemAutomation/extendedActions'

const targetId = sheetItemTargetId('pokemon', 'pikachu')
const offer = (targetEnabled = true): SheetItemActionOfferV1 => ({
  schemaVersion: 1,
  offerId: 'offer:sheet-item:potion',
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', revision: 3, label: 'Ash', href: '/sheets/trainers/ash' },
  source: {
    sourceSelectionId: `inventory-source:v1:${'1'.repeat(32)}`,
    containerKind: 'trainer', containerLabel: 'Trainer inventory',
    canonicalId: 'Potion', displayName: 'Potion', section: 'medicalKit', sectionLabel: 'Medical Kit',
    rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
  },
  context: 'sheet', description: 'Restores HP.', timingLabel: 'Outside encounter',
  costs: ['Consume 1 Potion'], acceptanceNotice: 'Consumes 1 when accepted.',
  availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use', label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Potion' },
  ],
  targeting: {
    requirementId: 'target', minimum: 1, maximum: 1,
    options: [{
      targetId, sheetKind: 'pokemon', sheetSlug: 'pikachu', label: 'Pikachu', kindLabel: 'Pokémon',
      summary: 'HP 7 / 35', description: 'Restores 20 HP', href: '/sheets/pikachu',
      enabled: targetEnabled,
      unavailableReason: targetEnabled ? null : { code: 'target.invalid', label: 'At full HP.' },
      previewFacts: targetEnabled ? [
        { label: 'HP after use', value: '7 → 27 HP', tone: 'positive' },
        { label: 'Restores', value: '+20 HP', tone: 'positive' },
      ] : [],
    }],
  },
})

const activity = (overrides: Partial<ItemExtendedActionProjectionV1> = {}): ItemExtendedActionProjectionV1 => ({
  schemaVersion: 1,
  activityId: 'item-activity:v1:00000000000000000000000000000001',
  revision: 0,
  status: 'in-progress',
  item: { canonicalId: 'First Aid Kit', label: 'First Aid Kit' },
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', label: 'Rook', href: '/sheets/trainers/ash' },
  target: {
    sheetKind: 'pokemon', sheetSlug: 'pikachu', label: 'Volt', href: '/sheets/pikachu',
    summary: 'HP 12 / 46', conditionLabels: ['Burned', 'Badly Poisoned'],
  },
  startedAtCampaignMinute: 4321,
  updatedAtCampaignMinute: 4321,
  completion: {
    costs: ['Medicine Education check', '1 AP on completion', 'Reusable kit'],
    sourceNotice: 'The kit remains in inventory after accepted completion.',
    safePendingNotice: 'No roll, AP, HP, condition, or inventory change has been applied yet.',
  },
  permissions: { canComplete: true, canInterrupt: true, unavailableReason: null },
  terminal: null,
  ...overrides,
})

const linkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

afterEach(() => document.body.replaceChildren())

describe('Trainer sheet item action components', () => {
  it('keeps Use and Inspect keyboard-reachable and exposes a visible server-authored unavailable reason', async () => {
    const wrapper = mount(TrainerInventoryRowItemActions, {
      props: { offer: offer(), canBegin: true, busy: false },
      global: { stubs: { NuxtLink: linkStub } },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons[0]?.text()).toContain('Use')
    expect(buttons[0]?.attributes('disabled')).toBeUndefined()
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('use')?.[0]?.[0]).toMatchObject({ offerId: 'offer:sheet-item:potion' })
    expect(wrapper.get('a').attributes('href')).toBe('/items/Potion')

    await wrapper.setProps({ canBegin: false })
    expect(wrapper.text()).toContain('Finish saving the Trainer sheet before using an item.')
    expect(wrapper.findAll('button')[0]?.attributes()).toHaveProperty('disabled')
    await wrapper.setProps({
      blockedReason: 'Inventory actions are locked until the retained result is resolved.',
    })
    expect(wrapper.text()).toContain('Inventory actions are locked until the retained result is resolved.')
    expect(wrapper.text()).not.toContain('Finish saving the Trainer sheet')
  })

  it('turns the active Extended Action source into a Resume control and blocks another Extended Action', async () => {
    const firstAidOffer: SheetItemActionOfferV1 = {
      ...offer(),
      source: { ...offer().source, canonicalId: 'First Aid Kit', displayName: 'First Aid Kit', quantity: 1 },
      timingLabel: 'Extended Action',
    }
    const wrapper = mount(TrainerInventoryRowItemActions, {
      props: { offer: firstAidOffer, canBegin: true, busy: false, resumeExtended: true },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.findAll('button')[0]?.text()).toContain('Resume')
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('use')).toHaveLength(1)
    await wrapper.setProps({ resumeExtended: false, extendedBlocked: true })
    expect(wrapper.text()).toContain('Finish or interrupt the current Extended Action')
    expect(wrapper.findAll('button')[0]?.attributes()).toHaveProperty('disabled')
  })

  it('offers an explicit setup repair for a legacy row missing stable identity', async () => {
    const base = offer()
    const identityOffer: SheetItemActionOfferV1 = {
      ...base,
      availability: {
        enabled: false,
        unavailableReason: { code: 'source.identity-required', label: 'Save this inventory row before using it.' },
      },
      actions: base.actions.map(action => action.kind === 'use'
        ? { ...action, enabled: false, unavailableReason: { code: 'source.identity-required', label: 'Save this inventory row before using it.' } }
        : action),
    }
    const wrapper = mount(TrainerInventoryRowItemActions, {
      props: { offer: identityOffer, canBegin: true, busy: false },
      global: { stubs: { NuxtLink: linkStub } },
    })
    const prepare = wrapper.findAll('button').find(button => button.text().includes('Prepare'))!
    expect(prepare.attributes('disabled')).toBeUndefined()
    await prepare.trigger('click')
    expect(wrapper.emitted('prepareIdentity')).toHaveLength(1)
    expect(wrapper.text()).toContain('Save this inventory row before using it.')
  })

  it('presents source, target selection, exact preview, acceptance boundary, focusable controls, and confirmation', async () => {
    const wrapper = mount(TrainerSheetItemDecision, {
      attachTo: document.body,
      props: {
        offer: offer(), selectedTargetIds: [], status: 'ready', message: null,
        acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('Use item')
    expect(wrapper.text()).toContain('Trainer inventory · Medical Kit · Row 1')
    expect(wrapper.text()).toContain('OwnerAsh')
    expect(wrapper.text()).toContain('Choose a target')
    expect(wrapper.text()).toContain('Select one projected target')
    const confirm = wrapper.findAll('button').find(button => button.text().includes('Confirm use'))!
    expect(confirm.attributes()).toHaveProperty('disabled')
    const target = wrapper.get('[role="radio"]')
    expect(target.attributes('aria-checked')).toBe('false')
    await target.trigger('click')
    expect(wrapper.emitted('chooseTarget')).toEqual([[targetId]])

    await wrapper.setProps({ selectedTargetIds: [targetId] })
    expect(wrapper.get('[role="radio"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.text()).toContain('Selected')
    expect(wrapper.text()).toContain('7 → 27 HP')
    expect(wrapper.text()).toContain('+20 HP')
    expect(wrapper.text()).toContain('Consumes 1 when accepted.')
    const enabledConfirm = wrapper.findAll('button').find(button => button.text().includes('Confirm use'))!
    expect(enabledConfirm.attributes('disabled')).toBeUndefined()
    await enabledConfirm.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.get('a').attributes('href')).toBe('/items/Potion')
  })

  it('supports roving arrow-key target selection in the projected radio group', async () => {
    const base = offer()
    const secondTargetId = sheetItemTargetId('trainer', 'ash')
    const keyboardOffer: SheetItemActionOfferV1 = {
      ...base,
      targeting: {
        ...base.targeting!,
        options: [
          ...base.targeting!.options,
          {
            ...base.targeting!.options[0]!, targetId: secondTargetId,
            sheetKind: 'trainer', sheetSlug: 'ash', label: 'Ash', kindLabel: 'Trainer', href: '/sheets/trainers/ash',
          },
        ],
      },
    }
    const wrapper = mount(TrainerSheetItemDecision, {
      attachTo: document.body,
      props: {
        offer: keyboardOffer, selectedTargetIds: [], status: 'ready', message: null,
        acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    const targets = wrapper.findAll('[role="radio"]')
    expect(targets.map(target => target.attributes('tabindex'))).toEqual(['0', '-1'])
    await targets[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('chooseTarget')?.at(-1)).toEqual([secondTargetId])
    expect(document.activeElement).toBe(targets[1]!.element)
  })

  it('shows the Extended Action declaration boundary before treatment starts', async () => {
    const extendedOffer = {
      ...offer(),
      source: { ...offer().source, canonicalId: 'First Aid Kit', displayName: 'First Aid Kit', quantity: 1 },
      timingLabel: 'Extended Action',
      acceptanceNotice: 'Reusable item; no inventory unit is consumed.',
    }
    const wrapper = mount(TrainerSheetItemDecision, {
      props: {
        offer: extendedOffer, selectedTargetIds: [targetId], status: 'ready', message: null,
        acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('Start treatment')
    expect(wrapper.text()).toContain('No roll, AP, HP, condition, or inventory change is applied until completion.')
    expect(wrapper.findAll('button').find(button => button.text().includes('Start treatment'))?.attributes('disabled')).toBeUndefined()
  })

  it('renders permanent target choices, exact before/after facts, and an inert Extended Action boundary', async () => {
    const base = offer()
    const ppOffer: SheetItemActionOfferV1 = {
      ...base,
      source: {
        ...base.source,
        canonicalId: 'PP Up',
        displayName: 'PP Up',
        section: 'pokemonItems',
        sectionLabel: 'Pokémon Items',
        quantity: 1,
      },
      description: 'Permanently raise one eligible Move’s Frequency one level.',
      timingLabel: 'Extended Action',
      costs: [],
      acceptanceNotice: 'Consumes 1 only with accepted Extended Action completion.',
      targeting: {
        ...base.targeting!,
        options: [{
          ...base.targeting!.options[0]!,
          summary: '3 / 5 vitamins used',
          previewFacts: [{ label: 'Vitamin limit', value: '3 / 5 → 4 / 5', tone: 'neutral' }],
          choices: [{
            choiceId: 'permanent-move',
            label: 'Choose a move',
            presentation: 'radio',
            minimum: 1,
            maximum: 1,
            options: [
              {
                optionId: 'move-choice:v1:11111111111111111111111111111111',
                label: 'Spark',
                description: 'EOT → At-Will',
                previewFacts: [{ label: 'Spark', value: 'EOT → At-Will', tone: 'positive' }],
              },
              {
                optionId: 'move-choice:v1:22222222222222222222222222222222',
                label: 'Thunder Wave',
                description: 'Scene x2 → Scene x3',
                previewFacts: [{ label: 'Thunder Wave', value: 'Scene x2 → Scene x3', tone: 'positive' }],
              },
            ],
          }],
        }],
      },
    }
    const wrapper = mount(TrainerSheetItemDecision, {
      props: {
        offer: ppOffer,
        selectedTargetIds: [targetId],
        selectedChoices: {},
        status: 'ready',
        message: null,
        acceptedSheetLinks: [],
        busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('Permanent advancement')
    expect(wrapper.text()).toContain('Choose a move')
    expect(wrapper.text()).toContain('Spark')
    expect(wrapper.text()).toContain('EOT → At-Will')
    expect(wrapper.text()).toContain('Vitamin limit')
    expect(wrapper.text()).toContain('3 / 5 → 4 / 5')
    expect(wrapper.text()).toContain('No item or sheet change occurs until completion')
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios[0]?.attributes('name')).toBe('sheet-item-choice-permanent-move')
    expect(wrapper.findAll('button').find(button => button.text().includes('Start Extended Action'))?.attributes())
      .toHaveProperty('disabled')
    await radios[0]!.trigger('change')
    expect(wrapper.emitted('chooseOption')).toEqual([[
      'permanent-move', 'move-choice:v1:11111111111111111111111111111111',
    ]])
    await wrapper.setProps({
      selectedChoices: {
        'permanent-move': ['move-choice:v1:11111111111111111111111111111111'],
      },
    })
    expect(wrapper.text()).toContain('Selected')
    const start = wrapper.findAll('button').find(button => button.text().includes('Start Extended Action'))!
    expect(start.attributes('disabled')).toBeUndefined()
    expect(wrapper.html()).not.toContain('canonicalDefinitionSha256')
    expect(wrapper.html()).not.toContain('sourceOperationId')
  })

  it('renders machine replacement, explicit confirmation, atomic preview copy, and Move-training activity controls', async () => {
    const base = offer()
    const machineOffer: SheetItemActionOfferV1 = {
      ...base,
      source: {
        ...base.source,
        canonicalId: 'TM 24 - Thunderbolt',
        displayName: 'TM 24 - Thunderbolt',
        section: 'pokemonItems',
        sectionLabel: 'Pokémon Items',
        quantity: 1,
      },
      description: 'Teach Thunderbolt after authoritative compatibility checks.',
      timingLabel: 'Extended Action',
      costs: ['Consume 1 TM 24 - Thunderbolt'],
      acceptanceNotice: 'Consumes 1 only with accepted Extended Action completion.',
      targeting: {
        ...base.targeting!,
        options: [{
          ...base.targeting!.options[0]!,
          summary: '3 active Moves · 2 Tutor Points available',
          description: 'Teach Thunderbolt after validating species compatibility and limits.',
          previewFacts: [
            { label: 'TM/Tutor limit', value: '1 / 3 → 2 / 3', tone: 'neutral' },
            { label: 'Training time', value: 'About 1 hour · Extended Action', tone: 'neutral' },
          ],
          choices: [
            {
              choiceId: 'machine-replacement', label: 'Choose how to add the Move',
              presentation: 'radio', minimum: 1, maximum: 1,
              options: [{
                optionId: 'machine-choice:v1:11111111111111111111111111111111',
                label: 'Keep current Moves',
                description: 'Add Thunderbolt in an open slot · spend 1 Tutor Point',
                previewFacts: [
                  { label: 'Active Move', value: 'Open slot → Thunderbolt', tone: 'positive' },
                  { label: 'Tutor Points', value: '2 → 1 available', tone: 'warning' },
                ],
              }],
            },
            {
              choiceId: 'machine-confirmation', label: 'Confirm Move training',
              presentation: 'confirmation', minimum: 1, maximum: 1,
              options: [{
                optionId: 'confirmed', label: 'Teach Thunderbolt in an open Move slot.',
                description: 'The exact choice is revalidated at completion.',
                previewFacts: [{ label: 'Confirmation', value: 'Accepted for this exact choice', tone: 'positive' }],
              }],
            },
          ],
        }],
      },
    }
    const wrapper = mount(TrainerSheetItemDecision, {
      props: {
        offer: machineOffer,
        selectedTargetIds: [targetId],
        selectedChoices: {},
        status: 'ready', message: null, acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('Move training')
    expect(wrapper.text()).toContain('Choose how to add the Move')
    expect(wrapper.text()).toContain('Confirm Move training')
    expect(wrapper.text()).toContain('Add Thunderbolt in an open slot · spend 1 Tutor Point')
    expect(wrapper.text()).toContain('About 1 hour · Extended Action')
    expect(wrapper.text()).toContain('No Move, Tutor Point, HM usage, or inventory change occurs until completion')
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
    const start = () => wrapper.findAll('button').find(button => button.text().includes('Start Move Training'))!
    expect(start().attributes()).toHaveProperty('disabled')
    await wrapper.find('input[type="radio"]').trigger('change')
    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('chooseOption')).toEqual([
      ['machine-replacement', 'machine-choice:v1:11111111111111111111111111111111'],
      ['machine-confirmation', 'confirmed'],
    ])
    await wrapper.setProps({
      selectedChoices: {
        'machine-replacement': ['machine-choice:v1:11111111111111111111111111111111'],
        'machine-confirmation': ['confirmed'],
      },
    })
    expect(start().attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Open slot → Thunderbolt')

    const card = mount(TrainerItemExtendedActionCard, {
      props: {
        activity: activity({
          item: { canonicalId: 'TM 24 - Thunderbolt', label: 'TM 24 - Thunderbolt' },
          target: {
            sheetKind: 'pokemon', sheetSlug: 'pikachu', label: 'Volt', href: '/sheets/pikachu',
            summary: '3 active Moves · 2 Tutor Points available', conditionLabels: [],
          },
          completion: {
            costs: ['1 TM 24 - Thunderbolt on completion'],
            sourceNotice: 'One exact source item is consumed only with accepted completion.',
            safePendingNotice: 'No Move, Tutor Point, usage, sheet, or inventory change has been applied yet.',
          },
        }),
        status: 'in-progress', message: null, busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(card.text()).toContain('Move training in progress')
    expect(card.text()).toContain('Rook is training Volt with TM 24 - Thunderbolt')
    expect(card.text()).toContain('Complete Move Training')

    const permanentCard = mount(TrainerItemExtendedActionCard, {
      props: {
        activity: activity({
          item: { canonicalId: 'PP Up', label: 'PP Up' },
          completion: {
            costs: ['1 PP Up on completion'],
            sourceNotice: 'One exact source item is consumed only with accepted completion.',
            safePendingNotice: 'No Move, Tutor Point, usage, sheet, or inventory change has been applied yet.',
          },
        }),
        status: 'in-progress', message: null, busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(permanentCard.text()).toContain('PP Up in progress')
    expect(permanentCard.text()).not.toContain('Move training in progress')
  })

  it('renders a confirmed Evolutionary Item destination with irreversible preview and atomic acceptance boundary', async () => {
    const base = offer()
    const evolutionOffer: SheetItemActionOfferV1 = {
      ...base,
      source: {
        ...base.source,
        canonicalId: 'Thunder Stone', displayName: 'Thunder Stone',
        section: 'pokemonItems', sectionLabel: 'Pokémon Items', quantity: 1,
      },
      description: 'Evolve one eligible owned Pokémon through a reviewed transition.',
      costs: ['Consume 1 Thunder Stone'],
      acceptanceNotice: 'Consumes 1 when accepted.',
      targeting: {
        ...base.targeting!,
        options: [{
          ...base.targeting!.options[0]!,
          label: 'Volt', summary: 'Level 25 · Pikachu',
          previewFacts: [{ label: 'Eligibility', value: 'Level 25 meets the Level 20 minimum.', tone: 'neutral' }],
          choices: [
            {
              choiceId: 'evolution-destination', label: 'Review the destination',
              presentation: 'radio', minimum: 1, maximum: 1,
              options: [{
                optionId: 'evolution-choice:v1:11111111111111111111111111111111',
                label: 'Evolve to Raichu',
                description: 'Level 25 meets the Level 20 minimum.',
                previewFacts: [
                  { label: 'Evolution', value: 'Pikachu → Raichu', tone: 'positive' },
                  { label: 'Before', value: 'Electric · Base 4 / 6 / 4 / 5 / 5 / 9', tone: 'neutral' },
                  { label: 'After', value: 'Electric · Base 6 / 9 / 6 / 9 / 8 / 11', tone: 'positive' },
                  { label: 'Stat allocation', value: '35 Stat Points need allocation after evolution', tone: 'warning' },
                  { label: 'Move decisions', value: 'No new Move decision', tone: 'neutral' },
                ],
              }],
            },
            {
              choiceId: 'evolution-confirmation', label: 'Confirm the irreversible evolution',
              presentation: 'confirmation', minimum: 1, maximum: 1,
              options: [{
                optionId: 'confirmed',
                label: 'I understand this changes Volt’s species to Raichu.',
                description: null, previewFacts: [],
              }],
            },
          ],
        }],
      },
    }
    const wrapper = mount(TrainerSheetItemDecision, {
      props: {
        offer: evolutionOffer, selectedTargetIds: [targetId], selectedChoices: {},
        status: 'ready', message: null, acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(wrapper.text()).toContain('Evolution preview')
    expect(wrapper.text()).toContain('Evolve to Raichu')
    expect(wrapper.text()).toContain('No species, Stat, Move, Ability, equipment, or inventory change occurs until the server accepts')
    expect(wrapper.findAll('button').find(button => button.text().includes('Confirm use'))?.attributes())
      .toHaveProperty('disabled')
    await wrapper.find('input[type="radio"]').trigger('change')
    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('chooseOption')).toEqual([
      ['evolution-destination', 'evolution-choice:v1:11111111111111111111111111111111'],
      ['evolution-confirmation', 'confirmed'],
    ])
    await wrapper.setProps({
      selectedChoices: {
        'evolution-destination': ['evolution-choice:v1:11111111111111111111111111111111'],
        'evolution-confirmation': ['confirmed'],
      },
    })
    expect(wrapper.text()).toContain('Pikachu → Raichu')
    expect(wrapper.text()).toContain('35 Stat Points need allocation after evolution')
    expect(wrapper.text()).toContain('No new Move decision')
    const evolve = wrapper.findAll('button').find(button => button.text().includes('Evolve to Raichu'))!
    expect(evolve.attributes('disabled')).toBeUndefined()
    expect(wrapper.html()).not.toContain('canonicalDefinitionSha256')
    expect(wrapper.html()).not.toContain('sourceOperationId')
  })

  it('renders durable treatment progress, costs, safe interruption, completion, and recovery states', async () => {
    const wrapper = mount(TrainerItemExtendedActionCard, {
      attachTo: document.body,
      props: { activity: activity(), status: 'in-progress', message: null, busy: false },
      global: { stubs: { NuxtLink: linkStub } },
    })
    const text = wrapper.text()
    expect(text).toContain('Treatment in progress')
    expect(text).toContain('Rook is treating Volt')
    expect(text).toContain('Campaign minute 4321')
    expect(text).toContain('HP 12 / 46')
    expect(text).toContain('Burned')
    expect(text).toContain('Medicine Education check')
    expect(text).toContain('1 AP on completion')
    expect(text).toContain('Reusable kit')
    expect(text).toContain('No roll, AP, HP, condition, or inventory change has been applied yet.')
    const interrupt = wrapper.findAll('button').find(button => button.text().includes('Interrupt safely'))!
    const complete = wrapper.findAll('button').find(button => button.text().includes('Complete treatment'))!
    expect(interrupt.attributes('disabled')).toBeUndefined()
    expect(complete.attributes('disabled')).toBeUndefined()
    await interrupt.trigger('click')
    await complete.trigger('click')
    expect(wrapper.emitted('interrupt')).toHaveLength(1)
    expect(wrapper.emitted('complete')).toHaveLength(1)

    await wrapper.setProps({
      activity: activity({
        permissions: { canComplete: false, canInterrupt: true, unavailableReason: 'The target changed.' },
      }),
      status: 'conflict',
    })
    expect(wrapper.text()).toContain('The target changed.')
    expect(wrapper.findAll('button').find(button => button.text().includes('Complete treatment'))?.attributes()).toHaveProperty('disabled')

    await wrapper.setProps({
      activity: null,
      status: 'uncertain',
      message: 'Treatment status is uncertain.',
      recoveryOnline: false,
      exactRetryAvailable: true,
    })
    expect(wrapper.text()).toContain('Treatment result uncertain')
    expect(wrapper.text()).toContain('Offline — waiting to reconnect')
    expect(wrapper.text()).toContain('Available after reconnection.')
    const retry = wrapper.findAll('button').find(button => button.text().includes('Retry exact command'))!
    expect(retry.attributes('disabled')).toBeDefined()
    await wrapper.setProps({ recoveryOnline: true })
    expect(retry.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Reconnect never retries automatically.')
    await retry.trigger('click')
    expect(wrapper.emitted('retryExact')).toHaveLength(1)
  })

  it('renders option-level unavailable copy without client inference and distinct uncertain/accepted recovery states', async () => {
    const unavailable = mount(TrainerSheetItemDecision, {
      props: {
        offer: offer(false), selectedTargetIds: [], status: 'ready', message: null,
        acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(unavailable.text()).toContain('At full HP.')
    expect(unavailable.get('[role="radio"]').attributes()).toHaveProperty('disabled')

    const recovery = mount(TrainerSheetItemDecision, {
      props: {
        offer: null, selectedTargetIds: [], status: 'uncertain',
        message: 'The result is uncertain.', acceptedSheetLinks: [], busy: false,
      },
      global: { stubs: { NuxtLink: linkStub } },
    })
    expect(recovery.text()).toContain('Inventory result uncertain')
    expect(recovery.text()).toContain('cannot apply it twice')
    await recovery.get('button').trigger('click')
    expect(recovery.emitted('retryExact')).toHaveLength(1)

    await recovery.setProps({
      status: 'accepted', message: 'Item use accepted.',
      acceptedSheetLinks: [{ href: '/sheets/pikachu', label: 'Pikachu' }],
    })
    expect(recovery.text()).toContain('Item use complete')
    expect(recovery.get('a').text()).toContain('Open Pikachu')
  })
})
