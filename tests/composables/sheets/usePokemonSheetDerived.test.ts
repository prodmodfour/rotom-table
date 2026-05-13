import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { formatLookupList, usePokemonSheetDerived } from '~/composables/sheets/usePokemonSheetDerived'
import type { CharacterSheet } from '~/types/characterSheet'

const makeSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'test-pikachu',
  nickname: 'Spark',
  species: 'Pikachu',
  level: 10,
  combat: { currentHp: 999, evasion: { vsAnyBonus: 1 } },
  items: { held: 'Bright Powder' },
  movelist: [{ name: 'Thunder Shock' }],
  tutorPoints: { earned: 5, spent: 2 },
  ...overrides,
})

describe('usePokemonSheetDerived', () => {
  it('derives species fallbacks, sheet totals, and lookup rows', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const derived = usePokemonSheetDerived(computed(() => sheet.value))

    expect(derived.species.value?.species).toBe('Pikachu')
    expect(derived.sheetTypes.value).toEqual(['Electric'])
    expect(derived.eggGroups.value).toContain('Field')
    expect(derived.stats.value.find((row) => row.key === 'hp')?.total).toBeGreaterThan(0)
    expect(derived.moveRows.value.some((row) => row.move.name === 'Thunder Shock' && !row.automatic)).toBe(true)
    expect(derived.abilityRows.value).toEqual([])
    expect(derived.tutorPointsLeft.value).toBe(3)
    expect(derived.typeEffectivenessRows.value).toHaveLength(18)
  })

  it('clamps current HP and accounts for Bright Powder evasion', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const derived = usePokemonSheetDerived(sheet)

    expect(sheet.value?.combat?.currentHp).toBe(derived.maxHp.value)

    derived.setCurrentHp(-20)
    expect(sheet.value?.combat?.currentHp).toBe(0)
    expect(derived.currentHp.value).toBe(0)

    expect(derived.pokemonEvasion.value.vsAny.itemBonus).toBe(2)
    expect(derived.heldItemName.value).toBe('Bright Powder')
    expect(derived.heldItemReference.value?.name).toBe('Bright Powder')
  })

  it('adds Sand Veil to every evasion total and increases it while activated', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combat: { evasion: { vsAtkBonus: 0, vsSatkBonus: 0, vsAnyBonus: 0 } },
      items: {},
      abilities: [],
    }))
    const derived = usePokemonSheetDerived(sheet)
    const withoutSandVeil = derived.pokemonEvasion.value

    sheet.value!.abilities = [{ name: 'sand veil' }]

    expect(derived.pokemonEvasion.value.vsAtk.abilityBonus).toBe(1)
    expect(derived.pokemonEvasion.value.vsSatk.abilityBonus).toBe(1)
    expect(derived.pokemonEvasion.value.vsAny.abilityBonus).toBe(1)
    expect(derived.pokemonEvasion.value.vsAtk.total).toBe(Math.min(9, withoutSandVeil.vsAtk.total + 1))
    expect(derived.pokemonEvasion.value.vsSatk.total).toBe(Math.min(9, withoutSandVeil.vsSatk.total + 1))
    expect(derived.pokemonEvasion.value.vsAny.total).toBe(Math.min(9, withoutSandVeil.vsAny.total + 1))

    sheet.value!.abilities = [{ name: 'sand veil', activated: true }]

    expect(derived.pokemonEvasion.value.vsAtk.abilityBonus).toBe(2)
    expect(derived.pokemonEvasion.value.vsSatk.abilityBonus).toBe(2)
    expect(derived.pokemonEvasion.value.vsAny.abilityBonus).toBe(2)
    expect(derived.pokemonEvasion.value.vsAtk.total).toBe(Math.min(9, withoutSandVeil.vsAtk.total + 2))
    expect(derived.pokemonEvasion.value.vsSatk.total).toBe(Math.min(9, withoutSandVeil.vsSatk.total + 2))
    expect(derived.pokemonEvasion.value.vsAny.total).toBe(Math.min(9, withoutSandVeil.vsAny.total + 2))
  })

  it('formats lookup lists for nullable arrays', () => {
    expect(formatLookupList(['Overland', '', 'Darkvision'])).toBe('Overland, Darkvision')
    expect(formatLookupList([])).toBe('—')
    expect(formatLookupList(null)).toBe('—')
  })
})
