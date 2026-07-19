export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const STONE_EDGE_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'stone-edge.legacy-v1-ordinary-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'stone-edge.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'stone-edge.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'stone-edge.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'stone-edge.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRANGE_STEAM_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'strange-steam.legacy-v1-burst-mixed-thresholds',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass', 'threshold-fail'],
  },
  {
    scenarioId: 'strange-steam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'strange-steam.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'strange-steam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'strange-steam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'struggle.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'struggle.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_FIRESTARTER_PHYSICAL_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-firestarter-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_FIRESTARTER_SPECIAL_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-firestarter-special.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_FOUNTAIN_PHYSICAL_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-fountain-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_FOUNTAIN_SPECIAL_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-fountain-special.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const STRUGGLE_FREEZER_PHYSICAL_REG_027_SCENARIOS = scenarios([
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-novice-no-stab-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-expert-combat-branch',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-capability-required',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'struggle-freezer-physical.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_027_MOVE_NAMES = Object.freeze([
  'Stone Edge',
  'Strange Steam',
  'Struggle',
  'Struggle (Firestarter Physical)',
  'Struggle (Firestarter Special)',
  'Struggle (Fountain Physical)',
  'Struggle (Fountain Special)',
  'Struggle (Freezer Physical)',
] as const)

export type RegisteredBatch027MoveName = (typeof REG_027_MOVE_NAMES)[number]

export const REG_027_STRUGGLE_MOVE_NAMES = Object.freeze(
  REG_027_MOVE_NAMES.filter((moveName): moveName is Extract<RegisteredBatch027MoveName, `Struggle${string}`> => (
    moveName.startsWith('Struggle')
  )),
)

export const REG_027_CAPABILITY_STRUGGLE_MOVE_NAMES = Object.freeze([
  'Struggle (Firestarter Physical)',
  'Struggle (Firestarter Special)',
  'Struggle (Fountain Physical)',
  'Struggle (Fountain Special)',
  'Struggle (Freezer Physical)',
] as const)

export type RegisteredBatch027CapabilityStruggleMoveName =
  (typeof REG_027_CAPABILITY_STRUGGLE_MOVE_NAMES)[number]

export const REG_027_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch027MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Stone Edge': STONE_EDGE_REG_027_SCENARIOS,
  'Strange Steam': STRANGE_STEAM_REG_027_SCENARIOS,
  Struggle: STRUGGLE_REG_027_SCENARIOS,
  'Struggle (Firestarter Physical)': STRUGGLE_FIRESTARTER_PHYSICAL_REG_027_SCENARIOS,
  'Struggle (Firestarter Special)': STRUGGLE_FIRESTARTER_SPECIAL_REG_027_SCENARIOS,
  'Struggle (Fountain Physical)': STRUGGLE_FOUNTAIN_PHYSICAL_REG_027_SCENARIOS,
  'Struggle (Fountain Special)': STRUGGLE_FOUNTAIN_SPECIAL_REG_027_SCENARIOS,
  'Struggle (Freezer Physical)': STRUGGLE_FREEZER_PHYSICAL_REG_027_SCENARIOS,
})
