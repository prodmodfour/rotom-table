import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
} from '#shared/moveAutomation/correctionCommands'

const mocks = vi.hoisted(() => ({
  applyGmMoveCorrectionUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/applyGmMoveCorrection', () => ({
  applyGmMoveCorrectionUseCase: mocks.applyGmMoveCorrectionUseCase,
}))

const route = (await import('../../server/api/maps/move-corrections/apply.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = () => ({
  schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  opId: 'op_correctionroute1',
  mapSlug: 'arena',
  baseRevision: 8,
  type: GM_MOVE_CORRECTION_COMMAND_TYPE,
  payload: {
    originOperationId: 'op_originroute001',
    operationIds: ['inverse.state-change.1.hp'],
  },
  clientId: 'gm-client',
})

const invokeRoute = (
  handler: RouteHandler,
  options: { readonly role?: 'gm' | 'player'; readonly body?: unknown } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return handler({
    method: 'POST',
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event) as Promise<unknown>
}

describe('GM move correction route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a GM and passes a mechanics-free command to the correction use case', async () => {
    const body = command()
    mocks.applyGmMoveCorrectionUseCase.mockReturnValue({
      result: {
        ok: true,
        opId: body.opId,
        mapSlug: body.mapSlug,
        previousRevision: 8,
        revision: 9,
        patches: [],
      },
      path: 'data/maps/arena.json',
      map: { slug: 'arena', revision: 9 },
      sheetUpdates: [{ kind: 'pokemon', slug: 'actor', sheet: { revision: 6 } }],
    })

    await expect(invokeRoute(route, { role: 'gm', body })).resolves.toEqual({
      ok: true,
      opId: body.opId,
      mapSlug: body.mapSlug,
      previousRevision: 8,
      revision: 9,
      patches: [],
      path: 'data/maps/arena.json',
      map: { slug: 'arena', revision: 9 },
      sheetUpdates: [{ kind: 'pokemon', slug: 'actor', sheet: { revision: 6 } }],
    })
    const { clientId: _clientId, ...wireCommand } = body
    expect(mocks.applyGmMoveCorrectionUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: wireCommand,
      clientId: 'gm-client',
    })

    await expect(invokeRoute(route, { role: 'player', body })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'GM login required',
    })
    expect(mocks.applyGmMoveCorrectionUseCase).toHaveBeenCalledTimes(1)
  })

  it('returns correction conflicts as terminal command results', async () => {
    const body = command()
    mocks.applyGmMoveCorrectionUseCase.mockReturnValue({
      result: {
        ok: false,
        opId: body.opId,
        mapSlug: body.mapSlug,
        reason: 'conflict',
        message: 'Affected sheet changed.',
        currentRevision: 8,
      },
      map: { slug: 'arena', revision: 8 },
    })

    await expect(invokeRoute(route, { role: 'gm', body })).resolves.toEqual({
      ok: false,
      opId: body.opId,
      mapSlug: body.mapSlug,
      reason: 'conflict',
      message: 'Affected sheet changed.',
      currentRevision: 8,
    })
  })
})
