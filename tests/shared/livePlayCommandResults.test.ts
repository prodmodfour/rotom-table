import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createClearFieldEffectsCommandScopes,
  createClearHazardsCommandScopes,
} from '#shared/livePlayCommands'
import {
  validateTerminalLivePlayCommandResponse,
  validateTerminalResponseForCommand,
} from '#shared/livePlayCommandResults'

const command = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_terminal01',
  mapSlug: 'arena-map',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
  payload: { placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } },
  ...overrides,
})

const patch = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
  mapSlug: 'arena-map',
  revision: 5,
  scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
  payload: { placementId: 'token-pikachu', position: { x: 3, y: 0, z: 2 } },
  ...overrides,
})

const accepted = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  opId: 'op_terminal01',
  mapSlug: 'arena-map',
  previousRevision: 4,
  revision: 5,
  patches: [patch()],
  ...overrides,
})

const rejected = (overrides: Record<string, unknown> = {}) => ({
  ok: false,
  opId: 'op_terminal01',
  mapSlug: 'arena-map',
  reason: 'stale-revision',
  message: 'Map revision is stale.',
  currentRevision: 5,
  ...overrides,
})

describe('live-play terminal command response validation', () => {
  it('accepts terminal accepted, rejected, and duplicate response shapes while tolerating route extras', () => {
    expect(validateTerminalLivePlayCommandResponse({
      ...accepted(),
      map: { slug: 'arena-map' },
      sheetUpdates: [],
      move: { presentation: true },
      capture: { outcome: 'captured' },
      path: 'data/maps/arena-map.json',
    }).valid).toBe(true)

    expect(validateTerminalLivePlayCommandResponse({
      ...rejected(),
      sheetUpdates: [],
    }).valid).toBe(true)

    expect(validateTerminalLivePlayCommandResponse(rejected({
      reason: 'abandoned',
      message: 'This live-play operation was abandoned before execution.',
    })).valid).toBe(true)

    expect(validateTerminalLivePlayCommandResponse({
      ok: true,
      duplicate: true,
      opId: 'op_terminal01',
      original: accepted(),
      move: { presentation: true },
    }).valid).toBe(true)

    expect(validateTerminalLivePlayCommandResponse({
      ok: true,
      duplicate: true,
      opId: 'op_terminal01',
      original: rejected(),
    }).valid).toBe(true)
  })

  it('rejects malformed core result fields and unsupported patch or rejection values', () => {
    expect(validateTerminalLivePlayCommandResponse(accepted({ revision: -1 }))).toMatchObject({ valid: false })
    expect(validateTerminalLivePlayCommandResponse(rejected({ reason: 'later' }))).toMatchObject({ valid: false })
    expect(validateTerminalLivePlayCommandResponse(accepted({ patches: [patch({ type: 'map.unknown' })] }))).toMatchObject({ valid: false })
    expect(validateTerminalLivePlayCommandResponse(accepted({ patches: [patch({ payload: undefined })] }))).toMatchObject({ valid: false })
    expect(validateTerminalLivePlayCommandResponse({
      ok: true,
      duplicate: true,
      opId: 'op_terminal01',
      original: { ...accepted(), duplicate: true },
    })).toMatchObject({ valid: false })
  })

  it('verifies terminal responses belong to the command that was sent', () => {
    expect(validateTerminalResponseForCommand({ response: accepted(), command: command() }).valid).toBe(true)
    expect(validateTerminalResponseForCommand({
      response: accepted({ opId: 'op_other0001' }),
      command: command(),
    })).toMatchObject({ valid: false })
    expect(validateTerminalResponseForCommand({
      response: accepted({ mapSlug: 'other-map', patches: [patch({ mapSlug: 'other-map' })] }),
      command: command(),
    })).toMatchObject({ valid: false })
    expect(validateTerminalResponseForCommand({
      response: {
        ok: true,
        duplicate: true,
        opId: 'op_terminal01',
        original: accepted({ opId: 'op_other0001' }),
      },
      command: command(),
    })).toMatchObject({ valid: false })
    expect(validateTerminalResponseForCommand({
      response: {
        ok: true,
        duplicate: true,
        opId: 'op_terminal01',
        original: accepted({ mapSlug: 'other-map', patches: [patch({ mapSlug: 'other-map' })] }),
      },
      command: command(),
    })).toMatchObject({ valid: false })
  })

  it('verifies accepted clearFieldEffects patches match the submitted command type and scopes', () => {
    const clearCommand = command({
      type: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
      scopes: createClearFieldEffectsCommandScopes({ category: 'weather' }),
      payload: { category: 'weather' },
    })
    const clearPatch = (overrides: Record<string, unknown> = {}) => patch({
      type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
        category: 'weather',
        previous: { weather: [{ kind: 'sunny', rounds: 2 }], terrains: [], rooms: [] },
        current: { weather: [], terrains: [], rooms: [] },
      },
      ...overrides,
    })

    expect(validateTerminalResponseForCommand({
      response: accepted({ patches: [clearPatch()] }),
      command: clearCommand,
    }).valid).toBe(true)

    expect(validateTerminalResponseForCommand({
      response: accepted({
        patches: [clearPatch({
          payload: {
            command: LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
            category: 'weather',
            previous: { weather: [], terrains: [], rooms: [] },
            current: { weather: [], terrains: [], rooms: [] },
          },
        })],
      }),
      command: clearCommand,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'response.patches[0].payload.command' })]),
    })

    expect(validateTerminalResponseForCommand({
      response: accepted({ patches: [clearPatch({ type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS })] }),
      command: clearCommand,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'response.patches[0].type' })]),
    })

    expect(validateTerminalResponseForCommand({
      response: accepted({ patches: [clearPatch({ scopes: [{ kind: 'map', lane: 'hazards' }] })] }),
      command: clearCommand,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'response.patches[0].scopes[0]' })]),
    })
  })

  it('verifies accepted clearHazards patches match the submitted command type and scopes', () => {
    const cells = [{ x: 1, y: 0, z: 2 }]
    const clearCommand = command({
      type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
      scopes: createClearHazardsCommandScopes({ mode: 'cells', cells }),
      payload: { mode: 'cells', cells },
    })
    const clearPatch = (overrides: Record<string, unknown> = {}) => patch({
      type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
        mode: 'cells',
        cells,
        previous: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
        current: [],
        removed: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
      },
      ...overrides,
    })

    expect(validateTerminalResponseForCommand({
      response: accepted({ patches: [clearPatch()] }),
      command: clearCommand,
    }).valid).toBe(true)

    expect(validateTerminalResponseForCommand({
      response: accepted({
        patches: [clearPatch({
          payload: {
            command: LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
            mode: 'cells',
            cells,
            previous: [],
            current: [],
            removed: [],
          },
        })],
      }),
      command: clearCommand,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'response.patches[0].payload.command' })]),
    })

    expect(validateTerminalResponseForCommand({
      response: accepted({
        patches: [clearPatch({ type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS })],
      }),
      command: clearCommand,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'response.patches[0].type' })]),
    })

    expect(validateTerminalResponseForCommand({
      response: accepted({
        patches: [clearPatch({ scopes: [{ kind: 'map', lane: 'fieldEffects' }] })],
      }),
      command: clearCommand,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'response.patches[0].scopes[0]' })]),
    })
  })
})
