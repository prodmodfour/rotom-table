import { describe, expect, it } from 'vitest'
import {
  PENDING_MOVE_RESOLUTION_LIMITS,
  PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  PENDING_MOVE_RESOLUTION_STATUSES,
  PendingMoveResolutionValidationError,
  createPendingMoveDeclarationResult,
  isPendingMoveDeclarationResult,
  parsePendingMoveResolution,
  parsePendingMoveResolutionPublicSummary,
} from '#shared/moveAutomation/pendingResolution'

const SPEC_HASH = 'a'.repeat(64)
const RULESET_HASH = 'b'.repeat(64)
const PARENT_HASH = 'c'.repeat(64)

const roll = () => ({
  rollId: 'roll.accuracy.1',
  parentEffectId: 'operation.accuracy',
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  reason: 'Accuracy check',
  naturalResults: [14],
  naturalResult: 14,
  modifiers: [{ sourceId: 'actor-accuracy', reason: 'Actor Accuracy', value: 2 }],
  finalValue: 16,
})

const ancestry = () => [{
  depth: 0,
  resolutionId: 'resolution-parent',
  canonicalId: 'Parent Move',
  definitionHash: PARENT_HASH,
  parentOperationId: null,
}]

const pendingTrace = () => ({
  schemaVersion: 1,
  program: {
    canonicalId: 'Pending Test',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 3,
    definitionHash: SPEC_HASH,
  },
  ruleset: {
    rulesetId: 'ruleset-v1',
    sourceDataSha256: RULESET_HASH,
  },
  ancestry: ancestry(),
  events: [
    {
      sequence: 1,
      kind: 'phase-transition',
      reasonCode: 'accuracy-phase',
      from: null,
      to: 'accuracy',
    },
    {
      sequence: 2,
      kind: 'operation',
      reasonCode: 'move.pending-test.accuracy',
      phase: 'accuracy',
      operationId: 'operation.accuracy',
      operationKind: 'roll',
      recipientIds: ['target-token'],
      outcome: 'applied',
      input: { formula: 'server-owned' },
      result: { rollId: 'roll.accuracy.1' },
    },
    {
      sequence: 3,
      kind: 'roll',
      reasonCode: 'move.pending-test.accuracy',
      phase: 'accuracy',
      roll: roll(),
    },
    {
      sequence: 4,
      kind: 'phase-transition',
      reasonCode: 'hit-phase',
      from: 'accuracy',
      to: 'hit',
    },
    {
      sequence: 5,
      kind: 'operation',
      reasonCode: 'move.pending-test.choose',
      phase: 'hit',
      operationId: 'operation.choose',
      operationKind: 'choice-request',
      recipientIds: ['actor-token'],
      outcome: 'pending',
      input: { requestId: 'window.branch' },
      result: { status: 'pending' },
    },
    {
      sequence: 6,
      kind: 'choice',
      reasonCode: 'move.pending-test.choose',
      phase: 'hit',
      requestId: 'window.branch',
      requestKind: 'choice',
      outcome: 'requested',
      optionId: null,
    },
  ],
})

const responseWindow = () => ({
  windowId: 'window.branch',
  operationId: 'operation.choose',
  kind: 'choice',
  phase: 'hit',
  reasonCode: 'move.pending-test.choose',
  promptKey: 'move.pending-test.choose',
  ownership: [
    { kind: 'gm', id: null },
    { kind: 'actor', id: null },
  ],
  options: [
    { id: 'option.attack', labelKey: 'move.pending-test.attack' },
    { id: 'option.support', labelKey: 'move.pending-test.support' },
  ],
  allowPass: true,
  priority: null,
})

const publicSummary = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  resolutionId: 'resolution-pending-1',
  actorPlacementId: 'actor-token',
  canonicalMoveId: 'Pending Test',
  phase: 'hit',
  status: 'pending',
  outstandingWindowCount: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
})

const pendingResolution = (): Record<string, any> => ({
  schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  continuationKind: 'movespec-v2',
  resolutionId: 'resolution-pending-1',
  originMapSlug: 'pending-arena',
  originOpId: 'op_declare0001',
  actorPlacementId: 'actor-token',
  canonicalMoveId: 'Pending Test',
  specVersion: 3,
  specHash: SPEC_HASH,
  rulesetId: 'ruleset-v1',
  rulesetHash: RULESET_HASH,
  phase: 'hit',
  readSet: [
    { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 8 },
    { kind: 'map', slug: 'pending-arena', revision: 12 },
    { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 5 },
  ],
  trace: pendingTrace(),
  rollLedger: [roll()],
  outstandingWindows: [responseWindow()],
  chosenOptions: [],
  causalAncestry: ancestry(),
  status: 'pending',
  createdAt: 1_000,
  updatedAt: 1_000,
  publicSummary: publicSummary(),
})

