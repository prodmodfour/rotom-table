import { describe, expect, it } from 'vitest'
import { battleContestVariant, contestCatalog } from '#shared/contests/catalog'
import type { ContestEffectId } from '#shared/contests/ids'
import {
  resolveContestEffectConsequences,
  scoreContestAppealResults,
  terminalContestEffectVoltage,
} from '../../shared/contests/effectResolution'

const resolve = (effectId: ContestEffectId, overrides: Partial<Parameters<typeof resolveContestEffectConsequences>[0]> = {}) => resolveContestEffectConsequences({
  effectId,
  results: [1, 6, 6],
  actor: { contestantId: 'contestant:actor', performerId: 'pokemon:actor', voltage: 2 },
  attentionRecipient: null,
  adjacentVoltageTargets: [{ contestantId: 'contestant:opponent', performerId: 'pokemon:opponent', voltage: 3 }],
  adjacentFumbleTargets: [{ contestantId: 'contestant:opponent', protected: false }],
  repeatedMove: true,
  matchingType: true,
  ...overrides,
})

const consequence = (result: ReturnType<typeof resolve>, contestantId: string, reason: string) => result.consequences.find(row => row.contestantId === contestantId && row.reason === reason)

describe('canonical Battle Contest Effect resolution', () => {
  it('binds the reviewed Battle policy to every handler-backed canonical effect and rejects no reviewed identity', () => {
    expect(battleContestVariant.contestEffectPolicy).toMatchObject({
      semantics: 'canonical-contest-effect-handler',
      unknownEffectPolicy: 'reject',
      actorVoltageTarget: 'acting-pokemon',
      adjacentVoltageTargets: 'all-opposing-pokemon-on-field',
      indirectFumbleTarget: 'opposing-trainer-team',
      onFieldPokemonMinimumPerTrainer: 1,
      onFieldPokemonMaximumPerTrainer: 6,
      onFieldPokemonAuthority: 'linked-map-placements',
      roundIdentity: 'encounter-round',
    })
    expect(battleContestVariant.contestEffectPolicy.supportedEffectIds).toEqual(contestCatalog.contestEffects.map(row => row.id))
    for (const effectId of battleContestVariant.contestEffectPolicy.supportedEffectIds) {
      const result = resolve(effectId)
      expect(result.actorVoltage).toBeGreaterThanOrEqual(0)
      expect(result.actorVoltage).toBeLessThanOrEqual(contestCatalog.performance.voltage.maximum)
      expect(result.consequences.every(row => row.appealDelta === 0)).toBe(true)
    }
  })

  it('uses one shared scorer for ordinary and Battle Appeal results', () => {
    expect(scoreContestAppealResults([1, 2, 3, 4, 5, 6], 'steady-performance', false)).toEqual({ appeal: 6, fumble: 0 })
    expect(scoreContestAppealResults([1, 2, 3, 4, 5, 6], 'steady-performance', true)).toEqual({ appeal: 8, fumble: 1 })
    expect(scoreContestAppealResults([1, 6, 6], 'desperation', false)).toEqual({ appeal: 6, fumble: 1 })
    expect(scoreContestAppealResults([1, 5, 6], 'tease', false)).toEqual({ appeal: 2, fumble: 0 })
    expect(scoreContestAppealResults([1, 5, 6], 'safe-option', false)).toEqual({ appeal: 1, fumble: 0 })
    expect(scoreContestAppealResults([1, 5, 6], 'sabotage', false)).toEqual({ appeal: 0, fumble: 0 })
  })

  it('targets actor and opposing on-field Pokémon Voltage without changing Trainer-team Voltage', () => {
    expect(resolve('big-show').actorVoltage).toBe(5)
    expect(consequence(resolve('big-show'), 'contestant:actor', 'Big Show')).toMatchObject({ performerId: 'pokemon:actor', voltageDelta: 3 })
    expect(consequence(resolve('special-attention'), 'contestant:opponent', 'Special Attention')).toMatchObject({ performerId: 'pokemon:opponent', voltageDelta: 1 })
    expect(resolve('unsettling')).toMatchObject({ actorVoltage: 0 })
    expect(consequence(resolve('unsettling'), 'contestant:opponent', 'Unsettling')).toMatchObject({ voltageDelta: -1 })
    expect(consequence(resolve('incentives'), 'contestant:actor', 'Incentives')).toMatchObject({ voltageDelta: 1 })
    expect(consequence(resolve('incentives'), 'contestant:opponent', 'Incentives')).toMatchObject({ voltageDelta: -1 })
    expect(resolve('gamble').actorVoltage).toBe(4)
    expect(resolve('reliable').actorVoltage).toBe(3)
  })

  it('transfers Attention Grabber Voltage per opposing active Pokémon with canonical caps', () => {
    const result = resolve('attention-grabber', {
      actor: { contestantId: 'contestant:actor', performerId: 'pokemon:actor', voltage: 4 },
      adjacentVoltageTargets: [
        { contestantId: 'contestant:opponent', performerId: 'pokemon:opponent-a', voltage: 3 },
        { contestantId: 'contestant:opponent', performerId: 'pokemon:opponent-b', voltage: 1 },
      ],
    })
    expect(result.actorVoltage).toBe(5)
    expect(result.consequences).toEqual(expect.arrayContaining([
      expect.objectContaining({ contestantId: 'contestant:actor', performerId: 'pokemon:actor', voltageDelta: 1 }),
      expect.objectContaining({ contestantId: 'contestant:opponent', performerId: 'pokemon:opponent-a', voltageDelta: -2 }),
      expect.objectContaining({ contestantId: 'contestant:opponent', performerId: 'pokemon:opponent-b', voltageDelta: -1 }),
    ]))
  })

  it('assigns indirect Fumble to the opposing Trainer team and honors same-round Saving Grace protection', () => {
    expect(consequence(resolve('sabotage'), 'contestant:opponent', 'Sabotage')).toMatchObject({ performerId: null, fumbleDelta: 3, voltageDelta: 0 })
    expect(consequence(resolve('tease'), 'contestant:opponent', 'Tease')).toMatchObject({ performerId: null, fumbleDelta: 2, voltageDelta: 0 })
    const protectedSabotage = resolve('sabotage', { adjacentFumbleTargets: [{ contestantId: 'contestant:opponent', protected: true }] })
    const protectedTease = resolve('tease', { adjacentFumbleTargets: [{ contestantId: 'contestant:opponent', protected: true }] })
    expect(consequence(protectedSabotage, 'contestant:opponent', 'Sabotage')).toMatchObject({ fumbleDelta: 0 })
    expect(consequence(protectedTease, 'contestant:opponent', 'Tease')).toMatchObject({ fumbleDelta: 0 })
  })

  it('applies terminal Get Ready, Double Time, and Seen Nothing Yet Voltage transitions to the actor only', () => {
    expect(terminalContestEffectVoltage('get-ready', 4)).toBe(2)
    expect(terminalContestEffectVoltage('double-time', 1)).toBe(0)
    expect(terminalContestEffectVoltage('seen-nothing-yet', 5)).toBe(0)
    expect(terminalContestEffectVoltage('steady-performance', 3)).toBe(3)
  })
})
