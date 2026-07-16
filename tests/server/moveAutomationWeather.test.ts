import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseEncounterZone,
  type EncounterGlobalFieldZone,
} from '#shared/moveAutomation/encounterZones'
import { WEATHER_HEALING_PROFILES } from '#shared/moveAutomation/weather'
import type { MapWeatherKind, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { resolveMoveAutomationAccuracyRoll } from '~/utils/moveAutomationResolution'
import {
  createEncounterGlobalFieldZone,
} from '~~/server/domain/moveAutomation/fieldLifecycle'
import {
  WeatherMechanicsError,
  createMoveAutomationWeatherResolver,
} from '~~/server/domain/moveAutomation/weather'

const mapFixture = (
  weather: readonly MapWeatherKind[] = [],
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'weather-mechanics-arena',
  name: 'Weather Mechanics Arena',
  revision: 7,
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: weather.map(kind => ({ kind })),
    terrains: [],
    rooms: [],
  },
  placements: [],
  encounterState: createEmptyEncounterState(),
})

const source = (operationId: string) => ({
  kind: 'operation' as const,
  operationId,
  moveId: `move.${operationId}`,
  placementId: 'weather-user',
})

const globalField = (
  kind: 'weather' | 'room',
  fieldId: string,
  operationId: string,
): EncounterGlobalFieldZone => createEncounterGlobalFieldZone({
  kind,
  fieldId,
  source: source(operationId),
  sideId: null,
  duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
  replacementGroup: kind === 'weather' ? 'field.weather' : `field.room.${fieldId}`,
})

