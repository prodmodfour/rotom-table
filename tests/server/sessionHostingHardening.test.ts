import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import assignmentsRoute from '~~/server/api/sessions/assignments.post'
import joinRoute from '~~/server/api/sessions/join.post'
import manageRoute from '~~/server/api/sessions/manage.post'
import playerStateRoute from '~~/server/api/sessions/player-state.post'
import startRoute from '~~/server/api/sessions/start.post'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  assertSessionHostEnabled,
  isSessionHostEnabled,
} from '~~/server/utils/sessionHosting'
import { sessionStore } from '~~/server/utils/sessionStore'
import {
  SESSION_SOCKET_DISABLED_MESSAGE,
  SESSION_SOCKET_DISABLED_STATUS,
  SESSION_SOCKET_POLICY_CLOSE_CODE,
  createInMemorySessionSocketRegistry,
  handleSessionSocketOpen,
  handleSessionSocketUpgrade,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import {
  buildSessionHostChecklist,
  buildSessionHostDevCommand,
  formatSessionHostDevCommand,
  resolveSessionHostConfig,
} from '../../scripts/session-host-dev.mjs'

type SessionRouteHandler = EventHandler<EventHandlerRequest, unknown>

type FakePeer = SessionSocketPeerLike & {
  readonly sent: unknown[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

const disabledMessage =
  'Track 2 session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.'

const repoPath = (relativePath: string): string => resolve(process.cwd(), relativePath)
const readRepoText = (relativePath: string): string => readFileSync(repoPath(relativePath), 'utf8')

const makeUpgradeRequest = (): { readonly url: string, readonly headers: Headers, readonly context: Record<string, unknown> } => ({
  url: 'ws://localhost:3000/api/sessions/socket',
  headers: new Headers({ host: 'localhost:3000' }),
  context: {},
})

const makePeer = (id = 'peer-disabled'): FakePeer => {
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

const invokeRoute = async (handler: SessionRouteHandler): Promise<unknown> => handler({} as H3Event)

const guardedSessionRoutes = [
  {
    name: 'start',
    source: 'server/api/sessions/start.post.ts',
    handler: startRoute,
    laterCall: 'requireGm(event)',
  },
  {
    name: 'join',
    source: 'server/api/sessions/join.post.ts',
    handler: joinRoute,
    laterCall: 'await readBody',
  },
  {
    name: 'manage',
    source: 'server/api/sessions/manage.post.ts',
    handler: manageRoute,
    laterCall: 'await readBody',
  },
  {
    name: 'player-state',
    source: 'server/api/sessions/player-state.post.ts',
    handler: playerStateRoute,
    laterCall: 'await readBody',
  },
  {
    name: 'assignments',
    source: 'server/api/sessions/assignments.post.ts',
    handler: assignmentsRoute,
    laterCall: 'await readBody',
  },
] as const

describe('Track 2 hosting hardening regression coverage', () => {
  afterEach(() => {
    sessionStore.clear()
    vi.unstubAllEnvs()
  })

  it('keeps the session-host runtime gate disabled unless the exact documented value is present', () => {
    const disabledValues = [undefined, '', '0', 'true', 'yes', 'on', ' 1', '1 ', '01'] as const

    for (const value of disabledValues) {
      const env = value === undefined ? {} : { [SESSION_HOST_ENABLE_ENV]: value }
      expect(isSessionHostEnabled(env), `${String(value)} must not enable hosting`).toBe(false)
      expect(() => assertSessionHostEnabled(env)).toThrowError(disabledMessage)
    }

    expect(isSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE })).toBe(true)
    expect(() => assertSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE })).not.toThrow()
  })

  it('guards every session HTTP endpoint before body/auth/use-case work and fails closed without state mutation', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, '')

    for (const route of guardedSessionRoutes) {
      const source = readRepoText(route.source)
      const guardIndex = source.indexOf('assertSessionHostEnabled()')
      const laterCallIndex = source.indexOf(route.laterCall)

      expect(guardIndex, `${route.name} route must call assertSessionHostEnabled`).toBeGreaterThanOrEqual(0)
      expect(laterCallIndex, `${route.name} route must keep its later gate-sensitive call`).toBeGreaterThanOrEqual(0)
      expect(guardIndex, `${route.name} route must fail closed before ${route.laterCall}`).toBeLessThan(laterCallIndex)

      await expect(invokeRoute(route.handler as SessionRouteHandler), route.name).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: disabledMessage,
      })
      expect(sessionStore.size, `${route.name} route must not create or mutate sessions when disabled`).toBe(0)
    }
  })

  it('keeps the session WebSocket disabled by default and closes disabled opens without registering peers', async () => {
    for (const value of [undefined, '', 'true', 'yes', 'on'] as const) {
      const env = value === undefined ? {} : { [SESSION_HOST_ENABLE_ENV]: value }
      const response = handleSessionSocketUpgrade(makeUpgradeRequest(), { env })

      expect(response, `${String(value)} should reject WebSocket upgrades`).toBeInstanceOf(Response)
      expect(response?.status).toBe(SESSION_SOCKET_DISABLED_STATUS)
      expect(await response?.text()).toBe(SESSION_SOCKET_DISABLED_MESSAGE)
    }

    expect(handleSessionSocketUpgrade(makeUpgradeRequest(), {
      env: { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE },
    })).toBeUndefined()

    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer()

    expect(handleSessionSocketOpen(peer, { env: {}, registry })).toBeUndefined()
    expect(registry.size).toBe(0)
    expect(peer.sent).toEqual([])
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: SESSION_SOCKET_DISABLED_MESSAGE,
      },
    ])
  })

  it('locks helper scripts to safe LAN/named-tunnel defaults without adding Quick Tunnel or secret-bearing commands', () => {
    const packageJson = JSON.parse(readRepoText('package.json')) as { readonly scripts: Record<string, string> }

    expect(packageJson.scripts.dev).toBe('nuxt dev')
    expect(packageJson.scripts.dev).not.toContain(SESSION_HOST_ENABLE_ENV)
    expect(packageJson.scripts['dev:session:lan']).toBe('node scripts/session-host-dev.mjs --mode lan')
    expect(packageJson.scripts['dev:session:tunnel']).toBe('node scripts/session-host-dev.mjs --mode tunnel')
    expect(Object.values(packageJson.scripts).join('\n')).not.toContain('trycloudflare')

    const lanConfig = resolveSessionHostConfig({ mode: 'lan' })
    const tunnelConfig = resolveSessionHostConfig({ mode: 'tunnel', port: 3010 })
    const lanCommand = buildSessionHostDevCommand(lanConfig)
    const checklist = buildSessionHostChecklist(tunnelConfig).join('\n')

    expect(lanCommand).toMatchObject({
      command: 'npm',
      args: ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000'],
      env: { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE },
    })
    expect(formatSessionHostDevCommand(tunnelConfig)).toBe(
      'ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3010',
    )
    expect(checklist).toContain('Named Cloudflare Tunnel')
    expect(checklist).toContain('no .env file, GM key, join code, tunnel credential, or session snapshot is generated by the script')
    expect(checklist).toContain('Quick Tunnel remains development-smoke-test only')
    expect(checklist).toContain('data/sessions/')
    expect(checklist).not.toContain('trycloudflare.com')
    expect(checklist).not.toContain('gmKey=')
    expect(checklist).not.toContain('joinCode=')
    expect(checklist).not.toContain('BEGIN PRIVATE KEY')
  })
})
