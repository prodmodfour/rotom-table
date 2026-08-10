import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadBreedingWorkshopActivityError } from '../../server/useCases/loadBreedingWorkshopActivity'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/loadBreedingWorkshopActivity', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/loadBreedingWorkshopActivity')>()
  return { ...original, loadBreedingWorkshopActivity: mocks.load }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolveProfile }
})

const route = (await import('../../server/api/breeding/workshop/activity.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const invoke = async (options: {
  readonly role?: 'gm' | 'player'
  readonly query?: Record<string, string>
} = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  const search = new URLSearchParams(options.query ?? {}).toString()
  const path = `/api/breeding/workshop/activity${search ? `?${search}` : ''}`
  return (route as RouteHandler)({
    method: 'GET', path,
    node: { req: { url: path, headers } },
    context: {},
  } as unknown as H3Event)
}

describe('Breeding Workshop activity API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockReturnValue({ schemaVersion: 1, audience: 'gm' })
    mocks.resolveProfile.mockReturnValue({ schemaVersion: 1, id: 'profile_owner000' })
  })

  it('requires authentication and forwards a closed GM Trainer selector', async () => {
    await expect(invoke()).rejects.toMatchObject({ statusCode: 401 })
    await expect(invoke({
      role: 'gm', query: { trainerSheetSlug: 'trainer-owner' },
    })).resolves.toEqual({ schemaVersion: 1, audience: 'gm' })
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'gm', playerProfile: null,
      request: { profileId: null, trainerSheetSlug: 'trainer-owner' },
    })
  })

  it('resolves and forwards only the selected current player Profile', async () => {
    const result = { schemaVersion: 1, audience: 'owner' }
    mocks.load.mockReturnValue(result)
    await expect(invoke({ role: 'player', query: {
      profileId: 'profile_owner000', trainerSheetSlug: 'trainer-owner',
    } })).resolves.toEqual(result)
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_owner000')
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player',
      playerProfile: { schemaVersion: 1, id: 'profile_owner000' },
      request: { profileId: 'profile_owner000', trainerSheetSlug: 'trainer-owner' },
    })
  })

  it('rejects enriched or Profile-bearing GM activity queries before use-case access', async () => {
    await expect(invoke({ role: 'gm', query: {
      trainerSheetSlug: 'trainer-owner', aggregateId: 'private',
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ role: 'gm', query: {
      trainerSheetSlug: 'trainer-owner', profileId: 'profile_owner000',
    } })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('maps bounded activity failures without leaking internal details', async () => {
    mocks.load.mockImplementation(() => {
      throw new LoadBreedingWorkshopActivityError(403, 'Requested activity context is unavailable')
    })
    await expect(invoke({
      role: 'gm', query: { trainerSheetSlug: 'trainer-owner' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requested activity context is unavailable',
    })
  })
})
