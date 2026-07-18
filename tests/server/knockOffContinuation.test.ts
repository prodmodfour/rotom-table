import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  isPendingMoveDeclarationResult,
  parsePendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type ChooseMoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
} from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { deepCloneJson } from '~/utils/serialization'
import {
  KNOCK_OFF_ACTOR_PLACEMENT_ID,
  KNOCK_OFF_TARGET_PLACEMENT_ID,
  KNOCK_OFF_TARGET_TRAINER_SLUG,
  knockOffImmunityTestDefinition,
  knockOffV2Fixture,
} from '../fixtures/moveAutomation/knockOffV2'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  resolveAuthoritativeMoveItemResources,
  reviewedMoveItemResourceRequirementsFor,
} from '~~/server/domain/moveAutomation/itemResources'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '~~/server/domain/moveAutomation/random'
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  type MoveAutomationRuntimeRegistry,
} from '~~/server/domain/moveAutomation/registry'
import {
  ResumeMoveSpecError,
  resumeMoveSpec,
} from '~~/server/domain/moveAutomation/resumeSpec'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import {
  MoveResponseCommandParserError,
  parsePendingMoveResponseCommand,
} from '~~/server/livePlay/moveResponseCommandParser'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  PendingMoveResponseAccessError,
  authorizePendingMoveResponseWindow,
} from '~~/server/useCases/pendingMoveResponseAccess'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionDependencies,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

interface KnockOffHarness {
  readonly database: RotomDatabase
  readonly fixture: ReturnType<typeof knockOffV2Fixture>
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly groups: ReturnType<typeof createSqliteGroupInventoryRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly runtimeRegistry: MoveAutomationRuntimeRegistry
  readonly random: AuthoritativeMoveRandomSource
  readonly drawCount: () => number
}

const databases: RotomDatabase[] = []

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const createHarness = (options: {
  readonly heldItems?: string | null
  readonly randomValues?: readonly number[]
  readonly targetTrainerEquipmentSlots?: TrainerSheet['equipmentSlots']
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
} = {}): KnockOffHarness => {
  const fixture = knockOffV2Fixture({
    heldItems: options.heldItems === undefined
      ? 'Leftovers, Bright Powder'
      : options.heldItems,
    ...(options.targetTrainerEquipmentSlots === undefined
      ? {}
      : { targetTrainerEquipmentSlots: options.targetTrainerEquipmentSlots }),
  })
  const values = [...(options.randomValues ?? [0.45, 0, 0])]
  let draws = 0
  const random: AuthoritativeMoveRandomSource = () => {
    const value = values[draws]
    if (value === undefined) {
      throw new Error(`Knock Off requested unexpected random draw ${draws + 1}.`)
    }
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
  for (const [slug, sheet] of fixture.trainerSheets) {
    sheets.save({
      kind: 'trainer',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 100,
    })
  }

  return {
    database,
    fixture,
    maps,
    sheets,
    groups,
    ops,
    pending,
    realtime,
    commandExecutor,
    runtimeRegistry: options.runtimeRegistry ?? MOVE_AUTOMATION_RUNTIME_REGISTRY,
    random,
    drawCount: () => draws,
  }
}

const knockOffImmunityRuntimeRegistry = (): MoveAutomationRuntimeRegistry => {
  const selected = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve('Knock Off')
  if (!selected || selected.kind !== 'movespec-v2') {
    throw new Error('Knock Off native runtime is unavailable.')
  }
  const definition = knockOffImmunityTestDefinition()
  const runtime = Object.freeze({
    ...selected,
    definition,
    definitionHash: definition.definitionHash,
  })
  const entries = MOVE_AUTOMATION_RUNTIME_REGISTRY.entries().map(entry => (
    entry.canonicalId === 'Knock Off' ? runtime : entry
  ))
  return Object.freeze({
    size: MOVE_AUTOMATION_RUNTIME_REGISTRY.size,
    handlerRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
    resolve: (canonicalId: string) => canonicalId === 'Knock Off'
      ? runtime
      : MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId),
    entries: () => Object.freeze(entries),
  })
}

const resolveCommand = (
  harness: KnockOffHarness,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const map = harness.maps.getBySlug('knock-off-arena')!
  const scopes = buildResolveMoveScopes({
    map,
    intent: harness.fixture.intent,
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
    payload: harness.fixture.intent,
  }
}

const invokeDeclaration = (
  harness: KnockOffHarness,
  command: ResolveMoveLivePlayCommand,
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'knock-off-declaration-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  groupInventoryRepository: harness.groups,
  pendingResolutionRepository: harness.pending,
  commandExecutor: harness.commandExecutor,
  planner: input => planAuthoritativeMoveStateExecution({
    ...input,
    runtimeRegistry: harness.runtimeRegistry,
  }),
  random: harness.random,
  now: () => 5_000,
})

