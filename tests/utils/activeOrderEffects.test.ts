import { describe, expect, it } from 'vitest'
import {
  appendActiveOrderEffect,
  createActiveOrderEffect,
  expireActiveOrderEffectsForInitiativeAdvance,
  expireActiveOrderEffectsForInitiativeAdvanceWithResult,
  readActiveOrderEffects,
  resolveOrderExpiration,
} from '~/utils/activeOrderEffects'
import type { ActiveOrderEffect } from '~/utils/activeOrderEffects'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { SpawnedPokemon } from '~/types/pokemon'

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const token = (id: string, species: string, sheetKind: 'pokemon' | 'trainer' = 'pokemon') => ({
  id,
  species,
  sheetKind,
} as SpawnedPokemon)

const order = (overrides: Partial<TokenOrderMenuOption>): TokenOrderMenuOption => ({
  name: 'Test Order',
  tags: ['Orders'],
  frequency: 'At-Will – Standard Action',
  trigger: null,
  target: 'Your Pokémon',
  condition: null,
  effect: '',
  source: 'feature',
  sourceLabel: 'Feature',
  ...overrides,
})

const effect = (
  id: string,
  expiration: ActiveOrderEffect['expiration'],
  overrides: Partial<ActiveOrderEffect> = {},
): ActiveOrderEffect => ({
  id,
  orderName: id,
  userId: 'trainer',
  userName: 'Lenora',
  targetId: 'pikachu',
  targetName: 'Pikachu',
  startedRound: 1,
  startedActiveId: 'trainer',
  expiration,
  ...overrides,
})

