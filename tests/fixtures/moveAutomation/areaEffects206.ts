import type { AreaEffects206MoveName } from '~~/server/domain/moveAutomation/specs/areaEffects206'

export interface AreaEffects206ScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Value extends readonly AreaEffects206ScenarioEvidence[]>(
  value: Value,
): Value => Object.freeze(value)

export const AEROBLAST_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'aeroblast.v2-even-critical-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'crit', 'hit', 'miss', 'threshold-pass'],
  },
  {
    scenarioId: 'aeroblast.v2-odd-noncritical',
    evidenceClasses: ['threshold-fail'],
  },
  { scenarioId: 'aeroblast.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'aeroblast.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const AROMATHERAPY_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'aromatherapy.v2-ally-filter-and-single-cleanse',
    evidenceClasses: ['ally', 'area-mixed-outcomes'],
  },
  {
    scenarioId: 'aromatherapy.v2-durable-per-ally-choice',
    evidenceClasses: ['choice', 'reconnect'],
  },
  { scenarioId: 'aromatherapy.v2-healthy-ally-no-op', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'aromatherapy.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'aromatherapy.v2-stale-ally', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const BELCH_MA_206_SCENARIOS = scenarios([
  { scenarioId: 'belch.v2-digestion-precondition-reject', evidenceClasses: ['threshold-fail'] },
  {
    scenarioId: 'belch.v2-traded-buff-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'belch.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'belch.v2-steel-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'belch.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'belch.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const BUG_BUZZ_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'bug-buzz.v2-cone-mixed-threshold',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'bug-buzz.v2-close-blast-form', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'bug-buzz.v2-stage-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'bug-buzz.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'bug-buzz.v2-soundproof-and-shield-dust', evidenceClasses: ['immunity'] },
  { scenarioId: 'bug-buzz.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'bug-buzz.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const CAPTIVATE_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'captivate.v2-opposite-gender-area-filter',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'threshold-pass'],
  },
  { scenarioId: 'captivate.v2-same-and-genderless-excluded', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'captivate.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'captivate.v2-friendly-exclusion', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'captivate.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'captivate.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const DIAMOND_STORM_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'diamond-storm.v2-even-rolls-stack-defense',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'diamond-storm.v2-odd-roll-no-stage', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'diamond-storm.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'diamond-storm.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'diamond-storm.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const DRACO_METEOR_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'draco-meteor.v2-area-smite-and-self-drop',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'draco-meteor.v2-all-immune-no-self-drop', evidenceClasses: ['immunity', 'threshold-fail'] },
  { scenarioId: 'draco-meteor.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'draco-meteor.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'draco-meteor.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const FLEUR_CANNON_MA_206_SCENARIOS = scenarios([
  {
    scenarioId: 'fleur-cannon.v2-line-smite-and-self-drop',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'fleur-cannon.v2-empty-line-no-self-drop', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'fleur-cannon.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'fleur-cannon.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'fleur-cannon.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const MA_206_SCENARIOS_BY_MOVE: Readonly<Record<
  AreaEffects206MoveName,
  readonly AreaEffects206ScenarioEvidence[]
>> = Object.freeze({
  Aeroblast: AEROBLAST_MA_206_SCENARIOS,
  Aromatherapy: AROMATHERAPY_MA_206_SCENARIOS,
  Belch: BELCH_MA_206_SCENARIOS,
  'Bug Buzz': BUG_BUZZ_MA_206_SCENARIOS,
  Captivate: CAPTIVATE_MA_206_SCENARIOS,
  'Diamond Storm': DIAMOND_STORM_MA_206_SCENARIOS,
  'Draco Meteor': DRACO_METEOR_MA_206_SCENARIOS,
  'Fleur Cannon': FLEUR_CANNON_MA_206_SCENARIOS,
})