const chooseCommand = (input: {
  readonly map: TabletopMap
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
  readonly opId: string
  readonly profileId?: PlayerProfile['id']
}): ChooseMoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: input.map.slug,
  baseRevision: input.map.revision ?? 0,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  ...(input.profileId ? { profileId: input.profileId } : {}),
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
    optionId: input.optionId,
  },
})

const profileFor = (
  id: string,
  displayName: string,
  sheetSlug: string,
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId(id),
  displayName: parsePlayerProfileDisplayName(displayName),
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug }],
})

const actorProfile = profileFor(
  'profile_knock_actor',
  'Knock Off Actor',
  'knock-off-actor-sheet',
)
const targetProfile = profileFor(
  'profile_knock_target',
  'Knock Off Target',
  'knock-off-target-sheet',
)

const targetSheet = (harness: KnockOffHarness): CharacterSheet => (
  harness.sheets.getByRef('pokemon', 'knock-off-target-sheet')!
    .sheet as unknown as CharacterSheet
)

const targetHp = (harness: KnockOffHarness): number => pokemonHpSnapshot(
  targetSheet(harness),
).currentHp

const targetTrainerSheet = (harness: KnockOffHarness): TrainerSheet => (
  harness.sheets.getByRef('trainer', KNOCK_OFF_TARGET_TRAINER_SLUG)!
    .sheet as unknown as TrainerSheet
)

const knockOffUses = (harness: KnockOffHarness): number => (
  harness.maps.getBySlug('knock-off-arena')?.moveUsage
    ?.byPlacementId[KNOCK_OFF_ACTOR_PLACEMENT_ID]?.['knock-off']?.uses
  ?? 0
)

const responseInvocation = (
  harness: KnockOffHarness,
  command: ChooseMoveResponseCommand,
  overrides: ResumePendingMoveResolutionDependencies = {},
) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  const invoke = () => resumePendingMoveResolutionUseCase({
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
    runtimeRegistry: harness.runtimeRegistry,
    now: () => 6_000,
    publishPersistedRealtimeEvent: vi.fn(),
    ...overrides,
  })
  return { parsed, invoke }
}

const currentItemResources = (input: {
  readonly harness: KnockOffHarness
  readonly map: TabletopMap
  readonly pokemonSheets?: ReadonlyMap<string, CharacterSheet>
}) => resolveAuthoritativeMoveItemResources({
  map: input.map,
  actorPlacementId: KNOCK_OFF_ACTOR_PLACEMENT_ID,
  selectedTargetPlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
  pokemonSheets: input.pokemonSheets ?? input.harness.fixture.pokemonSheets,
  trainerSheets: input.harness.fixture.trainerSheets,
  groupInventories: new Map(),
  requirements: reviewedMoveItemResourceRequirementsFor('Knock Off'),
})

