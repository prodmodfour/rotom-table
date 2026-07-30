import { describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { parsePersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { TrainerSheet } from '~/types/trainerSheet'
import { filterRealtimeEventsForPrincipal } from '../../server/realtime/realtimeEventAccessPolicy'
import type {
  RealtimeDeliveryPrincipal,
  RealtimeEventAccessDependencies,
  RealtimePlayerSheetAccessKey,
  RealtimePolicyPersistedSheet,
} from '../../server/realtime/realtimeEventAccessPolicy'
import { createMapFolderUseCase } from '../../server/useCases/createMapFolder'
import { moveMapUseCase } from '../../server/useCases/moveMap'
import { createSheetUseCase } from '../../server/useCases/createSheet'
import { deleteSheetUseCase } from '../../server/useCases/deleteSheet'
import { setMapInteractionModeUseCase } from '../../server/useCases/setMapInteractionMode'
import { durableHarness, mapDoc, pokemonSheet } from './helpers/durableLibraryHarness'

const profileLinkedTo = (kind: SheetKind, slug: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_wave1merge' as PlayerProfileId,
  displayName: 'Wave 1 merge' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: kind, sheetSlug: slug }],
})

const player = (overrides: Partial<RealtimeDeliveryPrincipal> = {}): RealtimeDeliveryPrincipal => ({
  role: 'player',
  ...overrides,
})

const accessDependencies = (
  harness: Pick<ReturnType<typeof durableHarness>, 'maps' | 'sheets'>,
  playerVisibleMapKeys: readonly RealtimePlayerSheetAccessKey[] = [],
): RealtimeEventAccessDependencies => ({
  getMap: (slug) => harness.maps.getBySlug(slug),
  getSheet: (kind, slug): RealtimePolicyPersistedSheet | null => {
    const sheet = harness.sheets.getByRef(kind, slug)
    if (!sheet) return null
    return {
      kind: sheet.kind,
      slug: sheet.slug,
      sheet: sheet.sheet,
      revision: sheet.revision,
      updatedAt: sheet.updatedAt,
    }
  },
  listTrainerSheets: () => harness.sheets.list('trainer').map((stored) => {
    const document = stored.document as Record<string, unknown>
    return {
      ...document,
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
      folder: typeof document.folder === 'string' ? document.folder : '',
    } as unknown as TrainerSheet
  }),
  playerVisibleMapSheetAccessKeys: () => new Set(playerVisibleMapKeys),
})

