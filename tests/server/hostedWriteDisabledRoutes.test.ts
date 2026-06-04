import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

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

const disableProductionHostedWrites = (): void => {
  process.env.NODE_ENV = 'production'
  delete process.env.ROTOM_ENABLE_HOSTED_WRITES
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

describe('hosted-write disabled route behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv)
    restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  })

  it('rejects a representative sheet save in production when the hosted-write flag is absent', async () => {
    disableProductionHostedWrites()

    await expect(invokeRoute(saveSheetRoute, {
      role: 'gm',
      body: {
        kind: 'pokemon',
        slug: 'pikachu',
        sheet: { slug: 'pikachu' },
        clientId: 'client-1',
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })

    expect(mocks.saveSheetUseCase).not.toHaveBeenCalled()
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
  })
})
