import type {
  MapHazardKind,
  MapRoomKind,
  MapTerrainKind,
  MapWeatherKind,
} from '~/types/map'
import type {
  MoveAutomationFieldSuggestion,
  MoveAutomationHazardSuggestion,
} from '~/types/moveAutomation'
import type { MoveAutomationMoveLike } from '~/utils/move-automation/moveData'

const fieldSuggestion = (
  kind: 'weather' | 'terrain' | 'room',
  value: MapWeatherKind | MapTerrainKind | MapRoomKind,
  label: string,
  optional = false,
): MoveAutomationFieldSuggestion => ({ kind, value, label, optional })

export const parseMoveAutomationFieldSuggestions = (move: MoveAutomationMoveLike): MoveAutomationFieldSuggestion[] => {
  const name = move.name
  const effect = move.effect ?? ''
  const out: MoveAutomationFieldSuggestion[] = []

  if (name === 'Sunny Day') out.push(fieldSuggestion('weather', 'sunny', 'Set Sunny weather'))
  if (name === 'Rain Dance') out.push(fieldSuggestion('weather', 'rainy', 'Set Rainy weather'))
  if (name === 'Hail') out.push(fieldSuggestion('weather', 'hail', 'Set Hail weather'))
  if (name === 'Sandstorm') out.push(fieldSuggestion('weather', 'sandstorm', 'Set Sandstorm weather'))
  if (name === 'Electric Terrain' || /create Electric Terrain/i.test(effect)) out.push(fieldSuggestion('terrain', 'electric', 'Apply Electric Terrain', name !== 'Electric Terrain'))
  if (name === 'Grassy Terrain' || /create Grassy Terrain/i.test(effect)) out.push(fieldSuggestion('terrain', 'grassy', 'Apply Grassy Terrain', name !== 'Grassy Terrain'))
  if (name === 'Misty Terrain' || /Misty Terrain/i.test(effect) && /create|becomes|area becomes/i.test(effect)) out.push(fieldSuggestion('terrain', 'misty', 'Apply Misty Terrain', name !== 'Misty Terrain'))
  if (name === 'Psychic Terrain' || /create Psychic Terrain/i.test(effect)) out.push(fieldSuggestion('terrain', 'psychic', 'Apply Psychic Terrain', name !== 'Psychic Terrain'))
  if (name === 'Magic Room') out.push(fieldSuggestion('room', 'magic', 'Apply Magic Room'))
  if (name === 'Trick Room') out.push(fieldSuggestion('room', 'trick', 'Apply Trick Room'))
  if (name === 'Wonder Room') out.push(fieldSuggestion('room', 'wonder', 'Apply Wonder Room'))

  return out
}

export const parseMoveAutomationHazardSuggestions = (move: MoveAutomationMoveLike): MoveAutomationHazardSuggestion[] => {
  const name = move.name
  const out: MoveAutomationHazardSuggestion[] = []
  const push = (kind: MapHazardKind, squares: number, label: string) => out.push({ kind, squares, label })

  if (name === 'Spikes') push('spikes', 8, 'Place 8 Spikes squares')
  if (name === 'Toxic Spikes') push('toxic-spikes', 8, 'Place 8 Toxic Spikes squares')
  if (name === 'Sticky Web') push('sticky-web', 8, 'Place 8 Sticky Web squares')
  if (name === 'Stealth Rock') push('stealth-rock', 4, 'Place 4 Stealth Rock squares')
  if (name === 'Fire Pledge') out.push({ kind: 'fire', squares: 4, label: 'Optional Fire Pledge fire hazard squares', optional: true })

  return out
}
