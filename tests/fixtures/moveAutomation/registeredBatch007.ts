import {
  DRAGON_RAGE_V2_SEMANTIC_SCENARIOS,
} from './dragonRageV2'
import {
  DOUBLE_KICK_V2_SEMANTIC_SCENARIOS,
} from './strikeCanariesV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const DIZZY_PUNCH_REG_007_SCENARIOS = scenarios([
  {
    scenarioId: 'dizzy-punch.legacy-v1-confusion-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-confusion-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dizzy-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DOUBLE_KICK_REG_007_SCENARIOS = scenarios([
  ...DOUBLE_KICK_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'double-kick.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRAGON_BREATH_REG_007_SCENARIOS = scenarios([
  {
    scenarioId: 'dragon-breath.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-dragon-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dragon-breath.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRAGON_CLAW_REG_007_SCENARIOS = scenarios([
  {
    scenarioId: 'dragon-claw.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'dragon-claw.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'dragon-claw.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dragon-claw.legacy-v1-dragon-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dragon-claw.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dragon-claw.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRAGON_HAMMER_REG_007_SCENARIOS = scenarios([
  {
    scenarioId: 'dragon-hammer.legacy-v1-melee-hit',
    evidenceClasses: ['alternate-branch', 'hit'],
  },
  {
    scenarioId: 'dragon-hammer.legacy-v1-line-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'dragon-hammer.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dragon-hammer.legacy-v1-dragon-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dragon-hammer.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dragon-hammer.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRAGON_PULSE_REG_007_SCENARIOS = scenarios([
  {
    scenarioId: 'dragon-pulse.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'dragon-pulse.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'dragon-pulse.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dragon-pulse.legacy-v1-dragon-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dragon-pulse.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dragon-pulse.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRAGON_RAGE_REG_007_SCENARIOS = scenarios([
  ...DRAGON_RAGE_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'dragon-rage.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DRILL_PECK_REG_007_SCENARIOS = scenarios([
  {
    scenarioId: 'drill-peck.legacy-v1-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'drill-peck.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'drill-peck.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'drill-peck.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'drill-peck.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'drill-peck.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_007_MOVE_NAMES = Object.freeze([
  'Dizzy Punch',
  'Double Kick',
  'Dragon Breath',
  'Dragon Claw',
  'Dragon Hammer',
  'Dragon Pulse',
  'Dragon Rage',
  'Drill Peck',
] as const)

export type RegisteredBatch007MoveName = (typeof REG_007_MOVE_NAMES)[number]

export const REG_007_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch007MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Dizzy Punch': DIZZY_PUNCH_REG_007_SCENARIOS,
  'Double Kick': DOUBLE_KICK_REG_007_SCENARIOS,
  'Dragon Breath': DRAGON_BREATH_REG_007_SCENARIOS,
  'Dragon Claw': DRAGON_CLAW_REG_007_SCENARIOS,
  'Dragon Hammer': DRAGON_HAMMER_REG_007_SCENARIOS,
  'Dragon Pulse': DRAGON_PULSE_REG_007_SCENARIOS,
  'Dragon Rage': DRAGON_RAGE_REG_007_SCENARIOS,
  'Drill Peck': DRILL_PECK_REG_007_SCENARIOS,
})
