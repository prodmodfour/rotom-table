import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  parseMoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResponseOwner,
} from '#shared/moveAutomation/pendingResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import {
  pendingMoveResponseAuthorizationGrant,
} from '~~/server/policies/pendingMoveResponsePolicy'
import {
  PendingMoveResponseAccessError,
  authorizePendingMoveResponseWindow,
} from '~~/server/useCases/pendingMoveResponseAccess'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { StoredPendingMoveResolution } from '~~/server/storage/pendingMoveResolutionRepository'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'

const profile = (
  id: string,
  linkedCharacters: PlayerProfile['linkedCharacters'],
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: id.slice('profile_'.length) as PlayerProfileDisplayName,
  linkedCharacters,
})

const attackerProfile = profile('profile_attacker1', [
  { sheetKind: 'pokemon', sheetSlug: 'actor-mon' },
])
const defenderProfile = profile('profile_defender1', [
  { sheetKind: 'trainer', sheetSlug: 'misty' },
])
const directProfile = profile('profile_direct01', [])
const outsiderProfile = profile('profile_outside1', [
  { sheetKind: 'pokemon', sheetSlug: 'outside-mon' },
])

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'pending-arena',
  name: 'Pending Arena',
  folder: '',
  revision: 12,
  dimensions: { x: 8, y: 3, z: 8 },
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'actor-token',
      sheetKind: 'pokemon',
      sheetSlug: 'actor-mon',
      sideId: 'blue-side',
      position: { x: 0, y: 0, z: 0 },
    },
    {
      id: 'target-token',
      sheetKind: 'pokemon',
      sheetSlug: 'target-mon',
      sideId: 'red-side',
      position: { x: 1, y: 0, z: 0 },
    },
    {
      id: 'red-ally-token',
      sheetKind: 'pokemon',
      sheetSlug: 'red-ally-mon',
      sideId: 'red-side',
      position: { x: 2, y: 0, z: 0 },
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      'blue-side': { id: 'blue-side', label: 'Blue', status: 'active' },
      'red-side': { id: 'red-side', label: 'Red', status: 'active' },
    },
  },
  ...overrides,
})

const resolutionWithOwner = (
  owner: PendingMoveResponseOwner,
  resolutionId = `resolution-${owner.kind}`,
): PendingMoveResolution => {
  const source = createPendingMoveResolutionFixture({ resolutionId })
  return parsePendingMoveResolution({
    ...source,
    outstandingWindows: source.outstandingWindows.map(window => ({
      ...window,
      ownership: [owner],
    })),
    publicSummary: {
      ...source.publicSummary,
      resolutionId,
    },
  })
}

const stored = (resolution: PendingMoveResolution): StoredPendingMoveResolution => ({
  schemaVersion: 1,
  resolutionId: resolution.resolutionId,
  originMapSlug: resolution.originMapSlug,
  originOpId: resolution.originOpId,
  status: resolution.status,
  resolution,
  revision: 0,
  createdAt: resolution.createdAt,
  updatedAt: resolution.updatedAt,
  terminalOpId: null,
})

const trainerSheet = (): PersistedSheet => ({
  kind: 'trainer',
  slug: 'misty',
  revision: 3,
  updatedAt: 100,
  sheet: {
    slug: 'misty',
    name: 'Misty',
    level: 1,
    currentTeam: ['target-mon'],
    boxedPokemon: [],
  },
})

const accessDependencies = (map = mapFixture()) => ({
  mapRepository: { getBySlug: vi.fn((slug: string) => slug === map.slug ? map : null) },
  sheetRepository: {
    getByRef: vi.fn((kind: string, slug: string) => (
      kind === 'trainer' && slug === 'misty' ? trainerSheet() : null
    )),
  },
})

const commandFor = (profileId: PlayerProfileId) => parseMoveResponseCommand({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: 'op_response0001',
  mapSlug: 'pending-arena',
  baseRevision: 12,
  profileId,
  type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
  payload: {
    resolutionId: 'resolution-target',
    windowId: 'window.branch',
    optionId: 'option.attack',
  },
})

