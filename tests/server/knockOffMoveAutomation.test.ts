import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  isPendingMoveDeclarationResult,
} from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type ChooseMoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  parseMoveItemChoiceDeclaration,
} from '#shared/moveAutomation/itemChoices'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { deepCloneJson } from '~/utils/serialization'
import {
  KNOCK_OFF_ACTOR_PLACEMENT_ID,
  KNOCK_OFF_TARGET_PLACEMENT_ID,
  KNOCK_OFF_V2_SEMANTIC_SCENARIOS,
  knockOffV2Fixture,
  type KnockOffV2FixtureOptions,
} from '../fixtures/moveAutomation/knockOffV2'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  createAuthoritativeMoveItemResourceQueries,
  resolveAuthoritativeMoveItemResources,
  reviewedMoveItemResourceRequirementsFor,
  type AuthoritativeMoveItemResources,
} from '~~/server/domain/moveAutomation/itemResources'
import {
  enumerateAuthoritativeMoveItemChoices,
} from '~~/server/domain/moveAutomation/itemChoices'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '~~/server/domain/moveAutomation/random'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { KNOCK_OFF_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/knockOff'
import { planAuthoritativeMoveStateExecution } from '~~/server/domain/planAuthoritativeMoveState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const knockOffRow = manifestJson.moves.find(row => row.canonicalId === 'Knock Off')!
const runtime = registeredMoveAutomationRuntimeFor('Knock Off')
if (!runtime || runtime.kind !== 'movespec-v2') {
  throw new Error('Knock Off native runtime was not selected.')
}

const itemResourcesForFixture = (
  fixture: ReturnType<typeof knockOffV2Fixture>,
): AuthoritativeMoveItemResources => resolveAuthoritativeMoveItemResources({
  map: fixture.map,
  actorPlacementId: KNOCK_OFF_ACTOR_PLACEMENT_ID,
  selectedTargetPlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
  pokemonSheets: fixture.pokemonSheets,
  trainerSheets: fixture.trainerSheets,
  groupInventories: new Map(),
  requirements: reviewedMoveItemResourceRequirementsFor('Knock Off'),
})

const execute = (input: {
  readonly fixtureOptions?: KnockOffV2FixtureOptions
  readonly randomValues: readonly number[]
}) => {
  const fixture = knockOffV2Fixture(input.fixtureOptions)
  const context = buildAuthoritativeMoveRulesContext({
    map: fixture.map,
    pokemonSheets: fixture.pokemonSheets,
    trainerSheets: fixture.trainerSheets,
    intent: fixture.intent,
    candidatePlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    selectedPlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    random: createFiniteAuthoritativeMoveRandomStream(input.randomValues),
    time: 5_000,
    resolutionId: 'resolution-knock-off-test',
    itemResources: itemResourcesForFixture(fixture),
  })
  return executeMoveSpec({
    definition: runtime.definition,
    context,
    authoritativeTargetIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    resolutionId: 'resolution-knock-off-test',
  })
}

const traceOperation = (
  result: ReturnType<typeof executeMoveSpec>,
  operationId: string,
) => result.trace.events.find(event => (
  event.kind === 'operation' && event.operationId === operationId
))

describe('Knock Off native MoveSpec v2', () => {
  it('selects complete reviewed metadata and gates actor-owned item choices behind damage', () => {
    expect(knockOffRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '8bd60ebb28eb9b0bea3c79ca537507e349a0be86501de6df6e8d141dcf178c90',
        sourceModule: 'server/domain/moveAutomation/specs/knockOff.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(knockOffRow.scenarioIds).toEqual(
      KNOCK_OFF_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(runtime).toMatchObject({
      definition: { spec: KNOCK_OFF_MOVE_SPEC },
      definitionHash: knockOffRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Knock Off' }),
    )

    const hit = execute({ randomValues: [0.45, 0, 0] })
    expect(hit.kind).toBe('pending-request')
    if (hit.kind !== 'pending-request') return
    expect(hit.request).toMatchObject({
      kind: 'item-choice',
      operationId: 'knock-off.choose-item',
      requestId: 'knock-off.item-window',
      recipientIds: [KNOCK_OFF_ACTOR_PLACEMENT_ID],
      allowPass: false,
      options: expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^item\.choice\./),
          itemChoice: expect.objectContaining({
            canonicalItemId: 'leftovers',
            destinationKind: 'map-ground',
          }),
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^item\.choice\./),
          itemChoice: expect.objectContaining({
            canonicalItemId: 'bright-powder',
            destinationKind: 'map-ground',
          }),
        }),
      ]),
    })
    expect(hit.preWindowOperations).toEqual([])
    expect(hit.deferredContinuation.operations.map(entry => entry.operation.id)).toEqual([
      'knock-off.accuracy',
      'knock-off.damage',
    ])
  })

  it('does not open an item window on a miss or for an itemless damaged target', () => {
    const miss = execute({ randomValues: [0] })
    expect(miss.kind).toBe('complete')
    expect(miss.hitTargetIds).toEqual([])
    expect(traceOperation(miss, 'knock-off.choose-item')).toMatchObject({
      outcome: 'no-op',
      result: { status: 'no-eligible-recipients' },
    })

    const itemless = execute({
      fixtureOptions: { heldItems: null },
      randomValues: [0.45, 0, 0],
    })
    expect(itemless.kind).toBe('complete')
    expect(itemless.hitTargetIds).toEqual([KNOCK_OFF_TARGET_PLACEMENT_ID])
    expect(traceOperation(itemless, 'knock-off.choose-item')).toMatchObject({
      outcome: 'no-op',
      result: { status: 'no-legal-items' },
    })
  })

  it('filters Trainer equipment candidates to the canonical Accessory slot', () => {
    const choiceOperation = runtime.definition.spec.phases
      .flatMap(block => block.operations)
      .find(operation => operation.id === 'knock-off.choose-item')
    if (!choiceOperation || choiceOperation.kind !== 'choice-request') {
      throw new Error('Knock Off item choice operation is missing.')
    }
    const declaration = parseMoveItemChoiceDeclaration(choiceOperation.payload.itemChoice)
    const accessory: MoveItemReference = {
      schemaVersion: 1,
      kind: 'trainer-equipment-slot',
      itemId: 'slot:accessory:1',
      canonicalItemId: 'bright-powder',
      owner: { kind: 'sheet', sheetKind: 'trainer', slug: 'target-trainer', revision: 4 },
      slot: 'accessory',
      quantity: 1,
      stack: 'singleton',
      equip: 'trainer-slot',
    }
    const mainHand: MoveItemReference = {
      ...accessory,
      itemId: 'slot:mainHand:1',
      canonicalItemId: 'iron-ball',
      slot: 'mainHand',
    }
    const resources: AuthoritativeMoveItemResources = {
      requirements: reviewedMoveItemResourceRequirementsFor('Knock Off'),
      candidates: [accessory, mainHand].map(reference => ({
        requirementId: 'knock-off.target-equipped',
        reference,
      })),
      sheetReads: [{ kind: 'trainer', slug: 'target-trainer', revision: 4 }],
      groupInventoryReads: [],
      groupInventories: new Map(),
      consumedItems: [],
    }

    const choices = enumerateAuthoritativeMoveItemChoices({
      declaration,
      items: createAuthoritativeMoveItemResourceQueries(resources),
    })
    expect(choices.owner).toBe('actor')
    expect(choices.emptyPolicy).toBe('no-op')
    expect(choices.choices.map(choice => choice.reference?.canonicalItemId)).toEqual([
      'bright-powder',
    ])
  })
})

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly groups: ReturnType<typeof createSqliteGroupInventoryRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly random: AuthoritativeMoveRandomSource
  readonly drawCount: () => number
}

