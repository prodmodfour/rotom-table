export const SUNNY_RAINY_WEATHER_KINDS = ['sunny', 'rainy'] as const
export type SunnyRainyWeatherKind = (typeof SUNNY_RAINY_WEATHER_KINDS)[number]

export const SUNNY_RAINY_HEALING_PROFILES = Object.freeze({
  'solar-restoration': Object.freeze({
    clear: 50,
    sunny: 200 / 3,
    rainy: 25,
  }),
  'shore-up': Object.freeze({
    clear: 50,
    sunny: 25,
    rainy: 25,
  }),
} as const)

export type SunnyRainyHealingProfile = keyof typeof SUNNY_RAINY_HEALING_PROFILES

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

export const SUNNY_RAINY_ACCURACY_MOVE_IDS = Object.freeze([
  'hurricane',
  'thunder',
] as const)
