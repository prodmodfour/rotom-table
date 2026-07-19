export interface SecondaryConditions203ScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Value extends readonly SecondaryConditions203ScenarioEvidence[]>(
  value: Value,
): Value => Object.freeze(value)

export const CHATTER_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'chatter.v2-confusion-threshold-pass', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'chatter.v2-confusion-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'chatter.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'chatter.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'chatter.v2-soundproof-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'chatter.v2-own-tempo-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'chatter.v2-drown-out-cancel', evidenceClasses: ['alternate-branch', 'choice', 'reconnect'] },
  { scenarioId: 'chatter.v2-drown-out-pass', evidenceClasses: ['pass'] },
  { scenarioId: 'chatter.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'chatter.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const DYNAMIC_PUNCH_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'dynamic-punch.v2-confusion-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'dynamic-punch.v2-flanked-evasion-ignored', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'dynamic-punch.v2-unflanked-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'dynamic-punch.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'dynamic-punch.v2-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'dynamic-punch.v2-own-tempo-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'dynamic-punch.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'dynamic-punch.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const FIERY_WRATH_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'fiery-wrath.v2-dark-flinch-threshold-pass', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'fiery-wrath.v2-flinch-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'fiery-wrath.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'fiery-wrath.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'fiery-wrath.v2-fire-type-scene-branch', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'fiery-wrath.v2-inner-focus-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'fiery-wrath.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'fiery-wrath.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const FIRE_FANG_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'fire-fang.v2-burn-coin-branch', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'fire-fang.v2-flinch-coin-branch', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'fire-fang.v2-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'fire-fang.v2-natural-twenty-both', evidenceClasses: ['crit'] },
  { scenarioId: 'fire-fang.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'fire-fang.v2-fire-type-burn-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'fire-fang.v2-inner-focus-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'fire-fang.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'fire-fang.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const FREEZE_DRY_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'freeze-dry.v2-water-weakness-override', evidenceClasses: ['alternate-branch', 'hit'] },
  { scenarioId: 'freeze-dry.v2-neutral-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'freeze-dry.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'freeze-dry.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'freeze-dry.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'freeze-dry.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const FREEZING_GLARE_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'freezing-glare.v2-psychic-freeze-threshold-pass', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'freezing-glare.v2-freeze-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'freezing-glare.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'freezing-glare.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'freezing-glare.v2-ice-type-scene-branch', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'freezing-glare.v2-dark-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'freezing-glare.v2-ice-type-freeze-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'freezing-glare.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'freezing-glare.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const ICE_FANG_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'ice-fang.v2-freeze-coin-branch', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'ice-fang.v2-flinch-coin-branch', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'ice-fang.v2-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'ice-fang.v2-natural-twenty-both', evidenceClasses: ['crit'] },
  { scenarioId: 'ice-fang.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'ice-fang.v2-ice-type-freeze-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'ice-fang.v2-inner-focus-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'ice-fang.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'ice-fang.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const SHELL_SIDE_ARM_MA_203_SCENARIOS = scenarios([
  { scenarioId: 'shell-side-arm.v2-special-class-higher-offense', evidenceClasses: ['hit'] },
  { scenarioId: 'shell-side-arm.v2-physical-class-lower-defense', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'shell-side-arm.v2-defense-tie-stays-special', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'shell-side-arm.v2-poison-threshold-pass', evidenceClasses: ['threshold-pass'] },
  { scenarioId: 'shell-side-arm.v2-poison-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'shell-side-arm.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'shell-side-arm.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'shell-side-arm.v2-steel-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'shell-side-arm.v2-poison-condition-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'shell-side-arm.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'shell-side-arm.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const MA_203_MOVE_NAMES = Object.freeze([
  'Chatter',
  'Dynamic Punch',
  'Fiery Wrath',
  'Fire Fang',
  'Freeze-Dry',
  'Freezing Glare',
  'Ice Fang',
  'Shell Side Arm',
] as const)

export type SecondaryConditions203MoveName = (typeof MA_203_MOVE_NAMES)[number]

export const MA_203_SCENARIOS_BY_MOVE: Readonly<Record<
  SecondaryConditions203MoveName,
  readonly SecondaryConditions203ScenarioEvidence[]
>> = Object.freeze({
  Chatter: CHATTER_MA_203_SCENARIOS,
  'Dynamic Punch': DYNAMIC_PUNCH_MA_203_SCENARIOS,
  'Fiery Wrath': FIERY_WRATH_MA_203_SCENARIOS,
  'Fire Fang': FIRE_FANG_MA_203_SCENARIOS,
  'Freeze-Dry': FREEZE_DRY_MA_203_SCENARIOS,
  'Freezing Glare': FREEZING_GLARE_MA_203_SCENARIOS,
  'Ice Fang': ICE_FANG_MA_203_SCENARIOS,
  'Shell Side Arm': SHELL_SIDE_ARM_MA_203_SCENARIOS,
})
