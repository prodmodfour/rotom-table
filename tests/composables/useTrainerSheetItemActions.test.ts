/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useTrainerSheetItemActions } from '~/composables/sheets/useTrainerSheetItemActions'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingSheetItemOperation } from '~/utils/sheetItemOperationStorage'
import { sheetItemTargetId, type AuthorizedSheetItemActionOffer, type SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'sheet-client' }))

const targetId = sheetItemTargetId('pokemon', 'pikachu')
const commandTemplate: UseItemCommandV1 = {
  schemaVersion: 1,
  operationId: 'template',
  context: 'sheet',
  offerId: 'offer:sheet-item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: null,
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: [],
  choices: [],
  readSet: [
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
  ],
}

const publicOffer = (): SheetItemActionOfferV1 => ({
  schemaVersion: 1,
  offerId: commandTemplate.offerId,
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
      summary: 'HP 7 / 35', description: 'Restores 20 HP', href: '/sheets/pikachu', enabled: true,
      unavailableReason: null, previewFacts: [{ label: 'HP after use', value: '7 → 27 HP', tone: 'positive' }],
      choices: [],
    }],
  },
})

const authorizedOffer = (): AuthorizedSheetItemActionOffer => ({
  ...publicOffer(),
  itemCommand: commandTemplate,
})