const accuracyScript = (moveName: 'Thunder' | 'Hurricane' | 'Blizzard'): MoveAutomationScript => ({
  kind: 'explicit',
  moveName,
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 11,
  damageClass: 'Special',
  type: moveName === 'Thunder' ? 'Electric' : moveName === 'Blizzard' ? 'Ice' : 'Flying',
  ac: 7,
  range: '12, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

describe('authoritative weather mechanics', () => {
  it('queries active typed weather and fails suppressed native weather closed', () => {
    const suppressor = globalField('room', 'magic', 'magic-room')
    const sunnyBase = globalField('weather', 'sunny', 'sunny-day')
    const sunny = parseEncounterZone({
      ...sunnyBase,
      fieldPolicy: {
        ...sunnyBase.fieldPolicy,
        suppression: {
          sources: [{
            zoneId: suppressor.id,
            reasonCode: 'field.weather.suppressed',
          }],
        },
      },
    })
    const map = mapFixture(['sunny'])
    map.encounterState = {
      ...createEmptyEncounterState(),
      zones: [sunny, suppressor],
    }

    const resolver = createMoveAutomationWeatherResolver(map)

    // The native identity shadows the legacy sunny row, then suppression keeps
    // it out of calculations while retaining it durably in encounter state.
    expect(resolver.active()).toEqual([])
    expect(resolver.projectFieldEffects().weather).toEqual([])
    expect(resolver.damage({ moveType: 'Fire' })).toEqual({ modifiers: [], trace: [] })
    expect(Object.isFrozen(resolver.active())).toBe(true)
  })

  it.each([
    ['sunny', 'Fire', 5, 'weather.sunny.fire-damage-bonus'],
    ['sunny', 'Water', -5, 'weather.sunny.water-damage-penalty'],
    ['rainy', 'Water', 5, 'weather.rainy.water-damage-bonus'],
    ['rainy', 'Fire', -5, 'weather.rainy.fire-damage-penalty'],
  ] as const)(
    'emits the %s %s damage modifier with exact trace attribution',
    (weather, moveType, value, reasonCode) => {
      const resolution = createMoveAutomationWeatherResolver(mapFixture([weather]))
        .damage({ moveType })

      expect(resolution.modifiers).toEqual([
        expect.objectContaining({
          stage: 'pre-type-modifiers',
          source: {
            kind: 'field',
            id: expect.stringMatching(/^legacy\./),
          },
          reasonCode,
          operation: 'add',
          value,
        }),
      ])
      expect(resolution.trace).toEqual([
        expect.objectContaining({
          interaction: 'damage',
          weatherKind: weather,
          outcome: 'applied',
          reasonCode,
          value,
        }),
      ])
      expect(Object.isFrozen(resolution)).toBe(true)
      expect(Object.isFrozen(resolution.modifiers[0]?.source)).toBe(true)
    },
  )

  it('does not create weather damage for unrelated types or immune targets', () => {
    const resolver = createMoveAutomationWeatherResolver(mapFixture(['sunny']))

    expect(resolver.damage({ moveType: 'Grass' })).toMatchObject({
      modifiers: [],
      trace: [{
        interaction: 'damage',
        weatherKind: 'sunny',
        outcome: 'not-applicable',
        reasonCode: 'weather.sunny.damage-type-not-applicable',
      }],
    })
    expect(resolver.damage({ moveType: 'Fire', targetImmune: true })).toMatchObject({
      modifiers: [],
      trace: [{
        interaction: 'damage',
        weatherKind: 'sunny',
        outcome: 'prevented',
        reasonCode: 'weather.damage.target-immune',
      }],
    })
  })

  it('adds Sand Force damage once with authoritative ability and field attribution', () => {
    const resolver = createMoveAutomationWeatherResolver(mapFixture(['sandstorm']))
    const actor = { placementId: 'sand-user', abilityNames: ['Sand Force'] }

    expect(resolver.damage({ moveType: 'Ground', actor })).toEqual({
      modifiers: [expect.objectContaining({
        id: 'damage.weather.sandstorm.sand-force',
        stage: 'pre-type-modifiers',
        source: { kind: 'ability', id: 'sand-user:Sand Force' },
        stackingGroup: 'ability.sand-force.damage-roll',
        reasonCode: 'weather.sandstorm.sand-force-damage-bonus',
        value: 5,
      })],
      trace: [expect.objectContaining({
        interaction: 'damage',
        weatherKind: 'sandstorm',
        outcome: 'applied',
        reasonCode: 'weather.sandstorm.sand-force-damage-bonus',
        value: 5,
      })],
    })
    expect(resolver.damage({ moveType: 'Water', actor })).toMatchObject({
      modifiers: [],
      trace: [{ outcome: 'not-applicable', value: null }],
    })
    expect(resolver.damage({ moveType: 'Rock' })).toEqual({ modifiers: [], trace: [] })
  })

  it('applies Sunny AC 11 and Rainy cannot-miss without accepting a roll from the client', () => {
    const sun = createMoveAutomationWeatherResolver(mapFixture(['sunny']))
      .accuracy({ canonicalMoveId: 'Thunder' })
    const rain = createMoveAutomationWeatherResolver(mapFixture(['rainy']))
      .accuracy({ canonicalMoveId: 'Hurricane' })

    expect(sun).toMatchObject({
      rule: {
        kind: 'accuracy-check-override',
        accuracyCheck: 11,
        reasonCode: 'weather.sunny.accuracy-check-eleven',
      },
      trace: [{ outcome: 'applied', value: 11 }],
    })
    expect(resolveMoveAutomationAccuracyRoll(
      accuracyScript('Thunder'),
      10,
      { userAccuracy: 0, targetEvasion: 0, accuracyRule: sun.rule },
    )).toMatchObject({ hit: false, accuracyCheck: 11 })
    expect(resolveMoveAutomationAccuracyRoll(
      accuracyScript('Thunder'),
      11,
      { userAccuracy: 0, targetEvasion: 0, accuracyRule: sun.rule },
    )).toMatchObject({ hit: true, accuracyCheck: 11 })

    expect(rain).toMatchObject({
      rule: {
        kind: 'automatic-hit',
        reasonCode: 'weather.rainy.accuracy-cannot-miss',
      },
      trace: [{ outcome: 'applied', value: true }],
    })
    expect(resolveMoveAutomationAccuracyRoll(
      accuracyScript('Hurricane'),
      1,
      { userAccuracy: -6, targetEvasion: 6, accuracyRule: rain.rule },
    )).toMatchObject({
      hit: true,
      accuracyCheck: null,
      naturalRoll: 1,
      accuracyRule: { reasonCode: 'weather.rainy.accuracy-cannot-miss' },
    })
  })

  it('makes Blizzard an authoritative automatic hit only during Hail', () => {
    const hail = createMoveAutomationWeatherResolver(mapFixture(['hail']))
      .accuracy({ canonicalMoveId: 'Blizzard' })
    const clear = createMoveAutomationWeatherResolver(mapFixture())
      .accuracy({ canonicalMoveId: 'Blizzard' })

    expect(hail).toMatchObject({
      rule: {
        kind: 'automatic-hit',
        reasonCode: 'weather.hail.blizzard-cannot-miss',
      },
      trace: [{ weatherKind: 'hail', outcome: 'applied', value: true }],
    })
    expect(resolveMoveAutomationAccuracyRoll(
      accuracyScript('Blizzard'),
      1,
      { userAccuracy: -6, targetEvasion: 6, accuracyRule: hail.rule },
    )).toMatchObject({ hit: true, accuracyCheck: null })
    expect(clear).toMatchObject({
      rule: null,
      trace: [{ outcome: 'defaulted', reasonCode: 'weather.accuracy.default' }],
    })
  })

  it('gives Rainy automatic accuracy deterministic precedence when both weathers coexist', () => {
    const resolution = createMoveAutomationWeatherResolver(mapFixture(['sunny', 'rainy']))
      .accuracy({ canonicalMoveId: 'Thunder' })

    expect(resolution.rule).toMatchObject({ kind: 'automatic-hit' })
    expect(resolution.trace.map(entry => [entry.weatherKind, entry.outcome, entry.reasonCode]))
      .toEqual([
        ['sunny', 'superseded', 'weather.sunny.accuracy-superseded-by-rain'],
        ['rainy', 'applied', 'weather.rainy.accuracy-cannot-miss'],
      ])
  })

  it.each([
    [null, 'solar-restoration', 50, 'defaulted'],
    ['sunny', 'solar-restoration', 200 / 3, 'applied'],
    ['rainy', 'solar-restoration', 25, 'applied'],
    ['hail', 'solar-restoration', 25, 'applied'],
    ['sandstorm', 'solar-restoration', 25, 'applied'],
    [null, 'shore-up', 50, 'defaulted'],
    ['sunny', 'shore-up', 25, 'applied'],
    ['rainy', 'shore-up', 25, 'applied'],
    ['hail', 'shore-up', 25, 'applied'],
    ['sandstorm', 'shore-up', 200 / 3, 'applied'],
  ] as const)(
    'resolves %s weather for the %s healing profile',
    (weather, profile, percent, outcome) => {
      const resolution = createMoveAutomationWeatherResolver(
        mapFixture(weather ? [weather] : []),
      ).healing({ profile })

      expect(resolution).toMatchObject({ handled: true, percent })
      expect(resolution.trace[0]).toMatchObject({
        interaction: 'healing',
        weatherKind: weather,
        outcome,
        value: percent,
      })
    },
  )

  it.each([
    [null, 'required', null, 'defaulted'],
    ['sunny', 'skipped', null, 'applied'],
    ['rainy', 'required', 6, 'applied'],
    ['hail', 'required', 6, 'applied'],
    ['sandstorm', 'required', 6, 'applied'],
  ] as const)(
    'resolves Solar charge behavior under %s weather',
    (weather, setup, damageBaseOverride, outcome) => {
      const resolution = createMoveAutomationWeatherResolver(
        mapFixture(weather ? [weather] : []),
      ).charge({ canonicalMoveId: 'Solar Beam' })

      expect(resolution).toMatchObject({
        handled: true,
        setup,
        damageBaseOverride,
      })
      expect(resolution.trace[0]).toMatchObject({
        interaction: 'charge',
        weatherKind: weather,
        outcome,
      })
    },
  )

  it('fails exclusive healing and charge rules closed under concurrent weather', () => {
    const resolver = createMoveAutomationWeatherResolver(mapFixture(['hail', 'sandstorm']))

    expect(() => resolver.healing({ profile: 'shore-up' }))
      .toThrowError(expect.objectContaining({
        name: WeatherMechanicsError.name,
        code: 'ambiguous-exclusive-weather',
      }))
    expect(() => resolver.charge({ canonicalMoveId: 'Solar Blade' }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-exclusive-weather' }))
    expect(WEATHER_HEALING_PROFILES['solar-restoration']).toEqual({
      clear: 50,
      sunny: 200 / 3,
      rainy: 25,
      hail: 25,
      sandstorm: 25,
    })
    expect(WEATHER_HEALING_PROFILES['shore-up'].sandstorm).toBe(200 / 3)
  })
})
