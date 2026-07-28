import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
} from '#shared/livePlayMoveResolution'
import { REMAINING_ABILITY_TEST_REGISTRY } from '../fixtures/abilityAutomation/remainingRegistry'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveHealEffectOperation } from '#shared/moveAutomation/effects'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  planInitiativeLifecycle,
} from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'
import {
  resolveWeatherResidualImmunity,
} from '~~/server/domain/moveAutomation/weatherLifecycle'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'

interface TokenFixture {
  readonly id: string
  readonly slug: string
  readonly x: number
  readonly sideId?: string
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly currentHp?: number
}

const sheet = (fixture: TokenFixture): CharacterSheet => ({
  slug: fixture.slug,
  nickname: fixture.slug,
  species: 'Pikachu',
  level: 20,
  revision: 3,
  movelist: [{ name: 'Tackle' }],
  ...(fixture.types ? { types: [...fixture.types] } : {}),
  ...(fixture.abilities
    ? { abilities: fixture.abilities.map(name => ({ name })) }
    : {}),
  combat: {
    currentHp: fixture.currentHp ?? 40,
    injuries: 0,
    conditions: [],
  },
})

const placement = (fixture: TokenFixture): SheetPlacement => ({
  id: fixture.id,
  sheetKind: 'pokemon',
  sheetSlug: fixture.slug,
  position: { x: fixture.x, y: 0, z: 1 },
  initiative: 10 - fixture.x,
  ...(fixture.sideId ? { sideId: fixture.sideId } : {}),
})

const mapFixture = (
  fixtures: readonly TokenFixture[],
  weather: 'hail' | 'sandstorm' = 'hail',
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'weather-lifecycle-arena',
  name: 'Weather Lifecycle Arena',
  revision: 7,
  dimensions: { x: 12, y: 3, z: 6 },
  groundLevelY: 0,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: [{ kind: weather, rounds: 1 }],
    terrains: [],
    rooms: [],
  },
  placements: fixtures.map(placement),
  initiative: {
    activeId: fixtures.at(-1)?.id ?? null,
    round: 1,
  },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      allies: { id: 'allies', label: 'Allies', status: 'active' },
      enemies: { id: 'enemies', label: 'Enemies', status: 'active' },
    },
  },
})

const rulesContext = (
  fixtures: readonly TokenFixture[],
  weather: 'hail' | 'sandstorm' = 'hail',
) => {
  const map = mapFixture(fixtures, weather)
  const sheets = new Map(fixtures.map(fixture => [fixture.slug, sheet(fixture)]))
  return buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: fixtures[0]!.id,
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: fixtures[0]!.id },
    },
    candidatePlacementIds: fixtures.map(fixture => fixture.id),
    selectedPlacementIds: fixtures.map(fixture => fixture.id),
    abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    random: createFiniteAuthoritativeMoveRandomStream([]),
    time: 2_000,
  })
}

const recipient = (
  context: ReturnType<typeof rulesContext>,
  placementId: string,
) => {
  const targetPlacement = context.queries.placements.get(placementId)!
  return {
    placement: targetPlacement,
    token: context.queries.tokens.get(placementId)!,
    sheet: context.queries.sheets.forPlacement(targetPlacement)!,
  }
}

