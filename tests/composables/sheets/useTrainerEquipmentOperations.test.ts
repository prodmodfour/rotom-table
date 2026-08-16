/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { EquipmentOperationCommandV1 } from '#shared/itemAutomation/equipmentOperations'
import type { TrainerSheet } from '~/types/trainerSheet'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useTrainerEquipmentOperations } from '~/composables/sheets/useTrainerEquipmentOperations'
import { EQUIPMENT_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingEquipmentOperation } from '~/utils/equipmentOperationStorage'
import { activeEquipmentState } from '../../fixtures/equipment'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'equipment-client' }))

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 4, updatedAt: 100,
  inventory: { equipment: [{ id: 'armor-row', name: 'Light Armor' }] },
  equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
})
const offer = (): SheetItemActionOfferV1 => ({
  schemaVersion: 1,
  offerId: 'offer:equipment:light-armor',
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', revision: 4, label: 'Ash', href: '/sheets/trainers/ash' },
  source: {
    sourceSelectionId: `inventory-source:v1:${'1'.repeat(32)}`,
    containerKind: 'trainer', containerLabel: 'Trainer inventory',
    canonicalId: 'Light Armor', displayName: 'Light Armor', section: 'equipment',
    sectionLabel: 'Equipment', rowIndex: 0, rowLabel: 'Row 1', quantity: 1,
  },
  context: 'sheet', description: null, timingLabel: 'No sheet timing', costs: [],
  acceptanceNotice: 'No item use will be submitted.',
  availability: { enabled: false, unavailableReason: { code: 'action.unsupported', label: 'No item use.' } },
  actions: [
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Light%20Armor' },
    { kind: 'equip', label: 'Equip', enabled: true, unavailableReason: null, href: null },
  ],
  targeting: null,
})
const accepted = (command: EquipmentOperationCommandV1, exactReplay: boolean) => ({
  result: {
    schemaVersion: 1, operationId: command.operationId, commandKind: command.commandKind,
    status: 'accepted', exactReplay, canonicalItemId: 'Light Armor',
    equippedInstanceId: `equipped-item:v1:${'a'.repeat(32)}`, displacedCanonicalItemId: null,
    resources: [{ kind: 'sheet', sheetKind: 'trainer', slug: 'ash', beforeRevision: 4, afterRevision: 5 }],
  },
  sheets: [{
    kind: 'trainer', slug: 'ash', revision: 5, updatedAt: 200,
    sheet: { slug: 'ash', revision: 5, updatedAt: 200, name: 'Ash', inventory: { equipment: [] } },
  }],
  groupInventories: [],
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

describe('useTrainerEquipmentOperations', () => {
  it('builds the whole-item command, retains network uncertainty, and exact-retries without changing choices', async () => {
    const commands: EquipmentOperationCommandV1[] = []
    let attempt = 0
    configureApiClientForTests({
      getJson: vi.fn(),
      postJson: vi.fn(async (path, body) => {
        expect(path).toBe(EQUIPMENT_API_PATHS.operations)
        const command = (body as { command: EquipmentOperationCommandV1 }).command
        commands.push(command)
        attempt += 1
        if (attempt === 1) throw new TypeError('response lost')
        return accepted(command, true)
      }),
    })
    const sheet = ref(trainer())
    const prepareForAction = vi.fn(async () => undefined)
    const onAccepted = vi.fn()
    let actions!: ReturnType<typeof useTrainerEquipmentOperations>
    const Harness = defineComponent({
      setup() {
        actions = useTrainerEquipmentOperations({
          sheet, saveStatus: 'saved', profileId: null, prepareForAction, onAccepted,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await actions.equipRow(offer())
    expect(prepareForAction).toHaveBeenCalledOnce()
    expect(actions.status.value).toBe('uncertain')
    expect(commands[0]).toMatchObject({
      commandKind: 'equip',
      source: { rowId: 'armor-row', sourceInstanceId: 'item-instance:trainer:ash:equipment:armor-row', expectedRevision: 4 },
      destination: { ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'], expectedEquipmentRevision: 0 },
    })
    expect(loadPendingEquipmentOperation('ash')?.command).toEqual(commands[0])

    await actions.retryExact()
    await flush()
    expect(commands[1]).toEqual(commands[0])
    expect(actions.status.value).toBe('accepted')
    expect(actions.message.value).toContain('no item moved twice')
    expect(loadPendingEquipmentOperation('ash')).toBeNull()
    expect(onAccepted).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('builds a GM-only exact activity command from current full equipment authority', async () => {
    const commands: EquipmentOperationCommandV1[] = []
    configureApiClientForTests({
      getJson: vi.fn(),
      postJson: vi.fn(async (_path, body) => {
        const command = (body as { command: EquipmentOperationCommandV1 }).command
        commands.push(command)
        return accepted(command, false)
      }),
    })
    const current = trainer()
    current.equipmentState = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'body', canonicalItemId: 'Light Armor',
    })
    let actions!: ReturnType<typeof useTrainerEquipmentOperations>
    const wrapper = mount(defineComponent({
      setup() {
        actions = useTrainerEquipmentOperations({
          sheet: current, saveStatus: 'saved', profileId: null, canAdjudicateLifecycle: true,
        })
        return () => h('div')
      },
    }))
    const instanceId = current.equipmentState.instances[0]!.instanceId
    await actions.adjudicateLifecycle({
      instanceId,
      commandKind: 'suppress',
      note: 'Reviewed suppression evidence.',
    })
    expect(commands[0]).toMatchObject({
      commandKind: 'suppress', actorProfileId: null,
      source: {
        ownerKind: 'trainer', ownerSlug: 'ash', instanceId,
        expectedSheetRevision: 4, expectedEquipmentRevision: 0, expectedInstanceRevision: 0,
      },
      reason: { code: 'equipment.suppression.guided', sourceId: commands[0]!.operationId },
      guidance: { note: 'Reviewed suppression evidence.' },
    })
    expect(actions.status.value).toBe('accepted')
    wrapper.unmount()
  })

  it('fails closed before submission when no safe unconfigured slot can be selected', async () => {
    const postJson = vi.fn()
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const blocked = trainer()
    blocked.equipmentState = {
      ...blocked.equipmentState!,
      unresolved: [{
        issueId: `equipment-issue:v1:${'b'.repeat(32)}`, slotId: 'body', legacyDisplayName: 'Old Armor',
        reason: 'ambiguous-source', candidateCanonicalItemIds: ['Light Armor'], candidateSourceInstanceIds: [],
      }],
    }
    let actions!: ReturnType<typeof useTrainerEquipmentOperations>
    const wrapper = mount(defineComponent({
      setup() {
        actions = useTrainerEquipmentOperations({ sheet: blocked, saveStatus: 'saved', profileId: null })
        return () => h('div')
      },
    }))
    await actions.equipRow(offer())
    expect(actions.status.value).toBe('error')
    expect(actions.message.value).toContain('compatible')
    expect(postJson).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
