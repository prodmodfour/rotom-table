import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_PLAY_COMMAND_TYPES, type ThrowPokeballLivePlayCommand } from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository, type SheetRepository } from '~~/server/storage/sheetRepository'
import {
  buildThrowPokeballCommandEnvelope,
  executeThrowPokeballCommandUseCase,
} from '~~/server/useCases/applyThrowPokeballCommand'
import { parsePlayerProfileId, sanitizePlayerProfileDisplayName, type PlayerProfile } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'

const openDatabases: RotomDatabase[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

afterEach(() => {
  vi.restoreAllMocks()
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 12, y: 3, z: 12 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'trainer-1', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
    { id: 'target-1', sheetKind: 'pokemon', sheetSlug: 'pidgey', position: { x: 1, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: 'target-1', round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
})

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 5,
  capabilities: { throwingRange: 10 },
  currentTeam: [],
  boxedPokemon: [],
  inventory: { pokeBalls: [{ name: 'Basic Ball', qty: 2, mod: '0' }] },
  revision: 0,
  ...overrides,
})

const targetSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pidgey',
  nickname: 'Pidgey',
  species: 'Pidgey',
  level: 1,
  combat: { currentHp: 1 },
  revision: 0,
  ...overrides,
})

const linkedProfile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: sanitizePlayerProfileDisplayName('Ash'),
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
})

const commandFor = (map: TabletopMap, opId = 'op_capture001'): ThrowPokeballLivePlayCommand => buildThrowPokeballCommandEnvelope({
  opId,
  mapSlug: map.slug,
  baseRevision: map.revision ?? 0,
  trainerPlacement: map.placements[0]!,
  targetPlacement: map.placements[1]!,
  pokeballName: 'Basic Ball',
})

const setup = (options: {
  readonly map?: TabletopMap
  readonly trainer?: TrainerSheet
  readonly target?: CharacterSheet
  readonly extraTrainer?: TrainerSheet
  readonly published?: unknown[]
} = {}) => {
  const database = openMemoryDatabase()
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_700_000_001_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const map = options.map ?? baseMap()
  maps.saveSetupMap(map)
  sheets.saveSetupSheet('trainer', 'ash', (options.trainer ?? trainerSheet()) as unknown as Record<string, unknown>)
  sheets.saveSetupSheet('pokemon', 'pidgey', (options.target ?? targetSheet()) as unknown as Record<string, unknown>)
  if (options.extraTrainer) sheets.saveSetupSheet('trainer', options.extraTrainer.slug, options.extraTrainer as unknown as Record<string, unknown>)
  modes.set({ slug: map.slug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 1_700_000_000_000 })
  const published = options.published ?? []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: (mapSlug) => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks(published),
  })
  return { database, maps, sheets, ops, executor, map, published }
}

const execute = async (input: ReturnType<typeof setup> & {
  readonly command?: ThrowPokeballLivePlayCommand
  readonly role?: 'gm' | 'player'
  readonly profile?: PlayerProfile | null
  readonly random?: () => number
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'>
}) => executeThrowPokeballCommandUseCase({
  role: input.role ?? 'gm',
  command: input.command ?? commandFor(input.map),
  playerProfile: input.profile ?? null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
}, {
  database: input.database,
  mapRepository: input.maps,
  sheetRepository: input.sheetRepository ?? input.sheets,
  commandExecutor: input.executor,
  random: input.random,
  now: () => 1_700_000_002_000,
})

