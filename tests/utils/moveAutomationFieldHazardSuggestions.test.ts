import { describe, expect, it } from 'vitest'
import {
  parseMoveAutomationFieldSuggestions,
  parseMoveAutomationHazardSuggestions,
} from '~/utils/moveAutomationFieldHazardSuggestions'

describe('move automation field and hazard suggestion helpers', () => {
  it('builds direct weather and room field-effect suggestions from move names', () => {
    expect(parseMoveAutomationFieldSuggestions({ name: 'Sunny Day' })).toEqual([
      { kind: 'weather', value: 'sunny', label: 'Set Sunny weather', optional: false },
    ])
    expect(parseMoveAutomationFieldSuggestions({ name: 'Trick Room' })).toEqual([
      { kind: 'room', value: 'trick', label: 'Apply Trick Room', optional: false },
    ])
  })

  it('builds terrain suggestions from canonical names and matching effect text', () => {
    expect(parseMoveAutomationFieldSuggestions({ name: 'Electric Terrain' })).toEqual([
      { kind: 'terrain', value: 'electric', label: 'Apply Electric Terrain', optional: false },
    ])

    expect(parseMoveAutomationFieldSuggestions({
      name: 'Custom Move',
      effect: 'The area becomes Misty Terrain until the end of the scene.',
    })).toEqual([
      { kind: 'terrain', value: 'misty', label: 'Apply Misty Terrain', optional: true },
    ])

    expect(parseMoveAutomationFieldSuggestions({
      name: 'Flavor Text',
      effect: 'The target remembers Electric Terrain without creating it.',
    })).toEqual([])
  })

  it('builds hazard suggestions with compatible square counts and optional flags', () => {
    expect(parseMoveAutomationHazardSuggestions({ name: 'Toxic Spikes' })).toEqual([
      { kind: 'toxic-spikes', squares: 8, label: 'Place 8 Toxic Spikes squares' },
    ])
    expect(parseMoveAutomationHazardSuggestions({ name: 'Stealth Rock' })).toEqual([
      { kind: 'stealth-rock', squares: 4, label: 'Place 4 Stealth Rock squares' },
    ])
    expect(parseMoveAutomationHazardSuggestions({ name: 'Fire Pledge' })).toEqual([
      { kind: 'fire', squares: 4, label: 'Optional Fire Pledge fire hazard squares', optional: true },
    ])
  })

  it('returns empty suggestion lists when no known field or hazard effect is present', () => {
    expect(parseMoveAutomationFieldSuggestions({ name: 'Tackle', effect: 'No effect.' })).toEqual([])
    expect(parseMoveAutomationHazardSuggestions({ name: 'Tackle' })).toEqual([])
  })
})
