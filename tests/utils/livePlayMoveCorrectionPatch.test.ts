import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPES,
} from '#shared/livePlayCommands'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
} from '#shared/moveAutomation/correctionCommands'
import type { TabletopMap } from '~/types/map'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'

const map = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  revision: 8,
  dimensions: { x: 4, y: 2, z: 4 },
  playerVisible: true,
  voxels: [],
  hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 800,
})

describe('live-play move correction patches', () => {
  it('adopts server-authored corrected map lanes without replaying move presentation', () => {
    const current = map()
    const result = applyLivePlayPatchesToMap({
      map: current,
      mapSlug: 'arena',
      previousRevision: 8,
      revision: 9,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION,
        mapSlug: 'arena',
        revision: 9,
        scopes: [{ kind: 'map', lane: 'hazards' }],
        payload: {
          schemaVersion: MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
          command: GM_MOVE_CORRECTION_COMMAND_TYPE,
          originOperationId: 'op_originpatch001',
          correctionOperationId: 'op_correctpatch01',
          operationIds: ['inverse.state-change.1'],
          updatedAt: 1_000,
          resources: [{ kind: 'map', mapSlug: 'arena', expectedRevision: 8, revision: 9 }],
          sheets: [],
          changes: {
            hazards: {
              previous: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
              current: [],
            },
          },
        },
      }],
    })

    expect(result).toEqual({
      ok: true,
      applied: true,
      revision: 9,
      appliedPatchTypes: [LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION],
      terrainChanged: false,
    })
    expect(current).toMatchObject({ revision: 9, updatedAt: 1_000, hazards: [] })
  })
})
