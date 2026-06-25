import { describe, expect, it } from 'vitest'
import { MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH } from '#shared/realtimeEventLog'
import {
  setupMapSaveRealtimeAppendInputs,
  setupMapSaveRealtimeDedupeKey,
  setupSheetSaveRealtimeAppendInputs,
  setupSheetSaveRealtimeDedupeKey,
} from '~~/server/realtime/setupDocumentRealtime'
import type { TabletopMap } from '~/types/map'

const mapDoc = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 3,
  slug: 'arena',
  name: 'Arena',
  folder: 'maps',
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: false,
  placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 2 }, facing: 'south-east', turned: false }],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  initiative: { activeId: null, round: 1 },
  createdAt: 100,
  updatedAt: 300,
  ...overrides,
})

describe('setup document realtime helpers', () => {
  it('creates canonical map full-document then summary append inputs with map access', () => {
    const map = mapDoc()
    const inputs = setupMapSaveRealtimeAppendInputs(map, 'client-1')

    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toMatchObject({
      event: {
        channel: 'map:arena',
        type: 'updated',
        revision: 3,
        clientId: 'client-1',
        data: map,
      },
      access: { kind: 'map-access', mapSlug: 'arena' },
      dedupeKey: 'setup-map:arena:3:map',
    })
    expect(inputs[1]).toMatchObject({
      event: {
        channel: 'maps',
        type: 'updated',
        revision: 3,
        clientId: 'client-1',
        data: {
          slug: 'arena',
          name: 'Arena',
          folder: 'maps',
          placementCount: 1,
          revision: 3,
          updatedAt: 300,
        },
      },
      access: { kind: 'map-access', mapSlug: 'arena' },
      dedupeKey: 'setup-map:arena:3:summary',
    })
    expect(inputs[0]?.event.data).not.toBe(map)
    expect(inputs[0]?.event).not.toHaveProperty('timestamp')
    expect(inputs[0]?.event).not.toHaveProperty('sequence')
  })

  it('creates canonical sheet-specific then global append inputs with sheet access only', () => {
    const sheet = { slug: 'pika', revision: 5, updatedAt: 200, hp: { current: 10 } }
    const inputs = setupSheetSaveRealtimeAppendInputs({
      kind: 'pokemon',
      slug: 'pika',
      sheet,
      clientId: 'client-1',
    })

    expect(inputs).toEqual([
      {
        event: {
          channel: 'sheet:pokemon:pika',
          type: 'updated',
          clientId: 'client-1',
          data: { kind: 'pokemon', slug: 'pika', sheet },
        },
        access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
        dedupeKey: 'setup-sheet:pokemon:pika:5:specific',
      },
      {
        event: {
          channel: 'sheets',
          type: 'updated',
          clientId: 'client-1',
          data: { kind: 'pokemon', slug: 'pika', sheet },
        },
        access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
        dedupeKey: 'setup-sheet:pokemon:pika:5:global',
      },
    ])
    expect((inputs[0]?.event.data as { sheet: unknown }).sheet).not.toBe(sheet)
  })

  it('validates authoritative map and sheet documents before event creation', () => {
    expect(() => setupMapSaveRealtimeAppendInputs(mapDoc({ slug: 'bad slug' as any }))).toThrow(/map\.slug/)
    expect(() => setupMapSaveRealtimeAppendInputs(mapDoc({ revision: -1 }))).toThrow(/map\.revision/)
    expect(() => setupMapSaveRealtimeAppendInputs(mapDoc({ updatedAt: Number.NaN }))).toThrow(/map\.updatedAt/)
    expect(() => setupMapSaveRealtimeAppendInputs({ ...mapDoc(), bad: undefined } as unknown as TabletopMap)).toThrow(/JSON-serializable/)

    expect(() => setupSheetSaveRealtimeAppendInputs({ kind: 'pokemon', slug: 'pika', sheet: { slug: 'eevee', revision: 1, updatedAt: 10 } })).toThrow(/sheet\.slug/)
    expect(() => setupSheetSaveRealtimeAppendInputs({ kind: 'pokemon', slug: 'pika', sheet: { slug: 'pika', revision: 1.5, updatedAt: 10 } })).toThrow(/revision/)
    expect(() => setupSheetSaveRealtimeAppendInputs({ kind: 'pokemon', slug: 'pika', sheet: { slug: 'pika', revision: 1, updatedAt: 10, bad: undefined } })).toThrow(/JSON-serializable/)
  })

  it('uses deterministic bounded dedupe keys by resource revision and destination', () => {
    expect(setupMapSaveRealtimeDedupeKey({ mapSlug: 'arena', revision: 3, destination: 'map' }))
      .toBe('setup-map:arena:3:map')
    expect(setupMapSaveRealtimeDedupeKey({ mapSlug: 'arena', revision: 3, destination: 'map' }))
      .not.toBe(setupMapSaveRealtimeDedupeKey({ mapSlug: 'arena', revision: 3, destination: 'summary' }))
    expect(setupSheetSaveRealtimeDedupeKey({ kind: 'pokemon', slug: 'pika', revision: 5, destination: 'specific' }))
      .toBe('setup-sheet:pokemon:pika:5:specific')
    expect(setupSheetSaveRealtimeDedupeKey({ kind: 'pokemon', slug: 'pika', revision: 5, destination: 'specific' }))
      .not.toBe(setupSheetSaveRealtimeDedupeKey({ kind: 'pokemon', slug: 'pika', revision: 5, destination: 'global' }))

    const longSlug = 'a'.repeat(400)
    expect(setupMapSaveRealtimeDedupeKey({ mapSlug: longSlug, revision: 1, destination: 'summary' }).length)
      .toBeLessThanOrEqual(MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH)
    expect(setupSheetSaveRealtimeDedupeKey({ kind: 'trainer', slug: longSlug, revision: 1, destination: 'global' }).length)
      .toBeLessThanOrEqual(MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH)
  })
})
