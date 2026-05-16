import { describe, expect, it } from 'vitest'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  explicitScriptForMove,
  isSeamlessAreaConfirmationScript,
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
} from '~/utils/moveAutomation'

describe('explicit move automation scripts', () => {
  it('keeps every explicit script on a seamless map-targeting flow', () => {
    const nonSeamlessScripts = [...EXPLICIT_MOVE_AUTOMATION_SCRIPTS.values()].filter((script) =>
      !isSeamlessSingleTargetMoveScript(script) && !isSeamlessAreaConfirmationScript(script) && !isSeamlessSelfMoveScript(script),
    )

    expect(nonSeamlessScripts).toEqual([])
  })

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

  it('marks straightforward single-target attacks for seamless on-map targeting', () => {
    const script = explicitScriptForMove('Water Gun')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Water Gun',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: true,
      requiresAccuracy: true,
      damageBase: 4,
      type: 'Water',
      ac: 2,
    })
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })

  it('marks condition-only target moves for seamless on-map targeting', () => {
    const script = explicitScriptForMove('Will-O-Wisp')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Will-O-Wisp',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: false,
      requiresAccuracy: true,
      conditionSuggestions: [{ recipient: 'target', condition: 'Burned', action: 'add', label: 'Burned', optional: false }],
    })
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })

  it('uses reviewed condition thresholds when move text is ambiguous', () => {
    expect(explicitScriptForMove('Confusion')?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Confused', action: 'add', label: 'Confused on 19+', threshold: '19+', optional: true },
    ])
    expect(explicitScriptForMove('Poison Tail')?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Poisoned', action: 'add', label: 'Poisoned on 19+', threshold: '19+', optional: true },
    ])
    expect(explicitScriptForMove('Teeter Dance')?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Confused', action: 'add', label: 'Confused' },
    ])
  })

  it('implements reviewed stage-changing attacks with thresholds', () => {
    const script = explicitScriptForMove('Bubble Beam')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Bubble Beam',
      targetMode: 'one-target',
      damaging: true,
      stageSuggestions: [
        { recipient: 'target', key: 'spd', delta: -1, label: 'Bubble Beam lowers Speed on 18+: -1 Speed CS', threshold: '18+', optional: true },
      ],
    })
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })

  it('implements additional reviewed simple condition and stage scripts', () => {
    const astonish = explicitScriptForMove('Astonish')
    const sandAttack = explicitScriptForMove('Sand Attack')
    const mudShot = explicitScriptForMove('Mud Shot')
    const flatter = explicitScriptForMove('Flatter')

    expect(astonish).toMatchObject({
      kind: 'explicit',
      moveName: 'Astonish',
      targetMode: 'one-target',
      damaging: true,
      conditionSuggestions: [
        { recipient: 'target', condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+', optional: true },
      ],
    })
    expect(astonish?.automationNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('automatic Flinch against an unaware target is not inferred'),
    ]))
    expect(isSeamlessSingleTargetMoveScript(astonish)).toBe(true)

    expect(sandAttack).toMatchObject({
      kind: 'explicit',
      moveName: 'Sand Attack',
      damaging: false,
      conditionSuggestions: [{ recipient: 'target', condition: 'Blindness', label: 'Blindness' }],
    })
    expect(isSeamlessSingleTargetMoveScript(sandAttack)).toBe(true)

    expect(mudShot).toMatchObject({
      kind: 'explicit',
      moveName: 'Mud Shot',
      damaging: true,
      stageSuggestions: [{ recipient: 'target', key: 'spd', delta: -1, label: 'Mud Shot lowers Speed: -1 Speed CS' }],
    })
    expect(isSeamlessSingleTargetMoveScript(mudShot)).toBe(true)

    expect(flatter).toMatchObject({
      kind: 'explicit',
      moveName: 'Flatter',
      damaging: false,
      conditionSuggestions: [{ recipient: 'target', condition: 'Confused', label: 'Confused' }],
      stageSuggestions: [{ recipient: 'target', key: 'satk', delta: 1, label: 'Flatter raises Special Attack: +1 Special Attack CS' }],
    })
    expect(isSeamlessSingleTargetMoveScript(flatter)).toBe(true)
  })

  it('implements additional reviewed AoE confirmations without opening the wizard', () => {
    const tailWhip = explicitScriptForMove('Tail Whip')
    const heatWave = explicitScriptForMove('Heat Wave')
    const poisonGas = explicitScriptForMove('Poison Gas')

    expect(tailWhip).toMatchObject({
      kind: 'explicit',
      moveName: 'Tail Whip',
      targetMode: 'multi-target',
      damaging: false,
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Tail Whip lowers Defense: -1 Defense CS' }],
    })
    expect(tailWhip?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(isSeamlessAreaConfirmationScript(tailWhip)).toBe(true)

    expect(heatWave).toMatchObject({
      kind: 'explicit',
      moveName: 'Heat Wave',
      targetMode: 'multi-target',
      damaging: true,
      conditionSuggestions: [{ recipient: 'target', condition: 'Burned', threshold: '18+', optional: true }],
    })
    expect(heatWave?.areaTemplates).toMatchObject([{ kind: 'close-blast', size: 3 }])
    expect(isSeamlessAreaConfirmationScript(heatWave)).toBe(true)

    expect(poisonGas).toMatchObject({
      kind: 'explicit',
      moveName: 'Poison Gas',
      targetMode: 'multi-target',
      damaging: false,
      conditionSuggestions: [{ recipient: 'target', condition: 'Poisoned', label: 'Poisoned' }],
    })
    expect(poisonGas?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }, { kind: 'cone', size: 2 }])
    expect(isSeamlessAreaConfirmationScript(poisonGas)).toBe(true)
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

  it('implements the requested basic moves as seamless explicit scripts', () => {
    const tackle = explicitScriptForMove('Tackle')
    expect(tackle).toMatchObject({ moveName: 'Tackle', targetMode: 'one-target', damaging: true, requiresAccuracy: true })
    expect(tackle?.automationNotes).toEqual(expect.arrayContaining([expect.stringContaining('pushes the target 2 meters')]))
    expect(isSeamlessSingleTargetMoveScript(tackle)).toBe(true)

    const absorb = explicitScriptForMove('Absorb')
    expect(absorb).toMatchObject({ moveName: 'Absorb', targetMode: 'one-target', damaging: true })
    expect(absorb?.hpSuggestions).toEqual([
      { recipient: 'user', mode: 'heal-percent-damage-dealt', percent: 50, label: 'Absorb heals user for half damage dealt' },
    ])
    expect(isSeamlessSingleTargetMoveScript(absorb)).toBe(true)

    const swordsDance = explicitScriptForMove('Swords Dance')
    expect(swordsDance).toMatchObject({ moveName: 'Swords Dance', targetMode: 'self', requiresAccuracy: false })
    expect(swordsDance?.stageSuggestions).toEqual([
      { recipient: 'user', key: 'atk', delta: 2, label: 'Swords Dance raises Attack: +2 Attack CS' },
    ])
    expect(isSeamlessSelfMoveScript(swordsDance)).toBe(true)

    const furyCutter = explicitScriptForMove('Fury Cutter')
    expect(furyCutter).toMatchObject({ moveName: 'Fury Cutter', targetMode: 'one-target', damaging: true })
    expect(furyCutter?.automationNotes).toEqual(expect.arrayContaining([expect.stringContaining('Damage Base scaling is not inferred')]))
    expect(isSeamlessSingleTargetMoveScript(furyCutter)).toBe(true)

    const supersonic = explicitScriptForMove('Supersonic')
    expect(supersonic).toMatchObject({ moveName: 'Supersonic', targetMode: 'one-target', damaging: false, requiresAccuracy: true })
    expect(supersonic?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Confused', action: 'add', label: 'Confused on hit' },
      { recipient: 'target', condition: 'Supersonic Accuracy Penalty', action: 'add', label: 'Supersonic miss accuracy penalty', applyWhen: 'miss' },
    ])
    expect(isSeamlessSingleTargetMoveScript(supersonic)).toBe(true)

    const torment = explicitScriptForMove('Torment')
    expect(torment?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Suppressed', action: 'add', label: 'Suppressed' },
    ])
    expect(isSeamlessSingleTargetMoveScript(torment)).toBe(true)

    const sandTomb = explicitScriptForMove('Sand Tomb')
    expect(sandTomb).toMatchObject({ moveName: 'Sand Tomb', targetMode: 'one-target', damaging: true })
    expect(sandTomb?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Slowed', action: 'add', label: 'Vortex slows target' },
      { recipient: 'target', condition: 'Trapped', action: 'add', label: 'Vortex traps target' },
    ])
    expect(isSeamlessSingleTargetMoveScript(sandTomb)).toBe(true)

    const helpingHand = explicitScriptForMove('Helping Hand')
    expect(helpingHand).toMatchObject({ moveName: 'Helping Hand', targetMode: 'one-target', requiresAccuracy: false })
    expect(helpingHand?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Helping Hand', action: 'add', label: 'Helping Hand bonus' },
    ])
    expect(isSeamlessSingleTargetMoveScript(helpingHand)).toBe(true)

    const fakeOut = explicitScriptForMove('Fake Out')
    expect(fakeOut).toMatchObject({ moveName: 'Fake Out', targetMode: 'one-target', damaging: true })
    expect(fakeOut?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Flinch', action: 'add', label: 'Fake Out flinches on hit' },
    ])
    expect(isSeamlessSingleTargetMoveScript(fakeOut)).toBe(true)

    const mudSport = explicitScriptForMove('Mud Sport')
    expect(mudSport).toMatchObject({ moveName: 'Mud Sport', targetMode: 'multi-target', requiresAccuracy: false, damaging: false })
    expect(mudSport?.areaTemplates).toMatchObject([{ kind: 'burst', size: 2 }])
    expect(mudSport?.conditionSuggestions).toEqual([
      { recipient: 'user', condition: 'Electric-Resistant Coat', action: 'add', label: 'Mud Sport grants Electric-Resistant Coat' },
      { recipient: 'target', condition: 'Electric-Resistant Coat', action: 'add', label: 'Mud Sport grants Electric-Resistant Coat' },
    ])
    expect(isSeamlessAreaConfirmationScript(mudSport)).toBe(true)
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
