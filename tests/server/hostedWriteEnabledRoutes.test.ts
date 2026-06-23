import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePlayerProfileForPolicy: vi.fn(),
  saveSheetUseCase: vi.fn(),
}))

vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))
vi.mock('../../server/useCases/saveSheet', () => ({
  saveSheetUseCase: mocks.saveSheetUseCase,
}))

const saveSheetRoute = (await import('../../server/api/sheets/save.post')).default

type MutatingRouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const restoreEnvValue = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const enableProductionHostedWrites = (): void => {
  process.env.NODE_ENV = 'production'
  process.env.ROTOM_ENABLE_HOSTED_WRITES = '1'
}

const invokeRoute = async (
  handler: MutatingRouteHandler,
  options: { role: 'gm' | 'player'; body: unknown },
): Promise<unknown> => handler({
  method: 'POST',
  node: {
    req: {
      headers: {
        cookie: `rotom-role=${options.role}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(options.body),
    },
  },
} as unknown as H3Event)

describe('hosted-write enabled route behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv)
    restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  })

  it('allows a representative production sheet save when the exact hosted-write flag is set', async () => {
    enableProductionHostedWrites()

    const savedSheet = { slug: 'pikachu', name: 'Pikachu' }
    mocks.saveSheetUseCase.mockReturnValue({
      ok: true,
      slug: 'pikachu',
      path: 'data/sheets/pikachu.json',
      sheet: savedSheet,
      events: [],
    })

    await expect(invokeRoute(saveSheetRoute, {
      role: 'gm',
      body: {
        kind: 'pokemon',
        slug: 'pikachu',
        sheet: savedSheet,
        expectedRevision: 0,
        clientId: 'client-1',
        interactionMode: 'setup-edit',
      },
    })).resolves.toEqual({
      ok: true,
      slug: 'pikachu',
      path: 'data/sheets/pikachu.json',
      sheet: savedSheet,
    })

    expect(mocks.saveSheetUseCase).toHaveBeenCalledTimes(1)
    expect(mocks.saveSheetUseCase).toHaveBeenCalledWith({
      role: 'gm',
      kind: 'pokemon',
      slug: 'pikachu',
      sheet: savedSheet,
      expectedRevision: 0,
      clientId: 'client-1',
      playerProfile: null,
      interactionMode: 'setup-edit',
      allowSlugSync: undefined,
    })
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
  })
})
