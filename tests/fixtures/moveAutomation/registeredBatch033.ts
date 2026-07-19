export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const ZEN_HEADBUTT_REG_033_SCENARIOS = scenarios([
  {
    scenarioId: 'zen-headbutt.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'zen-headbutt.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'zen-headbutt.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'zen-headbutt.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'zen-headbutt.legacy-v1-dark-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'zen-headbutt.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  {
    scenarioId: 'zen-headbutt.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'zen-headbutt.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'zen-headbutt.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ZING_ZAP_REG_033_SCENARIOS = scenarios([
  {
    scenarioId: 'zing-zap.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'zing-zap.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'zing-zap.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'zing-zap.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'zing-zap.legacy-v1-ground-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'zing-zap.legacy-v1-secondary-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'zing-zap.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'zing-zap.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_033_MOVE_NAMES = Object.freeze([
  'Zen Headbutt',
  'Zing Zap',
] as const)

export type RegisteredBatch033MoveName = (typeof REG_033_MOVE_NAMES)[number]

export const REG_033_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch033MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Zen Headbutt': ZEN_HEADBUTT_REG_033_SCENARIOS,
  'Zing Zap': ZING_ZAP_REG_033_SCENARIOS,
})