describe('throwPokeball live-play command', () => {
  it('successfully captures atomically, updates map metadata, roster, caught-ball, placement, revisions, and realtime events', async () => {
    const env = setup()
    const random = vi.fn()
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)

    const response = await execute({ ...env, random })

    expect(response.result).toMatchObject({ ok: true, previousRevision: 0, revision: 1 })
    expect(response.capture).toMatchObject({
      trainerId: 'trainer-1',
      targetId: 'target-1',
      targetSlug: 'pidgey',
      pokeballName: 'Basic Ball',
      result: { hit: true, success: true, accuracyRoll: 20, captureRoll: 1 },
    })
    expect(random).toHaveBeenCalledTimes(2)

    const map = env.maps.getBySlug('arena')!
    expect(map.revision).toBe(1)
    expect(map.placements.map((placement) => placement.id)).toEqual(['trainer-1'])
    expect(map.initiative?.activeId).toBeNull()
    expect(map.metadata?.captureLog).toHaveLength(1)
    expect(map.metadata?.captureLog).toMatchObject([{ success: true, hit: true, targetId: 'target-1' }])

    const trainer = env.sheets.getByRef('trainer', 'ash')!
    expect(trainer.revision).toBe(1)
    expect(trainer.sheet.inventory).toMatchObject({ pokeBalls: [{ name: 'Basic Ball', qty: 1 }] })
    expect(trainer.sheet.currentTeam).toEqual(['pidgey'])
    expect(trainer.sheet.boxedPokemon).toEqual([])

    const target = env.sheets.getByRef('pokemon', 'pidgey')!
    expect(target.revision).toBe(1)
    expect(target.sheet.caughtBall).toBe('Basic Ball')

    expect(response.map?.revision).toBe(1)
    expect(response.sheetUpdates?.map((update) => `${update.kind}:${update.slug}:${update.sheet.revision}`)).toEqual([
      'trainer:ash:1',
      'pokemon:pidgey:1',
    ])
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')).toMatchObject({ result: response.result })
    expect(env.published).toHaveLength(5)
    expect(env.published.at(-1)).toMatchObject({ type: 'live-play-command-accepted', opId: 'op_capture001' })
  })

  it('puts a captured Pokémon in the box when the trainer team is full', async () => {
    const env = setup({
      trainer: trainerSheet({ currentTeam: ['a', 'b', 'c', 'd', 'e', 'f'], boxedPokemon: [] }),
    })

    const response = await execute({
      ...env,
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })

    expect(response.capture?.result.success).toBe(true)
    const trainer = env.sheets.getByRef('trainer', 'ash')!
    expect(trainer.sheet.currentTeam).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(trainer.sheet.boxedPokemon).toEqual(['pidgey'])
  })

  it('persists misses without altering roster, target sheet, or placement', async () => {
    const env = setup()
    const random = vi.fn().mockReturnValueOnce(0)

    const response = await execute({ ...env, random })

    expect(response.result).toMatchObject({ ok: true, previousRevision: 0, revision: 1 })
    expect(response.capture).toMatchObject({ result: { hit: false, success: false, accuracyRoll: 1, captureRoll: null } })
    expect(random).toHaveBeenCalledTimes(1)
    expect(env.maps.getBySlug('arena')?.placements.map((placement) => placement.id)).toEqual(['trainer-1', 'target-1'])
    expect(env.maps.getBySlug('arena')?.metadata?.captureLog).toMatchObject([{ hit: false, success: false }])
    const trainer = env.sheets.getByRef('trainer', 'ash')!
    expect(trainer.revision).toBe(1)
    expect(trainer.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 1 }] })
    expect(trainer.sheet.currentTeam).toEqual([])
    const target = env.sheets.getByRef('pokemon', 'pidgey')!
    expect(target.revision).toBe(0)
    expect(target.sheet.caughtBall).toBeUndefined()
    expect(response.sheetUpdates?.map((update) => `${update.kind}:${update.slug}`)).toEqual(['trainer:ash'])
  })

  it('persists hit-but-failed capture shake data while leaving target state unchanged', async () => {
    const env = setup({
      trainer: trainerSheet({ level: 50, inventory: { pokeBalls: [{ name: 'Basic Ball', qty: 2, mod: '+200' }] } }),
    })
    const random = vi.fn()
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.9)

    const response = await execute({ ...env, random })

    expect(response.capture).toMatchObject({
      result: {
        hit: true,
        success: false,
        accuracyRoll: 20,
        captureRoll: 91,
        shakeCount: expect.any(Number),
        failureReason: 'The Pokémon broke free.',
      },
    })
    expect(env.maps.getBySlug('arena')?.placements.map((placement) => placement.id)).toEqual(['trainer-1', 'target-1'])
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(0)
    expect(env.sheets.getByRef('trainer', 'ash')?.sheet.currentTeam).toEqual([])
  })

  it('rejects missing or zero-quantity balls, out-of-range targets, and already-linked targets before rolling or writing documents', async () => {
    const zeroBall = setup({ trainer: trainerSheet({ inventory: { pokeBalls: [{ name: 'Basic Ball', qty: 0, mod: '0' }] } }) })
    const zeroRandom = vi.fn()
    const zeroResponse = await execute({ ...zeroBall, random: zeroRandom })
    expect(zeroResponse.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(zeroRandom).not.toHaveBeenCalled()
    expect(zeroBall.maps.getBySlug('arena')?.revision).toBe(0)
    expect(zeroBall.sheets.getByRef('trainer', 'ash')?.revision).toBe(0)

    const farMap = baseMap({
      placements: [
        { id: 'trainer-1', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-1', sheetKind: 'pokemon', sheetSlug: 'pidgey', position: { x: 11, y: 0, z: 11 } },
      ],
    })
    const outOfRange = setup({ map: farMap, trainer: trainerSheet({ capabilities: { throwingRange: 1 } }) })
    const rangeRandom = vi.fn()
    const rangeResponse = await execute({ ...outOfRange, command: commandFor(farMap, 'op_capture002'), random: rangeRandom })
    expect(rangeResponse.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(rangeRandom).not.toHaveBeenCalled()
    expect(outOfRange.sheets.getByRef('trainer', 'ash')?.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 2 }] })

    const linked = setup({
      extraTrainer: trainerSheet({ slug: 'misty', name: 'Misty', currentTeam: ['pidgey'], inventory: { pokeBalls: [] } }),
    })
    const linkedRandom = vi.fn()
    const linkedResponse = await execute({ ...linked, command: commandFor(linked.map, 'op_capture003'), random: linkedRandom })
    expect(linkedResponse.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(linkedRandom).not.toHaveBeenCalled()
    expect(linked.sheets.getByRef('trainer', 'ash')?.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 2 }] })
  })

  it('enforces player trainer control while allowing GM throws without a profile', async () => {
    const gm = setup()
    await expect(execute({
      ...gm,
      random: vi.fn().mockReturnValueOnce(0),
    })).resolves.toMatchObject({ result: { ok: true } })

    const player = setup()
    await expect(execute({
      ...player,
      role: 'player',
      profile: linkedProfile(),
      random: vi.fn().mockReturnValueOnce(0),
    })).resolves.toMatchObject({ result: { ok: true } })

    const denied = setup()
    const deniedProfile: PlayerProfile = { ...linkedProfile(), linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'misty' }] }
    const deniedRandom = vi.fn()
    const deniedResponse = await execute({
      ...denied,
      role: 'player',
      profile: deniedProfile,
      random: deniedRandom,
    })
    expect(deniedResponse.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(deniedRandom).not.toHaveBeenCalled()

    const hidden = setup({ map: baseMap({ playerVisible: false }) })
    const hiddenResponse = await execute({
      ...hidden,
      role: 'player',
      profile: linkedProfile(),
      random: vi.fn(),
    })
    expect(hiddenResponse.result).toMatchObject({ ok: false, reason: 'unauthorized' })
  })

  it('rolls back map, trainer, target, and op-result writes when the target sheet write is stale', async () => {
    const env = setup()
    const staleTargetSheetRepository = {
      getByRef: env.sheets.getByRef,
      list: env.sheets.list,
      applyLivePlayUpdate: vi.fn((input: Parameters<typeof env.sheets.applyLivePlayUpdate>[0]) => (
        input.kind === 'pokemon' && input.slug === 'pidgey'
          ? 'stale' as const
          : env.sheets.applyLivePlayUpdate(input)
      )),
    }

    const response = await execute({
      ...env,
      sheetRepository: staleTargetSheetRepository,
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed', currentRevision: 0 })
    expect(env.maps.getBySlug('arena')?.revision).toBe(0)
    expect(env.maps.getBySlug('arena')?.placements.map((placement) => placement.id)).toEqual(['trainer-1', 'target-1'])
    expect(env.sheets.getByRef('trainer', 'ash')?.revision).toBe(0)
    expect(env.sheets.getByRef('trainer', 'ash')?.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 2 }] })
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(0)
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')).toBeNull()
    expect(env.published).toEqual([])
  })

  it('rolls back the map and op result when the trainer sheet write is stale', async () => {
    const env = setup()
    const staleTrainerSheetRepository = {
      getByRef: env.sheets.getByRef,
      list: env.sheets.list,
      applyLivePlayUpdate: vi.fn((input: Parameters<typeof env.sheets.applyLivePlayUpdate>[0]) => (
        input.kind === 'trainer' && input.slug === 'ash'
          ? 'stale' as const
          : env.sheets.applyLivePlayUpdate(input)
      )),
    }

    const response = await execute({
      ...env,
      sheetRepository: staleTrainerSheetRepository,
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed', currentRevision: 0 })
    expect(env.maps.getBySlug('arena')?.revision).toBe(0)
    expect(env.maps.getBySlug('arena')?.placements.map((placement) => placement.id)).toEqual(['trainer-1', 'target-1'])
    expect(env.sheets.getByRef('trainer', 'ash')?.revision).toBe(0)
    expect(env.sheets.getByRef('trainer', 'ash')?.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 2 }] })
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(0)
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')).toBeNull()
    expect(env.published).toEqual([])
  })

  it('rolls back operation state when the map write fails before sheet writes', async () => {
    const env = setup()
    const mapRepository = {
      getBySlug: env.maps.getBySlug,
      applyLivePlayUpdate: vi.fn((input: Parameters<typeof env.maps.applyLivePlayUpdate>[0]) => {
        env.maps.applyLivePlayUpdate(input)
        return 'stale' as const
      }),
    }

    const response = await executeThrowPokeballCommandUseCase({
      role: 'gm',
      command: commandFor(env.map),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    }, {
      database: env.database,
      mapRepository,
      sheetRepository: env.sheets,
      commandExecutor: env.executor,
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
      now: () => 1_700_000_002_000,
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed', currentRevision: 0 })
    expect(env.maps.getBySlug('arena')?.revision).toBe(0)
    expect(env.sheets.getByRef('trainer', 'ash')?.revision).toBe(0)
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(0)
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')).toBeNull()
    expect(env.published).toEqual([])
  })

  it('returns the stored capture result for duplicate opIds without rerolling, re-consuming, or advancing revisions', async () => {
    const env = setup()
    const random = vi.fn()
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)

    const first = await execute({ ...env, random })
    const second = await execute({ ...env, random })

    expect(first.result).toEqual(second.result)
    expect(first.capture).toEqual(second.capture)
    expect(random).toHaveBeenCalledTimes(2)
    expect(env.maps.getBySlug('arena')?.revision).toBe(1)
    expect(env.sheets.getByRef('trainer', 'ash')?.revision).toBe(1)
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(1)
    expect(env.sheets.getByRef('trainer', 'ash')?.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 1 }] })
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')?.result).toEqual(first.result)
  })

  it('reconstructs duplicate miss responses from stored patches without rerolling or consuming twice', async () => {
    const env = setup()
    const random = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)

    const first = await execute({ ...env, command: commandFor(env.map, 'op_capturemiss'), random })
    const second = await execute({ ...env, command: commandFor(env.map, 'op_capturemiss'), random })

    expect(first.result).toEqual(second.result)
    expect(first.capture).toEqual(second.capture)
    expect(second.capture).toMatchObject({ result: { hit: false, success: false, accuracyRoll: 1 } })
    expect(random).toHaveBeenCalledTimes(1)
    expect(env.maps.getBySlug('arena')?.revision).toBe(1)
    expect(env.sheets.getByRef('trainer', 'ash')?.revision).toBe(1)
    expect(env.sheets.getByRef('trainer', 'ash')?.sheet.inventory).toMatchObject({ pokeBalls: [{ qty: 1 }] })
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(0)
  })
})
