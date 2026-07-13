import {
  PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResolutionTerminalStatus,
} from '#shared/moveAutomation/pendingResolution'

const SPEC_HASH = 'a'.repeat(64)
const RULESET_HASH = 'b'.repeat(64)

export interface PendingMoveResolutionFixtureOptions {
  readonly resolutionId?: string
  readonly originMapSlug?: string
  readonly originOpId?: string
  readonly actorPlacementId?: string
  readonly createdAt?: number
  readonly updatedAt?: number
}

export const createPendingMoveResolutionFixture = (
  options: PendingMoveResolutionFixtureOptions = {},
): PendingMoveResolution => {
  const resolutionId = options.resolutionId ?? 'resolution-pending-1'
  const originMapSlug = options.originMapSlug ?? 'pending-arena'
  const originOpId = options.originOpId ?? 'op_declare0001'
  const actorPlacementId = options.actorPlacementId ?? 'actor-token'
  const createdAt = options.createdAt ?? 1_000
  const updatedAt = options.updatedAt ?? createdAt

  return parsePendingMoveResolution({
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    continuationKind: 'movespec-v2',
    resolutionId,
    originMapSlug,
    originOpId,
    actorPlacementId,
    canonicalMoveId: 'Pending Test',
    specVersion: 3,
    specHash: SPEC_HASH,
    rulesetId: 'ruleset-v1',
    rulesetHash: RULESET_HASH,
    phase: 'hit',
    readSet: [
      { kind: 'map', slug: originMapSlug, revision: 12 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 5 },
    ],
    trace: {
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
      ancestry: [],
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
          kind: 'phase-transition',
          reasonCode: 'hit-phase',
          from: 'accuracy',
          to: 'hit',
        },
        {
          sequence: 3,
          kind: 'operation',
          reasonCode: 'move.pending-test.choose',
          phase: 'hit',
          operationId: 'operation.choose',
          operationKind: 'choice-request',
          recipientIds: [actorPlacementId],
          outcome: 'pending',
          input: { requestId: 'window.branch' },
          result: { status: 'pending' },
        },
        {
          sequence: 4,
          kind: 'choice',
          reasonCode: 'move.pending-test.choose',
          phase: 'hit',
          requestId: 'window.branch',
          requestKind: 'choice',
          outcome: 'requested',
          optionId: null,
        },
      ],
    },
    rollLedger: [],
    outstandingWindows: [{
      windowId: 'window.branch',
      operationId: 'operation.choose',
      kind: 'choice',
      phase: 'hit',
      reasonCode: 'move.pending-test.choose',
      promptKey: 'move.pending-test.choose',
      ownership: [{ kind: 'actor', id: null }],
      options: [
        { id: 'option.attack', labelKey: 'move.pending-test.attack' },
        { id: 'option.support', labelKey: 'move.pending-test.support' },
      ],
      allowPass: true,
      priority: null,
    }],
    chosenOptions: [],
    causalAncestry: [],
    status: 'pending',
    createdAt,
    updatedAt,
    publicSummary: {
      schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
      resolutionId,
      actorPlacementId,
      canonicalMoveId: 'Pending Test',
      phase: 'hit',
      status: 'pending',
      outstandingWindowCount: 1,
      createdAt,
      updatedAt,
    },
  })
}

export const createTerminalMoveResolutionFixture = (input: {
  readonly source?: PendingMoveResolution
  readonly status?: PendingMoveResolutionTerminalStatus
  readonly updatedAt?: number
} = {}): PendingMoveResolution => {
  const source = input.source ?? createPendingMoveResolutionFixture()
  const status = input.status ?? 'cancelled'
  const updatedAt = input.updatedAt ?? source.updatedAt + 100

  return parsePendingMoveResolution({
    ...source,
    outstandingWindows: [],
    status,
    updatedAt,
    publicSummary: {
      ...source.publicSummary,
      status,
      outstandingWindowCount: 0,
      updatedAt,
    },
  })
}
