import { ABSORB_V2_SEMANTIC_SCENARIOS } from './absorbV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const ABSORB_REG_001_SCENARIOS = scenarios([
  ...ABSORB_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'absorb.v2-multi-resource-conflict',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ACCELEROCK_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'accelerock.legacy-v1-hit-priority',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'accelerock.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'accelerock.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'accelerock.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'accelerock.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'accelerock.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ACID_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'acid.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'acid.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'acid.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'acid.legacy-v1-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'acid.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'acid.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ACID_SPRAY_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'acid-spray.legacy-v1-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'acid-spray.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'acid-spray.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'acid-spray.legacy-v1-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'acid-spray.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'acid-spray.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'acid-spray.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ACUPRESSURE_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'acupressure.legacy-v1-attack-self',
    evidenceClasses: ['alternate-branch', 'hit', 'self'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-defense-target',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-special-attack-target',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-special-defense-target',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-speed-target',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-accuracy-target',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'acupressure.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AERIAL_ACE_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'aerial-ace.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'aerial-ace.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'aerial-ace.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AIR_CUTTER_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'air-cutter.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'crit', 'miss'],
  },
  {
    scenarioId: 'air-cutter.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'air-cutter.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'air-cutter.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const AIR_SLASH_REG_001_SCENARIOS = scenarios([
  {
    scenarioId: 'air-slash.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'air-slash.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'air-slash.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'air-slash.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'air-slash.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'air-slash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'air-slash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_001_MOVE_NAMES = Object.freeze([
  'Absorb',
  'Accelerock',
  'Acid',
  'Acid Spray',
  'Acupressure',
  'Aerial Ace',
  'Air Cutter',
  'Air Slash',
] as const)

export type RegisteredBatch001MoveName = (typeof REG_001_MOVE_NAMES)[number]

export const REG_001_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch001MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Absorb: ABSORB_REG_001_SCENARIOS,
  Accelerock: ACCELEROCK_REG_001_SCENARIOS,
  Acid: ACID_REG_001_SCENARIOS,
  'Acid Spray': ACID_SPRAY_REG_001_SCENARIOS,
  Acupressure: ACUPRESSURE_REG_001_SCENARIOS,
  'Aerial Ace': AERIAL_ACE_REG_001_SCENARIOS,
  'Air Cutter': AIR_CUTTER_REG_001_SCENARIOS,
  'Air Slash': AIR_SLASH_REG_001_SCENARIOS,
})
