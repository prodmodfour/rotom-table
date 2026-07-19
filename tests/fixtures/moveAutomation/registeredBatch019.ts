import { PIN_MISSILE_V2_SEMANTIC_SCENARIOS } from './strikeCanariesV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const PETAL_BLIZZARD_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'petal-blizzard.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'petal-blizzard.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'petal-blizzard.legacy-v1-sap-sipper-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'petal-blizzard.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'petal-blizzard.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PIN_MISSILE_REG_019_SCENARIOS = scenarios([
  ...PIN_MISSILE_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'pin-missile.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PLAY_NICE_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'play-nice.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'play-nice.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'play-nice.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'play-nice.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'play-nice.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PLAY_ROUGH_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'play-rough.legacy-v1-stage-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-stage-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'play-rough.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POISON_FANG_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'poison-fang.legacy-v1-bad-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-bad-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'poison-fang.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POISON_GAS_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'poison-gas.legacy-v1-burst-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'poison-gas.legacy-v1-cone-branch',
    evidenceClasses: ['alternate-branch', 'hit'],
  },
  {
    scenarioId: 'poison-gas.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-gas.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'poison-gas.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POISON_JAB_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'poison-jab.legacy-v1-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'poison-jab.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POISON_POWDER_REG_019_SCENARIOS = scenarios([
  {
    scenarioId: 'poison-powder.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'poison-powder.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'poison-powder.legacy-v1-powder-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-powder.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-powder.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'poison-powder.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_019_MOVE_NAMES = Object.freeze([
  'Petal Blizzard',
  'Pin Missile',
  'Play Nice',
  'Play Rough',
  'Poison Fang',
  'Poison Gas',
  'Poison Jab',
  'Poison Powder',
] as const)

export type RegisteredBatch019MoveName = (typeof REG_019_MOVE_NAMES)[number]

export const REG_019_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch019MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Petal Blizzard': PETAL_BLIZZARD_REG_019_SCENARIOS,
  'Pin Missile': PIN_MISSILE_REG_019_SCENARIOS,
  'Play Nice': PLAY_NICE_REG_019_SCENARIOS,
  'Play Rough': PLAY_ROUGH_REG_019_SCENARIOS,
  'Poison Fang': POISON_FANG_REG_019_SCENARIOS,
  'Poison Gas': POISON_GAS_REG_019_SCENARIOS,
  'Poison Jab': POISON_JAB_REG_019_SCENARIOS,
  'Poison Powder': POISON_POWDER_REG_019_SCENARIOS,
})
