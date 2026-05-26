import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { INITIAL_MAP_REVISION, INITIAL_SESSION_REVISION, incrementSessionRevision } from '#shared/sessionRevisions'
import { createAuthoritativeSessionState, type SessionMapSlug } from '#shared/sessionState'
import attachMapRoute from '~~/server/api/sessions/maps/attach.post'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import { SESSION_SNAPSHOT_ROOT } from '~~/server/utils/sessionSnapshots'
import { sessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const sessionId = parseSessionId('session_attachroute01')
const gmKey = parseGmKey('gmkey_attachrouteabcdefghijklmnopqr')
const wrongGmKey = parseGmKey('gmkey_wrongattachrouteabcdefghijklmn')
const joinCode = parseJoinCode('ATTMAP')
const gmClientId = parseClientId('client_attachroutegm')
const playerId = parsePlayerId('player_attachroute01')
const playerDisplayName = parseSessionDisplayName('Brock')
const mapSlug = 'route-attach-endpoint-map' as SessionMapSlug
const createdAt = '2026-05-26T14:00:00.000Z'

type AttachRouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeAttachMapRoute = async (body: unknown): Promise<unknown> => (
  attachMapRoute as AttachRouteHandler
)({
  method: 'POST',
  node: {
    req: {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  },
} as unknown as H3Event)

const writePersistedMap = (): void => {
  mkdirSync(MAPS_ROOT, { recursive: true })
  writeFileSync(join(MAPS_ROOT, `${mapSlug}.json`), `${JSON.stringify({
    schemaVersion: 2,
    slug: mapSlug,
    name: 'Attach Endpoint Test Map',
    dimensions: { x: 2, y: 1, z: 2 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [{ x: 0, y: 0, z: 0, materialId: 'grass' }],
    hazards: [],
    placements: [],
    lights: [],
  }, null, 2)}\n`, 'utf8')
}

const seedActiveSession = (): void => {
  sessionStore.create({
    sessionId,
    joinCode,
    gmKey,
    revision: INITIAL_SESSION_REVISION,
    createdAt,
    updatedAt: createdAt,
    state: createAuthoritativeSessionState({
      sessionId,
      revision: INITIAL_SESSION_REVISION,
      players: [
        {
          playerId,
          displayName: playerDisplayName,
          joinedAt: createdAt,
          updatedAt: createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    }),
  })
}

afterEach(() => {
  sessionStore.clear()
  rmSync(join(MAPS_ROOT, `${mapSlug}.json`), { force: true })
  rmSync(join(SESSION_SNAPSHOT_ROOT, sessionId), { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('session map attachment endpoint', () => {
  it('attaches a persisted map and returns a no-secret session summary', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, enabledEnv[SESSION_HOST_ENABLE_ENV])
    seedActiveSession()
    writePersistedMap()

    const response = await invokeAttachMapRoute({
      sessionId,
      gmKey,
      gmClientId,
      mapSlug,
    })
    const nextRevision = incrementSessionRevision(INITIAL_SESSION_REVISION)

    expect(response).toMatchObject({
      session: {
        sessionId,
        status: 'active',
        revision: nextRevision,
        selectedMapSlug: mapSlug,
        mapCount: 1,
        createdAt,
        updatedAt: expect.any(String),
      },
      map: {
        mapSlug,
        revision: INITIAL_MAP_REVISION,
        selected: true,
      },
      selection: {
        behavior: 'select-attached-map',
        previousSelectedMapSlug: null,
        selectedMapSlug: mapSlug,
      },
      visibility: {
        behavior: 'visible-to-all-players',
        grantsJoinedPlayers: true,
        grantsFuturePlayers: true,
        visiblePlayerIds: [playerId],
      },
      snapshot: {
        revision: nextRevision,
        writtenAt: expect.any(String),
      },
    })
    expect(response).not.toHaveProperty('record')
    expect(response).not.toHaveProperty('state')
    expect(response).not.toHaveProperty('gm')
    expect(response).not.toHaveProperty('join')
    expect(response).not.toHaveProperty('map.document')
    expect(JSON.stringify(response)).not.toContain(gmKey)
    expect(JSON.stringify(response)).not.toContain(joinCode)

    const stored = sessionStore.get(sessionId)
    expect(stored?.state?.selectedMapSlug).toBe(mapSlug)
    expect(stored?.state?.maps[0]).toMatchObject({
      mapSlug,
      revision: INITIAL_MAP_REVISION,
      document: { slug: mapSlug, name: 'Attach Endpoint Test Map' },
    })
  })

  it('requires the session-local GM key before attaching the map', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, enabledEnv[SESSION_HOST_ENABLE_ENV])
    seedActiveSession()
    writePersistedMap()

    await expect(invokeAttachMapRoute({
      sessionId,
      gmKey: wrongGmKey,
      mapSlug,
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'The supplied GM key is not authorized to attach maps to this live session',
    })

    expect(sessionStore.get(sessionId)?.state?.maps).toEqual([])
  })
})
