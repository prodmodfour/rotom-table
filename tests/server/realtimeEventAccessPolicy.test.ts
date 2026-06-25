import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { RealtimeEventAccess, PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  evaluateRealtimeEventAccess,
  filterRealtimeEventsForPrincipal,
  type RealtimeDeliveryPrincipal,
  type RealtimeEventAccessDependencies,
  type RealtimePlayerSheetAccessKey,
  type RealtimePolicyPersistedSheet,
} from '../../server/realtime/realtimeEventAccessPolicy'

const map = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 1,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  placements: [],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  initiative: { activeId: null, round: 1 },
  ...overrides,
})

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: 'Pikachu',
  level: 5,
  folder: '',
  player: false,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  folder: '',
  player: false,
  ...overrides,
})

const profile = (
  id: string,
  linkedCharacters: PlayerProfile['linkedCharacters'],
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: id.replace('profile_', '') as PlayerProfileDisplayName,
  linkedCharacters,
})

const persistedSheet = (
  kind: SheetKind,
  sheet: CharacterSheet | TrainerSheet,
): RealtimePolicyPersistedSheet => ({
  kind,
  slug: sheet.slug,
  sheet: sheet as unknown as Record<string, unknown>,
  revision: sheet.revision ?? 1,
  updatedAt: 100,
})

const persistedEvent = (
  sequence: number,
  access: RealtimeEventAccess,
  options: { readonly channel?: string; readonly data?: unknown } = {},
): PersistedRealtimeEvent => ({
  sequence,
  access,
  event: {
    channel: options.channel ?? 'events',
    type: 'updated',
    sequence,
    timestamp: sequence * 100,
    ...(options.data === undefined ? {} : { data: options.data }),
  },
})

const gm: RealtimeDeliveryPrincipal = { role: 'gm' }
const player = (overrides: Partial<RealtimeDeliveryPrincipal> = {}): RealtimeDeliveryPrincipal => ({
  role: 'player',
  ...overrides,
})

const dependencies = (input: {
  readonly maps?: readonly TabletopMap[]
  readonly pokemonSheets?: readonly CharacterSheet[]
  readonly trainerSheets?: readonly TrainerSheet[]
  readonly playerVisibleMapKeys?: readonly RealtimePlayerSheetAccessKey[]
} = {}): RealtimeEventAccessDependencies => {
  const maps = new Map((input.maps ?? []).map((item) => [item.slug, item]))
  const sheets = new Map<string, RealtimePolicyPersistedSheet>()

  for (const sheet of input.pokemonSheets ?? []) {
    sheets.set(`pokemon:${sheet.slug}`, persistedSheet('pokemon', sheet))
  }
  for (const sheet of input.trainerSheets ?? []) {
    sheets.set(`trainer:${sheet.slug}`, persistedSheet('trainer', sheet))
  }

  return {
    getMap: vi.fn((slug: string) => maps.get(slug) ?? null),
    getSheet: vi.fn((kind: SheetKind, slug: string) => sheets.get(`${kind}:${slug}`) ?? null),
    listTrainerSheets: vi.fn(() => [...(input.trainerSheets ?? [])]),
    playerVisibleMapSheetAccessKeys: vi.fn(() => new Set(input.playerVisibleMapKeys ?? [])),
  }
}

const evaluate = (
  access: RealtimeEventAccess,
  principal: RealtimeDeliveryPrincipal,
  deps: RealtimeEventAccessDependencies,
) => evaluateRealtimeEventAccess({ access, principal, dependencies: deps })

