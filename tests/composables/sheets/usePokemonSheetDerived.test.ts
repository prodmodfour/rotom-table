import { computed, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { formatLookupList, usePokemonSheetDerived } from '~/composables/sheets/usePokemonSheetDerived'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
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

  it('lists auto-added Struggle moves before sheet moves', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const derived = usePokemonSheetDerived(sheet)

    const firstManualIndex = derived.moveRows.value.findIndex((row) => !row.automatic)

    expect(firstManualIndex).toBeGreaterThan(0)
    expect(derived.moveRows.value.slice(0, firstManualIndex).every((row) => row.automatic)).toBe(true)
    expect(derived.moveRows.value[firstManualIndex]).toMatchObject({
      move: { name: 'Thunder Shock' },
      automatic: false,
      sheetIndex: 0,
    })
  })

  it('uses move-granted capabilities when choosing automatic Struggle variants', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      species: 'Abra',
      movelist: [{ name: 'Ember' }],
      capabilities: { other: [] },
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.moveRows.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ move: { name: 'Struggle (Firestarter Physical)' }, automatic: true }),
      expect.objectContaining({ move: { name: 'Struggle (Firestarter Special)' }, automatic: true }),
      expect.objectContaining({ move: { name: 'Ember' }, automatic: false }),
    ]))
  })

  it('caps current HP at Max HP, allows overkill, and accounts for Bright Powder evasion', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const derived = usePokemonSheetDerived(sheet)

    expect(sheet.value?.combat?.currentHp).toBe(derived.maxHp.value)

    derived.setCurrentHp(-20)
    expect(sheet.value?.combat?.currentHp).toBe(-20)
    expect(derived.currentHp.value).toBe(-20)

    expect(derived.pokemonEvasion.value.vsAny.itemBonus).toBe(2)
    expect(derived.heldItemName.value).toBe('Bright Powder')
    expect(derived.heldItemReference.value?.name).toBe('Bright Powder')
  })

  it('accounts for Luck Incense accuracy roll bonuses', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combat: { currentHp: 30, conditions: ['Blindness'] },
      combatStages: { acc: 2 },
      items: { held: 'Luck Incense' },
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.pokemonAccuracy.value).toEqual({
      total: -3,
      stage: 2,
      conditionModifier: -6,
      itemBonus: 1,
      abilityBonus: 0,
    })
    expect(derived.heldItemReference.value?.name).toBe('Luck Incense')
  })

  it('adds Compound Eyes to Pokémon sheet Accuracy Rolls', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combatStages: { acc: 1 },
      items: {},
      abilities: [{ name: 'Compound Eyes' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.pokemonAccuracy.value).toMatchObject({
      total: 4,
      stage: 1,
      abilityBonus: 3,
    })
  })

  it('adds No Guard to Pokémon sheet Accuracy Rolls', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combatStages: { acc: 1 },
      items: {},
      abilities: [{ name: 'No Guard' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.pokemonAccuracy.value).toMatchObject({
      total: 4,
      stage: 1,
      abilityBonus: 3,
    })
  })

  it('adds Quick Claw to Pokémon sheet initiative before condition adjustments', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combat: { currentHp: 30, conditions: ['Paralysis'] },
      items: { held: 'quick-claw' },
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.initiativeItemBonus.value).toBe(10)
    expect(derived.heldItemReference.value?.name).toBe('Quick Claw')
    expect(derived.initiative.value).toBe(Math.floor((derived.speedTotal.value + 10) / 2))
  })

  it('applies active Training Feature bonuses to sheet combat summaries', () => {
    const agilitySheet = ref<CharacterSheet | null>(makeSheet({
      activeTrainingFeature: 'Agility Training',
      items: {},
    }))
    const agility = usePokemonSheetDerived(agilitySheet)

    expect(agility.activeTrainingFeatureEffects.value).toMatchObject({
      featureName: 'Agility Training',
      stateName: 'Agile',
    })
    expect(agility.initiativeTrainingBonus.value).toBe(4)
    expect(agility.initiative.value).toBe(agility.speedTotal.value + 4)

    const focused = usePokemonSheetDerived(ref<CharacterSheet | null>(makeSheet({
      activeTrainingFeature: 'Focused Training',
      combatStages: { acc: 1 },
      items: {},
    })))
    expect(focused.pokemonAccuracy.value).toMatchObject({
      stage: 1,
      trainingBonus: 1,
      total: 2,
    })

    const inspired = usePokemonSheetDerived(ref<CharacterSheet | null>(makeSheet({
      activeTrainingFeature: 'Inspired Training',
      combat: { evasion: { vsAtkBonus: 0, vsSatkBonus: 0, vsAnyBonus: 0 } },
      items: {},
    })))
    const untrained = usePokemonSheetDerived(ref<CharacterSheet | null>(makeSheet({
      combat: { evasion: { vsAtkBonus: 0, vsSatkBonus: 0, vsAnyBonus: 0 } },
      items: {},
    })))

    expect(inspired.pokemonEvasion.value.vsAtk.trainingBonus).toBe(1)
    expect(inspired.pokemonEvasion.value.vsAtk.total).toBe(Math.min(9, untrained.pokemonEvasion.value.vsAtk.total + 1))
    expect(inspired.pokemonEvasion.value.vsSatk.total).toBe(Math.min(9, untrained.pokemonEvasion.value.vsSatk.total + 1))
    expect(inspired.pokemonEvasion.value.vsAny.total).toBe(Math.min(9, untrained.pokemonEvasion.value.vsAny.total + 1))
  })

  it('uses Pokémon Loyalty for Return and Frustration Damage Bases', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      loyalty: 4,
      items: {},
      movelist: [{ name: 'Return' }, { name: 'Frustration' }],
      stats: { atk: { added: 10 } },
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.moveRows.value.find((moveRow) => moveRow.move.name === 'Return')).toMatchObject({
      damageBase: 7,
      damageFormula: `2d6+10+${derived.attackTotal.value}`,
    })
    expect(derived.moveRows.value.find((moveRow) => moveRow.move.name === 'Frustration')).toMatchObject({
      damageBase: 5,
    })
  })

  it('applies Weird Power to Pokémon sheet move damage formulas', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      abilities: [{ name: 'Weird Power' }],
      items: {},
      movelist: [{ name: 'Custom Blast', category: 'Special', db: 6 }],
      stats: {
        atk: { added: 20 },
        satk: { added: 0 },
      },
    }))
    const derived = usePokemonSheetDerived(sheet)

    const row = derived.moveRows.value.find((moveRow) => moveRow.move.name === 'Custom Blast')
    expect(row).toMatchObject({
      attackStat: derived.specialAttackTotal.value + derived.attackTotal.value,
      attackStatKey: 'satk',
      attackStatAbility: 'Weird Power',
      additionalAttackStat: derived.attackTotal.value,
      additionalAttackStatKey: 'atk',
      damageFormula: `2d6+8+${derived.specialAttackTotal.value + derived.attackTotal.value}`,
    })
  })

  it('applies Combat Stages to Pokémon sheet totals without double-applying move damage', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      items: {},
      movelist: [{ name: 'Custom Strike', category: 'Physical', db: 6 }],
      stats: { atk: { added: 10, stage: 2 } },
    }))
    const derived = usePokemonSheetDerived(sheet)

    const atk = derived.stats.value.find((row) => row.key === 'atk')!
    const expectedAttack = applyCombatStageToStat(atk.baseTotal, 2)
    const move = derived.moveRows.value.find((moveRow) => moveRow.move.name === 'Custom Strike')

    expect(atk.total).toBe(expectedAttack)
    expect(derived.attackTotal.value).toBe(expectedAttack)
    expect(move).toMatchObject({
      baseAttackStat: atk.baseTotal,
      attackStage: 2,
      attackStat: expectedAttack,
    })
  })

  it('applies Levitate passive Ground resistance one step further in type effectiveness', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      abilities: [{ name: 'Levitate' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.typeEffectivenessRows.value.find((row) => row.type === 'Ground')).toMatchObject({
      mult: 1,
      label: '1',
      tone: 'neutral',
      source: 'Levitate',
    })
  })

  it('applies Flash Fire immunity in type effectiveness', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      types: ['Grass'],
      abilities: [{ name: 'Flash Fire' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.typeEffectivenessRows.value.find((row) => row.type === 'Fire')).toMatchObject({
      mult: 0,
      label: '0',
      tone: 'immune',
      source: 'Flash Fire',
    })
  })

  it('applies Tolerance to resisted type effectiveness', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      types: ['Water'],
      abilities: [{ name: 'Tolerance' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.typeEffectivenessRows.value.find((row) => row.type === 'Fire')).toMatchObject({
      mult: 0.25,
      label: '¼',
      tone: 'resist',
      source: 'Tolerance',
    })
    expect(derived.typeEffectivenessRows.value.find((row) => row.type === 'Electric')).toMatchObject({
      mult: 1.5,
      source: null,
    })
  })

  it('uses Flying type and Levitate ability for Ground effectiveness while ignoring airborne capabilities', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      types: ['Fire', 'Flying'],
      capabilities: { sky: 8, levitate: 4 },
      abilities: [{ name: 'Levitate' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.typeEffectivenessRows.value.find((row) => row.type === 'Ground')).toMatchObject({
      mult: 0.5,
      label: '½',
      tone: 'resist',
      source: 'Levitate',
    })

    sheet.value!.abilities = []
    expect(derived.typeEffectivenessRows.value.find((row) => row.type === 'Ground')).toMatchObject({
      mult: 1,
      label: '1',
      tone: 'neutral',
      source: null,
    })
  })

  it('applies condition effects to stages, evasion suppression, initiative, and summaries', () => {
    const common = { evasion: { vsAtkBonus: 0, vsAnyBonus: 2 } }
    const unconditioned = usePokemonSheetDerived(ref<CharacterSheet | null>(makeSheet({
      combat: common,
      items: {},
    })))
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combat: { ...common, conditions: ['Burned', 'Stuck', 'Paralysis'] },
      items: {},
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.combatConditions.value).toEqual(['Burned', 'Paralysis', 'Stuck'])
    const def = derived.stats.value.find((row) => row.key === 'def')!
    expect(def).toMatchObject({
      stage: 0,
      conditionStageModifier: -2,
      effectiveStage: -2,
      total: applyCombatStageToStat(def.baseTotal, -2),
    })
    expect(def.total).toBeLessThan(unconditioned.stats.value.find((row) => row.key === 'def')?.total ?? 0)
    expect(derived.pokemonEvasion.value.vsAtk.total).toBe(unconditioned.pokemonEvasion.value.vsAtk.total)
    expect(derived.pokemonEvasion.value.vsAny.total).toBe(0)
    expect(derived.pokemonEvasion.value.vsAny.suppressedByCondition).toBe('Stuck')
    expect(derived.initiative.value).toBe(Math.floor(derived.speedTotal.value / 2))
    expect(derived.conditionEffects.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Burned' }),
      expect.objectContaining({ label: 'Paralysis' }),
      expect.objectContaining({ label: 'Stuck' }),
    ]))
  })

  it('applies Quick Feet speed and paralysis initiative automation while statused', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      combat: { conditions: ['Paralysis'], evasion: { vsAnyBonus: 0 } },
      items: {},
      abilities: [{ name: 'Quick Feet' }],
    }))
    const derived = usePokemonSheetDerived(sheet)

    expect(derived.stats.value.find((row) => row.key === 'spd')).toMatchObject({
      conditionStageModifier: 2,
      effectiveStage: 2,
    })
    expect(derived.initiative.value).toBe(derived.speedTotal.value)
    expect(derived.conditionEffects.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Quick Feet' }),
    ]))

    sheet.value!.combat!.conditions = []

    expect(derived.stats.value.find((row) => row.key === 'spd')).toMatchObject({
      conditionStageModifier: 0,
      effectiveStage: 0,
    })
  })

  it('adds Sand Veil and Snow Cloak to every evasion total and increases them while activated', () => {
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

    sheet.value!.abilities = [{ name: 'snow cloak', activated: true }]

    expect(derived.pokemonEvasion.value.vsAtk.abilityBonus).toBe(2)
    expect(derived.pokemonEvasion.value.vsSatk.abilityBonus).toBe(2)
    expect(derived.pokemonEvasion.value.vsAny.abilityBonus).toBe(2)
  })

  it('syncs level from total experience when an experience total is present', async () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({ level: 1, totalExp: 110 }))
    const derived = usePokemonSheetDerived(sheet)

    expect(sheet.value?.level).toBe(11)
    expect(derived.levelFromExperience.value).toBe(11)
    expect(derived.levelIsExperienceDerived.value).toBe(true)

    sheet.value!.totalExp = 215
    await nextTick()

    expect(sheet.value?.level).toBe(14)
    expect(derived.experienceToNextLevel.value).toBe(5)

    sheet.value = makeSheet({ level: 1, totalExp: 215 })
    await nextTick()

    expect(sheet.value?.level).toBe(14)

    sheet.value!.totalExp = undefined
    await nextTick()
    sheet.value!.level = 20
    await nextTick()

    expect(sheet.value?.level).toBe(20)
    expect(derived.levelIsExperienceDerived.value).toBe(false)
  })

  it('formats lookup lists for nullable arrays', () => {
    expect(formatLookupList(['Overland', '', 'Darkvision'])).toBe('Overland, Darkvision')
    expect(formatLookupList([])).toBe('—')
    expect(formatLookupList(null)).toBe('—')
  })
})