describe('pending move response ownership policy', () => {
  it.each([
    ['actor', { kind: 'actor', id: null }, attackerProfile],
    ['target', { kind: 'target', id: 'target-token' }, defenderProfile],
    ['placement', { kind: 'placement', id: 'target-token' }, defenderProfile],
    ['profile', { kind: 'profile', id: directProfile.id }, directProfile],
    ['side', { kind: 'side', id: 'red-side' }, defenderProfile],
  ] as const)('authorizes a %s owner through current profile authority', (_kind, owner, selectedProfile) => {
    const resolution = resolutionWithOwner(owner)
    const grant = pendingMoveResponseAuthorizationGrant({
      resolution,
      window: resolution.outstandingWindows[0]!,
      map: mapFixture(),
      viewer: {
        role: 'player',
        playerProfile: selectedProfile,
        linkedTrainerSheets: selectedProfile.id === defenderProfile.id
          ? [{ slug: 'misty', currentTeam: ['target-mon'], boxedPokemon: [] }]
          : [],
      },
    })

    expect(grant).toMatchObject({ source: 'window-owner', chosenBy: owner })
  })

  it('keeps GM-only ownership private from players while authorized GMs can supervise every window', () => {
    const resolution = resolutionWithOwner({ kind: 'gm', id: null })
    const window = resolution.outstandingWindows[0]!

    expect(pendingMoveResponseAuthorizationGrant({
      resolution,
      window,
      map: mapFixture(),
      viewer: { role: 'player', playerProfile: outsiderProfile },
    })).toBeNull()
    expect(pendingMoveResponseAuthorizationGrant({
      resolution,
      window,
      map: mapFixture({ playerVisible: false }),
      viewer: { role: 'gm' },
    })).toEqual({
      source: 'gm-authority',
      chosenBy: { kind: 'gm', id: null },
    })
  })

  it('lets a defender answer its target-owned reaction without controlling the attacker', () => {
    const resolution = resolutionWithOwner({ kind: 'target', id: 'target-token' }, 'resolution-target')
    const record = stored(resolution)
    const command = commandFor(defenderProfile.id)

    const grant = authorizePendingMoveResponseWindow({
      role: 'player',
      command,
      playerProfile: defenderProfile,
      storedResolution: record,
      window: resolution.outstandingWindows[0]!,
    }, accessDependencies())
    expect(grant.chosenBy).toEqual({ kind: 'target', id: 'target-token' })

    expect(() => authorizePendingMoveResponseWindow({
      role: 'player',
      command: commandFor(attackerProfile.id),
      playerProfile: attackerProfile,
      storedResolution: record,
      window: resolution.outstandingWindows[0]!,
    }, accessDependencies())).toThrowError(PendingMoveResponseAccessError)
  })
})

describe('pending move response query privacy', () => {
  it('returns only eligible option detail without ownership, hidden targets, rolls, reads, or trace', () => {
    const target = resolutionWithOwner({ kind: 'target', id: 'target-token' }, 'resolution-target')
    const gmOnly = resolutionWithOwner({ kind: 'gm', id: null }, 'resolution-gm')
    const repository = {
      listByMap: vi.fn(() => [stored(target), stored(gmOnly)]),
    }
    const dependencies = {
      ...accessDependencies(),
      pendingResolutionRepository: repository,
    }

    const result = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: 'pending-arena',
      playerProfile: defenderProfile,
    }, dependencies)

    expect(result.windows).toHaveLength(1)
    expect(result.windows[0]).toEqual({
      schemaVersion: 1,
      resolution: target.publicSummary,
      window: {
        windowId: 'window.branch',
        kind: 'choice',
        phase: 'hit',
        reasonCode: 'move.pending-test.choose',
        promptKey: 'move.pending-test.choose',
        options: [
          { id: 'option.attack', labelKey: 'move.pending-test.attack' },
          { id: 'option.support', labelKey: 'move.pending-test.support' },
        ],
        allowPass: true,
        priority: null,
      },
    })
    const wire = JSON.stringify(result)
    expect(wire).not.toContain('ownership')
    expect(wire).not.toContain('target-token')
    expect(wire).not.toContain('operation.choose')
    expect(wire).not.toContain('rollLedger')
    expect(wire).not.toContain('readSet')
    expect(wire).not.toContain('trace')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.windows)).toBe(true)
    expect(Object.isFrozen(result.windows[0]?.window.options)).toBe(true)

    expect(listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: 'pending-arena',
      playerProfile: outsiderProfile,
    }, dependencies).windows).toEqual([])
  })

  it('checks map visibility before listing private pending records', () => {
    const listByMap = vi.fn()
    expect(() => listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: 'pending-arena',
      playerProfile: defenderProfile,
    }, {
      ...accessDependencies(mapFixture({ playerVisible: false })),
      pendingResolutionRepository: { listByMap },
    })).toThrow(/Map is not player visible/)
    expect(listByMap).not.toHaveBeenCalled()
  })
})
