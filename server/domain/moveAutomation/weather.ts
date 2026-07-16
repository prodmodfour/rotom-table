import type { EncounterZoneSource } from '#shared/moveAutomation/encounterZones'
import {
  SUNNY_RAINY_ACCURACY_MOVE_IDS,
  SUNNY_RAINY_HEALING_PROFILES,
  sunnyRainyDamagePolicy,
  type SunnyRainyHealingProfile,
  type SunnyRainyWeatherKind,
} from '#shared/moveAutomation/weather'
import type {
  MapFieldEffects,
  MapWeatherKind,
  TabletopMap,
} from '~/types/map'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { MoveAutomationAccuracyRule } from '~/utils/moveAutomationResolution'
import { isMapWeatherKind } from '~/utils/mapFieldEffectDefinitions'
import { queryBattlefieldZones } from './battlefieldZones'

export type SunnyRainyChargeMove = 'Solar Beam' | 'Solar Blade'

export interface AuthoritativeWeatherInstance {
  readonly kind: MapWeatherKind
  readonly zoneId: string
  readonly source: EncounterZoneSource
}

export type WeatherMechanicsInteraction =
  | 'damage'
  | 'accuracy'
  | 'healing'
  | 'charge'

export type WeatherMechanicsTraceOutcome =
  | 'applied'
  | 'defaulted'
  | 'not-applicable'
  | 'prevented'
  | 'superseded'
  | 'unhandled'

export interface WeatherMechanicsTraceEntry {
  readonly interaction: WeatherMechanicsInteraction
  readonly weatherKind: MapWeatherKind | null
  readonly zoneId: string | null
  readonly outcome: WeatherMechanicsTraceOutcome
  readonly reasonCode: string
  readonly value: number | string | boolean | null
}

export interface SunnyRainyDamageResolution {
  readonly modifiers: readonly MoveDamageModifier[]
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}

export interface SunnyRainyAccuracyResolution {
  readonly rule: MoveAutomationAccuracyRule | null
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}

export interface SunnyRainyHealingResolution {
  readonly handled: boolean
  readonly percent: number | null
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}

export interface SunnyRainyChargeResolution {
  readonly handled: boolean
  readonly setup: 'required' | 'skipped'
  readonly damageBaseOverride: number | null
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}

export interface MoveAutomationWeatherResolver {
  /** Active native-plus-compatibility weather in authoritative map order. */
  active(): readonly AuthoritativeWeatherInstance[]
  /** Replace only the compatibility weather lane with the active mechanics view. */
  projectFieldEffects(base?: MapFieldEffects | null): Required<MapFieldEffects>
  damage(input: {
    readonly moveType: string
    readonly targetImmune?: boolean
  }): SunnyRainyDamageResolution
  accuracy(input: {
    readonly canonicalMoveId: string
  }): SunnyRainyAccuracyResolution
  healing(input: {
    readonly profile: SunnyRainyHealingProfile
  }): SunnyRainyHealingResolution
  charge(input: {
    readonly canonicalMoveId: SunnyRainyChargeMove
  }): SunnyRainyChargeResolution
}

export type WeatherMechanicsErrorCode = 'ambiguous-exclusive-weather'

export class WeatherMechanicsError extends Error {
  readonly code: WeatherMechanicsErrorCode