const reactionResolution = () => {
  const value = pendingResolution()
  value.trace.events = value.trace.events.map((event: Record<string, any>) => {
    if (event.kind === 'operation') {
      return {
        ...event,
        operationKind: 'reaction-request',
        input: { timing: 'post-hit', priority: 5 },
      }
    }
    if (event.kind === 'choice') return { ...event, requestKind: 'reaction' }
    return event
  })
  value.outstandingWindows = [{
    ...value.outstandingWindows[0],
    kind: 'reaction',
    timing: 'post-hit',
    priority: 5,
    depth: 1,
  }]
  return value
}

const withSelectedChoice = () => {
  const value = pendingResolution()
  value.trace.events.push({
    sequence: 7,
    kind: 'choice',
    reasonCode: 'move.pending-test.choose',
    phase: 'hit',
    requestId: 'window.branch',
    requestKind: 'choice',
    outcome: 'selected',
    optionId: 'option.attack',
  })
  value.outstandingWindows = []
  value.chosenOptions = [{
    windowId: 'window.branch',
    responseOpId: 'op_response0001',
    optionId: 'option.attack',
    chosenBy: { kind: 'actor', id: null },
    chosenAt: 1_100,
  }]
  value.status = 'resuming'
  value.updatedAt = 1_100
  value.publicSummary = publicSummary({
    status: 'resuming',
    outstandingWindowCount: 0,
    updatedAt: 1_100,
  })
  return value
}

const expectPendingError = (
  run: () => unknown,
  code: PendingMoveResolutionValidationError['code'],
): PendingMoveResolutionValidationError => {
  try {
    run()
  }
  catch (error) {
    expect(error).toBeInstanceOf(PendingMoveResolutionValidationError)
    expect((error as PendingMoveResolutionValidationError).code).toBe(code)
    return error as PendingMoveResolutionValidationError
  }
  throw new Error(`Expected ${code}`)
}

