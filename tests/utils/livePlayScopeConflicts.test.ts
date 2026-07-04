import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_TYPES,
  createClearHazardsCommandScopes,
  type ClearHazardsPayload,
  type LivePlayMapScope,
  type LivePlayScope,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
} from '#shared/livePlayCommands'
import {
  findLivePlayScopeConflict,
  livePlayScopeConflictDescriptors,
  livePlayScopesConflict,
} from '~/utils/livePlayScopeConflicts'

const tokenScope = (placementId: string, field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
  kind: 'token',
  placementId,
  field,
})

const mapScope = (lane: LivePlayMapScope['lane']): LivePlayMapScope => ({
  kind: 'map',
  lane,
})

const sheetScope = (field: string): LivePlaySheetScope => ({
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
  field,
})

const terrainCommand = (x: number, y: number, z: number) => ({
  type: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  scopes: [mapScope('terrain')],
  payload: {
    voxel: { x, y, z, materialId: 'stone' },
  },
})

const clearHazardsCommand = (payload: ClearHazardsPayload) => ({
  type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  scopes: createClearHazardsCommandScopes(payload),
  payload,
})

describe('live-play scope conflict utilities', () => {
  it('classifies different token position scopes as independent', () => {
    expect(livePlayScopesConflict(
      [tokenScope('token-a', 'position')],
      [tokenScope('token-b', 'position')],
    )).toBe(false)
  })

  it('classifies same token position scopes as conflicting', () => {
    const conflict = findLivePlayScopeConflict(
      [tokenScope('token-a', 'position')],
      [tokenScope('token-a', 'position')],
    )

    expect(conflict).toMatchObject({
      label: 'token token-a position',
      left: { kind: 'token-field', placementId: 'token-a', field: 'position' },
      right: { kind: 'token-field', placementId: 'token-a', field: 'position' },
    })
  })

  it('classifies token position and token facing scopes as independent', () => {
    expect(livePlayScopesConflict(
      [tokenScope('token-a', 'position')],
      [tokenScope('token-a', 'facing')],
    )).toBe(false)
  })

  it('classifies same map lane scopes as conflicting', () => {
    expect(findLivePlayScopeConflict(
      [mapScope('initiative')],
      [mapScope('initiative')],
    )).toMatchObject({ label: 'map lane initiative' })
  })

  it('classifies different sheet fields as independent', () => {
    expect(livePlayScopesConflict(
      [sheetScope('hp')],
      [sheetScope('conditions')],
    )).toBe(false)
  })

  it('classifies a broad terrain scope as conflicting with a derived terrain cell scope', () => {
    const cellCommand = terrainCommand(2, 0, 3)

    expect(findLivePlayScopeConflict(
      [mapScope('terrain')],
      cellCommand,
    )).toMatchObject({
      left: { kind: 'map-lane', lane: 'terrain' },
      right: { kind: 'terrain-cell', x: 2, y: 0, z: 3 },
      label: 'map lane terrain / terrain cell 2,0,3',
    })
  })

  it('uses derived terrain cells to keep different terrain cells independent', () => {
    expect(livePlayScopesConflict(
      terrainCommand(2, 0, 3),
      terrainCommand(4, 0, 3),
    )).toBe(false)
  })

  it('classifies clearHazards cells precisely while broad hazard scopes stay conservative', () => {
    const cellCommand = clearHazardsCommand({ mode: 'cells', cells: [{ x: 2, y: 0, z: 3 }] })

    expect(livePlayScopeConflictDescriptors(cellCommand)).toEqual([
      { kind: 'hazard-cell', x: 2, y: 0, z: 3, label: 'hazard cell 2,0,3' },
    ])
    expect(livePlayScopesConflict(
      clearHazardsCommand({ mode: 'cells', cells: [{ x: 2, y: 0, z: 3 }] }),
      clearHazardsCommand({ mode: 'cells', cells: [{ x: 4, y: 0, z: 3 }] }),
    )).toBe(false)
    expect(findLivePlayScopeConflict(
      [mapScope('hazards')],
      cellCommand,
    )).toMatchObject({
      left: { kind: 'map-lane', lane: 'hazards' },
      right: { kind: 'hazard-cell', x: 2, y: 0, z: 3 },
      label: 'map lane hazards / hazard cell 2,0,3',
    })
  })

  it('treats unknown scopes conservatively as conflicts', () => {
    const unknownScope = [{ kind: 'future', resource: 'wide' }] as unknown as readonly LivePlayScope[]

    expect(findLivePlayScopeConflict(
      unknownScope,
      [tokenScope('token-a', 'position')],
    )).toMatchObject({
      left: { kind: 'unknown' },
      right: { kind: 'token-field', placementId: 'token-a', field: 'position' },
    })
  })

  it('does not mutate command bodies while deriving conflict descriptors', () => {
    const command = terrainCommand(2, 0, 3)
    const before = JSON.stringify(command)

    expect(livePlayScopeConflictDescriptors(command)).toEqual([
      { kind: 'terrain-cell', x: 2, y: 0, z: 3, label: 'terrain cell 2,0,3' },
    ])
    expect(JSON.stringify(command)).toBe(before)
  })
})
