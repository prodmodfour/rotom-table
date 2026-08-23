import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ load: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/loadSkillCheckProjections', () => ({
  loadSkillCheckProjectionsUseCase: mocks.load,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))
const route = (await import('../../server/api/skill-checks/projections.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invoke = (role: 'gm' | 'player', query = '') => (route as RouteHandler)({
  method: 'GET',
  path: `${SKILL_CHECK_API_PATHS.projections}${query}`,
  node: { req: {
    url: `${SKILL_CHECK_API_PATHS.projections}${query}`,
    headers: { cookie: `rotom-role=${role}` },
  } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('Skill Check projection route', () => {
  it('selects structurally distinct GM, subject, and spectator authority from the authenticated role', () => {
    mocks.load.mockImplementation(input => ({ schemaVersion: 1, audience: input.authority.kind, checks: [], serverNow: 100 }))
    const profile = { id: 'profile_maya0001' }
    mocks.resolveProfile.mockReturnValue(profile)

    expect(invoke('gm')).toMatchObject({ audience: 'gm' })
    expect(mocks.load).toHaveBeenLastCalledWith({ authority: { kind: 'gm' }, states: undefined, limit: undefined })
    expect(invoke('player')).toMatchObject({ audience: 'spectator' })
    expect(mocks.load).toHaveBeenLastCalledWith({ authority: { kind: 'spectator' }, states: undefined, limit: undefined })
    expect(invoke('player', '?profileId=profile_maya0001&states=pending,accepted&limit=25')).toMatchObject({ audience: 'subject' })
    expect(mocks.load).toHaveBeenLastCalledWith({
      authority: { kind: 'subject', profile }, states: ['pending', 'accepted'], limit: 25,
    })
  })

  it('rejects GM profile spoofing and unknown, invalid, or unbounded query values', () => {
    expect(() => invoke('gm', '?profileId=profile_maya0001')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('player', '?private=true')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('player', '?states=forged')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('player', '?limit=0')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('player', '?limit=501')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
