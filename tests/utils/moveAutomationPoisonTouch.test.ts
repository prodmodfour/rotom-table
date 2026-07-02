import { describe, expect, it } from 'vitest'
import {
  moveAutomationScriptWithPoisonTouch,
  poisonTouchAdjustedThreshold,
  tokenHasPoisonTouch,
} from '~/utils/moveAutomationPoisonTouch'
import { resolveInstantMoveAutomation } from '~/utils/moveAutomationInstant'
import { accuracyRollMeetsMoveThreshold, naturalRollMeetsMoveThreshold } from '~/utils/moveAutomationThresholds'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token',
  species: 'Token',
  slug: 'token',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/token.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'token',
  position: { x: 0, y: 0, z: 0 },
  level: 10,
  currentHp: 40,
  maxHp: 40,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  spd: 5,
  evasion: { physical: 0, special: 0, speed: 0 },
  defenderTypes: ['Normal'],
  combatStages: stages,
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Tackle',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: '',
  keywords: ['Melee'],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const sequenceRandom = (values: number[]) => {
  let index = 0
  return () => values[index++] ?? 0
}

describe('move automation Poison Touch', () => {
  it('marks Poison Touch as a canonical passive ability', () => {
    expect(tokenHasPoisonTouch(token({ abilityNames: ['poison touch'] }))).toBe(true)
    expect(tokenHasPoisonTouch(token({ abilityNames: ['Poison Point'] }))).toBe(false)
  })

  it('adds a 19+ poison effect to damaging accuracy moves', () => {
    const base = script()
    const boosted = moveAutomationScriptWithPoisonTouch(base, token({ abilityNames: ['Poison Touch'] }))

    expect(boosted).not.toBe(base)
    expect(boosted.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Poisoned',
      action: 'add',
      label: 'Poison Touch: Poisoned on 19+',
      threshold: '19+',
    }])
  })

  it('widens existing poison effect ranges by two without duplicating Poison Touch', () => {
    const base = script({
      moveName: 'Poison Sting',
      conditionSuggestions: [{ recipient: 'target', condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+', optional: true }],
    })

    const boosted = moveAutomationScriptWithPoisonTouch(base, token({ abilityNames: ['Poison Touch'] }))
    const boostedAgain = moveAutomationScriptWithPoisonTouch(boosted, token({ abilityNames: ['Poison Touch'] }))

    expect(boosted.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Poisoned',
      label: 'Poisoned on 17+ (Poison Touch)',
      threshold: '17+',
      optional: true,
    }])
    expect(boostedAgain.conditionSuggestions).toEqual(boosted.conditionSuggestions)
  })

  it('adjusts supported threshold shapes for poison chance boosts', () => {
    expect(poisonTouchAdjustedThreshold('19+')).toBe('17+')
    expect(poisonTouchAdjustedThreshold('18-20')).toBe('16-20')
    expect(poisonTouchAdjustedThreshold('even roll')).toBe('even roll or 17+')
    expect(naturalRollMeetsMoveThreshold('even roll or 17+', 17)).toBe(true)
    expect(naturalRollMeetsMoveThreshold('even roll or 17+', 18)).toBe(true)
    expect(naturalRollMeetsMoveThreshold('even roll or 17+', 19)).toBe(true)
    expect(naturalRollMeetsMoveThreshold('even roll or 17+', 15)).toBe(false)
    expect(accuracyRollMeetsMoveThreshold('19+', '3, 19')).toBe(true)
  })

  it('applies Poison Touch during instant move resolution', () => {
    const result = resolveInstantMoveAutomation({
      script: script(),
      user: token({ id: 'u', species: 'Grimer', abilityNames: ['Poison Touch'] }),
      target: token({ id: 't', species: 'Target', conditions: ['Burned'] }),
      damageFormula: null,
      random: sequenceRandom([0.9]),
    })

    expect(result.feedback.conditions).toEqual([{ condition: 'Poisoned', applied: true }])
    expect(result.transaction.conditionUpdates).toEqual([{ id: 't', conditions: ['Burned', 'Poisoned'] }])
  })

  it('does not poison below the Poison Touch threshold', () => {
    const result = resolveInstantMoveAutomation({
      script: script(),
      user: token({ id: 'u', species: 'Grimer', abilityNames: ['Poison Touch'] }),
      target: token({ id: 't', species: 'Target' }),
      damageFormula: null,
      random: sequenceRandom([0.85]),
    })

    expect(result.feedback.conditions).toEqual([])
    expect(result.transaction.conditionUpdates).toEqual([])
  })
})
