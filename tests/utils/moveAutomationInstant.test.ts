import { describe, expect, it } from 'vitest'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { buildMoveAutomationMoveEntries } from '~/utils/moveAutomationMoves'
import { resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import {
  resolveInstantAreaMoveAutomation,
  resolveInstantMoveAutomation,
  resolveInstantMultiTargetMoveAutomation,
  resolveInstantSelfMoveAutomation,
  resolveInstantTargetMoveAutomation,
} from '~/utils/moveAutomationInstant'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const token = (overrides: Partial<SpawnedPokemon> & Pick<SpawnedPokemon, 'id' | 'species'>): SpawnedPokemon => {
  const { id, species, ...rest } = overrides
  return {
    id,
    species,
    slug: species.toLowerCase(),
    size: 'Small',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    spriteUrl: '/sprite.png',
    entityKind: 'pokemon',
    position: { x: 0, y: 0, z: 0 },
    sheetKind: 'pokemon',
    sheetSlug: species.toLowerCase(),
    level: 10,
    currentHp: 40,
    maxHp: 40,
    atk: 5,
    satk: 10,
    def: 5,
    sdef: 5,
    spd: 5,
    evasion: { physical: 0, special: 0, speed: 0 },
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

const sequenceRandom = (values: number[]) => {
  let index = 0
  return () => values[index++] ?? 0
}

const fakeExplicitMultiTargetScript = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Fake Twin Target Move',
  version: 1,
  targetMode: 'multi-target',
  targetCount: 2,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Special',
  type: 'Normal',
  ac: 10,
  range: '6, 2 Targets',
  effect: '',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [{ recipient: 'target', condition: 'Burned', label: 'Burned' }],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('instant move automation', () => {
  it('resolves Ember hit, threshold burn, and damage transaction without review state', () => {
    const script = explicitScriptForMove('Ember')
    expect(script).not.toBeNull()
    const result = resolveInstantMoveAutomation({
      script: script!,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Bulba', defenderTypes: ['Grass'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.85, 0.375]),
      idFactory: () => 'fixed-feedback',
    })

    expect(result.feedback).toMatchObject({
      id: 'fixed-feedback',
      naturalRoll: 18,
      hit: true,
      effectiveness: 'super-effective',
      damageLoss: 22,
      conditions: [{ condition: 'Burned', applied: true }],
    })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 18 }])
    expect(result.transaction.conditionUpdates).toEqual([{ id: 't', conditions: ['Burned'] }])
  })

  it('adds the damage dice a second time on critical hits', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Target' }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.999, 0.375]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 20, hit: true, crit: true, damageLoss: 19 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 21 }])
  })

  it('does not apply Ember burn below its natural-roll threshold', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Bulba', defenderTypes: ['Grass'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.8, 0.375]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 17, hit: true, conditions: [] })
    expect(result.transaction.conditionUpdates).toEqual([])
  })

  it('does not apply Ember burn to burn-immune targets', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Flare', defenderTypes: ['Fire'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.85, 0.375]),
    })

    expect(result.feedback).toMatchObject({ effectiveness: 'resisted' })
    expect(result.feedback.conditions).toEqual([{ condition: 'Burned', applied: false, blockedBy: 'Fire type' }])
    expect(result.transaction.conditionUpdates).toEqual([])
    expect(result.transaction.logLines.some((line) => line.startsWith('Note:'))).toBe(false)
  })

  it('uses Shield Dust to block damaging move Accuracy Roll condition effects', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Dusty', defenderTypes: ['Grass'], abilityNames: ['Shield Dust'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.85, 0.375]),
    })

    expect(result.feedback).toMatchObject({ hit: true, damageLoss: 22 })
    expect(result.feedback.conditions).toEqual([{ condition: 'Burned', applied: false, blockedBy: 'Shield Dust' }])
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 18 }])
    expect(result.transaction.conditionUpdates).toEqual([])
  })

  it('uses Shield Dust to block damaging move Accuracy Roll stage effects', () => {
    const script = explicitScriptForMove('Bubble Beam')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Squirtle' }),
      target: token({ id: 't', species: 'Dusty', abilityNames: ['Shield Dust'] }),
      damageFormula: '1d6',
      random: sequenceRandom([0.85, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 18, hit: true })
    expect(result.transaction.combatStageUpdates).toEqual([])
    expect(result.transaction.logLines).toContain('Bubble Beam lowers Speed on 18+: -1 Speed CS did not apply to Dusty: blocked by Shield Dust.')
  })

  it('uses Keen Eye to block Accuracy stage drops', () => {
    const script = explicitScriptForMove('Mud-Slap')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Sharp', abilityNames: ['Keen Eye'] }),
      damageFormula: '1d6',
      random: sequenceRandom([0.85, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 18, hit: true })
    expect(result.transaction.combatStageUpdates).toEqual([])
    expect(result.transaction.logLines).toContain('Mud-Slap lowers Accuracy: -1 Accuracy CS did not apply to Sharp: immune (Keen Eye).')
  })

  it('uses nearby Sweet Veil providers to block Sleep', () => {
    const script = explicitScriptForMove('Hypnosis')!
    const sweetVeilProvider = token({
      id: 'ally',
      species: 'Aromatisse',
      abilityNames: ['Sweet Veil'],
      position: { x: 3, y: 0, z: 0 },
    })
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Target', position: { x: 0, y: 0, z: 0 } }),
      damageFormula: null,
      conditionImmunityContext: { sweetVeilProviders: [sweetVeilProvider] },
      random: sequenceRandom([0.85]),
    })

    expect(result.feedback.conditions).toEqual([{ condition: 'Sleep', applied: false, blockedBy: 'Sweet Veil (Aromatisse)' }])
    expect(result.transaction.conditionUpdates).toEqual([])
  })

  it('resolves Psywave through the same instant single-target flow as Ember', () => {
    const script = explicitScriptForMove('Psywave')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster', level: 21, satk: 99 }),
      target: token({ id: 't', species: 'Target', currentHp: 80, maxHp: 80, sdef: 99, defenderTypes: ['Fighting', 'Poison'] }),
      damageFormula: '1d4',
      random: sequenceRandom([0.5, 0.5]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, crit: false, damageLoss: 31 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 49 }])
    expect(result.transaction.logLines).toContain('Target: 31 HP lost (Psywave level-scaled HP loss).')
  })

  it('resolves fixed direct HP loss for Dragon Rage', () => {
    const script = explicitScriptForMove('Dragon Rage')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Drake', satk: 99 }),
      target: token({ id: 't', species: 'Target', currentHp: 40, maxHp: 40, sdef: 99 }),
      damageFormula: null,
      random: sequenceRandom([0.5]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, crit: false, damageLoss: 15 })
    expect(result.feedback.conditions).toEqual([])
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 25 }])
    expect(result.transaction.conditionUpdates).toEqual([])
    expect(result.transaction.logLines).toContain('Target: 15 HP lost (Dragon Rage fixed HP loss).')
  })

  it('resolves Take Down recoil without applying the unresolved optional Trip Maneuver', () => {
    const script = explicitScriptForMove('Take Down')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Rhyhorn', currentHp: 30, maxHp: 40, atk: 10 }),
      target: token({ id: 't', species: 'Target', currentHp: 50, maxHp: 50, def: 0, defenderTypes: [] }),
      damageFormula: '2d10+10',
      random: sequenceRandom([0.5, 0, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, damageLoss: 22, conditions: [] })
    expect(result.transaction.hpUpdates).toEqual([
      { id: 't', currentHp: 28 },
      { id: 'u', currentHp: 23 },
    ])
    expect(result.transaction.conditionUpdates).toEqual([])
    expect(result.transaction.logLines).toContain('Rhyhorn: Recoil 1/3 (7 HP).')
  })

  it('heals Synthesis from current weather without opening a target flow', () => {
    const script = explicitScriptForMove('Synthesis')!
    const transaction = resolveInstantSelfMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Sprout', currentHp: 10, maxHp: 99 }),
      fieldEffects: { weather: [{ kind: 'sunny' }] },
    })

    expect(transaction.hpUpdates).toEqual([{ id: 'u', currentHp: 76 }])
    expect(transaction.logLines).toContain('Sprout: Synthesis heals weather-adjusted HP (66 HP).')
  })

  it('uses injected randomness for self-move random stage suggestions', () => {
    const script: MoveAutomationScript = {
      kind: 'explicit',
      moveName: 'Random Self Boost',
      version: 1,
      targetMode: 'self',
      targetCount: 1,
      damaging: false,
      requiresAccuracy: false,
      damageBase: null,
      damageClass: 'Status',
      type: 'Normal',
      ac: null,
      range: 'Self',
      effect: 'Roll for a random boost.',
      keywords: ['Self'],
      criticalRange: null,
      stageSuggestions: [
        { recipient: 'user', key: 'atk', delta: 2, label: 'Attack boost', optional: true },
        { recipient: 'user', key: 'acc', delta: 2, label: 'Accuracy boost', optional: true },
      ],
      randomStageSuggestion: {
        kind: 'roll-table',
        rollFormula: '1d6',
        label: 'Random Self Boost',
        entries: [
          { roll: 1, stageSuggestionIndex: 0, label: 'Attack boost' },
          { roll: 6, stageSuggestionIndex: 1, label: 'Accuracy boost' },
        ],
      },
      conditionSuggestions: [],
      hpSuggestions: [],
      fieldSuggestions: [],
      hazardSuggestions: [],
      automationNotes: [],
    }

    const lowRoll = resolveInstantSelfMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Booster' }),
      random: sequenceRandom([0]),
    })
    const highRoll = resolveInstantSelfMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Booster' }),
      random: sequenceRandom([0.99]),
    })

    expect(lowRoll.combatStageUpdates).toEqual([{ id: 'u', stages: { ...stages, atk: 2 } }])
    expect(highRoll.combatStageUpdates).toEqual([{ id: 'u', stages: { ...stages, acc: 2 } }])
  })

  it('resolves Howl as a no-accuracy Burst buff for the user and selected allies', () => {
    const script = explicitScriptForMove('Howl')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Howler', combatStages: { ...stages, atk: 1 } }),
      targets: [
        token({ id: 'ally', species: 'Ally', combatStages: { ...stages, atk: -1 } }),
      ],
    })

    expect(transaction.hpUpdates).toEqual([])
    expect(transaction.combatStageUpdates).toEqual([
      { id: 'u', stages: { ...stages, atk: 2 } },
      { id: 'ally', stages: { ...stages, atk: 0 } },
    ])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      "Howl raises user's Attack: +1 Attack CS on Howler.",
      "Howl raises allies' Attack: +1 Attack CS on Ally.",
    ]))
  })

  it('resolves Heal Bell as a Burst persistent-status cure without clearing Volatile conditions', () => {
    const script = explicitScriptForMove('Heal Bell')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Cleric' }),
      targets: [
        token({ id: 'burned', species: 'Burnmon', conditions: ['Burned', 'Poisoned', 'Confused'] }),
        token({ id: 'toxic', species: 'Toxicmon', conditions: ['Badly Poisoned', 'Sleep'] }),
        token({ id: 'sleepy', species: 'Sleepmon', conditions: ['Sleep'] }),
      ],
    })

    expect(transaction.hpUpdates).toEqual([])
    expect(transaction.conditionUpdates).toEqual([
      { id: 'burned', conditions: ['Confused'] },
      { id: 'toxic', conditions: ['Sleep'] },
    ])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Burned removed from Burnmon.',
      'Poisoned removed from Burnmon.',
      'Badly Poisoned removed from Toxicmon.',
    ]))
    expect(transaction.logLines.some((line) => (
      line.includes('Sleep removed')
      || line.includes('Confused removed')
      || line.includes('removed from Sleepmon')
    ))).toBe(false)
  })

  it('resolves explicit multi-target-count moves against selected targets with independent accuracy rolls', () => {
    const transaction = resolveInstantMultiTargetMoveAutomation({
      script: fakeExplicitMultiTargetScript(),
      user: token({ id: 'u', species: 'Caster', satk: 10 }),
      targets: [
        token({ id: 'hit', species: 'Hitmon', sdef: 5 }),
        token({ id: 'miss', species: 'Missmon', sdef: 5 }),
      ],
      damageFormula: '1d6',
      random: sequenceRandom([0.5, 0, 0]),
    })

    expect(transaction.attackedTargetIds).toEqual(['hit', 'miss'])
    expect(transaction.hitTargetIds).toEqual(['hit'])
    expect(transaction.hpUpdates).toEqual([{ id: 'hit', currentHp: 34 }])
    expect(transaction.conditionUpdates).toEqual([{ id: 'hit', conditions: ['Burned'] }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Burned applied to Hitmon.',
      'Hitmon: accuracy 11 (hit).',
      'Missmon: accuracy 1 (miss).',
    ]))
    expect(transaction.logLines.some((line) => line.includes('confirmed area'))).toBe(false)
  })

  it('resolves Sweet Scent as a Burst evasion-penalty marker on hit targets', () => {
    const script = explicitScriptForMove('Sweet Scent')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Aroma' }),
      targets: [
        token({ id: 'hit', species: 'Hitmon' }),
        token({ id: 'miss', species: 'Missmon' }),
      ],
      random: sequenceRandom([0.5, 0]),
    })

    expect(transaction.hpUpdates).toEqual([])
    expect(transaction.conditionUpdates).toEqual([
      { id: 'hit', conditions: ['Sweet Scent Evasion Penalty'] },
    ])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Sweet Scent Evasion Penalty applied to Hitmon.',
      'Hitmon: accuracy 11 (hit).',
      'Missmon: accuracy 1 (miss).',
    ]))
  })

  it('applies Sweet Scent evasion penalties to later Accuracy checks without going below 0', () => {
    const script = explicitScriptForMove('Tackle')!

    expect(resolveMoveAutomationTargetEvasion(script, token({
      id: 'scented',
      species: 'Scented',
      def: 20,
      spd: 15,
      conditions: ['Sweet Scent Evasion Penalty'],
    }))).toMatchObject({ value: 2 })
    expect(resolveMoveAutomationTargetEvasion(script, token({
      id: 'low',
      species: 'Low',
      def: 5,
      spd: 5,
      conditions: ['Sweet Scent Evasion Penalty'],
    }))).toMatchObject({ value: 0 })
  })

  it('resolves Magical Leaf damage as a cannot-miss target attack', () => {
    const script = explicitScriptForMove('Magical Leaf')!
    const transaction = resolveInstantTargetMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster', satk: 10 }),
      target: token({ id: 't', species: 'Target', currentHp: 40, maxHp: 40, sdef: 5, evasion: { physical: 9, special: 9, speed: 9 } }),
      damageFormula: '2d6+8',
      random: sequenceRandom([0, 0]),
    })

    expect(transaction.hpUpdates).toEqual([{ id: 't', currentHp: 25 }])
    expect(transaction.hitTargetIds).toEqual(['t'])
  })

  it('rolls Double Strike attacks and critical bonus damage for Double Kick', () => {
    const script = explicitScriptForMove('Double Kick')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Kicker', atk: 5 }),
      target: token({ id: 't', species: 'Target', currentHp: 40, maxHp: 40, def: 5, defenderTypes: [] }),
      damageFormula: null,
      random: sequenceRandom([0.5, 0.999, 0, 0, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 20, hit: true, crit: true, damageLoss: 16 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 24 }])
    expect(result.transaction.logLines.some((line) => line.startsWith('Note:'))).toBe(false)
  })

  it('rolls Five Strike damage base before rolling damage dice', () => {
    const script = explicitScriptForMove('Pin Missile')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Launcher', atk: 5 }),
      target: token({ id: 't', species: 'Target', def: 5 }),
      damageFormula: '1d6+5',
      random: sequenceRandom([0.5, 0.75, 0, 0, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, damageLoss: 13 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 27 }])
    expect(result.transaction.logLines.some((line) => line.startsWith('Note:'))).toBe(false)
  })

  it('applies STAB after Five Strike multiplies Damage Base', () => {
    const [entry] = buildMoveAutomationMoveEntries([{ name: 'Pin Missile' }], { stabTypes: ['Bug'] })
    const result = resolveInstantMoveAutomation({
      script: entry.script,
      user: token({ id: 'u', species: 'Launcher', atk: 5, defenderTypes: ['Bug'] }),
      target: token({ id: 't', species: 'Target', def: 5 }),
      damageFormula: null,
      random: sequenceRandom([0.5, 0.75, 0, 0, 0, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, damageLoss: 19 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 21 }])
    expect(result.transaction.logLines.some((line) => line.startsWith('Note:'))).toBe(false)
  })

  it('scales Power Trip from the user’s positive Combat Stages', () => {
    const script = explicitScriptForMove('Power Trip')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Rook', atk: 5, combatStages: { ...stages, acc: 3 } }),
      target: token({ id: 't', species: 'Target', def: 5 }),
      damageFormula: '1d6+3',
      random: sequenceRandom([0.5, 0, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, damageLoss: 12 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 28 }])
    expect(result.transaction.logLines.some((line) => line.startsWith('Note:'))).toBe(false)
  })

  it('rolls Acupressure and applies only the selected stage boost', () => {
    const script = explicitScriptForMove('Acupressure')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Medic' }),
      target: token({ id: 't', species: 'Target' }),
      damageFormula: null,
      random: sequenceRandom([0.5, 0.5]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 11, hit: true, damageLoss: 0 })
    expect(result.transaction.combatStageUpdates).toEqual([
      { id: 't', stages: { ...stages, sdef: 2 } },
    ])
    expect(result.transaction.logLines.some((line) => line.startsWith('Note:'))).toBe(false)
  })

  it('applies reviewed single-target stage thresholds during instant targeting', () => {
    const script = explicitScriptForMove('Bubble Beam')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Squirtle' }),
      target: token({ id: 't', species: 'Target' }),
      damageFormula: '1d6',
      random: sequenceRandom([0.85, 0]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 18, hit: true })
    expect(result.transaction.combatStageUpdates).toEqual([
      { id: 't', stages: { ...stages, spd: -1 } },
    ])
  })

  it('applies reviewed AoE stage thresholds per target natural roll', () => {
    const script = explicitScriptForMove('Bubble')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Squirtle' }),
      targets: [
        token({ id: 'fast', species: 'Fast' }),
        token({ id: 'steady', species: 'Steady' }),
      ],
      damageFormula: '1d6',
      random: sequenceRandom([0.75, 0, 0.7, 0]),
    })

    expect(transaction.combatStageUpdates).toEqual([
      { id: 'fast', stages: { ...stages, spd: -1 } },
    ])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Bubble lowers Speed on 16+: -1 Speed CS on Fast.',
      'Fast: accuracy 16 (hit).',
      'Steady: accuracy 15 (hit).',
    ]))
  })

  it('resolves Smog area damage and poisons only hit targets with even natural rolls', () => {
    const script = explicitScriptForMove('Smog')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Koffing' }),
      targets: [
        token({ id: 'even', species: 'Evenmon' }),
        token({ id: 'odd', species: 'Oddmon' }),
        token({ id: 'immune', species: 'Gear', defenderTypes: ['Steel'] }),
      ],
      damageFormula: '1d6+5',
      random: sequenceRandom([0.35, 0.375, 0.4, 0.375, 0.45, 0.375]),
    })

    expect(transaction.hpUpdates).toEqual([
      { id: 'even', currentHp: 27 },
      { id: 'odd', currentHp: 27 },
    ])
    expect(transaction.conditionUpdates).toEqual([{ id: 'even', conditions: ['Poisoned'] }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Evenmon: 13 damage.',
      'Oddmon: 13 damage.',
      'Poisoned on even roll applied to Evenmon.',
      'Evenmon: accuracy 8 (hit).',
      'Oddmon: accuracy 9 (hit).',
      'Gear: accuracy 10 (hit).',
    ]))
  })

  it('resolves Disarming Voice as a no-accuracy area damaging move', () => {
    const script = explicitScriptForMove('Disarming Voice')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Singer', satk: 10 }),
      targets: [token({ id: 't', species: 'Target', sdef: 5 })],
      damageFormula: '1d8+6',
      random: sequenceRandom([0]),
    })

    expect(transaction.hpUpdates).toEqual([{ id: 't', currentHp: 28 }])
    expect(transaction.hitTargetIds).toEqual(['t'])
    expect(transaction.logLines).toContain('Target: hit.')
  })

  it('resolves Swift as a no-accuracy area damaging move', () => {
    const script = explicitScriptForMove('Swift')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Star', satk: 10 }),
      targets: [token({ id: 't', species: 'Target', sdef: 5, evasion: { physical: 9, special: 9, speed: 9 } })],
      damageFormula: '2d6+8',
      random: sequenceRandom([0, 0]),
    })

    expect(transaction.hpUpdates).toEqual([{ id: 't', currentHp: 25 }])
    expect(transaction.hitTargetIds).toEqual(['t'])
    expect(transaction.logLines).toContain('Target: hit.')
  })

  it('applies Electroweb Speed drops only to hit area targets', () => {
    const script = explicitScriptForMove('Electroweb')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Joltik', satk: 10 }),
      targets: [
        token({ id: 'hit', species: 'Hitmon', sdef: 5 }),
        token({ id: 'miss', species: 'Missmon', sdef: 5 }),
      ],
      damageFormula: '2d6+8',
      random: sequenceRandom([0.5, 0, 0, 0]),
    })

    expect(transaction.hpUpdates).toEqual([{ id: 'hit', currentHp: 25 }])
    expect(transaction.combatStageUpdates).toEqual([{ id: 'hit', stages: { ...stages, spd: -1 } }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Electroweb lowers Speed: -1 Speed CS on Hitmon.',
      'Hitmon: accuracy 11 (hit).',
      'Missmon: accuracy 1 (miss).',
    ]))
  })

  it('applies Mirror Shot Accuracy drops only to hit targets whose natural roll meets 16+', () => {
    const script = explicitScriptForMove('Mirror Shot')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Klink', satk: 10 }),
      targets: [
        token({ id: 'eligible', species: 'Eligible', sdef: 5 }),
        token({ id: 'low', species: 'LowRoll', sdef: 5 }),
        token({ id: 'miss', species: 'Missmon', sdef: 5 }),
      ],
      damageFormula: '2d6+10',
      random: sequenceRandom([0.75, 0, 0, 0.7, 0, 0, 0]),
    })

    expect(transaction.hpUpdates).toEqual([
      { id: 'eligible', currentHp: 23 },
      { id: 'low', currentHp: 23 },
    ])
    expect(transaction.combatStageUpdates).toEqual([{ id: 'eligible', stages: { ...stages, acc: -2 } }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Mirror Shot lowers Accuracy on 16+: -2 Accuracy CS on Eligible.',
      'Eligible: accuracy 16 (hit).',
      'LowRoll: accuracy 15 (hit).',
      'Missmon: accuracy 1 (miss).',
    ]))
  })

  it('applies Seed Flare Special Defense drops only to hit area targets', () => {
    const script = explicitScriptForMove('Seed Flare')!
    const transaction = resolveInstantAreaMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Shaymin', satk: 10 }),
      targets: [
        token({ id: 'hit', species: 'Hitmon', sdef: 5 }),
        token({ id: 'miss', species: 'Missmon', sdef: 5 }),
      ],
      damageFormula: '1d6',
      random: sequenceRandom([0.5, 0, 0]),
    })

    expect(transaction.hpUpdates).toEqual([{ id: 'hit', currentHp: 34 }])
    expect(transaction.combatStageUpdates).toEqual([{ id: 'hit', stages: { ...stages, sdef: -1 } }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Seed Flare lowers Special Defense: -1 Special Defense CS on Hitmon.',
      'Hitmon: accuracy 11 (hit).',
      'Missmon: accuracy 1 (miss).',
    ]))
  })
})
