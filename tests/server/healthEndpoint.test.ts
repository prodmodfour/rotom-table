import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import healthRoute from '~~/server/api/health.get'

type HealthResponse = {
  ok: true
  service: 'rotom-table'
}

type HealthRouteHandler = EventHandler<EventHandlerRequest, HealthResponse>

const invokeHealthRoute = async (): Promise<HealthResponse> => (
  healthRoute as HealthRouteHandler
)({} as H3Event)

describe('health endpoint', () => {
  it('returns a small no-secret service status', async () => {
    const status = await invokeHealthRoute()

    expect(status).toEqual({
      ok: true,
      service: 'rotom-table',
    })
    expect(Object.keys(status).sort()).toEqual(['ok', 'service'])
    expect(JSON.stringify(status)).not.toMatch(/secret|token|password|campaign|player|path/i)
  })
})
