import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { RealtimeEventAccess, PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  parsePendingMoveResolution,
  type PendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { TabletopMap } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  evaluateRealtimeEventAccess,
  filterRealtimeEventsForPrincipal,
  type RealtimeDeliveryPrincipal,
  type RealtimeEventAccessDependencies,
  type RealtimePlayerSheetAccessKey,
  type RealtimePolicyPersistedSheet,
} from '../../server/realtime/realtimeEventAccessPolicy'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'
import { projectAbilityAutomationJsonForPlayer } from '../../server/domain/abilityAutomation/realtimeProjection'

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

const shop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 1,
  updatedAt: 100,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [],
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
  readonly groupInventorySlugs?: readonly string[]
  readonly shops?: readonly ShopTableDocument[]
  readonly pendingResolutions?: readonly PendingMoveResolution[]
  readonly playerVisibleMapKeys?: readonly RealtimePlayerSheetAccessKey[]
} = {}): RealtimeEventAccessDependencies => {
  const maps = new Map((input.maps ?? []).map((item) => [item.slug, item]))
  const groupInventories = new Set(input.groupInventorySlugs ?? [])
  const shops = new Map((input.shops ?? []).map((item) => [item.slug, item]))
  const pendingResolutions = new Map(
    (input.pendingResolutions ?? []).map((item) => [item.resolutionId, item]),
  )
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
    getGroupInventory: vi.fn((slug: string) => (groupInventories.has(slug) ? { slug } : null)),
    getShop: vi.fn((slug: string) => shops.get(slug) ?? null),
    getPendingMoveResolution: vi.fn((resolutionId: string) => (
      pendingResolutions.get(resolutionId) ?? null
    )),
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

  it('projects Ability authority out of player map events without changing the GM record', () => {
    const privateEffect = parseEncounterEffect({
      id: 'ability.private.target-gate',
      kind: 'capability',
      source: { operationId: 'intent.private', moveId: 'ability.intimidate', placementId: 'actor' },
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'target-gate'],
      payload: { capabilityId: 'private.gate', action: 'grant' },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'retain',
      suppression: { sources: [] },
    })
    const privateMap = map({
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [privateEffect],
        abilityUsage: { schemaVersion: 1, sceneId: 'scene.private', entries: [] },
      },
    })
    const deps = dependencies({ maps: [privateMap] })
    const event = persistedEvent(1, { kind: 'map-access', mapSlug: 'arena' }, { data: privateMap })
    const playerResult = filterRealtimeEventsForPrincipal({
      events: [event], principal: player(), dependencies: deps,
    })
    const gmResult = filterRealtimeEventsForPrincipal({
      events: [event], principal: gm, dependencies: deps,
    })

    expect(JSON.stringify(playerResult.allowed[0])).not.toContain('ability.intimidate')
    expect(JSON.stringify(playerResult.allowed[0])).not.toContain('intent.private')
    expect((playerResult.allowed[0]?.event.data as TabletopMap).encounterState?.abilityUsage)
      .toEqual({ schemaVersion: 1, sceneId: null, entries: [] })
    expect(JSON.stringify(gmResult.allowed[0])).toContain('ability.intimidate')
    expect(gmResult.allowed[0]).toBe(event)
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

  it('redacts map-only sheet Ability identities but retains a source controller projection', () => {
    const visible = pokemon({
      slug: 'visible-pika',
      abilities: [{ name: 'Sturdy', frequency: 'Static', effect: 'Private.' }],
    })
    const deps = dependencies({
      pokemonSheets: [visible],
      playerVisibleMapKeys: ['pokemon:visible-pika'],
    })
    const event = persistedEvent(
      1,
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'visible-pika' },
      { data: { kind: 'pokemon', slug: 'visible-pika', sheet: visible } },
    )
    const participant = filterRealtimeEventsForPrincipal({
      events: [event], principal: player(), dependencies: deps,
    })
    const owner = filterRealtimeEventsForPrincipal({
      events: [event],
      principal: player({
        playerProfile: profile('profile_owner000', [
          { sheetKind: 'pokemon', sheetSlug: 'visible-pika' },
        ]),
      }),
      dependencies: deps,
    })

    expect(JSON.stringify(participant.allowed[0])).not.toContain('Sturdy')
    expect(JSON.stringify(owner.allowed[0])).toContain('Sturdy')
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

describe('realtime event group inventory access policy', () => {
  it('allows GMs and players to receive existing shared group inventory updates', () => {
    const deps = dependencies({ groupInventorySlugs: ['main'] })

    expect(evaluate({ kind: 'group-inventory-access', groupSlug: 'main' }, gm, deps)).toEqual({ allowed: true })
    expect(evaluate({ kind: 'group-inventory-access', groupSlug: 'main' }, player(), deps)).toEqual({ allowed: true })
  })

  it('denies missing group inventory update records', () => {
    expect(evaluate({ kind: 'group-inventory-access', groupSlug: 'missing' }, gm, dependencies())).toEqual({
      allowed: false,
      reason: 'group-inventory-not-found',
    })
  })
})

describe('realtime event shop access policy', () => {
  it('allows GMs to receive hidden or closed shop updates', () => {
    const deps = dependencies({ shops: [shop({ slug: 'back-room', playerVisible: false, open: false })] })

    expect(evaluate({ kind: 'shop-access', shopSlug: 'back-room' }, gm, deps)).toEqual({ allowed: true })
  })

  it('allows players to receive only open player-visible shop updates', () => {
    const deps = dependencies({ shops: [
      shop({ slug: 'open-visible', playerVisible: true, open: true }),
      shop({ slug: 'hidden', playerVisible: false, open: true }),
      shop({ slug: 'closed', playerVisible: true, open: false }),
    ] })

    expect(evaluate({ kind: 'shop-access', shopSlug: 'open-visible' }, player(), deps)).toEqual({ allowed: true })
    expect(evaluate({ kind: 'shop-access', shopSlug: 'hidden' }, player(), deps)).toEqual({
      allowed: false,
      reason: 'shop-not-accessible',
    })
    expect(evaluate({ kind: 'shop-access', shopSlug: 'closed' }, player(), deps)).toEqual({
      allowed: false,
      reason: 'shop-not-accessible',
    })
  })

  it('denies missing shop update records', () => {
    expect(evaluate({ kind: 'shop-access', shopSlug: 'missing' }, gm, dependencies())).toEqual({
      allowed: false,
      reason: 'shop-not-found',
    })
  })
})

describe('realtime pending move response access policy', () => {
  const targetOwnedResolution = (): PendingMoveResolution => {
    const source = createPendingMoveResolutionFixture()
    return parsePendingMoveResolution({
      ...source,
      outstandingWindows: source.outstandingWindows.map(window => ({
        ...window,
        ownership: [{ kind: 'target', id: 'target-token' }],
      })),
    })
  }

  const pendingAccess = (): Extract<RealtimeEventAccess, {
    readonly kind: 'pending-move-response-access'
  }> => ({
    kind: 'pending-move-response-access',
    mapSlug: 'pending-arena',
    resolutionId: 'resolution-pending-1',
    windowId: 'window.branch',
  })

  it('delivers private option events only to the target controller or a GM', () => {
    const resolution = targetOwnedResolution()
    const pendingMap = map({
      slug: 'pending-arena',
      placements: [
        {
          id: 'actor-token',
          sheetKind: 'pokemon',
          sheetSlug: 'actor',
          position: { x: 0, y: 0, z: 0 },
        },
        {
          id: 'target-token',
          sheetKind: 'pokemon',
          sheetSlug: 'target',
          position: { x: 1, y: 0, z: 0 },
        },
      ],
    })
    const deps = dependencies({ maps: [pendingMap], pendingResolutions: [resolution] })
    const targetProfile = profile('profile_target01', [
      { sheetKind: 'pokemon', sheetSlug: 'target' },
    ])
    const actorProfile = profile('profile_actor001', [
      { sheetKind: 'pokemon', sheetSlug: 'actor' },
    ])

    expect(evaluate(pendingAccess(), player({ playerProfile: targetProfile }), deps)).toEqual({
      allowed: true,
    })
    expect(evaluate(pendingAccess(), player({ playerProfile: actorProfile }), deps)).toEqual({
      allowed: false,
      reason: 'pending-move-response-not-accessible',
    })
    expect(evaluate(pendingAccess(), gm, deps)).toEqual({ allowed: true })
  })

  it('fails closed for forged, missing, or cross-map pending window descriptors', () => {
    const resolution = targetOwnedResolution()
    const deps = dependencies({
      maps: [map({ slug: 'pending-arena' })],
      pendingResolutions: [resolution],
    })

    expect(evaluate({ ...pendingAccess(), windowId: 'window.forged' }, gm, deps)).toEqual({
      allowed: false,
      reason: 'pending-move-response-not-accessible',
    })
    expect(evaluate({ ...pendingAccess(), resolutionId: 'resolution-missing' }, gm, deps)).toEqual({
      allowed: false,
      reason: 'pending-move-response-not-accessible',
    })
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
  it('does not transform binary/static response bodies', () => {
    const body = Buffer.from('const answer = 42')
    expect(projectAbilityAutomationJsonForPlayer(body)).toBe(body)
  })

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
