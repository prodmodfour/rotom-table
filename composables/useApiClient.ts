import { createApiClient, type ApiClient, type ApiFetch, type ApiFetchOptions } from '~/utils/apiClient'

const nuxtFetch: ApiFetch = <T = unknown>(request: string, options?: ApiFetchOptions): Promise<T> =>
  ($fetch as unknown as ApiFetch)<T>(request, options)

export const useApiClient = (): ApiClient => createApiClient(nuxtFetch)
