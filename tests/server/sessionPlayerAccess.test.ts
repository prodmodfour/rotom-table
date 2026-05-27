import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_CLIENT_IDENTITY_COOKIE, serializeSessionClientIdentityCookieHint } from '#shared/sessionClientIdentity'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION } from '#shared/sessionRevisions'
import { createAuthoritativeSessionMapState, createAuthoritativeSessionState } from '#shared/sessionState'
import { getPlayerSessionAccessGrant, playerSessionCanAccessSheet } from '~~/server/utils/sessionPlayerAccess'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import { sessionStore } from '~~/server/utils/sessionStore'

const sessionId = parseSessionId('session_playeraccess01')
const joinCode = parseJoinCode('PLYACC')
const gmKey = parseGmKey('gmkey_playeraccessabcdefghijklmnop')
const playerId = parsePlayerId('player_playeraccess01')
const clientId = parseClientId('client_playeraccess01')
const displayName = parseSessionDisplayName('Riley')
const createdAt = '2026-05-27T00:00:00.000Z'

const eventWithPlayerCookie = (): H3Event => ({
  node: {
    req: {
      headers: {
        cookie: `${SESSION_CLIENT_IDENTITY_COOKIE}=${serializeSessionClientIdentityCookieHint({
          schemaVersion: 1,
          role: 'player',
          sessionId,
          clientId,
          playerId,
          displayName,
          rememberedAt: createdAt,
        })}`,
      },
    },
  },
} as unknown as H3Event)

afterEach(() => {
  sessionStore.clear()
  vi.unstubAllEnvs()
})

describe('player session access grants', () => {
  it('derives sheet access from visible session map placements and direct assignments', () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, '1')
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
        selectedMapSlug: 'training-yard',
        maps: [
          createAuthoritativeSessionMapState({
            mapSlug: 'training-yard',
            document: {
              schemaVersion: 2,
              slug: 'training-yard',
              name: 'Training Yard',
              dimensions: { x: 4, y: 1, z: 4 },
              voxels: [],
              placements: [
                {
                  id: 'token-pikachu',
                  sheetKind: 'pokemon',
                  sheetSlug: 'hidden-pikachu',
                  position: { x: 0, y: 0, z: 0 },
                },
              ],
            },
          }),
        ],
        players: [{ playerId, displayName, joinedAt: createdAt, updatedAt: createdAt }],
        assignments: [{
          playerId,
          displayName,
          visibleResources: [
            { kind: 'map', mapSlug: 'training-yard' },
            { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'assigned-trainer' },
          ],
          controllableResources: [],
          updatedAt: createdAt,
        }],
        createdAt,
        updatedAt: createdAt,
      }),
    })

    const grant = getPlayerSessionAccessGrant(eventWithPlayerCookie())

    expect(grant?.visibleMapSlugs.has('training-yard')).toBe(true)
    expect(playerSessionCanAccessSheet(grant, 'pokemon', 'hidden-pikachu')).toBe(true)
    expect(playerSessionCanAccessSheet(grant, 'trainer', 'assigned-trainer')).toBe(true)
    expect(playerSessionCanAccessSheet(grant, 'pokemon', 'not-visible')).toBe(false)
  })
})
