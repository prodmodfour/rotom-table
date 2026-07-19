export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const SLUDGE_WAVE_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'sludge-wave.legacy-v1-burst-mixed-thresholds',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass', 'threshold-fail'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-close-blast-alternate',
    evidenceClasses: ['alternate-branch', 'hit'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sludge-wave.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SMART_STRIKE_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'smart-strike.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'smart-strike.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'smart-strike.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SMOG_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'smog.legacy-v1-line-mixed-even-odd',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'threshold-pass', 'threshold-fail'],
  },
  {
    scenarioId: 'smog.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'smog.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'smog.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'smog.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'smog.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'smog.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'smog.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SNARL_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'snarl.legacy-v1-cone-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'snarl.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'snarl.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'snarl.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'snarl.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'snarl.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SPARK_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'spark.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'spark.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'spark.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'spark.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'spark.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'spark.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'spark.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'spark.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'spark.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'spark.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SPIRIT_BREAK_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'spirit-break.legacy-v1-special-attack-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'spirit-break.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'spirit-break.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'spirit-break.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'spirit-break.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'spirit-break.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SPORE_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'spore.legacy-v1-automatic-sleep',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'spore.legacy-v1-powder-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'spore.legacy-v1-sweet-veil-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'spore.legacy-v1-electric-terrain-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'spore.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'spore.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STEAM_ERUPTION_REG_026_SCENARIOS = scenarios([
  {
    scenarioId: 'steam-eruption.legacy-v1-area-smite-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss', 'threshold-pass', 'threshold-fail'],
  },
  {
    scenarioId: 'steam-eruption.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'steam-eruption.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'steam-eruption.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'steam-eruption.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'steam-eruption.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_026_MOVE_NAMES = Object.freeze([
  'Sludge Wave',
  'Smart Strike',
  'Smog',
  'Snarl',
  'Spark',
  'Spirit Break',
  'Spore',
  'Steam Eruption',
] as const)

export type RegisteredBatch026MoveName = (typeof REG_026_MOVE_NAMES)[number]

export const REG_026_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch026MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Sludge Wave': SLUDGE_WAVE_REG_026_SCENARIOS,
  'Smart Strike': SMART_STRIKE_REG_026_SCENARIOS,
  Smog: SMOG_REG_026_SCENARIOS,
  Snarl: SNARL_REG_026_SCENARIOS,
  Spark: SPARK_REG_026_SCENARIOS,
  'Spirit Break': SPIRIT_BREAK_REG_026_SCENARIOS,
  Spore: SPORE_REG_026_SCENARIOS,
  'Steam Eruption': STEAM_ERUPTION_REG_026_SCENARIOS,
})