  constructor(code: WeatherMechanicsErrorCode, message: string) {
    super(message)
    this.name = 'WeatherMechanicsError'
    this.code = code
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const normalizedMoveId = (value: string): string => value.trim().toLowerCase()

const traceEntry = (input: WeatherMechanicsTraceEntry): WeatherMechanicsTraceEntry => (
  deepFreeze({ ...input })
)

const activeWeatherInstances = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): readonly AuthoritativeWeatherInstance[] => {
  const seenKinds = new Set<MapWeatherKind>()
  const result: AuthoritativeWeatherInstance[] = []
  for (const zone of queryBattlefieldZones(
    map,
    { kind: 'battlefield' },
    { kinds: ['weather'] },
  )) {
    if (zone.kind !== 'weather' || !isMapWeatherKind(zone.payload.weatherId)) continue
    // Identical weather does not stack even when malformed legacy input repeats it.
    if (seenKinds.has(zone.payload.weatherId)) continue
    seenKinds.add(zone.payload.weatherId)
    result.push({
      kind: zone.payload.weatherId,
      zoneId: zone.id,
      source: zone.source,
    })
  }
  return deepFreeze(result)
}

const sunnyRainyInstances = (
  active: readonly AuthoritativeWeatherInstance[],
): ReadonlyMap<SunnyRainyWeatherKind, AuthoritativeWeatherInstance> => {
  const result = new Map<SunnyRainyWeatherKind, AuthoritativeWeatherInstance>()
  for (const weather of active) {
    if (weather.kind === 'sunny' || weather.kind === 'rainy') {
      result.set(weather.kind, weather)
    }
  }
  return result
}

const exclusiveSunnyRainy = (
  active: readonly AuthoritativeWeatherInstance[],
  interaction: 'healing' | 'charge',
): AuthoritativeWeatherInstance | null => {
  const relevant = [...sunnyRainyInstances(active).values()]
  if (relevant.length > 1) {
    throw new WeatherMechanicsError(
      'ambiguous-exclusive-weather',
      `Concurrent Sunny and Rainy weather require a reviewed ${interaction} conflict policy.`,
    )
  }
  return relevant[0] ?? null
}

const resolveDamage = (
  active: readonly AuthoritativeWeatherInstance[],
  input: { readonly moveType: string; readonly targetImmune?: boolean },
): SunnyRainyDamageResolution => {
  const modifiers: MoveDamageModifier[] = []
  const trace: WeatherMechanicsTraceEntry[] = []
  for (const weather of sunnyRainyInstances(active).values()) {
    const policy = sunnyRainyDamagePolicy(weather.kind as SunnyRainyWeatherKind, input.moveType)
    if (!policy) {
      trace.push(traceEntry({
        interaction: 'damage',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'not-applicable',
        reasonCode: `weather.${weather.kind}.damage-type-not-applicable`,
        value: null,
      }))
      continue
    }
    if (input.targetImmune === true) {
      trace.push(traceEntry({
        interaction: 'damage',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'prevented',
        reasonCode: 'weather.damage.target-immune',
        value: null,
      }))
      continue
    }
    modifiers.push({
      id: `damage.weather.${weather.kind}.${policy.typeId}`,
      stage: 'pre-type-modifiers',
      priority: 200,
      source: { kind: 'field', id: weather.zoneId },
      stackingGroup: `weather.${weather.kind}.damage-roll`,
      reasonCode: policy.reasonCode,
      operation: 'add',
      value: policy.value,
    })
    trace.push(traceEntry({
      interaction: 'damage',
      weatherKind: weather.kind,
      zoneId: weather.zoneId,
      outcome: 'applied',
      reasonCode: policy.reasonCode,
      value: policy.value,
    }))
  }
  return deepFreeze({ modifiers, trace })
}

const WEATHER_ACCURACY_MOVE_IDS = new Set<string>(SUNNY_RAINY_ACCURACY_MOVE_IDS)

const resolveAccuracy = (
  active: readonly AuthoritativeWeatherInstance[],
  canonicalMoveId: string,
): SunnyRainyAccuracyResolution => {
  if (!WEATHER_ACCURACY_MOVE_IDS.has(normalizedMoveId(canonicalMoveId))) {
    return deepFreeze({ rule: null, trace: [] })
  }
  const relevant = sunnyRainyInstances(active)
  const rain = relevant.get('rainy') ?? null
  const sun = relevant.get('sunny') ?? null
  if (rain) {
    const trace: WeatherMechanicsTraceEntry[] = []
    if (sun) {
      trace.push(traceEntry({
        interaction: 'accuracy',
        weatherKind: 'sunny',
        zoneId: sun.zoneId,
        outcome: 'superseded',
        reasonCode: 'weather.sunny.accuracy-superseded-by-rain',
        value: 11,
      }))
    }
    trace.push(traceEntry({
      interaction: 'accuracy',
      weatherKind: 'rainy',
      zoneId: rain.zoneId,
      outcome: 'applied',
      reasonCode: 'weather.rainy.accuracy-cannot-miss',
      value: true,
    }))
    return deepFreeze({
      rule: {
        kind: 'automatic-hit',
        sourceId: rain.zoneId,
        reasonCode: 'weather.rainy.accuracy-cannot-miss',
      },
      trace,
    })
  }
  if (sun) {
    const reasonCode = 'weather.sunny.accuracy-check-eleven'
    return deepFreeze({
      rule: {
        kind: 'accuracy-check-override',
        accuracyCheck: 11,
        sourceId: sun.zoneId,
        reasonCode,
      },
      trace: [traceEntry({
        interaction: 'accuracy',
        weatherKind: 'sunny',
        zoneId: sun.zoneId,
        outcome: 'applied',
        reasonCode,
        value: 11,
      })],
    })
  }
  return deepFreeze({
    rule: null,
    trace: [traceEntry({
      interaction: 'accuracy',
      weatherKind: null,
      zoneId: null,
      outcome: 'defaulted',
      reasonCode: 'weather.accuracy.default',
      value: null,
    })],
  })
}

const resolveHealing = (
  active: readonly AuthoritativeWeatherInstance[],
  profile: SunnyRainyHealingProfile,
): SunnyRainyHealingResolution => {
  const weather = exclusiveSunnyRainy(active, 'healing')
  const values = SUNNY_RAINY_HEALING_PROFILES[profile]
  if (!weather) {
    if (active.length > 0) {
      return deepFreeze({
        handled: false,
        percent: null,
        trace: [traceEntry({
          interaction: 'healing',
          weatherKind: active[0]!.kind,
          zoneId: active[0]!.zoneId,
          outcome: 'unhandled',
          reasonCode: 'weather.healing.non-sun-rain-deferred',
          value: null,
        })],
      })
    }
    return deepFreeze({
      handled: true,
      percent: values.clear,
      trace: [traceEntry({
        interaction: 'healing',
        weatherKind: null,
        zoneId: null,
        outcome: 'defaulted',
        reasonCode: `weather.clear.${profile}-healing`,
        value: values.clear,
      })],
    })
  }
  const percent = weather.kind === 'sunny' ? values.sunny : values.rainy
  return deepFreeze({
    handled: true,
    percent,
    trace: [traceEntry({
      interaction: 'healing',
      weatherKind: weather.kind,
      zoneId: weather.zoneId,
      outcome: 'applied',
      reasonCode: `weather.${weather.kind}.${profile}-healing`,
      value: percent,
    })],
  })
}

const resolveCharge = (
  active: readonly AuthoritativeWeatherInstance[],
  canonicalMoveId: SunnyRainyChargeMove,
): SunnyRainyChargeResolution => {
  const weather = exclusiveSunnyRainy(active, 'charge')
  if (!weather) {
    if (active.length > 0) {
      return deepFreeze({
        handled: false,
        setup: 'required',
        damageBaseOverride: null,
        trace: [traceEntry({
          interaction: 'charge',
          weatherKind: active[0]!.kind,
          zoneId: active[0]!.zoneId,
          outcome: 'unhandled',
          reasonCode: 'weather.charge.non-sun-rain-deferred',
          value: null,
        })],
      })
    }
    return deepFreeze({
      handled: true,
      setup: 'required',
      damageBaseOverride: null,
      trace: [traceEntry({
        interaction: 'charge',
        weatherKind: null,
        zoneId: null,
        outcome: 'defaulted',
        reasonCode: `weather.clear.${normalizedMoveId(canonicalMoveId).replace(' ', '-')}-setup-required`,
        value: 'required',
      })],
    })
  }
  if (weather.kind === 'sunny') {
    return deepFreeze({
      handled: true,
      setup: 'skipped',
      damageBaseOverride: null,
      trace: [traceEntry({
        interaction: 'charge',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'applied',
        reasonCode: 'weather.sunny.solar-charge-skipped',
        value: 'skipped',
      })],
    })
  }
  return deepFreeze({
    handled: true,
    setup: 'required',
    damageBaseOverride: 6,
    trace: [traceEntry({
      interaction: 'charge',
      weatherKind: weather.kind,
      zoneId: weather.zoneId,
      outcome: 'applied',
      reasonCode: 'weather.rainy.solar-damage-base-six',
      value: 6,
    })],
  })
}

/**
 * Build one immutable query over active typed/legacy Weather. Suppressed native
 * fields shadow their compatibility row but contribute no mechanics.
 */
export const createMoveAutomationWeatherResolver = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): MoveAutomationWeatherResolver => {
  const active = activeWeatherInstances(map)
  return Object.freeze({
    active: () => active,
    projectFieldEffects: (base: MapFieldEffects | null = map.fieldEffects ?? null) => {
      const projected = cloneMapFieldEffects(base)
      projected.weather = active.map(weather => ({
        kind: weather.kind,
        source: weather.zoneId,
      }))
      return deepFreeze(projected)
    },
    damage: (input: {
      readonly moveType: string
      readonly targetImmune?: boolean
    }) => resolveDamage(active, input),
    accuracy: (input: {
      readonly canonicalMoveId: string
    }) => resolveAccuracy(active, input.canonicalMoveId),
    healing: (input: {
      readonly profile: SunnyRainyHealingProfile
    }) => resolveHealing(active, input.profile),
    charge: (input: {
      readonly canonicalMoveId: SunnyRainyChargeMove
    }) => resolveCharge(active, input.canonicalMoveId),
  })
}
