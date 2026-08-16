/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useGroupInventoryActionFlows } from '~/composables/useGroupInventoryActionFlows'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'
import {
  clearPendingGroupInventoryActionOperation,
  GROUP_INVENTORY_ACTION_PENDING_STORAGE_PREFIX,
  loadPendingGroupInventoryActionOperation,
} from '~/utils/groupInventoryActionOperationStorage'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'group-action-client' }))

const id = (prefix: string, value: string): string => `${prefix}${value.repeat(32)}`
const offer = (): InventoryActionOfferV1 => ({
  schemaVersion: 1,
  offerId: id('inventory-action-offer:v1:', '1'),
  action: 'transfer', label: 'Transfer',
  source: {
    sourceSelectionId: id('inventory-source:v1:', '2'), locationKind: 'group-inventory',
    containerLabel: 'Group inventory', section: 'medicalKit', sectionLabel: 'Medical Kit',
    rowLabel: 'Row 1', itemLabel: 'Potion', canonicalItemId: 'Potion', availableQuantity: 3, itemForm: 'stack',
  },
  authority: {
    requiredRole: 'player-or-gm',
    checks: [{ kind: 'authenticated-session', label: 'Signed in', satisfied: true }],
  },
  revisionRequirements: [{
    requirementId: id('inventory-revision:v1:', '3'), resourceKind: 'source-container',
    label: 'Group revision', expectedRevision: 4,
  }],
  quantity: { mode: 'bounded', minimum: 1, maximum: 3, defaultValue: 1, unitLabel: 'items' },
  destination: {
    mode: 'required', allowedKinds: ['trainer-inventory', 'group-inventory'], rules: ['Current only.'],
    options: [{
      destinationId: id('inventory-destination:v1:', '4'), kind: 'trainer-inventory', label: 'Ash · Medical Kit',
      description: 'Moves exact custody.', enabled: true, unavailableReason: null,
      revisionRequirements: [{
        requirementId: id('inventory-revision:v1:', '5'), resourceKind: 'destination-container',
        label: 'Trainer revision', expectedRevision: 7,
      }],
    }],
  },
  consequences: [{ kind: 'inventory-move', label: 'Moves selected quantity.', reversibility: 'reversible' }],
  confirmation: { mode: 'action-submit', label: 'Transfer.', optionId: null },
  execution: { mode: 'command', handoff: 'inventory-transfer', href: null },
  enabled: true, unavailableReason: null,
})
const discardOffer = (): InventoryActionOfferV1 => {
  const base = offer()
  return {
    ...base,
    offerId: id('inventory-action-offer:v1:', '6'),
    action: 'discard',
    label: 'Discard',
    authority: {
      requiredRole: 'gm',
      checks: [{ kind: 'authenticated-session', label: 'Signed in', satisfied: true }],
    },
    destination: { mode: 'none', allowedKinds: [], rules: [], options: [] },
    consequences: [{ kind: 'discard', label: 'Selected quantity is permanently removed.', reversibility: 'irreversible' }],
    confirmation: {
      mode: 'explicit-choice',
      label: 'I understand these items cannot be recovered through ordinary inventory actions.',
      optionId: id('inventory-confirmation:v1:', '7'),
    },
    execution: { mode: 'command', handoff: 'inventory-stack-operation', href: null },
  }
}
const projection = (offers: readonly InventoryActionOfferV1[] = [offer()]) => ({ schemaVersion: 1 as const, generatedAt: 100, offers })
const group = () => {
  const document = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
  document.revision = 4
  document.inventory.medicalKit = [{ id: 'private-potion-row', name: 'Potion', qty: 3 }]
  return document
}
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