const projection = () => ({
  schemaVersion: 1 as const,
  trainerSlug: 'ash',
  trainerRevision: 3,
  generatedAt: 100,
  offers: [publicOffer()],
})

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', revision: 3, level: 10,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  resetApiClientForTests()
  window.sessionStorage.clear()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useTrainerSheetItemActions', () => {
  it('coordinates save, declaration, exact command retention, uncertain retry, and accepted sheet links', async () => {
    const getJson = vi.fn().mockResolvedValue(projection())
    const submittedCommands: UseItemCommandV1[] = []
    let useAttempt = 0
    const postJson = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      if (path === ITEM_API_PATHS.declareSheetAction) return authorizedOffer()
      if (path !== ITEM_API_PATHS.use) throw new Error('unexpected route')
      const command = (body as { command: UseItemCommandV1 }).command
      submittedCommands.push(command)
      useAttempt += 1
      if (useAttempt === 1) throw new TypeError('network response was lost')
      return {
        result: {
          schemaVersion: 1, operationId: command.operationId, status: 'accepted', canonicalItemId: 'Potion',
          aggregateRefs: command.readSet, receiptId: 'item-receipt:v1:11111111111111111111111111111111', exactReplay: true,
        },
        sheets: [
          { kind: 'pokemon', slug: 'pikachu', revision: 3, updatedAt: 101, sheet: { slug: 'pikachu', revision: 3, nickname: 'Pikachu' } },
          { kind: 'trainer', slug: 'ash', revision: 4, updatedAt: 101, sheet: { slug: 'ash', revision: 4, name: 'Ash' } },
        ],
      }
    })
    configureApiClientForTests({ getJson, postJson })
    const sheet = ref(trainer())
    const saveStatus: Ref<SaveStatus> = ref('saved')
    const prepareForAction = vi.fn(async () => undefined)
    const onAccepted = vi.fn()
    let actions!: ReturnType<typeof useTrainerSheetItemActions>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerSheetItemActions({ sheet, saveStatus, profileId: () => null, prepareForAction, onAccepted })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()

    actions.openOffer(actions.projection.value!.offers[0]!)
    actions.chooseTarget(targetId)
    await actions.submit()
    expect(prepareForAction).toHaveBeenCalledOnce()
    expect(actions.status.value).toBe('uncertain')
    const retained = loadPendingSheetItemOperation('ash')
    expect(retained?.command.operationId).toMatch(/^sheet-item:v1:[0-9a-f]{32}$/)
    expect(retained?.command.targetIds).toEqual([targetId])

    await actions.retryExact()
    expect(submittedCommands).toHaveLength(2)
    expect(submittedCommands[1]).toEqual(submittedCommands[0])
    expect(actions.status.value).toBe('accepted')
    expect(actions.message.value).toContain('without using the item twice')
    expect(actions.acceptedSheetLinks.value).toEqual([
      { href: '/sheets/pikachu', label: 'Pikachu' },
      { href: '/sheets/trainers/ash', label: 'Ash' },
    ])
    expect(loadPendingSheetItemOperation('ash')).toBeNull()
    expect(onAccepted).toHaveBeenCalledOnce()
    expect(postJson.mock.calls[0]?.[1]).toEqual({
      intent: {
        schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3,
        offerId: commandTemplate.offerId, action: 'use',
      },
    })
    wrapper.unmount()
  })

  it('switches between exact current source offers and clears target choices before commit', async () => {
    const first = publicOffer()
    const second: SheetItemActionOfferV1 = {
      ...first,
      offerId: 'offer:sheet-item:potion:second',
      source: {
        ...first.source,
        sourceSelectionId: `inventory-source:v1:${'2'.repeat(32)}`,
        rowIndex: 3,
        rowLabel: 'Row 4',
        quantity: 1,
      },
    }
    configureApiClientForTests({
      getJson: vi.fn().mockResolvedValue({ ...projection(), offers: [first, second] }),
      postJson: vi.fn(),
    })
    let actions!: ReturnType<typeof useTrainerSheetItemActions>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerSheetItemActions({ sheet: trainer(), saveStatus: 'saved', profileId: null })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    actions.openOffer(actions.projection.value!.offers[0]!)
    actions.chooseTarget(targetId)
    expect(actions.sourceSelection.value).toMatchObject({ canonicalItemId: 'Potion', totalQuantity: 3 })
    expect(actions.sourceSelection.value?.options.map(option => option.rowLabel)).toEqual(['Row 1', 'Row 4'])

    actions.chooseSource(`inventory-source:v1:${'2'.repeat(32)}`)
    expect(actions.selectedOffer.value?.offerId).toBe(second.offerId)
    expect(actions.selectedTargetIds.value).toEqual([])
    expect(actions.selectedChoices.value).toEqual({})
    expect(actions.message.value).toContain('Choose the target again')
    expect(actions.sourceSelection.value?.options.find(option => option.selected)).toMatchObject({ rowLabel: 'Row 4' })
    expect(window.localStorage.getItem('rotom-table:inventory-source-presentation:v1'))
      .toBe('{"schemaVersion":1,"preferredContainerKind":"trainer","preferredSection":"medicalKit"}')
    wrapper.unmount()
  })

  it('persists projected permanent choices into the durable Extended Action start command', async () => {
    const base = publicOffer()
    const optionId = 'move-choice:v1:11111111111111111111111111111111'
    const ppOffer: SheetItemActionOfferV1 = {
      ...base,
      source: { ...base.source, canonicalId: 'PP Up', displayName: 'PP Up', section: 'pokemonItems' },
      timingLabel: 'Extended Action',
      targeting: {
        ...base.targeting!,
        options: [{
          ...base.targeting!.options[0]!,
          choices: [{
            choiceId: 'permanent-move', label: 'Choose a move', presentation: 'radio',
            minimum: 1, maximum: 1,
            options: [{
              optionId, label: 'Spark', description: 'EOT → At-Will',
              previewFacts: [{ label: 'Spark', value: 'EOT → At-Will', tone: 'positive' }],
            }],
          }],
        }],
      },
    }
    const onStartExtendedAction = vi.fn(async () => true)
    configureApiClientForTests({
      getJson: vi.fn().mockResolvedValue({ ...projection(), offers: [ppOffer] }),
      postJson: vi.fn(),
    })
    let actions!: ReturnType<typeof useTrainerSheetItemActions>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerSheetItemActions({
          sheet: trainer(), saveStatus: 'saved', profileId: null, onStartExtendedAction,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    actions.openOffer(actions.projection.value!.offers[0]!)
    actions.chooseTarget(targetId)
    expect(actions.projectedChoices.value.map(choice => choice.choiceId)).toEqual(['permanent-move'])
    expect(actions.choicesComplete.value).toBe(false)
    await actions.submit()
    expect(onStartExtendedAction).not.toHaveBeenCalled()
    expect(actions.message.value).toContain('Complete every permanent item choice')
    actions.chooseOption('permanent-move', optionId)
    expect(actions.selectedChoices.value).toEqual({ 'permanent-move': [optionId] })
    expect(actions.choicesComplete.value).toBe(true)
    await actions.submit()
    expect(onStartExtendedAction).toHaveBeenCalledWith(ppOffer, [targetId], [
      { choiceId: 'permanent-move', optionIds: [optionId] },
    ])
    expect(actions.selectedOffer.value).toBeNull()
    wrapper.unmount()
  })

  it('fails closed on malformed accepted payloads and retains the exact command for recovery', async () => {
    configureApiClientForTests({
      getJson: vi.fn().mockResolvedValue(projection()),
      postJson: vi.fn(async path => path === ITEM_API_PATHS.declareSheetAction
        ? authorizedOffer()
        : { result: { schemaVersion: 1, status: 'accepted', exactReplay: false }, sheets: [] }),
    })
    let actions!: ReturnType<typeof useTrainerSheetItemActions>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerSheetItemActions({ sheet: trainer(), saveStatus: 'saved', profileId: null })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    actions.openOffer(actions.projection.value!.offers[0]!)
    actions.chooseTarget(targetId)
    await actions.submit()
    expect(actions.status.value).toBe('uncertain')
    expect(loadPendingSheetItemOperation('ash')?.command.operationId).toBe(actions.lastCommand.value?.operationId)
    wrapper.unmount()
  })
})
