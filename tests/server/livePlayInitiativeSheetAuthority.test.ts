import { afterEach, describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES } from '#shared/livePlayCommands'
import { listSheetsUseCase } from '~~/server/useCases/listSheets'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import { playerVisibleMapSheetAccessKeys } from '~~/server/utils/mapStorage'
import type { TabletopMap } from '~/types/map'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const harnesses: LivePlayIntegrationHarness[] = []

const createHarness = (): LivePlayIntegrationHarness => {
  const harness = LivePlayIntegrationHarness.create({
    map: initiativeMap(),
    sheets: initiativeSheets(),
  })
  harnesses.push(harness)
  return harness
}

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

const initiativeMap = (): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'integration-arena',
  name: 'Integration Arena',
  folder: '',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'alpha-mon',
      position: { x: 1, y: 0, z: 1 },
      initiative: 30,
    },
    {
      id: 'token-b',
      sheetKind: 'trainer',
      sheetSlug: 'bravo-trainer',
      position: { x: 2, y: 0, z: 1 },
      initiative: 20,
    },
    {
      id: 'token-c',
      sheetKind: 'pokemon',
      sheetSlug: 'charlie-mon',
      position: { x: 3, y: 0, z: 1 },
      initiative: 12,
    },
  ],
  lights: [],
  initiative: { activeId: 'token-a', round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

const pokemonSheet = (
  slug: string,
  speed: number,
  nickname: string,
): Record<string, unknown> => ({
  slug,
  species: '',
  nickname,
  level: 20,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  combat: { currentHp: 30, injuries: 0, conditions: [] },
  stats: {
    hp: { base: 10, stage: 0 },
    atk: { base: 10, stage: 0 },
    def: { base: 10, stage: 0 },
    satk: { base: 10, stage: 0 },
    sdef: { base: 10, stage: 0 },
    spd: { base: speed, stage: 0 },
  },
  combatStages: { acc: 0 },
  movelist: [],
})

const trainerSheet = (
  slug: string,
  speed: number,
  name: string,
): Record<string, unknown> => ({
  slug,
  name,
  level: 20,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  currentHp: 40,
  currentInjuries: 0,
  conditions: [],
  stats: {
    hp: { base: 10, stage: 0 },
    atk: { base: 10, stage: 0 },
    def: { base: 10, stage: 0 },
    satk: { base: 10, stage: 0 },
    sdef: { base: 10, stage: 0 },
    spd: { base: speed, stage: 0 },
  },
  combatStages: { acc: 0 },
})

const initiativeSheets = (): PersistedSheet[] => [
  {
    kind: 'pokemon',
    slug: 'alpha-mon',
    revision: 0,
    updatedAt: 1_700_000_000_000,
    sheet: pokemonSheet('alpha-mon', 30, 'Alpha'),
  },
  {
    kind: 'trainer',
    slug: 'bravo-trainer',
    revision: 0,
    updatedAt: 1_700_000_000_000,
    sheet: trainerSheet('bravo-trainer', 20, 'Bravo'),
  },
  {
    kind: 'pokemon',
    slug: 'charlie-mon',
    revision: 0,
    updatedAt: 1_700_000_000_000,
    sheet: pokemonSheet('charlie-mon', 12, 'Charlie'),
  },
]

const gm = { role: 'gm' as const, clientId: 'gm-client' }
const oldOrder = ['token-a', 'token-b', 'token-c'] as const

const acceptedInitiativeEvents = (
  harness: LivePlayIntegrationHarness,
  opId: string,
) => harness.publishedEvents.filter((event) => (
  event.type === 'live-play-command-accepted'
  && event.opId === opId
  && event.patches?.some((patch) => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE)
))

const paralyzeAlpha = async (harness: LivePlayIntegrationHarness) => {
  const response = await harness.modifyConditions({
    actor: gm,
    command: harness.modifyConditionsCommand({
      opId: 'op_paralyze_alpha',
      baseRevision: 0,
      placementId: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'alpha-mon',
      action: 'add',
      conditions: ['Paralysis'],
    }),
  })
  expect(assertAccepted(response.result)).toMatchObject({ previousRevision: 0, revision: 1 })
}

const paralyzeBravo = async (harness: LivePlayIntegrationHarness) => {
  const response = await harness.modifyConditions({
    actor: gm,
    command: harness.modifyConditionsCommand({
      opId: 'op_paralyze_bravo',
      baseRevision: 0,
      placementId: 'token-b',
      sheetKind: 'trainer',
      sheetSlug: 'bravo-trainer',
      action: 'add',
      conditions: ['Paralysis'],
    }),
  })
  expect(assertAccepted(response.result)).toMatchObject({ previousRevision: 0, revision: 1 })
}

describe('live-play initiative sheet authority', () => {
  it('rejects stale NEXT_INITIATIVE order after a live-play Pokémon sheet condition change in SQLite', async () => {
    const harness = createHarness()
    await paralyzeAlpha(harness)
    const eventsBefore = harness.publishedEvents.length
    const currentMap = await harness.readMap()

    const response = await harness.nextInitiative({
      actor: gm,
      command: harness.nextInitiativeCommand({
        opId: 'op_stale_next_sheet_order',
        baseRevision: currentMap?.revision ?? 1,
        orderIds: oldOrder,
        activeId: 'token-a',
        round: 1,
      }),
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 1,
    })
    const after = await harness.readMap()
    expect(after?.initiative).toEqual({ activeId: 'token-a', round: 1 })
    expect(after?.metadata?.initiativeLog).toBeUndefined()
    expect(after?.revision).toBe(1)
    expect(harness.publishedEvents).toHaveLength(eventsBefore)
    expect(acceptedInitiativeEvents(harness, 'op_stale_next_sheet_order')).toEqual([])
  })

  it('accepts NEXT_INITIATIVE when the client submits the updated authoritative sheet-derived order', async () => {
    const harness = createHarness()
    await paralyzeAlpha(harness)
    const currentMap = await harness.readMap()

    const response = await harness.nextInitiative({
      actor: gm,
      command: harness.nextInitiativeCommand({
        opId: 'op_fresh_next_sheet_order',
        baseRevision: currentMap?.revision ?? 1,
        orderIds: ['token-b', 'token-a', 'token-c'],
        activeId: 'token-a',
        round: 1,
      }),
    })

    expect(assertAccepted(response.result)).toMatchObject({ previousRevision: 1, revision: 2 })
    const after = await harness.readMap()
    expect(after?.initiative).toEqual({ activeId: 'token-c', round: 1 })
    expect(after?.metadata?.initiativeLog).toEqual([
      expect.objectContaining({ userId: 'token-c', userName: 'charlie-mon' }),
    ])
    expect(acceptedInitiativeEvents(harness, 'op_fresh_next_sheet_order')).toHaveLength(1)
  })

  it('rejects stale PREVIOUS_INITIATIVE order after a live-play trainer sheet condition change in SQLite', async () => {
    const harness = createHarness()
    await paralyzeBravo(harness)
    const eventsBefore = harness.publishedEvents.length
    const currentMap = await harness.readMap()

    const response = await harness.previousInitiative({
      actor: gm,
      command: harness.previousInitiativeCommand({
        opId: 'op_stale_previous_sheet_order',
        baseRevision: currentMap?.revision ?? 1,
        orderIds: oldOrder,
        activeId: 'token-a',
        round: 1,
      }),
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 1,
    })
    const after = await harness.readMap()
    expect(after?.initiative).toEqual({ activeId: 'token-a', round: 1 })
    expect(after?.metadata?.initiativeLog).toBeUndefined()
    expect(after?.revision).toBe(1)
    expect(harness.publishedEvents).toHaveLength(eventsBefore)
    expect(acceptedInitiativeEvents(harness, 'op_stale_previous_sheet_order')).toEqual([])
  })

  it('accepts PREVIOUS_INITIATIVE when the client submits the updated authoritative trainer-sheet order', async () => {
    const harness = createHarness()
    await paralyzeBravo(harness)
    const currentMap = await harness.readMap()

    const response = await harness.previousInitiative({
      actor: gm,
      command: harness.previousInitiativeCommand({
        opId: 'op_fresh_previous_sheet_order',
        baseRevision: currentMap?.revision ?? 1,
        orderIds: ['token-a', 'token-c', 'token-b'],
        activeId: 'token-a',
        round: 1,
      }),
    })

    expect(assertAccepted(response.result)).toMatchObject({ previousRevision: 1, revision: 2 })
    const after = await harness.readMap()
    expect(after?.initiative).toEqual({ activeId: 'token-b', round: 1 })
    expect(after?.metadata?.initiativeLog).toEqual([
      expect.objectContaining({ userId: 'token-b', userName: 'bravo-trainer' }),
    ])
    expect(acceptedInitiativeEvents(harness, 'op_fresh_previous_sheet_order')).toHaveLength(1)
  })

  it('lists live-play SQLite sheet changes through the runtime sheet list source', async () => {
    const harness = createHarness()
    await paralyzeAlpha(harness)

    const listed = listSheetsUseCase({ role: 'gm' }, { sheetRepository: harness.sheetRepository })

    expect(listed.pokemonSheets.find((sheet) => sheet.slug === 'alpha-mon')?.combat?.conditions).toEqual(['Paralysis'])
    expect(listed.trainerSheets.find((sheet) => sheet.slug === 'bravo-trainer')?.name).toBe('Bravo')
  })

  it('derives player runtime sheet access from the SQLite authoritative map source', () => {
    const harness = createHarness()
    const visibleSheetKeys = playerVisibleMapSheetAccessKeys(harness.mapRepository)
    const listed = listSheetsUseCase({
      role: 'player',
      canAccessPlayerSheet: (kind, slug) => visibleSheetKeys.has(`${kind}:${slug}`),
    }, { sheetRepository: harness.sheetRepository })

    expect(listed.pokemonSheets.map((sheet) => sheet.slug).sort()).toEqual(['alpha-mon', 'charlie-mon'])
    expect(listed.trainerSheets.map((sheet) => sheet.slug)).toEqual(['bravo-trainer'])
  })
})
