import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CONTROLLABLE_RESOURCE_KINDS,
  PERMISSION_DENIED_REASONS,
  SESSION_ROLES,
  VISIBLE_RESOURCE_KINDS,
  isControllableResourceKind,
  isPermissionDeniedReason,
  isSessionRole,
  isVisibleResourceKind,
  type ControllableResourceKind,
  type PermissionDenied,
  type PermissionDeniedReason,
  type PermissionResult,
  type PlayerAssignmentRecord,
  type PlayerSessionActor,
  type SessionActor,
  type SessionControllableResourceRef,
  type SessionMapResourceRef,
  type SessionResourceRef,
  type SessionRole,
  type SessionSheetResourceRef,
  type SessionTokenResourceRef,
  type SessionVisibleResourceRef,
} from '#shared/sessionPermissions'
import {
  parseClientId,
  parsePlayerId,
  sanitizeSessionDisplayName,
  type PlayerId,
  type SessionDisplayName,
} from '#shared/sessionIdentity'

const playerId = parsePlayerId('player_alice001')
const gmClientId = parseClientId('client_gm000001')
const playerClientId = parseClientId('client_player01')
const displayName = sanitizeSessionDisplayName('Alice')

const pokemonSheet = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionSheetResourceRef

const trainerSheet = {
  kind: 'sheet',
  sheetKind: 'trainer',
  sheetSlug: 'ash',
} as const satisfies SessionSheetResourceRef

const tokenResource = {
  kind: 'token',
  tokenId: 'placement-001',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const visibleMap = {
  kind: 'map',
  mapSlug: 'viridian-gym',
} as const satisfies SessionMapResourceRef

describe('session permission contract types', () => {
  it('defines session-local GM and player roles separately from legacy auth roles', () => {
    expect(SESSION_ROLES).toEqual(['gm', 'player'])
    expect(isSessionRole('gm')).toBe(true)
    expect(isSessionRole('player')).toBe(true)
    expect(isSessionRole('GM')).toBe(false)
    expect(isSessionRole(null)).toBe(false)

    const gmActor: SessionActor = { role: 'gm', clientId: gmClientId }
    const playerActor: SessionActor = {
      role: 'player',
      playerId,
      clientId: playerClientId,
      displayName,
    }

    expect(gmActor.role).toBe('gm')
    expect(playerActor.role).toBe('player')
    expectTypeOf(gmActor.role).toEqualTypeOf<'gm'>()
    expectTypeOf(playerActor).toMatchTypeOf<PlayerSessionActor>()

    if (playerActor.role === 'player') {
      expectTypeOf(playerActor.playerId).toEqualTypeOf<PlayerId>()
      expectTypeOf(playerActor.displayName).toEqualTypeOf<SessionDisplayName>()
    }
  })

  it('separates controllable sheet/token references from visible map/sheet/token references', () => {
    const controllableResources = [pokemonSheet, tokenResource] as const satisfies readonly SessionControllableResourceRef[]
    const visibleResources = [visibleMap, pokemonSheet, tokenResource] as const satisfies readonly SessionVisibleResourceRef[]

    expect(CONTROLLABLE_RESOURCE_KINDS).toEqual(['sheet', 'token'])
    expect(VISIBLE_RESOURCE_KINDS).toEqual(['map', 'sheet', 'token'])
    expect(isControllableResourceKind('sheet')).toBe(true)
    expect(isControllableResourceKind('map')).toBe(false)
    expect(isVisibleResourceKind('map')).toBe(true)
    expect(isVisibleResourceKind('hazard')).toBe(false)

    expect(controllableResources).toEqual([pokemonSheet, tokenResource])
    expect(visibleResources).toEqual([visibleMap, pokemonSheet, tokenResource])
    expectTypeOf<(typeof controllableResources)[number]['kind']>().toEqualTypeOf<ControllableResourceKind>()
    expectTypeOf(visibleMap).toMatchTypeOf<SessionResourceRef>()
    expectTypeOf<SessionMapResourceRef>().not.toMatchTypeOf<SessionControllableResourceRef>()
  })

  it('models player assignment records with explicit controllable and visible grants', () => {
    const assignment: PlayerAssignmentRecord = {
      playerId,
      displayName,
      controllableResources: [trainerSheet, tokenResource],
      visibleResources: [visibleMap, trainerSheet, tokenResource],
      updatedAt: '2026-05-25T00:00:00.000Z',
      updatedByClientId: gmClientId,
    }

    expect(assignment.playerId).toBe(playerId)
    expect(assignment.controllableResources.map((resource) => resource.kind)).toEqual(['sheet', 'token'])
    expect(assignment.visibleResources.map((resource) => resource.kind)).toEqual(['map', 'sheet', 'token'])
    expect(assignment.updatedByClientId).toBe(gmClientId)
  })

  it('uses discriminated permission results for allow and deny responses', () => {
    const allowed: PermissionResult = {
      allowed: true,
      role: 'gm',
      resource: tokenResource,
    }
    const denied: PermissionResult = {
      allowed: false,
      role: 'player',
      reason: 'resource-not-assigned',
      message: 'This token is not assigned to the player.',
      resource: tokenResource,
    }

    expect(allowed.allowed).toBe(true)
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toBe('resource-not-assigned')
    expect(PERMISSION_DENIED_REASONS).toContain('gm-required')
    expect(PERMISSION_DENIED_REASONS).toContain('resource-not-visible')
    expect(isPermissionDeniedReason('resource-not-assigned')).toBe(true)
    expect(isPermissionDeniedReason('not-a-reason')).toBe(false)

    expectTypeOf(allowed.role).toEqualTypeOf<SessionRole>()
    expectTypeOf(denied).toMatchTypeOf<PermissionDenied>()

    const explain = (result: PermissionResult): PermissionDeniedReason | 'allowed' => {
      if (result.allowed) return 'allowed'
      expectTypeOf(result.reason).toEqualTypeOf<PermissionDeniedReason>()
      return result.reason
    }

    expect(explain(allowed)).toBe('allowed')
    expect(explain(denied)).toBe('resource-not-assigned')
  })
})
