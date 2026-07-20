import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  parseMoveEffectOperation,
  type MoveCriticalHitPolicy,
  type MoveDamageEffectOperation,
  type MoveDamageType,
  type MoveDamageTypeEffectivenessPolicy,
} from '#shared/moveAutomation/effects'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  resolveMoveCriticalHit,
} from '~~/server/domain/moveAutomation/criticalHits'
import {
  resolveMoveSpecDamageCalculation,
} from '~~/server/domain/moveAutomation/damageStats'
import { resolveImmediateMoveSpec } from '~~/server/domain/moveAutomation/resolveImmediateSpec'
import type { MoveSpecV2Runtime } from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import {
  MoveDamageTypeResolutionError,
  resolveMoveDamageType,
} from '~~/server/domain/moveAutomation/damageTypes'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { defaultTargetResolutionState } from '~/utils/moveAutomationTargetResolution'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet>,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Oricorio' : 'Snorlax',
  level: 30,
  revision: slug === 'actor' ? 3 : 7,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 100 },
  stats: {
    atk: { added: 10, stage: slug === 'actor' ? -2 : 0 },
    def: { added: 10, stage: slug === 'target' ? 3 : 0 },
    satk: { added: 10, stage: 0 },
    sdef: { added: 10, stage: 0 },
    spd: { added: 10, stage: 0 },
  },
  ...overrides,
})

