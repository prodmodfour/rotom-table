export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const BABY_DOLL_EYES_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'baby-doll-eyes.legacy-v1-priority-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'baby-doll-eyes.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'baby-doll-eyes.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'baby-doll-eyes.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'baby-doll-eyes.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'baby-doll-eyes.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BITE_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'bite.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'bite.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bite.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'bite.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bite.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bite.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bite.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BLAZE_KICK_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'blaze-kick.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-critical-only',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'blaze-kick.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BLEAKWIND_STORM_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'bleakwind-storm.legacy-v1-area-hit-and-smite-miss',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'bleakwind-storm.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bleakwind-storm.legacy-v1-frozen-threshold-pass',
    evidenceClasses: ['threshold-pass'],
  },
  {
    scenarioId: 'bleakwind-storm.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bleakwind-storm.legacy-v1-frozen-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bleakwind-storm.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bleakwind-storm.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BLUE_FLARE_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'blue-flare.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'blue-flare.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BODY_SLAM_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'body-slam.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'body-slam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BOLT_STRIKE_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'bolt-strike.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bolt-strike.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const BONE_CLUB_REG_003_SCENARIOS = scenarios([
  {
    scenarioId: 'bone-club.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'bone-club.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'bone-club.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'bone-club.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'bone-club.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'bone-club.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'bone-club.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_003_MOVE_NAMES = Object.freeze([
  'Baby-Doll Eyes',
  'Bite',
  'Blaze Kick',
  'Bleakwind Storm',
  'Blue Flare',
  'Body Slam',
  'Bolt Strike',
  'Bone Club',
] as const)

export type RegisteredBatch003MoveName = (typeof REG_003_MOVE_NAMES)[number]

export const REG_003_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch003MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Baby-Doll Eyes': BABY_DOLL_EYES_REG_003_SCENARIOS,
  Bite: BITE_REG_003_SCENARIOS,
  'Blaze Kick': BLAZE_KICK_REG_003_SCENARIOS,
  'Bleakwind Storm': BLEAKWIND_STORM_REG_003_SCENARIOS,
  'Blue Flare': BLUE_FLARE_REG_003_SCENARIOS,
  'Body Slam': BODY_SLAM_REG_003_SCENARIOS,
  'Bolt Strike': BOLT_STRIKE_REG_003_SCENARIOS,
  'Bone Club': BONE_CLUB_REG_003_SCENARIOS,
})
