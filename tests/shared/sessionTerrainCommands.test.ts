import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor } from '#shared/sessionPermissions'
import { parseSessionRevision } from '#shared/sessionRevisions'
import {
  BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  TERRAIN_VOXEL_SCOPE_FIELD_PREFIX,
  createTerrainVoxelCommandScope,
  formatTerrainVoxelScopeField,
  isTerrainCommandType,
  isTerrainCommandValidationCode,
  parseTerrainVoxelScopeField,
  validateBuildTerrainVoxelCommand,
  validateRemoveTerrainVoxelCommand,
  validateTerrainCommand,
  type BuildTerrainVoxelCommand,
  type RemoveTerrainVoxelCommand,
} from '#shared/sessionTerrainCommands'

const sessionId = parseSessionId('session_terrainshared001')
const gmClientId = parseClientId('client_terraingm1')
const playerClientId = parseClientId('client_terrainpl1')
const playerId = parsePlayerId('player_terrain001')
const displayName = parseSessionDisplayName('Terrain Player')

const gmActor = {
  role: 'gm' as const,
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const cell = { x: 1, y: 0, z: 2 }

const createBuildCommand = (
  overrides: Partial<BuildTerrainVoxelCommand> = {},
): BuildTerrainVoxelCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  opId: parseOpId('op_buildterrain1'),
  baseRevision: parseSessionRevision(0),
  scopes: [createTerrainVoxelCommandScope(cell, 'arena-map')],
  payload: {
    mapSlug: 'arena-map',
    voxel: {
      ...cell,
      materialId: 'meadow_grass',
      color: '#33aa44',
      ghost: true,
      blocksMovement: false,
      blocksSight: false,
      tags: ['  cover  ', 'ledge'],
    },
  },
  metadata: {
    traceId: 'trace-build-terrain',
  },
  ...overrides,
})

const createRemoveCommand = (
  overrides: Partial<RemoveTerrainVoxelCommand> = {},
): RemoveTerrainVoxelCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  opId: parseOpId('op_remterrain01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createTerrainVoxelCommandScope(cell, 'arena-map')],
  payload: {
    mapSlug: 'arena-map',
    cell,
  },
  ...overrides,
})

describe('session terrain commands', () => {
  it('defines terrain command types and cell-scoped helpers', () => {
    expect(isTerrainCommandType(BUILD_TERRAIN_VOXEL_COMMAND_TYPE)).toBe(true)
    expect(isTerrainCommandType(REMOVE_TERRAIN_VOXEL_COMMAND_TYPE)).toBe(true)
    expect(isTerrainCommandType('placeHazard')).toBe(false)
    expect(TERRAIN_VOXEL_SCOPE_FIELD_PREFIX).toBe('voxel')
    expect(formatTerrainVoxelScopeField(cell)).toBe('voxel:1,0,2')
    expect(parseTerrainVoxelScopeField('voxel:1,0,2')).toEqual(cell)
    expect(parseTerrainVoxelScopeField('voxels')).toBeUndefined()
    expect(createTerrainVoxelCommandScope(cell, 'arena-map')).toEqual({
      lane: 'terrain',
      field: 'voxel:1,0,2',
      mapSlug: 'arena-map',
    })
  })

  it('validates GM buildTerrainVoxel payloads and normalizes text fields', () => {
    const result = validateBuildTerrainVoxelCommand(createBuildCommand())

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid buildTerrainVoxel')
    expect(result.mapSlug).toBe('arena-map')
    expect(result.cell).toEqual(cell)
    expect(result.payload).toEqual({
      mapSlug: 'arena-map',
      voxel: {
        ...cell,
        materialId: 'meadow_grass',
        color: '#33aa44',
        ghost: true,
        blocksMovement: false,
        blocksSight: false,
        tags: ['cover', 'ledge'],
      },
    })
    expect(result.permission).toMatchObject({ allowed: true, role: 'gm' })
  })

  it('validates GM removeTerrainVoxel payloads', () => {
    const result = validateRemoveTerrainVoxelCommand(createRemoveCommand())

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid removeTerrainVoxel')
    expect(result.payload.cell).toEqual(cell)
    expect(result.cell).toEqual(cell)
  })

  it('reports payload and cell-scope issues', () => {
    const invalid = validateBuildTerrainVoxelCommand(createBuildCommand({
      scopes: [createTerrainVoxelCommandScope({ x: 9, y: 0, z: 2 }, 'other-map')],
      payload: {
        mapSlug: 'arena-map',
        voxel: {
          x: -1,
          y: 0.5,
          z: Number.MAX_SAFE_INTEGER + 1,
          materialId: '',
          color: '',
          ghost: 'yes',
          blocksMovement: 'no',
          blocksSight: 1,
          tags: ['ok', ''],
        },
      } as unknown as BuildTerrainVoxelCommand['payload'],
    }))

    expect(invalid.valid).toBe(false)
    if (invalid.valid) throw new Error('expected invalid buildTerrainVoxel')
    const issueByPath = new Map(invalid.issues.map((issue) => [issue.path, issue]))
    expect(issueByPath.get('payload.voxel.x')?.code).toBe('invalid-cell')
    expect(issueByPath.get('payload.voxel.y')?.code).toBe('invalid-cell')
    expect(issueByPath.get('payload.voxel.z')?.code).toBe('invalid-cell')
    expect(issueByPath.get('payload.voxel.materialId')?.code).toBe('invalid-material-id')
    expect(issueByPath.get('payload.voxel.color')?.code).toBe('invalid-color')
    expect(issueByPath.get('payload.voxel.ghost')?.code).toBe('invalid-ghost')
    expect(issueByPath.get('payload.voxel.blocksMovement')?.code).toBe('invalid-blocking-flag')
    expect(issueByPath.get('payload.voxel.blocksSight')?.code).toBe('invalid-blocking-flag')
    expect(issueByPath.get('payload.voxel.tags[1]')?.code).toBe('invalid-tags')

    const mismatchedMap = validateRemoveTerrainVoxelCommand(createRemoveCommand({
      scopes: [createTerrainVoxelCommandScope(cell, 'other-map')],
      payload: {
        mapSlug: 'arena-map',
        cell,
      },
    }))
    expect(mismatchedMap.valid).toBe(false)
    if (mismatchedMap.valid) throw new Error('expected mismatched map rejection')
    expect(new Map(mismatchedMap.issues.map((issue) => [issue.path, issue])).get('payload.mapSlug')?.code)
      .toBe('invalid-map-slug')

    const missingCellScope = validateRemoveTerrainVoxelCommand(createRemoveCommand({
      scopes: [{ lane: 'terrain', field: 'voxel:2,0,2', mapSlug: 'arena-map' }],
    }))
    expect(missingCellScope.valid).toBe(false)
    if (missingCellScope.valid) throw new Error('expected missing cell scope rejection')
    expect(missingCellScope.issues.some((issue) => issue.code === 'invalid-terrain-scope')).toBe(true)
    expect(isTerrainCommandValidationCode('invalid-terrain-scope')).toBe(true)
    expect(isTerrainCommandValidationCode('not-real')).toBe(false)
  })

  it('rejects player actors because terrain editing is GM-only', () => {
    const result = validateTerrainCommand(createBuildCommand({ actor: playerActor }))

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected player denial')
    expect(result.permission).toMatchObject({
      allowed: false,
      reason: 'gm-required',
    })
    expect(result.issues.some((issue) => issue.code === 'permission-denied')).toBe(true)
  })
})