const roundEndHealHandler = (): EncounterLifecycleTriggerHandler => ({
  id: 'handler.weather-order-test',
  resolve: ({ event }) => {
    if (event.kind !== 'round-end') return []
    const operation: MoveHealEffectOperation = {
      id: 'operation.weather-order-test.heal',
      kind: 'heal',
      source: { kind: 'lifecycle-event', id: event.eventId },
      recipients: { kind: 'area-targets' },
      phase: 'cleanup',
      reasonCode: 'weather.order-test-heal',
      payload: {
        mode: 'gain',
        pool: 'hit-points',
        calculation: { kind: 'fixed', value: 5 },
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    }
    return [{
      effectId: null,
      reasonCode: 'weather.order-test-heal-trigger',
      operations: [operation],
      emittedEvents: [],
    }]
  },
})

describe('Hail and Sandstorm lifecycle mechanics', () => {
  it.each([
    ['hail', ['Ice'], 'Ice type'],
    ['sandstorm', ['Ground'], 'Ground type'],
    ['sandstorm', ['Rock'], 'Rock type'],
    ['sandstorm', ['Steel'], 'Steel type'],
  ] as const)('grants %s residual immunity to canonical types', (weather, types, source) => {
    const fixtures = [{ id: 'target', slug: 'target', x: 1, types }]
    const context = rulesContext(fixtures, weather)

    expect(resolveWeatherResidualImmunity({
      weatherKind: weather,
      context,
      recipient: recipient(context, 'target'),
    })).toEqual({ blockedBy: source, consultedPlacementIds: [] })
  })

  it.each([
    ['hail', 'Magic Guard'],
    ['hail', 'Overcoat'],
    ['hail', 'Permafrost'],
    ['hail', 'Ice Face'],
    ['hail', 'Snow Cloak'],
    ['hail', 'Snow Warning'],
    ['sandstorm', 'Magic Guard'],
    ['sandstorm', 'Overcoat'],
    ['sandstorm', 'Permafrost'],
    ['sandstorm', 'Desert Weather'],
    ['sandstorm', 'Sand Veil'],
  ] as const)('grants %s residual immunity from %s', (weather, ability) => {
    const fixtures = [{
      id: 'target',
      slug: 'target',
      x: 1,
      abilities: [ability],
    }]
    const context = rulesContext(fixtures, weather)

    expect(resolveWeatherResidualImmunity({
      weatherKind: weather,
      context,
      recipient: recipient(context, 'target'),
    })).toEqual({ blockedBy: ability, consultedPlacementIds: [] })
  })

  it('uses explicit side and adjacency for Snow Cloak and Sand Veil ally immunity', () => {
    const hailFixtures = [
      { id: 'target', slug: 'target', x: 2, sideId: 'allies' },
      {
        id: 'provider',
        slug: 'provider',
        x: 1,
        sideId: 'allies',
        abilities: ['Snow Cloak'],
      },
      {
        id: 'enemy-provider',
        slug: 'enemy-provider',
        x: 3,
        sideId: 'enemies',
        abilities: ['Snow Cloak'],
      },
    ]
    const hailContext = rulesContext(hailFixtures, 'hail')
    expect(resolveWeatherResidualImmunity({
      weatherKind: 'hail',
      context: hailContext,
      recipient: recipient(hailContext, 'target'),
    })).toEqual({
      blockedBy: 'Snow Cloak (provider)',
      consultedPlacementIds: ['provider'],
    })

    const farSandFixtures = [
      { id: 'target', slug: 'target', x: 1, sideId: 'allies' },
      {
        id: 'far-provider',
        slug: 'far-provider',
        x: 6,
        sideId: 'allies',
        abilities: ['Sand Veil'],
      },
    ]
    const sandContext = rulesContext(farSandFixtures, 'sandstorm')
    expect(resolveWeatherResidualImmunity({
      weatherKind: 'sandstorm',
      context: sandContext,
      recipient: recipient(sandContext, 'target'),
    })).toEqual({
      blockedBy: null,
      consultedPlacementIds: [],
    })
  })

  it('orders other round-end effects before residuals and duration expiry in one plan', () => {
    const initialFixture: TokenFixture = {
      id: 'target',
      slug: 'target',
      x: 1,
    }
    const initialSheet = sheet(initialFixture)
    const fullMaxHp = pokemonHpSnapshot(initialSheet).fullMaxHp
    const fixture = { ...initialFixture, currentHp: fullMaxHp - 2 }
    const map = mapFixture([fixture], 'hail')
    const storedSheet = sheet(fixture)
    const originalMap = structuredClone(map)
    const originalSheet = structuredClone(storedSheet)

    const plan = planInitiativeLifecycle({
      map,
      previous: { activeId: 'target', round: 1 },
      current: { activeId: 'target', round: 2 },
      orderIds: ['target'],
      operationId: 'op_weather_order',
      time: 2_000,
      loadSheets: () => ({
        pokemonSheets: new Map([['target', storedSheet]]),
        trainerSheets: new Map<string, TrainerSheet>(),
      }),
      handlers: [roundEndHealHandler()],
    })

    expect(plan.reduction.operations.map(operation => operation.id)).toEqual([
      'operation.weather-order-test.heal',
      expect.stringMatching(/^weather\.residual\.hail\.[0-9a-f]{32}$/),
    ])
    const roundEndTrace = plan.reduction.trace.filter(entry => (
      entry.eventId.includes('round-end')
    ))
    expect(roundEndTrace.map(entry => entry.kind)).toEqual([
      'event',
      'trigger',
      'operation-enqueued',
      'trigger',
      'operation-enqueued',
      'field-transition',
    ])
    expect(plan.reduction.fieldTransitions).toEqual([
      expect.objectContaining({
        transition: expect.objectContaining({
          zoneId: 'legacy.weather.hail',
          kind: 'expired',
        }),
      }),
    ])
    expect(plan.currentFieldEffects.weather).toEqual([])
    expect(plan.currentEncounterState.zones).toEqual([])
    expect(plan.sheetWrites).toHaveLength(1)
    expect(((plan.sheetWrites[0]!.nextSheet as CharacterSheet).combat as {
      currentHp: number
    }).currentHp).toBe(fullMaxHp - Math.floor(fullMaxHp * 0.1))
    expect(plan.sheetReads).toEqual([{ kind: 'pokemon', slug: 'target', revision: 3 }])
    expect(map).toEqual(originalMap)
    expect(storedSheet).toEqual(originalSheet)
  })
})
