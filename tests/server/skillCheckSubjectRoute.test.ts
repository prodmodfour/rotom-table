import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ load: vi.fn(), respond: vi.fn(), timeout: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/manageSubjectSkillChecks', () => ({
  loadSubjectSkillChecksUseCase: mocks.load,
  respondSubjectSkillCheckUseCase: mocks.respond,
  timeoutExpiredSkillChecksUseCase: mocks.timeout,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const getRoute = (await import('../../server/api/skill-checks/subject.get')).default
const postRoute = (await import('../../server/api/skill-checks/subject.post')).default
const timeoutRoute = (await import('../../server/api/skill-checks/settle-expired.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const event = (method: 'GET' | 'POST', path: string, role: 'gm' | 'player', body?: unknown) => ({
  method,
  path,
  node: { req: {
    url: path,
    headers: {
      cookie: `rotom-role=${role}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  } },
  context: {},
} as unknown as H3Event)

const get = (path: string, role: 'gm' | 'player' = 'player') => (
  (getRoute as RouteHandler)(event('GET', path, role))
)
const post = (body: unknown, role: 'gm' | 'player' = 'player') => (
  (postRoute as RouteHandler)(event('POST', SKILL_CHECK_API_PATHS.subject, role, body))
)
const settle = (body: unknown, role: 'gm' | 'player' = 'player') => (
  (timeoutRoute as RouteHandler)(event('POST', SKILL_CHECK_API_PATHS.settleExpired, role, body))
)

afterEach(() => vi.clearAllMocks())

describe('subject Skill Check routes', () => {
  it('loads only the resolved player profile projection with bounded filters', () => {
    const profile = { id: 'profile_maya0001' }
    const response = { schemaVersion: 1, requests: [], serverNow: 100 }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockReturnValue(response)
    expect(get(`${SKILL_CHECK_API_PATHS.subject}?profileId=profile_maya0001&states=pending,accepted&limit=20`)).toBe(response)
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_maya0001')
    expect(mocks.load).toHaveBeenCalledWith({
      authority: { kind: 'profile', profile },
      states: ['pending', 'accepted'],
      limit: 20,
    })
  })

  it('lets the GM use subject authority without accepting a forged profile selector', () => {
    const response = { schemaVersion: 1, requests: [], serverNow: 100 }
    mocks.load.mockReturnValue(response)
    expect(get(SKILL_CHECK_API_PATHS.subject, 'gm')).toBe(response)
    expect(mocks.load).toHaveBeenCalledWith({
      authority: { kind: 'gm', principalId: 'session' }, states: undefined, limit: undefined,
    })
    expect(() => get(`${SKILL_CHECK_API_PATHS.subject}?profileId=profile_maya0001`, 'gm'))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects missing profiles, unknown fields, and malformed subject query bounds', () => {
    mocks.resolveProfile.mockReturnValue(null)
    expect(() => get(SKILL_CHECK_API_PATHS.subject)).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => get(`${SKILL_CHECK_API_PATHS.subject}?profileId=x&private=true`)).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => get(`${SKILL_CHECK_API_PATHS.subject}?profileId=x&states=forged`)).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => get(`${SKILL_CHECK_API_PATHS.subject}?profileId=x&limit=501`)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('forwards only strict player or GM response authority', async () => {
    const command = {
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:route_respond_0001',
      expectedRevision: 1,
      commandKind: 'respond',
      checkId: 'skill-check:v1:route-response',
      subjectId: 'skill-check-subject:v1:route-subject',
      decision: 'accept',
    }
    const profile = { id: 'profile_maya0001' }
    const response = { schemaVersion: 1, receipt: {}, request: {} }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.respond.mockReturnValue(response)
    expect(await post({ command, profileId: 'profile_maya0001' })).toBe(response)
    expect(mocks.respond).toHaveBeenLastCalledWith(
      { authority: { kind: 'profile', profile }, command },
      { publishAttention: expect.any(Function) },
    )
    expect(await post({ command }, 'gm')).toBe(response)
    expect(mocks.respond).toHaveBeenLastCalledWith(
      { authority: { kind: 'gm', principalId: 'session' }, command },
      { publishAttention: expect.any(Function) },
    )
  })

  it('rejects forged response envelope fields and role-wrong profile authority', async () => {
    await expect(post({ command: {} })).rejects.toMatchObject({ statusCode: 400 })
    await expect(post({ command: {}, profileId: 'profile_maya0001', dice: [6] })).rejects.toMatchObject({ statusCode: 400 })
    await expect(post({ command: {}, profileId: 'profile_maya0001' }, 'gm')).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.respond).not.toHaveBeenCalled()
  })

  it('exposes only an authority-free authenticated trigger for server-owned expiry settlement', async () => {
    const response = { schemaVersion: 1, observedAt: 100, campaignMinute: 5, timedOutCheckIds: [] }
    mocks.timeout.mockReturnValue(response)
    expect(await settle({}, 'player')).toBe(response)
    expect(await settle({}, 'gm')).toBe(response)
    expect(mocks.timeout).toHaveBeenCalledTimes(2)
    expect(mocks.timeout).toHaveBeenLastCalledWith({ publishAttention: expect.any(Function) })
    await expect(settle({ now: 100 }, 'gm')).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.timeout).toHaveBeenCalledTimes(2)
  })
})
