import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  canActorControlResource,
  canActorViewResource,
  canUseGmAuthority,
  canUsePlayerAuthority,
  findPlayerAssignment,
  getAssignedTokenIds,
  getSessionActorRole,
  isGmSessionActor,
  isMapVisibleToPlayer,
  isPlayerSessionActor,
  isResourceAssignedToPlayer,
  isResourceControllableByPlayer,
  isResourceVisibleToPlayer,
  isSheetAssignedToPlayer,
  isSheetVisibleToPlayer,
  isTokenIdAssignedToPlayer,
  isTokenVisibleToPlayer,
  sessionResourceRefsMatch,
  sessionTokenResourceRefsMatch,
  type GmSessionActor,
  type PlayerAssignmentRecord,
  type PlayerSessionActor,
  type SessionMapResourceRef,
  type SessionSheetResourceRef,
  type SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import {
  parseClientId,
  parsePlayerId,
  sanitizeSessionDisplayName,
  type PlayerId,
} from '#shared/sessionIdentity'

const playerId = parsePlayerId('player_perm0001')
const otherPlayerId = parsePlayerId('player_perm0002')
const gmClientId = parseClientId('client_permGM01')
const playerClientId = parseClientId('client_permPL01')
const otherClientId = parseClientId('client_permPL02')
const displayName = sanitizeSessionDisplayName('Permission Player')
const otherDisplayName = sanitizeSessionDisplayName('Other Player')

const gmActor: GmSessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const otherPlayerActor: PlayerSessionActor = {
  role: 'player',
  playerId: otherPlayerId,
  clientId: otherClientId,
  displayName: otherDisplayName,
}

const visibleMap = {
  kind: 'map',
  mapSlug: 'viridian-gym',
} as const satisfies SessionMapResourceRef

const hiddenMap = {
  kind: 'map',
  mapSlug: 'rocket-hideout',
} as const satisfies SessionMapResourceRef

const pikachuSheet = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionSheetResourceRef

const eeveeSheet = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} as const satisfies SessionSheetResourceRef

const trainerSheet = {
  kind: 'sheet',
  sheetKind: 'trainer',
  sheetSlug: 'ash',
} as const satisfies SessionSheetResourceRef

const tokenIdOnlyGrant = {
  kind: 'token',
  tokenId: 'token-pikachu',
} as const satisfies SessionTokenResourceRef

const assignedToken = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const unassignedVisibleToken = {
  kind: 'token',
  tokenId: 'token-eevee',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} as const satisfies SessionTokenResourceRef

const hiddenAssignedToken = {
  kind: 'token',
  tokenId: 'token-secret',
  mapSlug: 'rocket-hideout',
} as const satisfies SessionTokenResourceRef

const explicitVisibleToken = {
  kind: 'token',
  tokenId: 'token-explicit',
  mapSlug: 'rocket-hideout',
} as const satisfies SessionTokenResourceRef

const assignment: PlayerAssignmentRecord = {
  playerId,
  displayName,
  controllableResources: [pikachuSheet, tokenIdOnlyGrant, hiddenAssignedToken, tokenIdOnlyGrant],
  visibleResources: [visibleMap, pikachuSheet, explicitVisibleToken],
  updatedAt: '2026-05-25T00:00:00.000Z',
  updatedByClientId: gmClientId,
}

const assignments = [assignment] as const satisfies readonly PlayerAssignmentRecord[]

