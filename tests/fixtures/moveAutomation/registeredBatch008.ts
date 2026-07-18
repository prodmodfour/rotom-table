import {
  EMBER_V2_SEMANTIC_SCENARIOS,
} from './emberV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const DRILL_RUN_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'drill-run.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'drill-run.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'drill-run.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'drill-run.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'drill-run.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRUM_BEATING_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'drum-beating.legacy-v1-stage-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'drum-beating.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'drum-beating.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'drum-beating.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'drum-beating.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'drum-beating.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'drum-beating.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const EARTH_POWER_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'earth-power.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-groundsource-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-grounded-suppression',
    evidenceClasses: ['alternate-branch', 'hit', 'threshold-pass'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'earth-power.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const EERIE_IMPULSE_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'eerie-impulse.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'eerie-impulse.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'eerie-impulse.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'eerie-impulse.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'eerie-impulse.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const EGG_BOMB_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'egg-bomb.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'egg-bomb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'egg-bomb.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'egg-bomb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'egg-bomb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ELECTROWEB_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'electroweb.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'electroweb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'electroweb.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'electroweb.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'electroweb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'electroweb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const EMBER_REG_008_SCENARIOS = scenarios([
  ...EMBER_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'ember.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ENERGY_BALL_REG_008_SCENARIOS = scenarios([
  {
    scenarioId: 'energy-ball.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'energy-ball.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_008_MOVE_NAMES = Object.freeze([
  'Drill Run',
  'Drum Beating',
  'Earth Power',
  'Eerie Impulse',
  'Egg Bomb',
  'Electroweb',
  'Ember',
  'Energy Ball',
] as const)

export const REG_008_LEGACY_MOVE_NAMES = Object.freeze([
  'Drill Run',
  'Drum Beating',
  'Earth Power',
  'Eerie Impulse',
  'Egg Bomb',
  'Electroweb',
  'Energy Ball',
] as const)

export type RegisteredBatch008MoveName = (typeof REG_008_MOVE_NAMES)[number]
export type RegisteredBatch008LegacyMoveName = (typeof REG_008_LEGACY_MOVE_NAMES)[number]

export const REG_008_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch008MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Drill Run': DRILL_RUN_REG_008_SCENARIOS,
  'Drum Beating': DRUM_BEATING_REG_008_SCENARIOS,
  'Earth Power': EARTH_POWER_REG_008_SCENARIOS,
  'Eerie Impulse': EERIE_IMPULSE_REG_008_SCENARIOS,
  'Egg Bomb': EGG_BOMB_REG_008_SCENARIOS,
  Electroweb: ELECTROWEB_REG_008_SCENARIOS,
  Ember: EMBER_REG_008_SCENARIOS,
  'Energy Ball': ENERGY_BALL_REG_008_SCENARIOS,
})
