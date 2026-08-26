import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../../server/useCases/loadEncounterBuilderHandoff', () => ({ loadEncounterBuilderHandoffUseCase: mocks.load }))
const route = (await import('../../server/api/gm-toolkit/builder-handoff.get')).default as EventHandler<EventHandlerRequest, unknown>

const invoke = async (role: 'gm' | 'player', query: Record<string, string>): Promise<unknown> => {
  const search = new URLSearchParams(query).toString()
  const path = `/api/gm-toolkit/builder-handoff?${search}`
  return route({ method: 'GET', path, node: { req: { url: path, headers: { cookie: `rotom-role=${role}` } } }, context: {} } as unknown as H3Event)
}

describe('GM Builder handoff route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.load.mockReturnValue({ schemaVersion: 1, handoff: { source: { label: 'Forest Session' } } }) })

  it('structurally denies preparation and package handoffs to players', async () => {
    await expect(invoke('player', { kind: 'session-preparation', documentId: 'session-preparation:v1:forest', expectedRevision: '3', sceneId: 'scene:forest' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('passes one typed reference with a numeric expected revision to GM authority', async () => {
    await expect(invoke('gm', { kind: 'session-preparation', documentId: 'session-preparation:v1:forest', expectedRevision: '3', sceneId: 'scene:forest' })).resolves.toEqual({ schemaVersion: 1, handoff: { source: { label: 'Forest Session' } } })
    expect(mocks.load).toHaveBeenCalledWith({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest', expectedRevision: 3, sceneId: 'scene:forest' })
  })
})
