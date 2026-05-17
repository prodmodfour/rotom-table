import { describe, expect, it } from 'vitest'
import {
  buildMoveAutomationScriptFromMoveData,
  damageFormulaForMove,
  sheetMoveToMoveLike,
} from '~/utils/moveAutomation'
import { coerceMoveAccuracy, coerceMoveDamageBase } from '~/utils/moveAutomationCoercion'


describe('move automation derived resolution helpers', () => {
  it('coerces move numeric fields compatibly', () => {
    expect(coerceMoveAccuracy('4.8')).toBe(4)
    expect(coerceMoveAccuracy('--')).toBeNull()
    expect(coerceMoveAccuracy('bad')).toBeNull()
    expect(coerceMoveDamageBase('6.9')).toBe(6)
    expect(coerceMoveDamageBase('bad')).toBeNull()
  })

  it('builds damaging one-target scripts with damage and range metadata', () => {
    const script = buildMoveAutomationScriptFromMoveData({
      name: 'Test Strike',
      type: 'Fire',
      ac: '4',
      damage_base: 6,
      damage_class: 'Physical',
      range: 'Melee, 1 Target',
      effect: 'Critical Hit on 18+.',
    })

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Test Strike',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: true,
      requiresAccuracy: true,
      damageBase: 6,
      damageClass: 'Physical',
      type: 'Fire',
      ac: 4,
      criticalRange: 18,
    })
    expect(script.keywords).toEqual(['Melee'])
  })

  it('extracts condition and combat-stage suggestions from effect text', () => {
    const script = buildMoveAutomationScriptFromMoveData({
      name: 'Test Debuff',
      type: 'Fire',
      ac: 3,
      damage_base: 4,
      damage_class: 'Special',
      range: '6, 1 Target',
      effect: "On 15+, the target is Burned. The target's Defense is lowered by 1 Combat Stage.",
    })

    expect(script.conditionSuggestions).toContainEqual(expect.objectContaining({
      recipient: 'target',
      condition: 'Burned',
      action: 'add',
      threshold: '15+',
      optional: true,
    }))
    expect(script.stageSuggestions).toContainEqual(expect.objectContaining({
      recipient: 'target',
      key: 'def',
      delta: -1,
    }))
  })

  it('extracts field, hazard, and HP suggestions', () => {
    expect(buildMoveAutomationScriptFromMoveData({ name: 'Sunny Day', range: 'Field, Weather', effect: '' }).fieldSuggestions)
      .toContainEqual(expect.objectContaining({ kind: 'weather', value: 'sunny' }))

    const hazardScript = buildMoveAutomationScriptFromMoveData({ name: 'Toxic Spikes', range: 'Hazard', effect: '' })
    expect(hazardScript.targetMode).toBe('hazard')
    expect(hazardScript.hazardSuggestions).toContainEqual(expect.objectContaining({
      kind: 'toxic-spikes',
      squares: 8,
    }))

    const restScript = buildMoveAutomationScriptFromMoveData({
      name: 'Rest',
      range: 'Self',
      effect: 'The user is set to their full Hit Point value.',
    })
    expect(restScript.targetMode).toBe('self')
    expect(restScript.hpSuggestions).toContainEqual(expect.objectContaining({
      recipient: 'user',
      mode: 'heal-percent-max',
      percent: 100,
    }))
  })

  it('keeps public move conversion and damage formula exports compatible', () => {
    expect(damageFormulaForMove({ name: 'Roll Move', damage_roll: '2d6+8 / alternate', damage_base: 4 })).toBe('2d6+8')
    expect(damageFormulaForMove({ name: 'DB Move', damage_base: 6 })).toBe('2d6+8')
    expect(damageFormulaForMove({ name: 'No Damage' })).toBeNull()

    expect(sheetMoveToMoveLike({
      name: 'Packed Move',
      type: 'Water',
      frequency: 'At-Will',
      ac: 2,
      db: 4,
      damageRoll: '1d8+6',
      category: 'Special',
      range: '6, 1 Target',
      effect: 'None',
    })).toEqual({
      name: 'Packed Move',
      type: 'Water',
      frequency: 'At-Will',
      ac: 2,
      damage_base: 4,
      damage_roll: '1d8+6',
      damage_class: 'Special',
      range: '6, 1 Target',
      effect: 'None',
    })
  })
})
