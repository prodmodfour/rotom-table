import { REFLECT_V2_SEMANTIC_SCENARIOS } from './reflectV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const REFLECT_REG_022_SCENARIOS = scenarios([
  ...REFLECT_V2_SEMANTIC_SCENARIOS,
] as const)

export const RETURN_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'return.legacy-v1-loyalty-zero-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'return.legacy-v1-loyalty-six-hit',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'return.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'return.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'return.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'return.legacy-v1-missing-loyalty-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'return.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'return.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ROCK_CLIMB_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'rock-climb.legacy-v1-confusion-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-confusion-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'rock-climb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ROCK_SLIDE_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'rock-slide.legacy-v1-area-mixed-thresholds',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass', 'threshold-fail'],
  },
  {
    scenarioId: 'rock-slide.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'rock-slide.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rock-slide.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'rock-slide.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ROCK_SMASH_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'rock-smash.legacy-v1-defense-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-defense-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'rock-smash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ROCK_THROW_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'rock-throw.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'rock-throw.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'rock-throw.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'rock-throw.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'rock-throw.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ROCK_TOMB_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'rock-tomb.legacy-v1-speed-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'rock-tomb.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'rock-tomb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'rock-tomb.legacy-v1-stage-cap',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'rock-tomb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'rock-tomb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ROLLING_KICK_REG_022_SCENARIOS = scenarios([
  {
    scenarioId: 'rolling-kick.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'rolling-kick.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_022_MOVE_NAMES = Object.freeze([
  'Reflect',
  'Return',
  'Rock Climb',
  'Rock Slide',
  'Rock Smash',
  'Rock Throw',
  'Rock Tomb',
  'Rolling Kick',
] as const)

export type RegisteredBatch022MoveName = (typeof REG_022_MOVE_NAMES)[number]

export const REG_022_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch022MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Reflect: REFLECT_REG_022_SCENARIOS,
  Return: RETURN_REG_022_SCENARIOS,
  'Rock Climb': ROCK_CLIMB_REG_022_SCENARIOS,
  'Rock Slide': ROCK_SLIDE_REG_022_SCENARIOS,
  'Rock Smash': ROCK_SMASH_REG_022_SCENARIOS,
  'Rock Throw': ROCK_THROW_REG_022_SCENARIOS,
  'Rock Tomb': ROCK_TOMB_REG_022_SCENARIOS,
  'Rolling Kick': ROLLING_KICK_REG_022_SCENARIOS,
})
