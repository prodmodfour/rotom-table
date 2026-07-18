import { COACHING_ALLY_AREA_SCENARIOS } from './allyAreaLegacyV1'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const CHARM_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'charm.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'charm.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'charm.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'charm.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'charm.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CONFIDE_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'confide.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'confide.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'confide.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'confide.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'confide.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CONFUSE_RAY_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'confuse-ray.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'confuse-ray.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'confuse-ray.legacy-v1-already-confused',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'confuse-ray.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'confuse-ray.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CONFUSION_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'confusion.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'confusion.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'confusion.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'confusion.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'confusion.legacy-v1-psychic-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'confusion.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'confusion.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'confusion.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const COTTON_SPORE_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'cotton-spore.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'cotton-spore.legacy-v1-powder-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'cotton-spore.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'cotton-spore.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'cotton-spore.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CRABHAMMER_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'crabhammer.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'crabhammer.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'crabhammer.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'crabhammer.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'crabhammer.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CROSS_CHOP_REG_005_SCENARIOS = scenarios([
  {
    scenarioId: 'cross-chop.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'cross-chop.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'cross-chop.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'cross-chop.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'cross-chop.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'cross-chop.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_005_MOVE_NAMES = Object.freeze([
  'Charm',
  'Coaching',
  'Confide',
  'Confuse Ray',
  'Confusion',
  'Cotton Spore',
  'Crabhammer',
  'Cross Chop',
] as const)

export const REG_005_EXECUTED_MOVE_NAMES = Object.freeze([
  'Charm',
  'Confide',
  'Confuse Ray',
  'Confusion',
  'Cotton Spore',
  'Crabhammer',
  'Cross Chop',
] as const)

export type RegisteredBatch005MoveName = (typeof REG_005_MOVE_NAMES)[number]
export type RegisteredBatch005ExecutedMoveName = (typeof REG_005_EXECUTED_MOVE_NAMES)[number]

export const REG_005_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch005MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Charm: CHARM_REG_005_SCENARIOS,
  Coaching: COACHING_ALLY_AREA_SCENARIOS,
  Confide: CONFIDE_REG_005_SCENARIOS,
  'Confuse Ray': CONFUSE_RAY_REG_005_SCENARIOS,
  Confusion: CONFUSION_REG_005_SCENARIOS,
  'Cotton Spore': COTTON_SPORE_REG_005_SCENARIOS,
  Crabhammer: CRABHAMMER_REG_005_SCENARIOS,
  'Cross Chop': CROSS_CHOP_REG_005_SCENARIOS,
})
