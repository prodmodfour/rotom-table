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
    expect(moveAutomationCoverage.explicitScriptCount).toBe(257)
    expect(moveAutomationCoverage.missing).toHaveLength(519)
  })

  it('keeps representative pre-refactor scripts resolvable', () => {
    for (const moveName of ['Scratch', 'Ember', 'Growl', 'Reflect', 'Dragon Rage', 'Mud Bomb', 'Octazooka']) {
      expect(explicitScriptForMove(moveName)?.moveName).toBe(moveName)
    }
  })

  it('keeps known unsupported complex moves unautomated', () => {
    for (const moveName of ['Frost Breath', 'Storm Throw', 'Spacial Rend', 'Aura Wheel', 'Hammer Arm', 'Ice Hammer', 'Topsy-Turvy']) {
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
    const healBell = explicitScriptForMove('Heal Bell')

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

    expect(healBell).toMatchObject({
      kind: 'explicit',
      moveName: 'Heal Bell',
      targetMode: 'multi-target',
      damaging: false,
      requiresAccuracy: false,
      ac: null,
      damageBase: null,
      damageClass: 'Status',
      type: 'Normal',
      range: 'Burst 3, Sonic',
      conditionSuggestions: [
        { recipient: 'target', condition: 'Burned', action: 'remove', label: 'Burned' },
        { recipient: 'target', condition: 'Paralysis', action: 'remove', label: 'Paralysis' },
        { recipient: 'target', condition: 'Frozen', action: 'remove', label: 'Frozen' },
        { recipient: 'target', condition: 'Poisoned', action: 'remove', label: 'Poisoned' },
        { recipient: 'target', condition: 'Badly Poisoned', action: 'remove', label: 'Badly Poisoned' },
      ],
    })
    expect(healBell?.keywords).toEqual(expect.arrayContaining(['Sonic']))
    expect(healBell?.areaTemplates).toMatchObject([{ kind: 'burst', size: 3 }])
    expect(isSeamlessAreaConfirmationScript(healBell)).toBe(true)
  })

  it('implements Dragon Hammer as a reviewed mixed single-target-or-area attack', () => {
    const script = explicitScriptForMove('Dragon Hammer')

    expect(script).toMatchObject({
      kind: 'explicit',
      moveName: 'Dragon Hammer',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      damageBase: 9,
      damageClass: 'Physical',
      type: 'Dragon',
      ac: 2,
      range: 'Melee, 1 Target or Line 3',
    })
    expect(script?.areaTemplates).toEqual([{ kind: 'line', size: 3, label: 'Line 3' }])
    expect(script?.targetBranches).toEqual([
      {
        id: 'melee-1-target',
        label: 'Melee — 1 Target',
        targetMode: 'one-target',
        targetCount: 1,
        range: 'Melee, 1 Target',
      },
      {
        id: 'line-3',
        label: 'Line 3',
        targetMode: 'multi-target',
        targetCount: null,
        range: 'Line 3',
        areaTemplates: [{ kind: 'line', size: 3, label: 'Line 3' }],
      },
    ])
    expect(isSeamlessAreaConfirmationScript(script)).toBe(true)
    expect(moveAutomationCoverage.missing).not.toContain('Dragon Hammer')
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

  it('implements the reviewed Phase 2 area and multi-target scripts', () => {
    const disarmingVoice = explicitScriptForMove('Disarming Voice')
    expect(disarmingVoice).toMatchObject({
      kind: 'explicit',
      moveName: 'Disarming Voice',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: false,
      damageBase: 4,
      damageClass: 'Special',
      type: 'Fairy',
      range: 'Burst 1',
    })
    expect(disarmingVoice?.areaTemplates).toHaveLength(1)
    expect(disarmingVoice?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(disarmingVoice?.conditionSuggestions).toEqual([])
    expect(disarmingVoice?.stageSuggestions).toEqual([])
    expect(disarmingVoice?.hpSuggestions).toEqual([])
    expect(disarmingVoice?.fieldSuggestions).toEqual([])
    expect(disarmingVoice?.hazardSuggestions).toEqual([])
    expect(isSeamlessAreaConfirmationScript(disarmingVoice)).toBe(true)

    const swift = explicitScriptForMove('Swift')
    expect(swift).toMatchObject({
      kind: 'explicit',
      moveName: 'Swift',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: false,
      damageBase: 6,
      damageClass: 'Special',
      type: 'Normal',
      range: '8, Ranged Blast 2, Friendly',
    })
    expect(swift?.keywords).toEqual(expect.arrayContaining(['Ranged Blast 2', 'Friendly']))
    expect(swift?.areaTemplates).toHaveLength(1)
    expect(swift?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 8, size: 2 }])
    expect(swift?.conditionSuggestions).toEqual([])
    expect(swift?.stageSuggestions).toEqual([])
    expect(swift?.hpSuggestions).toEqual([])
    expect(swift?.fieldSuggestions).toEqual([])
    expect(swift?.hazardSuggestions).toEqual([])
    expect(isSeamlessAreaConfirmationScript(swift)).toBe(true)

    const electroweb = explicitScriptForMove('Electroweb')
    expect(electroweb).toMatchObject({
      kind: 'explicit',
      moveName: 'Electroweb',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 3,
      damageBase: 6,
      damageClass: 'Special',
      type: 'Electric',
      range: '4, Ranged Blast 2',
    })
    expect(electroweb?.areaTemplates).toHaveLength(1)
    expect(electroweb?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 4, size: 2 }])
    expect(electroweb?.stageSuggestions).toEqual([
      { recipient: 'target', key: 'spd', delta: -1, label: 'Electroweb lowers Speed: -1 Speed CS' },
    ])
    expect(isSeamlessAreaConfirmationScript(electroweb)).toBe(true)

    const mirrorShot = explicitScriptForMove('Mirror Shot')
    expect(mirrorShot).toMatchObject({
      kind: 'explicit',
      moveName: 'Mirror Shot',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 5,
      damageBase: 7,
      damageClass: 'Special',
      type: 'Steel',
      range: '6, Ranged Blast 2',
    })
    expect(mirrorShot?.areaTemplates).toHaveLength(1)
    expect(mirrorShot?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 6, size: 2 }])
    expect(mirrorShot?.stageSuggestions).toEqual([
      { recipient: 'target', key: 'acc', delta: -2, label: 'Mirror Shot lowers Accuracy on 16+: -2 Accuracy CS', threshold: '16+', optional: true },
    ])
    expect(isSeamlessAreaConfirmationScript(mirrorShot)).toBe(true)

    const seedFlare = explicitScriptForMove('Seed Flare')
    expect(seedFlare).toMatchObject({
      kind: 'explicit',
      moveName: 'Seed Flare',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 5,
      damageBase: 12,
      damageClass: 'Special',
      type: 'Grass',
      range: '6, Ranged Blast 3',
    })
    expect(seedFlare?.areaTemplates).toHaveLength(1)
    expect(seedFlare?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 6, size: 3 }])
    expect(seedFlare?.stageSuggestions).toEqual([
      { recipient: 'target', key: 'sdef', delta: -1, label: 'Seed Flare lowers Special Defense: -1 Special Defense CS' },
    ])
    expect(isSeamlessAreaConfirmationScript(seedFlare)).toBe(true)
  })

  it('implements the reviewed Phase 2 area stage and storm scripts', () => {
    const aromaticMist = explicitScriptForMove('Aromatic Mist')
    expect(aromaticMist).toMatchObject({
      kind: 'explicit',
      moveName: 'Aromatic Mist',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: false,
      requiresAccuracy: false,
      ac: null,
      damageBase: null,
      damageClass: 'Status',
      type: 'Fairy',
      range: 'Burst 1',
    })
    expect(aromaticMist?.areaTemplates).toHaveLength(1)
    expect(aromaticMist?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(aromaticMist?.stageSuggestions).toEqual([
      { recipient: 'target', key: 'sdef', delta: 1, label: "Aromatic Mist raises allies' Special Defense: +1 Special Defense CS" },
    ])
    expect(aromaticMist?.conditionSuggestions).toEqual([])
    expect(aromaticMist?.hpSuggestions).toEqual([])
    expect(aromaticMist?.fieldSuggestions).toEqual([])
    expect(aromaticMist?.hazardSuggestions).toEqual([])
    expect(aromaticMist?.automationNotes).toEqual([
      'Aromatic Mist affects allies only. Team allegiance is not tracked, so verify affected tokens are allies or correct Combat Stages manually afterward.',
    ])
    expect(isSeamlessAreaConfirmationScript(aromaticMist)).toBe(true)

    const coaching = explicitScriptForMove('Coaching')
    expect(coaching).toMatchObject({
      kind: 'explicit',
      moveName: 'Coaching',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: false,
      requiresAccuracy: false,
      ac: null,
      damageBase: null,
      damageClass: 'Status',
      type: 'Fighting',
      range: 'Burst 1',
    })
    expect(coaching?.areaTemplates).toHaveLength(1)
    expect(coaching?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(coaching?.stageSuggestions).toEqual([
      { recipient: 'user', key: 'atk', delta: 1, label: "Coaching raises user's Attack: +1 Attack CS" },
      { recipient: 'user', key: 'def', delta: 1, label: "Coaching raises user's Defense: +1 Defense CS" },
      { recipient: 'target', key: 'atk', delta: 1, label: "Coaching raises allies' Attack: +1 Attack CS" },
      { recipient: 'target', key: 'def', delta: 1, label: "Coaching raises allies' Defense: +1 Defense CS" },
    ])
    expect(coaching?.conditionSuggestions).toEqual([])
    expect(coaching?.hpSuggestions).toEqual([])
    expect(coaching?.fieldSuggestions).toEqual([])
    expect(coaching?.hazardSuggestions).toEqual([])
    expect(coaching?.automationNotes).toEqual([
      'Burst 1 is shown as an area overlay; the user also receives the Attack and Defense boosts even though the user token is not a selectable target.',
      'Coaching affects allies only. Team allegiance is not tracked, so verify affected tokens are allies or correct Combat Stages manually afterward.',
    ])
    expect(isSeamlessAreaConfirmationScript(coaching)).toBe(true)

    const bleakwindStorm = explicitScriptForMove('Bleakwind Storm')
    expect(bleakwindStorm).toMatchObject({
      kind: 'explicit',
      moveName: 'Bleakwind Storm',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 5,
      damageBase: 10,
      damageClass: 'Special',
      type: 'Flying',
      range: '6, Ranged Blast 3, Smite',
    })
    expect(bleakwindStorm?.areaTemplates).toHaveLength(1)
    expect(bleakwindStorm?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 6, size: 3 }])
    expect(bleakwindStorm?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Flinch', action: 'add', label: 'Flinch on 15+', threshold: '15+', optional: true },
      { recipient: 'target', condition: 'Frozen', action: 'add', label: 'Frozen on 19+', threshold: '19+', optional: true },
    ])
    expect(bleakwindStorm?.stageSuggestions).toEqual([])
    expect(bleakwindStorm?.hpSuggestions).toEqual([])
    expect(bleakwindStorm?.fieldSuggestions).toEqual([])
    expect(bleakwindStorm?.hazardSuggestions).toEqual([])
    expect(isSeamlessAreaConfirmationScript(bleakwindStorm)).toBe(true)

    const sandstormSear = explicitScriptForMove('Sandstorm Sear')
    expect(sandstormSear).toMatchObject({
      kind: 'explicit',
      moveName: 'Sandstorm Sear',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 5,
      damageBase: 10,
      damageClass: 'Special',
      type: 'Ground',
      range: '6, Ranged Blast 3, Smite',
    })
    expect(sandstormSear?.areaTemplates).toHaveLength(1)
    expect(sandstormSear?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 6, size: 3 }])
    expect(sandstormSear?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Burned', action: 'add', label: 'Burned on 15+', threshold: '15+', optional: true },
    ])
    expect(sandstormSear?.stageSuggestions).toEqual([])
    expect(sandstormSear?.hpSuggestions).toEqual([])
    expect(sandstormSear?.fieldSuggestions).toEqual([])
    expect(sandstormSear?.hazardSuggestions).toEqual([])
    expect(isSeamlessAreaConfirmationScript(sandstormSear)).toBe(true)

    const wildboltStorm = explicitScriptForMove('Wildbolt Storm')
    expect(wildboltStorm).toMatchObject({
      kind: 'explicit',
      moveName: 'Wildbolt Storm',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 5,
      damageBase: 10,
      damageClass: 'Special',
      type: 'Electric',
      range: '6, Ranged Blast 3, Smite',
    })
    expect(wildboltStorm?.areaTemplates).toHaveLength(1)
    expect(wildboltStorm?.areaTemplates).toMatchObject([{ kind: 'ranged-blast', range: 6, size: 3 }])
    expect(wildboltStorm?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Paralysis', action: 'add', label: 'Paralysis on 15+', threshold: '15+', optional: true },
    ])
    expect(wildboltStorm?.stageSuggestions).toEqual([])
    expect(wildboltStorm?.hpSuggestions).toEqual([])
    expect(wildboltStorm?.fieldSuggestions).toEqual([])
    expect(wildboltStorm?.hazardSuggestions).toEqual([])
    expect(isSeamlessAreaConfirmationScript(wildboltStorm)).toBe(true)

    const ragingFury = explicitScriptForMove('Raging Fury')
    expect(ragingFury).toMatchObject({
      kind: 'explicit',
      moveName: 'Raging Fury',
      targetMode: 'multi-target',
      targetCount: null,
      damaging: true,
      requiresAccuracy: true,
      ac: 2,
      damageBase: 9,
      damageClass: 'Special',
      type: 'Fire',
      range: 'Burst 1, Spirit Surge',
    })
    expect(ragingFury?.keywords).toEqual(expect.arrayContaining(['Burst 1', 'Spirit Surge']))
    expect(ragingFury?.areaTemplates).toHaveLength(1)
    expect(ragingFury?.areaTemplates).toMatchObject([{ kind: 'burst', size: 1 }])
    expect(ragingFury?.conditionSuggestions).toEqual([
      { recipient: 'user', condition: 'Rage', action: 'add', label: 'Enraged' },
      { recipient: 'target', condition: 'Rage', action: 'add', label: 'Enraged on 16+', threshold: '16+', optional: true },
    ])
    expect(ragingFury?.stageSuggestions).toEqual([])
    expect(ragingFury?.hpSuggestions).toEqual([])
    expect(ragingFury?.fieldSuggestions).toEqual([])
    expect(ragingFury?.hazardSuggestions).toEqual([])
    expect(isSeamlessAreaConfirmationScript(ragingFury)).toBe(true)
  })

  it('implements the requested basic moves as seamless explicit scripts', () => {
    const tackle = explicitScriptForMove('Tackle')
    expect(tackle).toMatchObject({ moveName: 'Tackle', targetMode: 'one-target', damaging: true, requiresAccuracy: true })
    expect(tackle?.automationNotes).toEqual(expect.arrayContaining([expect.stringContaining('pushes the target 2 meters')]))
    expect(isSeamlessSingleTargetMoveScript(tackle)).toBe(true)

    const takeDown = explicitScriptForMove('Take Down')
    expect(takeDown).toMatchObject({ moveName: 'Take Down', targetMode: 'one-target', damaging: true, requiresAccuracy: true, damageBase: 9, ac: 5 })
    expect(takeDown?.hpSuggestions).toEqual([
      { recipient: 'user', mode: 'recoil-percent-damage-dealt', percent: 100 / 3, rounding: 'floor', label: 'Recoil 1/3' },
    ])
    expect(takeDown?.conditionSuggestions).toEqual([
      { recipient: 'target', condition: 'Tripped', action: 'add', label: 'Trip Maneuver succeeds', optional: true },
    ])
    expect(isSeamlessSingleTargetMoveScript(takeDown)).toBe(true)

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
    expect(explicitScriptForMove('U-Turn')?.conditionSuggestions).toEqual([])
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
