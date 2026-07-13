import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
} from '#shared/moveAutomation/correctionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import { createAcceptedMoveCompensationResult } from '~~/server/domain/moveAutomation/planAcceptedMoveCompensation'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
} from '~~/server/domain/moveAutomation/plan'
import type { LivePlayCommandHash } from '~~/server/livePlay/opResult'
import type { SqliteLivePlayOpRecord } from '~~/server/storage/opRepository'
import {
  getGmMoveCorrectionDetailsUseCase,
} from '~~/server/useCases/getGmMoveCorrectionDetails'

const originOperationId = 'op_detailorigin01'
const acceptedCorrectionId = 'op_detailaccept01'
const conflictedCorrectionId = 'op_detailconflict1'

const sheet = (revision: number, stage: number): CharacterSheet => ({
  slug: 'private-actor',
  nickname: 'Private nickname',
  species: 'Pikachu',
  level: 20,
  revision,
  stats: { atk: { stage } },
  combat: { currentHp: 40, injuries: 0, conditions: [] },
  movelist: [{ name: 'Swords Dance' }],
})

const compensation = () => createAcceptedMoveCompensationResult({
  mapSlug: 'arena',
  originOperationId,
  plan: createMoveStateChangePlan([
    {
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'private-actor' },
      expectedRevision: 4,
      sourceOperationId: 'swords-dance.attack-stage',
      reasonCode: 'combat-stage-changed',
      previous: sheet(4, 0),
      current: sheet(5, 2),
      changedFields: ['combatStages'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
    {
      kind: 'map-metadata',
      scope: { kind: 'map', mapSlug: 'arena' },
      expectedRevision: 7,
      sourceOperationId: 'swords-dance.log',
      reasonCode: 'accepted-move-log-projection',
      previous: undefined,
      current: { moveLog: [{ moveName: 'Swords Dance' }] },
      compensation: unavailableMoveStateCompensation(
        'accepted-log-may-be-observed',
        'externally-observed',
      ),
    },
  ]),
})

const sourceCommand = (): ResolveMoveLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: originOperationId,
  mapSlug: 'arena',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  scopes: [],
  payload: {
    schemaVersion: 1,
    placementId: 'actor-token',
    moveName: 'Swords Dance',
    selection: { kind: 'self' },
  },
})

const sourceRecord = (): SqliteLivePlayOpRecord => ({
  schemaVersion: 1,
  mapSlug: 'arena',
  opId: originOperationId,
  commandHash: 'source-hash' as LivePlayCommandHash,
  command: sourceCommand(),
  result: createLivePlayAcceptedResult({
    opId: originOperationId,
    mapSlug: 'arena',
    previousRevision: 7,
    revision: 8,
    patches: [],
  }),
  moveCompensation: compensation(),
  recordedAt: new Date(1_000).toISOString(),
  createdAt: 1_000,
  resultRevision: 8,
})

const availableOperationId = (): string => compensation().operations.find(
  operation => operation.availability === 'available',
)!.operationId

const correctionCommand = (opId: string) => ({
  schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision: 8,
  type: GM_MOVE_CORRECTION_COMMAND_TYPE,
  payload: {
    originOperationId,
    operationIds: [availableOperationId()],
  },
})

const correctionRecord = (
  opId: string,
  status: 'accepted' | 'conflicted',
  createdAt: number,
): SqliteLivePlayOpRecord => ({
  schemaVersion: 1,
  mapSlug: 'arena',
  opId,
  commandHash: `${opId}-hash` as LivePlayCommandHash,
  command: correctionCommand(opId),
  result: status === 'accepted'
    ? createLivePlayAcceptedResult({
        opId,
        mapSlug: 'arena',
        previousRevision: 8,
        revision: 9,
        patches: [],
      })
    : createLivePlayRejectedResult({
        opId,
        mapSlug: 'arena',
        reason: 'conflict',
        message: 'The affected sheet changed after the move.',
        currentRevision: 9,
      }),
  correctionOriginOperationId: originOperationId,
  recordedAt: new Date(createdAt).toISOString(),
  createdAt,
  resultRevision: 9,
})

describe('GM move correction detail projection', () => {
  it('lists safe candidates, non-reversible warnings, and causal terminal history without values', () => {
    const source = sourceRecord()
    const corrections = [
      correctionRecord(acceptedCorrectionId, 'accepted', 1_100),
      correctionRecord(conflictedCorrectionId, 'conflicted', 1_200),
    ]
    const result = getGmMoveCorrectionDetailsUseCase({
      role: 'gm',
      mapSlug: 'arena',
      originOperationId,
    }, {
      opRepository: {
        getStoredOpRecord: vi.fn(() => source),
        listMoveCorrectionRecords: vi.fn(() => corrections),
      },
    })

    expect(result).toMatchObject({
      schemaVersion: 1,
      mapSlug: 'arena',
      originOperationId,
      moveName: 'Swords Dance',
      acceptedAt: 1_000,
      acceptedRevision: 8,
      operations: [
        {
          availability: 'available',
          effectKind: 'combat-stages',
          resource: {
            kind: 'sheet',
            sheetKind: 'pokemon',
            sheetSlug: 'private-actor',
            acceptedRevision: 5,
          },
        },
        {
          availability: 'unavailable',
          effectKind: 'history',
          safety: 'externally-observed',
        },
      ],
      corrections: [
        { correctionOperationId: acceptedCorrectionId, status: 'accepted', originOperationId },
        { correctionOperationId: conflictedCorrectionId, status: 'conflicted', originOperationId },
      ],
    })
    const json = JSON.stringify(result)
    expect(json).not.toContain('expectedCurrent')
    expect(json).not.toContain('restore')
    expect(json).not.toContain('Private nickname')
    expect(json).not.toContain('Pikachu')
    expect(json).not.toContain('currentHp')
  })

  it('authorizes before reading private compensation metadata', () => {
    const repository = {
      getStoredOpRecord: vi.fn(() => sourceRecord()),
      listMoveCorrectionRecords: vi.fn(() => []),
    }

    expect(() => getGmMoveCorrectionDetailsUseCase({
      role: 'player',
      mapSlug: 'arena',
      originOperationId,
    }, { opRepository: repository })).toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(repository.getStoredOpRecord).not.toHaveBeenCalled()
  })

  it('rejects missing and non-correctable origins cleanly', () => {
    expect(() => getGmMoveCorrectionDetailsUseCase({
      role: 'gm',
      mapSlug: 'arena',
      originOperationId,
    }, {
      opRepository: {
        getStoredOpRecord: () => null,
        listMoveCorrectionRecords: () => [],
      },
    })).toThrow(expect.objectContaining({ statusCode: 404 }))

    const notCorrectable = { ...sourceRecord(), moveCompensation: undefined }
    expect(() => getGmMoveCorrectionDetailsUseCase({
      role: 'gm',
      mapSlug: 'arena',
      originOperationId,
    }, {
      opRepository: {
        getStoredOpRecord: () => notCorrectable,
        listMoveCorrectionRecords: () => [],
      },
    })).toThrow(expect.objectContaining({ statusCode: 409 }))
  })
})
