import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_CHECK_API_PATHS } from '../../src/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ load: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/loadCampaignSkillCheckHistory', () => ({
  loadCampaignSkillCheckHistoryUseCase: mocks.load,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))
const route = (await import('../../server/api/skill-checks/campaign-history.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invoke = (role: 'gm' | 'player', query = '') => (route as RouteHandler)({
  method: 'GET',
  path: `${SKILL_CHECK_API_PATHS.campaignHistory}${query}`,
  node: { req: {
    url: `${SKILL_CHECK_API_PATHS.campaignHistory}${query}`,
    headers: { cookie: `rotom-role=${role}` },
  } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('campaign Skill Check history route', () => {
  it('selects exact GM or owner authority without spectator fallback', () => {
    const profile = { id: 'profile_maya0001' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockImplementation(input => ({
      schemaVersion: 1,
      projection: 'campaign-skill-check-history',
      audience: input.authority.kind,
      entries: [],
      serverNow: 100,
    }))
    expect(invoke('gm', '?limit=12')).toMatchObject({ audience: 'gm' })
    expect(mocks.load).toHaveBeenLastCalledWith({ authority: { kind: 'gm' }, limit: 12 })
    expect(invoke('player', '?profileId=profile_maya0001')).toMatchObject({ audience: 'owner' })
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_maya0001')
    expect(mocks.load).toHaveBeenLastCalledWith({ authority: { kind: 'owner', profile }, limit: undefined })
  })

  it('rejects missing or unavailable player Profiles, GM spoofing, extra fields, and unbounded limits', () => {
    expect(() => invoke('player')).toThrow(expect.objectContaining({ statusCode: 400 }))
    mocks.resolveProfile.mockReturnValue(null)
    expect(() => invoke('player', '?profileId=profile_missing')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('gm', '?profileId=profile_maya0001')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('gm', '?private=true')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('gm', '?limit=0')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => invoke('gm', '?limit=21')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
