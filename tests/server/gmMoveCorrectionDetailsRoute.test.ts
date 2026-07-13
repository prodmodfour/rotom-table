import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getGmMoveCorrectionDetailsUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/getGmMoveCorrectionDetails', () => ({
  getGmMoveCorrectionDetailsUseCase: mocks.getGmMoveCorrectionDetailsUseCase,
}))

const route = (await import('../../server/api/maps/move-corrections/details.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeRoute = async (
  handler: RouteHandler,
  options: { readonly role?: 'gm' | 'player' } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  const path = '/api/maps/move-corrections/details?slug=arena&originOperationId=op_detailroute01'
  return handler({
    method: 'GET',
    path,
    node: { req: { url: path, headers } },
    context: {},
  } as unknown as H3Event) as Promise<unknown>
}

describe('GM move correction details route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getGmMoveCorrectionDetailsUseCase.mockReturnValue({
      schemaVersion: 1,
      mapSlug: 'arena',
      originOperationId: 'op_detailroute01',
      moveName: 'Scratch',
      acceptedAt: 1_000,
      acceptedRevision: 2,
      operations: [],
      corrections: [],
    })
  })

  it('passes a GM-only operation identity to the value-free query use case', async () => {
    await expect(invokeRoute(route, { role: 'gm' })).resolves.toMatchObject({
      originOperationId: 'op_detailroute01',
    })
    expect(mocks.getGmMoveCorrectionDetailsUseCase).toHaveBeenCalledWith({
      role: 'gm',
      mapSlug: 'arena',
      originOperationId: 'op_detailroute01',
    })

    await expect(invokeRoute(route, { role: 'player' })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'GM login required',
    })
    expect(mocks.getGmMoveCorrectionDetailsUseCase).toHaveBeenCalledTimes(1)
  })
})