describe('useGroupInventoryActionFlows', () => {
  it('retries one exact uncertain declaration and adopts both authoritative resources', async () => {
    const getJson = vi.fn().mockResolvedValue(projection())
    const declarations: unknown[] = []
    let attempts = 0
    const postJson = vi.fn(async (_path: string, body: unknown) => {
      const declaration = (body as { declaration: Record<string, unknown> }).declaration
      declarations.push(declaration)
      attempts += 1
      if (attempts === 1) throw new TypeError('response lost')
      return {
        result: {
          schemaVersion: 1, operationId: declaration.operationId, action: 'transfer', exactReplay: true,
          message: 'The accepted transfer was recovered without moving the item twice.',
        },
        sheets: [{ kind: 'trainer', slug: 'ash', revision: 8, updatedAt: 101, sheet: { slug: 'ash', revision: 8 } }],
        groupInventories: [{ ...group(), revision: 5, updatedAt: 101 }],
      }
    })
    configureApiClientForTests({ getJson, postJson })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(9); return bytes } })
    const document = ref(group())
    const onAccepted = vi.fn()
    let actions!: ReturnType<typeof useGroupInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useGroupInventoryActionFlows({ document, hasUnsavedEdits: () => false, profileId: () => null, onAccepted })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    expect(getJson).toHaveBeenCalledWith(INVENTORY_ACTION_API_PATHS.actions, { params: { groupSlug: 'main' } })

    actions.open(actions.projection.value!.offers[0]!)
    actions.setQuantity(2)
    await actions.submit()
    expect(actions.status.value).toBe('uncertain')
    expect(actions.mutationBlocked.value).toBe(true)
    expect(loadPendingGroupInventoryActionOperation('main')?.declaration).toMatchObject({
      operationId: `inventory-action:v1:${'09'.repeat(16)}`,
      quantity: 2,
      expectedRevisions: [{ expectedRevision: 4 }, { expectedRevision: 7 }],
    })

    await actions.retryExact()
    expect(declarations[1]).toEqual(declarations[0])
    expect(actions.status.value).toBe('accepted')
    expect(loadPendingGroupInventoryActionOperation('main')).toBeNull()
    expect(onAccepted).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('shares one exact recovery command across tabs and requires reconciliation after another tab resolves it', async () => {
    configureApiClientForTests({
      getJson: vi.fn().mockResolvedValue(projection()),
      postJson: vi.fn().mockRejectedValue(new TypeError('response lost')),
    })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(5); return bytes } })
    let first!: ReturnType<typeof useGroupInventoryActionFlows>
    const FirstHarness = defineComponent({
      setup() {
        first = useGroupInventoryActionFlows({ document: group(), hasUnsavedEdits: false, profileId: null })
        return () => h('div')
      },
    })
    const firstWrapper = mount(FirstHarness)
    await flush()
    first.open(first.projection.value!.offers[0]!)
    await first.submit()
    expect(first.status.value).toBe('uncertain')
    const operationId = loadPendingGroupInventoryActionOperation('main')!.declaration.operationId

    let second!: ReturnType<typeof useGroupInventoryActionFlows>
    const SecondHarness = defineComponent({
      setup() {
        second = useGroupInventoryActionFlows({ document: group(), hasUnsavedEdits: false, profileId: null })
        return () => h('div')
      },
    })
    const secondWrapper = mount(SecondHarness)
    await flush()
    expect(second.status.value).toBe('uncertain')
    expect(second.exactRetryAvailable.value).toBe(true)
    expect(second.canBegin.value).toBe(false)

    clearPendingGroupInventoryActionOperation('main', operationId)
    window.dispatchEvent(new StorageEvent('storage', {
      key: `${GROUP_INVENTORY_ACTION_PENDING_STORAGE_PREFIX}main`,
      storageArea: window.localStorage,
    }))
    await flush()
    expect(second.status.value).toBe('conflict')
    expect(second.message.value).toContain('resolved in another tab')
    expect(second.exactRetryAvailable.value).toBe(false)
    firstWrapper.unmount()
    secondWrapper.unmount()
  })

  it('submits destination-less shared discard only with its exact destructive confirmation', async () => {
    const destructive = discardOffer()
    const postJson = vi.fn(async (_path: string, body: unknown) => {
      const declaration = (body as { declaration: Record<string, unknown> }).declaration
      return {
        result: {
          schemaVersion: 1, operationId: declaration.operationId, action: 'discard', exactReplay: false,
          message: 'Selected shared quantity was permanently discarded.',
        },
        sheets: [],
        groupInventories: [{ ...group(), revision: 5, updatedAt: 101 }],
      }
    })
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection([destructive])), postJson })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(8); return bytes } })
    let actions!: ReturnType<typeof useGroupInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useGroupInventoryActionFlows({ document: group(), hasUnsavedEdits: () => false, profileId: () => null })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    actions.open(actions.projection.value!.offers[0]!)
    actions.setQuantity(2)
    await actions.submit()
    expect(postJson).not.toHaveBeenCalled()

    actions.setConfirmation(true)
    expect(actions.selectedConfirmationOptionId.value).toBe(destructive.confirmation.optionId)
    await actions.submit()
    expect([actions.status.value, actions.message.value]).toEqual(['accepted', 'Selected shared quantity was permanently discarded.'])
    expect((postJson.mock.calls[0]![1] as { declaration: unknown }).declaration).toMatchObject({
      action: 'discard',
      quantity: 2,
      destinationId: null,
      confirmationOptionId: destructive.confirmation.optionId,
      expectedRevisions: [{ expectedRevision: 4 }],
    })
    expect(actions.status.value).toBe('accepted')
    wrapper.unmount()
  })

  it('blocks stale and unsaved group state before any command can begin', async () => {
    const postJson = vi.fn()
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection()), postJson })
    const document = ref(group())
    const dirty = ref(false)
    let actions!: ReturnType<typeof useGroupInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useGroupInventoryActionFlows({ document, hasUnsavedEdits: dirty, profileId: () => null })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    dirty.value = true
    expect(actions.canBegin.value).toBe(false)
    actions.open(actions.projection.value!.offers[0]!)
    expect(actions.selectedOffer.value).toBeNull()

    dirty.value = false
    await flush()
    actions.open(actions.projection.value!.offers[0]!)
    document.value = { ...document.value, revision: 5 }
    await actions.submit()
    await flush()
    expect(actions.status.value).toBe('conflict')
    expect(postJson).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
