export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const LAVA_PLUME_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'lava-plume.legacy-v1-area-mixed-burn-threshold-pass',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-fire-condition-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-flash-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'lava-plume.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LEAF_BLADE_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'leaf-blade.legacy-v1-pass-mixed-outcomes',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'leaf-blade.legacy-v1-pass-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'leaf-blade.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'leaf-blade.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'leaf-blade.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'leaf-blade.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LEAFAGE_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'leafage.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'leafage.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'leafage.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'leafage.legacy-v1-grass-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'leafage.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'leafage.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LEER_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'leer.legacy-v1-friendly-area-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'leer.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'leer.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'leer.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LICK_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'lick.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'lick.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'lick.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'lick.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'lick.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lick.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lick.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lick.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'lick.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LIQUIDATION_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'liquidation.legacy-v1-defense-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-defense-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'liquidation.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LOVELY_KISS_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'lovely-kiss.legacy-v1-sleep-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'lovely-kiss.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'lovely-kiss.legacy-v1-sweet-veil-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'lovely-kiss.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'lovely-kiss.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const LOW_SWEEP_REG_015_SCENARIOS = scenarios([
  {
    scenarioId: 'low-sweep.legacy-v1-speed-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'low-sweep.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'low-sweep.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'low-sweep.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'low-sweep.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'low-sweep.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'low-sweep.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_015_MOVE_NAMES = Object.freeze([
  'Lava Plume',
  'Leaf Blade',
  'Leafage',
  'Leer',
  'Lick',
  'Liquidation',
  'Lovely Kiss',
  'Low Sweep',
] as const)

export type RegisteredBatch015MoveName = (typeof REG_015_MOVE_NAMES)[number]

export const REG_015_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch015MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Lava Plume': LAVA_PLUME_REG_015_SCENARIOS,
  'Leaf Blade': LEAF_BLADE_REG_015_SCENARIOS,
  Leafage: LEAFAGE_REG_015_SCENARIOS,
  Leer: LEER_REG_015_SCENARIOS,
  Lick: LICK_REG_015_SCENARIOS,
  Liquidation: LIQUIDATION_REG_015_SCENARIOS,
  'Lovely Kiss': LOVELY_KISS_REG_015_SCENARIOS,
  'Low Sweep': LOW_SWEEP_REG_015_SCENARIOS,
})
