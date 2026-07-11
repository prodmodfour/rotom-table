import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  MOVE_RESPONSE_COMMAND_LIMITS,
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  MOVE_RESPONSE_COMMAND_TYPE_VALUES,
  MoveResponseCommandValidationError,
  collectMoveResponseCommandIssues,
  isMoveResponseCommandType,
  parseMoveResponseCommand,
  validateMoveResponseCommand,
  type ChooseMoveResponseCommand,
  type GmCancelMoveResolutionCommand,
  type GmForceResolveMoveResolutionCommand,
  type MoveResponseCommand,
  type PassMoveResponseCommand,
  type ReactMoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'

const command = (
  type: MoveResponseCommand['type'] = MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
): Record<string, unknown> => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: 'op_response0001',
  mapSlug: 'pending-arena',
  baseRevision: 12,
  type,
  payload: type === MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL
    ? { resolutionId: 'resolution-pending-1' }
    : type === MOVE_RESPONSE_COMMAND_TYPES.PASS
      || type === MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE
      ? { resolutionId: 'resolution-pending-1', windowId: 'window.branch' }
      : {
          resolutionId: 'resolution-pending-1',
          windowId: 'window.branch',
          optionId: 'option.attack',
        },
})

const invalidIssueCodes = (candidate: unknown): readonly string[] => {
  const validation = validateMoveResponseCommand(candidate)
  return validation.valid ? [] : validation.issues.map(issue => issue.code)
}

