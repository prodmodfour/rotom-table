export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const BOOMBURST_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'boomburst.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'boomburst.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'boomburst.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'boomburst.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'boomburst.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'boomburst.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BRANCH_POKE_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'branch-poke.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'branch-poke.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'branch-poke.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'branch-poke.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'branch-poke.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'branch-poke.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BREAKING_SWIPE_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'breaking-swipe.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'breaking-swipe.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'breaking-swipe.legacy-v1-dragon-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'breaking-swipe.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'breaking-swipe.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'breaking-swipe.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BRUTAL_SWING_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'brutal-swing.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'brutal-swing.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'brutal-swing.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'brutal-swing.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BUBBLE_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'bubble.legacy-v1-area-mixed-threshold-pass',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'bubble.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bubble.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bubble.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bubble.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'bubble.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bubble.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BUBBLE_BEAM_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'bubble-beam.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bubble-beam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BULLDOZE_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'bulldoze.legacy-v1-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'bulldoze.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bulldoze.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'bulldoze.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bulldoze.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BULLET_PUNCH_REG_004_SCENARIOS = scenarios([
  {
    scenarioId: 'bullet-punch.legacy-v1-priority-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'bullet-punch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'bullet-punch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bullet-punch.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bullet-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bullet-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_004_MOVE_NAMES = Object.freeze([
  'Boomburst',
  'Branch Poke',
  'Breaking Swipe',
  'Brutal Swing',
  'Bubble',
  'Bubble Beam',
  'Bulldoze',
  'Bullet Punch',
] as const)

export type RegisteredBatch004MoveName = (typeof REG_004_MOVE_NAMES)[number]

export const REG_004_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch004MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Boomburst: BOOMBURST_REG_004_SCENARIOS,
  'Branch Poke': BRANCH_POKE_REG_004_SCENARIOS,
  'Breaking Swipe': BREAKING_SWIPE_REG_004_SCENARIOS,
  'Brutal Swing': BRUTAL_SWING_REG_004_SCENARIOS,
  Bubble: BUBBLE_REG_004_SCENARIOS,
  'Bubble Beam': BUBBLE_BEAM_REG_004_SCENARIOS,
  Bulldoze: BULLDOZE_REG_004_SCENARIOS,
  'Bullet Punch': BULLET_PUNCH_REG_004_SCENARIOS,
})
