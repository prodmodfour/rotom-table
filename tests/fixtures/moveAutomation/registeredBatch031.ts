import { U_TURN_V2_SEMANTIC_SCENARIOS } from './uTurnV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const THUNDER_SHOCK_REG_031_SCENARIOS = scenarios([
  {
    scenarioId: 'thunder-shock.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'thunder-shock.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'thunder-shock.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'thunder-shock.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'thunder-shock.legacy-v1-ground-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-shock.legacy-v1-paralysis-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-shock.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-shock.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'thunder-shock.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const THUNDERBOLT_REG_031_SCENARIOS = scenarios([
  {
    scenarioId: 'thunderbolt.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'thunderbolt.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'thunderbolt.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'thunderbolt.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'thunderbolt.legacy-v1-ground-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunderbolt.legacy-v1-paralysis-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunderbolt.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunderbolt.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'thunderbolt.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TICKLE_REG_031_SCENARIOS = scenarios([
  { scenarioId: 'tickle.legacy-v1-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'tickle.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'tickle.legacy-v1-stage-cap', evidenceClasses: ['hit'] },
  { scenarioId: 'tickle.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'tickle.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const TORMENT_REG_031_SCENARIOS = scenarios([
  { scenarioId: 'torment.legacy-v1-suppressed-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'torment.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'torment.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'torment.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const U_TURN_REG_031_SCENARIOS = scenarios([
  ...U_TURN_V2_SEMANTIC_SCENARIOS,
] as const)

export const VACUUM_WAVE_REG_031_SCENARIOS = scenarios([
  { scenarioId: 'vacuum-wave.legacy-v1-priority-hit', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'vacuum-wave.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'vacuum-wave.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'vacuum-wave.legacy-v1-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'vacuum-wave.legacy-v1-priority-rejected', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'vacuum-wave.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'vacuum-wave.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const VICE_GRIP_REG_031_SCENARIOS = scenarios([
  { scenarioId: 'vice-grip.legacy-v1-ordinary-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'vice-grip.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'vice-grip.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'vice-grip.legacy-v1-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'vice-grip.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'vice-grip.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const VINE_WHIP_REG_031_SCENARIOS = scenarios([
  { scenarioId: 'vine-whip.legacy-v1-ordinary-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'vine-whip.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'vine-whip.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'vine-whip.legacy-v1-sap-sipper-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'vine-whip.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'vine-whip.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const REG_031_MOVE_NAMES = Object.freeze([
  'Thunder Shock',
  'Thunderbolt',
  'Tickle',
  'Torment',
  'U-Turn',
  'Vacuum Wave',
  'Vice Grip',
  'Vine Whip',
] as const)

export type RegisteredBatch031MoveName = (typeof REG_031_MOVE_NAMES)[number]

export const REG_031_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch031MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Thunder Shock': THUNDER_SHOCK_REG_031_SCENARIOS,
  Thunderbolt: THUNDERBOLT_REG_031_SCENARIOS,
  Tickle: TICKLE_REG_031_SCENARIOS,
  Torment: TORMENT_REG_031_SCENARIOS,
  'U-Turn': U_TURN_REG_031_SCENARIOS,
  'Vacuum Wave': VACUUM_WAVE_REG_031_SCENARIOS,
  'Vice Grip': VICE_GRIP_REG_031_SCENARIOS,
  'Vine Whip': VINE_WHIP_REG_031_SCENARIOS,
})
