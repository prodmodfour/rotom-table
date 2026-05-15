import { describe, expect, it } from 'vitest'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  computeDefaultTrainerCapabilities,
  computeTrainerFullMaxHp,
  computeTrainerMaxAp,
  computeTrainerMaxHp,
  resolveAdvancement,
  resolveTrainerCapabilities,
  resolveTrainerSkills,
  resolveTrainerStats,
} from '~/utils/sheets/trainerDerived'

const makeTrainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'test-trainer',
  name: 'Test Trainer',
  level: 10,
  ...overrides,
})

describe('trainer sheet derived helpers', () => {
  it('resolves stat defaults, overrides, combat stages, and HP formulas', () => {
    const sheet = makeTrainer({
      currentInjuries: 1,
      stats: { hp: { levelUp: 2 }, spd: { base: 7, feats: 1, bonus: 2, levelUp: 3 } },
      combatStages: { spd: 4 },
    })

    const stats = resolveTrainerStats(sheet)

    expect(stats.find((row) => row.key === 'hp')).toMatchObject({ base: 10, levelUp: 2, total: 12 })
    expect(stats.find((row) => row.key === 'spd')).toMatchObject({
      base: 7,
      feats: 1,
      bonus: 2,
      levelUp: 3,
      stage: 4,
      total: 13,
    })
    expect(computeTrainerFullMaxHp(sheet)).toBe(66)
    expect(computeTrainerMaxHp(sheet)).toBe(59)
  })

  it('resolves AP from level unless an override is present', () => {
    expect(computeTrainerMaxAp(makeTrainer({ level: 14 }))).toBe(7)
    expect(computeTrainerMaxAp(makeTrainer({ level: 14, ap: { max: 12 } }))).toBe(12)
  })

  it('applies skill background and explicit skill overrides', () => {
    const skills = resolveTrainerSkills(makeTrainer({
      skillBackground: { adept: 'command', novice: ['focus'], pathetic: ['stealth'] },
      skills: { combat: { rank: 'Master', modifier: 2 } },
    }))

    expect(skills.find((row) => row.key === 'command')).toMatchObject({ rank: 'Adept', dice: '4d6', raised: true })
    expect(skills.find((row) => row.key === 'focus')).toMatchObject({ rank: 'Novice', dice: '3d6', raised: true })
    expect(skills.find((row) => row.key === 'stealth')).toMatchObject({ rank: 'Pathetic', dice: '1d6', lowered: true })
    expect(skills.find((row) => row.key === 'combat')).toMatchObject({ rank: 'Master', rankValue: 6, modifier: 2 })
  })

  it('computes default trainer capabilities from skill ranks using Core formulas', () => {
    const capabilities = computeDefaultTrainerCapabilities(makeTrainer({
      skillBackground: { adept: 'acrobatics', novice: 'athletics' },
      skills: { combat: { rank: 'Adept' } },
    }))

    expect(capabilities).toEqual({
      overland: 6,
      throwingRange: 7,
      highJump: 1,
      longJump: 2,
      swim: 3,
      power: 6,
    })
  })

  it('resolves default and optional capabilities', () => {
    const capabilities = resolveTrainerCapabilities(makeTrainer({
      capabilities: { overland: 8, sky: 4, other: ['Aura Reader'] },
    }))

    expect(capabilities.rows).toContainEqual({ label: 'Overland', value: 8 })
    expect(capabilities.rows).toContainEqual({ label: 'Throwing Range', value: 6 })
    expect(capabilities.rows).toContainEqual({ label: 'Sky', value: 4 })
    expect(capabilities.other).toEqual(['Aura Reader'])
  })

  it('fills advancement milestones with persisted rows', () => {
    const advancement = resolveAdvancement(makeTrainer({ advancement: [{ level: 20, stats: 2, notes: 'Boost' }] }))

    expect(advancement.map((row) => row.level)).toEqual([5, 10, 20, 30, 40])
    expect(advancement[2]).toEqual({ level: 20, stats: 2, notes: 'Boost' })
  })
})
