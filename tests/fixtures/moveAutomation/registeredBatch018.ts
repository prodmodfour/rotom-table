export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const NIGHT_DAZE_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'night-daze.legacy-v1-accuracy-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-accuracy-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-keen-eye-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'night-daze.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const NIGHT_SLASH_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'night-slash.legacy-v1-pass-mixed-outcomes',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'night-slash.legacy-v1-pass-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'night-slash.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'night-slash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'night-slash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const NOBLE_ROAR_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'noble-roar.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'noble-roar.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'noble-roar.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'noble-roar.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'noble-roar.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const NUZZLE_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'nuzzle.legacy-v1-paralysis-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'nuzzle.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'nuzzle.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'nuzzle.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'nuzzle.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'nuzzle.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'nuzzle.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const OCTAZOOKA_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'octazooka.legacy-v1-even-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-odd-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-keen-eye-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'octazooka.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ORIGIN_PULSE_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'origin-pulse.legacy-v1-area-smite-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'origin-pulse.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'origin-pulse.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'origin-pulse.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const OVERDRIVE_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'overdrive.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'overdrive.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'overdrive.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'overdrive.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'overdrive.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'overdrive.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PECK_REG_018_SCENARIOS = scenarios([
  {
    scenarioId: 'peck.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'peck.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'peck.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'peck.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'peck.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_018_MOVE_NAMES = Object.freeze([
  'Night Daze',
  'Night Slash',
  'Noble Roar',
  'Nuzzle',
  'Octazooka',
  'Origin Pulse',
  'Overdrive',
  'Peck',
] as const)

export type RegisteredBatch018MoveName = (typeof REG_018_MOVE_NAMES)[number]

export const REG_018_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch018MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Night Daze': NIGHT_DAZE_REG_018_SCENARIOS,
  'Night Slash': NIGHT_SLASH_REG_018_SCENARIOS,
  'Noble Roar': NOBLE_ROAR_REG_018_SCENARIOS,
  Nuzzle: NUZZLE_REG_018_SCENARIOS,
  Octazooka: OCTAZOOKA_REG_018_SCENARIOS,
  'Origin Pulse': ORIGIN_PULSE_REG_018_SCENARIOS,
  Overdrive: OVERDRIVE_REG_018_SCENARIOS,
  Peck: PECK_REG_018_SCENARIOS,
})
