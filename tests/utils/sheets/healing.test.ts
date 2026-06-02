import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  MAX_INJURIES_HEALED_PER_DAY,
  applyPokemonCenterRecovery,
  applyPokemonFullRecovery,
  applyPokemonNextDay,
  applyTrainerNextDay,
  computePokemonHealingVitals,
  computeTrainerHealingVitals,
  removePokemonInjuries,
  setPokemonInjuries,
} from '~/utils/sheets/healing'

describe('sheet healing helpers', () => {
  it('advances a pokemon sheet to the next day', () => {
    const sheet: CharacterSheet = {
      slug: 'testmon',
      nickname: 'Testmon',
      species: '',
      level: 10,
      stats: { hp: { added: 10 } },
      combat: { currentHp: 5, injuries: 1, conditions: ['Burned'] },
      moveUsage: { daily: { rest: { moveName: 'Rest', uses: 1 } } },
    }

    const summary = applyPokemonNextDay(sheet)

    expect(sheet.combat?.injuries).toBe(0)
    expect(sheet.combat?.currentHp).toBe(computePokemonHealingVitals(sheet).maxHp)
    expect(sheet.combat?.conditions).toEqual([])
    expect(sheet.moveUsage).toBeUndefined()
    expect(summary).toMatchObject({
      injuriesHealed: 1,
      dailyMoveUsesCleared: 1,
      conditionsCleared: 1,
    })
    expect(summary.hitPointsRestored).toBeGreaterThan(0)
  })

  it('applies pokemon center recovery without clearing more than 3 injuries', () => {
    const sheet: CharacterSheet = {
      slug: 'center-test',
      nickname: 'Center Test',
      species: '',
      level: 10,
      stats: { hp: { added: 10 } },
      combat: { currentHp: 1, injuries: 5, conditions: ['Paralysis'] },
      moveUsage: { daily: { rest: { moveName: 'Rest', uses: 1 } } },
    }

    const summary = applyPokemonCenterRecovery(sheet)

    expect(sheet.combat?.injuries).toBe(2)
    expect(sheet.combat?.currentHp).toBe(computePokemonHealingVitals(sheet).maxHp)
    expect(sheet.combat?.conditions).toEqual([])
    expect(sheet.moveUsage).toBeUndefined()
    expect(summary.injuriesHealed).toBe(3)
    expect(summary.dailyMoveUsesCleared).toBe(1)
    expect(summary.conditionsCleared).toBe(1)
    expect(summary.hitPointsRestored).toBeGreaterThan(0)
    expect(sheet.combat?.injuriesHealedToday).toBe(MAX_INJURIES_HEALED_PER_DAY)
  })

  it('caps pokemon injury restoration to the remaining daily allowance', () => {
    const sheet: CharacterSheet = {
      slug: 'daily-cap-test',
      nickname: 'Daily Cap Test',
      species: '',
      level: 10,
      stats: { hp: { added: 10 } },
      combat: { currentHp: 1, injuries: 5, injuriesHealedToday: 2 },
    }

    const first = applyPokemonCenterRecovery(sheet)
    const second = applyPokemonCenterRecovery(sheet)

    expect(sheet.combat?.injuries).toBe(4)
    expect(sheet.combat?.injuriesHealedToday).toBe(MAX_INJURIES_HEALED_PER_DAY)
    expect(first.injuriesHealed).toBe(1)
    expect(second.injuriesHealed).toBe(0)
    expect(computePokemonHealingVitals(sheet)).toMatchObject({
      injuriesHealedToday: MAX_INJURIES_HEALED_PER_DAY,
      injuryHealsRemainingToday: 0,
    })
  })

  it('applies the daily injury cap to manual and full recovery injury removal', () => {
    const sheet: CharacterSheet = {
      slug: 'manual-cap-test',
      nickname: 'Manual Cap Test',
      species: '',
      level: 10,
      stats: { hp: { added: 10 } },
      combat: { currentHp: 1, injuries: 5, injuriesHealedToday: 1 },
    }

    expect(setPokemonInjuries(sheet, 0)).toBe(3)
    expect(sheet.combat?.injuriesHealedToday).toBe(MAX_INJURIES_HEALED_PER_DAY)
    expect(removePokemonInjuries(sheet, 1)).toBe(0)

    const fullRecovery = applyPokemonFullRecovery(sheet)
    expect(sheet.combat?.injuries).toBe(3)
    expect(fullRecovery.injuriesHealed).toBe(0)
    expect(sheet.combat?.currentHp).toBe(computePokemonHealingVitals(sheet).maxHp)
  })

  it('allows explicit manual injury-removal overrides to ignore the daily cap', () => {
    const sheet: CharacterSheet = {
      slug: 'manual-override-test',
      nickname: 'Manual Override Test',
      species: '',
      level: 10,
      stats: { hp: { added: 10 } },
      combat: { currentHp: 1, injuries: 5, injuriesHealedToday: MAX_INJURIES_HEALED_PER_DAY },
    }

    expect(removePokemonInjuries(sheet, 2, { ignoreDailyLimit: true })).toBe(2)
    expect(sheet.combat?.injuries).toBe(3)
    expect(sheet.combat?.injuriesHealedToday).toBe(MAX_INJURIES_HEALED_PER_DAY)
    expect(setPokemonInjuries(sheet, 0, { ignoreDailyLimit: true })).toBe(0)
    expect(sheet.combat?.injuriesHealedToday).toBe(MAX_INJURIES_HEALED_PER_DAY)
  })

  it('starts a new injury-healing allowance on the next day before natural injury healing', () => {
    const sheet: TrainerSheet = {
      slug: 'new-day-cap-test',
      name: 'New Day Cap Test',
      level: 5,
      currentHp: 1,
      currentInjuries: 5,
      injuriesHealedToday: MAX_INJURIES_HEALED_PER_DAY,
    }

    const summary = applyTrainerNextDay(sheet)

    expect(sheet.currentInjuries).toBe(4)
    expect(sheet.injuriesHealedToday).toBe(1)
    expect(summary.injuriesHealed).toBe(1)
    expect(summary.hitPointsRestored).toBeGreaterThan(0)
  })

  it('does not naturally restore HP on next day while still at 5 injuries', () => {
    const sheet: TrainerSheet = {
      slug: 'injured-trainer',
      name: 'Injured Trainer',
      level: 5,
      currentHp: 5,
      currentInjuries: 6,
      ap: { left: 1, bound: 2, spent: 1, drained: 1 },
    }

    const summary = applyTrainerNextDay(sheet)

    expect(sheet.currentInjuries).toBe(5)
    expect(sheet.currentHp).toBe(5)
    expect(sheet.ap).toMatchObject({ left: 4, bound: 2, spent: 0, drained: 0 })
    expect(computeTrainerHealingVitals(sheet).maxHp).toBeGreaterThan(sheet.currentHp ?? 0)
    expect(summary.injuriesHealed).toBe(1)
    expect(summary.hitPointsRestored).toBe(0)
    expect(summary.trainerApRestored).toBe(3)
  })
})
