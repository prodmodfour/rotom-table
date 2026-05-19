import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  createDamageDialogState,
  getDamageDialogAttackBonus,
  getDamageDialogAttacker,
  getDamageDialogAttackerOptions,
  getDamageDialogDbDefinition,
  getDamageDialogDefense,
  getDamageDialogHpLoss,
  getDamageDialogHpUpdate,
  getDamageDialogInjuryResult,
  getDamageDialogMultiplier,
  getDamageDialogMultiplierLabel,
  getDamageDialogMultiplierTone,
  getDamageDialogPreview,
  getDamageDialogPreviewMaxHp,
  getDamageDialogRawAmount,
  updateDamageDialogFromPokemon,
} from '~/utils/isometric/tokenDamageDialog'

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
  currentHp: 40,
  maxHp: 50,
  atk: 8,
  satk: 12,
  def: 5,
  sdef: 7,
  defenderTypes: ['Electric'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('isometric damage dialog helpers', () => {
  it('creates the default flat-damage dialog state from a spawned token', () => {
    expect(createDamageDialogState(pokemon())).toEqual({
      id: 'token-1',
      species: 'Pikachu',
      currentHp: 40,
      maxHp: 50,
      def: 5,
      sdef: 7,
      defenderTypes: ['Electric'],
      mode: 'physical',
      attackType: 'Normal',
      source: 'flat',
      amount: '',
      db: 1,
      roll: null,
      attackerId: null,
    })
  })

  it('derives raw damage, selected defense, and DB attacker bonuses', () => {
    const dialog = createDamageDialogState(pokemon())
    dialog.amount = '20'
    expect(getDamageDialogRawAmount(dialog)).toBe(20)
    expect(getDamageDialogDefense(dialog)).toBe(5)
    expect(getDamageDialogAttackBonus(dialog, pokemon({ atk: 99 }))).toBe(0)

    dialog.source = 'db'
    dialog.roll = { db: 6, formula: '2d6+8', rolls: [6, 6], mod: 8, total: 20 }
    expect(getDamageDialogRawAmount(dialog)).toBe(20)
    expect(getDamageDialogAttackBonus(dialog, pokemon({ atk: 9, satk: 13 }))).toBe(9)

    dialog.mode = 'special'
    expect(getDamageDialogDefense(dialog)).toBe(7)
    expect(getDamageDialogAttackBonus(dialog, pokemon({ atk: 9, satk: 13 }))).toBe(13)
  })

  it('sorts and resolves attacker options by species', () => {
    const bulbasaur = pokemon({ id: 'b', species: 'Bulbasaur' })
    const charmander = pokemon({ id: 'c', species: 'Charmander' })
    const dialog = createDamageDialogState(pokemon())
    dialog.attackerId = 'c'

    expect(getDamageDialogAttackerOptions([charmander, bulbasaur]).map((entry) => entry.id))
      .toEqual(['b', 'c'])
    expect(getDamageDialogAttacker(dialog, [bulbasaur, charmander])).toBe(charmander)
  })

  it('calculates type multiplier presentation, HP loss, and preview HP', () => {
    const dialog = createDamageDialogState(pokemon({ defenderTypes: ['Grass'] }))
    dialog.amount = '20'
    dialog.attackType = 'Fire'

    expect(getDamageDialogMultiplier(dialog)).toBe(1.5)
    expect(getDamageDialogMultiplierTone(1.5)).toBe('is-weak')
    expect(getDamageDialogMultiplierLabel(1.5)).toBe('1.5')
    expect(getDamageDialogHpLoss(dialog, null)).toBe(22)
    expect(getDamageDialogPreview(dialog, null)).toBe(18)

    dialog.currentHp = 10
    expect(getDamageDialogPreview(dialog, null)).toBe(-12)
    dialog.currentHp = 40

    dialog.attackType = 'Ground'
    dialog.defenderTypes = ['Flying']
    expect(getDamageDialogMultiplier(dialog)).toBe(0.5)
    expect(getDamageDialogMultiplierTone(0.5)).toBe('is-resist')
    expect(getDamageDialogPreview(dialog, null)).toBe(33)

    const skyDialog = createDamageDialogState(pokemon({
      defenderTypes: ['Flying'],
      defenderCapabilities: { sky: 5 },
    }))
    skyDialog.amount = '20'
    skyDialog.attackType = 'Ground'
    expect(getDamageDialogMultiplier(skyDialog)).toBe(0.5)
    expect(getDamageDialogMultiplierTone(0.5)).toBe('is-resist')

    const levitateDialog = createDamageDialogState(pokemon({
      defenderTypes: ['Electric'],
      abilityNames: ['Levitate'],
    }))
    levitateDialog.amount = '20'
    levitateDialog.attackType = 'Ground'
    expect(getDamageDialogMultiplier(levitateDialog)).toBe(1)
    expect(getDamageDialogMultiplierTone(1)).toBeNull()
  })

  it('adds Massive Damage and marker Injury updates for damage application', () => {
    const dialog = createDamageDialogState(pokemon({ currentHp: 53, maxHp: 53, fullMaxHp: 53, injuries: 0, def: 0 }))
    dialog.amount = '28'

    expect(getDamageDialogInjuryResult(dialog, null)).toMatchObject({
      injuryDelta: 2,
      markerInjuries: 1,
      massiveDamageInjuries: 1,
      injuries: 2,
    })
    expect(getDamageDialogPreviewMaxHp(dialog, null)).toBe(42)
    expect(getDamageDialogHpUpdate(dialog, null)).toEqual({ id: 'token-1', currentHp: 25, injuries: 2 })
  })

  it('finds DB definitions and syncs live token metadata while clearing missing attackers', () => {
    const dialog = createDamageDialogState(pokemon())
    dialog.db = 6
    dialog.source = 'db'
    dialog.amount = '17'
    dialog.attackerId = 'missing'

    expect(getDamageDialogDbDefinition(dialog)).toEqual({ db: 6, count: 2, sides: 6, mod: 8 })
    expect(updateDamageDialogFromPokemon(dialog, pokemon({
      species: 'Raichu',
      currentHp: 20,
      maxHp: 60,
      def: 11,
      sdef: 12,
      defenderTypes: ['Electric', 'Flying'],
    }), [pokemon({ id: 'other' })])).toMatchObject({
      species: 'Raichu',
      currentHp: 20,
      maxHp: 60,
      def: 11,
      sdef: 12,
      defenderTypes: ['Electric', 'Flying'],
      source: 'db',
      amount: '17',
      attackerId: null,
    })
  })
})
