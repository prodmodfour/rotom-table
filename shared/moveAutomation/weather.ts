export const SUNNY_RAINY_WEATHER_KINDS = ['sunny', 'rainy'] as const
export type SunnyRainyWeatherKind = (typeof SUNNY_RAINY_WEATHER_KINDS)[number]

export const HAIL_SANDSTORM_WEATHER_KINDS = ['hail', 'sandstorm'] as const
export type HailSandstormWeatherKind = (typeof HAIL_SANDSTORM_WEATHER_KINDS)[number]

export const AUTHORITATIVE_WEATHER_KINDS = [
  ...SUNNY_RAINY_WEATHER_KINDS,
  ...HAIL_SANDSTORM_WEATHER_KINDS,
] as const
export type AuthoritativeWeatherKind = (typeof AUTHORITATIVE_WEATHER_KINDS)[number]

export const WEATHER_HEALING_PROFILES = Object.freeze({
  'solar-restoration': Object.freeze({
    clear: 50,
    sunny: 200 / 3,
    rainy: 25,
    hail: 25,
    sandstorm: 25,
  }),
  'shore-up': Object.freeze({
    clear: 50,
    sunny: 25,
    rainy: 25,
    hail: 25,
    sandstorm: 200 / 3,
  }),
} as const)

export type WeatherHealingProfile = keyof typeof WEATHER_HEALING_PROFILES

/** @deprecated Use WEATHER_HEALING_PROFILES; retained for the v1 compatibility surface. */
export const SUNNY_RAINY_HEALING_PROFILES = WEATHER_HEALING_PROFILES
/** @deprecated Use WeatherHealingProfile. */
export type SunnyRainyHealingProfile = WeatherHealingProfile

export interface SunnyRainyDamagePolicy {
  readonly value: number
  readonly reasonCode: string
  readonly typeId: 'fire' | 'water'
}

/** Canonical Sunny/Rainy Damage Roll rule shared by v1 adaptation and v2 planning. */
export const sunnyRainyDamagePolicy = (
  weather: SunnyRainyWeatherKind,
  moveType: string,
): SunnyRainyDamagePolicy | null => {
  const typeId = moveType.trim().toLowerCase()
  if (weather === 'sunny' && typeId === 'fire') {
    return { value: 5, reasonCode: 'weather.sunny.fire-damage-bonus', typeId }
  }
  if (weather === 'sunny' && typeId === 'water') {
    return { value: -5, reasonCode: 'weather.sunny.water-damage-penalty', typeId }
  }
  if (weather === 'rainy' && typeId === 'water') {
    return { value: 5, reasonCode: 'weather.rainy.water-damage-bonus', typeId }
  }
  if (weather === 'rainy' && typeId === 'fire') {
    return { value: -5, reasonCode: 'weather.rainy.fire-damage-penalty', typeId }
  }
  return null
}

export const SAND_FORCE_ABILITY_NAME = 'Sand Force' as const
export const SAND_FORCE_DAMAGE_TYPES = ['ground', 'rock', 'steel'] as const
export type SandForceDamageType = (typeof SAND_FORCE_DAMAGE_TYPES)[number]

export interface SandForceDamagePolicy {
  readonly value: 5
  readonly reasonCode: 'weather.sandstorm.sand-force-damage-bonus'
  readonly typeId: SandForceDamageType
}

/** Canonical Sand Force bonus while Sandstorm is active. */
export const sandForceDamagePolicy = (
  moveType: string,
  hasSandForce: boolean,
): SandForceDamagePolicy | null => {
  if (!hasSandForce) return null
  const typeId = moveType.trim().toLowerCase()
  if (!SAND_FORCE_DAMAGE_TYPES.some(candidate => candidate === typeId)) return null
  return {
    value: 5,
    reasonCode: 'weather.sandstorm.sand-force-damage-bonus',
    typeId: typeId as SandForceDamageType,
  }
}

export const SUNNY_RAINY_ACCURACY_MOVE_IDS = Object.freeze([
  'hurricane',
  'thunder',
] as const)

export const HAIL_ACCURACY_MOVE_IDS = Object.freeze(['blizzard'] as const)
