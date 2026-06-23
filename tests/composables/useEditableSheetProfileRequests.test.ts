import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import { useEditableSheet } from '~/composables/useEditableSheet'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE, sheetApiProfileContext } from '~/utils/sheetApiRequests'

const mocks = vi.hoisted(() => ({
  postJson: vi.fn(),
  subscriptions: [] as Array<{ channel: string; handler: (event: unknown) => void }>,
}))

vi.mock('~/utils/clientId', () => ({
  getClientId: () => 'sheet-client',
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    postJson: mocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: vi.fn((channel: string, handler: (event: unknown) => void) => {
    mocks.subscriptions.push({ channel, handler })
    return vi.fn()
  }),
}))

interface TestSheet {
  slug: string
  nickname: string
  level: number
  playerProfileAccessible?: boolean
  sessionPlayerAccessible?: boolean
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useEditableSheet profile-aware requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.postJson.mockReset()
    mocks.subscriptions.length = 0
    mocks.postJson.mockImplementation(async (_path: string, body: { sheet?: TestSheet }) => ({
      ok: true,
      sheet: body.sheet,
    }))
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('includes the selected player profile id on linked sheet autosaves without persisting runtime access flags', async () => {
    const profileId = parsePlayerProfileId('profile_ash00000')
    const editable = useEditableSheet<TestSheet>(
      {
        slug: 'pikachu',
        nickname: 'Pikachu',
        level: 5,
        playerProfileAccessible: true,
        sessionPlayerAccessible: true,
      },
      'pokemon',
      {
        debounceMs: 10,
        profileContext: () => sheetApiProfileContext(true, profileId),
      },
    )

    editable.sheet.value.level = 6
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(mocks.postJson).toHaveBeenCalledWith(SHEET_API_PATHS.save, {
      kind: 'pokemon',
      slug: 'pikachu',
      interactionMode: 'setup-edit',
      sheet: { revision: 0, slug: 'pikachu', nickname: 'Pikachu', level: 6 },
      expectedRevision: 0,
      clientId: 'sheet-client',
      profileId,
      allowSlugSync: false,
    })
    expect(editable.saveStatus.value).toBe('saved')
    expect(editable.saveError.value).toBeNull()
  })

  it('prevents legacy display-name slug mismatches from renaming on open or unrelated edits', async () => {
    const editable = useEditableSheet<TestSheet>(
      { slug: 'examples-abra', nickname: 'Abra', level: 5 },
      'pokemon',
      { debounceMs: 10 },
    )

    await flushPromises()
    expect(mocks.postJson).not.toHaveBeenCalled()

    editable.sheet.value.level = 6
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(mocks.postJson).toHaveBeenCalledWith(SHEET_API_PATHS.save, {
      kind: 'pokemon',
      slug: 'examples-abra',
      interactionMode: 'setup-edit',
      sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra', level: 6 },
      expectedRevision: 0,
      clientId: 'sheet-client',
      allowSlugSync: false,
    })
  })

  it('allows slug sync when the sheet display name changes after opening', async () => {
    const editable = useEditableSheet<TestSheet>(
      { slug: 'examples-abra', nickname: 'Abra', level: 5 },
      'pokemon',
      { debounceMs: 10 },
    )

    editable.sheet.value.nickname = 'Abra Prime'
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(mocks.postJson).toHaveBeenCalledWith(SHEET_API_PATHS.save, {
      kind: 'pokemon',
      slug: 'examples-abra',
      interactionMode: 'setup-edit',
      sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra Prime', level: 5 },
      expectedRevision: 0,
      clientId: 'sheet-client',
    })
  })

  it('shows a clear save error instead of posting a linked sheet without a selected profile', async () => {
    const editable = useEditableSheet<TestSheet>(
      { slug: 'pikachu', nickname: 'Pikachu', level: 5 },
      'pokemon',
      {
        debounceMs: 10,
        profileContext: () => sheetApiProfileContext(true, null),
        requiresSelectedPlayerProfile: () => true,
      },
    )

    editable.sheet.value.level = 6
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(mocks.postJson).not.toHaveBeenCalled()
    expect(editable.saveStatus.value).toBe('error')
    expect(editable.saveError.value).toBe(PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE)
  })
})
