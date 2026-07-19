export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const GRASS_WHISTLE_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'grass-whistle.legacy-v1-sleep-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'grass-whistle.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'grass-whistle.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'grass-whistle.legacy-v1-sweet-veil-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'grass-whistle.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'grass-whistle.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const GRAV_APPLE_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'grav-apple.legacy-v1-defense-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'grav-apple.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'grav-apple.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'grav-apple.legacy-v1-sap-sipper-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'grav-apple.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'grav-apple.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'grav-apple.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const GROWL_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'growl.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'growl.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'growl.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'growl.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'growl.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const GUNK_SHOT_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'gunk-shot.legacy-v1-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'gunk-shot.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HEADBUTT_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'headbutt.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'headbutt.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HEAL_BELL_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'heal-bell.legacy-v1-persistent-area-cure',
    evidenceClasses: ['area-mixed-outcomes'],
  },
  {
    scenarioId: 'heal-bell.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'heal-bell.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'heal-bell.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HEART_STAMP_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'heart-stamp.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-dark-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'heart-stamp.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HEAT_WAVE_REG_012_SCENARIOS = scenarios([
  {
    scenarioId: 'heat-wave.legacy-v1-area-smite-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-flash-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'heat-wave.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_012_MOVE_NAMES = Object.freeze([
  'Grass Whistle',
  'Grav Apple',
  'Growl',
  'Gunk Shot',
  'Headbutt',
  'Heal Bell',
  'Heart Stamp',
  'Heat Wave',
] as const)

export type RegisteredBatch012MoveName = (typeof REG_012_MOVE_NAMES)[number]

export const REG_012_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch012MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Grass Whistle': GRASS_WHISTLE_REG_012_SCENARIOS,
  'Grav Apple': GRAV_APPLE_REG_012_SCENARIOS,
  Growl: GROWL_REG_012_SCENARIOS,
  'Gunk Shot': GUNK_SHOT_REG_012_SCENARIOS,
  Headbutt: HEADBUTT_REG_012_SCENARIOS,
  'Heal Bell': HEAL_BELL_REG_012_SCENARIOS,
  'Heart Stamp': HEART_STAMP_REG_012_SCENARIOS,
  'Heat Wave': HEAT_WAVE_REG_012_SCENARIOS,
})
