import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
  type LivePlayTokenScope,
} from '#shared/livePlayCommands'
import { createLivePlayCommandExecutor } from '~~/server/livePlay/executor'
import {
  LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
  createFileLivePlayOpStore,
  createInMemoryLivePlayOpStore,
} from '~~/server/livePlay/opStore'
import {
  createLivePlayCommandHash,
  stringifyLivePlayCommandForHash,
} from '~~/server/livePlay/opResult'

interface GridPosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface MoveTokenPayload {
  readonly placementId: string
  readonly position: GridPosition
}

interface TurnTokenPayload {
  readonly placementId: string
  readonly facing: 'north-east' | 'south-east' | 'south-west' | 'north-west'
}

interface ActionPayload {
  readonly placementId: string
  readonly actionName: string
}

const mapSlug = 'arena'
const tokenScope = (field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
  kind: 'token',
  placementId: 'token-1',
  field,
})

const createMoveCommand = (
  overrides: Partial<LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN, MoveTokenPayload, LivePlayTokenScope>> = {},
): LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN, MoveTokenPayload, LivePlayTokenScope> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_liveplaymove01',
  mapSlug,
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [tokenScope('position')],
  payload: {
    placementId: 'token-1',
    position: { x: 2, y: 0, z: 1 },
  },
  ...overrides,
})

const createTurnCommand = (
  overrides: Partial<LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN, TurnTokenPayload, LivePlayTokenScope>> = {},
): LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN, TurnTokenPayload, LivePlayTokenScope> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_liveplayturn01',
  mapSlug,
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  scopes: [tokenScope('facing')],
  payload: {
    placementId: 'token-1',
    facing: 'north-west',
  },
  ...overrides,
})

const createActionCommand = (
  overrides: Partial<LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER, ActionPayload, LivePlayTokenScope>> = {},
): LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER, ActionPayload, LivePlayTokenScope> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_liveplayaction1',
  mapSlug,
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
  scopes: [tokenScope('action')],
  payload: {
    placementId: 'token-1',
    actionName: 'Trip',
  },
  ...overrides,
})

const acceptedPatch = (
  command: LivePlayCommandEnvelope,
  revision: number,
): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
    ? LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION
    : command.type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
      ? LIVE_PLAY_PATCH_TYPES.TOKEN_FACING
      : LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: command.payload,
})

const createAccepted = (command: LivePlayCommandEnvelope, previousRevision: number) => {
  const revision = previousRevision + 1
  return createLivePlayAcceptedResult({
    opId: command.opId,
    mapSlug: command.mapSlug,
    previousRevision,
    revision,
    patches: [acceptedPatch(command, revision)],
  })
}

