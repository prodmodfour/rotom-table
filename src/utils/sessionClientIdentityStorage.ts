import {
  SESSION_CLIENT_IDENTITY_COOKIE,
  SESSION_CLIENT_IDENTITY_COOKIE_MAX_AGE_SECONDS,
  SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY,
  deserializeSessionClientIdentity,
  deserializeSessionClientIdentityCookieHint,
  serializeSessionClientIdentity,
  serializeSessionClientIdentityCookieHint,
  type SessionClientIdentity,
  type SessionClientIdentityCookieHint,
} from '#shared/sessionClientIdentity'

export interface SessionClientIdentityCookieOptions {
  readonly maxAgeSeconds?: number
  readonly path?: string
  readonly sameSite?: 'Lax' | 'Strict' | 'None'
  readonly secure?: boolean
}

export interface SessionClientIdentityStorageAdapter {
  readonly hasBrowser?: () => boolean
  readonly getLocalItem?: (key: string) => string | null
  readonly setLocalItem?: (key: string, value: string) => void
  readonly removeLocalItem?: (key: string) => void
  readonly getCookieString?: () => string
  readonly setCookieString?: (value: string) => void
}

export interface SessionClientIdentityStorageOptions {
  readonly storageKey?: string
  readonly cookieName?: string
  readonly cookie?: SessionClientIdentityCookieOptions
  readonly adapter?: SessionClientIdentityStorageAdapter
}

export interface SessionClientIdentityStorage {
  readonly remember: (identity: SessionClientIdentity) => boolean
  readonly load: () => SessionClientIdentity | null
  readonly readCookieHint: () => SessionClientIdentityCookieHint | null
  readonly clear: () => boolean
}

export const DEFAULT_SESSION_CLIENT_IDENTITY_COOKIE_OPTIONS: Required<
  Omit<SessionClientIdentityCookieOptions, 'secure'>
> & Pick<SessionClientIdentityCookieOptions, 'secure'> = {
  maxAgeSeconds: SESSION_CLIENT_IDENTITY_COOKIE_MAX_AGE_SECONDS,
  path: '/',
  sameSite: 'Lax',
  secure: false,
}

const defaultHasBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined'

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

const defaultGetCookieString = (): string =>
  typeof document === 'undefined' ? '' : document.cookie

const defaultSetCookieString = (value: string): void => {
  if (typeof document === 'undefined') return
  document.cookie = value
}

const resolveAdapter = (adapter: SessionClientIdentityStorageAdapter = {}) => ({
  hasBrowser: adapter.hasBrowser ?? defaultHasBrowser,
  getLocalItem: adapter.getLocalItem ?? defaultGetLocalItem,
  setLocalItem: adapter.setLocalItem ?? defaultSetLocalItem,
  removeLocalItem: adapter.removeLocalItem ?? defaultRemoveLocalItem,
  getCookieString: adapter.getCookieString ?? defaultGetCookieString,
  setCookieString: adapter.setCookieString ?? defaultSetCookieString,
})

const resolveCookieOptions = (
  cookie: SessionClientIdentityCookieOptions | undefined,
): Required<Omit<SessionClientIdentityCookieOptions, 'secure'>> & Pick<SessionClientIdentityCookieOptions, 'secure'> => ({
  ...DEFAULT_SESSION_CLIENT_IDENTITY_COOKIE_OPTIONS,
  ...cookie,
})

export const readCookieValue = (cookieHeader: string, name: string): string | null => {
  const expectedName = `${name}=`
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(expectedName)) return trimmed.slice(expectedName.length)
  }
  return null
}

export const buildSessionClientIdentitySetCookie = (
  encodedValue: string,
  name: string = SESSION_CLIENT_IDENTITY_COOKIE,
  options: SessionClientIdentityCookieOptions = {},
): string => {
  const cookieOptions = resolveCookieOptions(options)
  const attributes = [
    `${name}=${encodedValue}`,
    `Max-Age=${cookieOptions.maxAgeSeconds}`,
    `Path=${cookieOptions.path}`,
    `SameSite=${cookieOptions.sameSite}`,
  ]

  if (cookieOptions.secure) attributes.push('Secure')
  return attributes.join('; ')
}

export const buildSessionClientIdentityClearCookie = (
  name: string = SESSION_CLIENT_IDENTITY_COOKIE,
  options: SessionClientIdentityCookieOptions = {},
): string => {
  const cookieOptions = resolveCookieOptions({ ...options, maxAgeSeconds: 0 })
  const attributes = [
    `${name}=`,
    'Max-Age=0',
    `Path=${cookieOptions.path}`,
    `SameSite=${cookieOptions.sameSite}`,
  ]

  if (cookieOptions.secure) attributes.push('Secure')
  return attributes.join('; ')
}

export const createSessionClientIdentityStorage = (
  options: SessionClientIdentityStorageOptions = {},
): SessionClientIdentityStorage => {
  const adapter = resolveAdapter(options.adapter)
  const storageKey = options.storageKey ?? SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY
  const cookieName = options.cookieName ?? SESSION_CLIENT_IDENTITY_COOKIE
  const cookieOptions = options.cookie

  const hasBrowser = (): boolean => adapter.hasBrowser()

  const remember = (identity: SessionClientIdentity): boolean => {
    if (!hasBrowser()) return false

    const serialized = serializeSessionClientIdentity(identity)
    const encodedCookie = serializeSessionClientIdentityCookieHint(identity)
    adapter.setLocalItem(storageKey, serialized)
    adapter.setCookieString(buildSessionClientIdentitySetCookie(encodedCookie, cookieName, cookieOptions))
    return true
  }

  const load = (): SessionClientIdentity | null => {
    if (!hasBrowser()) return null

    const serialized = adapter.getLocalItem(storageKey)
    if (serialized === null) return null

    const result = deserializeSessionClientIdentity(serialized)
    if (result.ok) return result.identity

    adapter.removeLocalItem(storageKey)
    return null
  }

  const readCookieHint = (): SessionClientIdentityCookieHint | null => {
    if (!hasBrowser()) return null

    const encodedCookie = readCookieValue(adapter.getCookieString(), cookieName)
    if (encodedCookie === null) return null

    const result = deserializeSessionClientIdentityCookieHint(encodedCookie)
    if (result.ok) return result.identity

    adapter.setCookieString(buildSessionClientIdentityClearCookie(cookieName, cookieOptions))
    return null
  }

  const clear = (): boolean => {
    if (!hasBrowser()) return false

    adapter.removeLocalItem(storageKey)
    adapter.setCookieString(buildSessionClientIdentityClearCookie(cookieName, cookieOptions))
    return true
  }

  return { remember, load, readCookieHint, clear }
}

export const sessionClientIdentityStorage = createSessionClientIdentityStorage()
