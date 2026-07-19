import { KNOCK_OFF_V2_SEMANTIC_SCENARIOS } from './knockOffV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const ICE_SHARD_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'ice-shard.legacy-v1-hit-priority',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'ice-shard.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'ice-shard.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'ice-shard.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'ice-shard.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'ice-shard.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ICICLE_CRASH_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'icicle-crash.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'icicle-crash.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'icicle-crash.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'icicle-crash.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'icicle-crash.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'icicle-crash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'icicle-crash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ICY_WIND_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'icy-wind.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'icy-wind.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'icy-wind.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'icy-wind.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'icy-wind.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const IRON_HEAD_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'iron-head.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'iron-head.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const IRON_TAIL_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'iron-tail.legacy-v1-defense-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-defense-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'iron-tail.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const KARATE_CHOP_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'karate-chop.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'karate-chop.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'karate-chop.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'karate-chop.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'karate-chop.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'karate-chop.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const KNOCK_OFF_REG_014_SCENARIOS = scenarios([
  ...KNOCK_OFF_V2_SEMANTIC_SCENARIOS,
] as const)

export const LANDS_WRATH_REG_014_SCENARIOS = scenarios([
  {
    scenarioId: 'lands-wrath.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'lands-wrath.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'lands-wrath.legacy-v1-groundsource-immunity',
    evidenceClasses: ['immunity', 'threshold-fail'],
  },
  {
    scenarioId: 'lands-wrath.legacy-v1-grounded-suppression',
    evidenceClasses: ['alternate-branch', 'hit', 'threshold-pass'],
  },
  {
    scenarioId: 'lands-wrath.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'lands-wrath.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_014_MOVE_NAMES = Object.freeze([
  'Ice Shard',
  'Icicle Crash',
  'Icy Wind',
  'Iron Head',
  'Iron Tail',
  'Karate Chop',
  'Knock Off',
  'Land’s Wrath',
] as const)

export type RegisteredBatch014MoveName = (typeof REG_014_MOVE_NAMES)[number]

export const REG_014_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch014MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Ice Shard': ICE_SHARD_REG_014_SCENARIOS,
  'Icicle Crash': ICICLE_CRASH_REG_014_SCENARIOS,
  'Icy Wind': ICY_WIND_REG_014_SCENARIOS,
  'Iron Head': IRON_HEAD_REG_014_SCENARIOS,
  'Iron Tail': IRON_TAIL_REG_014_SCENARIOS,
  'Karate Chop': KARATE_CHOP_REG_014_SCENARIOS,
  'Knock Off': KNOCK_OFF_REG_014_SCENARIOS,
  'Land’s Wrath': LANDS_WRATH_REG_014_SCENARIOS,
})
