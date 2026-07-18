import { AROMATIC_MIST_ALLY_AREA_SCENARIOS } from './allyAreaLegacyV1'
import { ASTONISH_V2_SEMANTIC_SCENARIOS } from './openingMovesV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const APPLE_ACID_REG_002_SCENARIOS = scenarios([
  {
    scenarioId: 'apple-acid.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'apple-acid.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'apple-acid.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'apple-acid.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'apple-acid.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'apple-acid.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AQUA_JET_REG_002_SCENARIOS = scenarios([
  {
    scenarioId: 'aqua-jet.legacy-v1-hit-priority',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'aqua-jet.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'aqua-jet.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'aqua-jet.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'aqua-jet.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'aqua-jet.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AQUA_TAIL_REG_002_SCENARIOS = scenarios([
  {
    scenarioId: 'aqua-tail.legacy-v1-pass-mixed-outcomes',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'aqua-tail.legacy-v1-pass-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'aqua-tail.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'aqua-tail.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'aqua-tail.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ATTACK_ORDER_REG_002_SCENARIOS = scenarios([
  {
    scenarioId: 'attack-order.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'attack-order.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'attack-order.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'attack-order.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'attack-order.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AURA_SPHERE_REG_002_SCENARIOS = scenarios([
  {
    scenarioId: 'aura-sphere.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'aura-sphere.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'aura-sphere.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'aura-sphere.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AURORA_BEAM_REG_002_SCENARIOS = scenarios([
  {
    scenarioId: 'aurora-beam.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'aurora-beam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_002_MOVE_NAMES = Object.freeze([
  'Apple Acid',
  'Aqua Jet',
  'Aqua Tail',
  'Aromatic Mist',
  'Astonish',
  'Attack Order',
  'Aura Sphere',
  'Aurora Beam',
] as const)

export type RegisteredBatch002MoveName = (typeof REG_002_MOVE_NAMES)[number]

export const REG_002_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch002MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Apple Acid': APPLE_ACID_REG_002_SCENARIOS,
  'Aqua Jet': AQUA_JET_REG_002_SCENARIOS,
  'Aqua Tail': AQUA_TAIL_REG_002_SCENARIOS,
  'Aromatic Mist': AROMATIC_MIST_ALLY_AREA_SCENARIOS,
  Astonish: ASTONISH_V2_SEMANTIC_SCENARIOS,
  'Attack Order': ATTACK_ORDER_REG_002_SCENARIOS,
  'Aura Sphere': AURA_SPHERE_REG_002_SCENARIOS,
  'Aurora Beam': AURORA_BEAM_REG_002_SCENARIOS,
})
