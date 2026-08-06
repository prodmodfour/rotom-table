import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadBreedingWorkshopError } from '../../server/useCases/loadBreedingWorkshop'

const mocks = vi.hoisted(() => ({
  loadBreedingWorkshop: vi.fn(),
}))
vi.mock('../../server/useCases/loadBreedingWorkshop', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/loadBreedingWorkshop')>()
  return { ...original, loadBreedingWorkshop: mocks.loadBreedingWorkshop }
})

const route = (await import('../../server/api/breeding/workshop.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invoke = async (options: {
  readonly role?: 'gm' | 'player'
  readonly query?: Record<string, string>
} = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  const search = new URLSearchParams(options.query ?? {}).toString()
  const path = `/api/breeding/workshop${search ? `?${search}` : ''}`
  return (route as RouteHandler)({
    method: 'GET',
    path,
    node: { req: { url: path, headers } },
    context: {},
  } as unknown as H3Event)
}

describe('Breeding Workshop API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadBreedingWorkshop.mockReturnValue({ schemaVersion: 1, audience: 'gm' })
  })

  it('requires authentication and forwards only the closed GM ownership query', async () => {
    await expect(invoke()).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
    await expect(invoke({
      role: 'gm',
      query: {
        trainerSheetSlug: 'trainer-owner',
        ownershipCursor: 'trainer-before',
      },
    })).resolves.toEqual({ schemaVersion: 1, audience: 'gm' })
    expect(mocks.loadBreedingWorkshop).toHaveBeenCalledWith({
      role: 'gm',
      playerProfile: null,
      query: {
        trainerSheetSlug: 'trainer-owner',
        ownershipCursor: 'trainer-before',
      },
    })
  })

  it('passes a missing player selection as null for the safe profile-required state', async () => {
    mocks.loadBreedingWorkshop.mockReturnValue({ schemaVersion: 1, audience: 'owner' })
    await expect(invoke({ role: 'player' })).resolves.toEqual({
      schemaVersion: 1,
      audience: 'owner',
    })
    expect(mocks.loadBreedingWorkshop).toHaveBeenCalledWith({
      role: 'player',
      playerProfile: null,
      query: { trainerSheetSlug: null, ownershipCursor: null },
    })
  })

  it('rejects enriched or Profile-bearing GM queries before the use case', async () => {
    await expect(invoke({
      role: 'gm',
      query: { aggregateId: 'private' },
    })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({
      role: 'gm',
      query: { profileId: 'profile_ignored00' },
    })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.loadBreedingWorkshop).not.toHaveBeenCalled()
  })

  it('maps bounded Workshop use-case failures to HTTP responses', async () => {
    mocks.loadBreedingWorkshop.mockImplementation(() => {
      throw new LoadBreedingWorkshopError(403, 'Requested ownership context is unavailable')
    })
    await expect(invoke({ role: 'gm' })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requested ownership context is unavailable',
    })
  })
})
