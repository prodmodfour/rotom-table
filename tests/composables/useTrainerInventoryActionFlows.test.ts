/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import type { SaveStatus } from '~/composables/useEditableSheet'
import { useTrainerInventoryActionFlows } from '~/composables/sheets/useTrainerInventoryActionFlows'
import type { TrainerSheet } from '~/types/trainerSheet'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'
import {
  loadPendingInventoryActionOperation,
  retainPendingInventoryActionOperation,
} from '~/utils/inventoryActionOperationStorage'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'inventory-client' }))

const id = (prefix: string, value: string): string => `${prefix}${value.repeat(32)}`
const offer = (): InventoryActionOfferV1 => ({
  schemaVersion: 1,
  offerId: id('inventory-action-offer:v1:', '1'),
  action: 'transfer', label: 'Transfer',
  source: {
    sourceSelectionId: id('inventory-source:v1:', '2'), locationKind: 'trainer-inventory',
    containerLabel: 'Trainer inventory', section: 'medicalKit', sectionLabel: 'Medical Kit',
    rowLabel: 'Row 1', itemLabel: 'Potion', canonicalItemId: 'Potion', availableQuantity: 3, itemForm: 'stack',
  },
  authority: {
    requiredRole: 'player-or-gm',
    checks: [
      { kind: 'authenticated-session', label: 'Authenticated campaign session', satisfied: true },
      { kind: 'source-control', label: 'Current Trainer inventory control', satisfied: true },
      { kind: 'current-custody', label: 'Exact current item custody', satisfied: true },
      { kind: 'mechanics-eligibility', label: 'Current action eligibility', satisfied: true },
    ],
  },
  revisionRequirements: [{
    requirementId: id('inventory-revision:v1:', '3'), resourceKind: 'source-container',
    label: 'Trainer inventory revision', expectedRevision: 3,
  }],
  quantity: { mode: 'bounded', minimum: 1, maximum: 3, defaultValue: 1, unitLabel: 'items' },
  destination: {
    mode: 'required', allowedKinds: ['trainer-inventory', 'group-inventory'],
    rules: ['Quantity cannot exceed current source quantity.'],
    options: [{
      destinationId: id('inventory-destination:v1:', '4'), kind: 'group-inventory', label: 'Group inventory',
      description: 'Moves items into shared custody.', enabled: true, unavailableReason: null,
      revisionRequirements: [{
        requirementId: id('inventory-revision:v1:', '5'), resourceKind: 'destination-container',
        label: 'Group inventory revision', expectedRevision: 1,
      }],
    }],
  },
  consequences: [{ kind: 'inventory-move', label: 'Selected quantity moves to group inventory.', reversibility: 'reversible' }],
  confirmation: { mode: 'action-submit', label: 'Transfer selected quantity.', optionId: null },
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
const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 3 }] },
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

