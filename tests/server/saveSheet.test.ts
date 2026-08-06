import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import { PLAYER_PROFILE_SCHEMA_VERSION, type PlayerProfile, type PlayerProfileDisplayName, type PlayerProfileId } from '../../shared/playerProfiles'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteMapInteractionModeRepository } from '../../server/storage/mapInteractionModeRepository'
import { createEmptyCapabilityCampaignState } from '../../shared/capabilityAutomation/campaignState'
import { createEmptyEncounterState } from '../../shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import {
  createSqliteRealtimeEventRepository,
  RealtimeEventDedupeConflictError,
  type RealtimeEventRepository,
} from '../../server/storage/realtimeEventRepository'
import { setupSheetSaveRealtimeDedupeKey } from '../../server/realtime/setupDocumentRealtime'
import { SaveSheetUseCaseError, saveSheetUseCase } from '../../server/useCases/saveSheet'
import {
  createBreedingBabyTemplateAuthorityV1,
  createBreedingMarsupialProviderTraitV1,
  resolveBreedingMarsupialBabyTemplateV1,
} from '../../server/domain/breeding/babyTemplate'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const pokemonSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 5,
  folder: 'party',
  player: false,
  revision: 4,
  updatedAt: 100,
  ...overrides,
})

const marsupialBabyAuthorityFields = (): Record<string, unknown> => {
  const template = resolveBreedingMarsupialBabyTemplateV1()
  const authority = createBreedingBabyTemplateAuthorityV1({
    sourceEggId: 'pokemon-egg:v1:91919191919191919191919191919191',
    babyTemplate: template,
    marsupial: createBreedingMarsupialProviderTraitV1(),
  })
  return {
    babyTemplate: true,
    babyTemplateMechanics: { schemaVersion: 1, applicationKind: authority.applicationKind, effects: authority.effects },
    serverPrivate: { breedingBabyTemplate: authority },
  }
}

const trainerSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'brock',
  name: 'Brock',
  level: 3,
  folder: 'gym',
  revision: 2,
  updatedAt: 100,
  ...overrides,
})

