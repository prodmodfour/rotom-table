import { YAWN_V2_SEMANTIC_SCENARIOS } from './yawnV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const WATER_GUN_REG_032_SCENARIOS = scenarios([
  { scenarioId: 'water-gun.legacy-v1-ordinary-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'water-gun.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'water-gun.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'water-gun.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'water-gun.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const WATER_PULSE_REG_032_SCENARIOS = scenarios([
  {
    scenarioId: 'water-pulse.legacy-v1-confusion-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'water-pulse.legacy-v1-confusion-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'water-pulse.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'water-pulse.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'water-pulse.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'water-pulse.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'water-pulse.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const WATERFALL_REG_032_SCENARIOS = scenarios([
  {
    scenarioId: 'waterfall.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'waterfall.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'waterfall.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'waterfall.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'waterfall.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'waterfall.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'waterfall.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const WILDBOLT_STORM_REG_032_SCENARIOS = scenarios([
  {
    scenarioId: 'wildbolt-storm.legacy-v1-area-mixed-thresholds',
    evidenceClasses: [
      'alternate-branch',
      'area-mixed-outcomes',
      'hit',
      'miss',
      'threshold-pass',
      'threshold-fail',
    ],
  },
  { scenarioId: 'wildbolt-storm.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'wildbolt-storm.legacy-v1-ground-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'wildbolt-storm.legacy-v1-paralysis-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'wildbolt-storm.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'wildbolt-storm.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'wildbolt-storm.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const WILL_O_WISP_REG_032_SCENARIOS = scenarios([
  { scenarioId: 'will-o-wisp.legacy-v1-burn-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'will-o-wisp.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'will-o-wisp.legacy-v1-fire-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'will-o-wisp.legacy-v1-water-veil-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'will-o-wisp.legacy-v1-flash-fire-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'will-o-wisp.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'will-o-wisp.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const WING_ATTACK_REG_032_SCENARIOS = scenarios([
  { scenarioId: 'wing-attack.legacy-v1-ordinary-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'wing-attack.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'wing-attack.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'wing-attack.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'wing-attack.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const X_SCISSOR_REG_032_SCENARIOS = scenarios([
  {
    scenarioId: 'x-scissor.legacy-v1-dash-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  { scenarioId: 'x-scissor.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'x-scissor.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'x-scissor.legacy-v1-stuck-dash-rejected', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'x-scissor.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'x-scissor.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const YAWN_REG_032_SCENARIOS = scenarios([
  ...YAWN_V2_SEMANTIC_SCENARIOS,
  { scenarioId: 'yawn.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const REG_032_MOVE_NAMES = Object.freeze([
  'Water Gun',
  'Water Pulse',
  'Waterfall',
  'Wildbolt Storm',
  'Will-O-Wisp',
  'Wing Attack',
  'X-Scissor',
  'Yawn',
] as const)

export type RegisteredBatch032MoveName = (typeof REG_032_MOVE_NAMES)[number]

export const REG_032_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch032MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Water Gun': WATER_GUN_REG_032_SCENARIOS,
  'Water Pulse': WATER_PULSE_REG_032_SCENARIOS,
  Waterfall: WATERFALL_REG_032_SCENARIOS,
  'Wildbolt Storm': WILDBOLT_STORM_REG_032_SCENARIOS,
  'Will-O-Wisp': WILL_O_WISP_REG_032_SCENARIOS,
  'Wing Attack': WING_ATTACK_REG_032_SCENARIOS,
  'X-Scissor': X_SCISSOR_REG_032_SCENARIOS,
  Yawn: YAWN_REG_032_SCENARIOS,
})
