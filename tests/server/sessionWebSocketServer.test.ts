import { describe, expect, it } from 'vitest'
import socketRoute from '~~/server/api/sessions/socket'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import {
  SESSION_SOCKET_DISABLED_MESSAGE,
  SESSION_SOCKET_DISABLED_STATUS,
  SESSION_SOCKET_PENDING_HELLO_STATUS,
  SESSION_SOCKET_POLICY_CLOSE_CODE,
  createInMemorySessionSocketRegistry,
  handleSessionSocketClose,
  handleSessionSocketError,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  handleSessionSocketUpgrade,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'

type FakePeer = SessionSocketPeerLike & {
  readonly sent: unknown[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }
const disabledEnv = { [SESSION_HOST_ENABLE_ENV]: '' }

const makeRequest = (): { url: string, headers: Headers, context: Record<string, unknown> } => ({
  url: 'ws://localhost:3000/api/sessions/socket',
  headers: new Headers({ host: 'localhost:3000' }),
  context: {},
})

const makePeer = (id = 'peer-a'): FakePeer => {
  const sent: unknown[] = []
  const closed: { code?: number, reason?: string }[] = []

  return {
    id,
    sent,
    closed,
    send(data: unknown) {
      sent.push(data)
      return undefined
    },
    close(code?: number, reason?: string) {
      closed.push({ code, reason })
      return undefined
    },
  }
}

describe('session WebSocket route skeleton', () => {
  it('enables Nitro WebSocket hooks at the session socket route', () => {
    const hooks = (socketRoute as unknown as { __websocket__?: Record<string, unknown> }).__websocket__

    expect(hooks?.upgrade).toBe(handleSessionSocketUpgrade)
    expect(hooks?.open).toBeTypeOf('function')
    expect(hooks?.message).toBe(handleSessionSocketMessage)
    expect(hooks?.close).toBeTypeOf('function')
    expect(hooks?.error).toBe(handleSessionSocketError)
  })

  it('fails WebSocket upgrades closed unless the explicit session-host flag is set', async () => {
    const disabledResponse = handleSessionSocketUpgrade(makeRequest(), { env: disabledEnv })
    expect(disabledResponse).toBeInstanceOf(Response)
    expect(disabledResponse?.status).toBe(SESSION_SOCKET_DISABLED_STATUS)
    expect(await disabledResponse?.text()).toBe(SESSION_SOCKET_DISABLED_MESSAGE)

    expect(handleSessionSocketUpgrade(makeRequest(), { env: enabledEnv })).toBeUndefined()
  })

  it('records enabled raw connects as pending hello and removes them on disconnect', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-connected')

    const connection = handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    expect(connection).toEqual({
      peerId: 'peer-connected',
      status: SESSION_SOCKET_PENDING_HELLO_STATUS,
      connectedAt: '2026-05-26T10:00:00.000Z',
      lastSeenAt: '2026-05-26T10:00:00.000Z',
    })
    expect(registry.size).toBe(1)
    expect(registry.get('peer-connected')).toEqual(connection)

    const closed = handleSessionSocketClose(peer, { code: 1000, reason: 'done' }, {
      registry,
      clock: () => '2026-05-26T10:01:00.000Z',
    })

    expect(closed).toEqual({
      ...connection,
      closedAt: '2026-05-26T10:01:00.000Z',
      closeCode: 1000,
      closeReason: 'done',
    })
    expect(registry.size).toBe(0)
    expect(registry.get('peer-connected')).toBeUndefined()
  })

  it('closes without registering if the open hook runs while hosting is disabled', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-disabled')

    expect(handleSessionSocketOpen(peer, { env: disabledEnv, registry })).toBeUndefined()
    expect(registry.size).toBe(0)
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: SESSION_SOCKET_DISABLED_MESSAGE,
      },
    ])
  })

  it('does not process commands before later hello/auth tickets wire dispatch', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-message')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => '{"type":"hello"}' }, {
      registry,
      clock: () => '2026-05-26T10:00:05.000Z',
    })

    expect(registry.get('peer-message')).toMatchObject({
      lastSeenAt: '2026-05-26T10:00:05.000Z',
      status: SESSION_SOCKET_PENDING_HELLO_STATUS,
    })
    expect(peer.sent).toHaveLength(1)
    expect(JSON.parse(String(peer.sent[0]))).toMatchObject({
      schemaVersion: 1,
      type: 'error',
      direction: 'server',
      code: 'unsupported-message',
      retryable: false,
    })
  })

  it('updates pending connection activity on socket errors without disconnecting', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-error')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    handleSessionSocketError(peer, new Error('boom'), {
      registry,
      clock: () => '2026-05-26T10:00:10.000Z',
    })

    expect(registry.size).toBe(1)
    expect(registry.get('peer-error')).toMatchObject({
      lastSeenAt: '2026-05-26T10:00:10.000Z',
    })
  })
})
