/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { EquipmentOperationCommandV1 } from '#shared/itemAutomation/equipmentOperations'
import type { CharacterSheet } from '~/types/characterSheet'
import { activeEquipmentState } from '../../fixtures/equipment'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useEquipmentLifecycleOperations } from '~/composables/sheets/useEquipmentLifecycleOperations'
import { EQUIPMENT_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingEquipmentLifecycleOperation } from '~/utils/equipmentLifecycleOperationStorage'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'lifecycle-client' }))

const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 10,
  revision: 4, updatedAt: 100,
  equipmentState: activeEquipmentState({
    ownerKind: 'pokemon', ownerSlug: 'pikachu', slotId: 'held', canonicalItemId: 'Safety Goggles',
  }),
} as CharacterSheet)
const response = (command: EquipmentOperationCommandV1) => ({
  result: {
    schemaVersion: 1, operationId: command.operationId, commandKind: command.commandKind,
    status: 'accepted', exactReplay: true, canonicalItemId: 'Safety Goggles',
    equippedInstanceId: `equipped-item:v1:${'a'.repeat(32)}`, displacedCanonicalItemId: null,
    resources: [{ kind: 'sheet', sheetKind: 'pokemon', slug: 'pikachu', beforeRevision: 4, afterRevision: 5 }],
  },
  sheets: [{
    kind: 'pokemon', slug: 'pikachu', revision: 5, updatedAt: 200,
    sheet: { slug: 'pikachu', revision: 5, updatedAt: 200 },
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
  vi.restoreAllMocks()
})

describe('useEquipmentLifecycleOperations', () => {
  it('persists and exact-retries a GM Pokémon lifecycle command without regenerating its reason', async () => {
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
        return response(command)
      }),
    })
    const sheet = ref(pokemon())
    const prepareForAction = vi.fn(async () => undefined)
    let lifecycle!: ReturnType<typeof useEquipmentLifecycleOperations>
    const wrapper = mount(defineComponent({
      setup() {
        lifecycle = useEquipmentLifecycleOperations({
          sheet, saveStatus: 'saved', canAdjudicate: true, prepareForAction,
        })
        return () => h('div')
      },
    }))
    const instanceId = sheet.value.equipmentState!.instances[0]!.instanceId
    await lifecycle.adjudicate({
      instanceId,
      commandKind: 'break',
      note: 'The GM reviewed an accepted narrative break event.',
    })
    expect(prepareForAction).toHaveBeenCalledOnce()
    expect(lifecycle.status.value).toBe('uncertain')
    expect(commands[0]).toMatchObject({
      commandKind: 'break',
      actorProfileId: null,
      source: { ownerKind: 'pokemon', ownerSlug: 'pikachu', instanceId },
      reason: { code: 'equipment.breakage.narrative', sourceId: commands[0]!.operationId },
      guidance: { kind: 'guided-adjudication', note: 'The GM reviewed an accepted narrative break event.' },
    })
    expect(loadPendingEquipmentLifecycleOperation('pokemon', 'pikachu')?.command).toEqual(commands[0])

    await lifecycle.retryExact()
    await flush()
    expect(commands[1]).toEqual(commands[0])
    expect(lifecycle.status.value).toBe('accepted')
    expect(lifecycle.message.value).toContain('no equipment change was applied twice')
    expect(loadPendingEquipmentLifecycleOperation('pokemon', 'pikachu')).toBeNull()
    wrapper.unmount()
  })

  it('does not submit when GM adjudication is unavailable', async () => {
    const postJson = vi.fn()
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const sheet = pokemon()
    let lifecycle!: ReturnType<typeof useEquipmentLifecycleOperations>
    const wrapper = mount(defineComponent({
      setup() {
        lifecycle = useEquipmentLifecycleOperations({ sheet, saveStatus: 'saved', canAdjudicate: false })
        return () => h('div')
      },
    }))
    await lifecycle.adjudicate({
      instanceId: sheet.equipmentState!.instances[0]!.instanceId,
      commandKind: 'suppress',
      note: 'Not authorised.',
    })
    expect(postJson).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
