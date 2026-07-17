import { describe, expect, it } from 'vitest'
import {
  moveAutomationHitChanceTone,
  moveAutomationTargetHitChance,
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

  it('derives Pokémon physical and special Evasion from Wonder Room stat overlays', () => {
    const target = token({
      def: 5,
      sdef: 15,
      spd: 0,
      evasion: { physical: 0, special: 0, speed: 0 },
      combatStages: { ...stages, def: 1, sdef: -1 },
    })
    const trainer = token({
      sheetKind: 'trainer',
      entityKind: 'trainer',
      def: 5,
      sdef: 15,
      spd: 0,
      evasion: { physical: 0, special: 0, speed: 0 },
    })
    const fieldEffects = {
      weather: [],
      terrains: [],
      rooms: [{ kind: 'wonder' as const }],
    }

    const clearPhysical = resolveMoveAutomationTargetEvasion(script('Physical'), target)
    const clearSpecial = resolveMoveAutomationTargetEvasion(script('Special'), target)
    const wonderedPhysical = resolveMoveAutomationTargetEvasion(
      script('Physical'),
      target,
      { fieldEffects },
    )
    const wonderedSpecial = resolveMoveAutomationTargetEvasion(
      script('Special'),
      target,
      { fieldEffects },
    )

    expect(wonderedPhysical.value).toBe(clearSpecial.value)
    expect(wonderedSpecial.value).toBe(clearPhysical.value)
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), trainer, { fieldEffects }))
      .toEqual(resolveMoveAutomationTargetEvasion(script('Physical'), trainer))
  })

  it('applies Quick Feet to statused target Speed Evasion', () => {
    expect(resolveMoveAutomationTargetEvasion(script('Special'), token({
      spd: 20,
      conditions: ['Paralysis'],
      abilityNames: ['Quick Feet'],
    }))).toMatchObject({
      value: 5,
      label: 'Speed Evasion',
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
    expect(moveAutomationUserAccuracy(token({ combatStages: {} as CombatStageMap }))).toBe(0)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 99 } }))).toBe(6)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 } }))).toBe(2)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 }, accuracyRollBonus: 1 }))).toBe(3)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 }, activeTrainingFeature: 'Focused Training' }))).toBe(3)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 }, conditions: ['Blindness'] }))).toBe(-4)
    expect(moveAutomationUserAccuracy(token({ combatStages: { ...stages, acc: 2 }, conditions: ['Total Blindness'] }))).toBe(-8)
  })

  it('applies Keen Eye to outgoing Accuracy and target Evasion', () => {
    expect(moveAutomationUserAccuracy(token({
      abilityNames: ['Keen Eye'],
      combatStages: { ...stages, acc: -3 },
      conditions: ['Blindness'],
    }))).toBe(0)
    expect(moveAutomationUserAccuracy(token({
      abilityNames: ['Keen Eye'],
      combatStages: { ...stages, acc: -3 },
      conditions: ['Total Blindness'],
    }))).toBe(-10)

    const attacker = token({ id: 'user', abilityNames: ['Keen Eye'] })
    const evasiveTarget = token({
      def: 10,
      sdef: 10,
      spd: 10,
      evasion: { physical: 4, special: 4, speed: 4 },
    })
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), evasiveTarget)).toMatchObject({
      value: 6,
      label: 'Physical Evasion',
    })
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), evasiveTarget, { attacker })).toMatchObject({
      value: 2,
      label: 'Physical Evasion',
    })

    const illuminatedTarget = token({
      abilityNames: ['Illuminate'],
      def: 10,
      spd: 10,
      evasion: { physical: 0, special: 0, speed: 0 },
    })
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), illuminatedTarget)).toMatchObject({
      value: 4,
      label: 'Physical Evasion (Illuminate +2)',
      abilityModifier: 2,
    })
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), illuminatedTarget, { attacker })).toMatchObject({
      value: 2,
      label: 'Physical Evasion',
      abilityModifier: 0,
    })
  })

  it('applies Compound Eyes to outgoing Accuracy Rolls', () => {
    expect(moveAutomationUserAccuracy(token({ abilityNames: ['Compound Eyes'] }))).toBe(3)
    expect(moveAutomationUserAccuracy(token({ abilityNames: ['compound-eyes'], combatStages: { ...stages, acc: 6 } }))).toBe(9)
    expect(resolveMoveAutomationTargetEvasion(script('Physical'), token({
      abilityNames: ['Compound Eyes'],
      def: 0,
      spd: 0,
      evasion: { physical: 0, special: 0, speed: 0 },
    }))).toMatchObject({
      value: 0,
      label: 'Physical Evasion',
      abilityModifier: 0,
    })
  })

  it('applies No Guard as outgoing Accuracy and incoming pseudo-Evasion modifiers', () => {
    expect(moveAutomationUserAccuracy(token({ abilityNames: ['No Guard'] }))).toBe(3)
    expect(moveAutomationUserAccuracy(token({ abilityNames: ['no-guard'], combatStages: { ...stages, acc: 6 } }))).toBe(9)

    expect(resolveMoveAutomationTargetEvasion(script('Physical'), token({
      abilityNames: ['No Guard'],
      def: 0,
      spd: 0,
      evasion: { physical: 0, special: 0, speed: 0 },
    }))).toMatchObject({
      value: -3,
      label: 'Physical Evasion (No Guard -3)',
      abilityModifier: -3,
    })

    expect(resolveMoveAutomationTargetEvasion(script('Physical'), token({
      abilityNames: ['No Guard'],
      conditions: ['Vulnerable'],
    }))).toMatchObject({
      value: -3,
      label: 'No Evasion (Vulnerable) (No Guard -3)',
      suppressedByCondition: 'Vulnerable',
    })
  })

  it('adds Luck Incense to Pokémon accuracy rolls only', () => {
    expect(moveAutomationUserAccuracy(token({ tokenItems: ['Luck Incense'] }))).toBe(1)
    expect(moveAutomationUserAccuracy(token({ tokenItems: ['luck-incense'], combatStages: { ...stages, acc: 2 } }))).toBe(3)
    expect(moveAutomationUserAccuracy(token({ sheetKind: 'trainer', tokenItems: ['Luck Incense'] }))).toBe(0)
  })

  it('builds target-specific hit chance badge data', () => {
    const chance = moveAutomationTargetHitChance(script('Physical'), token({ id: 'user', species: 'User', combatStages: { ...stages, acc: 2 } }), token())

    expect(chance).toMatchObject({
      targetId: 't',
      percent: 75,
      label: '75%',
      tone: 'medium',
    })
    expect(chance.title).toContain('AC 2 + Speed Evasion 6; user Accuracy +2')
    expect(moveAutomationHitChanceTone(45)).toBe('low')
    expect(moveAutomationHitChanceTone(50)).toBe('medium')
    expect(moveAutomationHitChanceTone(79)).toBe('medium')
    expect(moveAutomationHitChanceTone(80)).toBe('high')
  })
})
