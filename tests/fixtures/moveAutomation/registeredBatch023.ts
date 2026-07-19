import { SAND_ATTACK_V2_IMMEDIATE_SCENARIOS } from './sandAttackV2'
import { SAND_TOMB_V2_SEMANTIC_SCENARIOS } from './sandTombV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const SACRED_FIRE_REG_023_SCENARIOS = scenarios([
  {
    scenarioId: 'sacred-fire.legacy-v1-even-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-odd-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sacred-fire.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SACRED_SWORD_REG_023_SCENARIOS = scenarios([
  {
    scenarioId: 'sacred-sword.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'sacred-sword.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sacred-sword.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sacred-sword.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SAND_ATTACK_REG_023_SCENARIOS = scenarios([
  ...SAND_ATTACK_V2_IMMEDIATE_SCENARIOS,
  {
    scenarioId: 'sand-attack.v2-target-turn-expiry',
    evidenceClasses: ['lifecycle-cleanup'],
  },
  {
    scenarioId: 'sand-attack.v2-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sand-attack.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SAND_TOMB_REG_023_SCENARIOS = scenarios([
  ...SAND_TOMB_V2_SEMANTIC_SCENARIOS,
] as const)

export const SANDSTORM_SEAR_REG_023_SCENARIOS = scenarios([
  {
    scenarioId: 'sandstorm-sear.legacy-v1-area-mixed-thresholds',
    evidenceClasses: [
      'alternate-branch',
      'area-mixed-outcomes',
      'hit',
      'miss',
      'threshold-pass',
      'threshold-fail',
    ],
  },
  {
    scenarioId: 'sandstorm-sear.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'sandstorm-sear.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sandstorm-sear.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sandstorm-sear.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sandstorm-sear.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SCALD_REG_023_SCENARIOS = scenarios([
  {
    scenarioId: 'scald.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'scald.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'scald.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'scald.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'scald.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'scald.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'scald.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'scald.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SCARY_FACE_REG_023_SCENARIOS = scenarios([
  {
    scenarioId: 'scary-face.legacy-v1-speed-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'scary-face.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'scary-face.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'scary-face.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'scary-face.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SCORCHING_SANDS_REG_023_SCENARIOS = scenarios([
  {
    scenarioId: 'scorching-sands.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'scorching-sands.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_023_MOVE_NAMES = Object.freeze([
  'Sacred Fire',
  'Sacred Sword',
  'Sand Attack',
  'Sand Tomb',
  'Sandstorm Sear',
  'Scald',
  'Scary Face',
  'Scorching Sands',
] as const)

export type RegisteredBatch023MoveName = (typeof REG_023_MOVE_NAMES)[number]

export const REG_023_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch023MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Sacred Fire': SACRED_FIRE_REG_023_SCENARIOS,
  'Sacred Sword': SACRED_SWORD_REG_023_SCENARIOS,
  'Sand Attack': SAND_ATTACK_REG_023_SCENARIOS,
  'Sand Tomb': SAND_TOMB_REG_023_SCENARIOS,
  'Sandstorm Sear': SANDSTORM_SEAR_REG_023_SCENARIOS,
  Scald: SCALD_REG_023_SCENARIOS,
  'Scary Face': SCARY_FACE_REG_023_SCENARIOS,
  'Scorching Sands': SCORCHING_SANDS_REG_023_SCENARIOS,
})
