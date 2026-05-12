import type { MapWeatherKind } from '~/types/map'
import type { WeatherEffectRendererInput } from './weatherMath'
import { makeHailWeatherVisual } from './weatherHail'
import { makeRainyWeatherVisual } from './weatherRain'
import { makeSandstormWeatherVisual } from './weatherSandstorm'
import { makeSunnyWeatherVisual } from './weatherSunny'
import type { WeatherTextureCache } from './weatherTextures'
import type { WeatherVisual } from './weatherVisualTypes'

export const weatherVisualSeed = (
  kind: MapWeatherKind,
  input: WeatherEffectRendererInput,
  index: number,
): string =>
  `${kind}:${input.dimensions.x}x${input.dimensions.y}x${input.dimensions.z}:${index}`

export const makeWeatherVisual = (
  input: WeatherEffectRendererInput,
  kind: MapWeatherKind,
  index: number,
  total: number,
  weatherTextures: WeatherTextureCache,
): WeatherVisual => {
  const seed = weatherVisualSeed(kind, input, index)
  switch (kind) {
    case 'sunny':
      return makeSunnyWeatherVisual(input, seed, index, total, weatherTextures)
    case 'rainy':
      return makeRainyWeatherVisual(input, seed, index, total)
    case 'hail':
      return makeHailWeatherVisual(input, seed, index, total)
    case 'sandstorm':
      return makeSandstormWeatherVisual(input, seed, index, total, weatherTextures)
  }
}
