import type { EncounterZoneSource } from '#shared/moveAutomation/encounterZones'
import {
  HAIL_ACCURACY_MOVE_IDS,
  SAND_FORCE_ABILITY_NAME,
  SUNNY_RAINY_ACCURACY_MOVE_IDS,
  WEATHER_HEALING_PROFILES,
  sandForceDamagePolicy,
  sunnyRainyDamagePolicy,
  type SunnyRainyWeatherKind,
  type WeatherHealingProfile,
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
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { queryBattlefieldZones } from './battlefieldZones'
import { registeredAbilityAutomationRuntimeFor } from '../abilityAutomation/registry'
import {
  AA074_HELIOVOLT_SUNNY_CAPABILITY,
  aa074ActiveEncounterEffect,
} from '#shared/abilityAutomation/aa074'

export type WeatherChargeMove = 'Solar Beam' | 'Solar Blade'
/** @deprecated Use WeatherChargeMove. */
export type SunnyRainyChargeMove = WeatherChargeMove

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

export interface WeatherDamageActor {
  readonly placementId: string
  readonly abilityNames?: readonly string[]
}

export interface WeatherDamageResolution {
  readonly modifiers: readonly MoveDamageModifier[]
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}
/** @deprecated Use WeatherDamageResolution. */
export type SunnyRainyDamageResolution = WeatherDamageResolution

export interface WeatherAccuracyResolution {
  readonly rule: MoveAutomationAccuracyRule | null
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}
/** @deprecated Use WeatherAccuracyResolution. */
export type SunnyRainyAccuracyResolution = WeatherAccuracyResolution

export interface WeatherHealingResolution {
  readonly handled: boolean
  readonly percent: number | null
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}
/** @deprecated Use WeatherHealingResolution. */
export type SunnyRainyHealingResolution = WeatherHealingResolution

export interface WeatherChargeResolution {
  readonly handled: boolean
  readonly setup: 'required' | 'skipped'
  readonly damageBaseOverride: number | null
  readonly trace: readonly WeatherMechanicsTraceEntry[]
}
/** @deprecated Use WeatherChargeResolution. */
export type SunnyRainyChargeResolution = WeatherChargeResolution

export interface MoveAutomationWeatherResolver {
  /** Active native-plus-compatibility weather in authoritative map order. */
  active(): readonly AuthoritativeWeatherInstance[]
  /** Replace only the compatibility weather lane with the active mechanics view. */
  projectFieldEffects(base?: MapFieldEffects | null): Required<MapFieldEffects>
  damage(input: {
    readonly moveType: string
    readonly targetImmune?: boolean
    readonly actor?: WeatherDamageActor
  }): WeatherDamageResolution
  accuracy(input: {
    readonly canonicalMoveId: string
  }): WeatherAccuracyResolution
  healing(input: {
    readonly profile: WeatherHealingProfile
  }): WeatherHealingResolution
  charge(input: {
    readonly canonicalMoveId: WeatherChargeMove
  }): WeatherChargeResolution
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

const weatherByKind = (
  active: readonly AuthoritativeWeatherInstance[],
): ReadonlyMap<MapWeatherKind, AuthoritativeWeatherInstance> => new Map(
  active.map(weather => [weather.kind, weather]),
)

const exclusiveWeather = (
  active: readonly AuthoritativeWeatherInstance[],
  interaction: 'healing' | 'charge',
): AuthoritativeWeatherInstance | null => {
  if (active.length > 1) {
    throw new WeatherMechanicsError(
      'ambiguous-exclusive-weather',
      `Concurrent weather effects require a reviewed ${interaction} conflict policy.`,
    )
  }
  return active[0] ?? null
}

const sunnyRainyDamage = (
  weather: AuthoritativeWeatherInstance,
  input: { readonly moveType: string; readonly targetImmune?: boolean },
): {
  readonly modifier: MoveDamageModifier | null
  readonly trace: WeatherMechanicsTraceEntry
} => {
  const policy = sunnyRainyDamagePolicy(weather.kind as SunnyRainyWeatherKind, input.moveType)
  if (!policy) {
    return {
      modifier: null,
      trace: traceEntry({
        interaction: 'damage',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'not-applicable',
        reasonCode: `weather.${weather.kind}.damage-type-not-applicable`,
        value: null,
      }),
    }
  }
  if (input.targetImmune === true) {
    return {
      modifier: null,
      trace: traceEntry({
        interaction: 'damage',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'prevented',
        reasonCode: 'weather.damage.target-immune',
        value: null,
      }),
    }
  }
  return {
    modifier: {
      id: `damage.weather.${weather.kind}.${policy.typeId}`,
      stage: 'pre-type-modifiers',
      priority: 200,
      source: { kind: 'field', id: weather.zoneId },
      stackingGroup: `weather.${weather.kind}.damage-roll`,
      reasonCode: policy.reasonCode,
      operation: 'add',
      value: policy.value,
    },
    trace: traceEntry({
      interaction: 'damage',
      weatherKind: weather.kind,
      zoneId: weather.zoneId,
      outcome: 'applied',
      reasonCode: policy.reasonCode,
      value: policy.value,
    }),
  }
}

const sandForceDamage = (
  weather: AuthoritativeWeatherInstance,
  input: {
    readonly moveType: string
    readonly targetImmune?: boolean
    readonly actor: WeatherDamageActor
  },
): {
  readonly modifier: MoveDamageModifier | null
  readonly trace: WeatherMechanicsTraceEntry
} => {
  const hasSandForce = sheetHasCanonicalAbility(
    input.actor.abilityNames,
    SAND_FORCE_ABILITY_NAME,
  )
  const policy = sandForceDamagePolicy(input.moveType, hasSandForce)
  if (!policy) {
    return {
      modifier: null,
      trace: traceEntry({
        interaction: 'damage',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'not-applicable',
        reasonCode: hasSandForce
          ? 'weather.sandstorm.sand-force-type-not-applicable'
          : 'weather.sandstorm.sand-force-absent',
        value: null,
      }),
    }
  }
  if (input.targetImmune === true) {
    return {
      modifier: null,
      trace: traceEntry({
        interaction: 'damage',
        weatherKind: weather.kind,
        zoneId: weather.zoneId,
        outcome: 'prevented',
        reasonCode: 'weather.damage.target-immune',
        value: null,
      }),
    }
  }
  return {
    modifier: {
      id: 'damage.weather.sandstorm.sand-force',
      stage: 'pre-type-modifiers',
      priority: 210,
      source: {
        kind: 'ability',
        id: `${input.actor.placementId}:${SAND_FORCE_ABILITY_NAME}`,
      },
      stackingGroup: 'ability.sand-force.damage-roll',
      reasonCode: policy.reasonCode,
      operation: 'add',
      value: policy.value,
    },
    trace: traceEntry({
      interaction: 'damage',
      weatherKind: weather.kind,
      zoneId: weather.zoneId,
      outcome: 'applied',
      reasonCode: policy.reasonCode,
      value: policy.value,
    }),
  }
}

const resolveDamage = (
  active: readonly AuthoritativeWeatherInstance[],
  input: {
    readonly moveType: string
    readonly targetImmune?: boolean
    readonly actor?: WeatherDamageActor
  },
): WeatherDamageResolution => {
  const modifiers: MoveDamageModifier[] = []
  const trace: WeatherMechanicsTraceEntry[] = []
  for (const weather of active) {
    const result = weather.kind === 'sunny' || weather.kind === 'rainy'
      ? sunnyRainyDamage(weather, input)
      : weather.kind === 'sandstorm' && input.actor
        ? sandForceDamage(weather, { ...input, actor: input.actor })
        : null
    if (!result) continue
    if (result.modifier) modifiers.push(result.modifier)
    trace.push(result.trace)
  }
  return deepFreeze({ modifiers, trace })
}

const SUNNY_RAINY_ACCURACY_IDS = new Set<string>(SUNNY_RAINY_ACCURACY_MOVE_IDS)
const HAIL_ACCURACY_IDS = new Set<string>(HAIL_ACCURACY_MOVE_IDS)

const defaultAccuracy = (): WeatherAccuracyResolution => deepFreeze({
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

const resolveHailAccuracy = (
  active: readonly AuthoritativeWeatherInstance[],
): WeatherAccuracyResolution => {
  const hail = weatherByKind(active).get('hail') ?? null
  if (!hail) return defaultAccuracy()
  const reasonCode = 'weather.hail.blizzard-cannot-miss'
  return deepFreeze({
    rule: {
      kind: 'automatic-hit',
      sourceId: hail.zoneId,
      reasonCode,
    },
    trace: [traceEntry({
      interaction: 'accuracy',
      weatherKind: 'hail',
      zoneId: hail.zoneId,
      outcome: 'applied',
      reasonCode,
      value: true,
    })],
  })
}

const resolveSunnyRainyAccuracy = (
  active: readonly AuthoritativeWeatherInstance[],
): WeatherAccuracyResolution => {
  const relevant = weatherByKind(active)
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
  return defaultAccuracy()
}

const resolveAccuracy = (
  active: readonly AuthoritativeWeatherInstance[],
  canonicalMoveId: string,
): WeatherAccuracyResolution => {
  const moveId = normalizedMoveId(canonicalMoveId)
  if (HAIL_ACCURACY_IDS.has(moveId)) return resolveHailAccuracy(active)
  if (SUNNY_RAINY_ACCURACY_IDS.has(moveId)) return resolveSunnyRainyAccuracy(active)
  return deepFreeze({ rule: null, trace: [] })
}

const resolveHealing = (
  active: readonly AuthoritativeWeatherInstance[],
  profile: WeatherHealingProfile,
): WeatherHealingResolution => {
  const weather = exclusiveWeather(active, 'healing')
  const values = WEATHER_HEALING_PROFILES[profile]
  if (!weather) {
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
  const percent = values[weather.kind]
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
  canonicalMoveId: WeatherChargeMove,
): WeatherChargeResolution => {
  const weather = exclusiveWeather(active, 'charge')
  if (!weather) {
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
      reasonCode: `weather.${weather.kind}.solar-damage-base-six`,
      value: 6,
    })],
  })
}

const airLockMarkerIsActive = (
  map: Pick<TabletopMap, 'placements' | 'initiative' | 'encounterState'>,
): boolean => {
  if (!registeredAbilityAutomationRuntimeFor('Air Lock')) return false
  const round = map.initiative?.round ?? 0
  return (map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => {
    if (entry.canonicalId !== 'Air Lock'
      || entry.payload.kind !== 'mark'
      || entry.payload.markId !== `aa060.air-lock.active:${round}`
      || !map.placements.some(placement => placement.id === entry.ownerPlacementId)) return false
    const suppressed = (map.encounterState?.effects ?? []).some(effect => (
      effect.kind === 'creature-rule-overlay'
      && effect.payload.domain === 'ability'
      && effect.payload.action === 'suppress'
      && effect.affected.placementIds.includes(entry.ownerPlacementId)
      && (effect.payload.suppressionScope === 'all' || effect.payload.values.includes('Air Lock'))
    ))
    return !suppressed
  })
}

/**
 * Build one immutable query over active typed/legacy Weather. Suppressed native
 * fields shadow their compatibility row but contribute no mechanics.
 */
export const createMoveAutomationWeatherResolver = (
  map: Pick<TabletopMap, 'placements' | 'initiative' | 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
  options: { readonly subjectPlacementId?: string } = {},
): MoveAutomationWeatherResolver => {
  const global = activeWeatherInstances(map)
  const heliovolt = options.subjectPlacementId
    ? (map.encounterState?.effects ?? []).find(effect => (
        effect.kind === 'capability'
        && aa074ActiveEncounterEffect(effect)
        && effect.suppression.sources.length === 0
        && effect.payload.action === 'grant'
        && effect.payload.capabilityId === AA074_HELIOVOLT_SUNNY_CAPABILITY
        && effect.affected.placementIds.includes(options.subjectPlacementId!)
      ))
    : null
  const active: readonly AuthoritativeWeatherInstance[] = heliovolt
    && !global.some(weather => weather.kind === 'sunny')
    ? deepFreeze([...global, {
        kind: 'sunny' as const,
        zoneId: heliovolt.id,
        source: {
          kind: 'operation' as const,
          operationId: heliovolt.source.operationId,
          moveId: heliovolt.source.moveId,
          placementId: heliovolt.source.placementId,
        },
      }])
    : global
  const base = Object.freeze({
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
      readonly actor?: WeatherDamageActor
    }) => resolveDamage(active, input),
    accuracy: (input: {
      readonly canonicalMoveId: string
    }) => resolveAccuracy(active, input.canonicalMoveId),
    healing: (input: {
      readonly profile: WeatherHealingProfile
    }) => resolveHealing(active, input.profile),
    charge: (input: {
      readonly canonicalMoveId: WeatherChargeMove
    }) => resolveCharge(active, input.canonicalMoveId),
  })
  return airLockMarkerIsActive(map)
    ? suppressMoveAutomationWeatherResolver(base, 'ability.air-lock.weather-suppressed')
    : base
}

/** Preserve weather state while a reviewed ability temporarily suppresses all weather mechanics. */
export const suppressMoveAutomationWeatherResolver = (
  _base: MoveAutomationWeatherResolver,
  reasonCode: string,
): MoveAutomationWeatherResolver => {
  const trace = (interaction: WeatherMechanicsInteraction, value: number | string | boolean | null): readonly WeatherMechanicsTraceEntry[] => deepFreeze([{
    interaction, weatherKind: null, zoneId: null, outcome: 'prevented', reasonCode, value,
  }])
  return Object.freeze({
    active: () => Object.freeze([]),
    projectFieldEffects: (fieldEffects?: MapFieldEffects | null) => {
      const projected = cloneMapFieldEffects(fieldEffects)
      projected.weather = []
      return deepFreeze(projected)
    },
    damage: () => deepFreeze({ modifiers: [], trace: trace('damage', 0) }),
    accuracy: () => deepFreeze({ rule: null, trace: trace('accuracy', false) }),
    healing: () => deepFreeze({ handled: false, percent: null, trace: trace('healing', false) }),
    charge: () => deepFreeze({ handled: false, setup: 'required' as const, damageBaseOverride: null, trace: trace('charge', false) }),
  })
}
