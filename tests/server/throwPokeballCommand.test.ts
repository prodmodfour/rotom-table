import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_PLAY_COMMAND_TYPES, type ThrowPokeballLivePlayCommand } from '#shared/livePlayCommands'
import { createEmptyCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import { createEmptyCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
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
import {
  createBreedingBabyTemplateAuthorityV1,
  createBreedingMarsupialProviderTraitV1,
  resolveBreedingMarsupialBabyTemplateV1,
} from '~~/server/domain/breeding/babyTemplate'

const marsupialTemplate = resolveBreedingMarsupialBabyTemplateV1()
const marsupialAuthority = createBreedingBabyTemplateAuthorityV1({
  sourceEggId: 'pokemon-egg:v1:96969696969696969696969696969696',
  babyTemplate: marsupialTemplate,
  marsupial: createBreedingMarsupialProviderTraitV1(),
})
const marsupialBabyAuthorityFields = {
  babyTemplate: true,
  babyTemplateMechanics: {
    schemaVersion: 1 as const,
    applicationKind: marsupialAuthority.applicationKind,
    effects: marsupialAuthority.effects,
  },
  serverPrivate: { breedingBabyTemplate: marsupialAuthority },
}

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
  readonly extraPokemon?: CharacterSheet
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
  const target = options.target ?? targetSheet()
  sheets.saveSetupSheet('pokemon', target.slug, target as unknown as Record<string, unknown>)
  if (options.extraTrainer) sheets.saveSetupSheet('trainer', options.extraTrainer.slug, options.extraTrainer as unknown as Record<string, unknown>)
  if (options.extraPokemon) sheets.saveSetupSheet('pokemon', options.extraPokemon.slug, options.extraPokemon as unknown as Record<string, unknown>)
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
  it('keeps a conscious mother’s pouch protection unless active Parental Bond has moved the Baby out', async () => {
    const pouch = {
      motherSheetSlug: 'kangaskhan-mother', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
      establishedAt: 1_000, sourceOperationId: 'op_capture_parental_pouch',
    }
    const map = baseMap({
      placements: [
        { id: 'trainer-1', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-1', sheetKind: 'pokemon', sheetSlug: 'kangaskhan-baby', position: { x: 1, y: 0, z: 0 } },
        { id: 'mother-1', sheetKind: 'pokemon', sheetSlug: 'kangaskhan-mother', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const mother = targetSheet({
      slug: 'kangaskhan-mother', nickname: 'Mother', species: 'Kangaskhan', level: 30,
      combat: { currentHp: 40 },
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })
    const baby = (abilities: CharacterSheet['abilities'] = []) => targetSheet({
      slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 5,
      abilities,
      ...marsupialBabyAuthorityFields,
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })

    const protectedEnv = setup({ map, target: baby(), extraPokemon: mother })
    const protectedRandom = vi.fn(() => 0)
    const protectedResponse = await execute({ ...protectedEnv, random: protectedRandom })
    expect(protectedResponse.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(protectedRandom).not.toHaveBeenCalled()

    const bondedEnv = setup({ map, target: baby([{ name: 'Parental Bond' }]), extraPokemon: mother })
    const bondedRandom = vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0)
    const bondedResponse = await execute({ ...bondedEnv, random: bondedRandom })
    expect(bondedResponse.result).toMatchObject({ ok: true, revision: 1 })
    expect(bondedResponse.capture).toMatchObject({ targetSlug: 'kangaskhan-baby', result: { success: true } })
    expect(bondedEnv.maps.getBySlug('arena')!.placements.map(placement => placement.id)).toContain('mother-1')
    expect(bondedRandom).toHaveBeenCalledTimes(2)
  })

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

  it('releases a captured target’s physical load atomically while preserving object identity and location', async () => {
    const loadedMap = baseMap({
      metadata: { capabilityObjects: [{
        id: 'target-crate', pounds: 45, position: { x: 1, y: 0, z: 0 },
        attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
        attachedCapabilityInstanceId: 'capability:target-1:Power:value-4', attachedToPlacementId: 'target-1',
        physicalLoadOperationId: 'operation.target-load', physicalLoadLastMovedRound: null,
        physicalLoadLastCheckRound: null,
      }] },
    })
    const env = setup({ map: loadedMap, target: targetSheet({ capabilities: { power: 4 } }) })
    const response = await execute({
      ...env,
      command: commandFor(loadedMap, 'op_capture_loaded_target'),
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })
    expect(response.capture?.result.success).toBe(true)
    const object = env.maps.getBySlug('arena')?.metadata?.capabilityObjects?.[0] as Record<string, unknown>
    expect(object).toMatchObject({ id: 'target-crate', pounds: 45, position: { x: 1, y: 0, z: 0 } })
    expect(object.attachmentKind).toBeUndefined()
    expect(object.attachedToPlacementId).toBeUndefined()
  })

  it('captures an effective As One mount into the same Ball roster transaction and removes the coupled placements', async () => {
    const mountedMap = baseMap({
      placements: [
        { id: 'trainer-1', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-1', sheetKind: 'pokemon', sheetSlug: 'pidgey', position: { x: 1, y: 0, z: 0 } },
        { id: 'mount-1', sheetKind: 'pokemon', sheetSlug: 'ponyta', position: { x: 1, y: 0, z: 0 } },
      ],
      encounterState: {
        ...createEmptyEncounterState(),
        capabilityRuntime: {
          ...createEmptyCapabilityRuntimeState(),
          links: [{
            id: 'capability.link.target-1.as-one-mount', kind: 'as-one-mount', ownerPlacementId: 'target-1',
            participantPlacementIds: ['mount-1'], capabilityInstanceId: 'capability:target-1:As_20One:base',
            canonicalId: 'As One', establishedAt: 100, configurationId: 'Run Away', sourceOperationId: 'mount-operation',
          }],
        },
      },
    })
    const env = setup({
      map: mountedMap,
      target: targetSheet({ capabilities: { other: ['As One'] } }),
      extraPokemon: { slug: 'ponyta', nickname: 'Ponyta', species: 'Ponyta', level: 5 },
    })
    const response = await execute({
      ...env,
      command: commandFor(mountedMap, 'op_capture_as_one'),
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })
    expect(response.capture?.result.success).toBe(true)
    expect(env.maps.getBySlug('arena')?.placements.map(placement => placement.id)).toEqual(['trainer-1'])
    expect(env.maps.getBySlug('arena')?.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(env.sheets.getByRef('trainer', 'ash')?.sheet.currentTeam).toEqual(['pidgey', 'ponyta'])
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

  it('rejects Poké Ball Standard Actions while the Trainer carries Staggering Weight', async () => {
    const map = baseMap({
      metadata: { capabilityObjects: [{
        id: 'crate', pounds: 71, position: { x: 0, y: 0, z: 0 },
        attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
        attachedCapabilityInstanceId: 'capability:trainer-1:Power:value-4', attachedToPlacementId: 'trainer-1',
        physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
        physicalLoadLastCheckRound: 1,
      }] },
    })
    const env = setup({ map, trainer: trainerSheet({ capabilities: { power: 4, throwingRange: 10 } }) })
    const random = vi.fn(() => 0.99)
    const response = await execute({ ...env, command: commandFor(map, 'op_staggering_capture'), random })
    expect(response.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 0 })
    expect(random).not.toHaveBeenCalled()
  })

  it('applies a target’s Heavy Weight Evasion penalty to Poké Ball Accuracy', async () => {
    const unloadedEnv = setup()
    const unloaded = await execute({
      ...unloadedEnv,
      command: commandFor(unloadedEnv.map, 'op_unloaded_target_capture'),
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })
    const loadedMap = baseMap({
      metadata: { capabilityObjects: [{
        id: 'crate', pounds: 45, position: { x: 1, y: 0, z: 0 },
        attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
        attachedCapabilityInstanceId: 'capability:target-1:Power:value-4', attachedToPlacementId: 'target-1',
        physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
        physicalLoadLastCheckRound: null,
      }] },
    })
    const loadedEnv = setup({
      map: loadedMap,
      target: targetSheet({ capabilities: { power: 4 } }),
    })
    const loaded = await execute({
      ...loadedEnv,
      command: commandFor(loadedMap, 'op_loaded_target_capture'),
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })
    expect(loaded.capture?.result.targetEvasion)
      .toBeLessThan(unloaded.capture?.result.targetEvasion ?? Number.NEGATIVE_INFINITY)
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

  it('uses the resolved Trainer Throwing Range formula for capture targeting', async () => {
    const rangedMap = baseMap({
      placements: [
        { id: 'trainer-1', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-1', sheetKind: 'pokemon', sheetSlug: 'pidgey', position: { x: 7, y: 0, z: 0 } },
      ],
    })
    const defaultTrainer = setup({ map: rangedMap, trainer: trainerSheet({ capabilities: undefined }) })
    const defaultRandom = vi.fn()
    const defaultResponse = await execute({
      ...defaultTrainer,
      command: commandFor(rangedMap, 'op_capture_formula_default'),
      random: defaultRandom,
    })
    expect(defaultResponse.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(defaultRandom).not.toHaveBeenCalled()

    const adeptTrainer = setup({
      map: rangedMap,
      trainer: trainerSheet({ capabilities: undefined, skillBackground: { adept: 'athletics' } }),
    })
    const adeptRandom = vi.fn().mockReturnValueOnce(0)
    const adeptResponse = await execute({
      ...adeptTrainer,
      command: commandFor(rangedMap, 'op_capture_formula_adept'),
      random: adeptRandom,
    })
    expect(adeptResponse.result).toMatchObject({ ok: true })
    expect(adeptRandom).toHaveBeenCalledTimes(1)
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

  it('rejects when any complete-directory capture authority sheet changes before commit', async () => {
    const observer = trainerSheet({ slug: 'observer', name: 'Observer' })
    const env = setup({ extraTrainer: observer })
    const racedSheetRepository = {
      getByRef: vi.fn((kind: 'pokemon' | 'trainer', slug: string) => {
        const stored = env.sheets.getByRef(kind, slug)
        return stored && slug === observer.slug ? { ...stored, revision: stored.revision + 1 } : stored
      }),
      list: env.sheets.list,
      applyLivePlayUpdate: env.sheets.applyLivePlayUpdate,
    }

    const response = await execute({
      ...env,
      sheetRepository: racedSheetRepository,
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed', currentRevision: 0 })
    expect(env.maps.getBySlug('arena')?.revision).toBe(0)
    expect(env.sheets.getByRef('trainer', 'ash')?.revision).toBe(0)
    expect(env.sheets.getByRef('pokemon', 'pidgey')?.revision).toBe(0)
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')).toBeNull()
  })

  it('rejects a phantom sheet-directory insertion before capture commit', async () => {
    const env = setup()
    let trainerListCount = 0
    const phantomDirectoryRepository = {
      getByRef: env.sheets.getByRef,
      list: vi.fn((kind: 'pokemon' | 'trainer') => {
        const stored = env.sheets.list(kind)
        if (kind !== 'trainer' || ++trainerListCount === 1) return stored
        return [...stored, {
          kind: 'trainer' as const,
          slug: 'phantom-owner',
          document: trainerSheet({ slug: 'phantom-owner', currentTeam: ['pidgey'] }) as unknown as Record<string, unknown>,
          revision: 0,
          updatedAt: 1_700_000_001_500,
        }]
      }),
      applyLivePlayUpdate: env.sheets.applyLivePlayUpdate,
    }

    const response = await execute({
      ...env,
      sheetRepository: phantomDirectoryRepository,
      random: vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0),
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed', currentRevision: 0 })
    expect(env.maps.getBySlug('arena')?.revision).toBe(0)
    expect(env.ops.getStoredOpRecord('arena', 'op_capture001')).toBeNull()
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