const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const createHarness = (options: {
  readonly fixtureOptions?: KnockOffV2FixtureOptions
  readonly randomValues?: readonly number[]
} = {}): Harness => {
  const fixture = knockOffV2Fixture(options.fixtureOptions)
  const values = [...(options.randomValues ?? [0.45, 0, 0])]
  let draws = 0
  const random = () => {
    const value = values[draws]
    if (value === undefined) throw new Error(`Knock Off requested unexpected random draw ${draws + 1}.`)
    draws += 1
    return value
  }
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const groups = createSqliteGroupInventoryRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 5_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 5_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })
  maps.save({
    slug: fixture.map.slug,
    document: fixture.map,
    revision: fixture.map.revision ?? 0,
    updatedAt: fixture.map.updatedAt ?? 100,
  })
  for (const [slug, sheet] of fixture.pokemonSheets) {
    sheets.save({
      kind: 'pokemon',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 100,
    })
  }
  return {
    database,
    maps,
    sheets,
    groups,
    ops,
    pending,
    realtime,
    commandExecutor,
    random,
    drawCount: () => draws,
  }
}

const resolveCommand = (
  map: TabletopMap,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const intent = knockOffV2Fixture({ mapRevision: map.revision ?? 0 }).intent
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: intent,
  }
}

const invokeDeclaration = (
  harness: Harness,
  command: ResolveMoveLivePlayCommand,
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  clientId: 'knock-off-client',
  playerProfile: null,
  command,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  groupInventoryRepository: harness.groups,
  pendingResolutionRepository: harness.pending,
  commandExecutor: harness.commandExecutor,
  planner: input => planAuthoritativeMoveStateExecution(input),
  random: harness.random,
  now: () => 5_000,
})

