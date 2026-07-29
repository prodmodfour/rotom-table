import { afterEach, describe, expect, it } from 'vitest'
import { buildCapabilityClientCapabilityBundle } from '../../server/domain/capabilityAutomation/clientCapabilities'
import { executeCapabilityActionUseCase } from '../../server/useCases/executeCapabilityAction'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  JUICER_BERRY_ELAPSED_MS,
  JUICER_JUICE_ELAPSED_MS,
} from '#shared/capabilityAutomation/campaignState'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })

const actor = (): CharacterSheet => ({
  slug: 'munna', name: 'Munna', species: 'Munna', level: 20, revision: 2,
  capabilities: { other: ['Dream Mist'] },
})
const trainer = (): TrainerSheet => ({
  slug: 'trainer', name: 'Trainer', level: 10, revision: 3, currentTeam: ['munna'],
  inventory: { keyItems: [{ id: 'jar', name: 'Collection Jar', qty: 1 }], pokemonItems: [] },
})
const map = (): TabletopMap => ({
  schemaVersion: 2, id: 'map', slug: 'arena', name: 'Arena', revision: 5, updatedAt: 100,
  dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, voxels: [], playerVisible: true,
  placements: [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: 'munna', position: { x: 1, y: 1, z: 1 } }],
} as TabletopMap)

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(map())
  sheetRepository.saveSetupSheet('pokemon', 'munna', actor() as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('trainer', 'trainer', trainer() as unknown as Record<string, unknown>)
  const now = 1_000
  const offer = buildCapabilityClientCapabilityBundle({
    role: 'gm', map: mapRepository.getBySlug('arena')!, mapRevision: 5,
    pokemonSheets: [actor()], trainerSheets: [trainer()], now,
  }).placements[0]!.offers.find(candidate => candidate.actionId === 'produce-dream-mist')!
  const command = {
    schemaVersion: 1, operationId: 'capability-operation', mapSlug: 'arena', baseRevision: 5,
    offerId: offer.offerId, actorPlacementId: 'actor', capabilityInstanceId: offer.capabilityInstanceId,
    canonicalId: 'Dream Mist', actionId: 'produce-dream-mist',
    selections: {
      targetPlacementIds: [], cells: [], optionId: null, recipientTrainerSlug: 'trainer',
      canonicalItemId: null, description: null, gmConfirmed: false,
    },
  }
  const dependencies = {
    database, mapRepository, sheetRepository, now: () => now,
    publishPersistedRealtimeEvent: () => {},
  }
  return { database, mapRepository, sheetRepository, command, dependencies }
}

const setupJuicer = (options: {
  readonly actionId?: 'consume-juicer-shell-juice-as-snack' | 'collect-juicer-output'
  readonly stage?: 'berry' | 'berry-juice' | 'rare-candy'
  readonly storedId?: string
  readonly held?: string
  readonly digestionFood?: string
  readonly digestionFoods?: readonly string[]
  readonly abilities?: CharacterSheet['abilities']
  readonly custodyStartedAt?: number
  readonly storedAt?: number
  readonly now?: number
} = {}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const actionId = options.actionId ?? 'collect-juicer-output'
  const stage = options.stage ?? 'berry-juice'
  const custodyStartedAt = options.custodyStartedAt ?? 0
  const storedAt = options.storedAt ?? (stage === 'berry' ? custodyStartedAt
    : stage === 'berry-juice' ? custodyStartedAt + JUICER_BERRY_ELAPSED_MS
      : custodyStartedAt + JUICER_BERRY_ELAPSED_MS + JUICER_JUICE_ELAPSED_MS)
  const now = options.now ?? storedAt + 1_000
  const shuckle: CharacterSheet = {
    slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 25, revision: 2,
    capabilities: { other: ['Juicer'] },
    ...(options.abilities ? { abilities: options.abilities } : {}),
    items: {
      held: options.held ?? (stage === 'berry' ? 'Oran Berry' : 'Potion'),
      ...(options.digestionFood ? { digestionFood: options.digestionFood } : {}),
      ...(options.digestionFoods ? { digestionFoods: [...options.digestionFoods] } : {}),
    },
    capabilityCampaignState: {
      schemaVersion: 1,
      storedItems: [{
        id: options.storedId ?? 'stored-output', kind: 'juicer',
        canonicalItemId: stage === 'berry' ? 'oran-berry'
          : stage === 'berry-juice' ? 'shuckles-berry-juice' : 'rare-candy',
        stage, storedAt, custodyStartedAt,
        custodyFingerprint: 'juicer-custody:test-output',
        remainingDayAdvances: stage === 'berry' ? 1 : stage === 'berry-juice' ? 14 : 0,
        sourceOperationId: 'store-operation',
      }],
      planter: null,
      letterPress: null,
    },
  }
  const linked: TrainerSheet = {
    slug: 'trainer', name: 'Trainer', level: 10, revision: 3, currentTeam: ['shuckle'],
    inventory: { pokemonItems: [] },
  }
  const juicerMap: TabletopMap = {
    ...map(),
    placements: [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: 'shuckle', position: { x: 1, y: 1, z: 1 } }],
  }
  mapRepository.saveSetupMap(juicerMap)
  sheetRepository.saveSetupSheet('pokemon', shuckle.slug, shuckle as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('trainer', linked.slug, linked as unknown as Record<string, unknown>)
  const offer = buildCapabilityClientCapabilityBundle({
    role: 'gm', map: mapRepository.getBySlug('arena')!, mapRevision: 5,
    pokemonSheets: [shuckle], trainerSheets: [linked], now,
  }).placements[0]!.offers.find(candidate => candidate.actionId === actionId)!
  const command = {
    schemaVersion: 1, operationId: `juicer-operation-${actionId}`, mapSlug: 'arena', baseRevision: 5,
    offerId: offer.offerId, actorPlacementId: 'actor', capabilityInstanceId: offer.capabilityInstanceId,
    canonicalId: 'Juicer', actionId,
    selections: {
      targetPlacementIds: [], cells: [], optionId: null,
      recipientTrainerSlug: actionId === 'collect-juicer-output' ? linked.slug : null,
      canonicalItemId: null, description: null, gmConfirmed: false,
    },
  }
  const dependencies = {
    database, mapRepository, sheetRepository, now: () => now,
    publishPersistedRealtimeEvent: () => {},
  }
  return { database, mapRepository, sheetRepository, shuckle, linked, command, dependencies }
}

