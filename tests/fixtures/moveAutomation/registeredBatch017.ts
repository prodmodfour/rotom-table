export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const MOONBLAST_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'moonblast.legacy-v1-stage-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-stage-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'moonblast.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MOUNTAIN_GALE_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'mountain-gale.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'mountain-gale.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'mountain-gale.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mountain-gale.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mountain-gale.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mountain-gale.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mountain-gale.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MUD_BOMB_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'mud-bomb.legacy-v1-accuracy-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-accuracy-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-keen-eye-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mud-bomb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MUD_SHOT_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'mud-shot.legacy-v1-speed-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mud-shot.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mud-shot.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mud-shot.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mud-shot.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mud-shot.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MUD_SPORT_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'mud-sport.legacy-v1-burst-user-and-target-coats',
    evidenceClasses: ['area-mixed-outcomes', 'self'],
  },
  {
    scenarioId: 'mud-sport.legacy-v1-electric-hit-resistance-and-consumption',
    evidenceClasses: ['lifecycle-trigger', 'lifecycle-cleanup', 'threshold-pass'],
  },
  {
    scenarioId: 'mud-sport.legacy-v1-electric-immune-hit-consumption',
    evidenceClasses: ['immunity', 'lifecycle-cleanup', 'threshold-pass'],
  },
  {
    scenarioId: 'mud-sport.legacy-v1-electric-smite-miss-retains-coat',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'mud-sport.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mud-sport.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MUD_SLAP_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'mud-slap.legacy-v1-accuracy-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mud-slap.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mud-slap.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mud-slap.legacy-v1-keen-eye-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mud-slap.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mud-slap.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mud-slap.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MYSTICAL_FIRE_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'mystical-fire.legacy-v1-special-attack-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mystical-fire.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'mystical-fire.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'mystical-fire.legacy-v1-flash-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'mystical-fire.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'mystical-fire.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'mystical-fire.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const NEEDLE_ARM_REG_017_SCENARIOS = scenarios([
  {
    scenarioId: 'needle-arm.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'needle-arm.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_017_MOVE_NAMES = Object.freeze([
  'Moonblast',
  'Mountain Gale',
  'Mud Bomb',
  'Mud Shot',
  'Mud Sport',
  'Mud-Slap',
  'Mystical Fire',
  'Needle Arm',
] as const)

export type RegisteredBatch017MoveName = (typeof REG_017_MOVE_NAMES)[number]

export const REG_017_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch017MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Moonblast: MOONBLAST_REG_017_SCENARIOS,
  'Mountain Gale': MOUNTAIN_GALE_REG_017_SCENARIOS,
  'Mud Bomb': MUD_BOMB_REG_017_SCENARIOS,
  'Mud Shot': MUD_SHOT_REG_017_SCENARIOS,
  'Mud Sport': MUD_SPORT_REG_017_SCENARIOS,
  'Mud-Slap': MUD_SLAP_REG_017_SCENARIOS,
  'Mystical Fire': MYSTICAL_FIRE_REG_017_SCENARIOS,
  'Needle Arm': NEEDLE_ARM_REG_017_SCENARIOS,
})
