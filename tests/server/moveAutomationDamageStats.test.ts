import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  parseMoveEffectOperation,
  type MoveDamageEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  resolveMoveDamageStatSelections,
  resolveMoveSpecDamageBreakdown,
  resolveMoveSpecDamageCalculation,
} from '~~/server/domain/moveAutomation/damageStats'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  defaultTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'damage-stat-arena',
  name: 'Damage Stat Arena',
  revision: 4,
  dimensions: { x: 5, y: 3, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet>,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Pikachu' : 'Snorlax',
  level: slug === 'actor' ? 25 : 30,
  revision: slug === 'actor' ? 3 : 5,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  types: [],
  combat: { currentHp: 100 },
  ...overrides,
})

const context = () => buildAuthoritativeMoveRulesContext({
  map: mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      stats: {
        atk: { added: 1, stage: -1 },
        def: { added: 12, stage: 2 },
        satk: { added: 8, stage: 1 },
        sdef: { added: 2, stage: 0 },
        spd: { added: 3, stage: 0 },
      },
    })],
    ['target', pokemonSheet('target', {
      stats: {
        atk: { added: 15, stage: 3 },
        def: { added: 3, stage: -1 },
        satk: { added: 2, stage: 0 },
        sdef: { added: 10, stage: 2 },
        spd: { added: 1, stage: 0 },
      },
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Tackle',
    selection: { kind: 'single-target', targetPlacementId: 'target-token' },
  } satisfies ResolveMoveIntent,
  candidatePlacementIds: ['target-token'],
  selectedPlacementIds: ['target-token'],
  random: createFiniteAuthoritativeMoveRandomStream([]),
  time: 1_000,
})

const script = (
  damageClass: 'Physical' | 'Special',
): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Stat Selector Test',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: false,
  damageBase: 4,
  damageClass,
  type: 'Normal',
  ac: null,
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
})

const stat = (
  subject: 'actor' | 'current-target',
  value: 'attack' | 'special-attack' | 'defense' | 'special-defense',
) => ({
  kind: 'stat' as const,
  subject: { kind: subject },
  stat: value,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
})

const damageOperation = (options: {
  readonly damageClass: 'physical' | 'special'
  readonly attackStat?: unknown
  readonly defenseStat?: unknown
}): MoveDamageEffectOperation => {
  const parsed = parseMoveEffectOperation({
    id: 'operation.stat-damage',
    kind: 'damage',
    source: { kind: 'move', id: 'move.stat-selector-test' },
    recipients: { kind: 'hit-targets' },
    phase: 'damage',
    reasonCode: 'move.stat-selector-test.damage',
    payload: {
      damageClass: options.damageClass,
      damageBase: 4,
      moveType: 'normal',
      accuracyRollId: null,
      criticalRollId: null,
      ...(options.attackStat === undefined ? {} : { attackStat: options.attackStat }),
      ...(options.defenseStat === undefined ? {} : { defenseStat: options.defenseStat }),
    },
  })
  if (parsed.kind !== 'damage') throw new Error('Expected damage operation')
  return parsed
}

const rolledDamage = (move: MoveAutomationScript) => ({
  ...defaultTargetResolutionState(move),
  hit: true,
  damageRoll: {
    formula: 'flat',
    count: 0,
    sides: 0,
    total: 20,
    rolls: [],
    mod: 20,
  },
})

const resolve = (
  rules: ReturnType<typeof context>,
  move: MoveAutomationScript,
  operation: MoveDamageEffectOperation,
) => resolveMoveSpecDamageBreakdown({
  context: rules,
  operation,
  script: move,
  recipient: rules.queries.tokens.get('target-token')!,
  resolution: rolledDamage(move),
  selectedTargets: [rules.queries.tokens.get('target-token')!],
})

const termAmount = (
  breakdown: ReturnType<typeof resolve>,
  label: string,
): number => breakdown.kind === 'standard'
  ? breakdown.terms.find(term => term.label === label)?.amount ?? -1
  : -1