describe('useTrainerInventoryActionFlows', () => {
  it('retains one exact declaration across an uncertain response and adopts the recovered authoritative result', async () => {
    const getJson = vi.fn().mockResolvedValue(projection())
    const declarations: unknown[] = []
    let attempt = 0
    const postJson = vi.fn(async (path: string, body: unknown) => {
      expect(path).toBe(INVENTORY_ACTION_API_PATHS.execute)
      const declaration = (body as { declaration: Record<string, unknown> }).declaration
      declarations.push(declaration)
      attempt += 1
      if (attempt === 1) throw new TypeError('response lost')
      return {
        result: {
          schemaVersion: 1, operationId: declaration.operationId, action: 'transfer', exactReplay: true,
          message: 'The original accepted inventory action was recovered without moving the item twice.',
        },
        sheets: [{ kind: 'trainer', slug: 'ash', revision: 4, updatedAt: 101, sheet: { slug: 'ash', revision: 4, name: 'Ash' } }],
        groupInventories: [{ slug: 'main', revision: 2, updatedAt: 101, money: 0, inventory: {} }],
      }
    })
    configureApiClientForTests({ getJson, postJson })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes } })
    const sheet = ref(trainer())
    const saveStatus: Ref<SaveStatus> = ref('saved')
    const onAccepted = vi.fn()
    let actions!: ReturnType<typeof useTrainerInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerInventoryActionFlows({ sheet, saveStatus, profileId: () => null, onAccepted })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    expect(getJson).toHaveBeenCalledWith(INVENTORY_ACTION_API_PATHS.actions, { params: { trainerSlug: 'ash' } })

    actions.open(actions.projection.value!.offers[0]!)
    actions.setQuantity(2)
    await actions.submit()
    expect(actions.status.value).toBe('uncertain')
    const retained = loadPendingInventoryActionOperation('ash')
    expect(retained?.declaration).toMatchObject({
      operationId: `inventory-action:v1:${'07'.repeat(16)}`,
      action: 'transfer', quantity: 2,
      expectedRevisions: [
        { expectedRevision: 3 },
        { expectedRevision: 1 },
      ],
    })
    actions.close()
    expect(actions.status.value).toBe('uncertain')

    await actions.retryExact()
    expect(declarations).toHaveLength(2)
    expect(declarations[1]).toEqual(declarations[0])
    expect(actions.status.value).toBe('accepted')
    expect(actions.message.value).toContain('without moving the item twice')
    expect(loadPendingInventoryActionOperation('ash')).toBeNull()
    expect(onAccepted).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('submits destination-less discard only after preserving the exact explicit confirmation', async () => {
    const destructive = discardOffer()
    const postJson = vi.fn(async (_path: string, body: unknown) => {
      const declaration = (body as { declaration: Record<string, unknown> }).declaration
      return {
        result: {
          schemaVersion: 1, operationId: declaration.operationId, action: 'discard', exactReplay: false,
          message: 'Selected quantity was permanently discarded.',
        },
        sheets: [{ kind: 'trainer', slug: 'ash', revision: 4, updatedAt: 101, sheet: { slug: 'ash', revision: 4 } }],
        groupInventories: [],
      }
    })
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection([destructive])), postJson })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(8); return bytes } })
    let actions!: ReturnType<typeof useTrainerInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerInventoryActionFlows({ sheet: trainer(), saveStatus: () => 'saved', profileId: () => null })
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
    expect([actions.status.value, actions.message.value]).toEqual(['accepted', 'Selected quantity was permanently discarded.'])
    expect(postJson).toHaveBeenCalledOnce()
    expect((postJson.mock.calls[0]![1] as { declaration: unknown }).declaration).toMatchObject({
      action: 'discard',
      quantity: 2,
      destinationId: null,
      confirmationOptionId: destructive.confirmation.optionId,
      expectedRevisions: [{ expectedRevision: 3 }],
    })
    expect(actions.status.value).toBe('accepted')
    wrapper.unmount()
  })

  it('keeps a recovered command bound to its original player profile until that profile is reselected', async () => {
    const projectedOffer = offer()
    retainPendingInventoryActionOperation({
      schemaVersion: 1,
      trainerSlug: 'ash',
      profileId: 'profile_original',
      declaration: {
        schemaVersion: 1,
        operationId: `inventory-action:v1:${'4'.repeat(32)}`,
        offerId: projectedOffer.offerId,
        action: 'transfer',
        sourceSelectionId: projectedOffer.source.sourceSelectionId,
        quantity: 1,
        destinationId: projectedOffer.destination.options[0]!.destinationId,
        confirmationOptionId: null,
        expectedRevisions: [
          ...projectedOffer.revisionRequirements,
          ...projectedOffer.destination.options[0]!.revisionRequirements,
        ].map(requirement => ({
          requirementId: requirement.requirementId,
          expectedRevision: requirement.expectedRevision,
        })),
      },
    })
    const profileId = ref<string | null>('profile_other')
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection()), postJson: vi.fn() })
    let actions!: ReturnType<typeof useTrainerInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerInventoryActionFlows({ sheet: trainer(), saveStatus: 'saved', profileId })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    expect(actions.status.value).toBe('uncertain')
    expect(actions.exactRetryAvailable.value).toBe(false)
    expect(actions.message.value).toContain('another player profile')

    profileId.value = 'profile_original'
    await flush()
    expect(actions.status.value).toBe('uncertain')
    expect(actions.exactRetryAvailable.value).toBe(true)
    expect(actions.message.value).toContain('Retry that exact action')
    wrapper.unmount()
  })

  it('waits for explicit exact retry after offline reconnect and never creates a replacement command', async () => {
    let connected = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => connected)
    const declarations: unknown[] = []
    const postJson = vi.fn(async (_path: string, body: unknown) => {
      declarations.push((body as { declaration: unknown }).declaration)
      throw new TypeError('connection lost')
    })
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection()), postJson })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(6); return bytes } })
    let actions!: ReturnType<typeof useTrainerInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerInventoryActionFlows({ sheet: trainer(), saveStatus: () => 'saved', profileId: () => null })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    connected = false
    window.dispatchEvent(new Event('offline'))
    actions.open(actions.projection.value!.offers[0]!)
    await actions.submit()
    expect(actions.status.value).toBe('uncertain')
    expect(actions.online.value).toBe(false)
    expect(actions.message.value).toContain('connection was lost')
    expect(declarations).toHaveLength(1)

    connected = true
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(actions.online.value).toBe(true)
    expect(declarations).toHaveLength(1)

    await actions.retryExact()
    expect(declarations).toHaveLength(2)
    expect(declarations[1]).toEqual(declarations[0])
    wrapper.unmount()
  })

  it('reloads authoritative inventory before replacing a stale or moved-row selection', async () => {
    const sheet = ref(trainer())
    const currentOffer = () => {
      const value = offer()
      return {
        ...value,
        revisionRequirements: value.revisionRequirements.map(requirement => ({
          ...requirement,
          expectedRevision: Number(sheet.value.revision),
        })),
      }
    }
    const getJson = vi.fn(async () => projection([currentOffer()]))
    const conflict = Object.assign(new Error('The exact source row moved before commit.'), { statusCode: 409 })
    const postJson = vi.fn().mockRejectedValue(conflict)
    const reconcileAuthority = vi.fn(async () => {
      sheet.value = { ...sheet.value, revision: 4 }
    })
    configureApiClientForTests({ getJson, postJson })
    let actions!: ReturnType<typeof useTrainerInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerInventoryActionFlows({
          sheet, saveStatus: () => 'saved', profileId: () => null, reconcileAuthority,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    actions.open(actions.projection.value!.offers[0]!)
    await actions.submit()
    expect(actions.status.value).toBe('conflict')
    expect(actions.canBegin.value).toBe(false)
    expect(postJson).toHaveBeenCalledOnce()

    await actions.refresh()
    expect(reconcileAuthority).toHaveBeenCalledOnce()
    expect(postJson).toHaveBeenCalledOnce()
    expect(actions.status.value).toBe('idle')
    expect(actions.projection.value?.offers[0]?.revisionRequirements[0]?.expectedRevision).toBe(4)
    wrapper.unmount()
  })

  it('fails locally when the open source revision changed before submission', async () => {
    const postJson = vi.fn()
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection()), postJson })
    const sheet = ref(trainer())
    let actions!: ReturnType<typeof useTrainerInventoryActionFlows>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerInventoryActionFlows({ sheet, saveStatus: () => 'saved', profileId: () => null })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    actions.open(actions.projection.value!.offers[0]!)
    sheet.value = { ...sheet.value, revision: 4 }
    await actions.submit()
    expect(actions.status.value).toBe('conflict')
    expect(actions.message.value).toContain('do not match the open Trainer revision')
    expect(postJson).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
