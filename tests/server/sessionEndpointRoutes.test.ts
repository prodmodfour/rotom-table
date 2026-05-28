import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import assignmentsRoute from '~~/server/api/sessions/assignments.post'
import joinRoute from '~~/server/api/sessions/join.post'
import manageRoute from '~~/server/api/sessions/manage.post'
import playerStateRoute from '~~/server/api/sessions/player-state.post'
import startRoute from '~~/server/api/sessions/start.post'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'

const disabledMessage = 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.'

type SessionRouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeRoute = async (handler: SessionRouteHandler) => handler({} as H3Event)

describe('live session endpoint runtime gate', () => {
  it('fails closed before lobby endpoint handlers read or mutate session state', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, '')

    try {
      const routes: readonly [string, SessionRouteHandler][] = [
        ['start', startRoute],
        ['join', joinRoute],
        ['manage', manageRoute],
        ['player-state', playerStateRoute],
        ['assignments', assignmentsRoute],
      ]

      for (const [name, handler] of routes) {
        await expect(invokeRoute(handler), name).rejects.toMatchObject({
          statusCode: 403,
          statusMessage: disabledMessage,
        })
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
