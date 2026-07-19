export interface StompAndThunderFang204ScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Value extends readonly StompAndThunderFang204ScenarioEvidence[]>(
  value: Value,
): Value => Object.freeze(value)

export const STOMP_MA_204_SCENARIOS = scenarios([
  {
    scenarioId: 'stomp.v2-smaller-target-bonus-and-flinch',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'stomp.v2-equal-size-no-bonus',
    evidenceClasses: ['alternate-branch', 'threshold-fail'],
  },
  {
    scenarioId: 'stomp.v2-size-unavailable-no-bonus',
    evidenceClasses: ['alternate-branch'],
  },
  { scenarioId: 'stomp.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'stomp.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'stomp.v2-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'stomp.v2-inner-focus-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'stomp.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'stomp.v2-stale-size-read',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const THUNDER_FANG_MA_204_SCENARIOS = scenarios([
  {
    scenarioId: 'thunder-fang.v2-paralysis-coin-branch',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'thunder-fang.v2-flinch-coin-branch',
    evidenceClasses: ['alternate-branch'],
  },
  { scenarioId: 'thunder-fang.v2-threshold-fail', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'thunder-fang.v2-natural-twenty-both', evidenceClasses: ['crit'] },
  { scenarioId: 'thunder-fang.v2-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'thunder-fang.v2-ground-immunity', evidenceClasses: ['immunity'] },
  {
    scenarioId: 'thunder-fang.v2-electric-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  { scenarioId: 'thunder-fang.v2-inner-focus-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'thunder-fang.v2-duplicate-replay', evidenceClasses: ['retry'] },
  {
    scenarioId: 'thunder-fang.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const MA_204_MOVE_NAMES = Object.freeze(['Stomp', 'Thunder Fang'] as const)
export type StompAndThunderFang204MoveName = (typeof MA_204_MOVE_NAMES)[number]

export const MA_204_SCENARIOS_BY_MOVE: Readonly<Record<
  StompAndThunderFang204MoveName,
  readonly StompAndThunderFang204ScenarioEvidence[]
>> = Object.freeze({
  Stomp: STOMP_MA_204_SCENARIOS,
  'Thunder Fang': THUNDER_FANG_MA_204_SCENARIOS,
})
