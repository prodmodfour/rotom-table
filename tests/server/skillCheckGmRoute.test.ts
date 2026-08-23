import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ load: vi.fn(), manage: vi.fn() }))
vi.mock('../../server/useCases/manageGmSkillChecks', () => ({
  loadGmSkillChecksUseCase: mocks.load,
  manageGmSkillCheckUseCase: mocks.manage,
}))

const getRoute = (await import('../../server/api/skill-checks/gm.get')).default
const postRoute = (await import('../../server/api/skill-checks/gm.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const event = (method: 'GET' | 'POST', role: 'gm' | 'player', body?: unknown, query = '') => ({
  method,
  path: `${SKILL_CHECK_API_PATHS.gm}${query}`,
  node: { req: {
    url: `${SKILL_CHECK_API_PATHS.gm}${query}`,
    headers: {
      cookie: `rotom-role=${role}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  } },
  context: {},
} as unknown as H3Event)

const invokeGet = (role: 'gm' | 'player' = 'gm', query = '') => (
  (getRoute as RouteHandler)(event('GET', role, undefined, query))
)
const invokePost = (body: unknown, role: 'gm' | 'player' = 'gm') => (
  (postRoute as RouteHandler)(event('POST', role, body))
)

afterEach(() => vi.clearAllMocks())

describe('GM Skill Check routes', () => {
  it('requires GM authority and forwards bounded state filters', async () => {
    const response = { schemaVersion: 1, checks: [], subjects: [], dcPresets: [] }
    mocks.load.mockReturnValue(response)
    expect(() => invokeGet('player')).toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(invokeGet('gm', '?states=pending,ready&limit=20')).toBe(response)
    expect(mocks.load).toHaveBeenCalledWith({ states: ['pending', 'ready'], limit: 20 })
  })

  it('rejects unknown, invalid, and unbounded GET query values', async () => {
    expect(() => invokeGet('gm', '?state=pending')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invokeGet('gm', '?states=forged')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invokeGet('gm', '?limit=501')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invokeGet('gm', '?limit=1.5')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('accepts only a GM command envelope and supplies server-owned principal authority', async () => {
    const command = {
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:route_request_0001',
      expectedRevision: 0,
      commandKind: 'request',
      checkId: 'skill-check:v1:route-request',
    }
    const response = { schemaVersion: 1, receipt: {}, document: {} }
    mocks.manage.mockReturnValue(response)
    await expect(invokePost({ command }, 'player')).rejects.toMatchObject({ statusCode: 403 })
    expect(await invokePost({ command }, 'gm')).toBe(response)
    expect(mocks.manage).toHaveBeenCalledWith(
      { principalId: 'session', command },
      { publishAttention: expect.any(Function) },
    )
  })

  it('rejects missing or extra POST envelope authority', async () => {
    await expect(invokePost({})).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokePost({ command: {}, principalId: 'forged' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokePost({ command: {}, dice: [6] })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.manage).not.toHaveBeenCalled()
  })
})
