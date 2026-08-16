export type ApiRequestParams = Record<string, string | number | boolean | null | undefined>

export interface ApiGetOptions {
  params?: ApiRequestParams
}

export interface ApiFetchOptions extends ApiGetOptions {
  method?: 'GET' | 'POST'
  body?: unknown
}

export type ApiFetch = <T = unknown>(request: string, options?: ApiFetchOptions) => Promise<T>

export interface ApiClient {
  getJson: <T = unknown>(request: string, options?: ApiGetOptions) => Promise<T>
  postJson: <T = unknown>(request: string, body: unknown, options?: ApiGetOptions) => Promise<T>
}

export const createApiClient = (fetcher: ApiFetch): ApiClient => ({
  getJson: <T = unknown>(request: string, options: ApiGetOptions = {}) => {
    const hasParams = options.params !== undefined
    return fetcher<T>(request, hasParams ? { params: options.params } : undefined)
  },
  postJson: <T = unknown>(request: string, body: unknown, options: ApiGetOptions = {}) => fetcher<T>(request, {
    method: 'POST',
    body,
    ...(options.params ? { params: options.params } : {}),
  }),
})
