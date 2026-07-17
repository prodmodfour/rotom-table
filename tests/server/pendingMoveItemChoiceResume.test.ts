import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type ChooseMoveResponseCommand,
  type PassMoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import { isPendingMoveDeclarationResult } from '#shared/moveAutomation/pendingResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { deepCloneJson } from '~/utils/serialization'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { planAuthoritativeMoveStateExecution } from '~~/server/domain/planAuthoritativeMoveState'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import {
  ITEM_CHOICE_REQUIREMENTS,
  ITEM_CHOICE_TARGET_ID,
  createItemChoiceMap,
  createItemChoiceRuntimeRegistry,
  itemChoiceIntent,
  itemChoiceSheets,
} from '../fixtures/moveAutomation/itemChoices'

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly groups: ReturnType<typeof createSqliteGroupInventoryRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}

const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const createHarness = (): Harness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const groups = createSqliteGroupInventoryRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })
  const map = createItemChoiceMap()
  maps.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: 100 })
  const resources = itemChoiceSheets()
  for (const sheet of resources.pokemonSheets.values()) {
    sheets.save({
      kind: 'pokemon',
      slug: sheet.slug,
      document: sheet as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 50,
    })
  }
  for (const sheet of resources.trainerSheets.values()) {
    sheets.save({
      kind: 'trainer',
      slug: sheet.slug,
      document: sheet as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 50,
    })
  }
  return { database, maps, sheets, groups, ops, pending, realtime, commandExecutor }
}

const requirementProvider = () => ITEM_CHOICE_REQUIREMENTS

const resolveCommand = (map: TabletopMap, opId: string): ResolveMoveLivePlayCommand => {
  const intent = itemChoiceIntent()
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: [ITEM_CHOICE_TARGET_ID],
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

const declare = async (harness: Harness, opId: string) => {
  const runtimeRegistry = createItemChoiceRuntimeRegistry()
  const map = harness.maps.getBySlug('durable-item-choice-arena')!
  const command = resolveCommand(map, opId)
  const response = await executeLivePlayResolveMoveCommandUseCase({
    role: 'gm',
    command,
    clientId: 'item-choice-declaration-client',
    playerProfile: null,
    expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    groupInventoryRepository: harness.groups,
    pendingResolutionRepository: harness.pending,
    commandExecutor: harness.commandExecutor,
    planner: input => planAuthoritativeMoveStateExecution({ ...input, runtimeRegistry }),
    itemResourceRequirementProvider: requirementProvider,
    random: () => { throw new Error('item choice fixture does not use randomness') },
    now: () => 1_000,
  })
  if (!isPendingMoveDeclarationResult(response.result)) {
    throw new Error('Expected a durable item-choice declaration.')
  }
  const stored = harness.pending.getByOrigin(map.slug, command.opId)
  if (!stored) throw new Error('Expected a stored item-choice declaration.')
  return { command, response, stored, runtimeRegistry }
}

const chooseCommand = (input: {
  readonly map: TabletopMap
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
  readonly opId: string
}): ChooseMoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: input.map.slug,
  baseRevision: input.map.revision ?? 0,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
    optionId: input.optionId,
  },
})

const passCommand = (input: {
  readonly map: TabletopMap
  readonly resolutionId: string
  readonly windowId: string
  readonly opId: string
}): PassMoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: input.map.slug,
  baseRevision: input.map.revision ?? 0,
  type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
  },
})

