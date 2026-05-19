import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  createHpDialogState,
  getHpDialogDelta,
  getHpDialogPreview,
  updateHpDialogFromPokemon,
} from '~/utils/isometric/tokenHpDialog'

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
  combatStages: {},
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('isometric HP dialog helpers', () => {
  it('creates the default damage dialog state from a spawned token', () => {
    expect(createHpDialogState(pokemon())).toEqual({
      id: 'token-1',
      species: 'Pikachu',
      currentHp: 10,
      maxHp: 20,
      mode: 'damage',
      amount: '',
    })
  })

  it('parses positive amounts and applies damage/healing deltas', () => {
    const dialog = createHpDialogState(pokemon())
    dialog.amount = '7'

    expect(getHpDialogDelta(dialog)).toBe(-7)
    expect(getHpDialogPreview(dialog)).toBe(3)

    dialog.mode = 'heal'
    expect(getHpDialogDelta(dialog)).toBe(7)
    expect(getHpDialogPreview(dialog)).toBe(17)
  })

  it('ignores invalid amounts, allows overkill HP, and caps healing at Max HP', () => {
    const dialog = createHpDialogState(pokemon({ currentHp: 2, maxHp: 12 }))
    dialog.amount = 'not-a-number'
    expect(getHpDialogDelta(dialog)).toBe(0)
    expect(getHpDialogPreview(dialog)).toBe(2)

    dialog.amount = '99'
    expect(getHpDialogPreview(dialog)).toBe(-97)

    dialog.mode = 'heal'
    expect(getHpDialogPreview(dialog)).toBe(12)
  })

  it('updates live HP metadata without losing in-progress edits', () => {
    const dialog = createHpDialogState(pokemon())
    dialog.mode = 'heal'
    dialog.amount = '5'

    expect(updateHpDialogFromPokemon(dialog, pokemon({
      species: 'Raichu',
      currentHp: 12,
      maxHp: 30,
    }))).toEqual({
      id: 'token-1',
      species: 'Raichu',
      currentHp: 12,
      maxHp: 30,
      mode: 'heal',
      amount: '5',
    })
  })
})
