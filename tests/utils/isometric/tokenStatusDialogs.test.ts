import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  createCombatStagesDialogState,
  createConditionsDialogState,
  formatCombatStage,
  getAdjustedCombatStage,
  getNormalizedCombatDialogStages,
  isCombatStagesDialogChanged,
  isConditionsDialogChanged,
  updateConditionsDialogFromPokemon,
} from '~/utils/isometric/tokenStatusDialogs'

const pokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token-1',
  species: 'Pikachu',
  slug: 'pikachu',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/pikachu.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 20,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: ['Electric'],
  combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: -1 },
  conditions: ['Burned', 'Poisoned'],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('isometric combat-stage dialog helpers', () => {
  it('creates normalized combat-stage dialog state and detects changes', () => {
    const dialog = createCombatStagesDialogState(pokemon({
      combatStages: { atk: 99, def: -99 } as SpawnedPokemon['combatStages'],
    }))

    expect(dialog.originalStages).toEqual({
      atk: 6,
      def: -6,
      satk: 0,
      sdef: 0,
      spd: 0,
      acc: 0,
    })
    expect(isCombatStagesDialogChanged(dialog)).toBe(false)

    dialog.stages.atk = 5
    expect(isCombatStagesDialogChanged(dialog)).toBe(true)
  })

  it('clamps adjustments, normalizes submission stages, and formats labels', () => {
    expect(getAdjustedCombatStage(6, 1)).toBe(6)
    expect(getAdjustedCombatStage(-6, -1)).toBe(-6)
    expect(getAdjustedCombatStage('2', 1)).toBe(3)

    const dialog = createCombatStagesDialogState(pokemon())
    dialog.stages.atk = 99
    expect(getNormalizedCombatDialogStages(dialog).atk).toBe(6)

    expect(formatCombatStage(2)).toBe('+2')
    expect(formatCombatStage(-1)).toBe('-1')
    expect(formatCombatStage(0)).toBe('0')
  })
})

describe('isometric condition dialog helpers', () => {
  it('creates normalized condition dialog state and detects canonical changes', () => {
    const dialog = createConditionsDialogState(pokemon({
      conditions: [' poisoned ', 'Burned', 'poisoned', 'Disable: Tackle'],
    }))

    expect(dialog.originalConditions).toEqual(['Burned', 'Poisoned', 'Disabled: Tackle'])
    expect(isConditionsDialogChanged(dialog)).toBe(false)

    dialog.conditions = ['Burned']
    expect(isConditionsDialogChanged(dialog)).toBe(true)
  })

  it('syncs live condition metadata without overwriting the in-progress edit', () => {
    const dialog = createConditionsDialogState(pokemon())
    dialog.conditions = ['Burned']

    expect(updateConditionsDialogFromPokemon(dialog, pokemon({
      species: 'Raichu',
      conditions: ['Asleep'],
    }))).toEqual({
      id: 'token-1',
      species: 'Raichu',
      originalConditions: ['Sleep'],
      conditions: ['Burned'],
    })
  })
})
