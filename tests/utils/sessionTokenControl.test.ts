import { describe, expect, it } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { PlayerAssignmentRecord } from '#shared/sessionPermissions'
import { buildSessionTokenControlModel } from '~/utils/sessionTokenControl'
import type { SheetPlacement } from '~/types/map'

const sessionId = parseSessionId('session_tokenControl01')
const gmClientId = parseClientId('client_tokenGM01')
const playerClientId = parseClientId('client_tokenPL01')
const playerId = parsePlayerId('player_token001')
const otherPlayerId = parsePlayerId('player_token002')
const displayName = sanitizeSessionDisplayName('Token Player')
const updatedAt = '2026-05-26T10:00:00.000Z'

const gmIdentity: SessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId,
  clientId: gmClientId,
  gmKey: parseGmKey('gmkey_tokenControl000000000001'),
  rememberedAt: updatedAt,
}

const playerIdentity: SessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId,
  clientId: playerClientId,
  playerId,
  displayName,
  rememberedAt: updatedAt,
}

const placements: readonly Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>[] = [
  { id: 'assigned-token', sheetKind: 'pokemon', sheetSlug: 'starmie' },
  { id: 'visible-token', sheetKind: 'pokemon', sheetSlug: 'psyduck' },
  { id: 'trainer-token', sheetKind: 'trainer', sheetSlug: 'misty' },
]

const assignment = (
  overrides: Partial<PlayerAssignmentRecord> = {},
): PlayerAssignmentRecord => ({
  playerId,
  displayName,
  controllableResources: [],
  visibleResources: [{ kind: 'map', mapSlug: 'cerulean-gym' }],
  updatedAt,
  ...overrides,
})

describe('session token control model', () => {
  it('keeps local-first token decisions outside session mode', () => {
    const model = buildSessionTokenControlModel({
      enabled: false,
      identity: playerIdentity,
      mapSlug: 'cerulean-gym',
      placements,
      assignments: [assignment({
        controllableResources: [{ kind: 'token', tokenId: 'assigned-token' }],
      })],
      hasSnapshot: true,
    })

    expect(model.status).toBe('local-mode')
    expect(model.controllablePlacementIds).toEqual([])
    expect(model.notice).toBeNull()
  })

  it('waits for authoritative session map state before enabling GM token controls', () => {
    const model = buildSessionTokenControlModel({
      enabled: true,
      identity: gmIdentity,
      mapSlug: 'cerulean-gym',
      placements,
      assignments: [],
      hasAuthoritativeSessionState: false,
    })

    expect(model.status).toBe('waiting-for-snapshot')
    expect(model.controllablePlacementIds).toEqual([])
    expect(model.notice).toContain('authoritative live session map')
  })

  it('lets the session GM control every token on the session map', () => {
    const model = buildSessionTokenControlModel({
      enabled: true,
      identity: gmIdentity,
      mapSlug: 'cerulean-gym',
      placements,
      assignments: [],
      hasSnapshot: true,
    })

    expect(model.status).toBe('gm-authority')
    expect(model.controllablePlacementIds).toEqual(['assigned-token', 'visible-token', 'trainer-token'])
    expect(model.notice).toBeNull()
  })

  it('lets a player control only assigned visible token resources', () => {
    const model = buildSessionTokenControlModel({
      enabled: true,
      identity: playerIdentity,
      mapSlug: 'cerulean-gym',
      placements,
      assignments: [assignment({
        controllableResources: [
          { kind: 'token', tokenId: 'assigned-token', mapSlug: 'cerulean-gym' },
          { kind: 'token', tokenId: 'trainer-token' },
        ],
        visibleResources: [
          { kind: 'map', mapSlug: 'cerulean-gym' },
          { kind: 'token', tokenId: 'assigned-token', mapSlug: 'cerulean-gym' },
          { kind: 'token', tokenId: 'trainer-token' },
        ],
      })],
      hasSnapshot: true,
    })

    expect(model.status).toBe('assigned')
    expect(model.controllablePlacementIds).toEqual(['assigned-token', 'trainer-token'])
    expect(model.notice).toBeNull()
  })

  it('describes visible-only session maps without enabling token controls', () => {
    const model = buildSessionTokenControlModel({
      enabled: true,
      identity: playerIdentity,
      mapSlug: 'cerulean-gym',
      placements,
      assignments: [assignment()],
      hasSnapshot: true,
    })

    expect(model.status).toBe('visible-only')
    expect(model.controllablePlacementIds).toEqual([])
    expect(model.notice).toContain('none of its tokens are assigned')
    expect(model.notice).toContain('Ask the GM to assign a token')
  })

  it('describes players with no matching assignment in product language', () => {
    const model = buildSessionTokenControlModel({
      enabled: true,
      identity: playerIdentity,
      mapSlug: 'cerulean-gym',
      placements,
      assignments: [assignment({ playerId: otherPlayerId })],
      hasSnapshot: true,
    })

    expect(model.status).toBe('unassigned')
    expect(model.controllablePlacementIds).toEqual([])
    expect(model.notice).toContain('does not have an assignment yet')
    expect(model.notice).toContain('live session')
  })
})
