import { describe, expect, it } from 'vitest'
import {
  parsePlayerId,
  parseSessionDisplayName,
} from '#shared/sessionIdentity'
import type { PlayerAssignmentRecord } from '#shared/sessionPermissions'
import { buildSessionTokenAssignmentPanelModel } from '~/utils/sessionTokenAssignmentPanel'

const mapSlug = 'training-yard'
const rileyId = parsePlayerId('player_assignui01')
const brockId = parsePlayerId('player_assignui02')
const rileyName = parseSessionDisplayName('Riley')
const brockName = parseSessionDisplayName('Brock')
const updatedAt = '2026-05-26T16:00:00.000Z'

const rileyAssignment: PlayerAssignmentRecord = {
  playerId: rileyId,
  displayName: rileyName,
  controllableResources: [{
    kind: 'token',
    tokenId: 'token-pikachu',
    mapSlug,
    sheetKind: 'pokemon',
    sheetSlug: 'pikachu',
  }],
  visibleResources: [
    { kind: 'map', mapSlug },
    {
      kind: 'token',
      tokenId: 'token-pikachu',
      mapSlug,
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    },
  ],
  updatedAt,
}

const baseReadyOptions = {
  mapSlug,
  selectedMapSlug: mapSlug,
  selectedMapAttached: true,
  sessionMapAvailable: true,
  localRoleIsGm: true,
  rememberedRole: 'gm' as const,
  players: [
    { playerId: rileyId, displayName: rileyName },
    { playerId: brockId, displayName: brockName },
  ],
  assignments: [rileyAssignment],
  tokens: [
    { tokenId: 'token-pikachu', sheetKind: 'pokemon' as const, sheetSlug: 'pikachu' },
    { tokenId: 'token-onyx', mapSlug, sheetKind: 'pokemon' as const, sheetSlug: 'onyx' },
    { tokenId: 'token-onyx', mapSlug, sheetKind: 'pokemon' as const, sheetSlug: 'onyx' },
  ],
}

describe('session token assignment panel model', () => {
  it('lists joined players and current map token controls with assign and unassign actions', () => {
    const model = buildSessionTokenAssignmentPanelModel(baseReadyOptions)

    expect(model).toMatchObject({
      heading: 'Assign map tokens',
      statusKind: 'ready',
      canManage: true,
      mapSlug,
      selectedMapSlug: mapSlug,
      playerCount: 2,
      tokenCount: 2,
    })
    expect(model.summary).toContain('Choose which joined players can control each current map token')

    const riley = model.players[0]
    const brock = model.players[1]
    expect(riley?.displayName).toBe(rileyName)
    expect(riley?.summary).toBe('1 of 2 current map tokens assigned')
    expect(riley?.tokens[0]).toMatchObject({
      tokenId: 'token-pikachu',
      label: 'Pokémon token pikachu',
      description: 'token-pikachu · map training-yard · sheet pikachu',
      assigned: true,
      action: 'unassign',
      buttonLabel: 'Unassign control',
      disabled: false,
      resource: {
        kind: 'token',
        tokenId: 'token-pikachu',
        mapSlug,
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
      },
    })
    expect(riley?.tokens[1]).toMatchObject({
      tokenId: 'token-onyx',
      assigned: false,
      action: 'assign',
      buttonLabel: 'Assign control',
    })
    expect(brock?.summary).toBe('0 of 2 current map tokens assigned')
    expect(brock?.tokens[0]?.action).toBe('assign')
  })

  it('explains no-map and not-attached states without exposing session secrets', () => {
    const noMap = buildSessionTokenAssignmentPanelModel({
      localRoleIsGm: true,
      rememberedRole: 'gm',
    })
    expect(noMap.statusKind).toBe('blocked')
    expect(noMap.canManage).toBe(false)
    expect(noMap.summary).toBe('Open a saved map before assigning live session token control.')

    const notAttached = buildSessionTokenAssignmentPanelModel({
      ...baseReadyOptions,
      selectedMapSlug: null,
      selectedMapAttached: false,
      sessionMapAvailable: false,
    })
    expect(notAttached.statusKind).toBe('blocked')
    expect(notAttached.summary).toBe('Attach a map to the live session before assigning player token control.')
    expect(JSON.stringify(notAttached)).not.toContain('gmkey_')
  })

  it('shows empty states for joined-player and current-token gaps', () => {
    const noPlayers = buildSessionTokenAssignmentPanelModel({
      ...baseReadyOptions,
      players: [],
      assignments: [],
    })
    expect(noPlayers.statusKind).toBe('empty')
    expect(noPlayers.summary).toBe('Joined players will appear here after they enter the live session.')

    const noTokens = buildSessionTokenAssignmentPanelModel({
      ...baseReadyOptions,
      tokens: [],
    })
    expect(noTokens.statusKind).toBe('empty')
    expect(noTokens.summary).toBe('No current map tokens are available yet. Place Pokémon or trainer tokens on the map before assigning control.')
    expect(noTokens.players[0]?.summary).toBe('No current map tokens are available to assign.')
  })

  it('disables token controls while a live session request is busy', () => {
    const model = buildSessionTokenAssignmentPanelModel({
      ...baseReadyOptions,
      busy: true,
    })

    expect(model.statusKind).toBe('busy')
    expect(model.summary).toBe('Updating live session token assignments…')
    expect(model.players[0]?.tokens[0]).toMatchObject({
      disabled: true,
      disabledReason: 'Updating live session token assignments…',
    })
  })
})