describe('pending move resolution contract', () => {
  it('strictly parses, canonicalizes, detaches, and freezes suspended authority state', () => {
    const source = pendingResolution()
    const parsed = parsePendingMoveResolution(source)

    expect(parsed).not.toBe(source)
    expect(parsed.trace).not.toBe(source.trace)
    expect(parsed.rollLedger[0]).not.toBe(source.rollLedger[0])
    expect(parsed.readSet).toEqual([
      { kind: 'map', slug: 'pending-arena', revision: 12 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 5 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 8 },
    ])
    expect(parsed.outstandingWindows[0]?.ownership).toEqual([
      { kind: 'actor', id: null },
      { kind: 'gm', id: null },
    ])
    expect(parsed).toMatchObject({
      resolutionId: 'resolution-pending-1',
      originMapSlug: 'pending-arena',
      originOpId: 'op_declare0001',
      actorPlacementId: 'actor-token',
      canonicalMoveId: 'Pending Test',
      specVersion: 3,
      specHash: SPEC_HASH,
      rulesetHash: RULESET_HASH,
      phase: 'hit',
      status: 'pending',
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.readSet)).toBe(true)
    expect(Object.isFrozen(parsed.trace)).toBe(true)
    expect(Object.isFrozen(parsed.rollLedger)).toBe(true)
    expect(Object.isFrozen(parsed.outstandingWindows[0]?.options)).toBe(true)
  })

  it('normalizes pre-follow-up records to the MoveSpec continuation kind', () => {
    const legacyStoredRecord = pendingResolution()
    delete legacyStoredRecord.continuationKind

    expect(parsePendingMoveResolution(legacyStoredRecord).continuationKind).toBe('movespec-v2')
  })

  it('strictly validates concrete profile and side response-owner identities', () => {
    const concrete = pendingResolution()
    concrete.outstandingWindows[0]!.ownership = [
      { kind: 'profile', id: 'profile_responder1' },
      { kind: 'side', id: 'red-side' },
      { kind: 'placement', id: 'target-token' },
      { kind: 'target', id: 'target-token' },
    ]
    expect(parsePendingMoveResolution(concrete).outstandingWindows[0]?.ownership).toEqual([
      { kind: 'target', id: 'target-token' },
      { kind: 'placement', id: 'target-token' },
      { kind: 'profile', id: 'profile_responder1' },
      { kind: 'side', id: 'red-side' },
    ])

    const invalidProfile = pendingResolution()
    invalidProfile.outstandingWindows[0]!.ownership = [{ kind: 'profile', id: 'not-a-profile' }]
    expectPendingError(() => parsePendingMoveResolution(invalidProfile), 'invalid-pending-resolution')

    const invalidSide = pendingResolution()
    invalidSide.outstandingWindows[0]!.ownership = [{ kind: 'side', id: 'Bad Side' }]
    expectPendingError(() => parsePendingMoveResolution(invalidSide), 'invalid-pending-resolution')
  })

  it('cross-checks durable reaction timing, priority, and causal depth', () => {
    const parsed = parsePendingMoveResolution(reactionResolution())
    expect(parsed.outstandingWindows[0]).toMatchObject({
      kind: 'reaction',
      phase: 'hit',
      timing: 'post-hit',
      priority: 5,
      depth: 1,
      allowPass: true,
    })

    const wrongPhase = reactionResolution()
    wrongPhase.outstandingWindows[0].timing = 'pre-hit'
    expectPendingError(() => parsePendingMoveResolution(wrongPhase), 'inconsistent-state')

    const wrongPriority = reactionResolution()
    wrongPriority.outstandingWindows[0].priority = 4
    expectPendingError(() => parsePendingMoveResolution(wrongPriority), 'inconsistent-state')

    const wrongDepth = reactionResolution()
    wrongDepth.outstandingWindows[0].depth = 0
    expectPendingError(() => parsePendingMoveResolution(wrongDepth), 'inconsistent-state')

    const nonPassable = reactionResolution()
    nonPassable.outstandingWindows[0].allowPass = false
    expectPendingError(() => parsePendingMoveResolution(nonPassable), 'inconsistent-state')
  })

  it('parses chosen options and authorized passes without executable response data', () => {
    const selected = parsePendingMoveResolution(withSelectedChoice())
    expect(selected.status).toBe('resuming')
    expect(selected.outstandingWindows).toEqual([])
    expect(selected.chosenOptions).toEqual([{
      windowId: 'window.branch',
      responseOpId: 'op_response0001',
      optionId: 'option.attack',
      chosenBy: { kind: 'actor', id: null },
      chosenAt: 1_100,
    }])

    const passed = withSelectedChoice()
    passed.trace.events[6] = {
      ...passed.trace.events[6],
      outcome: 'passed',
      optionId: null,
    }
    passed.chosenOptions[0] = { ...passed.chosenOptions[0], optionId: null }
    expect(parsePendingMoveResolution(passed).chosenOptions[0]?.optionId).toBeNull()

    const executableOption = pendingResolution()
    executableOption.outstandingWindows[0]!.options[0] = {
      ...executableOption.outstandingWindows[0]!.options[0],
      effectOperations: [{ kind: 'damage' }],
    }
    expectPendingError(
      () => parsePendingMoveResolution(executableOption),
      'invalid-pending-resolution',
    )
  })

  it('distinguishes every pending, in-progress, and terminal status', () => {
    expect(PENDING_MOVE_RESOLUTION_STATUSES).toEqual([
      'pending',
      'resuming',
      'committed',
      'cancelled',
      'expired',
      'conflicted',
      'abandoned',
    ])

    for (const status of PENDING_MOVE_RESOLUTION_STATUSES) {
      const value = pendingResolution()
      value.status = status
      if (status !== 'pending' && status !== 'resuming') value.outstandingWindows = []
      value.publicSummary = publicSummary({
        status,
        outstandingWindowCount: value.outstandingWindows.length,
      })
      expect(parsePendingMoveResolution(value).status).toBe(status)
    }
  })

  it('parses the bounded public summary independently without private window detail', () => {
    const source = publicSummary()
    const parsed = parsePendingMoveResolutionPublicSummary(source)

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.keys(parsed)).not.toContain('options')
    expect(Object.keys(parsed)).not.toContain('ownership')
    expect(Object.keys(parsed)).not.toContain('rollLedger')
    expectPendingError(
      () => parsePendingMoveResolutionPublicSummary({ ...source, optionIds: ['secret'] }),
      'invalid-pending-resolution',
    )
  })

  it('builds a bounded non-terminal declaration acknowledgement', () => {
    const result = createPendingMoveDeclarationResult({
      opId: 'op_declare0001',
      mapSlug: 'pending-arena',
      previousRevision: 12,
      revision: 13,
      pendingResolution: publicSummary() as ReturnType<typeof parsePendingMoveResolutionPublicSummary>,
    })

    expect(result).toEqual({
      ok: true,
      pending: true,
      opId: 'op_declare0001',
      mapSlug: 'pending-arena',
      previousRevision: 12,
      revision: 13,
      patches: [],
      pendingResolution: publicSummary(),
    })
    expect(isPendingMoveDeclarationResult(result)).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.pendingResolution)).toBe(true)
    expectPendingError(
      () => createPendingMoveDeclarationResult({
        opId: 'op_declare0001',
        mapSlug: 'pending-arena',
        previousRevision: 12,
        revision: 14,
        pendingResolution: publicSummary() as ReturnType<typeof parsePendingMoveResolutionPublicSummary>,
      }),
      'inconsistent-state',
    )
    expect(isPendingMoveDeclarationResult({ ...result, patches: [{}] })).toBe(false)
  })

  it('rejects unknown fields, malformed identities, duplicate resources, and invalid lifecycle shape', () => {
    const source = pendingResolution()
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, clientPayload: {} }),
      'invalid-pending-resolution',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, schemaVersion: 2 }),
      'unsupported-schema-version',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, status: 'waiting-for-browser' }),
      'unknown-status',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, originOpId: 'client-op' }),
      'invalid-pending-resolution',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, specHash: 'not-a-hash' }),
      'invalid-pending-resolution',
    )
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        readSet: [...source.readSet, source.readSet[0]],
      }),
      'duplicate-id',
    )
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        readSet: source.readSet.filter((read: { kind: string }) => read.kind !== 'map'),
      }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        status: 'committed',
        publicSummary: publicSummary({ status: 'committed' }),
      }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        outstandingWindows: [],
        publicSummary: publicSummary({ outstandingWindowCount: 0 }),
      }),
      'inconsistent-state',
    )
  })

  it('rejects mismatched trace, ledger, ancestry, windows, timestamps, and public projection', () => {
    const source = pendingResolution()
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        trace: {
          ...source.trace,
          program: { ...source.trace.program, definitionHash: 'd'.repeat(64) },
        },
      }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, rollLedger: [] }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, causalAncestry: [] }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        outstandingWindows: [{
          ...source.outstandingWindows[0],
          windowId: 'window.forged',
        }],
      }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({ ...source, updatedAt: 999 }),
      'inconsistent-state',
    )
    expectPendingError(
      () => parsePendingMoveResolution({
        ...source,
        publicSummary: publicSummary({ canonicalMoveId: 'Other Move' }),
      }),
      'inconsistent-state',
    )
  })

  it('rejects duplicate/oversized options and accessor-backed or cyclic input without invoking code', () => {
    const duplicate = pendingResolution()
    duplicate.outstandingWindows[0]!.options.push(
      structuredClone(duplicate.outstandingWindows[0]!.options[0]!),
    )
    expectPendingError(() => parsePendingMoveResolution(duplicate), 'duplicate-id')

    const oversized = pendingResolution()
    oversized.outstandingWindows[0]!.options = Array.from(
      { length: PENDING_MOVE_RESOLUTION_LIMITS.optionsPerWindow + 1 },
      (_, index) => ({ id: `option.${index}`, labelKey: `option.${index}` }),
    )
    expectPendingError(() => parsePendingMoveResolution(oversized), 'limit-exceeded')

    let getterInvoked = false
    const accessor = pendingResolution()
    Object.defineProperty(accessor, 'specHash', {
      enumerable: true,
      get: () => {
        getterInvoked = true
        return SPEC_HASH
      },
    })
    expectPendingError(() => parsePendingMoveResolution(accessor), 'not-json')
    expect(getterInvoked).toBe(false)

    const cyclic = pendingResolution()
    cyclic.self = cyclic
    expectPendingError(() => parsePendingMoveResolution(cyclic), 'not-json')
  })
})
