import { FAKE_OUT_V2_SEMANTIC_SCENARIOS } from './openingMovesV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const ESPER_WING_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'esper-wing.legacy-v1-pass-mixed-priority',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'esper-wing.legacy-v1-pass-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'esper-wing.legacy-v1-psychic-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'esper-wing.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'esper-wing.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'esper-wing.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'esper-wing.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const EXTRASENSORY_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'extrasensory.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-psychic-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'extrasensory.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const EXTREME_SPEED_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'extreme-speed.legacy-v1-hit-priority-dash',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'extreme-speed.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FAIRY_WIND_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'fairy-wind.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'fairy-wind.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'fairy-wind.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'fairy-wind.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'fairy-wind.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FAKE_OUT_REG_009_SCENARIOS = scenarios([
  ...FAKE_OUT_V2_SEMANTIC_SCENARIOS,
] as const)

export const FAKE_TEARS_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'fake-tears.legacy-v1-stage-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'fake-tears.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'fake-tears.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'fake-tears.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'fake-tears.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FALSE_SURRENDER_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'false-surrender.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'false-surrender.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'false-surrender.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FEATHER_DANCE_REG_009_SCENARIOS = scenarios([
  {
    scenarioId: 'feather-dance.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'feather-dance.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'feather-dance.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'feather-dance.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_009_MOVE_NAMES = Object.freeze([
  'Esper Wing',
  'Extrasensory',
  'Extreme Speed',
  'Fairy Wind',
  'Fake Out',
  'Fake Tears',
  'False Surrender',
  'Feather Dance',
] as const)

export type RegisteredBatch009MoveName = (typeof REG_009_MOVE_NAMES)[number]

export const REG_009_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch009MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Esper Wing': ESPER_WING_REG_009_SCENARIOS,
  Extrasensory: EXTRASENSORY_REG_009_SCENARIOS,
  'Extreme Speed': EXTREME_SPEED_REG_009_SCENARIOS,
  'Fairy Wind': FAIRY_WIND_REG_009_SCENARIOS,
  'Fake Out': FAKE_OUT_REG_009_SCENARIOS,
  'Fake Tears': FAKE_TEARS_REG_009_SCENARIOS,
  'False Surrender': FALSE_SURRENDER_REG_009_SCENARIOS,
  'Feather Dance': FEATHER_DANCE_REG_009_SCENARIOS,
})