const cleanupRoots: string[] = []

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('live-play command idempotency', () => {
  it('hashes normalized command envelopes deterministically', () => {
    const command = createMoveCommand()
    const sameBodyDifferentKeyOrder = createMoveCommand({
      payload: {
        position: { z: 1, y: 0, x: 2 },
        placementId: 'token-1',
      } as MoveTokenPayload,
    })
    const changedPayload = createMoveCommand({
      payload: {
        placementId: 'token-1',
        position: { x: 3, y: 0, z: 1 },
      },
    })

    expect(stringifyLivePlayCommandForHash(command)).toBe(stringifyLivePlayCommandForHash(sameBodyDifferentKeyOrder))
    expect(createLivePlayCommandHash(command)).toBe(createLivePlayCommandHash(sameBodyDifferentKeyOrder))
    expect(createLivePlayCommandHash(changedPayload)).not.toBe(createLivePlayCommandHash(command))
  })

  it('returns stored move results for duplicate opIds without applying movement twice', async () => {
    const opStore = createInMemoryLivePlayOpStore()
    const executor = createLivePlayCommandExecutor({ opStore })
    const state = {
      revision: 4,
      position: { x: 1, y: 0, z: 1 },
    }
    const handler = vi.fn((command: ReturnType<typeof createMoveCommand>) => {
      const previousRevision = state.revision
      state.revision += 1
      state.position = command.payload.position
      return createAccepted(command, previousRevision)
    })
    const command = createMoveCommand()

    const first = await executor.execute({ command, handler })
    const second = await executor.execute({ command, handler })

    expect(first).toEqual(second)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ revision: 5, position: { x: 2, y: 0, z: 1 } })
    expect(opStore.recordCount).toBe(1)
  })

  it('returns stored turn results for duplicate opIds without applying the turn twice', async () => {
    const executor = createLivePlayCommandExecutor({ opStore: createInMemoryLivePlayOpStore() })
    const state = {
      revision: 4,
      facing: 'south-east' as TurnTokenPayload['facing'],
      turnApplications: 0,
    }
    const handler = vi.fn((command: ReturnType<typeof createTurnCommand>) => {
      const previousRevision = state.revision
      state.revision += 1
      state.facing = command.payload.facing
      state.turnApplications += 1
      return createAccepted(command, previousRevision)
    })
    const command = createTurnCommand()

    await executor.execute({ command, handler })
    const duplicate = await executor.execute({ command, handler })

    expect(duplicate).toMatchObject({ ok: true, revision: 5 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ revision: 5, facing: 'north-west', turnApplications: 1 })
  })

  it('returns stored action results for duplicate opIds without appending action logs twice', async () => {
    const executor = createLivePlayCommandExecutor({ opStore: createInMemoryLivePlayOpStore() })
    const state = {
      revision: 4,
      actionLog: [] as string[],
    }
    const handler = vi.fn((command: ReturnType<typeof createActionCommand>) => {
      const previousRevision = state.revision
      state.revision += 1
      state.actionLog.push(command.payload.actionName)
      return createAccepted(command, previousRevision)
    })
    const command = createActionCommand()

    const first = await executor.execute({ command, handler })
    const second = await executor.execute({ command, handler })

    expect(second).toEqual(first)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ revision: 5, actionLog: ['Trip'] })
  })

  it('rejects same-map opId reuse with a different command body without replacing the original result', async () => {
    const opStore = createInMemoryLivePlayOpStore()
    const executor = createLivePlayCommandExecutor({ opStore })
    const state = { revision: 4 }
    const handler = vi.fn((command: ReturnType<typeof createMoveCommand>) => {
      const previousRevision = state.revision
      state.revision += 1
      return createAccepted(command, previousRevision)
    })
    const command = createMoveCommand()
    const changedPayload = createMoveCommand({
      payload: {
        placementId: 'token-1',
        position: { x: 5, y: 0, z: 1 },
      },
    })

    const accepted = await executor.execute({ command, handler })
    const violation = await executor.execute({ command: changedPayload, handler })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(violation).toEqual({
      ok: false,
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'conflict',
      message: `Operation ID ${command.mapSlug}:${command.opId} was already recorded for a different command envelope`,
      currentRevision: 5,
    })
    expect(opStore.getOpResult(command.mapSlug, command.opId)).toEqual(accepted)
  })

  it('returns the original rejected result for duplicate opIds instead of accepting a later retry', async () => {
    const executor = createLivePlayCommandExecutor({ opStore: createInMemoryLivePlayOpStore() })
    const command = createTurnCommand()
    let shouldReject = true
    const handler = vi.fn((currentCommand: ReturnType<typeof createTurnCommand>) => {
      if (!shouldReject) return createAccepted(currentCommand, 4)
      return createLivePlayRejectedResult({
        opId: currentCommand.opId,
        mapSlug: currentCommand.mapSlug,
        reason: 'stale-revision',
        message: 'Token facing changed after the command was created.',
        currentRevision: 6,
      })
    })

    const rejected = await executor.execute({ command, handler })
    shouldReject = false
    const duplicate = await executor.execute({ command, handler })

    expect(rejected).toEqual({
      ok: false,
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'stale-revision',
      message: 'Token facing changed after the command was created.',
      currentRevision: 6,
    })
    expect(duplicate).toEqual(rejected)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('persists command hashes beside stored results in the file-backed operation store', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-live-play-ops-'))
    cleanupRoots.push(root)
    const store = createFileLivePlayOpStore({ root, clock: () => '2026-06-01T00:00:00.000Z' })
    const command = createTurnCommand()
    const result = createAccepted(command, 4)
    const commandHash = createLivePlayCommandHash(command)

    const record = store.saveOpResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      result,
    })
    const reloaded = createFileLivePlayOpStore({ root }).getOpRecord(command.mapSlug, command.opId)

    expect(record).toEqual({
      schemaVersion: LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      result,
      recordedAt: '2026-06-01T00:00:00.000Z',
    })
    expect(reloaded).toEqual(record)
    expect(store.getOpResult(command.mapSlug, command.opId)).toEqual(result)
  })
})
