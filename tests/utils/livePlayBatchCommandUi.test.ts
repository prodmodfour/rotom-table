import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import {
  buildLivePlayBatchCommandSummary,
  buildLivePlayBatchPendingLabel,
  isLivePlayBatchCommandType,
} from '~/utils/livePlayBatchCommandUi'

const commandBody = (
  type: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_batchsummary001',
  mapSlug: 'arena-map',
  baseRevision: 7,
  type,
  scopes: [{ kind: 'map', lane: 'hazards' }],
  payload,
  clientId: 'client-secret-should-not-render',
})

describe('livePlayBatchCommandUi', () => {
  it('builds concise pending labels for active batch commands with safe counts', () => {
    expect(buildLivePlayBatchPendingLabel([
      {
        commandType: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
        body: commandBody(LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS, { mode: 'all' }),
      },
    ], { hazardCount: 12 })).toBe('Clearing 12 hazards…')

    expect(buildLivePlayBatchPendingLabel([
      {
        commandType: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
        body: commandBody(LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS, {
          operations: [
            { action: 'upsert', voxel: { x: 1, y: 0, z: 1, materialId: 'stone', color: '#abcdef', tags: ['secret-tag'] } },
            { action: 'remove', cell: { x: 2, y: 0, z: 1 } },
          ],
        }),
      },
    ])).toBe('Applying terrain brush (2 cells)…')
  })

  it('summarizes recovery entries without exposing payload coordinates or private labels', () => {
    const summary = buildLivePlayBatchCommandSummary({
      commandType: LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
      body: commandBody(LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS, {
        operations: [
          { action: 'upsert', hazard: { kind: 'spikes', x: 101, y: 4, z: 202, owner: 'secret-owner' } },
          { action: 'remove', cell: { x: 303, y: 5, z: 404, kind: 'spikes' } },
        ],
      }),
    })

    expect(summary).toEqual({
      title: 'Edit hazards',
      pendingLabel: 'Applying hazard brush (2 cells)…',
      recoveryLabel: 'Applying hazard brush (2 cells)',
    })
    const rendered = `${summary?.title} ${summary?.pendingLabel} ${summary?.recoveryLabel}`
    expect(rendered).not.toContain('101')
    expect(rendered).not.toContain('303')
    expect(rendered).not.toContain('secret-owner')
    expect(rendered).not.toContain('client-secret')
  })

  it('summarizes clear modes and ignores non-batch commands', () => {
    expect(buildLivePlayBatchCommandSummary({
      body: commandBody(LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS, { category: 'weather', kinds: ['sunny', 'rainy'] }),
    })?.recoveryLabel).toBe('Clearing 2 weather effects')

    expect(buildLivePlayBatchCommandSummary({
      commandType: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
      body: commandBody(LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS, { mode: 'cells', cells: [{ x: 9, y: 0, z: 9 }] }),
    })?.pendingLabel).toBe('Clearing 1 hazard cell…')

    expect(isLivePlayBatchCommandType(LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN)).toBe(false)
    expect(buildLivePlayBatchCommandSummary({
      commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      body: commandBody(LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN, { placementId: 'secret-token' }),
    })).toBeNull()
  })
})