describe('active order effects', () => {
  it('treats Training orders as active until the source trainer next starts a turn', () => {
    const trainer = token('trainer', 'Lenora', 'trainer')
    const effect = createActiveOrderEffect({
      user: trainer,
      order: order({ name: 'Agility Training', tags: ['Orders', 'Training'] }),
      target: token('pikachu', 'Pikachu'),
      timeline: { activeId: 'trainer', round: 2 },
      idFactory: () => 'effect-1',
    })

    expect(effect).toMatchObject({
      id: 'effect-1',
      orderName: 'Agility Training',
      targetName: 'Pikachu',
      expiration: {
        kind: 'turn-start',
        tokenId: 'trainer',
        description: "until the beginning of Lenora's next turn",
      },
    })
  })

  it('parses target-next-turn and source-next-turn order durations', () => {
    const trainer = token('trainer', 'Lenora', 'trainer')
    const pikachu = token('pikachu', 'Pikachu')

    expect(resolveOrderExpiration(order({
      name: 'Mobilize',
      effect: 'The target cannot provoke Attacks of Opportunity on their next turn.',
    }), trainer, pikachu, { activeId: 'trainer', round: 1 })).toMatchObject({
      kind: 'turn-end',
      tokenId: 'pikachu',
      description: "until the end of Pikachu's next turn",
    })

    expect(resolveOrderExpiration(order({
      name: 'Critical Moment',
      effect: 'The bonuses are tripled until the end of your next turn.',
    }), trainer, pikachu, { activeId: 'trainer', round: 1 })).toMatchObject({
      kind: 'turn-end',
      tokenId: 'trainer',
      description: "until the end of Lenora's next turn",
    })
  })

  it('expires turn-start and turn-end effects when initiative advances to the watched point', () => {
    const trainer = token('trainer', 'Lenora', 'trainer')
    const pikachu = token('pikachu', 'Pikachu')
    const training = createActiveOrderEffect({
      user: trainer,
      order: order({ name: 'Agility Training', tags: ['Orders', 'Training'] }),
      target: pikachu,
      timeline: { activeId: 'trainer', round: 1 },
      idFactory: () => 'training',
    })!
    const mobilize = createActiveOrderEffect({
      user: trainer,
      order: order({ name: 'Mobilize', effect: 'The target cannot provoke Attacks of Opportunity on their next turn.' }),
      target: pikachu,
      timeline: { activeId: 'trainer', round: 1 },
      idFactory: () => 'mobilize',
    })!

    let metadata = appendActiveOrderEffect(undefined, training)
    metadata = appendActiveOrderEffect(metadata, mobilize)

    metadata = expireActiveOrderEffectsForInitiativeAdvance(metadata, {
      before: { activeId: 'trainer', round: 1 },
      after: { activeId: 'pikachu', round: 1 },
    }, { now: () => 100 })
    expect(readActiveOrderEffects(metadata).find((effect) => effect.id === 'mobilize')?.expiration)
      .toMatchObject({ kind: 'turn-end', seenTurnStart: true })
    expect(metadata.orderLog).toBeUndefined()

    metadata = expireActiveOrderEffectsForInitiativeAdvance(metadata, {
      before: { activeId: 'pikachu', round: 1 },
      after: { activeId: 'trainer', round: 2 },
    }, { now: () => 200 })
    expect(readActiveOrderEffects(metadata)).toEqual([])
    expect(metadata.orderLog).toMatchObject([
      { at: 200, orderName: 'Agility Training', lines: ['Agility Training on Pikachu wore off.'] },
      { at: 200, orderName: 'Mobilize', lines: ['Mobilize on Pikachu wore off.'] },
    ])
  })

  it('returns structured expiration results without mutating inputs', () => {
    const turnStart = effect('turn-start-order', {
      kind: 'turn-start',
      tokenId: 'watched',
      tokenName: 'Watched',
      description: 'until Watched starts a turn',
    })
    const turnEnd = effect('turn-end-order', {
      kind: 'turn-end',
      tokenId: 'watched',
      tokenName: 'Watched',
      description: 'until Watched ends a turn',
    })
    const unrelated = effect('unrelated-order', {
      kind: 'turn-start',
      tokenId: 'other',
      tokenName: 'Other',
      description: 'until Other starts a turn',
    })
    const metadata = {
      activeOrderEffects: [turnStart, turnEnd, unrelated],
      untouched: { nested: true },
    }
    const original = cloneJson(metadata)

    const result = expireActiveOrderEffectsForInitiativeAdvanceWithResult(metadata, {
      before: { activeId: 'trainer', round: 1 },
      after: { activeId: 'watched', round: 1 },
    }, { now: () => 300 })

    expect(metadata).toEqual(original)
    expect(result.previousEffects.map((item) => item.id)).toEqual(['turn-start-order', 'turn-end-order', 'unrelated-order'])
    expect(result.expiredEffects.map((item) => item.id)).toEqual(['turn-start-order'])
    expect(result.progressedEffects.map((item) => item.id)).toEqual(['turn-end-order'])
    expect(result.currentEffects).toEqual([
      expect.objectContaining({
        id: 'turn-end-order',
        expiration: expect.objectContaining({ kind: 'turn-end', seenTurnStart: true }),
      }),
      unrelated,
    ])
    expect(result.metadata.orderLog).toEqual([
      {
        at: 300,
        userId: 'trainer',
        userName: 'Lenora',
        orderName: 'turn-start-order',
        lines: ['turn-start-order on Pikachu wore off.'],
      },
    ])
    expect(readActiveOrderEffects(result.metadata).map((item) => item.id)).toEqual(['turn-end-order', 'unrelated-order'])
  })

  it('expires turn-end effects only after the watched turn later ends', () => {
    const turnEnd = effect('turn-end-order', {
      kind: 'turn-end',
      tokenId: 'watched',
      tokenName: 'Watched',
      description: 'until Watched ends a turn',
      seenTurnStart: true,
    })

    const result = expireActiveOrderEffectsForInitiativeAdvanceWithResult({ activeOrderEffects: [turnEnd] }, {
      before: { activeId: 'watched', round: 1 },
      after: { activeId: 'trainer', round: 1 },
    }, { now: () => 400 })

    expect(result.expiredEffects.map((item) => item.id)).toEqual(['turn-end-order'])
    expect(result.progressedEffects).toEqual([])
    expect(result.currentEffects).toEqual([])
    expect(result.metadata.activeOrderEffects).toBeUndefined()
    expect(result.metadata.orderLog).toEqual([
      expect.objectContaining({
        at: 400,
        orderName: 'turn-end-order',
        lines: ['turn-end-order on Pikachu wore off.'],
      }),
    ])
  })

  it('expires round-end effects when initiative wraps into the next round', () => {
    const roundEnd = effect('round-end-order', {
      kind: 'round-end',
      round: 2,
      description: 'until round 2 ends',
    })

    const result = expireActiveOrderEffectsForInitiativeAdvanceWithResult({ activeOrderEffects: [roundEnd] }, {
      before: { activeId: 'slow', round: 2 },
      after: { activeId: 'fast', round: 3 },
    }, { now: () => 500 })

    expect(result.expiredEffects.map((item) => item.id)).toEqual(['round-end-order'])
    expect(result.currentEffects).toEqual([])
    expect(result.metadata.orderLog).toEqual([
      expect.objectContaining({ orderName: 'round-end-order' }),
    ])
  })

  it('does not create automatic expiry for bound stratagems', () => {
    expect(createActiveOrderEffect({
      user: token('trainer', 'Lenora', 'trainer'),
      order: order({
        name: 'Reckless Advance',
        tags: ['Orders', 'Stratagem'],
        frequency: 'Bind 2 AP – Standard Action',
        effect: 'While this Feature is Bound, increase damage rolls.',
      }),
      target: token('pikachu', 'Pikachu'),
      timeline: { activeId: 'trainer', round: 1 },
    })).toBeNull()
  })
})