describe('move response command contract', () => {
  it('defines the five stable response command kinds', () => {
    expect(MOVE_RESPONSE_COMMAND_TYPE_VALUES).toEqual([
      'choose',
      'react',
      'pass',
      'gm-cancel',
      'gm-force-resolve',
    ])
    for (const type of MOVE_RESPONSE_COMMAND_TYPE_VALUES) {
      expect(isMoveResponseCommandType(type)).toBe(true)
    }
    expect(isMoveResponseCommandType('resolve-with-damage')).toBe(false)
  })

  it('strictly parses immutable ID-only commands for every response kind', () => {
    const choose = parseMoveResponseCommand<ChooseMoveResponseCommand>(
      command(MOVE_RESPONSE_COMMAND_TYPES.CHOOSE),
    )
    const react = parseMoveResponseCommand<ReactMoveResponseCommand>(
      command(MOVE_RESPONSE_COMMAND_TYPES.REACT),
    )
    const pass = parseMoveResponseCommand<PassMoveResponseCommand>(
      command(MOVE_RESPONSE_COMMAND_TYPES.PASS),
    )
    const cancel = parseMoveResponseCommand<GmCancelMoveResolutionCommand>(
      command(MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL),
    )
    const force = parseMoveResponseCommand<GmForceResolveMoveResolutionCommand>(
      command(MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE),
    )

    expect(choose.payload).toEqual({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
      optionId: 'option.attack',
    })
    expect(react.payload.optionId).toBe('option.attack')
    expect(pass.payload).toEqual({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    })
    expect(cancel.payload).toEqual({ resolutionId: 'resolution-pending-1' })
    expect(force.payload).toEqual({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    })
    expect(Object.isFrozen(choose)).toBe(true)
    expect(Object.isFrozen(choose.payload)).toBe(true)
    expectTypeOf(choose).toEqualTypeOf<ChooseMoveResponseCommand>()
    expectTypeOf(react).toEqualTypeOf<ReactMoveResponseCommand>()
  })

  it('enforces the command kind selected by each response route', () => {
    expect(parseMoveResponseCommand(
      command(MOVE_RESPONSE_COMMAND_TYPES.REACT),
      MOVE_RESPONSE_COMMAND_TYPES.REACT,
    ).type).toBe('react')

    const validation = validateMoveResponseCommand(
      command(MOVE_RESPONSE_COMMAND_TYPES.CHOOSE),
      MOVE_RESPONSE_COMMAND_TYPES.REACT,
    )
    expect(validation).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({
        path: '$.type',
        code: 'unsupported-command-type',
      })],
    })
  })

  it('rejects missing, extra, or cross-kind ID fields', () => {
    const missingOption = command()
    missingOption.payload = {
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    }
    const optionOnPass = command(MOVE_RESPONSE_COMMAND_TYPES.PASS)
    optionOnPass.payload = {
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
      optionId: 'option.attack',
    }
    const windowOnCancel = command(MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL)
    windowOnCancel.payload = {
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    }

    expect(collectMoveResponseCommandIssues(missingOption)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.payload.optionId', code: 'missing-field' }),
    ]))
    expect(collectMoveResponseCommandIssues(optionOnPass)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.payload.optionId', code: 'unknown-field' }),
    ]))
    expect(collectMoveResponseCommandIssues(windowOnCancel)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.payload.windowId', code: 'unknown-field' }),
    ]))
  })

  it('rejects mechanics, scopes, state patches, and arbitrary command fields', () => {
    const mechanics = {
      ...command(),
      scopes: [{ kind: 'map', lane: 'metadata' }],
      payload: {
        ...(command().payload as Record<string, unknown>),
        roll: 20,
        damage: 999,
        effectOperations: [{ kind: 'damage' }],
      },
    }

    const issues = collectMoveResponseCommandIssues(mechanics)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.scopes', code: 'forbidden-field' }),
      expect.objectContaining({ path: '$.payload.roll', code: 'forbidden-field' }),
      expect.objectContaining({ path: '$.payload.damage', code: 'forbidden-field' }),
      expect.objectContaining({ path: '$.payload.effectOperations', code: 'forbidden-field' }),
    ]))
    expect(() => parseMoveResponseCommand(mechanics)).toThrow(MoveResponseCommandValidationError)
  })

  it('rejects malformed operation, map, revision, type, and identifier fields', () => {
    const malformed = {
      ...command(),
      schemaVersion: 2,
      opId: 'op_short',
      mapSlug: '../hidden',
      baseRevision: -1,
      type: 'execute-client-script',
      payload: [],
    }

    expect(invalidIssueCodes(malformed)).toEqual(expect.arrayContaining([
      'invalid-schema-version',
      'invalid-op-id',
      'invalid-map-slug',
      'invalid-base-revision',
      'unsupported-command-type',
    ]))

    const invalidStableIds = command()
    invalidStableIds.payload = {
      resolutionId: ' resolution-pending-1 ',
      windowId: 'Window Branch',
      optionId: 'option.attack!',
    }
    expect(invalidIssueCodes(invalidStableIds)).toEqual(expect.arrayContaining([
      'invalid-identifier',
    ]))
  })

  it('rejects oversized resolution, window, and option IDs before contextual parsing', () => {
    const oversizedResolution = command()
    oversizedResolution.payload = {
      ...(oversizedResolution.payload as Record<string, unknown>),
      resolutionId: 'r'.repeat(MOVE_RESPONSE_COMMAND_LIMITS.resolutionIdChars + 1),
    }
    const oversizedWindow = command()
    oversizedWindow.payload = {
      ...(oversizedWindow.payload as Record<string, unknown>),
      windowId: 'w'.repeat(MOVE_RESPONSE_COMMAND_LIMITS.windowIdChars + 1),
    }
    const oversizedOption = command()
    oversizedOption.payload = {
      ...(oversizedOption.payload as Record<string, unknown>),
      optionId: 'o'.repeat(MOVE_RESPONSE_COMMAND_LIMITS.optionIdChars + 1),
    }

    for (const candidate of [oversizedResolution, oversizedWindow, oversizedOption]) {
      expect(invalidIssueCodes(candidate)).toContain('limit-exceeded')
    }
  })

  it('requires plain command and payload objects', () => {
    class ForgedCommand {
      schemaVersion = 1
      opId = 'op_response0001'
      mapSlug = 'pending-arena'
      baseRevision = 12
      type = 'choose'
      payload = command().payload
    }

    expect(validateMoveResponseCommand(new ForgedCommand())).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'not-object' })],
    })
    expect(validateMoveResponseCommand({ ...command(), payload: new ForgedCommand() })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({
        path: '$.payload',
        code: 'not-object',
      })]),
    })
  })
})
