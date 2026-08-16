/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useGroupInventoryItemActions } from '~/composables/useGroupInventoryItemActions'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingGroupItemOperation } from '~/utils/groupItemOperationStorage'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'group-item-client' }))

const actorId = `group-item-actor:v1:${'a'.repeat(32)}`
const offerId = `sheet-item-offer:v1:${'b'.repeat(32)}`
const sourceSelectionId = `inventory-source:v1:${'c'.repeat(32)}`
const targetId = 'sheet-target:v1:pokemon:pikachu'
const offer = () => ({
  schemaVersion: 1 as const,
  offerId,
  actor: { sheetKind: 'trainer' as const, sheetSlug: 'ash', revision: 3, label: 'Ash', href: '/sheets/trainers/ash' },
  source: {
    sourceSelectionId,
    containerKind: 'group' as const, containerLabel: 'Group inventory' as const,
    canonicalId: 'Potion', displayName: 'Potion', section: 'medicalKit' as const,
    sectionLabel: 'Medical Kit', rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
  },
  context: 'sheet' as const,
  description: 'Restore Hit Points.', timingLabel: 'Outside encounter', costs: [],
  acceptanceNotice: 'Consumes 1 when accepted.',
  availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use' as const, label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect' as const, label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Potion' },
  ],
  targeting: {
    requirementId: 'target', minimum: 1, maximum: 1,
    options: [{
      targetId, sheetKind: 'pokemon' as const, sheetSlug: 'pikachu', label: 'Pikachu', kindLabel: 'Pokémon' as const,
      summary: 'HP 7 / 30', description: 'Restore 20 HP.', href: '/sheets/pikachu', enabled: true,
      unavailableReason: null, previewFacts: [], choices: [],
    }],
  },
})
const projection = (selected = actorId) => ({
  schemaVersion: 1 as const,
  groupSlug: 'main', groupRevision: 4, generatedAt: 100,
  selectedActorSelectionId: selected,
  actors: [{ actorSelectionId: actorId, label: 'Ash', revision: 3, selected: selected === actorId }],
  offers: selected === actorId ? [offer()] : [],
})
const authorized = () => ({
  schemaVersion: 1 as const,
  groupSlug: 'main', groupRevision: 4, actorSelectionId: actorId,
  offer: {
    ...offer(),
    itemCommand: {
      schemaVersion: 1 as const,
      operationId: 'template:item-operation', context: 'sheet' as const, offerId,
      sourceInstanceId: 'item-instance:group:main:medicalKit:private-row', actorParticipantId: null,
      actorSheet: { kind: 'trainer' as const, slug: 'ash', expectedRevision: 3 },
      source: { kind: 'group' as const, slug: 'main', section: 'medicalKit' as const, rowId: 'private-row', expectedRevision: 4 },
      targetIds: [], choices: [],
      readSet: [
        { kind: 'campaign-clock' as const, id: 'campaign', revision: 0 },
        { kind: 'group-inventory' as const, id: 'main', revision: 4 },
        { kind: 'sheet' as const, sheetKind: 'pokemon' as const, id: 'pikachu', revision: 2 },
        { kind: 'sheet' as const, sheetKind: 'trainer' as const, id: 'ash', revision: 3 },
      ],
    },
  },
})
const group = (revision = 4) => {
  const document = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
  document.revision = revision
  document.updatedAt = revision === 4 ? 10 : 101
  document.inventory.medicalKit = [{ id: 'private-row', name: 'Potion', qty: revision === 4 ? 2 : 1 }]
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

describe('useGroupInventoryItemActions', () => {
  it('loads safe actor offers, preserves one exact uncertain command, retries it, and adopts accepted group authority', async () => {
    const commands: unknown[] = []
    let uses = 0
    const getJson = vi.fn().mockResolvedValue(projection())
    const postJson = vi.fn(async (path: string, body: unknown) => {
      if (path === ITEM_API_PATHS.declareGroupAction) return authorized()
      const command = (body as { command: Record<string, unknown> }).command
      commands.push(command)
      uses += 1
      if (uses === 1) throw new TypeError('response lost')
      return {
        result: {
          schemaVersion: 1, operationId: command.operationId, status: 'accepted', canonicalItemId: 'Potion',
          aggregateRefs: [
            { kind: 'group-inventory', id: 'main', revision: 5 },
            { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 3 },
          ],
          receiptId: `item-receipt:${command.operationId}`, exactReplay: true,
        },
        sheets: [{
          kind: 'pokemon', slug: 'pikachu', revision: 3, updatedAt: 101,
          sheet: { slug: 'pikachu', revision: 3, nickname: 'Pikachu' },
        }],
        groupInventory: group(5),
      }
    })
    configureApiClientForTests({ getJson, postJson })
    vi.stubGlobal('crypto', {
      randomUUID: () => '09090909-0909-0909-0909-090909090909',
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(9); return bytes },
    })
    const document = ref(group())
    const onAccepted = vi.fn()
    let actions!: ReturnType<typeof useGroupInventoryItemActions>
    const Harness = defineComponent({
      setup() {
        actions = useGroupInventoryItemActions({
          document, hasUnsavedEdits: () => false, externallyBlocked: () => false,
          profileId: () => 'profile_group_item_01', onAccepted,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    expect(getJson).toHaveBeenCalledWith(ITEM_API_PATHS.groupActions, {
      params: { groupSlug: 'main', profileId: 'profile_group_item_01' },
    })
    expect(actions.projection.value?.actors).toEqual([
      expect.objectContaining({ actorSelectionId: actorId, label: 'Ash', selected: true }),
    ])

    actions.openOffer(actions.projection.value!.offers[0]!)
    actions.chooseTarget(targetId)
    await actions.submit()
    expect(actions.status.value).toBe('uncertain')
    expect(actions.mutationBlocked.value).toBe(true)
    expect(loadPendingGroupItemOperation('main')).toMatchObject({
      profileId: 'profile_group_item_01',
      command: {
        operationId: `group-sheet-item:v1:${'09'.repeat(16)}`,
        source: { kind: 'group', slug: 'main', rowId: 'private-row', expectedRevision: 4 },
        targetIds: [targetId],
      },
    })

    await actions.retryExact()
    expect(commands[1]).toEqual(commands[0])
    expect(actions.status.value).toBe('accepted')
    expect(actions.message.value).toContain('recovered without consuming it twice')
    expect(actions.acceptedSheetLinks.value).toEqual([{ href: '/sheets/pikachu', label: 'Pikachu' }])
    expect(loadPendingGroupItemOperation('main')).toBeNull()
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({
      groupInventory: expect.objectContaining({ slug: 'main', revision: 5 }),
    }))
    wrapper.unmount()
  })

  it('blocks source use across unsaved edits and another exact inventory mutation', async () => {
    configureApiClientForTests({ getJson: vi.fn().mockResolvedValue(projection()), postJson: vi.fn() })
    const dirty = ref(false)
    const blocked = ref(false)
    let actions!: ReturnType<typeof useGroupInventoryItemActions>
    const Harness = defineComponent({
      setup() {
        actions = useGroupInventoryItemActions({
          document: group(), hasUnsavedEdits: dirty, externallyBlocked: blocked, profileId: () => null,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    await flush()
    dirty.value = true
    expect(actions.canBegin.value).toBe(false)
    actions.openOffer(actions.projection.value!.offers[0]!)
    expect(actions.selectedOffer.value).toBeNull()
    dirty.value = false
    blocked.value = true
    await flush()
    expect(actions.canBegin.value).toBe(false)
    wrapper.unmount()
  })
})
