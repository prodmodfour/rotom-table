import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { useGroupInventoryTransfers } from '~/composables/useGroupInventoryTransfers'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { GROUP_INVENTORY_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import { createDefaultGroupInventoryDocument, type GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { ApiClient } from '~/utils/apiClient'

const groupInventoryFixture = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => {
  const document = createDefaultGroupInventoryDocument({ now: 1_700_000_000_000 })
  return {
    ...document,
    revision: 3,
    updatedAt: 1_700_000_000_000,
    inventory: {
      ...document.inventory,
      pokemonItems: [
        { id: 'potion-row', name: 'Potion', qty: 2, cost: '$200' },
      ],
    },
    ...overrides,
  }
}

const trainerFixture = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 5,
  revision: 8,
  inventory: {
    pokemonItems: [
      { name: 'Antidote', qty: 1, cost: '$200' },
    ],
  },
  ...overrides,
})

const createMockApiClient = (methods: {
  getJson?: ReturnType<typeof vi.fn>
  postJson?: ReturnType<typeof vi.fn>
}): ApiClient => ({
  getJson: (methods.getJson ?? vi.fn()) as ApiClient['getJson'],
  postJson: (methods.postJson ?? vi.fn()) as ApiClient['postJson'],
})

describe('useGroupInventoryTransfers', () => {
  beforeEach(() => {
    resetApiClientForTests()
  })

  afterEach(() => {
    resetApiClientForTests()
  })

  it('loads eligible trainers and adopts authoritative transfer responses only after the API resolves', async () => {
    const groupInventory = ref<GroupInventoryDocument | null>(groupInventoryFixture())
    const adopted: GroupInventoryDocument[] = []
    const getJson = vi.fn(async () => ({ trainerSheets: [trainerFixture()] }))
    let resolveTransfer!: (response: unknown) => void
    const transferResponse = new Promise<unknown>((resolve) => {
      resolveTransfer = resolve
    })
    const postJson = vi.fn(() => transferResponse)
    configureApiClientForTests(createMockApiClient({ getJson, postJson }))

    const transfers = useGroupInventoryTransfers({
      groupInventoryDocument: groupInventory,
      adoptGroupInventoryDocument: (document) => {
        adopted.push(document)
        groupInventory.value = document
      },
      isGm: ref(true),
      isPlayer: ref(false),
      selectedProfileId: ref(null),
      transferBlocked: ref(false),
      autoLoadTrainers: false,
    })

    await transfers.loadTrainers()

    expect(getJson).toHaveBeenCalledWith(SHEET_API_PATHS.list, undefined)
    expect(transfers.eligibleTrainers.value.map((trainer) => trainer.slug)).toEqual(['ash'])

    const transferPromise = transfers.transferToTrainer({
      trainerSlug: 'ash',
      section: 'pokemonItems',
      itemId: 'potion-row',
      quantity: 1,
    })
    await Promise.resolve()

    expect(transfers.transferStatus.value).toBe('loading')
    expect(groupInventory.value?.revision).toBe(3)
    expect(groupInventory.value?.inventory.pokemonItems?.[0]?.qty).toBe(2)
    expect(postJson).toHaveBeenCalledWith(GROUP_INVENTORY_API_PATHS.transferToTrainer, {
      groupSlug: 'main',
      groupRevision: 3,
      trainerSlug: 'ash',
      trainerRevision: 8,
      section: 'pokemonItems',
      itemId: 'potion-row',
      quantity: 1,
    })

    const authoritativeGroupInventory = groupInventoryFixture({
      revision: 4,
      inventory: {
        ...groupInventoryFixture().inventory,
        pokemonItems: [
          { id: 'potion-row', name: 'Potion', qty: 1, cost: '$200' },
        ],
      },
    })
    resolveTransfer({
      ok: true,
      groupInventory: authoritativeGroupInventory,
      trainerSheet: {
        kind: 'trainer',
        slug: 'ash',
        sheet: trainerFixture({
          revision: 9,
          inventory: {
            pokemonItems: [
              { name: 'Antidote', qty: 1, cost: '$200' },
              { name: 'Potion', qty: 1, cost: '$200' },
            ],
          },
        }),
      },
    })
    await transferPromise

    expect(adopted).toEqual([authoritativeGroupInventory])
    expect(groupInventory.value).toEqual(authoritativeGroupInventory)
    expect(transfers.trainerSheets.value[0]?.revision).toBe(9)
    expect(transfers.trainerSheets.value[0]?.inventory?.pokemonItems).toHaveLength(2)
    expect(transfers.transferStatus.value).toBe('success')
    expect(transfers.transferNotice.value).toContain('Transferred inventory to Ash')
  })

  it('filters player transfers to profile-linked trainers and rejects unlinked choices before posting', async () => {
    const groupInventory = ref<GroupInventoryDocument | null>(groupInventoryFixture())
    const getJson = vi.fn(async () => ({
      trainerSheets: [
        trainerFixture({ playerProfileAccessible: true }),
        trainerFixture({ slug: 'misty', name: 'Misty', revision: 2 }),
      ],
    }))
    const postJson = vi.fn()
    configureApiClientForTests(createMockApiClient({ getJson, postJson }))

    const transfers = useGroupInventoryTransfers({
      groupInventoryDocument: groupInventory,
      adoptGroupInventoryDocument: (document) => {
        groupInventory.value = document
      },
      isGm: ref(false),
      isPlayer: ref(true),
      selectedProfileId: ref('profile_12345678' as PlayerProfileId),
      transferBlocked: ref(false),
      autoLoadTrainers: false,
    })

    await transfers.loadTrainers()

    expect(getJson).toHaveBeenCalledWith(SHEET_API_PATHS.list, { params: { profileId: 'profile_12345678' } })
    expect(transfers.eligibleTrainers.value.map((trainer) => trainer.slug)).toEqual(['ash'])

    await transfers.transferToTrainer({
      trainerSlug: 'misty',
      section: 'pokemonItems',
      itemId: 'potion-row',
      quantity: 1,
    })

    expect(postJson).not.toHaveBeenCalled()
    expect(transfers.transferStatus.value).toBe('error')
    expect(transfers.transferError.value).toBe('Selected trainer is not eligible for group inventory transfers.')
    expect(groupInventory.value?.revision).toBe(3)
  })
})
