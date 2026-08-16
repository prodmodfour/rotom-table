/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useTrainerItemExtendedActions } from '~/composables/sheets/useTrainerItemExtendedActions'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingItemExtendedAction } from '~/utils/itemExtendedActionStorage'
import { sheetItemTargetId, type SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { ItemExtendedActionProjectionV1 } from '#shared/itemAutomation/extendedActions'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'treatment-client' }))
vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: vi.fn(() => () => undefined),
}))

const targetId = sheetItemTargetId('pokemon', 'volt')
const offer = (): SheetItemActionOfferV1 => ({
  schemaVersion: 1,
  offerId: 'offer:sheet-item:first-aid',
  actor: { sheetKind: 'trainer', sheetSlug: 'medic', revision: 3, label: 'Rook', href: '/sheets/trainers/medic' },
  source: {
    sourceSelectionId: `inventory-source:v1:${'1'.repeat(32)}`,
    containerKind: 'trainer', containerLabel: 'Trainer inventory',
    canonicalId: 'First Aid Kit', displayName: 'First Aid Kit', section: 'medicalKit',
    sectionLabel: 'Medical Kit', rowIndex: 0, rowLabel: 'Row 1', quantity: 1,
  },
  context: 'sheet', description: 'Treats wounds.', timingLabel: 'Extended Action',
  costs: ['Drain 1 AP'], acceptanceNotice: 'Reusable item; no inventory unit is consumed.',
  availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use', label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/First%20Aid%20Kit' },
  ],
  targeting: {
    requirementId: 'target', minimum: 1, maximum: 1,
    options: [{
      targetId, sheetKind: 'pokemon', sheetSlug: 'volt', label: 'Volt', kindLabel: 'Pokémon',
      summary: 'HP 12 / 46', description: 'Treatment available.', href: '/sheets/volt', enabled: true,
      unavailableReason: null, previewFacts: [],
    }],
  },
})
const active = (activityId: string, revision = 0): ItemExtendedActionProjectionV1 => ({
  schemaVersion: 1,
  activityId,
  revision,
  status: 'in-progress',
  item: { canonicalId: 'First Aid Kit', label: 'First Aid Kit' },
  actor: { sheetKind: 'trainer', sheetSlug: 'medic', label: 'Rook', href: '/sheets/trainers/medic' },
  target: {
    sheetKind: 'pokemon', sheetSlug: 'volt', label: 'Volt', href: '/sheets/volt',
    summary: 'HP 12 / 46', conditionLabels: ['Burned'],
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
})
const trainer = (): TrainerSheet => ({
  slug: 'medic', name: 'Rook', revision: 3, level: 10,
  inventory: { medicalKit: [{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }] },
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

describe('useTrainerItemExtendedActions', () => {
  it('starts with no accepted sheet result, retains an uncertain completion, and exact-retries once', async () => {
    const submitted: Array<Record<string, unknown>> = []
    let activeProjection: ItemExtendedActionProjectionV1 | null = null
    let completionAttempts = 0
    const postJson = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      expect(path).toBe(ITEM_API_PATHS.extendedActions)
      const command = (body as { command: Record<string, unknown> }).command
      submitted.push(command)
      if (command.kind === 'start') {
        activeProjection = active(String(command.activityId))
        return {
          result: {
            schemaVersion: 1, operationId: command.operationId, activityId: command.activityId,
            status: 'in-progress', revision: 0, exactReplay: false, itemResult: null,
          },
          activity: activeProjection,
          sheets: [],
        }
      }
      completionAttempts += 1
      if (completionAttempts === 1) throw new TypeError('response was lost')
      const completed: ItemExtendedActionProjectionV1 = {
        ...active(String(command.activityId), 1),
        status: 'completed',
        permissions: { canComplete: false, canInterrupt: false, unavailableReason: null },
        terminal: { kind: 'completed', message: 'Treatment completed.' },
      }
      activeProjection = completed
      return {
        result: {
          schemaVersion: 1, operationId: command.operationId, activityId: command.activityId,
          status: 'completed', revision: 1, exactReplay: true,
          itemResult: {
            schemaVersion: 1, operationId: 'sheet-item:v1:00000000000000000000000000000001',
            status: 'accepted', canonicalItemId: 'First Aid Kit', aggregateRefs: [],
            receiptId: 'item-receipt:test', exactReplay: true,
          },
        },
        activity: completed,
        sheets: [{
          kind: 'pokemon', slug: 'volt', revision: 3, updatedAt: 500,
          sheet: { slug: 'volt', revision: 3, nickname: 'Volt' },
        }],
      }
    })
    configureApiClientForTests({
      getJson: vi.fn(async () => activeProjection ? [activeProjection] : []),
      postJson,
    })
    const saveStatus: Ref<SaveStatus> = ref('saved')
    const prepare = vi.fn(async () => undefined)
    const onAccepted = vi.fn()
    let actions!: ReturnType<typeof useTrainerItemExtendedActions>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerItemExtendedActions({
          sheet: trainer(), saveStatus, profileId: null, prepareForAction: prepare, onAccepted,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()

    expect(await actions.start(offer(), [targetId])).toBe(true)
    expect(actions.status.value).toBe('in-progress')
    expect(actions.activeActivity.value?.completion.safePendingNotice).toContain('No roll')
    expect(submitted[0]).toMatchObject({
      kind: 'start', trainerSlug: 'medic', trainerRevision: 3,
      offerId: offer().offerId, targetIds: [targetId],
    })
    expect(String(submitted[0]?.activityId)).toMatch(/^item-activity:v1:[a-f0-9]{32}$/)
    expect(String(submitted[0]?.operationId)).toMatch(/^item-activity-operation:v1:[a-f0-9]{32}$/)
    expect(String(submitted[0]?.settlementOperationId)).toMatch(/^sheet-item:v1:[a-f0-9]{32}$/)
    expect(loadPendingItemExtendedAction('medic')).toBeNull()
    expect(onAccepted).not.toHaveBeenCalled()

    expect(await actions.complete()).toBe(false)
    expect(actions.status.value).toBe('uncertain')
    const pending = loadPendingItemExtendedAction('medic')
    expect(pending?.command.kind).toBe('complete')
    await actions.retryExact()
    expect(submitted[2]).toEqual(submitted[1])
    expect(actions.status.value).toBe('completed')
    expect(actions.message.value).toContain('without applying it twice')
    expect(loadPendingItemExtendedAction('medic')).toBeNull()
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ status: 'accepted', exactReplay: true }),
      sheets: [expect.objectContaining({ kind: 'pokemon', slug: 'volt', revision: 3 })],
    }))
    expect(prepare).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('interrupts the active activity with explicit no-item terminal state', async () => {
    const current = active('item-activity:v1:00000000000000000000000000000009')
    configureApiClientForTests({
      getJson: vi.fn(async () => [current]),
      postJson: vi.fn(async (_path, body) => {
        const command = (body as { command: Record<string, unknown> }).command
        return {
          result: {
            schemaVersion: 1, operationId: command.operationId, activityId: command.activityId,
            status: 'interrupted', revision: 1, exactReplay: false, itemResult: null,
          },
          activity: {
            ...current, revision: 1, status: 'interrupted',
            permissions: { canComplete: false, canInterrupt: false, unavailableReason: null },
            terminal: { kind: 'interrupted', message: 'Treatment interrupted before any item mechanics were applied.' },
          },
          sheets: [],
        }
      }),
    })
    let actions!: ReturnType<typeof useTrainerItemExtendedActions>
    const wrapper = mount(defineComponent({
      setup() {
        actions = useTrainerItemExtendedActions({ sheet: trainer(), saveStatus: 'saved', profileId: null })
        return () => h('div')
      },
    }))
    await flush()
    expect(await actions.interrupt()).toBe(true)
    expect(actions.status.value).toBe('interrupted')
    expect(actions.latestActivity.value?.terminal?.message).toContain('before any item mechanics')
    expect(loadPendingItemExtendedAction('medic')).toBeNull()
    wrapper.unmount()
  })
})
