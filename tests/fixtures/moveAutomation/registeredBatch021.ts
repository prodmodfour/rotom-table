export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const PSYBEAM_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'psybeam.legacy-v1-confusion-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-confusion-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-psychic-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'psybeam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PSYCHO_CUT_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'psycho-cut.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'psycho-cut.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'psycho-cut.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'psycho-cut.legacy-v1-psychic-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'psycho-cut.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'psycho-cut.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PSYWAVE_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'psywave.legacy-v1-half-level',
    evidenceClasses: ['alternate-branch', 'hit'],
  },
  {
    scenarioId: 'psywave.legacy-v1-user-level',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'psywave.legacy-v1-one-and-a-half-level',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'psywave.legacy-v1-double-level-no-critical',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'psywave.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'psywave.legacy-v1-psychic-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'psywave.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'psywave.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PYRO_BALL_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'pyro-ball.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'pyro-ball.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const QUICK_ATTACK_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'quick-attack.legacy-v1-priority-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'quick-attack.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'quick-attack.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'quick-attack.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'quick-attack.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'quick-attack.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'quick-attack.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const RAGING_FURY_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'raging-fury.legacy-v1-area-mixed-threshold',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'self', 'threshold-pass'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-threshold-fail',
    evidenceClasses: ['self', 'threshold-fail'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-spirit-surge-miss',
    evidenceClasses: ['alternate-branch', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-no-target-self-effect',
    evidenceClasses: ['alternate-branch', 'self'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'raging-fury.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const RAZOR_LEAF_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'razor-leaf.legacy-v1-cone-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'razor-leaf.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'razor-leaf.legacy-v1-sap-sipper-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'razor-leaf.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'razor-leaf.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const RAZOR_SHELL_REG_021_SCENARIOS = scenarios([
  {
    scenarioId: 'razor-shell.legacy-v1-even-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-odd-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'razor-shell.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_021_MOVE_NAMES = Object.freeze([
  'Psybeam',
  'Psycho Cut',
  'Psywave',
  'Pyro Ball',
  'Quick Attack',
  'Raging Fury',
  'Razor Leaf',
  'Razor Shell',
] as const)

export type RegisteredBatch021MoveName = (typeof REG_021_MOVE_NAMES)[number]

export const REG_021_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch021MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Psybeam: PSYBEAM_REG_021_SCENARIOS,
  'Psycho Cut': PSYCHO_CUT_REG_021_SCENARIOS,
  Psywave: PSYWAVE_REG_021_SCENARIOS,
  'Pyro Ball': PYRO_BALL_REG_021_SCENARIOS,
  'Quick Attack': QUICK_ATTACK_REG_021_SCENARIOS,
  'Raging Fury': RAGING_FURY_REG_021_SCENARIOS,
  'Razor Leaf': RAZOR_LEAF_REG_021_SCENARIOS,
  'Razor Shell': RAZOR_SHELL_REG_021_SCENARIOS,
})
