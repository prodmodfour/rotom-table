export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const CROSS_POISON_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'cross-poison.legacy-v1-pass-mixed-threshold-pass',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'cross-poison.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CRUNCH_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'crunch.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'crunch.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'crunch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'crunch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'crunch.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'crunch.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'crunch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'crunch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const CRUSH_CLAW_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'crush-claw.legacy-v1-even-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-odd-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'crush-claw.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DARK_PULSE_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'dark-pulse.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'dark-pulse.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'dark-pulse.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'dark-pulse.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dark-pulse.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'dark-pulse.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dark-pulse.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DAZZLING_GLEAM_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'dazzling-gleam.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'dazzling-gleam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'dazzling-gleam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'dazzling-gleam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DECORATE_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'decorate.legacy-v1-stage-boost',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'decorate.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'decorate.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'decorate.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DISARMING_VOICE_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'disarming-voice.legacy-v1-automatic-area-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'disarming-voice.legacy-v1-mixed-targetability',
    evidenceClasses: ['area-mixed-outcomes'],
  },
  {
    scenarioId: 'disarming-voice.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'disarming-voice.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const DISCHARGE_REG_006_SCENARIOS = scenarios([
  {
    scenarioId: 'discharge.legacy-v1-area-mixed-threshold-pass',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'discharge.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'discharge.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'discharge.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'discharge.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'discharge.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'discharge.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'discharge.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_006_MOVE_NAMES = Object.freeze([
  'Cross Poison',
  'Crunch',
  'Crush Claw',
  'Dark Pulse',
  'Dazzling Gleam',
  'Decorate',
  'Disarming Voice',
  'Discharge',
] as const)

export type RegisteredBatch006MoveName = (typeof REG_006_MOVE_NAMES)[number]

export const REG_006_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch006MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Cross Poison': CROSS_POISON_REG_006_SCENARIOS,
  Crunch: CRUNCH_REG_006_SCENARIOS,
  'Crush Claw': CRUSH_CLAW_REG_006_SCENARIOS,
  'Dark Pulse': DARK_PULSE_REG_006_SCENARIOS,
  'Dazzling Gleam': DAZZLING_GLEAM_REG_006_SCENARIOS,
  Decorate: DECORATE_REG_006_SCENARIOS,
  'Disarming Voice': DISARMING_VOICE_REG_006_SCENARIOS,
  Discharge: DISCHARGE_REG_006_SCENARIOS,
})
