export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export interface RegisteredStruggleMechanics {
  readonly type: 'Electric' | 'Flying' | 'Ice' | 'Normal' | 'Rock'
  readonly damageClass: 'Physical' | 'Special'
  readonly capability: 'Freezer' | 'Guster' | 'Materializer' | 'Telekinetic' | 'Zapper'
  readonly range: 'Focus Rank, 1 Target' | 'Melee, 1 Target'
  readonly immuneDefenderType: 'Ghost' | 'Ground' | null
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const STRUGGLE_FREEZER_SPECIAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-freezer-special.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_GUSTER_PHYSICAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-guster-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_GUSTER_SPECIAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-guster-special.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-guster-special.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-guster-special.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-guster-special.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-guster-special.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-guster-special.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-guster-special.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_MATERIALIZER_PHYSICAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-materializer-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_MATERIALIZER_SPECIAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-materializer-special.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_TELEKINETIC_PHYSICAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-focus-range-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-telekinetic-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_TELEKINETIC_SPECIAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-focus-range-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-telekinetic-special.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_ZAPPER_PHYSICAL_REG_028_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-zapper-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_028_MOVE_NAMES = Object.freeze([
  'Struggle (Freezer Special)',
  'Struggle (Guster Physical)',
  'Struggle (Guster Special)',
  'Struggle (Materializer Physical)',
  'Struggle (Materializer Special)',
  'Struggle (Telekinetic Physical)',
  'Struggle (Telekinetic Special)',
  'Struggle (Zapper Physical)',
] as const)

export type RegisteredBatch028MoveName = (typeof REG_028_MOVE_NAMES)[number]

export const REG_028_STRUGGLE_MECHANICS: Readonly<Record<
  RegisteredBatch028MoveName,
  RegisteredStruggleMechanics
>> = Object.freeze({
  'Struggle (Freezer Special)': {
    type: 'Ice',
    damageClass: 'Special',
    capability: 'Freezer',
    range: 'Melee, 1 Target',
    immuneDefenderType: null,
  },
  'Struggle (Guster Physical)': {
    type: 'Flying',
    damageClass: 'Physical',
    capability: 'Guster',
    range: 'Melee, 1 Target',
    immuneDefenderType: null,
  },
  'Struggle (Guster Special)': {
    type: 'Flying',
    damageClass: 'Special',
    capability: 'Guster',
    range: 'Melee, 1 Target',
    immuneDefenderType: null,
  },
  'Struggle (Materializer Physical)': {
    type: 'Rock',
    damageClass: 'Physical',
    capability: 'Materializer',
    range: 'Melee, 1 Target',
    immuneDefenderType: null,
  },
  'Struggle (Materializer Special)': {
    type: 'Rock',
    damageClass: 'Special',
    capability: 'Materializer',
    range: 'Melee, 1 Target',
    immuneDefenderType: null,
  },
  'Struggle (Telekinetic Physical)': {
    type: 'Normal',
    damageClass: 'Physical',
    capability: 'Telekinetic',
    range: 'Focus Rank, 1 Target',
    immuneDefenderType: 'Ghost',
  },
  'Struggle (Telekinetic Special)': {
    type: 'Normal',
    damageClass: 'Special',
    capability: 'Telekinetic',
    range: 'Focus Rank, 1 Target',
    immuneDefenderType: 'Ghost',
  },
  'Struggle (Zapper Physical)': {
    type: 'Electric',
    damageClass: 'Physical',
    capability: 'Zapper',
    range: 'Melee, 1 Target',
    immuneDefenderType: 'Ground',
  },
})

export const REG_028_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch028MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Struggle (Freezer Special)': STRUGGLE_FREEZER_SPECIAL_REG_028_SCENARIOS,
  'Struggle (Guster Physical)': STRUGGLE_GUSTER_PHYSICAL_REG_028_SCENARIOS,
  'Struggle (Guster Special)': STRUGGLE_GUSTER_SPECIAL_REG_028_SCENARIOS,
  'Struggle (Materializer Physical)': STRUGGLE_MATERIALIZER_PHYSICAL_REG_028_SCENARIOS,
  'Struggle (Materializer Special)': STRUGGLE_MATERIALIZER_SPECIAL_REG_028_SCENARIOS,
  'Struggle (Telekinetic Physical)': STRUGGLE_TELEKINETIC_PHYSICAL_REG_028_SCENARIOS,
  'Struggle (Telekinetic Special)': STRUGGLE_TELEKINETIC_SPECIAL_REG_028_SCENARIOS,
  'Struggle (Zapper Physical)': STRUGGLE_ZAPPER_PHYSICAL_REG_028_SCENARIOS,
})