describe('MoveSpec alternate attack and defense stat selection', () => {
  it('supports Body Press, Foul Play, and Psyshock-family stat sources', () => {
    const rules = context()
    const bodyPress = damageOperation({
      damageClass: 'physical',
      attackStat: stat('actor', 'defense'),
    })
    const foulPlay = damageOperation({
      damageClass: 'physical',
      attackStat: stat('current-target', 'attack'),
    })
    const psyshock = damageOperation({
      damageClass: 'special',
      attackStat: stat('actor', 'special-attack'),
      defenseStat: stat('current-target', 'defense'),
    })

    const bodyPressStats = resolveMoveDamageStatSelections({
      context: rules,
      operation: bodyPress,
      recipientId: 'target-token',
    })
    const foulPlayStats = resolveMoveDamageStatSelections({
      context: rules,
      operation: foulPlay,
      recipientId: 'target-token',
    })
    const psyshockStats = resolveMoveDamageStatSelections({
      context: rules,
      operation: psyshock,
      recipientId: 'target-token',
    })

    expect(bodyPressStats.attackStat).toMatchObject({
      label: 'Def',
      applyActorOffenseModifiers: false,
    })
    expect(foulPlayStats.attackStat).toMatchObject({
      label: 'Target Atk',
      applyActorOffenseModifiers: false,
    })
    expect(psyshockStats).toMatchObject({
      attackStat: { label: 'Sp.Atk', applyActorOffenseModifiers: true },
      defenseStat: { label: 'Target Def' },
    })

    const bodyPressDamage = resolve(rules, script('Physical'), bodyPress)
    const foulPlayDamage = resolve(rules, script('Physical'), foulPlay)
    const psyshockDamage = resolve(rules, script('Special'), psyshock)
    expect(termAmount(bodyPressDamage, 'Def')).toBe(bodyPressStats.attackStat?.value)
    expect(termAmount(foulPlayDamage, 'Target Atk')).toBe(foulPlayStats.attackStat?.value)
    expect(termAmount(psyshockDamage, 'Sp.Atk')).toBe(psyshockStats.attackStat?.value)
    expect(termAmount(psyshockDamage, 'Target Def')).toBe(psyshockStats.defenseStat?.value)
    expect(rules.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
  })

  it('records default and contextual contributors through the ordered pipeline', () => {
    const rules = context()
    const move = { ...script('Physical'), type: 'Fire' }
    const operation = damageOperation({ damageClass: 'physical' })
    const resolution = {
      ...rolledDamage(move),
      crit: true,
      damageRoll: {
        formula: '2d6+8',
        count: 2,
        sides: 6,
        total: 20,
        rolls: [4, 6],
        mod: 10,
      },
    }
    const calculation = resolveMoveSpecDamageCalculation({
      context: rules,
      operation,
      script: move,
      recipient: rules.queries.tokens.get('target-token')!,
      resolution,
      fieldEffects: {
        weather: [{ kind: 'sunny' }],
        terrains: [],
        rooms: [],
      },
    })

    expect(calculation.damagePipeline?.stages.map(stage => stage.stage)).toEqual([
      'base-damage-base',
      'attack-stat',
      'defense-stat',
      'pre-type-modifiers',
      'type-effectiveness',
      'critical-modifiers',
      'post-damage-modifiers',
      'minimum-damage',
      'final-hp-loss',
    ])
    expect(calculation.damagePipeline).toMatchObject({
      damageBase: 4,
      minimumDamageApplied: false,
    })
    expect(calculation.damagePipeline?.stages.flatMap(stage => stage.modifiers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'damage.field-roll',
          source: { kind: 'field', id: 'active-field-effects' },
          stackingGroup: 'field-damage-roll',
          reasonCode: 'damage.field-roll-modifier',
          value: 5,
        }),
        expect.objectContaining({
          id: 'damage.critical-roll',
          stage: 'critical-modifiers',
          source: { kind: 'move', id: 'Stat Selector Test' },
          value: 10,
        }),
      ]),
    )
    expect(calculation.damagePipeline?.criticalScaledDamage).toBe(
      (calculation.damagePipeline?.typeScaledDamage ?? 0) + 10,
    )
    expect(calculation.breakdown.hpLoss).toBe(calculation.damagePipeline?.hpLoss)
  })

  it('compares alternate offense and defense stats deterministically', () => {
    const rules = context()
    const operation = damageOperation({
      damageClass: 'special',
      attackStat: {
        kind: 'max',
        values: [
          stat('actor', 'attack'),
          stat('actor', 'special-attack'),
        ],
      },
      defenseStat: {
        kind: 'min',
        values: [
          stat('current-target', 'defense'),
          stat('current-target', 'special-defense'),
        ],
      },
    })

    const selections = resolveMoveDamageStatSelections({
      context: rules,
      operation,
      recipientId: 'target-token',
    })
    const actorAttack = rules.queries.stats.resolve('actor-token', {
      stat: 'attack',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!.value
    const actorSpecialAttack = rules.queries.stats.resolve('actor-token', {
      stat: 'special-attack',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!.value
    const targetDefense = rules.queries.stats.resolve('target-token', {
      stat: 'defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!.value
    const targetSpecialDefense = rules.queries.stats.resolve('target-token', {
      stat: 'special-defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!.value

    expect(selections).toMatchObject({
      attackStat: {
        value: Math.max(actorAttack, actorSpecialAttack),
        label: 'Higher Stat',
        applyActorOffenseModifiers: true,
      },
      defenseStat: {
        value: Math.min(targetDefense, targetSpecialDefense),
        label: 'Lower Stat',
      },
    })
    expect(selections.trace.map(entry => entry.nodeId)).toEqual([
      'operation.stat-damage.attackStat.target-token.values.0',
      'operation.stat-damage.attackStat.target-token.values.1',
      'operation.stat-damage.attackStat.target-token',
      'operation.stat-damage.defenseStat.target-token.values.0',
      'operation.stat-damage.defenseStat.target-token.values.1',
      'operation.stat-damage.defenseStat.target-token',
    ])
    const breakdown = resolve(rules, script('Special'), operation)
    expect(termAmount(breakdown, 'Higher Stat')).toBe(selections.attackStat?.value)
    expect(termAmount(breakdown, 'Lower Stat')).toBe(selections.defenseStat?.value)
    expect(Object.isFrozen(selections)).toBe(true)
    expect(Object.isFrozen(selections.trace)).toBe(true)
  })
})
