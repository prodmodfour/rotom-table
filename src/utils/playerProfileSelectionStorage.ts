import {
  PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY,
  deserializeRememberedPlayerProfileSelection,
  serializeRememberedPlayerProfileSelection,
  type RememberedPlayerProfileSelection,
} from '#shared/playerProfiles'

export interface PlayerProfileSelectionStorageAdapter {
  readonly hasBrowser?: () => boolean
  readonly getLocalItem?: (key: string) => string | null
  readonly setLocalItem?: (key: string, value: string) => void
  readonly removeLocalItem?: (key: string) => void
}

export interface PlayerProfileSelectionStorageOptions {
  readonly storageKey?: string
  readonly adapter?: PlayerProfileSelectionStorageAdapter
}

export interface PlayerProfileSelectionStorage {
  readonly remember: (selection: RememberedPlayerProfileSelection) => boolean
  readonly load: () => RememberedPlayerProfileSelection | null
  readonly clear: () => boolean
}

const defaultHasBrowser = (): boolean => typeof window !== 'undefined'

const defaultGetLocalItem = (key: string): string | null => {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

const defaultSetLocalItem = (key: string, value: string): void => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value)
}

const defaultRemoveLocalItem = (key: string): void => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
}

const resolveAdapter = (adapter: PlayerProfileSelectionStorageAdapter = {}) => ({
  hasBrowser: adapter.hasBrowser ?? defaultHasBrowser,
  getLocalItem: adapter.getLocalItem ?? defaultGetLocalItem,
  setLocalItem: adapter.setLocalItem ?? defaultSetLocalItem,
  removeLocalItem: adapter.removeLocalItem ?? defaultRemoveLocalItem,
})

export const createPlayerProfileSelectionStorage = (
  options: PlayerProfileSelectionStorageOptions = {},
): PlayerProfileSelectionStorage => {
  const adapter = resolveAdapter(options.adapter)
  const storageKey = options.storageKey ?? PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY

  const hasBrowser = (): boolean => adapter.hasBrowser()

  const remember = (selection: RememberedPlayerProfileSelection): boolean => {
    if (!hasBrowser()) return false

    adapter.setLocalItem(storageKey, serializeRememberedPlayerProfileSelection(selection))
    return true
  }

  const load = (): RememberedPlayerProfileSelection | null => {
    if (!hasBrowser()) return null

    const serialized = adapter.getLocalItem(storageKey)
    if (serialized === null) return null

    const result = deserializeRememberedPlayerProfileSelection(serialized)
    if (result.ok) return result.selection

    adapter.removeLocalItem(storageKey)
    return null
  }

  const clear = (): boolean => {
    if (!hasBrowser()) return false

    adapter.removeLocalItem(storageKey)
    return true
  }

  return { remember, load, clear }
}

export const playerProfileSelectionStorage = createPlayerProfileSelectionStorage()