const declare = (harness: Harness, opId: string) => {
  const map = harness.maps.getBySlug('knock-off-arena')!
  return invokeDeclaration(harness, resolveCommand(map, opId))
}

const chooseCommand = (input: {
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
  readonly baseRevision: number
  readonly opId: string
}): ChooseMoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: 'knock-off-arena',
  baseRevision: input.baseRevision,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
    optionId: input.optionId,
  },
})

const respond = (harness: Harness, command: ChooseMoveResponseCommand) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  return resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: {
      chosenBy: { kind: 'gm', id: null },
      source: 'gm-authority',
    },
    clientId: 'knock-off-response-client',
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    groupInventoryRepository: harness.groups,
    pendingResolutionRepository: harness.pending,
    opRepository: harness.ops,
    realtimeEventRepository: harness.realtime,
    random: harness.random,
    now: () => 6_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const targetSheet = (harness: Harness): CharacterSheet => (
  harness.sheets.getByRef('pokemon', 'knock-off-target-sheet')!
    .sheet as unknown as CharacterSheet
)

const targetHp = (harness: Harness): number => pokemonHpSnapshot(targetSheet(harness)).currentHp

const heldItems = (harness: Harness): string | null => targetSheet(harness).items?.held ?? null

const pendingResolution = (harness: Harness) => {
  const stored = harness.pending.listByMap('knock-off-arena')
    .find(candidate => candidate.status === 'pending')
  if (!stored) throw new Error('Expected one pending Knock Off resolution.')
  return stored
}

const answerItem = (input: {
  readonly harness: Harness
  readonly canonicalItemId: string
  readonly opId: string
}) => {
  const stored = pendingResolution(input.harness)
  const window = stored.resolution.outstandingWindows[0]!
  const option = window.options.find(candidate => (
    candidate.itemChoice?.canonicalItemId === input.canonicalItemId
  ))
  if (!option) throw new Error(`Expected Knock Off option ${input.canonicalItemId}.`)
  const map = input.harness.maps.getBySlug('knock-off-arena')!
  const command = chooseCommand({
    resolutionId: stored.resolutionId,
    windowId: window.windowId,
    optionId: option.id,
    baseRevision: map.revision ?? 0,
    opId: input.opId,
  })
  return { stored, window, option, command, response: respond(input.harness, command) }
}

