import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  MoveAutomationStatQueryError,
  createMoveAutomationStatResolver,
} from '~~/server/domain/moveAutomation/stats'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MapRoomKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyCombatStageToStat } from '~/utils/combatStageStats'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (rooms: readonly MapRoomKind[] = []): TabletopMap => ({
  schemaVersion: 2,
  slug: 'stat-query-arena',
  name: 'Stat Query Arena',
  revision: 8,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: [],
    terrains: [],
    rooms: rooms.map(kind => ({ kind })),
  },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
})

const actorSheet = (): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Actor',
  species: 'Pikachu',
  level: 24,
  revision: 3,
  movelist: [{ name: 'Tackle' }],
  stats: {
    atk: { added: 5, stage: -2 },
    def: { added: 8, stage: 3 },
    satk: { added: 4, stage: 1 },
    sdef: { added: 2, stage: -1 },
    spd: { added: 3, stage: 0 },
  },
  combatStages: { acc: 2 },
  combat: { currentHp: 40, conditions: ['Burned'] },
  abilities: [{ name: 'Quick Feet' }],
})

const targetSheet = (): CharacterSheet => ({
  slug: 'target',
  nickname: 'Target',
  species: 'Snorlax',
  level: 30,
  revision: 5,
  stats: {
    atk: { added: 10, stage: 4 },
    def: { added: 4, stage: 2 },
    satk: { added: 1, stage: -2 },
    sdef: { added: 7, stage: -3 },
    spd: { added: 1, stage: 0 },
  },
  combatStages: { acc: -1 },
  combat: { currentHp: 70 },
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const context = (rooms: readonly MapRoomKind[] = []) => buildAuthoritativeMoveRulesContext({
  map: mapFixture(rooms),
  pokemonSheets: new Map([
    ['actor', actorSheet()],
    ['target', targetSheet()],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: ['target-token'],
  selectedPlacementIds: ['target-token'],
  random: createFiniteAuthoritativeMoveRandomStream([]),
  time: 5_000,
})

describe('authoritative move stat queries', () => {
  it('selects actor and target combat stats, Speed, level, and legacy unstaged values', () => {
    const rules = context()
    const actor = rules.actor.token
    const target = rules.queries.tokens.get('target-token')!

    const expected = [
      ['attack', actor.atk],
      ['special-attack', actor.satk],
      ['defense', actor.def],
      ['special-defense', actor.sdef],
      ['speed', actor.spd],
      ['level', actor.level],
    ] as const
    for (const [stat, value] of expected) {
      expect(rules.queries.stats.resolve('actor-token', { stat })).toMatchObject({
        placementId: 'actor-token',
        stat,
        baseValue: value,
        combatStagePolicy: 'ignore',
        stageModifierPolicy: 'ignore',
        value,
      })
    }

    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'level',
      combatStagePolicy: 'ignore',
      stageModifierPolicy: 'ignore',
    })).toMatchObject({ value: actor.level, appliedStage: null })
    expect(rules.queries.stats.resolve('target-token', {
      stat: 'attack',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'ignore',
    })).toMatchObject({
      baseValue: target.atk,
      authoredStage: 4,
      appliedStage: 4,
      value: applyCombatStageToStat(target.atk, 4),
    })
    expect(rules.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
  })

  it('applies or ignores positive, negative, condition, and ability stage modifiers explicitly', () => {
    const rules = context()
    const actor = rules.actor.token

    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })).toMatchObject({
      baseValue: actor.def,
      authoredStage: 3,
      stageModifier: -2,
      modifiedStage: 1,
      appliedStage: 1,
      value: applyCombatStageToStat(actor.def, 1),
    })
    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'ignore',
    })).toMatchObject({
      modifiedStage: 1,
      appliedStage: 3,
      value: applyCombatStageToStat(actor.def, 3),
    })
    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'defense',
      combatStagePolicy: 'ignore-positive',
      stageModifierPolicy: 'honor',
    })).toMatchObject({ appliedStage: 0, value: actor.def })
    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'attack',
      combatStagePolicy: 'ignore-negative',
      stageModifierPolicy: 'honor',
    })).toMatchObject({ appliedStage: 0, value: actor.atk })
    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'speed',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })).toMatchObject({
      authoredStage: 0,
      stageModifier: 2,
      appliedStage: 2,
      value: applyCombatStageToStat(actor.spd, 2),
    })
    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'level',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })).toBeNull()
  })

  it('maps Wonder Room through a non-destructive Defense and Special Defense overlay', () => {
    const baseline = context()
    const wondered = context(['wonder'])
    const baselineDefense = baseline.queries.stats.resolve('target-token', {
      stat: 'defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!
    const baselineSpecialDefense = baseline.queries.stats.resolve('target-token', {
      stat: 'special-defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!

    expect(wondered.queries.stats.resolve('target-token', {
      stat: 'defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })).toMatchObject({
      stat: 'defense',
      sourceStat: 'special-defense',
      baseValue: baselineSpecialDefense.baseValue,
      authoredStage: baselineSpecialDefense.authoredStage,
      value: baselineSpecialDefense.value,
      overlay: {
        sourceId: 'legacy.room.wonder',
        reasonCode: 'room.wonder.defenses-switched',
      },
    })
    expect(wondered.queries.stats.resolve('target-token', {
      stat: 'special-defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })).toMatchObject({
      stat: 'special-defense',
      sourceStat: 'defense',
      baseValue: baselineDefense.baseValue,
      authoredStage: baselineDefense.authoredStage,
      value: baselineDefense.value,
    })
    expect(wondered.queries.tokens.get('target-token')).toEqual(
      baseline.queries.tokens.get('target-token'),
    )
  })

  it('returns positive and negative Combat Stage magnitudes with reviewed modifier policy', () => {
    const rules = context()
    const authoredPositive = rules.queries.stats.combatStageTotal('actor-token', {
      direction: 'positive',
      stageModifierPolicy: 'ignore',
    })!
    const authoredNegative = rules.queries.stats.combatStageTotal('actor-token', {
      direction: 'negative',
      stageModifierPolicy: 'ignore',
    })!
    const modifiedPositive = rules.queries.stats.combatStageTotal('actor-token', {
      direction: 'positive',
      stageModifierPolicy: 'honor',
    })!

    expect(authoredPositive.value).toBe(6)
    expect(authoredNegative.value).toBe(3)
    expect(modifiedPositive.stages).toEqual([
      expect.objectContaining({ stage: 'atk', value: -2 }),
      expect.objectContaining({ stage: 'def', value: 1 }),
      expect.objectContaining({ stage: 'satk', value: 1 }),
      expect.objectContaining({ stage: 'sdef', value: -1 }),
      expect.objectContaining({ stage: 'spd', value: 2 }),
      expect.objectContaining({ stage: 'acc', value: 2 }),
    ])
    expect(modifiedPositive.value).toBe(6)
    expect(Object.isFrozen(modifiedPositive)).toBe(true)
    expect(Object.isFrozen(modifiedPositive.stages)).toBe(true)
  })

  it('detaches query facts from later token mutation', () => {
    const rules = context()
    const mutableToken = structuredClone(rules.actor.token)
    const resolver = createMoveAutomationStatResolver({
      placements: [rules.actor.placement],
      tokens: [mutableToken],
    })
    const before = resolver.resolve('actor-token', {
      stat: 'attack',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })

    mutableToken.atk = 999
    mutableToken.combatStages.atk = 6
    mutableToken.conditions.push('Burned')

    expect(resolver.resolve('actor-token', {
      stat: 'attack',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })).toEqual(before)
  })

  it('fails closed on forged policies and duplicate authoritative stat projections', () => {
    const rules = context()
    const actor = rules.actor.token
    expect(rules.queries.stats.resolve('actor-token', {
      stat: 'attack',
      combatStagePolicy: 'browser-total',
      stageModifierPolicy: 'honor',
    } as never)).toBeNull()
    expect(rules.queries.stats.combatStageTotal('actor-token', {
      direction: 'all',
      stageModifierPolicy: 'honor',
    } as never)).toBeNull()
    expect(() => createMoveAutomationStatResolver({
      placements: [rules.actor.placement, rules.actor.placement],
      tokens: [actor],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationStatQueryError.name,
      code: 'duplicate-placement-id',
    }))
    expect(() => createMoveAutomationStatResolver({
      placements: [rules.actor.placement],
      tokens: [actor, actor],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationStatQueryError.name,
      code: 'duplicate-token-id',
    }))
  })
})
