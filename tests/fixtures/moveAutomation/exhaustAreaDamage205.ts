import type { ExhaustAreaDamage205MoveName } from '~~/server/domain/moveAutomation/specs/exhaustAreaDamage205'

export interface ExhaustAreaDamage205ScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Value extends readonly ExhaustAreaDamage205ScenarioEvidence[]>(
  value: Value,
): Value => Object.freeze(value)

export const BLAST_BURN_MA_205_SCENARIOS = scenarios([
  {
    scenarioId: 'blast-burn.v2-area-mixed-smite',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'blast-burn.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'blast-burn.v2-flash-fire-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'blast-burn.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'blast-burn.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ETERNABEAM_MA_205_SCENARIOS = scenarios([
  {
    scenarioId: 'eternabeam.v2-area-mixed-smite',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'eternabeam.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'eternabeam.v2-fairy-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'eternabeam.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'eternabeam.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FRENZY_PLANT_MA_205_SCENARIOS = scenarios([
  {
    scenarioId: 'frenzy-plant.v2-multi-target-mixed-smite',
    evidenceClasses: ['alternate-branch', 'hit', 'miss'],
  },
  { scenarioId: 'frenzy-plant.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'frenzy-plant.v2-sap-sipper-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'frenzy-plant.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'frenzy-plant.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HYDRO_CANNON_MA_205_SCENARIOS = scenarios([
  {
    scenarioId: 'hydro-cannon.v2-area-mixed-smite',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'hydro-cannon.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'hydro-cannon.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'hydro-cannon.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const METEOR_ASSAULT_MA_205_SCENARIOS = scenarios([
  {
    scenarioId: 'meteor-assault.v2-area-mixed-smite',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'meteor-assault.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'meteor-assault.v2-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'meteor-assault.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'meteor-assault.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const PRISMATIC_LASER_MA_205_SCENARIOS = scenarios([
  {
    scenarioId: 'prismatic-laser.v2-area-mixed-smite',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss'],
  },
  { scenarioId: 'prismatic-laser.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'prismatic-laser.v2-dark-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'prismatic-laser.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'prismatic-laser.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MA_205_SCENARIOS_BY_MOVE: Readonly<Record<
  ExhaustAreaDamage205MoveName,
  readonly ExhaustAreaDamage205ScenarioEvidence[]
>> = Object.freeze({
  'Blast Burn': BLAST_BURN_MA_205_SCENARIOS,
  Eternabeam: ETERNABEAM_MA_205_SCENARIOS,
  'Frenzy Plant': FRENZY_PLANT_MA_205_SCENARIOS,
  'Hydro Cannon': HYDRO_CANNON_MA_205_SCENARIOS,
  'Meteor Assault': METEOR_ASSAULT_MA_205_SCENARIOS,
  'Prismatic Laser': PRISMATIC_LASER_MA_205_SCENARIOS,
})
