export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const FEINT_ATTACK_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'feint-attack.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'feint-attack.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'feint-attack.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FIRE_BLAST_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'fire-blast.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'fire-blast.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FIRE_LASH_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'fire-lash.legacy-v1-defense-drop',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'fire-lash.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'fire-lash.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'fire-lash.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-lash.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'fire-lash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'fire-lash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FIRE_PUNCH_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'fire-punch.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'fire-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FLAME_WHEEL_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'flame-wheel.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'flame-wheel.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FLAMETHROWER_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'flamethrower.legacy-v1-burn-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-burn-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-fire-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-burn-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'flamethrower.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FLASH_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'flash.legacy-v1-cone-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'flash.legacy-v1-keen-eye-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flash.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'flash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'flash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FLASH_CANNON_REG_010_SCENARIOS = scenarios([
  {
    scenarioId: 'flash-cannon.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-stage-cap',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'flash-cannon.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_010_MOVE_NAMES = Object.freeze([
  'Feint Attack',
  'Fire Blast',
  'Fire Lash',
  'Fire Punch',
  'Flame Wheel',
  'Flamethrower',
  'Flash',
  'Flash Cannon',
] as const)

export type RegisteredBatch010MoveName = (typeof REG_010_MOVE_NAMES)[number]

export const REG_010_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch010MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Feint Attack': FEINT_ATTACK_REG_010_SCENARIOS,
  'Fire Blast': FIRE_BLAST_REG_010_SCENARIOS,
  'Fire Lash': FIRE_LASH_REG_010_SCENARIOS,
  'Fire Punch': FIRE_PUNCH_REG_010_SCENARIOS,
  'Flame Wheel': FLAME_WHEEL_REG_010_SCENARIOS,
  Flamethrower: FLAMETHROWER_REG_010_SCENARIOS,
  Flash: FLASH_REG_010_SCENARIOS,
  'Flash Cannon': FLASH_CANNON_REG_010_SCENARIOS,
})
