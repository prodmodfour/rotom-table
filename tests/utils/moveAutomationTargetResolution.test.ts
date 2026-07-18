import { describe, expect, it } from 'vitest'
import {
  defaultTargetResolutionState,
  moveAutomationMultiplierLabel,
  moveAutomationSuggestionKey,
  resolveHpSuggestionAmount,
  resolveMoveAutomationTargetDamageBreakdown,
  resolveMoveAutomationTargetDamageLoss,
  suggestionIsEnabled,
} from '~/utils/moveAutomationTargetResolution'
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
    currentHp: 20,
    maxHp: 40,
    atk: 8,
    satk: 7,
    def: 5,
    sdef: 4,
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 2,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Fire',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('move automation target resolution helpers', () => {
  it('builds stable suggestion keys, enabled state, and target defaults', () => {
    const s = script({ moveName: 'Ember' })
    const hpKey = moveAutomationSuggestionKey(s, 'hp', 1)

    expect(hpKey).toBe('Ember:hp:1')
    expect(moveAutomationSuggestionKey(null, 'field', 0)).toBe('move:field:0')
    expect(suggestionIsEnabled(s, { [hpKey]: true }, 'hp', 1)).toBe(true)
    expect(suggestionIsEnabled(s, {}, 'hp', 1)).toBe(false)
    expect(defaultTargetResolutionState(s)).toMatchObject({ hit: false, applyDamage: true, crit: false })
    expect(defaultTargetResolutionState(script({ requiresAccuracy: false, damaging: false }))).toMatchObject({ hit: true, applyDamage: false })
  })

  it('resolves Smite miss damage one resistance step lower without a critical bonus', () => {
    const user = token({ id: 'u', species: 'User', atk: 12 })
    const target = token({ id: 't', species: 'Target', currentHp: 30, def: 7 })
    const smite = script({ keywords: ['Smite'], criticalRange: 18 })
    const missedCriticalRange = {
      ...defaultTargetResolutionState(smite),
      hit: false,
      crit: true,
      damageRoll: { formula: '2d6+8', count: 2, sides: 6, total: 20, rolls: [6, 6], mod: 8 },
    }

    const breakdown = resolveMoveAutomationTargetDamageBreakdown(
      smite,
      user,
      target,
      missedCriticalRange,
    )
    expect(breakdown).toMatchObject({
      kind: 'standard',
      hpLoss: 12,
      multiplier: 0.5,
      critical: false,
    })
    expect(breakdown.kind === 'standard' ? breakdown.pipeline : null).toMatchObject({
      stages: expect.arrayContaining([
        expect.objectContaining({
          modifiers: expect.arrayContaining([
            expect.objectContaining({
              id: 'damage.smite-miss-effectiveness',
              source: { kind: 'rules', id: 'ptu.smite' },
              reasonCode: 'damage.smite-miss-resistance-step',
              value: 0.5,
            }),
          ]),
        }),
      ]),
    })
    expect(breakdown.kind === 'standard' ? breakdown.terms : [])
      .not.toContainEqual(expect.objectContaining({ label: 'critical' }))
    expect(resolveMoveAutomationTargetDamageBreakdown(
      script(),
      user,
      target,
      missedCriticalRange,
    )).toEqual({ kind: 'none', hpLoss: 0 })
  })

  it('resolves target damage with manual override, defense, weather, and type immunity', () => {
    const user = token({ id: 'u', species: 'User', atk: 12 })
    const target = token({ id: 't', species: 'Target', currentHp: 30, def: 7, defenderTypes: ['Grass'] })
    const s = script({ type: 'Fire', damageClass: 'Physical' })

    const rolledDamage = {
      ...defaultTargetResolutionState(s),
      hit: true,
      damageRoll: { formula: '2d6+8', count: 2, sides: 6, total: 20, rolls: [6, 6], mod: 8 },
    }
    expect(resolveMoveAutomationTargetDamageLoss(s, user, target, rolledDamage)).toBe(37)
    const breakdown = resolveMoveAutomationTargetDamageBreakdown(s, user, target, rolledDamage)
    expect(breakdown).toMatchObject({
      kind: 'standard',
      hpLoss: 37,
      terms: [
        { operator: 'add', amount: 20, label: 'roll' },
        { operator: 'add', amount: 12, label: 'Atk' },
        { operator: 'subtract', amount: 7, label: 'Def' },
      ],
      multiplierLabel: '1.5',
    })
    const pipeline = breakdown.kind === 'standard' ? breakdown.pipeline : null
    expect(pipeline).toMatchObject({
      damageBase: 4,
      preTypeDamage: 25,
      typeScaledDamage: 37,
      criticalScaledDamage: 37,
      hpLoss: 37,
    })
    expect(pipeline?.stages.flatMap(stage => stage.modifiers)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'damage.attack-stat',
        priority: 0,
        source: { kind: 'placement', id: 'u' },
        stackingGroup: 'attack-stat',
        reasonCode: 'damage.default-attack-stat',
      }),
      expect.objectContaining({
        id: 'damage.type-effectiveness',
        stage: 'type-effectiveness',
        value: 1.5,
      }),
    ]))

    expect(resolveMoveAutomationTargetDamageLoss(s, user, target, {
      ...defaultTargetResolutionState(s),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    }, { weather: [{ kind: 'sunny' }], terrains: [], rooms: [] })).toBe(45)

    const groundMove = script({ type: 'Ground', damageClass: 'Physical' })
    const sandForceUser = token({
      id: 'sand-user',
      species: 'Sand User',
      atk: 12,
      abilityNames: ['Sand Force'],
    })
    const neutralTarget = token({
      id: 'neutral',
      species: 'Neutral',
      currentHp: 30,
      def: 7,
      defenderTypes: [],
    })
    const groundRoll = {
      ...defaultTargetResolutionState(groundMove),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    }
    const clearGround = resolveMoveAutomationTargetDamageLoss(
      groundMove,
      sandForceUser,
      neutralTarget,
      groundRoll,
    )
    const sandGround = resolveMoveAutomationTargetDamageBreakdown(
      groundMove,
      sandForceUser,
      neutralTarget,
      groundRoll,
      { weather: [{ kind: 'sandstorm' }], terrains: [], rooms: [] },
    )
    expect(sandGround.hpLoss - clearGround).toBe(5)
    expect(sandGround.kind === 'standard' ? sandGround.pipeline : null)
      .toMatchObject({
        stages: expect.arrayContaining([
          expect.objectContaining({
            modifiers: expect.arrayContaining([
              expect.objectContaining({
                id: 'damage.weather.sandstorm.sand-force',
                source: { kind: 'ability', id: 'Sand Force' },
                reasonCode: 'weather.sandstorm.sand-force-damage-bonus',
                value: 5,
              }),
            ]),
          }),
        ]),
      })

    expect(resolveMoveAutomationTargetDamageLoss(s, user, target, {
      ...defaultTargetResolutionState(s),
      hit: true,
      manualHpLoss: '13',
    })).toBe(13)

    expect(resolveMoveAutomationTargetDamageLoss(s, user, target, {
      ...defaultTargetResolutionState(s),
      hit: false,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    })).toBe(0)

    expect(resolveMoveAutomationTargetDamageLoss(script({ type: 'Normal' }), user, token({ id: 'g', species: 'Ghost', defenderTypes: ['Ghost'] }), {
      ...defaultTargetResolutionState(s),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    })).toBe(0)
  })

  it('switches Pokémon defensive stat projections under active Wonder Room without changing tokens', () => {
    const user = token({ id: 'u', species: 'User', atk: 12, satk: 12 })
    const target = token({
      id: 't',
      species: 'Target',
      def: 5,
      sdef: 11,
      defenderTypes: [],
      combatStages: { ...stages, def: 1, sdef: -1 },
    })
    const trainer = token({
      id: 'trainer',
      species: 'Trainer',
      sheetKind: 'trainer',
      entityKind: 'trainer',
      def: 5,
      sdef: 11,
      defenderTypes: [],
    })
    const targetBefore = structuredClone(target)
    const roll = {
      ...defaultTargetResolutionState(script()),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    }
    const room = { weather: [], terrains: [], rooms: [{ kind: 'wonder' as const }] }
    const physical = script({ type: 'Normal', damageClass: 'Physical' })
    const special = script({ type: 'Normal', damageClass: 'Special' })

    const clearPhysical = resolveMoveAutomationTargetDamageLoss(physical, user, target, roll)
    const clearSpecial = resolveMoveAutomationTargetDamageLoss(special, user, target, roll)
    const wonderedPhysical = resolveMoveAutomationTargetDamageLoss(physical, user, target, roll, room)
    const wonderedSpecial = resolveMoveAutomationTargetDamageLoss(special, user, target, roll, room)

    expect(wonderedPhysical).toBe(clearSpecial)
    expect(wonderedSpecial).toBe(clearPhysical)
    expect(resolveMoveAutomationTargetDamageLoss(physical, user, trainer, roll, room))
      .toBe(resolveMoveAutomationTargetDamageLoss(physical, user, trainer, roll))
    expect(target).toEqual(targetBefore)
  })

  it('uses current Combat Stages and condition stage effects for attacking and defending stats', () => {
    const user = token({ id: 'u', species: 'User', atk: 10, combatStages: { ...stages, atk: 2 } })
    const target = token({ id: 't', species: 'Target', def: 10, combatStages: { ...stages, def: -2 }, defenderTypes: [] })
    const s = script({ type: 'Fire', damageClass: 'Physical' })

    expect(resolveMoveAutomationTargetDamageLoss(s, user, target, {
      ...defaultTargetResolutionState(s),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    })).toBe(26)

    expect(resolveMoveAutomationTargetDamageLoss(s, token({ id: 'u2', species: 'User 2', atk: 10 }), token({
      id: 'b',
      species: 'Burned Target',
      def: 10,
      defenderTypes: [],
      conditions: ['Burned'],
    }), {
      ...defaultTargetResolutionState(s),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    })).toBe(22)
  })

  it('applies Infatuation damage penalties when the crush is tracked', () => {
    const s = script({ type: 'Normal', damageClass: 'Physical' })
    const roll = {
      ...defaultTargetResolutionState(s),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
    }
    const user = token({ id: 'u', species: 'User', atk: 13, conditions: ['Infatuation: Crush'] })
    const crush = token({ id: 'crush', species: 'Crush', def: 7, defenderTypes: [] })
    const bystander = token({ id: 'b', species: 'Bystander', def: 7, defenderTypes: [] })

    expect(resolveMoveAutomationTargetDamageLoss(s, user, bystander, roll, undefined, [bystander])).toBe(21)
    expect(resolveMoveAutomationTargetDamageLoss(s, user, crush, roll, undefined, [crush])).toBe(19)
    expect(resolveMoveAutomationTargetDamageLoss(s, user, bystander, roll, undefined, [crush, bystander])).toBe(19)
    expect(resolveMoveAutomationTargetDamageLoss(
      s,
      token({ id: 'u2', species: 'User 2', atk: 13, conditions: ['Infatuation'] }),
      bystander,
      roll,
      undefined,
      [bystander],
    )).toBe(26)
  })

  it('resolves HP suggestion amounts and multiplier labels', () => {
    const s = script({
      hpSuggestions: [
        { recipient: 'target', mode: 'lose-percent-current', percent: 50, label: 'Lose half' },
        { recipient: 'target', mode: 'set-zero', label: 'Faint' },
        { recipient: 'target', mode: 'fixed-loss', amount: 6, label: 'Fixed' },
        { recipient: 'user', mode: 'recoil-percent-damage-dealt', percent: 100 / 3, rounding: 'floor', label: 'Recoil' },
      ],
    })
    const target = token({ id: 't', species: 'Target', currentHp: 22, maxHp: 50, defenderTypes: ['Grass'] })

    expect(resolveHpSuggestionAmount(s, {}, 0, target)).toBe(11)
    expect(resolveHpSuggestionAmount(s, { [moveAutomationSuggestionKey(s, 'hp', 0)]: '7' }, 0, target)).toBe(7)
    expect(resolveHpSuggestionAmount(s, {}, 1, target)).toBe(22)
    expect(resolveHpSuggestionAmount(s, {}, 2, target)).toBe(6)
    expect(resolveHpSuggestionAmount(s, {}, 3, target, { damageDealt: 20 })).toBe(6)
    expect(resolveHpSuggestionAmount(s, {}, 99, target)).toBe(0)
    expect(moveAutomationMultiplierLabel(s, target)).toBe('1.5')
    expect(moveAutomationMultiplierLabel(
      script({ type: 'Ground' }),
      token({ id: 'l', species: 'Levitate Target', defenderTypes: ['Electric'], abilityNames: ['Levitate'] }),
    )).toBe('1')
    expect(moveAutomationMultiplierLabel(
      script({ type: 'Ground' }),
      token({ id: 's', species: 'Sky Target', defenderTypes: ['Flying'], defenderCapabilities: { sky: 6 } }),
    )).toBe('½')
    expect(moveAutomationMultiplierLabel(
      script({ type: 'Ground' }),
      token({ id: 'a', species: 'Airborne Target', defenderTypes: ['Normal'], defenderCapabilities: { sky: 6 } }),
    )).toBe('1')
    expect(moveAutomationMultiplierLabel(
      script({ type: 'Ground', keywords: ['Groundsource'] }),
      token({ id: 'g', species: 'Groundsource Immune Target', defenderTypes: ['Normal'], defenderCapabilities: { sky: 6 } }),
    )).toBe('0')
  })
})
