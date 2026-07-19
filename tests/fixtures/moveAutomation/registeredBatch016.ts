export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const LUSTER_PURGE_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'luster-purge.legacy-v1-even-roll-stage-drop',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-odd-roll-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-dark-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'luster-purge.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MACH_PUNCH_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'mach-punch.legacy-v1-hit-priority',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'mach-punch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mach-punch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mach-punch.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mach-punch.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'mach-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mach-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MAGICAL_LEAF_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'magical-leaf.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'magical-leaf.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'magical-leaf.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'magical-leaf.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MAGNET_BOMB_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'magnet-bomb.legacy-v1-automatic-hit-magnetic-capability',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'magnet-bomb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'magnet-bomb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MEGA_PUNCH_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'mega-punch.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mega-punch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mega-punch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mega-punch.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mega-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mega-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const METAL_SOUND_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'metal-sound.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'metal-sound.legacy-v1-soundproof-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'metal-sound.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'metal-sound.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'metal-sound.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MIRROR_SHOT_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'mirror-shot.legacy-v1-area-mixed-threshold-pass',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-keen-eye-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mirror-shot.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MIST_BALL_REG_016_SCENARIOS = scenarios([
  {
    scenarioId: 'mist-ball.legacy-v1-even-roll-stage-drop',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-odd-roll-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-dark-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mist-ball.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_016_MOVE_NAMES = Object.freeze([
  'Luster Purge',
  'Mach Punch',
  'Magical Leaf',
  'Magnet Bomb',
  'Mega Punch',
  'Metal Sound',
  'Mirror Shot',
  'Mist Ball',
] as const)

export type RegisteredBatch016MoveName = (typeof REG_016_MOVE_NAMES)[number]

export const REG_016_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch016MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Luster Purge': LUSTER_PURGE_REG_016_SCENARIOS,
  'Mach Punch': MACH_PUNCH_REG_016_SCENARIOS,
  'Magical Leaf': MAGICAL_LEAF_REG_016_SCENARIOS,
  'Magnet Bomb': MAGNET_BOMB_REG_016_SCENARIOS,
  'Mega Punch': MEGA_PUNCH_REG_016_SCENARIOS,
  'Metal Sound': METAL_SOUND_REG_016_SCENARIOS,
  'Mirror Shot': MIRROR_SHOT_REG_016_SCENARIOS,
  'Mist Ball': MIST_BALL_REG_016_SCENARIOS,
})