describe('session permission predicate helpers', () => {
  it('narrows GM/player actors and role requirements before command-specific checks', () => {
    expect(getSessionActorRole(gmActor)).toBe('gm')
    expect(getSessionActorRole(playerActor)).toBe('player')
    expect(getSessionActorRole({ role: 'spectator' })).toBeUndefined()

    expect(isGmSessionActor(gmActor)).toBe(true)
    expect(isGmSessionActor({ role: 'gm', clientId: 'client_bad' })).toBe(false)
    expect(isPlayerSessionActor(playerActor)).toBe(true)
    expect(isPlayerSessionActor({ ...playerActor, displayName: '<unsafe>' })).toBe(false)

    if (isPlayerSessionActor(playerActor)) {
      expectTypeOf(playerActor.playerId).toEqualTypeOf<PlayerId>()
    }

    expect(canUseGmAuthority(gmActor)).toMatchObject({ allowed: true, role: 'gm' })
    expect(canUseGmAuthority(playerActor)).toMatchObject({
      allowed: false,
      reason: 'gm-required',
      role: 'player',
    })
    expect(canUsePlayerAuthority(playerActor)).toMatchObject({ allowed: true, role: 'player' })
    expect(canUsePlayerAuthority(gmActor)).toMatchObject({
      allowed: false,
      reason: 'player-required',
      role: 'gm',
    })
    expect(canUsePlayerAuthority({ role: 'player', clientId: playerClientId })).toMatchObject({
      allowed: false,
      reason: 'missing-player-identity',
      role: 'player',
    })
  })

  it('matches resources and extracts assigned token IDs without using display names', () => {
    expect(findPlayerAssignment(assignments, playerId)).toBe(assignment)
    expect(findPlayerAssignment(assignments, otherPlayerId)).toBeUndefined()

    expect(sessionResourceRefsMatch(visibleMap, { kind: 'map', mapSlug: 'viridian-gym' })).toBe(true)
    expect(sessionResourceRefsMatch(pikachuSheet, trainerSheet)).toBe(false)
    expect(sessionTokenResourceRefsMatch(tokenIdOnlyGrant, assignedToken)).toBe(true)
    expect(
      sessionTokenResourceRefsMatch(assignedToken, {
        ...assignedToken,
        mapSlug: 'saffron-gym',
      }),
    ).toBe(false)

    expect(getAssignedTokenIds(assignment)).toEqual(['token-pikachu', 'token-secret'])
    expect(isTokenIdAssignedToPlayer(assignment, 'token-pikachu')).toBe(true)
    expect(isTokenIdAssignedToPlayer(assignment, 'token-eevee')).toBe(false)
    expect(isSheetAssignedToPlayer(assignment, pikachuSheet)).toBe(true)
    expect(isSheetAssignedToPlayer(assignment, eeveeSheet)).toBe(false)
  })

  it('checks player-visible maps, sheets, and token visibility separately from control', () => {
    expect(isMapVisibleToPlayer(assignment, 'viridian-gym')).toBe(true)
    expect(isMapVisibleToPlayer(assignment, 'rocket-hideout')).toBe(false)
    expect(isSheetVisibleToPlayer(assignment, pikachuSheet)).toBe(true)
    expect(isSheetVisibleToPlayer(assignment, eeveeSheet)).toBe(false)

    expect(isTokenVisibleToPlayer(assignment, assignedToken)).toBe(true)
    expect(isTokenVisibleToPlayer(assignment, explicitVisibleToken)).toBe(true)
    expect(isTokenVisibleToPlayer(assignment, hiddenAssignedToken)).toBe(false)

    expect(isResourceVisibleToPlayer(assignment, visibleMap)).toBe(true)
    expect(isResourceVisibleToPlayer(assignment, hiddenMap)).toBe(false)
    expect(isResourceAssignedToPlayer(assignment, assignedToken)).toBe(true)
    expect(isResourceAssignedToPlayer(assignment, unassignedVisibleToken)).toBe(false)
    expect(isResourceAssignedToPlayer(assignment, visibleMap)).toBe(false)
  })

  it('requires assigned and visible resources before players can control them', () => {
    expect(isResourceControllableByPlayer(assignment, assignedToken)).toBe(true)
    expect(isResourceControllableByPlayer(assignment, pikachuSheet)).toBe(true)
    expect(isResourceControllableByPlayer(assignment, unassignedVisibleToken)).toBe(false)
    expect(isResourceControllableByPlayer(assignment, hiddenAssignedToken)).toBe(false)
    expect(isResourceControllableByPlayer(assignment, visibleMap)).toBe(false)
  })

  it('returns structured permission results for GM/player view and control decisions', () => {
    expect(canActorViewResource(gmActor, assignments, hiddenMap)).toMatchObject({
      allowed: true,
      role: 'gm',
      resource: hiddenMap,
    })
    expect(canActorViewResource(playerActor, assignments, visibleMap)).toMatchObject({
      allowed: true,
      role: 'player',
    })
    expect(canActorViewResource(playerActor, assignments, hiddenMap)).toMatchObject({
      allowed: false,
      reason: 'resource-not-visible',
      role: 'player',
    })
    expect(canActorViewResource(otherPlayerActor, assignments, visibleMap)).toMatchObject({
      allowed: false,
      reason: 'missing-player-identity',
      role: 'player',
    })

    expect(canActorControlResource(gmActor, assignments, hiddenMap)).toMatchObject({
      allowed: true,
      role: 'gm',
    })
    expect(canActorControlResource(playerActor, assignments, assignedToken)).toMatchObject({
      allowed: true,
      role: 'player',
    })
    expect(canActorControlResource(playerActor, assignments, unassignedVisibleToken)).toMatchObject({
      allowed: false,
      reason: 'resource-not-assigned',
      role: 'player',
    })
    expect(canActorControlResource(playerActor, assignments, hiddenAssignedToken)).toMatchObject({
      allowed: false,
      reason: 'resource-not-visible',
      role: 'player',
    })
    expect(canActorControlResource(playerActor, assignments, visibleMap)).toMatchObject({
      allowed: false,
      reason: 'resource-not-controllable',
      role: 'player',
    })
    expect(canActorControlResource({ role: 'spectator' }, assignments, assignedToken)).toMatchObject({
      allowed: false,
      reason: 'invalid-session-role',
    })
  })
})
