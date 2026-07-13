import { describe, expect, it, vi } from 'vitest'
import { createLivePlayAcceptedResult, createLivePlayRejectedResult } from '#shared/livePlayCommands'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
} from '#shared/moveAutomation/correctionCommands'
import { createAcceptedMoveCompensationResult } from '~~/server/domain/moveAutomation/planAcceptedMoveCompensation'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
} from '~~/server/domain/moveAutomation/plan'
import {
  MoveCorrectionCommandParserError,
  parseMoveCorrectionCommand,
} from '~~/server/livePlay/moveCorrectionCommandParser'
import type { SqliteLivePlayOpRecord } from '~~/server/storage/opRepository'

const originOperationId = 'op_originparse001'

const compensation = () => createAcceptedMoveCompensationResult({
  mapSlug: 'arena',
  originOperationId,
  plan: createMoveStateChangePlan([
    {
      kind: 'map-hazards',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 7,
      sourceOperationId: 'move.hazard',
      reasonCode: 'hazards-changed',
      previous: [],
      current: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
    {
      kind: 'map-metadata',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 7,
      sourceOperationId: 'move.log',
      reasonCode: 'accepted-log',
      previous: {},
      current: { moveLog: [] },
      compensation: unavailableMoveStateCompensation(
        'accepted-log-may-be-observed',
        'externally-observed',
      ),
    },
  ]),
})

const acceptedRecord = (): SqliteLivePlayOpRecord => ({
  schemaVersion: 1,
  mapSlug: 'arena',
  opId: originOperationId,
  commandHash: 'origin-hash' as never,
  command: { type: 'resolveMove' },
  result: createLivePlayAcceptedResult({
    opId: originOperationId,
    mapSlug: 'arena',
    previousRevision: 7,
    revision: 8,
    patches: [],
  }),
  moveCompensation: compensation(),
  resultRevision: 8,
  createdAt: 1_000,
  recordedAt: new Date(1_000).toISOString(),
})

const command = (operationIds: readonly string[]) => ({
  schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  opId: 'op_correctionparse1',
  mapSlug: 'arena',
  baseRevision: 8,
  type: GM_MOVE_CORRECTION_COMMAND_TYPE,
  payload: { originOperationId, operationIds },
})

describe('move correction server parser', () => {
  it('rejects mechanics-bearing syntax before reading private operation metadata', () => {
    const getStoredOpRecord = vi.fn(() => acceptedRecord())

    expect(() => parseMoveCorrectionCommand({
      ...command(['inverse.forged']),
      payload: {
        ...command(['inverse.forged']).payload,
        resources: [{ kind: 'sheet', revision: 5 }],
      },
    }, { opRepository: { getStoredOpRecord } })).toThrow(expect.objectContaining({
      code: 'invalid-command',
    }))
    expect(getStoredOpRecord).not.toHaveBeenCalled()
  })

  it('resolves available IDs from private accepted metadata in canonical source order', () => {
    const source = acceptedRecord()
    const available = source.moveCompensation!.operations.filter(
      operation => operation.availability === 'available',
    )
    const parsed = parseMoveCorrectionCommand(
      command([...available].reverse().map(operation => operation.operationId)),
      { opRepository: { getStoredOpRecord: vi.fn(() => source) } },
    )

    expect(parsed.origin).toBe(source)
    expect(parsed.operations.map(operation => operation.operationId)).toEqual(
      available.map(operation => operation.operationId),
    )
  })

  it('rejects unknown, unavailable, rejected, and missing origins before planning', () => {
    const source = acceptedRecord()
    const unavailable = source.moveCompensation!.operations.find(
      operation => operation.availability === 'unavailable',
    )!
    const rejected = {
      ...source,
      result: createLivePlayRejectedResult({
        opId: originOperationId,
        mapSlug: 'arena',
        reason: 'conflict',
        message: 'not accepted',
      }),
    }
    const candidates = [
      {
        record: source,
        body: command(['inverse.forged']),
        code: 'unknown-operation',
      },
      {
        record: source,
        body: command([unavailable.operationId]),
        code: 'unavailable-operation',
      },
      {
        record: rejected,
        body: command([source.moveCompensation!.operations[0]!.operationId]),
        code: 'origin-not-accepted',
      },
      {
        record: null,
        body: command([source.moveCompensation!.operations[0]!.operationId]),
        code: 'unknown-origin',
      },
    ]

    for (const candidate of candidates) {
      try {
        parseMoveCorrectionCommand(candidate.body, {
          opRepository: { getStoredOpRecord: vi.fn(() => candidate.record) },
        })
        throw new Error('expected parser rejection')
      }
      catch (error) {
        expect(error).toBeInstanceOf(MoveCorrectionCommandParserError)
        expect(error).toMatchObject({ code: candidate.code })
      }
    }
  })
})
