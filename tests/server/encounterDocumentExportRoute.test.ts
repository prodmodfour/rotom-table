import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exportEncounterDocumentUseCase: vi.fn() }))
vi.mock('../../server/useCases/encounterDocuments', () => ({
  exportEncounterDocumentUseCase: mocks.exportEncounterDocumentUseCase,
}))
const route = (await import('../../server/api/encounter-documents/export.get')).default

type Handler = EventHandler<EventHandlerRequest, unknown>
const invoke = async (handler: Handler, role?: 'gm' | 'player') => {
  const headers: Record<string, string> = {}
  if (role) headers.cookie = `rotom-role=${role}`
  const responseHeaders: Record<string, string> = {}
  const response = await handler({
    method: 'GET', path: '/api/encounter-documents/export?encounterId=canal-ambush',
    node: {
      req: { headers, url: '/api/encounter-documents/export?encounterId=canal-ambush' },
      res: { setHeader: (name: string, value: string) => { responseHeaders[name.toLowerCase()] = value } },
    },
  } as unknown as H3Event)
  return { response, responseHeaders }
}

describe('encounter document export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exportEncounterDocumentUseCase.mockReturnValue({
      schemaVersion: 1,
      format: 'rotom-table.encounter-document',
      exportedAt: 100,
      documentSha256: 'a'.repeat(64),
      document: { encounterId: 'canal-ambush' },
    })
  })

  it('keeps private backups GM-only', async () => {
    await expect(invoke(route)).rejects.toMatchObject({ statusCode: 401 })
    await expect(invoke(route, 'player')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.exportEncounterDocumentUseCase).not.toHaveBeenCalled()
  })

  it('returns a private no-store attachment for an authorized GM', async () => {
    const result = await invoke(route, 'gm')
    expect(mocks.exportEncounterDocumentUseCase).toHaveBeenCalledWith('canal-ambush')
    expect(result.response).toMatchObject({ format: 'rotom-table.encounter-document' })
    expect(result.responseHeaders['content-disposition']).toContain('canal-ambush.encounter.json')
    expect(result.responseHeaders['cache-control']).toBe('private, no-store')
  })
})
