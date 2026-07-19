import { POWER_TRIP_V2_SEMANTIC_SCENARIOS } from './powerTripV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const POISON_STING_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'poison-sting.legacy-v1-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'poison-sting.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POISON_TAIL_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'poison-tail.legacy-v1-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['alternate-branch', 'crit'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'poison-tail.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POUND_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'pound.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'pound.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'pound.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'pound.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'pound.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'pound.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POWDER_SNOW_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'powder-snow.legacy-v1-line-mixed-freeze-threshold',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'powder-snow.legacy-v1-freeze-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'powder-snow.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'powder-snow.legacy-v1-freeze-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'powder-snow.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'powder-snow.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'powder-snow.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POWER_GEM_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'power-gem.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'power-gem.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'power-gem.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'power-gem.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'power-gem.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POWER_TRIP_REG_020_SCENARIOS = scenarios([
  ...POWER_TRIP_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'power-trip.v2-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'power-trip.v2-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'power-trip.v2-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'power-trip.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const POWER_WHIP_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'power-whip.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'power-whip.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'power-whip.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'power-whip.legacy-v1-sap-sipper-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'power-whip.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'power-whip.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PRECIPICE_BLADES_REG_020_SCENARIOS = scenarios([
  {
    scenarioId: 'precipice-blades.legacy-v1-area-smite-mixed',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'precipice-blades.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'precipice-blades.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'precipice-blades.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_020_MOVE_NAMES = Object.freeze([
  'Poison Sting',
  'Poison Tail',
  'Pound',
  'Powder Snow',
  'Power Gem',
  'Power Trip',
  'Power Whip',
  'Precipice Blades',
] as const)

export type RegisteredBatch020MoveName = (typeof REG_020_MOVE_NAMES)[number]

export const REG_020_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch020MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Poison Sting': POISON_STING_REG_020_SCENARIOS,
  'Poison Tail': POISON_TAIL_REG_020_SCENARIOS,
  Pound: POUND_REG_020_SCENARIOS,
  'Powder Snow': POWDER_SNOW_REG_020_SCENARIOS,
  'Power Gem': POWER_GEM_REG_020_SCENARIOS,
  'Power Trip': POWER_TRIP_REG_020_SCENARIOS,
  'Power Whip': POWER_WHIP_REG_020_SCENARIOS,
  'Precipice Blades': PRECIPICE_BLADES_REG_020_SCENARIOS,
})