describe('realtime event map access policy', () => {
  it('allows a GM to receive an existing map-access event', () => {
    const deps = dependencies({ maps: [map({ slug: 'arena', playerVisible: false })] })

    expect(evaluate({ kind: 'map-access', mapSlug: 'arena' }, gm, deps)).toEqual({ allowed: true })
  })

  it('allows a player to receive a visible map event', () => {
    const deps = dependencies({ maps: [map({ slug: 'arena', playerVisible: true })] })

    expect(evaluate({ kind: 'map-access', mapSlug: 'arena' }, player(), deps)).toEqual({ allowed: true })
  })

  it('denies a player hidden map events', () => {
    const deps = dependencies({ maps: [map({ slug: 'hidden', playerVisible: false })] })

    expect(evaluate({ kind: 'map-access', mapSlug: 'hidden' }, player(), deps)).toEqual({
      allowed: false,
      reason: 'map-not-accessible',
    })
  })

  it('denies missing map events', () => {
    expect(evaluate({ kind: 'map-access', mapSlug: 'missing' }, gm, dependencies())).toEqual({
      allowed: false,
      reason: 'map-not-found',
    })
  })

  it('does not let a channel name override the explicit map descriptor', () => {
    const deps = dependencies({
      maps: [map({ slug: 'visible', playerVisible: true }), map({ slug: 'hidden', playerVisible: false })],
    })
    const result = filterRealtimeEventsForPrincipal({
      events: [persistedEvent(1, { kind: 'map-access', mapSlug: 'hidden' }, { channel: 'map:visible' })],
      principal: player(),
      dependencies: deps,
    })

    expect(result.allowed).toEqual([])
    expect(result.denied.map((denied) => denied.decision)).toEqual([{ allowed: false, reason: 'map-not-accessible' }])
  })
})

describe('realtime event sheet access policy', () => {
  it('allows a GM to receive an existing sheet-access event', () => {
    const deps = dependencies({ pokemonSheets: [pokemon({ slug: 'pikachu', player: false })] })

    expect(evaluate({ kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pikachu' }, gm, deps)).toEqual({
      allowed: true,
    })
  })

  it('allows public player-marked sheets for players', () => {
    const deps = dependencies({ pokemonSheets: [pokemon({ slug: 'public-pika', player: true })] })

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'public-pika' },
      player(),
      deps,
    )).toEqual({ allowed: true })
  })

  it('allows selected profile trainer access', () => {
    const deps = dependencies({ trainerSheets: [trainer({ slug: 'ash' })] })
    const ash = profile('profile_ash00000', [{ sheetKind: 'trainer', sheetSlug: 'ash' }])

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'ash' },
      player({ playerProfile: ash }),
      deps,
    )).toEqual({ allowed: true })
  })

  it('allows Pokémon through selected-profile trainer roster linkage', () => {
    const deps = dependencies({
      pokemonSheets: [pokemon({ slug: 'team-pika' })],
      trainerSheets: [trainer({ slug: 'ash', currentTeam: ['team-pika'] })],
    })
    const ash = profile('profile_ash00000', [{ sheetKind: 'trainer', sheetSlug: 'ash' }])

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'team-pika' },
      player({ playerProfile: ash }),
      deps,
    )).toEqual({ allowed: true })
  })

  it('allows session access keys for players', () => {
    const deps = dependencies({ pokemonSheets: [pokemon({ slug: 'session-pika' })] })

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'session-pika' },
      player({ sessionAccess: { sheetKeys: new Set<RealtimePlayerSheetAccessKey>(['pokemon:session-pika']) } }),
      deps,
    )).toEqual({ allowed: true })
  })

  it('allows placement access through any player-visible map', () => {
    const deps = dependencies({
      trainerSheets: [trainer({ slug: 'map-trainer' })],
      playerVisibleMapKeys: ['trainer:map-trainer'],
    })

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'map-trainer' },
      player(),
      deps,
    )).toEqual({ allowed: true })
  })

  it('denies profile A access to profile B-only sheets', () => {
    const deps = dependencies({ trainerSheets: [trainer({ slug: 'misty' })] })
    const ash = profile('profile_ash00000', [{ sheetKind: 'trainer', sheetSlug: 'ash' }])

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
      player({ playerProfile: ash }),
      deps,
    )).toEqual({ allowed: false, reason: 'sheet-not-accessible' })
  })

  it('keeps unprofiled players distinct from selected profile access', () => {
    const deps = dependencies({ trainerSheets: [trainer({ slug: 'ash' })] })

    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'ash' },
      player({ playerProfile: null }),
      deps,
    )).toEqual({ allowed: false, reason: 'sheet-not-accessible' })
  })

  it('denies missing sheet events', () => {
    expect(evaluate(
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'missing' },
      gm,
      dependencies(),
    )).toEqual({ allowed: false, reason: 'sheet-not-found' })
  })

  it('does not trust payload or sheet runtime marker fields to grant access', () => {
    const deps = dependencies({
      pokemonSheets: [pokemon({
        slug: 'marked-only',
        player: false,
        playerProfileAccessible: true,
        sessionPlayerAccessible: true,
      })],
    })
    const result = filterRealtimeEventsForPrincipal({
      events: [persistedEvent(
        1,
        { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'marked-only' },
        {
          channel: 'map:visible',
          data: { player: true, playerProfileAccessible: true, sessionPlayerAccessible: true },
        },
      )],
      principal: player(),
      dependencies: deps,
    })

    expect(result.allowed).toEqual([])
    expect(result.denied[0]?.decision).toEqual({ allowed: false, reason: 'sheet-not-accessible' })
  })
})