describe('Capability authoritative execution use case', () => {
  it('atomically commits production and usage, then exactly replays without a second write', () => {
    const { command, dependencies, sheetRepository } = setup()
    const first = executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)
    const trainerAfterFirst = sheetRepository.getByRef('trainer', 'trainer')!
    const actorAfterFirst = sheetRepository.getByRef('pokemon', 'munna')!
    const retry = executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)
    expect(retry).toEqual(first)
    expect(first).toMatchObject({
      outcome: 'applied', reasonCode: 'capability.item-produced', changedMap: false,
      changedSheetSlugs: expect.arrayContaining(['trainer', 'munna']),
      produced: [{ kind: 'item', canonicalId: 'Dream Mist', quantity: 1, recipientSheetSlug: 'trainer' }],
    })
    expect(sheetRepository.getByRef('trainer', 'trainer')?.revision).toBe(trainerAfterFirst.revision)
    expect(sheetRepository.getByRef('pokemon', 'munna')?.revision).toBe(actorAfterFirst.revision)
    expect((trainerAfterFirst.sheet as unknown as TrainerSheet).inventory?.pokemonItems).toContainEqual(expect.objectContaining({ name: 'Dream Mist', qty: 1 }))
    expect((actorAfterFirst.sheet as unknown as CharacterSheet).capabilityUsage?.entries).toContainEqual(expect.objectContaining({ period: 'daily' }))
  })

  it('transactionally transfers the exact mature Juicer output and replays without duplication', () => {
    const { command, dependencies, sheetRepository } = setupJuicer()
    const first = executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)
    expect(first).toMatchObject({
      outcome: 'applied', reasonCode: 'capability.juicer.output-collected',
      produced: [{ kind: 'item', canonicalId: 'shuckles-berry-juice', quantity: 1, recipientSheetSlug: 'trainer' }],
    })
    const shuckleAfter = sheetRepository.getByRef('pokemon', 'shuckle')!
    const trainerAfter = sheetRepository.getByRef('trainer', 'trainer')!
    expect((shuckleAfter.sheet as unknown as CharacterSheet).items?.held).toBe('Potion')
    expect((shuckleAfter.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems ?? []).toEqual([])
    expect((trainerAfter.sheet as unknown as TrainerSheet).inventory?.foodStuff).toContainEqual(expect.objectContaining({
      name: 'Shuckle’s Berry Juice', qty: 1,
    }))
    expect(executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)).toEqual(first)
    expect(sheetRepository.getByRef('pokemon', 'shuckle')?.revision).toBe(shuckleAfter.revision)
    expect(sheetRepository.getByRef('trainer', 'trainer')?.revision).toBe(trainerAfter.revision)
  })

  it('materializes exact elapsed boundaries during offers and execution without a campaign-day scan', () => {
    const juiceAt = 100 + JUICER_BERRY_ELAPSED_MS
    const juice = setupJuicer({
      stage: 'berry', custodyStartedAt: 100, storedAt: 100, now: juiceAt,
    })
    expect(executeCapabilityActionUseCase({ role: 'gm', command: juice.command }, juice.dependencies).produced)
      .toEqual([{ kind: 'item', canonicalId: 'shuckles-berry-juice', quantity: 1, recipientSheetSlug: 'trainer' }])
    expect((juice.sheetRepository.getByRef('pokemon', 'shuckle')?.sheet as unknown as CharacterSheet)
      .items?.held).toBe('')

    const candyAt = juiceAt + JUICER_JUICE_ELAPSED_MS
    const candy = setupJuicer({
      stage: 'berry', custodyStartedAt: 100, storedAt: 100, now: candyAt,
    })
    expect(executeCapabilityActionUseCase({ role: 'gm', command: candy.command }, candy.dependencies).produced)
      .toEqual([{ kind: 'item', canonicalId: 'rare-candy', quantity: 1, recipientSheetSlug: 'trainer' }])
    expect((candy.sheetRepository.getByRef('pokemon', 'shuckle')?.sheet as unknown as CharacterSheet)
      .items?.held).toBe('')
  })

  it('lets Shuckle consume only shell juice as its own Snack without bottling or disturbing held', () => {
    const { command, dependencies, sheetRepository } = setupJuicer({
      actionId: 'consume-juicer-shell-juice-as-snack',
    })
    const first = executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)
    const shuckleAfter = sheetRepository.getByRef('pokemon', 'shuckle')!
    const trainerAfter = sheetRepository.getByRef('trainer', 'trainer')!
    expect(first).toMatchObject({
      outcome: 'applied', reasonCode: 'capability.juicer.shell-juice-consumed-as-snack', produced: [],
    })
    expect((shuckleAfter.sheet as unknown as CharacterSheet).items).toMatchObject({
      held: 'Potion', digestionFood: 'Shuckle’s Berry Juice',
    })
    expect((shuckleAfter.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems ?? []).toEqual([])
    expect((trainerAfter.sheet as unknown as TrainerSheet).inventory?.foodStuff).toBeUndefined()
    expect(executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)).toEqual(first)
    expect(sheetRepository.getByRef('pokemon', 'shuckle')?.revision).toBe(shuckleAfter.revision)
  })

  it('offers self-use only for exact shell juice with an available Snack slot', () => {
    const juice = setupJuicer()
    const juiceOffers = buildCapabilityClientCapabilityBundle({
      role: 'gm', map: juice.mapRepository.getBySlug('arena')!, mapRevision: 5,
      pokemonSheets: [juice.shuckle], trainerSheets: [juice.linked], now: 1_000,
    }).placements[0]!.offers.map(offer => offer.actionId)
    expect(juiceOffers).toEqual(expect.arrayContaining([
      'consume-juicer-shell-juice-as-snack', 'collect-juicer-output',
    ]))

    const candy = setupJuicer({ stage: 'rare-candy' })
    expect(buildCapabilityClientCapabilityBundle({
      role: 'gm', map: candy.mapRepository.getBySlug('arena')!, mapRevision: 5,
      pokemonSheets: [candy.shuckle], trainerSheets: [candy.linked], now: 1_000,
    }).placements[0]!.offers.map(offer => offer.actionId))
      .not.toContain('consume-juicer-shell-juice-as-snack')

    const occupied = setupJuicer({ digestionFood: 'Candy Bar' })
    expect(buildCapabilityClientCapabilityBundle({
      role: 'gm', map: occupied.mapRepository.getBySlug('arena')!, mapRevision: 5,
      pokemonSheets: [occupied.shuckle], trainerSheets: [occupied.linked], now: 1_000,
    }).placements[0]!.offers.map(offer => offer.actionId))
      .not.toContain('consume-juicer-shell-juice-as-snack')

    const gluttony = setupJuicer({
      actionId: 'consume-juicer-shell-juice-as-snack', digestionFood: 'Candy Bar',
      abilities: [{ name: 'Gluttony' }],
    })
    executeCapabilityActionUseCase({ role: 'gm', command: gluttony.command }, gluttony.dependencies)
    expect((gluttony.sheetRepository.getByRef('pokemon', 'shuckle')?.sheet as unknown as CharacterSheet)
      .items).toMatchObject({ digestionFoods: ['Candy Bar', 'Shuckle’s Berry Juice'] })

    const fullGluttony = setupJuicer({
      digestionFoods: ['Candy Bar', 'Honey', 'Leftovers'], abilities: [{ name: 'Gluttony' }],
    })
    expect(buildCapabilityClientCapabilityBundle({
      role: 'gm', map: fullGluttony.mapRepository.getBySlug('arena')!, mapRevision: 5,
      pokemonSheets: [fullGluttony.shuckle], trainerSheets: [fullGluttony.linked], now: 1_000,
    }).placements[0]!.offers.map(offer => offer.actionId))
      .not.toContain('consume-juicer-shell-juice-as-snack')
  })

  it('collects a mature Rare Candy under its canonical ID into the selected linked Trainer', () => {
    const { command, dependencies, sheetRepository } = setupJuicer({ stage: 'rare-candy' })
    const result = executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)
    expect(result.produced).toEqual([{
      kind: 'item', canonicalId: 'rare-candy', quantity: 1, recipientSheetSlug: 'trainer',
    }])
    expect((sheetRepository.getByRef('trainer', 'trainer')?.sheet as unknown as TrainerSheet)
      .inventory?.pokemonItems).toContainEqual(expect.objectContaining({ name: 'Rare Candy', qty: 1 }))
  })

  it('rolls back both Juicer custody and recipient inventory when an atomic sheet write fails', () => {
    const fixture = setupJuicer()
    const failingRepository = {
      ...fixture.sheetRepository,
      applyLivePlayUpdate: (input: Parameters<typeof fixture.sheetRepository.applyLivePlayUpdate>[0]) => {
        if (input.kind === 'trainer') throw new Error('recipient write failed')
        return fixture.sheetRepository.applyLivePlayUpdate(input)
      },
    }
    expect(() => executeCapabilityActionUseCase({ role: 'gm', command: fixture.command }, {
      ...fixture.dependencies,
      sheetRepository: failingRepository,
    })).toThrow(/recipient write failed/i)
    expect((fixture.sheetRepository.getByRef('pokemon', 'shuckle')?.sheet as unknown as CharacterSheet).items?.held).toBe('Potion')
    expect((fixture.sheetRepository.getByRef('pokemon', 'shuckle')?.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems).toHaveLength(1)
    expect((fixture.sheetRepository.getByRef('trainer', 'trainer')?.sheet as unknown as TrainerSheet).inventory?.pokemonItems).toEqual([])
    expect((fixture.sheetRepository.getByRef('trainer', 'trainer')?.sheet as unknown as TrainerSheet).inventory?.foodStuff ?? []).toEqual([])
    expect(executeCapabilityActionUseCase({ role: 'gm', command: fixture.command }, fixture.dependencies))
      .toMatchObject({ outcome: 'applied', reasonCode: 'capability.juicer.output-collected' })
  })

  it('rejects a stale Juicer offer when elapsed time changes the exact shell stage', () => {
    const juiceAt = 100 + JUICER_BERRY_ELAPSED_MS
    const fixture = setupJuicer({
      stage: 'berry', custodyStartedAt: 100, storedAt: 100, now: juiceAt,
    })
    expect(() => executeCapabilityActionUseCase({ role: 'gm', command: fixture.command }, {
      ...fixture.dependencies,
      now: () => juiceAt + JUICER_JUICE_ELAPSED_MS,
    })).toThrow(/offer is unavailable or stale/i)
    expect((fixture.sheetRepository.getByRef('pokemon', 'shuckle')?.sheet as unknown as CharacterSheet)
      .capabilityCampaignState?.storedItems[0]).toMatchObject({ stage: 'berry', canonicalItemId: 'oran-berry' })
  })

  it('rejects a stale Juicer offer when the exact shell item identity is replaced', () => {
    const fixture = setupJuicer({ storedId: 'shell-output-a' })
    const stored = fixture.sheetRepository.getByRef('pokemon', 'shuckle')!
    const sheet = stored.sheet as unknown as CharacterSheet
    expect(fixture.sheetRepository.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: stored.revision,
      nextSheet: {
        ...sheet,
        capabilityCampaignState: {
          ...sheet.capabilityCampaignState!,
          storedItems: [{
            ...sheet.capabilityCampaignState!.storedItems[0]!,
            id: 'shell-output-b', custodyFingerprint: 'juicer-custody:replacement-output',
          }],
        },
        updatedAt: 900,
      },
      sourceOperationId: 'replace-shell-output',
    })).toBe('applied')
    expect(() => executeCapabilityActionUseCase({ role: 'gm', command: fixture.command }, fixture.dependencies))
      .toThrow(/offer is unavailable or stale/i)
  })

  it('requires an explicitly selected linked Trainer for bottling or collection', () => {
    const fixture = setupJuicer()
    expect(() => executeCapabilityActionUseCase({
      role: 'gm',
      command: {
        ...fixture.command,
        selections: { ...fixture.command.selections, recipientTrainerSlug: null },
      },
    }, fixture.dependencies)).toThrow(/explicitly selected Trainer inventory/i)

    fixture.sheetRepository.saveSetupSheet('trainer', 'unlinked', {
      slug: 'unlinked', name: 'Unlinked', level: 10, revision: 1, inventory: { pokemonItems: [] },
    })
    expect(() => executeCapabilityActionUseCase({
      role: 'gm',
      command: {
        ...fixture.command,
        selections: { ...fixture.command.selections, recipientTrainerSlug: 'unlinked' },
      },
    }, fixture.dependencies)).toThrow(/linked to Shuckle/i)
  })

  it('rotates collection offer authority when the linked Trainer set changes', () => {
    const fixture = setupJuicer()
    const trainer = fixture.sheetRepository.getByRef('trainer', 'trainer')!
    expect(fixture.sheetRepository.applyLivePlayUpdate({
      kind: 'trainer', slug: 'trainer', expectedRevision: trainer.revision,
      nextSheet: { ...trainer.sheet, currentTeam: [], updatedAt: 1_000 },
      sourceOperationId: 'unlink-shuckle',
    })).toBe('applied')
    expect(() => executeCapabilityActionUseCase({ role: 'gm', command: fixture.command }, fixture.dependencies))
      .toThrow(/offer is unavailable or stale/i)
  })

  it('binds exact operation replay to the originating principal', () => {
    const { command, dependencies } = setup()
    const profile = (id: string): PlayerProfile => ({
      schemaVersion: 1,
      id: id as PlayerProfile['id'],
      displayName: id as PlayerProfile['displayName'],
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'munna' }],
    })
    const first = executeCapabilityActionUseCase({
      role: 'player', playerProfile: profile('profile_player01'), command,
    }, dependencies)
    expect(executeCapabilityActionUseCase({
      role: 'player', playerProfile: profile('profile_player01'), command,
    }, dependencies)).toEqual(first)
    expect(() => executeCapabilityActionUseCase({
      role: 'player', playerProfile: profile('profile_player02'), command,
    }, dependencies)).toThrow(/different principal/i)
  })

  it('rejects a sheet that changes after planning instead of rebasing stale mechanic output', () => {
    const fixture = setup()
    let raced = false
    const racingRepository = {
      ...fixture.sheetRepository,
      getByRef: (kind: Parameters<typeof fixture.sheetRepository.getByRef>[0], slug: string) => {
        if (!raced && kind === 'pokemon' && slug === 'munna') {
          raced = true
          const current = fixture.sheetRepository.getByRef(kind, slug)!
          fixture.sheetRepository.applyLivePlayUpdate({
            kind,
            slug,
            expectedRevision: current.revision,
            nextSheet: { ...current.sheet, nickname: 'Concurrent edit', updatedAt: 999 },
          })
        }
        return fixture.sheetRepository.getByRef(kind, slug)
      },
    }

    expect(() => executeCapabilityActionUseCase({ role: 'gm', command: fixture.command }, {
      ...fixture.dependencies,
      sheetRepository: racingRepository,
    })).toThrow(/changed after the action was planned/i)
    expect(fixture.sheetRepository.getByRef('pokemon', 'munna')).toMatchObject({
      revision: 3,
      sheet: { nickname: 'Concurrent edit' },
    })
    expect((fixture.sheetRepository.getByRef('trainer', 'trainer')?.sheet as unknown as TrainerSheet)
      .inventory?.pokemonItems).toEqual([])
  })

  it('rejects changed operation input, stale projections, and uncontrolled player actors', () => {
    const { command, dependencies } = setup()
    executeCapabilityActionUseCase({ role: 'gm', command }, dependencies)
    expect(() => executeCapabilityActionUseCase({
      role: 'gm', command: { ...command, selections: { ...command.selections, recipientTrainerSlug: null } },
    }, dependencies)).toThrow(/reused with changed input/i)

    const second = setup()
    expect(() => executeCapabilityActionUseCase({ role: 'gm', command: { ...second.command, baseRevision: 4 } }, second.dependencies)).toThrow()
    expect(() => executeCapabilityActionUseCase({ role: 'player', playerProfile: null, command: second.command }, second.dependencies)).toThrow()
  })
})
