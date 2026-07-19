import { SCRATCH_V2_PASS_HIT_SCENARIO } from './scratchV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const SCRATCH_REG_024_SCENARIOS = scenarios([
  {
    ...SCRATCH_V2_PASS_HIT_SCENARIO,
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'scratch.v2-pass-mixed-outcomes',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'scratch.v2-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'scratch.v2-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'scratch.v2-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'scratch.v2-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'scratch.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SCREECH_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'screech.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'screech.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'screech.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'screech.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'screech.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SEARING_SHOT_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'searing-shot.legacy-v1-area-mixed-thresholds',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass', 'threshold-fail'],
  },
  {
    scenarioId: 'searing-shot.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'searing-shot.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'searing-shot.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'searing-shot.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'searing-shot.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'searing-shot.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SEED_BOMB_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'seed-bomb.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'seed-bomb.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'seed-bomb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'seed-bomb.legacy-v1-sap-sipper-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'seed-bomb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'seed-bomb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SEED_FLARE_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'seed-flare.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'seed-flare.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'seed-flare.legacy-v1-sap-sipper-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'seed-flare.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'seed-flare.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'seed-flare.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SHADOW_BALL_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'shadow-ball.legacy-v1-stage-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-stage-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'shadow-ball.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SHADOW_BONE_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'shadow-bone.legacy-v1-stage-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-stage-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'shadow-bone.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SHADOW_CLAW_REG_024_SCENARIOS = scenarios([
  {
    scenarioId: 'shadow-claw.legacy-v1-pass-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'shadow-claw.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'shadow-claw.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-claw.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'shadow-claw.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'shadow-claw.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_024_MOVE_NAMES = Object.freeze([
  'Scratch',
  'Screech',
  'Searing Shot',
  'Seed Bomb',
  'Seed Flare',
  'Shadow Ball',
  'Shadow Bone',
  'Shadow Claw',
] as const)

export type RegisteredBatch024MoveName = (typeof REG_024_MOVE_NAMES)[number]

export const REG_024_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch024MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Scratch: SCRATCH_REG_024_SCENARIOS,
  Screech: SCREECH_REG_024_SCENARIOS,
  'Searing Shot': SEARING_SHOT_REG_024_SCENARIOS,
  'Seed Bomb': SEED_BOMB_REG_024_SCENARIOS,
  'Seed Flare': SEED_FLARE_REG_024_SCENARIOS,
  'Shadow Ball': SHADOW_BALL_REG_024_SCENARIOS,
  'Shadow Bone': SHADOW_BONE_REG_024_SCENARIOS,
  'Shadow Claw': SHADOW_CLAW_REG_024_SCENARIOS,
})
