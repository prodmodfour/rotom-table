import { describe, expect, it } from 'vitest'
import {
  appendActiveOrderEffect,
  createActiveOrderEffect,
  expireActiveOrderEffectsForInitiativeAdvance,
  readActiveOrderEffects,
  resolveOrderExpiration,
} from '~/utils/activeOrderEffects'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { SpawnedPokemon } from '~/types/pokemon'

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
