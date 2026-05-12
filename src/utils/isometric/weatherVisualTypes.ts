import type { Group } from 'three'

export interface WeatherVisual {
  group: Group
  update: (delta: number, elapsed: number) => void
}
