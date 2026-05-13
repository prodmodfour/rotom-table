import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTrainerSheetDerived } from '~/composables/sheets/useTrainerSheetDerived'
import type { TrainerSheet } from '~/types/trainerSheet'

const makeSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'test-trainer',
  name: 'Test Trainer',
  level: 10,
  currentHp: 999,
  currentInjuries: 1,
  ap: { left: 99 },
  stats: {
    hp: { levelUp: 2 },
    atk: { levelUp: 3 },
    satk: { levelUp: 4 },
    spd: { levelUp: 5 },
  },
  evasion: { speedBonus: 1, physicalBonus: -1, specialBonus: 2 },
  movelist: [{ name: 'Tackle' }],
  abilities: [{ name: 'Intimidate' }],
  ...overrides,
})

describe('useTrainerSheetDerived', () => {
  it('derives trainer sheet rows, vitals, and lookup rows', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const derived = useTrainerSheetDerived(computed(() => sheet.value))

    expect(derived.stats.value.find((row) => row.key === 'hp')?.total).toBeGreaterThan(0)
    expect(derived.skills.value).toHaveLength(17)
    expect(derived.capRes.value.rows.length).toBeGreaterThan(0)
    expect(derived.adv.value.map((row) => row.level)).toEqual([5, 10, 20, 30, 40])
    expect(derived.moveRows.value.some((row) => row.move.name === 'Tackle' && !row.automatic)).toBe(true)
    expect(derived.moveRows.value.some((row) => row.move.name === 'Struggle' && row.automatic)).toBe(true)
    expect(derived.abilityRows.value.some((row) => row.ability.name === 'Intimidate')).toBe(true)
    expect(derived.apLeft.value).toBe(99)
  })

  it('clamps current HP and exposes combat summaries', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const derived = useTrainerSheetDerived(sheet)

    expect(sheet.value?.currentHp).toBe(derived.maxHp.value)

    derived.setCurrentHp(-5)
    expect(sheet.value?.currentHp).toBe(0)
    expect(derived.currentHp.value).toBe(0)

    expect(derived.maxAp.value).toBeGreaterThan(0)
    expect(derived.tickValue.value).toBeGreaterThan(0)
    expect(derived.hpThresholds.value.half).toBeGreaterThan(0)
    expect(derived.trainerEvasion.value.speed.bonus).toBe(1)
  })

  it('derives stat point budgets and stat total lookup', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const derived = useTrainerSheetDerived(sheet)

    expect(derived.statPointsSpent.value).toBe(14)
    expect(derived.statPointsBudget.value).toBe(19)
    expect(derived.statPointsLeft.value).toBe(5)
    expect(derived.totalRow('atk')).toBe(8)
  })

  it('auto-adds trainer Struggle variants from capabilities and skips duplicates', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet({
      capabilities: { other: ['Zapper'] },
      movelist: [{ name: 'Struggle' }],
    }))
    const derived = useTrainerSheetDerived(sheet)

    expect(derived.moveRows.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ move: expect.objectContaining({ name: 'Struggle' }), automatic: false, sheetIndex: 0 }),
      expect.objectContaining({ move: expect.objectContaining({ name: 'Struggle (Zapper)' }), automatic: true, sheetIndex: null }),
    ]))
  })

  it('counts the 10 level-1 trainer stat points as spendable', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet({
      level: 1,
      stats: {
        def: { levelUp: 2 },
        sdef: { levelUp: 2 },
        spd: { levelUp: 5 },
        atk: { levelUp: 1 },
      },
    }))
    const derived = useTrainerSheetDerived(sheet)

    expect(derived.statPointsSpent.value).toBe(10)
    expect(derived.statPointsBudget.value).toBe(10)
    expect(derived.statPointsLeft.value).toBe(0)
  })
})