const context = (options: {
  readonly actorTypes?: readonly string[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly randomValues?: readonly number[]
} = {}) => buildAuthoritativeMoveRulesContext({
  map: {
    schemaVersion: 2,
    slug: 'damage-overrides-arena',
    name: 'Damage Overrides Arena',
    revision: 5,
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
  } satisfies TabletopMap,
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', { types: [...(options.actorTypes ?? ['Fire'])] })],
    ['target', pokemonSheet('target', {
      types: [...(options.targetTypes ?? ['Grass'])],
      abilities: (options.targetAbilities ?? []).map(name => ({ name })),
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
  random: createFiniteAuthoritativeMoveRandomStream(options.randomValues ?? []),
  time: 10_000,
})

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Tackle',
  version: 2,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
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

const canonicalTypePolicy = (
  overrides: Partial<MoveDamageTypeEffectivenessPolicy> = {},
): MoveDamageTypeEffectivenessPolicy => ({
  immunity: 'honor',
  resistance: 'honor',
  weakness: 'honor',
  effectivenessOverride: null,
  defenderTypeOverrides: [],
  ...overrides,
})

const damageOperation = (options: {
  readonly moveType?: MoveDamageType
  readonly typeEffectiveness?: MoveDamageTypeEffectivenessPolicy
  readonly criticalHit?: MoveCriticalHitPolicy
  readonly attackStat?: unknown
  readonly defenseStat?: unknown
} = {}): MoveDamageEffectOperation => {
  const parsed = parseMoveEffectOperation({
    id: 'operation.damage-overrides',
    kind: 'damage',
    source: { kind: 'move', id: 'move.tackle' },
    recipients: { kind: 'hit-targets' },
    phase: 'damage',
    reasonCode: 'move.tackle.damage',
    payload: {
      damageClass: 'physical',
      damageBase: 4,
      moveType: options.moveType ?? 'normal',
      accuracyRollId: 'roll.accuracy',
      criticalRollId: null,
      ...(options.typeEffectiveness ? { typeEffectiveness: options.typeEffectiveness } : {}),
      ...(options.criticalHit ? { criticalHit: options.criticalHit } : {}),
      ...(options.attackStat ? { attackStat: options.attackStat } : {}),
      ...(options.defenseStat ? { defenseStat: options.defenseStat } : {}),
    },
  })
  if (parsed.kind !== 'damage') throw new Error('Expected damage operation')
  return parsed
}

const stat = (
  subject: 'actor' | 'current-target',
  value: 'attack' | 'defense',
  combatStagePolicy: 'honor' | 'ignore' | 'ignore-positive' | 'ignore-negative',
) => ({
  kind: 'stat' as const,
  subject: { kind: subject },
  stat: value,
  combatStagePolicy,
  stageModifierPolicy: 'honor' as const,
})

describe('MoveSpec type-effectiveness and critical-hit overrides', () => {
  it('resolves move-type expressions per recipient and derives dynamic STAB', () => {
    const rules = context({ actorTypes: ['Fire'], targetTypes: ['Grass'] })
    const operation = damageOperation({
      moveType: { kind: 'type', of: 'primary', subject: { kind: 'actor' } },
    })

    const result = resolveMoveDamageType({
      context: rules,
      operation,
      script: script({ moveName: 'Revelation Dance' }),
      recipientId: 'target-token',
      canonicalMoveId: 'Tackle',
    })

    expect(result).toMatchObject({
      moveType: 'Fire',
      moveTypeSource: 'expression',
      defenderTypes: ['Grass'],
      baseMultiplier: 1.5,
      finalMultiplier: 1.5,
      finalRelation: 'weak',
      hasStab: true,
    })
    expect(result.evaluationTrace.at(-1)).toMatchObject({
      nodeId: 'operation.damage-overrides.moveType.target-token',
      value: 'fire',
    })
    expect(rules.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 7 },
    ])
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('alters one defender relation and independently ignores immunity, resistance, and weakness', () => {
    const freezeDryRules = context({ targetTypes: ['Water'] })
    const freezeDry = resolveMoveDamageType({
      context: freezeDryRules,
      operation: damageOperation({
        moveType: 'ice',
        typeEffectiveness: canonicalTypePolicy({
          defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
        }),
      }),
      script: script({ moveName: 'Freeze-Dry', type: 'Ice' }),
      recipientId: 'target-token',
    })
    expect(freezeDry).toMatchObject({
      moveType: 'Ice',
      baseMultiplier: 1.5,
      finalMultiplier: 1.5,
      defenderTypeEvaluations: [{
        defenderType: 'Water',
        relation: 'weak',
        source: 'move-override',
        ignored: false,
      }],
    })

    const mixedRules = context({ targetTypes: ['Ghost', 'Rock'] })
    const honor = resolveMoveDamageType({
      context: mixedRules,
      operation: damageOperation(),
      script: script(),
      recipientId: 'target-token',
    })
    const ignoreImmunity = resolveMoveDamageType({
      context: mixedRules,
      operation: damageOperation({
        typeEffectiveness: canonicalTypePolicy({ immunity: 'ignore' }),
      }),
      script: script(),
      recipientId: 'target-token',
    })
    const ignoreBoth = resolveMoveDamageType({
      context: mixedRules,
      operation: damageOperation({
        typeEffectiveness: canonicalTypePolicy({
          immunity: 'ignore',
          resistance: 'ignore',
        }),
      }),
      script: script(),
      recipientId: 'target-token',
    })

    expect(honor).toMatchObject({ finalMultiplier: 0, immunitySource: 'Ghost type' })
    expect(ignoreImmunity).toMatchObject({ finalMultiplier: 0.5, immunitySource: null })
    expect(ignoreBoth).toMatchObject({ finalMultiplier: 1, finalRelation: 'neutral' })
  })

  it('honors or bypasses passive immunity and applies an exact effectiveness override', () => {
    const rules = context({ targetTypes: ['Grass'], targetAbilities: ['Flash Fire'] })
    const honored = resolveMoveDamageType({
      context: rules,
      operation: damageOperation({ moveType: 'fire' }),
      script: script({ type: 'Fire' }),
      recipientId: 'target-token',
    })
    const ignored = resolveMoveDamageType({
      context: rules,
      operation: damageOperation({
        moveType: 'fire',
        typeEffectiveness: canonicalTypePolicy({ immunity: 'ignore' }),
      }),
      script: script({ type: 'Fire' }),
      recipientId: 'target-token',
    })
    const passiveOnly = resolveMoveDamageType({
      context: rules,
      operation: damageOperation({
        moveType: 'fire',
        typeEffectiveness: canonicalTypePolicy({ passiveImmunity: 'ignore' }),
      }),
      script: script({ type: 'Fire' }),
      recipientId: 'target-token',
    })
    const chartImmunity = resolveMoveDamageType({
      context: context({ targetTypes: ['Ghost'], targetAbilities: ['Flash Fire'] }),
      operation: damageOperation({
        moveType: 'normal',
        typeEffectiveness: canonicalTypePolicy({ passiveImmunity: 'ignore' }),
      }),
      script: script(),
      recipientId: 'target-token',
    })
    const overridden = resolveMoveDamageType({
      context: rules,
      operation: damageOperation({
        moveType: 'fire',
        typeEffectiveness: canonicalTypePolicy({
          immunity: 'ignore',
          weakness: 'ignore',
          effectivenessOverride: 2,
        }),
      }),
      script: script({ type: 'Fire' }),
      recipientId: 'target-token',
    })

    expect(honored).toMatchObject({ finalMultiplier: 0, immunitySource: 'Flash Fire' })
    expect(ignored).toMatchObject({ baseMultiplier: 1.5, finalMultiplier: 1.5 })
    expect(passiveOnly).toMatchObject({ baseMultiplier: 1.5, finalMultiplier: 1.5 })
    expect(chartImmunity).toMatchObject({ finalMultiplier: 0, immunitySource: 'Ghost type' })
    expect(overridden).toMatchObject({ baseMultiplier: 1, finalMultiplier: 2 })
  })

  it('supports guaranteed, expanded-range, explicit-roll, and prevented critical hits', () => {
    const armored = context({ targetAbilities: ['Battle Armor'] })
    const always = damageOperation({
      criticalHit: { trigger: { kind: 'always' }, prevention: 'honor' },
    })
    const prevented = resolveMoveCriticalHit({
      context: armored,
      operation: always,
      script: script(),
      recipientId: 'target-token',
      naturalRoll: 7,
    })
    const bypassed = resolveMoveCriticalHit({
      context: armored,
      operation: damageOperation({
        criticalHit: { trigger: { kind: 'always' }, prevention: 'ignore' },
      }),
      script: script(),
      recipientId: 'target-token',
      naturalRoll: 7,
    })
    const expanded = resolveMoveCriticalHit({
      context: context(),
      operation: damageOperation({
        criticalHit: { trigger: { kind: 'range', minimum: 18 }, prevention: 'honor' },
      }),
      script: script(),
      recipientId: 'target-token',
      naturalRoll: 18,
    })
    const even = resolveMoveCriticalHit({
      context: context(),
      operation: damageOperation({
        criticalHit: {
          trigger: { kind: 'natural-rolls', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
          prevention: 'honor',
        },
      }),
      script: script(),
      recipientId: 'target-token',
      naturalRoll: 16,
    })

    expect(prevented).toMatchObject({
      candidate: true,
      preventedBy: 'Battle Armor',
      critical: false,
      reasonCode: 'critical-prevented',
    })
    expect(bypassed).toMatchObject({ critical: true, preventedBy: null })
    expect(expanded).toMatchObject({ critical: true, trigger: { kind: 'range', minimum: 18 } })
    expect(even).toMatchObject({ critical: true, trigger: { kind: 'natural-rolls' } })
  })

  it('combines type, critical, and explicit stage policies in the ordered damage calculation', () => {
    const rules = context({ actorTypes: ['Ice'], targetTypes: ['Water'] })
    const operation = damageOperation({
      moveType: { kind: 'type', of: 'primary', subject: { kind: 'actor' } },
      typeEffectiveness: canonicalTypePolicy({
        defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
      }),
      criticalHit: { trigger: { kind: 'always' }, prevention: 'honor' },
      attackStat: stat('actor', 'attack', 'ignore-negative'),
      defenseStat: stat('current-target', 'defense', 'ignore-positive'),
    })
    const move = script({ moveName: 'Freeze-Dry', type: 'Ice' })
    const calculation = resolveMoveSpecDamageCalculation({
      context: rules,
      operation,
      script: move,
      recipient: rules.queries.tokens.get('target-token')!,
      resolution: {
        ...defaultTargetResolutionState(move),
        hit: true,
        damageRoll: {
          formula: '2d6+8',
          count: 2,
          sides: 6,
          rolls: [4, 6],
          mod: 10,
          total: 20,
        },
      },
      naturalCriticalRoll: 7,
    })
    const actorWithoutNegativeStage = rules.queries.stats.resolve('actor-token', {
      stat: 'attack',
      combatStagePolicy: 'ignore-negative',
      stageModifierPolicy: 'honor',
    })!.value
    const targetWithoutPositiveStage = rules.queries.stats.resolve('target-token', {
      stat: 'defense',
      combatStagePolicy: 'ignore-positive',
      stageModifierPolicy: 'honor',
    })!.value

    expect(calculation).toMatchObject({
      moveType: { moveType: 'Ice', finalMultiplier: 1.5, hasStab: true },
      criticalHit: { critical: true },
      stats: {
        attackStat: { value: actorWithoutNegativeStage },
        defenseStat: { value: targetWithoutPositiveStage },
      },
      breakdown: { kind: 'standard', critical: true },
      damagePipeline: {
        criticalScaledDamage: expect.any(Number),
        hpLoss: expect.any(Number),
      },
    })
    expect(calculation.damagePipeline?.criticalScaledDamage).toBeGreaterThan(
      calculation.damagePipeline?.typeScaledDamage ?? 0,
    )
  })

  it('carries dynamic type and guaranteed-critical evidence through immediate reduction', () => {
    const rules = context({
      actorTypes: ['Ice'],
      targetTypes: ['Water'],
      randomValues: [0.3, 0, 0],
    })
    const operation = damageOperation({
      moveType: { kind: 'type', of: 'primary', subject: { kind: 'actor' } },
      typeEffectiveness: canonicalTypePolicy({
        defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
      }),
      criticalHit: { trigger: { kind: 'always' }, prevention: 'honor' },
    })
    const definition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Tackle',
      version: 2,
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      preconditions: [],
      costs: [],
      phases: [
        {
          phase: 'accuracy',
          operations: [{
            id: 'operation.accuracy',
            kind: 'roll',
            source: { kind: 'move', id: 'move.tackle' },
            recipients: { kind: 'attacked-targets' },
            phase: 'accuracy',
            reasonCode: 'move.tackle.accuracy',
            payload: {
              rollId: 'roll.accuracy',
              formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
            },
          }],
        },
        { phase: 'damage', operations: [operation] },
      ],
      registeredHandlerId: null,
      presentation: { displayName: 'Tackle', vfxKey: null, tags: ['damage'] },
    })
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Tackle',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/damage-overrides',
      definition,
    }
    const entry = rules.queries.resolveActorMoveEntry('Tackle')
    if (!entry.ok) throw new Error(entry.message)

    const resolution = resolveImmediateMoveSpec({
      context: rules,
      runtime,
      entry: entry.entry,
      authoritativeTargetIds: ['target-token'],
    })
    const damageEvent = resolution.trace.events.findLast(event => (
      event.kind === 'operation'
      && event.operationId === 'operation.damage-overrides'
      && typeof event.result === 'object'
      && event.result !== null
      && 'recipients' in event.result
    ))

    expect(resolution.rollLedger.map(entry => entry.formula)).toEqual([
      { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      { kind: 'dice', count: 2, sides: 6, modifier: 8 },
    ])
    expect(resolution.transaction.hpUpdates).toHaveLength(1)
    expect(damageEvent).toMatchObject({
      kind: 'operation',
      outcome: 'applied',
      result: {
        recipients: [{
          details: {
            calculation: {
              moveType: {
                moveType: 'Ice',
                finalMultiplier: 1.5,
                hasStab: true,
              },
              criticalHit: { critical: true },
              damagePipeline: {
                damageBase: 6,
                criticalScaledDamage: expect.any(Number),
                hpLoss: expect.any(Number),
              },
            },
          },
        }],
      },
    })
  })

  it('fails closed for a non-canonical type expression result', () => {
    const rules = context()
    const operation = damageOperation({
      moveType: { kind: 'constant', value: 'mystery' },
    })

    expect(() => resolveMoveDamageType({
      context: rules,
      operation,
      script: script(),
      recipientId: 'target-token',
    })).toThrowError(expect.objectContaining({
      name: MoveDamageTypeResolutionError.name,
      code: 'unknown-move-type',
      operationId: 'operation.damage-overrides',
      recipientId: 'target-token',
    }))
  })
})