describe('Knock Off accepted item saga', () => {
  it('restores the actor-owned choice and commits damage, exact item removal, and ground state once', async () => {
    const harness = createHarness()
    const initialMap = harness.maps.getBySlug('knock-off-arena')!
    const declarationCommand = resolveCommand(initialMap, 'op_knock_off_choice_declare')
    const declaration = await invokeDeclaration(harness, declarationCommand)

    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    expect(targetHp(harness)).toBe(100)
    expect(heldItems(harness)).toBe('Leftovers, Bright Powder')
    expect(harness.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems).toEqual([])
    const stored = pendingResolution(harness)
    const window = stored.resolution.outstandingWindows[0]!
    expect(window).toMatchObject({
      windowId: 'knock-off.item-window',
      allowPass: false,
      ownership: [{ kind: 'actor', id: null }],
      options: expect.arrayContaining([
        expect.objectContaining({
          itemChoice: expect.objectContaining({ canonicalItemId: 'leftovers' }),
        }),
        expect.objectContaining({
          itemChoice: expect.objectContaining({ canonicalItemId: 'bright-powder' }),
        }),
      ]),
    })

    const refreshed = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'knock-off-arena',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(refreshed.windows[0]?.window).toMatchObject({
      windowId: window.windowId,
      allowPass: false,
      options: window.options.map(option => ({
        id: option.id,
        labelKey: option.labelKey,
        itemChoice: option.itemChoice,
      })),
    })
    expect(JSON.stringify(refreshed)).not.toContain('itemSelection')
    expect(JSON.stringify(refreshed)).not.toContain('knock-off-target-sheet')

    const terminal = answerItem({
      harness,
      canonicalItemId: 'leftovers',
      opId: 'op_knock_off_choice_response',
    })
    expect(terminal.response.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(targetHp(harness)).toBeLessThan(100)
    expect(heldItems(harness)).toBe('Bright Powder')
    const committed = harness.maps.getBySlug('knock-off-arena')!
    expect(committed.encounterState?.groundItems).toEqual([
      expect.objectContaining({
        canonicalItemId: 'leftovers',
        quantity: 1,
        position: { x: 2, y: 0, z: 1 },
        ownerPlacementId: KNOCK_OFF_TARGET_PLACEMENT_ID,
        sourceOperationId: terminal.command.opId,
      }),
    ])
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: terminal.command.opId,
    })

    const revision = committed.revision
    const hp = targetHp(harness)
    const sheet = deepCloneJson(targetSheet(harness))
    const groundItems = deepCloneJson(committed.encounterState?.groundItems)
    const draws = harness.drawCount()
    const realtimeSequence = harness.realtime.cursorState().latestSequence
    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command: terminal.command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(terminal.response.result)
    expect(harness.maps.getBySlug('knock-off-arena')?.revision).toBe(revision)
    expect(targetHp(harness)).toBe(hp)
    expect(targetSheet(harness)).toEqual(sheet)
    expect(harness.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems).toEqual(groundItems)
    expect(harness.drawCount()).toBe(draws)
    expect(harness.realtime.cursorState().latestSequence).toBe(realtimeSequence)
  })

  it('completes itemless hit and miss branches without a window and replays them idempotently', async () => {
    const itemless = createHarness({ fixtureOptions: { heldItems: null } })
    const initialMap = itemless.maps.getBySlug('knock-off-arena')!
    const command = resolveCommand(initialMap, 'op_knock_off_itemless_hit')
    const first = await invokeDeclaration(itemless, command)
    expect(first.result).toMatchObject({ ok: true, previousRevision: 0, revision: 1 })
    expect(isPendingMoveDeclarationResult(first.result)).toBe(false)
    expect(targetHp(itemless)).toBeLessThan(100)
    expect(itemless.pending.listByMap('knock-off-arena')).toEqual([])
    expect(itemless.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems).toEqual([])
    const hp = targetHp(itemless)
    const draws = itemless.drawCount()
    const duplicate = await invokeDeclaration(itemless, command)
    expect(duplicate.result).toEqual(first.result)
    expect(targetHp(itemless)).toBe(hp)
    expect(itemless.drawCount()).toBe(draws)

    const miss = createHarness({ randomValues: [0] })
    const missed = await declare(miss, 'op_knock_off_miss')
    expect(missed.result).toMatchObject({ ok: true })
    expect(isPendingMoveDeclarationResult(missed.result)).toBe(false)
    expect(targetHp(miss)).toBe(100)
    expect(heldItems(miss)).toBe('Leftovers, Bright Powder')
    expect(miss.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems).toEqual([])
    expect(missed.move?.trace?.events ?? []).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'knock-off.choose-item',
      outcome: 'no-op',
    }))
  })

  it('records critical damage while preserving the mandatory item continuation', async () => {
    const harness = createHarness({ randomValues: [0.999, 0, 0] })
    const declaration = await declare(harness, 'op_knock_off_critical_declare')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    const terminal = answerItem({
      harness,
      canonicalItemId: 'bright-powder',
      opId: 'op_knock_off_critical_response',
    })
    expect(terminal.response.result).toMatchObject({ ok: true })
    expect(heldItems(harness)).toBe('Leftovers')
    expect(harness.pending.getById(terminal.stored.resolutionId)?.resolution.trace.events)
      .toContainEqual(expect.objectContaining({
        kind: 'operation',
        operationId: 'knock-off.damage',
        outcome: 'applied',
        result: expect.objectContaining({
          recipients: [expect.objectContaining({
            details: expect.objectContaining({
              calculation: expect.objectContaining({
                criticalHit: expect.objectContaining({ critical: true, naturalRoll: 20 }),
              }),
            }),
          })],
        }),
      }))
  })

  it('terminally conflicts a stale held-item sheet without damage, usage, or ground duplication', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_knock_off_stale_declare')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    const stored = pendingResolution(harness)
    const window = stored.resolution.outstandingWindows[0]!
    const option = window.options.find(candidate => candidate.itemChoice?.canonicalItemId === 'leftovers')!
    const beforeMap = harness.maps.getBySlug('knock-off-arena')!
    const target = harness.sheets.getByRef('pokemon', 'knock-off-target-sheet')!
    const changed = deepCloneJson(target.sheet) as unknown as CharacterSheet
    changed.items = { held: 'Bright Powder' }
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: target.slug,
      expectedRevision: target.revision,
      nextSheet: {
        ...changed,
        revision: target.revision + 1,
        updatedAt: 5_500,
      } as unknown as Record<string, unknown>,
    })).toBe('applied')

    const command = chooseCommand({
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: option.id,
      baseRevision: beforeMap.revision ?? 0,
      opId: 'op_knock_off_stale_response',
    })
    const response = respond(harness, command)
    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(targetHp(harness)).toBe(100)
    expect(heldItems(harness)).toBe('Bright Powder')
    const conflictedMap = harness.maps.getBySlug('knock-off-arena')!
    expect(conflictedMap.encounterState?.groundItems).toEqual([])
    expect(conflictedMap.moveUsage).toBeUndefined()
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
    })
  })
})