let databases: RotomDatabase[] = []
const db = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('save sheet use case', () => {
  it('commits a changed Pokémon sheet and two durable sheet-access events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 800 })
    const published: unknown[] = []
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Pika Prime', species: 'Pikachu', level: 6, playerProfileAccessible: true, sessionPlayerAccessible: true },
      clientId: 'client-1',
    }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 200,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(result.sheet).toMatchObject({ slug: 'pika', nickname: 'Pika Prime', level: 6, revision: 5, updatedAt: 200, folder: 'party' })
    expect(result.sheet).not.toHaveProperty('playerProfileAccessible')
    expect(result.sheet).not.toHaveProperty('sessionPlayerAccessible')
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(5)
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual(['sheet:pokemon:pika', 'sheets'])
    expect(result.realtimeEvents.map((event) => event.dedupeKey)).toEqual([
      'setup-sheet:pokemon:pika:5:specific',
      'setup-sheet:pokemon:pika:5:global',
    ])
    expect(result.realtimeEvents.map((event) => event.access)).toEqual([
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
    ])
    expect(result.realtimeEvents[0]?.event).toEqual({
      sequence: 1,
      timestamp: 800,
      channel: 'sheet:pokemon:pika',
      type: 'updated',
      clientId: 'client-1',
      data: { kind: 'pokemon', slug: 'pika', sheet: result.sheet },
    })
    expect(result.realtimeEvents[1]?.event).toEqual({
      sequence: 2,
      timestamp: 800,
      channel: 'sheets',
      type: 'updated',
      clientId: 'client-1',
      data: { kind: 'pokemon', slug: 'pika', sheet: result.sheet },
    })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('owns Juicer Berry custody epochs across setup held-item saves without using unrelated updatedAt', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shuckle', pokemonSheet({
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20,
      items: { held: 'Potion' },
    }))
    const saveHeld = (expectedRevision: number, held: string, now: number) => saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'shuckle', expectedRevision,
      sheet: {
        slug: 'shuckle', nickname: `Shuckle ${now}`, species: 'Shuckle', level: 20,
        items: { held },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => now })

    const enrolled = saveHeld(4, 'Oran Berry', 500).sheet
    const first = (enrolled.capabilityCampaignState as any).storedItems[0]
    expect(first).toMatchObject({ canonicalItemId: 'oran-berry', stage: 'berry', custodyStartedAt: 500 })

    const unrelated = saveHeld(5, 'Oran Berry', 50_000).sheet
    expect((unrelated.capabilityCampaignState as any).storedItems[0]).toEqual(first)

    const changedBerry = saveHeld(6, 'Sitrus Berry', 60_000).sheet
    const second = (changedBerry.capabilityCampaignState as any).storedItems[0]
    expect(second).toMatchObject({ canonicalItemId: 'sitrus-berry', custodyStartedAt: 60_000 })
    expect(second.custodyFingerprint).not.toBe(first.custodyFingerprint)

    expect(saveHeld(7, '', 70_000).sheet.capabilityCampaignState).toBeUndefined()
    const sameNameReplacement = saveHeld(8, 'Oran Berry', 80_000).sheet
    expect((sameNameReplacement.capabilityCampaignState as any).storedItems[0]).toMatchObject({
      canonicalItemId: 'oran-berry', custodyStartedAt: 80_000,
    })
  })

  it('server-rolls Color Theory acquisition and ignores client-authored parameter mechanics', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())

    const result = saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'pika', expectedRevision: 4,
      sheet: {
        slug: 'pika', nickname: 'Pika', species: 'Pikachu', level: 5,
        abilities: [{
          name: 'Color Theory',
          automation: {
            schemaVersion: 1, instanceId: 'client:forged', canonicalId: 'Color Theory', definitionVersion: 1,
            selections: [{ parameterId: 'color', optionIds: ['red'] }],
          },
        }],
      },
    }, {
      database, sheetRepository: sheets, realtimeEventRepository: realtime,
      now: () => 201, randomInt: () => 9,
    })

    const automation = (result.sheet.abilities as Array<Record<string, any>>)[0]?.automation
    expect(automation).toMatchObject({
      canonicalId: 'Color Theory', definitionVersion: 1,
      selections: [{ parameterId: 'color', optionIds: ['blue-violet'] }],
    })
    expect(automation.instanceId).not.toBe('client:forged')
  })

  it('commits a changed trainer sheet with the same durable event shape', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 801 })
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet())

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 2,
      sheet: {
        slug: 'brock',
        name: 'Brock Prime',
        level: 4,
        skills: {
          command: { rank: 'Master', modifier: 2 },
          focus: { rank: 'Adept' },
        },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 201 })

    expect(result.sheet).toMatchObject({ slug: 'brock', name: 'Brock Prime', revision: 3, updatedAt: 201 })
    expect(result.sheet.skills).toEqual({ command: { modifier: 2 } })
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual(['sheet:trainer:brock', 'sheets'])
    expect(result.realtimeEvents.every((event) => event.access.kind === 'sheet-access')).toBe(true)
    expect(result.realtimeEvents[0]?.event.data).toEqual({ kind: 'trainer', slug: 'brock', sheet: result.sheet })
    expect(result.realtimeEvents[1]?.dedupeKey).toBe('setup-sheet:trainer:brock:3:global')
  })

  it('returns the current document without advancing revision, appending, or publishing when unchanged', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet())

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 2,
      sheet: { slug: 'brock', name: 'Brock', level: 3 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 999, publishPersistedRealtimeEvent: publish })

    expect(result.sheet.revision).toBe(2)
    expect(result.realtimeEvents).toEqual([])
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects stale expected revisions without appending or publishing', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ revision: 3 }))

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 2,
      sheet: { slug: 'pika', nickname: 'Stale', species: '', level: 1 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, publishPersistedRealtimeEvent: publish })).toThrow(SaveSheetUseCaseError)

    expect(sheets.getByRef('pokemon', 'pika')).toMatchObject({ revision: 3 })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('preserves player access policy for player saves and writes durable events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet({
      player: false,
      revision: 1,
      capabilityUsage: {
        schemaVersion: 1,
        entries: [{
          id: 'trainer-private-use', canonicalId: 'Tracker', actionId: 'follow-scent',
          capabilityInstanceId: 'capability:brock:Tracker:base', period: 'hourly',
          usedAt: 100, availableAt: 3_700_000, remainingDayAdvances: null,
          sourceOperationId: 'operation:trainer-private-use',
        }],
      },
    }))

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 1,
      sheet: {
        slug: 'brock', name: 'Brock Prime', level: 4, player: true,
        capabilityUsage: { schemaVersion: 1, entries: [] },
      },
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]),
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime })

    expect(result.sheet).toMatchObject({ slug: 'brock', name: 'Brock Prime', player: false, revision: 2 })
    expect(result.sheet).not.toHaveProperty('capabilityUsage')
    expect(sheets.getByRef('trainer', 'brock')?.sheet).toMatchObject({
      capabilityUsage: {
        entries: [expect.objectContaining({ id: 'trainer-private-use' })],
      },
    })
    expect(result.realtimeEvents).toHaveLength(2)
    expect(result.realtimeEvents.every((event) => event.access.kind === 'sheet-access')).toBe(true)
  })

  it('preserves and redacts Pokémon GM fields for player saves', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({
      player: true,
      revision: 1,
      gm: { notes: 'secret capture twist' },
      loyalty: 4,
      capabilityUsage: {
        schemaVersion: 1,
        entries: [{
          id: 'private-use', canonicalId: 'Glow', actionId: 'emit-light',
          capabilityInstanceId: 'capability:pika:Glow:base', period: 'daily',
          usedAt: 100, availableAt: null, remainingDayAdvances: null,
          sourceOperationId: 'operation:private-use',
        }],
      },
      serverPrivate: { abilityItemEvidence: [{ stateId: 'state-1', canonicalItemId: 'cheri-berry' }] },
    }))

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 1,
      sheet: {
        slug: 'pika', nickname: 'Pika Prime', species: 'Pikachu', level: 5,
        gm: { notes: 'player should not write this' },
        loyalty: 0,
        capabilityUsage: { schemaVersion: 1, entries: [] },
        serverPrivate: { abilityItemEvidence: [{ stateId: 'forged', canonicalItemId: 'potion' }] },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime })

    expect(result.sheet).toMatchObject({ slug: 'pika', nickname: 'Pika Prime', revision: 2 })
    expect(result.sheet).not.toHaveProperty('gm')
    expect(result.sheet).not.toHaveProperty('serverPrivate')
    expect(result.sheet).not.toHaveProperty('loyalty')
    expect(result.sheet).not.toHaveProperty('capabilityUsage')
    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({
      nickname: 'Pika Prime',
      gm: { notes: 'secret capture twist' },
      loyalty: 4,
      capabilityUsage: {
        entries: [expect.objectContaining({ id: 'private-use', sourceOperationId: 'operation:private-use' })],
      },
      serverPrivate: { abilityItemEvidence: [{ stateId: 'state-1', canonicalItemId: 'cheri-berry' }] },
      revision: 2,
    })
  })

  it('ignores player campaign-state forgery but persists server-derived Juicer custody', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shuckle', pokemonSheet({
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20,
      player: true, revision: 1, items: { held: 'Potion' },
    }))

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'shuckle',
      expectedRevision: 1,
      sheet: {
        slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20,
        items: { held: 'Oran Berry' },
        capabilityCampaignState: {
          ...createEmptyCapabilityCampaignState(),
          planter: {
            id: 'forged-planter', inputCanonicalItemId: 'oran-berry', plantedCanonicalId: 'apricorn-red',
            plantedAt: 1, sourceOperationId: 'forged-operation',
          },
        },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 500 })

    expect(result.sheet).not.toHaveProperty('capabilityCampaignState')
    expect(sheets.getByRef('pokemon', 'shuckle')?.sheet).toMatchObject({
      items: { held: 'Oran Berry' },
      capabilityCampaignState: {
        planter: null,
        storedItems: [expect.objectContaining({
          canonicalItemId: 'oran-berry',
          stage: 'berry',
          custodyStartedAt: 500,
        })],
      },
    })
  })

  it('rolls back the sheet when the specific realtime event append fails', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    const failingRealtime = {
      database,
      appendMany: vi.fn(() => { throw new Error('specific append failed') }),
    }

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Broken', species: 'Pikachu', level: 7 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: failingRealtime })).toThrow('specific append failed')

    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({ nickname: 'Pika', revision: 4, updatedAt: 100 })
  })

  it('rolls back the specific event and sheet when the global realtime event append fails', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    const partialRealtime = {
      database,
      appendMany: vi.fn((inputs: Parameters<RealtimeEventRepository['appendMany']>[0]) => {
        const first = inputs[0]
        if (!first) throw new Error('missing first event')
        realtime.append(first)
        throw new Error('global append failed')
      }),
    }

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Broken', species: 'Pikachu', level: 7 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: partialRealtime })).toThrow('global append failed')

    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({ nickname: 'Pika', revision: 4, updatedAt: 100 })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(realtime.getBySequence(1)).toBeNull()
  })

  it('rolls back sheet revision on dedupe conflicts', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    realtime.append({
      event: { channel: 'sheet:pokemon:pika', type: 'updated', data: { wrong: true } },
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
      dedupeKey: setupSheetSaveRealtimeDedupeKey({ kind: 'pokemon', slug: 'pika', revision: 5, destination: 'specific' }),
    })

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Conflict', species: 'Pikachu', level: 7 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime })).toThrow(RealtimeEventDedupeConflictError)

    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({ nickname: 'Pika', revision: 4, updatedAt: 100 })
    expect(realtime.cursorState().latestSequence).toBe(1)
  })

  it('preserves server-owned reciprocal Marsupial state against setup-save forgery and erasure', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const pouch = {
      motherSheetSlug: 'kangaskhan-mother', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
      establishedAt: 100, sourceOperationId: 'shelter-operation',
    }
    sheets.saveSetupSheet('pokemon', 'kangaskhan-mother', {
      slug: 'kangaskhan-mother', nickname: 'Mother', species: 'Kangaskhan', level: 30, revision: 1, updatedAt: 100,
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })
    sheets.saveSetupSheet('pokemon', 'kangaskhan-baby', {
      slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 10,
      ...marsupialBabyAuthorityFields(), revision: 1, updatedAt: 100,
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })

    const result = saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'kangaskhan-baby', expectedRevision: 1,
      sheet: {
        slug: 'kangaskhan-baby', nickname: 'Baby edited', species: 'Kangaskhan', level: 10, babyTemplate: false,
        capabilityCampaignState: {
          ...createEmptyCapabilityCampaignState(),
          marsupialPouch: { ...pouch, experienceSharePercent: 0, motherSheetSlug: 'forged-mother' },
        },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 200 })

    expect(result.sheet).toMatchObject({ nickname: 'Baby edited', babyTemplate: true })
    expect((result.sheet.capabilityCampaignState as Record<string, unknown>).marsupialPouch).toEqual(pouch)
    expect(sheets.getByRef('pokemon', 'kangaskhan-mother')?.sheet.capabilityCampaignState)
      .toMatchObject({ marsupialPouch: pouch })

    sheets.saveSetupSheet('pokemon', 'unbound-baby', {
      slug: 'unbound-baby', nickname: 'Unbound', species: 'Kangaskhan', level: 10, revision: 1, updatedAt: 100,
    })
    const forged = saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'unbound-baby', expectedRevision: 1,
      sheet: {
        slug: 'unbound-baby', nickname: 'Unbound', species: 'Kangaskhan', level: 10,
        capabilityCampaignState: {
          ...createEmptyCapabilityCampaignState(),
          marsupialPouch: { ...pouch, babySheetSlug: 'unbound-baby' },
        },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 201 })
    expect((forged.sheet.capabilityCampaignState as Record<string, unknown> | undefined)?.marsupialPouch ?? null).toBeNull()
  })

  it('fails closed before reducers when stored Baby Template authority has a stale self-hash', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const authorityFields = structuredClone(marsupialBabyAuthorityFields())
    ;(((authorityFields.serverPrivate as Record<string, unknown>).breedingBabyTemplate as Record<string, unknown>).definitionSha256) = '0'.repeat(64)
    sheets.saveSetupSheet('pokemon', 'kangaskhan-baby', {
      slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 10,
      ...authorityFields, revision: 1, updatedAt: 100,
    })

    expect(() => saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'kangaskhan-baby', expectedRevision: 1,
      sheet: { slug: 'kangaskhan-baby', nickname: 'Forged', species: 'Kangaskhan', level: 25 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 200 }))
      .toThrowError(expect.objectContaining({ statusCode: 409 }))
    expect(sheets.getByRef('pokemon', 'kangaskhan-baby')).toMatchObject({ revision: 1, sheet: { level: 10 } })
  })

  it('atomically exits a Level 25 Marsupial baby across both sheets and map mirrors, including rollback', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const pouch = {
      motherSheetSlug: 'kangaskhan-mother', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
      establishedAt: 100, sourceOperationId: 'shelter-operation',
    }
    sheets.saveSetupSheet('pokemon', 'kangaskhan-mother', {
      slug: 'kangaskhan-mother', nickname: 'Mother', species: 'Kangaskhan', level: 30, revision: 1, updatedAt: 100,
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })
    sheets.saveSetupSheet('pokemon', 'kangaskhan-baby', {
      slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 24,
      ...marsupialBabyAuthorityFields(), babyTemplate: false, revision: 1, updatedAt: 100,
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })
    const encounter = createEmptyEncounterState()
    maps.saveSetupMap({
      schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4, updatedAt: 100,
      dimensions: { x: 6, y: 3, z: 6 }, groundLevelY: 0, voxels: [], hazards: [], lights: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] }, placements: [
        { id: 'mother-token', sheetKind: 'pokemon', sheetSlug: 'kangaskhan-mother', position: { x: 1, y: 0, z: 1 } },
        { id: 'baby-token', sheetKind: 'pokemon', sheetSlug: 'kangaskhan-baby', position: { x: 1, y: 0, z: 1 } },
      ],
      metadata: { capabilityMarsupialPouches: [{ motherPlacementId: 'mother-token', babyPlacementId: 'baby-token' }] },
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'pouch-link', kind: 'marsupial-pouch', ownerPlacementId: 'mother-token', participantPlacementIds: ['baby-token'],
            capabilityInstanceId: 'marsupial-source', canonicalId: 'Marsupial', establishedAt: 100,
            configurationId: 'experience-share:20', sourceOperationId: 'shelter-operation',
          }],
        },
      },
    } as TabletopMap)
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 100 })
    const input = {
      role: 'gm' as const, interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon' as const, slug: 'kangaskhan-baby', expectedRevision: 1,
      sheet: { slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 25, babyTemplate: true },
    }
    const failingRealtime = {
      database,
      appendMany: vi.fn(() => { throw new Error('lifecycle event failure') }),
    }

    expect(() => saveSheetUseCase(input, {
      database, sheetRepository: sheets, mapRepository: maps, realtimeEventRepository: failingRealtime, now: () => 200,
    })).toThrow('lifecycle event failure')
    expect(sheets.getByRef('pokemon', 'kangaskhan-baby')).toMatchObject({ revision: 1, sheet: { babyTemplate: false } })
    expect(sheets.getByRef('pokemon', 'kangaskhan-mother')?.sheet.capabilityCampaignState).toBeDefined()
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 4 })

    saveSheetUseCase(input, {
      database, sheetRepository: sheets, mapRepository: maps, realtimeEventRepository: realtime, now: () => 200,
    })
    expect(sheets.getByRef('pokemon', 'kangaskhan-baby')).toMatchObject({
      revision: 2, sheet: { level: 25, babyTemplate: false },
    })
    expect(sheets.getByRef('pokemon', 'kangaskhan-baby')?.sheet.capabilityCampaignState).toBeUndefined()
    expect(sheets.getByRef('pokemon', 'kangaskhan-mother')?.sheet.capabilityCampaignState).toBeUndefined()
    expect(maps.getBySlug('arena')).toMatchObject({
      revision: 5,
      metadata: { capabilityMarsupialPouches: [] },
      encounterState: { capabilityRuntime: { links: [] } },
    })
  })

  it('rejects a forged setup save while the sheet is present on a live map', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    maps.saveSetupMap({
      schemaVersion: 2, slug: 'arena', name: 'Arena', folder: '', revision: 4,
      dimensions: { x: 4, y: 2, z: 4 }, voxels: [], lights: [],
      placements: [{
        id: 'pika-token', sheetKind: 'pokemon', sheetSlug: 'pika',
        position: { x: 0, y: 0, z: 0 },
      }],
      initiative: { activeId: null, round: 1 },
    })
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 100 })

    expect(() => saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'pika', expectedRevision: 4,
      sheet: pokemonSheet({ combat: { currentHp: 0, injuries: 3 } }),
    }, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, now: () => 200,
    })).toThrow(expect.objectContaining({
      statusCode: 409,
      message: expect.stringContaining('present on a live map'),
    }))
    expect(sheets.getByRef('pokemon', 'pika')).toMatchObject({ revision: 4 })
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 4 })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })

  it('normalizes off-map Soulless HP and Injuries during a setup save', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shedinja', {
      slug: 'shedinja', nickname: 'Shedinja', species: 'Shedinja', level: 20,
      combat: { currentHp: 1, injuries: 0, conditions: [] }, revision: 1,
    })

    const result = saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'shedinja', expectedRevision: 1,
      sheet: {
        slug: 'shedinja', nickname: 'Shedinja', species: 'Shedinja', level: 20,
        combat: { currentHp: 50, injuries: 4, conditions: [] }, revision: 1,
      },
    }, {
      database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 200,
    })

    expect(result.sheet).toMatchObject({ combat: { currentHp: 1, injuries: 0 } })
    expect(sheets.getByRef('pokemon', 'shedinja')?.sheet)
      .toMatchObject({ combat: { currentHp: 1, injuries: 0 } })
  })

  it('blocks live-play whole-sheet saves and inaccessible player saves', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'locked', { slug: 'locked', nickname: 'Locked', species: '', level: 1, player: false, revision: 0, updatedAt: 1 })

    expect(() => saveSheetUseCase({ role: 'gm', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, kind: 'pokemon', slug: 'locked', expectedRevision: 0, sheet: { slug: 'locked' } }, { database, sheetRepository: sheets }))
      .toThrow('Whole-sheet saves are setup/edit-only')
    expect(() => saveSheetUseCase({ role: 'player', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, kind: 'pokemon', slug: 'locked', expectedRevision: 0, sheet: { slug: 'locked' } }, { database, sheetRepository: sheets }))
      .toThrow('Sheet is not marked as player accessible or linked to the selected player profile')
  })
})
