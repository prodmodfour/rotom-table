import { describe, expect, it } from 'vitest'
import { explicitScriptForMove, isSeamlessAreaConfirmationScript, isSeamlessSingleTargetMoveScript } from '~/utils/moveAutomation'

describe('explicit move automation scripts', () => {
  it('implements Growl as a reviewed Burst Attack-lowering AoE script', () => {
    const script = explicitScriptForMove('Growl')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Growl',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: false,
      requiresAccuracy: true,
      ac: 2,
    })
    expect(script?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(script?.stageSuggestions).toEqual([{ recipient: 'target', key: 'atk', delta: -1, label: 'Growl lowers Attack: -1 Attack CS' }])
  })

  it('implements Leer as a reviewed Cone Defense-lowering AoE script', () => {
    const script = explicitScriptForMove('Leer')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Leer',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: false,
      requiresAccuracy: true,
      ac: 2,
    })
    expect(script?.areaTemplates).toMatchObject([{ kind: 'cone', size: 2 }])
    expect(script?.stageSuggestions).toEqual([{ recipient: 'target', key: 'def', delta: -1, label: 'Leer lowers Defense: -1 Defense CS' }])
  })

  it('implements Smog as a reviewed Line 2 damaging AoE with even-roll poison', () => {
    const script = explicitScriptForMove('Smog')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Smog',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      damageBase: 3,
      damageClass: 'Special',
      type: 'Poison',
      ac: 7,
    })
    expect(script?.areaTemplates).toMatchObject([{ kind: 'line', size: 2 }])
    expect(script?.conditionSuggestions).toEqual([
      {
        recipient: 'target',
        condition: 'Poisoned',
        action: 'add',
        label: 'Poisoned on even roll',
        threshold: 'even roll',
        optional: true,
      },
    ])
    expect(isSeamlessAreaConfirmationScript(script)).toBe(true)
  })

  it('implements Psywave as reviewed level-scaled direct HP loss', () => {
    const script = explicitScriptForMove('Psywave')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Psywave',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: true,
      requiresAccuracy: true,
      damageBase: null,
      damageClass: 'Special',
      type: 'Psychic',
      ac: 5,
      criticalRange: null,
      directHpLoss: {
        kind: 'user-level-roll-table',
        rollFormula: '1d4',
        applyTypeImmunity: true,
        ignoreWeaknessResistance: true,
        ignoreStats: true,
      },
    })
    expect(script?.directHpLoss?.rollTable).toEqual([
      { roll: 1, multiplier: 0.5, label: 'Half user level' },
      { roll: 2, multiplier: 1, label: 'User level' },
      { roll: 3, multiplier: 1.5, label: 'One and a half times user level' },
      { roll: 4, multiplier: 2, label: 'Double user level' },
    ])
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })
})
