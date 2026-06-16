import { describe, expect, it } from 'vitest'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  explicitScriptForMove,
  moveAutomationCoverage,
  isSeamlessAreaConfirmationScript,
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
} from '~/utils/moveAutomation'

describe('explicit move automation scripts', () => {
  it('preserves the reviewed explicit coverage counts', () => {
    expect(moveAutomationCoverage.canonicalMoveCount).toBe(776)
    expect(moveAutomationCoverage.explicitScriptCount).toBe(243)
    expect(moveAutomationCoverage.missing).toHaveLength(533)
  })

  it('keeps representative pre-refactor scripts resolvable', () => {
    for (const moveName of ['Scratch', 'Ember', 'Growl', 'Reflect', 'Dragon Rage', 'Mud Bomb', 'Octazooka']) {
      expect(explicitScriptForMove(moveName)?.moveName).toBe(moveName)
    }
  })

  it('keeps known unsupported complex moves unautomated', () => {
    for (const moveName of ['Frost Breath', 'Storm Throw', 'Spacial Rend', 'Aura Wheel', 'Hammer Arm', 'Ice Hammer']) {
      expect(explicitScriptForMove(moveName)).toBeNull()
    }
  })

  it('implements Spore as a reviewed Powder status script', () => {
    const script = explicitScriptForMove('Spore')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Spore',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: false,
      requiresAccuracy: true,
      damageBase: null,
      damageClass: 'Status',
      type: 'Grass',
      range: '4, 1 Target, Powder',
    })
    expect(script?.keywords).toEqual(expect.arrayContaining(['Powder']))
    expect(script?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Sleep', action: 'add', label: 'Sleep' },
    ])
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })

  it('implements Earth Power as a reviewed Groundsource secondary-stage script', () => {
    const script = explicitScriptForMove('Earth Power')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Earth Power',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: true,
      requiresAccuracy: true,
      damageBase: 9,
      damageClass: 'Special',
      type: 'Ground',
      range: '6, 1 Target, Groundsource',
    })
    expect(script?.keywords).toEqual(expect.arrayContaining(['Groundsource']))
    expect(script?.stageSuggestions).toEqual([
      {
        recipient: 'target',
        key: 'sdef',
        delta: -1,
        label: 'Earth Power lowers Special Defense on 16+: -1 Special Defense CS',
        threshold: '16+',
        optional: true,
      },
    ])
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })

  it('keeps Chatter unautomated until Drown Out reaction support exists', () => {
    expect(explicitScriptForMove('Chatter')).toBeNull()
    expect(moveAutomationCoverage.missing).toContain('Chatter')
    expect(moveAutomationCoverage.missing).not.toContain('Spore')
    expect(moveAutomationCoverage.missing).not.toContain('Earth Power')
  })

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

  it('marks reviewed Pass attacks for seamless on-map Pass targeting', () => {
    const scratch = explicitScriptForMove('Scratch')
    const slash = explicitScriptForMove('Slash')
    const crossPoison = explicitScriptForMove('Cross Poison')
    const esperWing = explicitScriptForMove('Esper Wing')

    expect(scratch).toMatchObject({
      kind: 'explicit',
      moveName: 'Scratch',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      damageBase: 4,
    })
    expect(scratch?.areaTemplates).toEqual([{ kind: 'pass', size: 4, label: 'Pass 4' }])
    expect(isSeamlessAreaConfirmationScript(scratch)).toBe(true)
    expect(isSeamlessSingleTargetMoveScript(scratch)).toBe(false)

    expect(slash).toMatchObject({ moveName: 'Slash', targetMode: 'multi-target', criticalRange: 18 })
    expect(slash?.areaTemplates).toEqual([{ kind: 'pass', size: 4, label: 'Pass 4' }])
    expect(isSeamlessAreaConfirmationScript(slash)).toBe(true)

    expect(crossPoison).toMatchObject({
      moveName: 'Cross Poison',
      targetMode: 'multi-target',
      conditionSuggestions: [{ recipient: 'target', condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+', optional: true }],
    })
    expect(crossPoison?.areaTemplates).toEqual([{ kind: 'pass', size: 4, label: 'Pass 4' }])
    expect(isSeamlessAreaConfirmationScript(crossPoison)).toBe(true)

    expect(esperWing).toMatchObject({ moveName: 'Esper Wing', targetMode: 'multi-target', criticalRange: 18 })
    expect(esperWing?.areaTemplates).toEqual([{ kind: 'pass', size: 4, label: 'Pass 4' }])
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

  it('implements Decorate as a reviewed target stage script', () => {
    const script = explicitScriptForMove('Decorate')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Decorate',
      targetMode: 'one-target',
      targetCount: 1,
      damaging: false,
      requiresAccuracy: false,
      damageBase: null,
      damageClass: 'Status',
      type: 'Fairy',
      range: 'Melee, 1 Target',
    })
    expect(script?.stageSuggestions).toEqual([
      { recipient: 'target', key: 'atk', delta: 2, label: 'Decorate raises Attack: +2 Attack CS' },
      { recipient: 'target', key: 'satk', delta: 2, label: 'Decorate raises Special Attack: +2 Special Attack CS' },
    ])
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
    const snarl = explicitScriptForMove('Snarl')
    const heatWave = explicitScriptForMove('Heat Wave')
    const poisonGas = explicitScriptForMove('Poison Gas')
    const sludgeWave = explicitScriptForMove('Sludge Wave')
    const sweetScent = explicitScriptForMove('Sweet Scent')

    expect(tailWhip).toMatchObject({
      kind: 'explicit',
      moveName: 'Tail Whip',
      targetMode: 'multi-target',
      damaging: false,
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Tail Whip lowers Defense: -1 Defense CS' }],
    })
    expect(tailWhip?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(isSeamlessAreaConfirmationScript(tailWhip)).toBe(true)

    expect(snarl).toMatchObject({
      kind: 'explicit',
      moveName: 'Snarl',
      targetMode: 'multi-target',
      damaging: true,
      requiresAccuracy: true,
      damageBase: 6,
      damageClass: 'Special',
      type: 'Dark',
      ac: 3,
      stageSuggestions: [{ recipient: 'target', key: 'satk', delta: -1, label: 'Snarl lowers Special Attack: -1 Special Attack CS' }],
    })
    expect(snarl?.areaTemplates).toMatchObject([{ kind: 'cone', size: 2 }])
    expect(snarl?.keywords).toEqual(expect.arrayContaining(['Sonic']))
    expect(isSeamlessAreaConfirmationScript(snarl)).toBe(true)

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

    expect(sludgeWave).toMatchObject({
      kind: 'explicit',
      moveName: 'Sludge Wave',
      targetMode: 'multi-target',
      damaging: true,
      conditionSuggestions: [{ recipient: 'target', condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+', optional: true }],
    })
    expect(sludgeWave?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }, { kind: 'close-blast', size: 2 }])
    expect(isSeamlessAreaConfirmationScript(sludgeWave)).toBe(true)

    expect(sweetScent).toMatchObject({
      kind: 'explicit',
      moveName: 'Sweet Scent',
      targetMode: 'multi-target',
      damaging: false,
      requiresAccuracy: true,
      ac: 2,
      conditionSuggestions: [{ recipient: 'target', condition: 'Sweet Scent Evasion Penalty', label: 'Sweet Scent Evasion Penalty' }],
    })
    expect(sweetScent?.areaTemplates).toMatchObject([{ kind: 'burst', size: 2 }])
    expect(isSeamlessAreaConfirmationScript(sweetScent)).toBe(true)
  })

  it('keeps mixed single-target-or-area moves unautomated until mixed-mode targeting exists', () => {
    expect(explicitScriptForMove('Dragon Hammer')).toBeNull()
    expect(moveAutomationCoverage.missing).toContain('Dragon Hammer')
  })

  it('implements reviewed plain area damaging moves as AoE confirmations', () => {
    const expectedTemplates = new Map([
      ['Egg Bomb', [{ kind: 'ranged-blast', size: 2, range: 5 }]],
      ['Land’s Wrath', [{ kind: 'burst', size: 5 }]],
    ])

    for (const [moveName, areaTemplates] of expectedTemplates) {
      const script = explicitScriptForMove(moveName)

      expect(script).toMatchObject({
        kind: 'explicit',
        moveName,
        targetMode: 'multi-target',
        targetCount: null,
        damaging: true,
      })
      expect(script?.areaTemplates).toMatchObject(areaTemplates)
      expect(script?.conditionSuggestions).toEqual([])
      expect(script?.stageSuggestions).toEqual([])
      expect(script?.hpSuggestions).toEqual([])
      expect(script?.fieldSuggestions).toEqual([])
      expect(script?.hazardSuggestions).toEqual([])
      expect(isSeamlessAreaConfirmationScript(script)).toBe(true)
    }

    expect(explicitScriptForMove('Land’s Wrath')?.special).toBe('Grants Groundshaper')
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

    const taunt = explicitScriptForMove('Taunt')
    expect(taunt).toMatchObject({ moveName: 'Taunt', targetMode: 'one-target', damaging: false, requiresAccuracy: true })
    expect(taunt?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Rage', action: 'add', label: 'Enraged' },
    ])
    expect(isSeamlessSingleTargetMoveScript(taunt)).toBe(true)

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

    const howl = explicitScriptForMove('Howl')
    expect(howl).toMatchObject({ moveName: 'Howl', targetMode: 'multi-target', requiresAccuracy: false, damaging: false })
    expect(howl?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(howl?.stageSuggestions).toEqual([
      { recipient: 'user', key: 'atk', delta: 1, label: "Howl raises user's Attack: +1 Attack CS" },
      { recipient: 'target', key: 'atk', delta: 1, label: "Howl raises allies' Attack: +1 Attack CS" },
    ])
    expect(isSeamlessAreaConfirmationScript(howl)).toBe(true)

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
    expect(script?.directHpLoss?.kind === 'user-level-roll-table' ? script.directHpLoss.rollTable : []).toEqual([
      { roll: 1, multiplier: 0.5, label: 'Half user level' },
      { roll: 2, multiplier: 1, label: 'User level' },
      { roll: 3, multiplier: 1.5, label: 'One and a half times user level' },
      { roll: 4, multiplier: 2, label: 'Double user level' },
    ])
    expect(isSeamlessSingleTargetMoveScript(script)).toBe(true)
  })

  it('implements the requested Hassan moves as seamless explicit scripts', () => {
    expect(explicitScriptForMove('Knock Off')).toMatchObject({
      moveName: 'Knock Off',
      targetMode: 'one-target',
      damaging: true,
    })
    expect(explicitScriptForMove('Knock Off')?.automationNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('Held Items or Accessory Slot Items'),
    ]))
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Knock Off'))).toBe(true)

    expect(explicitScriptForMove('Pin Missile')).toMatchObject({
      moveName: 'Pin Missile',
      targetMode: 'one-target',
      dynamicDamageBase: { kind: 'five-strike', rollFormula: '1d8' },
    })
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Pin Missile'))).toBe(true)

    const acupressure = explicitScriptForMove('Acupressure')
    expect(acupressure).toMatchObject({
      moveName: 'Acupressure',
      targetMode: 'one-target',
      damaging: false,
      requiresAccuracy: true,
      randomStageSuggestion: { kind: 'roll-table', rollFormula: '1d6' },
    })
    expect(acupressure?.stageSuggestions).toHaveLength(6)
    expect(isSeamlessSingleTargetMoveScript(acupressure)).toBe(true)

    expect(explicitScriptForMove('Dragon Rage')).toMatchObject({
      moveName: 'Dragon Rage',
      targetMode: 'one-target',
      damaging: true,
      damageBase: null,
      criticalRange: null,
      directHpLoss: { kind: 'fixed', amount: 15, ignoreWeaknessResistance: true, ignoreStats: true },
      conditionSuggestions: [],
    })
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Dragon Rage'))).toBe(true)

    expect(explicitScriptForMove('Fury Attack')).toMatchObject({
      moveName: 'Fury Attack',
      dynamicDamageBase: { kind: 'five-strike', rollFormula: '1d8' },
    })
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Fury Attack'))).toBe(true)

    expect(explicitScriptForMove('Hone Claws')).toMatchObject({
      moveName: 'Hone Claws',
      targetMode: 'self',
      stageSuggestions: [
        { recipient: 'user', key: 'acc', delta: 1, label: 'Hone Claws raises Accuracy: +1 Accuracy CS' },
        { recipient: 'user', key: 'atk', delta: 1, label: 'Hone Claws raises Attack: +1 Attack CS' },
      ],
    })
    expect(isSeamlessSelfMoveScript(explicitScriptForMove('Hone Claws'))).toBe(true)

    expect(explicitScriptForMove('Power Trip')).toMatchObject({
      moveName: 'Power Trip',
      targetMode: 'one-target',
      dynamicDamageBase: { kind: 'positive-combat-stage-scaling', dbPerPositiveStage: 2, maxDamageBase: 20 },
    })
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Power Trip'))).toBe(true)

    expect(explicitScriptForMove('U-Turn')).toMatchObject({
      moveName: 'U-Turn',
      targetMode: 'one-target',
      damaging: true,
    })
    expect(explicitScriptForMove('U-Turn')?.automationNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('recalled immediately after damage'),
    ]))
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('U-Turn'))).toBe(true)
  })

  it('implements Synthesis, Razor Leaf, Magical Leaf, Reflect, Fury Swipes, and Double Kick as seamless scripts', () => {
    const synthesis = explicitScriptForMove('Synthesis')
    expect(synthesis).toMatchObject({
      moveName: 'Synthesis',
      targetMode: 'self',
      requiresAccuracy: false,
      hpSuggestions: [{
        recipient: 'user',
        mode: 'heal-percent-max',
        percent: 50,
        weatherPercentOverrides: { sunny: 200 / 3, rainy: 25, sandstorm: 25, hail: 25 },
        rounding: 'floor',
      }],
    })
    expect(isSeamlessSelfMoveScript(synthesis)).toBe(true)

    const razorLeaf = explicitScriptForMove('Razor Leaf')
    expect(razorLeaf).toMatchObject({
      moveName: 'Razor Leaf',
      targetMode: 'multi-target',
      damaging: true,
      requiresAccuracy: true,
      criticalRange: 18,
    })
    expect(razorLeaf?.areaTemplates).toMatchObject([{ kind: 'cone', size: 2 }])
    expect(isSeamlessAreaConfirmationScript(razorLeaf)).toBe(true)

    const magicalLeaf = explicitScriptForMove('Magical Leaf')
    expect(magicalLeaf).toMatchObject({
      moveName: 'Magical Leaf',
      targetMode: 'one-target',
      damaging: true,
      requiresAccuracy: false,
      damageBase: 6,
    })
    expect(isSeamlessSingleTargetMoveScript(magicalLeaf)).toBe(true)

    const reflect = explicitScriptForMove('Reflect')
    expect(reflect).toMatchObject({
      moveName: 'Reflect',
      targetMode: 'self',
      requiresAccuracy: false,
      conditionSuggestions: [{ recipient: 'user', condition: 'Reflect Blessing', label: 'Reflect Blessing (2 activations)' }],
    })
    expect(isSeamlessSelfMoveScript(reflect)).toBe(true)

    expect(explicitScriptForMove('Fury Swipes')).toMatchObject({
      moveName: 'Fury Swipes',
      targetMode: 'one-target',
      dynamicDamageBase: { kind: 'five-strike', rollFormula: '1d8' },
    })
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Fury Swipes'))).toBe(true)

    expect(explicitScriptForMove('Double Kick')).toMatchObject({
      moveName: 'Double Kick',
      targetMode: 'one-target',
      dynamicDamageBase: { kind: 'double-strike' },
    })
    expect(isSeamlessSingleTargetMoveScript(explicitScriptForMove('Double Kick'))).toBe(true)
  })
})
