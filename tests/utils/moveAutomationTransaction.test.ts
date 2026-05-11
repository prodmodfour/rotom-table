import { describe, expect, it } from 'vitest'
import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import {
  defaultTargetResolutionState,
  moveAutomationSuggestionKey,
} from '~/utils/moveAutomationTargetResolution'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const token = (overrides: Partial<SpawnedPokemon> & Pick<SpawnedPokemon, 'id' | 'species'>): SpawnedPokemon => {
  const { id, species, ...rest } = overrides
  return {
    id,
    species,
    slug: species.toLowerCase(),
    size: 'Small',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    spriteUrl: '/sprite.png',
    entityKind: 'pokemon',
    position: { x: 0, y: 0, z: 0 },
    sheetKind: 'pokemon',
    sheetSlug: species.toLowerCase(),
    level: 10,
    currentHp: 20,
    maxHp: 40,
    atk: 8,
    satk: 7,
    def: 5,
    sdef: 4,
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 2,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Fire',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('move automation transaction helpers', () => {
  it('builds transactions for damage, suggestions, hazards, fields, stages, and notes', () => {
    const user = token({ id: 'u', species: 'Caster', currentHp: 30, maxHp: 40 })
    const target = token({ id: 't', species: 'Target', currentHp: 25, maxHp: 30, conditions: ['Burned'] })
    const s = script({
      hpSuggestions: [{ recipient: 'user', mode: 'heal-percent-max', percent: 25, label: 'Recover' }],
      conditionSuggestions: [{ recipient: 'target', condition: 'Slowed', label: 'Slow target' }],
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Lower Defense' }],
      hazardSuggestions: [{ kind: 'toxic-spikes', squares: 1, label: 'Lay spikes' }],
      fieldSuggestions: [{ kind: 'weather', value: 'sunny', label: 'Sun' }],
      automationNotes: ['Check secondary effects.'],
    })
    const enabledSuggestions = {
      [moveAutomationSuggestionKey(s, 'hp', 0)]: true,
      [moveAutomationSuggestionKey(s, 'condition', 0)]: true,
      [moveAutomationSuggestionKey(s, 'stage', 0)]: true,
      [moveAutomationSuggestionKey(s, 'hazard', 0)]: true,
      [moveAutomationSuggestionKey(s, 'field', 0)]: true,
    }

    const transaction = buildMoveAutomationTransaction({
      script: s,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s),
          hit: true,
          crit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 12, rolls: [], mod: 12 },
        },
      },
      enabledSuggestions,
      hpSuggestionAmounts: {},
      manualUserConditions: ['Poisoned'],
      manualTargetConditions: ['Confused'],
      manualUserStageDeltas: { ...stages, atk: 1 },
      manualTargetStageDeltas: { ...stages, spd: -2 },
      hazardCells: [{ x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }],
      manualNote: 'Manual note',
    })

    expect(transaction.hpUpdates).toEqual(expect.arrayContaining([
      { id: 't', currentHp: 10 },
      { id: 'u', currentHp: 40 },
    ]))
    expect(transaction.conditionUpdates).toEqual(expect.arrayContaining([
      { id: 'u', conditions: ['Poisoned'] },
      { id: 't', conditions: ['Burned', 'Confused', 'Slowed'] },
    ]))
    expect(transaction.combatStageUpdates).toEqual(expect.arrayContaining([
      { id: 'u', stages: { ...stages, atk: 1 } },
      { id: 't', stages: { ...stages, def: -1, spd: -2 } },
    ]))
    expect(transaction.hazardsToAdd).toEqual([{ kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 1, owner: 'Caster' }])
    expect(transaction.fieldEffectsToApply).toEqual([{ kind: 'weather', value: 'sunny', source: 'Test Move' }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Caster used Test Move.',
      'Target: 15 HP damage (critical flagged).',
      'Manual note: Manual note',
      'Note: Check secondary effects.',
    ]))
  })
})
