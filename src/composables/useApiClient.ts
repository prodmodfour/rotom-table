import { createApiClient, type ApiClient, type ApiFetch, type ApiFetchOptions } from '~/utils/apiClient'

type NuxtApiFetchOptions = ApiFetchOptions & { credentials?: RequestCredentials }
type NuxtApiFetch = <T = unknown>(request: string, options?: NuxtApiFetchOptions) => Promise<T>

const sameOriginOptions = (options?: ApiFetchOptions): NuxtApiFetchOptions => ({
  ...options,
  credentials: 'same-origin',
})

const resolveNuxtFetch = (): NuxtApiFetch => {
  // During SSR, plain $fetch does not inherit the browser request cookies.
  // useRequestFetch forwards them so authenticated API routes keep the
  // already-selected GM/player role through HMR and server renders.
  if (import.meta.server) return useRequestFetch() as unknown as NuxtApiFetch
  return $fetch as unknown as NuxtApiFetch
}

const nuxtFetch: ApiFetch = <T = unknown>(request: string, options?: ApiFetchOptions): Promise<T> =>
  resolveNuxtFetch()<T>(request, sameOriginOptions(options))

let apiClientOverride: ApiClient | null | undefined

export const configureApiClientForTests = (apiClient: ApiClient | null): void => {
  apiClientOverride = apiClient
}

export const resetApiClientForTests = (): void => {
  apiClientOverride = undefined
}

export const useApiClient = (): ApiClient => apiClientOverride ?? createApiClient(nuxtFetch)