describe('Wave 1 merge realtime foundations', () => {
  it('persists durable library descriptors that validate and feed access policy decisions', () => {
    const harness = durableHarness(70_000)
    const { database, maps, sheets, modes, realtime } = harness
    maps.saveSetupMap(mapDoc({ slug: 'visible-arena', name: 'Visible Arena', folder: 'old', revision: 1, updatedAt: 10, playerVisible: true }))
    maps.saveSetupMap(mapDoc({ slug: 'hidden-vault', name: 'Hidden Vault', folder: 'old', revision: 1, updatedAt: 10, playerVisible: false }))

    const visibleMove = moveMapUseCase({ slug: 'visible-arena', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 20,
    })
    const hiddenMove = moveMapUseCase({ slug: 'hidden-vault', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 30,
    })
    const mapFolder = createMapFolderUseCase({ folder: 'secret-folder' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 40,
    })
    const sheetCreated = createSheetUseCase({ kind: 'pokemon', folder: 'party' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 50,
    })
    const trainerCreated = createSheetUseCase({ kind: 'trainer', folder: 'party' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 60,
    })
    sheets.saveSetupSheet('pokemon', 'doomed-pika', pokemonSheet({ slug: 'doomed-pika', revision: 0, updatedAt: 70 }))
    const deletedSheet = deleteSheetUseCase({ kind: 'pokemon', slug: 'doomed-pika' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
    })
    const modeUpdated = setMapInteractionModeUseCase({
      slug: 'visible-arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
    }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      realtimeEventRepository: realtime,
      now: () => 80,
    })

    expect(parsePersistedRealtimeEvent(visibleMove.realtimeEvents[0])).toEqual(visibleMove.realtimeEvents[0])
    expect(sheetCreated.realtimeEvents[0]).toMatchObject({
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: sheetCreated.slug },
      event: { channel: 'sheets' },
    })
    expect(mapFolder.realtimeEvents[0]).toMatchObject({
      access: { kind: 'gm-only' },
      event: { channel: 'maps', type: 'folder-created' },
    })
    expect(deletedSheet.realtimeEvents.slice(0, 2).map((event) => event.access)).toEqual([
      { kind: 'gm-only' },
      { kind: 'gm-only' },
    ])
    expect(modeUpdated.realtimeEvents[0]).toMatchObject({
      access: { kind: 'map-access', mapSlug: 'visible-arena' },
      event: { channel: 'map:visible-arena', type: 'map-interaction-mode-updated' },
    })

    const deps = accessDependencies(harness)
    expect(filterRealtimeEventsForPrincipal({
      events: mapFolder.realtimeEvents,
      principal: { role: 'gm' },
      dependencies: deps,
    }).allowed.map((event) => event.sequence)).toEqual(mapFolder.realtimeEvents.map((event) => event.sequence))
    expect(filterRealtimeEventsForPrincipal({
      events: mapFolder.realtimeEvents,
      principal: player(),
      dependencies: deps,
    }).denied.map(({ decision }) => decision.reason)).toEqual(['gm-only'])
    expect(filterRealtimeEventsForPrincipal({
      events: [visibleMove.realtimeEvents[0]],
      principal: player(),
      dependencies: deps,
    }).allowed).toMatchObject([visibleMove.realtimeEvents[0]])
    expect(filterRealtimeEventsForPrincipal({
      events: [hiddenMove.realtimeEvents[0]],
      principal: player(),
      dependencies: deps,
    }).denied[0]?.decision).toEqual({ allowed: false, reason: 'map-not-accessible' })
    expect(filterRealtimeEventsForPrincipal({
      events: sheetCreated.realtimeEvents,
      principal: player(),
      dependencies: deps,
    }).denied[0]?.decision).toEqual({ allowed: false, reason: 'sheet-not-accessible' })
    expect(filterRealtimeEventsForPrincipal({
      events: sheetCreated.realtimeEvents,
      principal: player({ sessionAccess: { sheetKeys: new Set<RealtimePlayerSheetAccessKey>([`pokemon:${sheetCreated.slug}`]) } }),
      dependencies: deps,
    }).allowed).toEqual(sheetCreated.realtimeEvents)
    expect(filterRealtimeEventsForPrincipal({
      events: trainerCreated.realtimeEvents,
      principal: player({ playerProfile: profileLinkedTo('trainer', trainerCreated.slug) }),
      dependencies: deps,
    }).allowed).toEqual(trainerCreated.realtimeEvents)
  })

  it('filters a SQLite-assigned durable batch without reordering allowed rows', () => {
    const harness = durableHarness(71_000)
    const { database, maps, sheets, modes, realtime } = harness
    maps.saveSetupMap(mapDoc({ slug: 'visible-arena', name: 'Visible Arena', folder: 'old', revision: 1, updatedAt: 10, playerVisible: true }))
    maps.saveSetupMap(mapDoc({ slug: 'hidden-vault', name: 'Hidden Vault', folder: 'old', revision: 1, updatedAt: 10, playerVisible: false }))

    moveMapUseCase({ slug: 'visible-arena', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 20,
    })
    createMapFolderUseCase({ folder: 'secret-folder' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 30,
    })
    const sheetCreated = createSheetUseCase({ kind: 'pokemon', folder: 'party' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 40,
    })
    moveMapUseCase({ slug: 'hidden-vault', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 50,
    })
    setMapInteractionModeUseCase({
      slug: 'visible-arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
    }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      realtimeEventRepository: realtime,
      now: () => 60,
    })

    const events = realtime.readAfter({ afterSequence: 0, limit: 20 }).events
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])

    const result = filterRealtimeEventsForPrincipal({
      events,
      principal: player({ sessionAccess: { sheetKeys: new Set<RealtimePlayerSheetAccessKey>([`pokemon:${sheetCreated.slug}`]) } }),
      dependencies: accessDependencies(harness),
    })

    expect(result.allowed.map((event) => event.sequence)).toEqual([1, 2, 4, 7])
    expect(result.denied.map(({ event, decision }) => [event.sequence, decision.reason])).toEqual([
      [3, 'gm-only'],
      [5, 'map-not-accessible'],
      [6, 'map-not-accessible'],
    ])
  })

  it('rolls back a library mutation when durable append fails after both foundations are merged', () => {
    const { database, maps, realtime } = durableHarness()
    maps.saveSetupMap(mapDoc({ slug: 'visible-arena', folder: 'old', revision: 2, updatedAt: 100, playerVisible: true }))
    const failingRealtime = {
      database,
      appendMany: vi.fn(() => {
        throw new Error('durable append down')
      }),
    }

    expect(() => moveMapUseCase({ slug: 'visible-arena', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: failingRealtime,
      now: () => 200,
    })).toThrow('durable append down')

    expect(maps.getBySlug('visible-arena')).toMatchObject({ folder: 'old', revision: 2, updatedAt: 100 })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })
})
