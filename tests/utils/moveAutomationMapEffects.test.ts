import { describe, expect, it } from 'vitest'
import {
  buildMoveAutomationFieldEffects,
  buildMoveAutomationHazards,
} from '~/utils/moveAutomationMapEffects'
import type { MoveAutomationScript } from '~/types/moveAutomation'

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 1,
  targetMode: 'hazard',
  targetCount: null,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Poison',
  ac: null,
  range: 'Field',
  effect: '',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('move automation map effect helpers', () => {
  it('builds enabled hazard placement payloads and log lines', () => {
    const s = script({
      hazardSuggestions: [
        { kind: 'toxic-spikes', squares: 1, label: 'Lay Toxic Spikes' },
        { kind: 'stealth-rock', squares: 3, label: 'Scatter Rocks' },
      ],
    })

    const result = buildMoveAutomationHazards({
      script: s,
      ownerName: 'Nidoran',
      hazardCells: [{ x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }],
      suggestionEnabled: (_kind, index) => index === 0,
    })

    expect(result.hazardsToAdd).toEqual([
      { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 1, owner: 'Nidoran' },
    ])
    expect(result.logLines).toEqual(['Lay Toxic Spikes: 1 square(s).'])
  })

  it('preserves legacy all-cell fallback for zero requested hazard squares', () => {
    const s = script({
      hazardSuggestions: [{ kind: 'spikes', squares: 0, label: 'Scatter Spikes' }],
    })

    const result = buildMoveAutomationHazards({
      script: s,
      ownerName: 'Pineco',
      hazardCells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      suggestionEnabled: () => true,
    })

    expect(result.hazardsToAdd).toEqual([
      { kind: 'spikes', x: 0, y: 0, z: 0, layer: undefined, owner: 'Pineco' },
      { kind: 'spikes', x: 1, y: 0, z: 0, layer: undefined, owner: 'Pineco' },
    ])
    expect(result.logLines).toEqual(['Scatter Spikes: 2 square(s).'])
  })

  it('skips disabled hazards and suppresses empty-cell log lines', () => {
    const s = script({
      hazardSuggestions: [{ kind: 'fire', squares: 2, label: 'Create Flames' }],
    })

    expect(buildMoveAutomationHazards({
      script: s,
      ownerName: 'Charmander',
      hazardCells: [{ x: 0, y: 0, z: 0 }],
      suggestionEnabled: () => false,
    })).toEqual({ hazardsToAdd: [], logLines: [] })

    expect(buildMoveAutomationHazards({
      script: s,
      ownerName: 'Charmander',
      hazardCells: [],
      suggestionEnabled: () => true,
    })).toEqual({ hazardsToAdd: [], logLines: [] })
  })

  it('builds enabled field effects and compatible log lines', () => {
    const s = script({
      moveName: 'Sunny Day',
      fieldSuggestions: [
        { kind: 'weather', value: 'sunny', label: 'Harsh sunlight' },
        { kind: 'terrain', value: 'electric', label: 'Electric Terrain' },
      ],
    })

    const result = buildMoveAutomationFieldEffects({
      script: s,
      suggestionEnabled: (_kind, index) => index === 1,
    })

    expect(result.fieldEffectsToApply).toEqual([
      { kind: 'terrain', value: 'electric', source: 'Sunny Day' },
    ])
    expect(result.logLines).toEqual(['Field effect: Sunny Day applies electric.'])
  })
})
