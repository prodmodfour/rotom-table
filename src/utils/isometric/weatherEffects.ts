import type { MapWeatherKind } from '~/types/map'
import type { WeatherEffectRendererInput } from './weatherMath'
import { createWeatherTextureCache } from './weatherTextures'
import { makeWeatherVisual as makeWeatherVisualForKind } from './weatherVisualFactory'
import type { WeatherVisual } from './weatherVisualTypes'

export {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
} from './weatherMath'
export { weatherVisualSeed } from './weatherVisualFactory'
export type { WeatherBounds, WeatherEffectRendererInput } from './weatherMath'
export type { WeatherVisual } from './weatherVisualTypes'

export interface WeatherVisualFactory {
  makeWeatherVisual(
    input: WeatherEffectRendererInput,
    kind: MapWeatherKind,
    index: number,
    total: number,
  ): WeatherVisual
  disposeTextureCache(): void
}

export const createWeatherVisualFactory = (): WeatherVisualFactory => {
  const weatherTextures = createWeatherTextureCache()

  return {
    makeWeatherVisual: (input, kind, index, total) =>
      makeWeatherVisualForKind(input, kind, index, total, weatherTextures),
    disposeTextureCache: weatherTextures.disposeTextureCache,
  }
}
