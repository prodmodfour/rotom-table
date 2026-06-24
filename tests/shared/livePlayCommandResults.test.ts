import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
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
})