const resume = (input: {
  readonly harness: Harness
  readonly command: ChooseMoveResponseCommand | PassMoveResponseCommand
  readonly runtimeRegistry: ReturnType<typeof createItemChoiceRuntimeRegistry>
}) => {
  const parsed = parsePendingMoveResponseCommand(input.command, {
    pendingResolutionRepository: input.harness.pending,
  })
  return resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: {
      chosenBy: { kind: 'gm', id: null },
      source: 'gm-authority',
    },
    clientId: 'item-choice-response-client',
  }, {
    database: input.harness.database,
    mapRepository: input.harness.maps,
    sheetRepository: input.harness.sheets,
    groupInventoryRepository: input.harness.groups,
    pendingResolutionRepository: input.harness.pending,
    opRepository: input.harness.ops,
    realtimeEventRepository: input.harness.realtime,
    runtimeRegistry: input.runtimeRegistry,
    itemResourceRequirementProvider: requirementProvider,
    random: () => { throw new Error('item choice fixture does not use randomness') },
    now: () => 2_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const targetHp = (harness: Harness): number => {
  const stored = harness.sheets.getByRef('pokemon', 'item-choice-target-sheet')!
  return pokemonHpSnapshot(stored.sheet as unknown as CharacterSheet).currentHp
}

const trainerInventory = (harness: Harness): TrainerSheet['inventory'] => (
  harness.sheets.getByRef('trainer', 'item-choice-trainer')!
    .sheet as unknown as TrainerSheet
).inventory

describe('pending durable item-choice resume integration', () => {
  it('restores a privacy-safe choice after refresh and commits the selected option once', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_itemchoicedeclare')
    expect(targetHp(harness)).toBe(60)
    const window = declaration.stored.resolution.outstandingWindows[0]!
    const privateOption = window.options.find(option => (
      option.itemChoice?.canonicalItemId === 'potion'
    ))!
    expect(privateOption.itemSelection).toMatchObject({
      kind: 'move-item',
      reference: {
        itemId: 'private-potion-row',
        owner: { slug: 'item-choice-trainer', revision: 3 },
        quantity: 3,
      },
      destination: { id: 'use.actor' },
    })

    const refreshed = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'durable-item-choice-arena',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    const publicOption = refreshed.windows[0]?.window.options.find(
      option => option.id === privateOption.id,
    )
    expect(publicOption).toEqual({
      id: privateOption.id,
      labelKey: 'move.item.choice',
      itemChoice: {
        canonicalItemId: 'potion',
        destinationKind: 'actor-inventory',
        destinationLabelKey: 'move.item.destination.actor',
      },
    })
    const publicWire = JSON.stringify(refreshed)
    expect(publicWire).not.toContain('itemSelection')
    expect(publicWire).not.toContain('private-potion-row')
    expect(publicWire).not.toContain('item-choice-trainer')
    expect(publicWire).not.toContain('quantity')

    const pendingMap = harness.maps.getBySlug('durable-item-choice-arena')!
    const command = chooseCommand({
      map: pendingMap,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionId: privateOption.id,
      opId: 'op_itemchoiceanswer1',
    })
    const first = resume({ harness, command, runtimeRegistry: declaration.runtimeRegistry })
    expect(first.result).toMatchObject({ ok: true })
    expect(targetHp(harness)).toBe(55)
    expect(trainerInventory(harness)?.medicalKit).toEqual([
      { id: 'private-potion-row', name: 'Potion', qty: 2 },
      { id: 'private-antidote-row', name: 'Antidote', qty: 1 },
    ])
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: {
        status: 'committed',
        chosenOptions: [{ optionId: privateOption.id }],
      },
    })
    const revision = harness.maps.getBySlug(pendingMap.slug)!.revision
    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(first.result)
    expect(targetHp(harness)).toBe(55)
    expect(harness.maps.getBySlug(pendingMap.slug)?.revision).toBe(revision)
    expect(trainerInventory(harness)?.medicalKit).toEqual([
      { id: 'private-potion-row', name: 'Potion', qty: 2 },
      { id: 'private-antidote-row', name: 'Antidote', qty: 1 },
    ])
  })

  it('supports an authorized pass without selecting or losing an item', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_itemchoicepassdec')
    const pendingMap = harness.maps.getBySlug('durable-item-choice-arena')!
    const window = declaration.stored.resolution.outstandingWindows[0]!
    expect(window.allowPass).toBe(true)
    expect(window.options.some(option => option.id === 'item.none.reviewed')).toBe(true)
    const inventoryBefore = deepCloneJson(trainerInventory(harness))
    const command = passCommand({
      map: pendingMap,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      opId: 'op_itemchoicepassans',
    })

    const response = resume({ harness, command, runtimeRegistry: declaration.runtimeRegistry })
    expect(response.result).toMatchObject({ ok: true })
    expect(targetHp(harness)).toBe(55)
    expect(trainerInventory(harness)).toEqual(inventoryBefore)
    expect(harness.pending.getById(declaration.stored.resolutionId)?.resolution.chosenOptions)
      .toMatchObject([{ optionId: null }])
  })

  it('records a reviewed explicit-none option distinctly from pass', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_itemchoicenonedec')
    const pendingMap = harness.maps.getBySlug('durable-item-choice-arena')!
    const window = declaration.stored.resolution.outstandingWindows[0]!
    const noneOption = window.options.find(option => option.id === 'item.none.reviewed')!
    expect(noneOption.itemSelection).toEqual({
      kind: 'move-item-none',
      setId: 'item-choice.actor-items',
      optionId: 'item.none.reviewed',
    })
    const inventoryBefore = deepCloneJson(trainerInventory(harness))
    const command = chooseCommand({
      map: pendingMap,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionId: noneOption.id,
      opId: 'op_itemchoicenoneans',
    })

    const response = resume({ harness, command, runtimeRegistry: declaration.runtimeRegistry })
    expect(response.result).toMatchObject({ ok: true })
    expect(trainerInventory(harness)).toEqual(inventoryBefore)
    expect(harness.pending.getById(declaration.stored.resolutionId)?.resolution.chosenOptions)
      .toMatchObject([{ optionId: 'item.none.reviewed' }])
  })

  it('terminally conflicts a stale inventory with no deferred damage or item overwrite', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_staleitemchoicedec')
    const storedTrainer = harness.sheets.getByRef('trainer', 'item-choice-trainer')!
    const changed = deepCloneJson(storedTrainer.sheet) as unknown as TrainerSheet
    changed.inventory = {
      ...changed.inventory,
      medicalKit: [{ id: 'private-antidote-row', name: 'Antidote', qty: 1 }],
    }
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'trainer',
      slug: storedTrainer.slug,
      expectedRevision: storedTrainer.revision,
      nextSheet: {
        ...changed,
        revision: storedTrainer.revision + 1,
        updatedAt: 1_500,
      } as unknown as Record<string, unknown>,
    })).toBe('applied')

    const pendingMap = harness.maps.getBySlug('durable-item-choice-arena')!
    const window = declaration.stored.resolution.outstandingWindows[0]!
    const option = window.options.find(item => item.itemChoice?.canonicalItemId === 'potion')!
    const command = chooseCommand({
      map: pendingMap,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionId: option.id,
      opId: 'op_staleitemchoiceans',
    })
    const response = resume({ harness, command, runtimeRegistry: declaration.runtimeRegistry })

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(targetHp(harness)).toBe(60)
    expect(trainerInventory(harness)?.medicalKit).toEqual([
      { id: 'private-antidote-row', name: 'Antidote', qty: 1 },
    ])
    expect(harness.maps.getBySlug(pendingMap.slug)?.encounterState?.pendingResolutionSummaries)
      .toEqual([])
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
      resolution: { status: 'conflicted', chosenOptions: [] },
    })
  })
})