describe('Knock Off durable item continuation', () => {
  it('plans one immediate damage, usage, item-removal, and ground destination envelope', () => {
    const fixture = knockOffV2Fixture({ heldItems: 'Leftovers' })
    const resources = resolveAuthoritativeMoveItemResources({
      map: fixture.map,
      actorPlacementId: KNOCK_OFF_ACTOR_PLACEMENT_ID,
      selectedTargetPlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
      pokemonSheets: fixture.pokemonSheets,
      trainerSheets: fixture.trainerSheets,
      groupInventories: new Map(),
      requirements: reviewedMoveItemResourceRequirementsFor('Knock Off'),
    })
    const plan = planAuthoritativeMoveStateExecution({
      ...fixture,
      itemResources: resources,
      runtimeRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0, 0]),
      operationId: 'op_knock_off_immediate_plan',
      now: () => 5_000,
    })

    expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(plan)) return
    expect(plan.stateChanges.changes).toContainEqual(expect.objectContaining({
      kind: 'sheet-state',
      reasonCode: 'combined-sheet-operations',
      changedFields: ['hp', 'items'],
    }))
    expect(plan.sheetWrites).toEqual([
      expect.objectContaining({
        kind: 'pokemon',
        slug: 'knock-off-target-sheet',
        expectedRevision: 2,
        revision: 3,
        changedFields: ['hp', 'items'],
        nextSheet: expect.objectContaining({ items: {} }),
      }),
    ])
    expect(plan.nextMap.encounterState?.groundItems).toEqual([
      expect.objectContaining({
        canonicalItemId: 'leftovers',
        sourceOperationId: 'op_knock_off_immediate_plan',
      }),
    ])
    expect(plan.usage.uses).toBe(1)
  })

  it('commits a sole Held Item with damage and usage exactly once', async () => {
    const harness = createHarness({ heldItems: 'Leftovers' })
    const command = resolveCommand(harness, 'op_knock_off_single_item')
    const first = await invokeDeclaration(harness, command)

    expect(first.result).toMatchObject({ ok: true, previousRevision: 0, revision: 1 })
    expect(isPendingMoveDeclarationResult(first.result)).toBe(false)
    expect(targetHp(harness)).toBeLessThan(100)
    expect(targetSheet(harness).items?.held).toBeUndefined()
    expect(targetSheet(harness).revision).toBe(3)
    expect(knockOffUses(harness)).toBe(1)
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.groundItems).toEqual([
      expect.objectContaining({
        canonicalItemId: 'leftovers',
        canonicalItemName: 'Leftovers',
        quantity: 1,
        position: { x: 2, y: 0, z: 1 },
        sourceResource: {
          kind: 'sheet',
          sheetKind: 'pokemon',
          slug: 'knock-off-target-sheet',
          revision: 2,
        },
        sourceOperationId: command.opId,
      }),
    ])
    expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(first.result)
    expect(first.sheetUpdates).toContainEqual(expect.objectContaining({
      kind: 'pokemon',
      slug: 'knock-off-target-sheet',
      sheet: expect.objectContaining({ items: {} }),
    }))

    const committed = deepCloneJson({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      operation: harness.ops.getStoredOpRecord(command.mapSlug, command.opId),
    })
    const draws = harness.drawCount()
    const duplicate = await invokeDeclaration(harness, command)

    expect(duplicate.result).toEqual(first.result)
    expect(harness.drawCount()).toBe(draws)
    expect({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      operation: harness.ops.getStoredOpRecord(command.mapSlug, command.opId),
    }).toEqual(committed)
  })

  it.each([
    {
      branch: 'itemless hit',
      heldItems: null,
      randomValues: [0.45, 0, 0],
      expectedHpLoss: true,
      expectedHitIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    },
    {
      branch: 'miss',
      heldItems: 'Leftovers',
      randomValues: [0],
      expectedHpLoss: false,
      expectedHitIds: [],
    },
  ] as const)(
    'commits the immediate $branch without an item mutation',
    async ({ branch, heldItems, randomValues, expectedHpLoss, expectedHitIds }) => {
      const harness = createHarness({ heldItems, randomValues })
      const response = await invokeDeclaration(
        harness,
        resolveCommand(harness, `op_knock_off_${branch.replace(/[^a-z]/g, '_')}`),
      )

      expect(response.result).toMatchObject({ ok: true, revision: 1 })
      expect(isPendingMoveDeclarationResult(response.result)).toBe(false)
      expect(targetHp(harness) < 100).toBe(expectedHpLoss)
      expect(response.move?.transaction.hitTargetIds).toEqual(expectedHitIds)
      expect(response.move?.trace?.events).toContainEqual(expect.objectContaining({
        kind: 'operation',
        operationId: 'knock-off.ground-item',
        outcome: 'no-op',
      }))
      expect(harness.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems)
        .toEqual([])
      expect(knockOffUses(harness)).toBe(1)
      expect(harness.pending.listByMap('knock-off-arena')).toEqual([])
    },
  )

  it('commits critical damage and the sole item outcome without rerolling', async () => {
    const harness = createHarness({
      heldItems: 'Leftovers',
      randomValues: [0.999, 0, 0],
    })
    const response = await invokeDeclaration(
      harness,
      resolveCommand(harness, 'op_knock_off_critical'),
    )

    expect(response.result).toMatchObject({ ok: true })
    expect(targetHp(harness)).toBeLessThan(100)
    expect(targetSheet(harness).items?.held).toBeUndefined()
    expect(response.move?.rollLedger[0]).toMatchObject({ naturalResult: 20 })
    expect(response.move?.trace?.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'knock-off.damage',
      outcome: 'applied',
    }))
    expect(harness.drawCount()).toBe(3)
  })

  it('commits only the target Trainer Accessory item and preserves other slots', async () => {
    const harness = createHarness({
      targetTrainerEquipmentSlots: {
        accessory: 'Bright Powder',
        mainHand: 'Iron Ball',
        offHand: 'Leftovers',
      },
    })
    const response = await invokeDeclaration(
      harness,
      resolveCommand(harness, 'op_knock_off_trainer_accessory'),
    )

    expect(response.result).toMatchObject({ ok: true })
    expect(targetTrainerSheet(harness)).toMatchObject({
      revision: 3,
      equipmentSlots: {
        mainHand: 'Iron Ball',
        offHand: 'Leftovers',
      },
    })
    expect(harness.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems)
      .toEqual([expect.objectContaining({
        canonicalItemId: 'bright-powder',
        sourceResource: {
          kind: 'sheet',
          sheetKind: 'trainer',
          slug: KNOCK_OFF_TARGET_TRAINER_SLUG,
          revision: 2,
        },
      })])
    expect(knockOffUses(harness)).toBe(1)
  })

  it('commits an authoritative immunity without damage, usage-side item loss, or a window', async () => {
    const harness = createHarness({
      heldItems: 'Leftovers',
      randomValues: [0.45, 0, 0],
      runtimeRegistry: knockOffImmunityRuntimeRegistry(),
    })
    const response = await invokeDeclaration(
      harness,
      resolveCommand(harness, 'op_knock_off_immunity'),
    )

    expect(response.result).toMatchObject({ ok: true })
    expect(response.move?.transaction).toMatchObject({
      hitTargetIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
      hpUpdates: [],
    })
    expect(targetHp(harness)).toBe(100)
    expect(targetSheet(harness).items?.held).toBe('Leftovers')
    expect(harness.maps.getBySlug('knock-off-arena')?.encounterState?.groundItems)
      .toEqual([])
    expect(harness.pending.listByMap('knock-off-arena')).toEqual([])
    expect(knockOffUses(harness)).toBe(1)
  })

  it('persists one actor-owned private window and replays duplicate declarations without deferred work', async () => {
    const harness = createHarness()
    const command = resolveCommand(harness, 'op_knock_off_pending')
    const mapBefore = deepCloneJson(harness.maps.getBySlug(command.mapSlug))
    const sheetsBefore = deepCloneJson(harness.sheets.list())

    const first = await invokeDeclaration(harness, command)
    expect(isPendingMoveDeclarationResult(first.result)).toBe(true)
    const stored = harness.pending.getByOrigin(command.mapSlug, command.opId)!
    const resolution = parsePendingMoveResolution(
      JSON.parse(JSON.stringify(stored.resolution)),
    )
    const window = resolution.outstandingWindows[0]!

    expect(window).toMatchObject({
      kind: 'choice',
      windowId: 'knock-off.item-window',
      ownership: [{ kind: 'actor', id: null }],
      allowPass: false,
      options: [
        expect.objectContaining({
          id: expect.stringMatching(/^item\.choice\.[a-f0-9]{16}$/),
          itemChoice: expect.objectContaining({
            canonicalItemId: 'leftovers',
            destinationKind: 'map-ground',
          }),
          itemSelection: expect.objectContaining({
            kind: 'move-item',
            reference: expect.objectContaining({
              owner: expect.objectContaining({
                slug: 'knock-off-target-sheet',
                revision: 2,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          itemChoice: expect.objectContaining({
            canonicalItemId: 'bright-powder',
            destinationKind: 'map-ground',
          }),
        }),
      ],
    })
    expect(resolution.readSet).toEqual(expect.arrayContaining([
      { kind: 'map', slug: command.mapSlug, revision: 1 },
      {
        kind: 'sheet',
        sheetKind: 'pokemon',
        slug: 'knock-off-target-sheet',
        revision: 2,
      },
    ]))
    expect(resolution.rollLedger).toHaveLength(2)
    expect(targetHp(harness)).toBe(100)
    expect(targetSheet(harness).items?.held).toBe('Leftovers, Bright Powder')
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.groundItems).toEqual([])
    expect(harness.maps.getBySlug(command.mapSlug)?.moveUsage).toBeUndefined()
    expect(harness.sheets.list()).toEqual(sheetsBefore)
    expect(harness.maps.getBySlug(command.mapSlug)).toEqual({
      ...mapBefore,
      revision: 1,
      updatedAt: 5_000,
      encounterState: expect.objectContaining({
        pendingResolutionSummaries: [resolution.publicSummary],
      }),
    })

    const draws = harness.drawCount()
    const duplicate = await invokeDeclaration(harness, command)
    expect(duplicate.result).toEqual(first.result)
    expect(duplicate.map).toEqual(first.map)
    expect(harness.drawCount()).toBe(draws)
    expect(harness.pending.listByMap(command.mapSlug)).toHaveLength(1)
    expect(targetHp(harness)).toBe(100)
  })

  it('restores only privacy-safe options to the actor or GM after reconnect', async () => {
    const harness = createHarness()
    const command = resolveCommand(harness, 'op_knock_off_reconnect')
    await invokeDeclaration(harness, command)
    const stored = harness.pending.getByOrigin(command.mapSlug, command.opId)!

    const dependencies = {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: createSqlitePendingMoveResolutionRepository(harness.database),
    }
    const actorView = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: command.mapSlug,
      playerProfile: actorProfile,
    }, dependencies)
    const gmView = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: command.mapSlug,
    }, dependencies)
    const targetView = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: command.mapSlug,
      playerProfile: targetProfile,
    }, dependencies)

    expect(actorView.windows).toHaveLength(1)
    expect(gmView.windows).toEqual(actorView.windows)
    expect(targetView.windows).toEqual([])
    expect(actorView.windows[0]).toMatchObject({
      resolution: { resolutionId: stored.resolutionId },
      window: {
        windowId: 'knock-off.item-window',
        options: [
          expect.objectContaining({
            id: expect.stringMatching(/^item\.choice\./),
            itemChoice: expect.objectContaining({
              canonicalItemId: 'leftovers',
              destinationKind: 'map-ground',
            }),
          }),
          expect.objectContaining({
            itemChoice: expect.objectContaining({
              canonicalItemId: 'bright-powder',
              destinationKind: 'map-ground',
            }),
          }),
        ],
      },
    })
    const wire = JSON.stringify(actorView)
    for (const privateValue of [
      'itemSelection',
      'knock-off-target-sheet',
      'held:1',
      'held:2',
      'quantity',
      'revision',
    ]) {
      expect(wire).not.toContain(privateValue)
    }
  })

  it('resumes by opaque option ID to one deterministic terminal plan without redrawing or mutation', async () => {
    const harness = createHarness()
    const command = resolveCommand(harness, 'op_knock_off_resume')
    await invokeDeclaration(harness, command)
    const stored = harness.pending.getByOrigin(command.mapSlug, command.opId)!
    const map = harness.maps.getBySlug(command.mapSlug)!
    const selected = stored.resolution.outstandingWindows[0]!.options.find(option => (
      option.itemChoice?.canonicalItemId === 'bright-powder'
    ))!
    const mapBefore = deepCloneJson(map)
    const sheetsBefore = deepCloneJson([...harness.fixture.pokemonSheets])
    let resumeDraws = 0

    const resume = () => resumeMoveSpec({
      pendingResolution: stored.resolution,
      map,
      pokemonSheets: harness.fixture.pokemonSheets,
      trainerSheets: harness.fixture.trainerSheets,
      itemResources: currentItemResources({ harness, map }),
      runtimeRegistry: harness.runtimeRegistry,
      response: {
        requestId: stored.resolution.outstandingWindows[0]!.windowId,
        optionId: selected.id,
      },
      now: 6_000,
      random: () => {
        resumeDraws += 1
        throw new Error('A Knock Off continuation must replay its durable rolls.')
      },
    })

    const first = resume()
    const duplicate = resume()
    expect('kind' in first).toBe(false)
    if ('kind' in first || 'kind' in duplicate) return
    expect(duplicate).toEqual(first)
    expect(first.rollLedger).toEqual(stored.resolution.rollLedger)
    expect(first.transaction).toMatchObject({
      attackedTargetIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
      hitTargetIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
      hpUpdates: [expect.objectContaining({ id: KNOCK_OFF_TARGET_PLACEMENT_ID })],
    })
    expect(first.nativeV2?.operations.map(({ operation }) => operation.id)).toEqual([
      'knock-off.accuracy',
      'knock-off.damage',
      'knock-off.choose-item',
      'knock-off.ground-item',
      'knock-off.usage',
      'knock-off.log-completed',
    ])
    expect(first.nativeV2?.itemEffects).toMatchObject({
      mutations: [{
        kind: 'ground-item-add',
        source: { canonicalItemId: 'bright-powder' },
        destination: { kind: 'map-ground-item' },
      }],
      results: [{ outcome: 'applied', action: 'knock-to-ground' }],
    })
    expect(resumeDraws).toBe(0)
    expect(map).toEqual(mapBefore)
    expect([...harness.fixture.pokemonSheets]).toEqual(sheetsBefore)
    expect(targetHp(harness)).toBe(100)
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.groundItems).toEqual([])
  })

  it('atomically commits a selected item, deferred damage, usage, terminal op, and realtime once', async () => {
    const harness = createHarness()
    const declarationCommand = resolveCommand(harness, 'op_knock_off_terminal_declaration')
    await invokeDeclaration(harness, declarationCommand)
    const stored = harness.pending.getByOrigin(
      declarationCommand.mapSlug,
      declarationCommand.opId,
    )!
    const map = harness.maps.getBySlug(declarationCommand.mapSlug)!
    const window = stored.resolution.outstandingWindows[0]!
    const selected = window.options.find(option => (
      option.itemChoice?.canonicalItemId === 'bright-powder'
    ))!
    const command = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: selected.id,
      opId: 'op_knock_off_terminal_response',
    })
    const invocation = responseInvocation(harness, command)
    const accepted = invocation.invoke()

    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(accepted.move?.transaction).toMatchObject({
      attackedTargetIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
      hitTargetIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
      hpUpdates: [expect.objectContaining({ id: KNOCK_OFF_TARGET_PLACEMENT_ID })],
    })
    expect(targetHp(harness)).toBeLessThan(100)
    expect(targetSheet(harness)).toMatchObject({
      revision: 3,
      items: { held: 'Leftovers' },
    })
    expect(knockOffUses(harness)).toBe(1)
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.groundItems).toEqual([
      expect.objectContaining({
        canonicalItemId: 'bright-powder',
        canonicalItemName: 'Bright Powder',
        quantity: 1,
        position: { x: 2, y: 0, z: 1 },
        sourceResource: {
          kind: 'sheet',
          sheetKind: 'pokemon',
          slug: 'knock-off-target-sheet',
          revision: 2,
        },
        sourceOperationId: command.opId,
      }),
    ])
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: {
        status: 'committed',
        chosenOptions: [{
          windowId: window.windowId,
          optionId: selected.id,
          responseOpId: command.opId,
        }],
      },
    })
    expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(accepted.result)
    expect(harness.realtime.cursorState().latestSequence).toBeGreaterThan(0)

    const committed = deepCloneJson({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
      operation: harness.ops.getStoredOpRecord(command.mapSlug, command.opId),
      realtime: harness.realtime.cursorState(),
    })
    const draws = harness.drawCount()
    const duplicate = invocation.invoke()

    expect(duplicate.result).toEqual(accepted.result)
    expect(harness.drawCount()).toBe(draws)
    expect({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
      operation: harness.ops.getStoredOpRecord(command.mapSlug, command.opId),
      realtime: harness.realtime.cursorState(),
    }).toEqual(committed)
  })

  it('rolls back every terminal resource when item-sheet persistence fails after writing', async () => {
    const harness = createHarness()
    const declarationCommand = resolveCommand(harness, 'op_knock_off_failure_declaration')
    await invokeDeclaration(harness, declarationCommand)
    const stored = harness.pending.getByOrigin(
      declarationCommand.mapSlug,
      declarationCommand.opId,
    )!
    const map = harness.maps.getBySlug(declarationCommand.mapSlug)!
    const window = stored.resolution.outstandingWindows[0]!
    const selected = window.options[0]!
    const command = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: selected.id,
      opId: 'op_knock_off_failure_response',
    })
    const before = deepCloneJson({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
      realtime: harness.realtime.cursorState(),
    })
    const failingSheets = {
      ...harness.sheets,
      applyLivePlayUpdate: (
        input: Parameters<typeof harness.sheets.applyLivePlayUpdate>[0],
      ) => {
        const result = harness.sheets.applyLivePlayUpdate(input)
        if (result === 'applied') throw new Error('injected Knock Off item persistence failure')
        return result
      },
    }
    const invocation = responseInvocation(harness, command, {
      sheetRepository: failingSheets,
    })

    expect(() => invocation.invoke()).toThrow('injected Knock Off item persistence failure')
    expect({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
      realtime: harness.realtime.cursorState(),
    }).toEqual(before)
    expect(harness.ops.getStoredOpRecord(command.mapSlug, command.opId)).toBeNull()
    expect(targetHp(harness)).toBe(100)
    expect(targetSheet(harness).items?.held).toBe('Leftovers, Bright Powder')
    expect(knockOffUses(harness)).toBe(0)
  })

  it('detects an inventory race inside commit and applies no deferred move work', async () => {
    const harness = createHarness()
    const declarationCommand = resolveCommand(harness, 'op_knock_off_race_declaration')
    await invokeDeclaration(harness, declarationCommand)
    const stored = harness.pending.getByOrigin(
      declarationCommand.mapSlug,
      declarationCommand.opId,
    )!
    const map = harness.maps.getBySlug(declarationCommand.mapSlug)!
    const window = stored.resolution.outstandingWindows[0]!
    const selected = window.options.find(option => (
      option.itemChoice?.canonicalItemId === 'bright-powder'
    ))!
    const command = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: selected.id,
      opId: 'op_knock_off_race_response',
    })
    let raced = false
    const invocation = responseInvocation(harness, command, {
      beforeCommit: () => {
        if (raced) return
        raced = true
        const current = harness.sheets.getByRef('pokemon', 'knock-off-target-sheet')!
        const changed = deepCloneJson(current.sheet) as unknown as CharacterSheet
        changed.items = { held: 'Leftovers' }
        const result = harness.sheets.applyLivePlayUpdate({
          kind: 'pokemon',
          slug: current.slug,
          expectedRevision: current.revision,
          nextSheet: {
            ...changed,
            revision: current.revision + 1,
            updatedAt: 5_500,
          } as unknown as Record<string, unknown>,
        })
        if (result !== 'applied') throw new Error('Could not inject Knock Off inventory race.')
      },
    })
    const response = invocation.invoke()

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(targetHp(harness)).toBe(100)
    expect(targetSheet(harness)).toMatchObject({
      revision: 3,
      items: { held: 'Leftovers' },
    })
    expect(knockOffUses(harness)).toBe(0)
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.groundItems).toEqual([])
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
    })
    expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(response.result)
  })

  it('rejects forged and unauthorized responses before exposing or applying an option', async () => {
    const harness = createHarness()
    const command = resolveCommand(harness, 'op_knock_off_authority')
    await invokeDeclaration(harness, command)
    const stored = harness.pending.getByOrigin(command.mapSlug, command.opId)!
    const map = harness.maps.getBySlug(command.mapSlug)!
    const window = stored.resolution.outstandingWindows[0]!
    const stateBefore = deepCloneJson({
      map,
      sheets: harness.sheets.list(),
      pending: stored,
    })

    const forged = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: 'item.choice.clientforged',
      opId: 'op_knock_off_forged',
    })
    expect(() => parsePendingMoveResponseCommand(forged, {
      pendingResolutionRepository: harness.pending,
    })).toThrowError(expect.objectContaining({
      name: MoveResponseCommandParserError.name,
      code: 'unknown-option',
    }))

    const targetCommand = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: 'item.choice.clientforged',
      opId: 'op_knock_off_denied',
      profileId: targetProfile.id,
    })
    expect(() => parsePendingMoveResponseCommand(targetCommand, {
      pendingResolutionRepository: harness.pending,
      authorize: references => authorizePendingMoveResponseWindow({
        role: 'player',
        command: references.command,
        playerProfile: targetProfile,
        storedResolution: references.storedResolution,
        window: references.window,
      }, {
        database: harness.database,
        mapRepository: harness.maps,
        sheetRepository: harness.sheets,
      }),
    })).toThrowError(expect.objectContaining({
      name: PendingMoveResponseAccessError.name,
      statusCode: 403,
    }))

    const actorCommand = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: window.options[0]!.id,
      opId: 'op_knock_off_actor_choice',
      profileId: actorProfile.id,
    })
    expect(parsePendingMoveResponseCommand(actorCommand, {
      pendingResolutionRepository: harness.pending,
      authorize: references => authorizePendingMoveResponseWindow({
        role: 'player',
        command: references.command,
        playerProfile: actorProfile,
        storedResolution: references.storedResolution,
        window: references.window,
      }, {
        database: harness.database,
        mapRepository: harness.maps,
        sheetRepository: harness.sheets,
      }),
    }).option?.id).toBe(window.options[0]!.id)
    expect(Object.keys(actorCommand.payload).sort()).toEqual([
      'optionId',
      'resolutionId',
      'windowId',
    ])
    expect({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
    }).toEqual(stateBefore)
  })

  it('conflicts stale or unavailable item state with no deferred move work and replays that terminal', async () => {
    const harness = createHarness()
    const command = resolveCommand(harness, 'op_knock_off_stale')
    await invokeDeclaration(harness, command)
    const stored = harness.pending.getByOrigin(command.mapSlug, command.opId)!
    const map = harness.maps.getBySlug(command.mapSlug)!
    const window = stored.resolution.outstandingWindows[0]!
    const removed = window.options.find(option => (
      option.itemChoice?.canonicalItemId === 'leftovers'
    ))!

    const unavailableSheets = new Map(harness.fixture.pokemonSheets)
    const unavailableTarget = deepCloneJson(
      unavailableSheets.get('knock-off-target-sheet')!,
    )
    unavailableTarget.items = { held: 'Bright Powder' }
    unavailableSheets.set(unavailableTarget.slug, unavailableTarget)
    const unavailableBefore = deepCloneJson([...unavailableSheets])
    expect(() => resumeMoveSpec({
      pendingResolution: stored.resolution,
      map,
      pokemonSheets: unavailableSheets,
      trainerSheets: harness.fixture.trainerSheets,
      itemResources: currentItemResources({
        harness,
        map,
        pokemonSheets: unavailableSheets,
      }),
      runtimeRegistry: harness.runtimeRegistry,
      response: { requestId: window.windowId, optionId: removed.id },
      now: 6_000,
      random: () => { throw new Error('Unavailable options must not redraw.') },
    })).toThrowError(expect.objectContaining({
      name: ResumeMoveSpecError.name,
      code: 'execution-rejected',
    }))
    expect([...unavailableSheets]).toEqual(unavailableBefore)

    const current = harness.sheets.getByRef('pokemon', 'knock-off-target-sheet')!
    const changed = deepCloneJson(current.sheet) as unknown as CharacterSheet
    changed.items = { held: 'Bright Powder' }
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: current.slug,
      expectedRevision: current.revision,
      nextSheet: {
        ...changed,
        revision: current.revision + 1,
        updatedAt: 5_500,
      } as unknown as Record<string, unknown>,
    })).toBe('applied')

    const responseCommand = chooseCommand({
      map,
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      optionId: removed.id,
      opId: 'op_knock_off_stale_response',
    })
    const response = responseInvocation(harness, responseCommand).invoke()

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(targetHp(harness)).toBe(100)
    expect(targetSheet(harness).items?.held).toBe('Bright Powder')
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.groundItems).toEqual([])
    expect(harness.maps.getBySlug(command.mapSlug)?.moveUsage).toBeUndefined()
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: responseCommand.opId,
      resolution: { status: 'conflicted', chosenOptions: [] },
    })
    expect(harness.drawCount()).toBe(3)

    const terminalState = deepCloneJson({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
      realtime: harness.realtime.cursorState(),
    })
    const duplicate = replayMoveResponseCommandUseCase({
      role: 'gm',
      command: responseCommand,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(duplicate?.result).toEqual(response.result)
    expect({
      map: harness.maps.getBySlug(command.mapSlug),
      sheets: harness.sheets.list(),
      pending: harness.pending.getById(stored.resolutionId),
      realtime: harness.realtime.cursorState(),
    }).toEqual(terminalState)
    expect(harness.drawCount()).toBe(3)
  })

  it('builds the same bounded suspension twice without mutating authoritative inputs', () => {
    const harness = createHarness()
    const resources = currentItemResources({ harness, map: harness.fixture.map })
    const input = {
      map: harness.fixture.map,
      pokemonSheets: harness.fixture.pokemonSheets,
      trainerSheets: harness.fixture.trainerSheets,
      intent: harness.fixture.intent,
      now: () => 5_000,
      operationId: 'op_knock_off_pure_pending',
      pendingResolutionId: 'resolution-knock-off-pure-pending',
      itemResources: resources,
      runtimeRegistry: harness.runtimeRegistry,
    } as const
    const before = deepCloneJson({
      map: input.map,
      pokemonSheets: [...input.pokemonSheets],
      trainerSheets: [...input.trainerSheets],
      resources: {
        requirements: resources.requirements,
        candidates: resources.candidates,
        sheetReads: resources.sheetReads,
      },
    })
    const first = planAuthoritativeMoveStateExecution({
      ...input,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0, 0]),
    })
    const duplicate = planAuthoritativeMoveStateExecution({
      ...input,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0, 0]),
    })
    expect(isAuthoritativePendingMoveStatePlan(first)).toBe(true)
    expect(duplicate).toEqual(first)
    if (!isAuthoritativePendingMoveStatePlan(first)) return
    expect(first.sheetWrites).toEqual([])
    expect(first.suspension.preWindowPlan.changes).toEqual([])
    expect(first.suspension.deferredContinuation.operations.map(({ operation }) => operation.id))
      .toEqual(['knock-off.accuracy', 'knock-off.damage'])
    expect({
      map: input.map,
      pokemonSheets: [...input.pokemonSheets],
      trainerSheets: [...input.trainerSheets],
      resources: {
        requirements: resources.requirements,
        candidates: resources.candidates,
        sheetReads: resources.sheetReads,
      },
    }).toEqual(before)
  })
})
