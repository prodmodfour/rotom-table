import { SYNTHESIS_V2_SEMANTIC_SCENARIOS } from './synthesisV2'
import { TACKLE_V2_SEMANTIC_SCENARIOS } from './tackleFamilyV2'
import { TAKE_DOWN_V2_SEMANTIC_SCENARIOS } from './takeDownV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const SYNTHESIS_REG_030_SCENARIOS = scenarios([
  ...SYNTHESIS_V2_SEMANTIC_SCENARIOS,
  { scenarioId: 'synthesis.v2-stale-actor', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TACKLE_REG_030_SCENARIOS = scenarios([
  ...TACKLE_V2_SEMANTIC_SCENARIOS,
  { scenarioId: 'tackle.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TAIL_WHIP_REG_030_SCENARIOS = scenarios([
  {
    scenarioId: 'tail-whip.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'tail-whip.legacy-v1-stage-cap', evidenceClasses: ['hit'] },
  { scenarioId: 'tail-whip.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'tail-whip.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TAKE_DOWN_REG_030_SCENARIOS = scenarios([
  ...TAKE_DOWN_V2_SEMANTIC_SCENARIOS,
] as const)

export const TAUNT_REG_030_SCENARIOS = scenarios([
  { scenarioId: 'taunt.legacy-v1-enrage-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'taunt.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'taunt.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'taunt.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TEARFUL_LOOK_REG_030_SCENARIOS = scenarios([
  {
    scenarioId: 'tearful-look.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'tearful-look.legacy-v1-stage-cap', evidenceClasses: ['hit'] },
  { scenarioId: 'tearful-look.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'tearful-look.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TEETER_DANCE_REG_030_SCENARIOS = scenarios([
  {
    scenarioId: 'teeter-dance.legacy-v1-burst-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'teeter-dance.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'teeter-dance.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const THUNDER_PUNCH_REG_030_SCENARIOS = scenarios([
  {
    scenarioId: 'thunder-punch.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'thunder-punch.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'thunder-punch.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'thunder-punch.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'thunder-punch.legacy-v1-ground-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-punch.legacy-v1-paralysis-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-punch.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-punch.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'thunder-punch.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const REG_030_MOVE_NAMES = Object.freeze([
  'Synthesis',
  'Tackle',
  'Tail Whip',
  'Take Down',
  'Taunt',
  'Tearful Look',
  'Teeter Dance',
  'Thunder Punch',
] as const)

export type RegisteredBatch030MoveName = (typeof REG_030_MOVE_NAMES)[number]

export const REG_030_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch030MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Synthesis: SYNTHESIS_REG_030_SCENARIOS,
  Tackle: TACKLE_REG_030_SCENARIOS,
  'Tail Whip': TAIL_WHIP_REG_030_SCENARIOS,
  'Take Down': TAKE_DOWN_REG_030_SCENARIOS,
  Taunt: TAUNT_REG_030_SCENARIOS,
  'Tearful Look': TEARFUL_LOOK_REG_030_SCENARIOS,
  'Teeter Dance': TEETER_DANCE_REG_030_SCENARIOS,
  'Thunder Punch': THUNDER_PUNCH_REG_030_SCENARIOS,
})
