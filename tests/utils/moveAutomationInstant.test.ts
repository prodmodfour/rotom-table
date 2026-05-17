import { describe, expect, it } from 'vitest'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { buildMoveAutomationMoveEntries } from '~/utils/moveAutomationMoves'
import {
  resolveInstantAreaMoveAutomation,
  resolveInstantMoveAutomation,
  resolveInstantSelfMoveAutomation,
  resolveInstantTargetMoveAutomation,
} from '~/utils/moveAutomationInstant'
import type { CombatStageMap } from '~/types/combatStages'
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

    expect(result.feedback.conditions).toEqual([{ condition: 'Burned', applied: false, blockedBy: 'Fire type' }])
    expect(result.transaction.conditionUpdates).toEqual([])
    expect(result.transaction.logLines).toContain('Note: Burned did not apply to Flare: immune (Fire type).')
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
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 25 }])
    expect(result.transaction.logLines).toContain('Target: 15 HP lost (Dragon Rage fixed HP loss).')
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
    expect(result.transaction.logLines).toContain('Note: Double Kick Double Strike: roll 1 11 (hit); roll 2 20 (hit, critical); 2 hits -> DB 3 × 2 = DB 6. 1 critical hit adds 6 bonus damage before Stats and defenses.')
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
    expect(result.transaction.logLines).toContain('Note: Pin Missile Five Strike rolled 7: 4 hits; DB 3 × 4 = DB 12.')
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
    expect(result.transaction.logLines).toContain('Note: Pin Missile Five Strike rolled 7: 4 hits; DB 3 × 4 + 2 STAB = DB 14.')
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
    expect(result.transaction.logLines).toContain('Note: Power Trip Damage Base scaling: 3 positive Combat Stages -> DB 8.')
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
    expect(result.transaction.logLines).toContain('Note: Acupressure rolled 4: Acupressure raises Special Defense: +2 Special Defense CS.')
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
      'Evenmon: 13 HP damage.',
      'Oddmon: 13 HP damage.',
      'Poisoned on even roll applied to Evenmon.',
      'Note: Poisoned did not apply to Gear: immune (Steel type).',
      'Evenmon: accuracy 8 (hit).',
      'Oddmon: accuracy 9 (hit).',
      'Gear: accuracy 10 (hit).',
    ]))
  })
})
