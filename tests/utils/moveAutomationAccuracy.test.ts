import { describe, expect, it } from 'vitest'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const script = (damageClass: MoveAutomationScript['damageClass']): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass,
  type: 'Fire',
  ac: 2,
  range: '4, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 't',
  species: 'Target',
  slug: 'target',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'target',
  level: 10,
  currentHp: 40,
  maxHp: 40,
  atk: 5,
  satk: 5,
  def: 10,
  sdef: 10,
  spd: 30,
  evasion: { physical: 0, special: 1, speed: 0 },
  defenderTypes: ['Normal'],
  combatStages: stages,
  conditions: [],
  tokenItems: [],
  ...overrides,
})

describe('move automation accuracy helpers', () => {
  it('uses the best applicable target evasion for an accuracy check', () => {
    expect(resolveMoveAutomationTargetEvasion(script('Special'), token())).toMatchObject({
      value: 6,
      label: 'Speed Evasion',
    })

    expect(resolveMoveAutomationTargetEvasion(script('Special'), token({ conditions: ['Stuck'] }))).toMatchObject({
      value: 3,
      label: 'Special Evasion',
    })
  })

  it('suppresses evasion when conditions forbid it and exposes condition-adjusted user accuracy', () => {
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), token({ conditions: ['Vulnerable'] }))).toMatchObject({
      value: 0,
      suppressedByCondition: 'Vulnerable',
    })
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), token({ conditions: ['Bad SLeep'] }))).toMatchObject({
      value: 0,
      label: 'No Evasion (Bad Sleep)',
      suppressedByCondition: 'Bad Sleep',
    })
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 } }))).toBe(2)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 }, conditions: ['Blindness'] }))).toBe(-4)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 }, conditions: ['Total Blindness'] }))).toBe(-8)
  })

  it('adds Luck Incense to Pokémon accuracy rolls only', () => {
    expect(moveAutomationUserAccuracy(token({ tokenItems: ['Luck Incense'] }))).toBe(1)
    expect(moveAutomationUserAccuracy(token({ tokenItems: ['luck-incense'], combatStages: { ...stages, acc: 2 } }))).toBe(3)
    expect(moveAutomationUserAccuracy(token({ sheetKind: 'trainer', tokenItems: ['Luck Incense'] }))).toBe(0)
  })
})
