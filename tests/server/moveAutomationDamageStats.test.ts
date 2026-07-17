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
import type {
  MapRoomKind,
  MapTerrainKind,
  MapWeatherKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
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

const mapFixture = (
  weather: readonly MapWeatherKind[] = [],
  terrains: readonly MapTerrainKind[] = [],
  rooms: readonly MapRoomKind[] = [],
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'damage-stat-arena',
  name: 'Damage Stat Arena',
  revision: 4,
  dimensions: { x: 5, y: 3, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: weather.map(kind => ({ kind })),
    terrains: terrains.map(kind => ({ kind, scope: 'field' })),
    rooms: rooms.map(kind => ({ kind })),
  },
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

const context = (options: {
  readonly weather?: readonly MapWeatherKind[]
  readonly terrains?: readonly MapTerrainKind[]
  readonly rooms?: readonly MapRoomKind[]
  readonly actorAbilities?: readonly string[]
  readonly actorCapabilities?: CharacterSheet['capabilities']
  readonly targetAbilities?: readonly string[]
  readonly targetCapabilities?: CharacterSheet['capabilities']
} = {}) => buildAuthoritativeMoveRulesContext({
  map: mapFixture(options.weather, options.terrains, options.rooms),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      ...(options.actorAbilities
        ? { abilities: options.actorAbilities.map(name => ({ name })) }
        : {}),
      ...(options.actorCapabilities ? { capabilities: options.actorCapabilities } : {}),
      stats: {
        atk: { added: 1, stage: -1 },
        def: { added: 12, stage: 2 },
        satk: { added: 8, stage: 1 },
        sdef: { added: 2, stage: 0 },
        spd: { added: 3, stage: 0 },
      },
    })],
    ['target', pokemonSheet('target', {
      ...(options.targetAbilities
        ? { abilities: options.targetAbilities.map(name => ({ name })) }
        : {}),
      ...(options.targetCapabilities ? { capabilities: options.targetCapabilities } : {}),
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
  readonly moveType?: string
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
      moveType: options.moveType ?? 'normal',
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

  it('uses Wonder Room for default and explicitly selected defensive stats without rewriting tokens', () => {
    const baseline = context()
    const wondered = context({ rooms: ['wonder'] })
    const targetBefore = structuredClone(wondered.queries.tokens.get('target-token'))
    const calculate = (
      rules: ReturnType<typeof context>,
      damageClass: 'physical' | 'special',
      defenseStat?: MoveDamageEffectOperation['payload']['defenseStat'],
    ) => resolveMoveSpecDamageCalculation({
      context: rules,
      operation: damageOperation({
        damageClass,
        ...(defenseStat ? { defenseStat } : {}),
      }),
      script: script(damageClass === 'physical' ? 'Physical' : 'Special'),
      recipient: rules.queries.tokens.get('target-token')!,
      resolution: rolledDamage(script(damageClass === 'physical' ? 'Physical' : 'Special')),
    })

    const baselinePhysical = calculate(baseline, 'physical')
    const baselineSpecial = calculate(baseline, 'special')
    const wonderedPhysical = calculate(wondered, 'physical')
    const wonderedSpecial = calculate(wondered, 'special')
    const selectedDefense = calculate(
      wondered,
      'special',
      stat('current-target', 'defense'),
    )

    expect(termAmount(wonderedPhysical.breakdown, 'Def'))
      .toBe(termAmount(baselineSpecial.breakdown, 'Sp.Def'))
    expect(termAmount(wonderedSpecial.breakdown, 'Sp.Def'))
      .toBe(termAmount(baselinePhysical.breakdown, 'Def'))
    expect(selectedDefense.stats.defenseStat?.value).toBe(
      baseline.queries.stats.resolve('target-token', {
        stat: 'special-defense',
        combatStagePolicy: 'honor',
        stageModifierPolicy: 'honor',
      })?.value,
    )
    expect(wondered.queries.tokens.get('target-token')).toEqual(targetBefore)
  })

  it('records default and contextual contributors through the ordered pipeline', () => {
    const rules = context({ weather: ['sunny'] })
    const move = { ...script('Physical'), type: 'Fire' }
    const operation = damageOperation({ damageClass: 'physical', moveType: 'fire' })
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
          id: 'damage.weather.sunny.fire',
          source: { kind: 'field', id: expect.stringMatching(/^legacy\./) },
          stackingGroup: 'weather.sunny.damage-roll',
          reasonCode: 'weather.sunny.fire-damage-bonus',
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

  it.each([
    ['sunny', 'Fire', 5, 'weather.sunny.fire-damage-bonus'],
    ['sunny', 'Water', -5, 'weather.sunny.water-damage-penalty'],
    ['rainy', 'Water', 5, 'weather.rainy.water-damage-bonus'],
    ['rainy', 'Fire', -5, 'weather.rainy.fire-damage-penalty'],
  ] as const)(
    'changes authoritative %s %s damage by the traced weather amount',
    (weather, moveType, delta, reasonCode) => {
      const calculate = (rules: ReturnType<typeof context>) => {
        const move = { ...script('Special'), type: moveType }
        return resolveMoveSpecDamageCalculation({
          context: rules,
          operation: damageOperation({
            damageClass: 'special',
            moveType: moveType.toLowerCase(),
          }),
          script: move,
          recipient: rules.queries.tokens.get('target-token')!,
          resolution: rolledDamage(move),
          selectedTargets: [rules.queries.tokens.get('target-token')!],
        })
      }
      const baseline = calculate(context())
      const changed = calculate(context({ weather: [weather] }))

      expect(changed.breakdown.hpLoss - baseline.breakdown.hpLoss).toBe(delta)
      expect(changed.weather.trace).toEqual([
        expect.objectContaining({
          interaction: 'damage',
          weatherKind: weather,
          outcome: 'applied',
          reasonCode,
          value: delta,
        }),
      ])
      expect(changed.damagePipeline?.stages.flatMap(stage => stage.modifiers))
        .toContainEqual(expect.objectContaining({ reasonCode, value: delta }))
    },
  )

  it.each([
    ['electric', 'Electric', 'terrain.electric.electric-damage-bonus'],
    ['grassy', 'Grass', 'terrain.grassy.grass-damage-bonus'],
  ] as const)(
    'changes authoritative grounded %s damage by the traced terrain amount',
    (terrain, moveType, reasonCode) => {
      const calculate = (rules: ReturnType<typeof context>) => {
        const move = { ...script('Special'), type: moveType }
        return resolveMoveSpecDamageCalculation({
          context: rules,
          operation: damageOperation({
            damageClass: 'special',
            moveType: moveType.toLowerCase(),
          }),
          script: move,
          recipient: rules.queries.tokens.get('target-token')!,
          resolution: rolledDamage(move),
          selectedTargets: [rules.queries.tokens.get('target-token')!],
        })
      }
      const baseline = calculate(context())
      const grounded = calculate(context({ terrains: [terrain] }))
      const airborne = calculate(context({
        terrains: [terrain],
        actorCapabilities: { sky: 6 },
      }))

      expect(grounded.breakdown.hpLoss - baseline.breakdown.hpLoss).toBe(10)
      expect(grounded.terrain).toMatchObject({
        modifiers: [{
          id: `damage.terrain.${terrain}.${moveType.toLowerCase()}`,
          source: { kind: 'field', id: `legacy.terrain.${terrain}` },
          reasonCode,
          value: 10,
        }],
        trace: [{
          interaction: 'damage',
          terrainKind: terrain,
          outcome: 'applied',
          reasonCode,
          value: 10,
        }],
      })
      expect(grounded.damagePipeline?.stages.flatMap(stage => stage.modifiers)
        .filter(modifier => modifier.reasonCode === reasonCode)).toHaveLength(1)
      expect(airborne.breakdown.hpLoss).toBe(baseline.breakdown.hpLoss)
      expect(airborne.terrain).toMatchObject({
        modifiers: [],
        trace: [expect.objectContaining({
          terrainKind: terrain,
          outcome: 'not-grounded',
        })],
      })
    },
  )

  it('applies target-sensitive Misty and ungrounded Psychic damage rules once', () => {
    const calculate = (
      rules: ReturnType<typeof context>,
      moveType: 'Dragon' | 'Psychic',
    ) => {
      const move = { ...script('Special'), type: moveType }
      return resolveMoveSpecDamageCalculation({
        context: rules,
        operation: damageOperation({
          damageClass: 'special',
          moveType: moveType.toLowerCase(),
        }),
        script: move,
        recipient: rules.queries.tokens.get('target-token')!,
        resolution: rolledDamage(move),
      })
    }
    const dragonBaseline = calculate(context(), 'Dragon')
    const groundedMisty = calculate(context({ terrains: ['misty'] }), 'Dragon')
    const targetGroundedMisty = calculate(context({
      terrains: ['misty'],
      actorCapabilities: { sky: 6 },
    }), 'Dragon')
    const noGroundedMisty = calculate(context({
      terrains: ['misty'],
      actorCapabilities: { sky: 6 },
      targetCapabilities: { sky: 6 },
    }), 'Dragon')
    const psychicBaseline = calculate(context({
      actorCapabilities: { sky: 6 },
      targetCapabilities: { sky: 6 },
    }), 'Psychic')
    const psychicTerrain = calculate(context({
      terrains: ['psychic'],
      actorCapabilities: { sky: 6 },
      targetCapabilities: { sky: 6 },
    }), 'Psychic')

    expect(
      (groundedMisty.damagePipeline?.preTypeDamage ?? 0)
      - (dragonBaseline.damagePipeline?.preTypeDamage ?? 0),
    ).toBe(-10)
    expect(
      (targetGroundedMisty.damagePipeline?.preTypeDamage ?? 0)
      - (dragonBaseline.damagePipeline?.preTypeDamage ?? 0),
    ).toBe(-10)
    expect(noGroundedMisty.damagePipeline?.preTypeDamage)
      .toBe(dragonBaseline.damagePipeline?.preTypeDamage)
    expect(groundedMisty.terrain).toMatchObject({
      modifiers: [{
        id: 'damage.terrain.misty.dragon',
        source: { kind: 'field', id: 'legacy.terrain.misty' },
        reasonCode: 'terrain.misty.dragon-damage-penalty',
        value: -10,
      }],
      trace: expect.arrayContaining([expect.objectContaining({
        outcome: 'applied',
        reasonCode: 'terrain.misty.dragon-damage-penalty',
      })]),
    })
    expect(
      (psychicTerrain.damagePipeline?.preTypeDamage ?? 0)
      - (psychicBaseline.damagePipeline?.preTypeDamage ?? 0),
    ).toBe(10)
    expect(psychicTerrain.terrain).toMatchObject({
      modifiers: [{
        id: 'damage.terrain.psychic.psychic',
        source: { kind: 'field', id: 'legacy.terrain.psychic' },
        reasonCode: 'terrain.psychic.psychic-damage-bonus',
        value: 10,
      }],
    })
    expect(psychicTerrain.damagePipeline?.stages.flatMap(stage => stage.modifiers)
      .filter(modifier => modifier.id === 'damage.terrain.psychic.psychic'))
      .toHaveLength(1)
  })

  it('applies Sand Force once through the authoritative weather pipeline', () => {
    const calculate = (rules: ReturnType<typeof context>) => {
      const move = { ...script('Physical'), type: 'Ground' }
      return resolveMoveSpecDamageCalculation({
        context: rules,
        operation: damageOperation({ damageClass: 'physical', moveType: 'ground' }),
        script: move,
        recipient: rules.queries.tokens.get('target-token')!,
        resolution: rolledDamage(move),
      })
    }
    const baseline = calculate(context({ weather: ['sandstorm'] }))
    const boosted = calculate(context({
      weather: ['sandstorm'],
      actorAbilities: ['Sand Force'],
    }))

    expect(boosted.breakdown.hpLoss - baseline.breakdown.hpLoss).toBe(5)
    expect(boosted.weather).toMatchObject({
      modifiers: [{
        id: 'damage.weather.sandstorm.sand-force',
        source: { kind: 'ability', id: 'actor-token:Sand Force' },
        reasonCode: 'weather.sandstorm.sand-force-damage-bonus',
        value: 5,
      }],
      trace: [{ outcome: 'applied', weatherKind: 'sandstorm', value: 5 }],
    })
    expect(boosted.damagePipeline?.stages.flatMap(stage => stage.modifiers)
      .filter(modifier => modifier.id === 'damage.weather.sandstorm.sand-force'))
      .toHaveLength(1)
  })

  it('records immunity as a prevented weather decision without creating damage', () => {
    const rules = context({ weather: ['sunny'], targetAbilities: ['Flash Fire'] })
    const move = { ...script('Special'), type: 'Fire' }
    const calculation = resolveMoveSpecDamageCalculation({
      context: rules,
      operation: damageOperation({ damageClass: 'special', moveType: 'fire' }),
      script: move,
      recipient: rules.queries.tokens.get('target-token')!,
      resolution: rolledDamage(move),
      selectedTargets: [rules.queries.tokens.get('target-token')!],
    })

    expect(calculation.moveType).toMatchObject({
      finalMultiplier: 0,
      immunitySource: 'Flash Fire',
    })
    expect(calculation.breakdown).toEqual({ kind: 'none', hpLoss: 0 })
    expect(calculation.damagePipeline).toBeNull()
    expect(calculation.weather).toMatchObject({
      modifiers: [],
      trace: [{
        interaction: 'damage',
        weatherKind: 'sunny',
        outcome: 'prevented',
        reasonCode: 'weather.damage.target-immune',
      }],
    })
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