describe('realtime event GM-only decisions and batch filtering', () => {
  it('allows GM-only events for GMs and denies them for players', () => {
    const deps = dependencies()

    expect(evaluate({ kind: 'gm-only' }, gm, deps)).toEqual({ allowed: true })
    expect(evaluate({ kind: 'gm-only' }, player(), deps)).toEqual({ allowed: false, reason: 'gm-only' })
  })

  it('preserves global sequence order while denied events do not affect allowed ordering', () => {
    const deps = dependencies({
      maps: [
        map({ slug: 'visible', playerVisible: true }),
        map({ slug: 'hidden', playerVisible: false }),
      ],
      pokemonSheets: [pokemon({ slug: 'public-pika', player: true })],
    })
    const events = [
      persistedEvent(3, { kind: 'map-access', mapSlug: 'visible' }),
      persistedEvent(4, { kind: 'gm-only' }),
      persistedEvent(5, { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'public-pika' }),
      persistedEvent(6, { kind: 'map-access', mapSlug: 'hidden' }),
      persistedEvent(7, { kind: 'map-access', mapSlug: 'visible' }),
    ]

    const result = filterRealtimeEventsForPrincipal({ events, principal: player(), dependencies: deps })

    expect(result.allowed.map((event) => event.sequence)).toEqual([3, 5, 7])
    expect(result.denied.map(({ event, decision }) => [event.sequence, decision.reason])).toEqual([
      [4, 'gm-only'],
      [6, 'map-not-accessible'],
    ])
  })

  it('does not mutate input arrays or event records', () => {
    const deps = dependencies({ maps: [map({ slug: 'visible', playerVisible: true })] })
    const events = [persistedEvent(1, { kind: 'map-access', mapSlug: 'visible' })]
    const before = structuredClone(events)

    const result = filterRealtimeEventsForPrincipal({ events, principal: player(), dependencies: deps })

    expect(events).toEqual(before)
    expect(result.allowed[0]).toBe(events[0])
  })

  it('evaluates current access for each event without stale cross-request cache', () => {
    let visible = true
    const deps: RealtimeEventAccessDependencies = {
      ...dependencies(),
      getMap: vi.fn((slug: string) => slug === 'arena' ? map({ slug: 'arena', playerVisible: visible }) : null),
    }

    expect(evaluate({ kind: 'map-access', mapSlug: 'arena' }, player(), deps)).toEqual({ allowed: true })
    visible = false
    expect(evaluate({ kind: 'map-access', mapSlug: 'arena' }, player(), deps)).toEqual({
      allowed: false,
      reason: 'map-not-accessible',
    })
  })
})

describe('realtime event access architecture boundaries', () => {
  it('keeps the policy free of H3, SSE, and client imports', () => {
    const source = readFileSync('server/realtime/realtimeEventAccessPolicy.ts', 'utf8')

    expect(source).not.toMatch(/from ['"]h3['"]|H3Event/)
    expect(source).not.toMatch(/sseStream|publishRealtime|subscribeRealtime|server\/utils\/realtime/)
    expect(source).not.toMatch(/src\/composables|useRealtime|from ['"]vue['"]|EventSource/)
  })

  it('keeps authorised replay delivery on the server side of the SSE boundary', () => {
    expect(readFileSync('server/api/events.get.ts', 'utf8')).toMatch(/resolveH3RealtimeConnectionContext|openRealtimeSseStream/)
    expect(readFileSync('server/realtime/realtimeSseDelivery.ts', 'utf8')).toMatch(/reconcile-required|evaluateRealtimeEventAccess/)

    const clientSource = readFileSync('src/composables/useRealtime.ts', 'utf8')
    expect(clientSource).not.toMatch(/realtimeEventAccessPolicy|RealtimeEventAccess/)
  })
})
