import { describe, expect, it } from 'vitest'
import { createApiClient, type ApiFetch, type ApiFetchOptions } from '~/utils/apiClient'

const createRecordingFetch = (response: unknown) => {
  const calls: Array<{ request: string; options?: ApiFetchOptions }> = []
  const fetcher: ApiFetch = async <T = unknown>(request: string, options?: ApiFetchOptions): Promise<T> => {
    calls.push({ request, options })
    return response as T
  }
  return { fetcher, calls }
}

describe('apiClient', () => {
  it('delegates GET requests without options when no params are provided', async () => {
    const { fetcher, calls } = createRecordingFetch({ ok: true })
    const client = createApiClient(fetcher)

    await expect(client.getJson('/api/example')).resolves.toEqual({ ok: true })
    expect(calls).toEqual([{ request: '/api/example', options: undefined }])
  })

  it('passes query params for GET requests', async () => {
    const { fetcher, calls } = createRecordingFetch({ items: [] })
    const client = createApiClient(fetcher)

    await client.getJson('/api/example', { params: { slug: 'airship', visible: true } })

    expect(calls).toEqual([{
      request: '/api/example',
      options: { params: { slug: 'airship', visible: true } },
    }])
  })

  it('sends POST requests with the shared JSON body shape', async () => {
    const { fetcher, calls } = createRecordingFetch({ saved: true })
    const client = createApiClient(fetcher)
    const body = { slug: 'airship', clientId: 'client-1' }

    await expect(client.postJson('/api/save', body)).resolves.toEqual({ saved: true })

    expect(calls).toEqual([{
      request: '/api/save',
      options: {
        method: 'POST',
        body,
      },
    }])
  })
})
