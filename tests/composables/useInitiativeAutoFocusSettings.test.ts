import { effectScope, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readStoredInitiativeAutoFocusEnabled,
  useInitiativeAutoFocusSettings,
  writeStoredInitiativeAutoFocusEnabled,
  type InitiativeAutoFocusStorage,
} from '~/composables/useInitiativeAutoFocusSettings'
import { INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY } from '~/utils/initiativeAutoFocusSettings'

const createUseStateStub = () => {
  const states = new Map<string, Ref<unknown>>()

  return <T>(key: string, init: () => T): Ref<T> => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key) as Ref<T>
  }
}

describe('useInitiativeAutoFocusSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes an enabled default and local toggle actions', () => {
    vi.stubGlobal('useState', createUseStateStub())
    const scope = effectScope()

    const settings = scope.run(() => useInitiativeAutoFocusSettings())!

    expect(settings.initiativeAutoFocusEnabled.value).toBe(true)
    expect(settings.initiativeAutoFocusStatusLabel.value).toBe('Auto-focus active initiative on')
    expect(settings.initiativeAutoFocusToggleLabel.value).toBe('Disable auto-focus active initiative')

    settings.toggleInitiativeAutoFocusEnabled()

    expect(settings.initiativeAutoFocusEnabled.value).toBe(false)
    expect(settings.initiativeAutoFocusStatusLabel.value).toBe('Auto-focus active initiative off')
    expect(settings.initiativeAutoFocusToggleLabel.value).toBe('Enable auto-focus active initiative')

    settings.setInitiativeAutoFocusEnabled(true)
    expect(settings.initiativeAutoFocusEnabled.value).toBe(true)

    scope.stop()
  })

  it('reads and writes browser storage without failing when storage is unavailable', () => {
    const storage: InitiativeAutoFocusStorage = {
      getItem: vi.fn(() => 'off'),
      setItem: vi.fn(),
    }

    expect(readStoredInitiativeAutoFocusEnabled(storage)).toBe(false)

    writeStoredInitiativeAutoFocusEnabled(true, storage)
    expect(storage.setItem).toHaveBeenCalledWith(
      INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY,
      'true',
    )

    const throwingStorage: InitiativeAutoFocusStorage = {
      getItem: vi.fn(() => { throw new Error('read failed') }),
      setItem: vi.fn(() => { throw new Error('write failed') }),
    }

    expect(readStoredInitiativeAutoFocusEnabled(throwingStorage)).toBeNull()
    expect(() => writeStoredInitiativeAutoFocusEnabled(false, throwingStorage)).not.toThrow()
    expect(readStoredInitiativeAutoFocusEnabled(null)).toBeNull()
    expect(() => writeStoredInitiativeAutoFocusEnabled(false, null)).not.toThrow()
  })
})
