import { describe, expect, it } from 'vitest'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  MOVE_CORRECTION_LIMITS,
  MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
  parseGmMoveCorrectionCommand,
  parseLivePlayMoveCorrectionPatchPayload,
  validateGmMoveCorrectionCommand,
} from '#shared/moveAutomation/correctionCommands'

const command = () => ({
  schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  opId: 'op_correctioncmd01',
  mapSlug: 'arena',
  baseRevision: 8,
  type: GM_MOVE_CORRECTION_COMMAND_TYPE,
  payload: {
    originOperationId: 'op_originmove001',
    operationIds: [
      'inverse.state-change.1.hp',
      'inverse.state-change.2.effects',
    ],
  },
})

describe('GM move correction wire contracts', () => {
  it('accepts only stable operation references and detaches the parsed command', () => {
    const source = command()
    const parsed = parseGmMoveCorrectionCommand(source)

    source.payload.operationIds[0] = 'inverse.forged'
    expect(parsed).toEqual(command())
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.payload.operationIds)).toBe(true)
  })

  it('rejects duplicate IDs, self ancestry, unknown fields, and client-authored mechanics', () => {
    const candidates = [
      {
        ...command(),
        payload: {
          ...command().payload,
          operationIds: ['inverse.same', 'inverse.same'],
        },
      },
      {
        ...command(),
        payload: {
          ...command().payload,
          originOperationId: command().opId,
        },
      },
      { ...command(), extra: true },
      {
        ...command(),
        payload: { ...command().payload, operationIds: [] },
      },
      { ...command(), baseRevision: -1 },
    ]

    for (const candidate of candidates) {
      expect(validateGmMoveCorrectionCommand(candidate).valid).toBe(false)
    }

    for (const [field, value] of [
      ['inverse', { kind: 'restore-sheet-hp', restore: { currentHp: 999 } }],
      ['resources', [{ kind: 'sheet', revision: 5 }]],
      ['roll', { natural: 20 }],
    ] as const) {
      const mechanics = validateGmMoveCorrectionCommand({
        ...command(),
        payload: { ...command().payload, [field]: value },
      })
      expect(mechanics.valid).toBe(false)
      if (!mechanics.valid) {
        expect(mechanics.issues).toContainEqual(expect.objectContaining({
          path: `$.payload.${field}`,
          code: 'forbidden-field',
        }))
      }
    }
  })

  it('rejects an oversized selection at the strict command boundary', () => {
    const result = validateGmMoveCorrectionCommand({
      ...command(),
      payload: {
        ...command().payload,
        operationIds: Array.from(
          { length: MOVE_CORRECTION_LIMITS.operationCount + 1 },
          (_, index) => `inverse.state-change.${index}`,
        ),
      },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        path: '$.payload.operationIds',
        code: 'limit-exceeded',
      }))
    }
  })

  it('strictly parses the public ancestry and resource revision audit patch', () => {
    const candidate = {
      schemaVersion: MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
      command: GM_MOVE_CORRECTION_COMMAND_TYPE,
      originOperationId: 'op_originmove001',
      correctionOperationId: 'op_correctioncmd01',
      operationIds: ['inverse.state-change.1.hp'],
      updatedAt: 1_000,
      resources: [
        { kind: 'map', mapSlug: 'arena', expectedRevision: 8, revision: 9 },
        {
          kind: 'sheet',
          sheetKind: 'pokemon',
          sheetSlug: 'target',
          expectedRevision: 4,
          revision: 5,
        },
      ],
      sheets: [{
        kind: 'pokemon',
        slug: 'target',
        expectedRevision: 4,
        revision: 5,
        placementIds: ['target-token'],
        changedFields: ['hp'],
      }],
      changes: {},
    }

    const parsed = parseLivePlayMoveCorrectionPatchPayload(candidate)
    expect(parsed).toEqual({ valid: true, payload: candidate, issues: [] })
    if (parsed.valid) expect(Object.isFrozen(parsed.payload)).toBe(true)

    expect(parseLivePlayMoveCorrectionPatchPayload({
      ...candidate,
      resources: [{ kind: 'map', mapSlug: 'arena', expectedRevision: 8, revision: 10 }],
    }).valid).toBe(false)
    expect(parseLivePlayMoveCorrectionPatchPayload({
      ...candidate,
      rollLedger: [{ natural: 20 }],
    }).valid).toBe(false)
  })
})
