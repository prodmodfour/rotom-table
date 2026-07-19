import { SWORDS_DANCE_V2_SEMANTIC_SCENARIOS } from './swordsDanceV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const STRUGGLE_ZAPPER_SPECIAL_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'struggle-zapper-special.legacy-v1-novice-no-stab-hit', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-expert-combat-branch', evidenceClasses: ['alternate-branch'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-ground-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-capability-required', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'struggle-zapper-special.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const STRUGGLE_BUG_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'struggle-bug.legacy-v1-cone-mixed', evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'] },
  { scenarioId: 'struggle-bug.legacy-v1-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'struggle-bug.legacy-v1-stage-cap', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'struggle-bug.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'struggle-bug.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const STUN_SPORE_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'stun-spore.legacy-v1-paralysis-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'stun-spore.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'stun-spore.legacy-v1-powder-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'stun-spore.legacy-v1-electric-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'stun-spore.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'stun-spore.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const SUPERSONIC_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'supersonic.v2-confusion-hit', evidenceClasses: ['hit'] },
  { scenarioId: 'supersonic.v2-miss-penalty', evidenceClasses: ['lifecycle-trigger', 'miss'] },
  { scenarioId: 'supersonic.v2-soundproof-hit-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'supersonic.v2-soundproof-miss-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'supersonic.v2-penalty-next-accuracy', evidenceClasses: ['lifecycle-trigger'] },
  { scenarioId: 'supersonic.v2-source-turn-expiry', evidenceClasses: ['lifecycle-cleanup'] },
  { scenarioId: 'supersonic.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'supersonic.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const SWAGGER_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'swagger.legacy-v1-stage-and-confusion', evidenceClasses: ['hit', 'threshold-pass'] },
  { scenarioId: 'swagger.legacy-v1-miss', evidenceClasses: ['miss'] },
  { scenarioId: 'swagger.legacy-v1-stage-cap', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'swagger.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'swagger.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const SWEET_SCENT_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'sweet-scent.v2-burst-mixed', evidenceClasses: ['area-mixed-outcomes', 'hit', 'lifecycle-trigger', 'miss', 'threshold-pass'] },
  { scenarioId: 'sweet-scent.v2-friendly-exclusion', evidenceClasses: ['area-mixed-outcomes'] },
  { scenarioId: 'sweet-scent.v2-evasion-floor', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'sweet-scent.v2-scene-cleanup', evidenceClasses: ['lifecycle-cleanup'] },
  { scenarioId: 'sweet-scent.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'sweet-scent.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const SWIFT_REG_029_SCENARIOS = scenarios([
  { scenarioId: 'swift.legacy-v1-automatic-area-hit', evidenceClasses: ['area-mixed-outcomes', 'hit'] },
  { scenarioId: 'swift.legacy-v1-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'swift.legacy-v1-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'swift.legacy-v1-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const SWORDS_DANCE_REG_029_SCENARIOS = scenarios([
  {
    ...SWORDS_DANCE_V2_SEMANTIC_SCENARIOS[0],
    evidenceClasses: ['self', 'threshold-fail'],
  },
  {
    ...SWORDS_DANCE_V2_SEMANTIC_SCENARIOS[1],
    evidenceClasses: ['self', 'threshold-pass'],
  },
  {
    ...SWORDS_DANCE_V2_SEMANTIC_SCENARIOS[2],
    evidenceClasses: ['retry', 'self', 'threshold-pass'],
  },
  { scenarioId: 'swords-dance.v2-stale-actor', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const REG_029_MOVE_NAMES = Object.freeze([
  'Struggle (Zapper Special)',
  'Struggle Bug',
  'Stun Spore',
  'Supersonic',
  'Swagger',
  'Sweet Scent',
  'Swift',
  'Swords Dance',
] as const)

export type RegisteredBatch029MoveName = (typeof REG_029_MOVE_NAMES)[number]

export const REG_029_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch029MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Struggle (Zapper Special)': STRUGGLE_ZAPPER_SPECIAL_REG_029_SCENARIOS,
  'Struggle Bug': STRUGGLE_BUG_REG_029_SCENARIOS,
  'Stun Spore': STUN_SPORE_REG_029_SCENARIOS,
  Supersonic: SUPERSONIC_REG_029_SCENARIOS,
  Swagger: SWAGGER_REG_029_SCENARIOS,
  'Sweet Scent': SWEET_SCENT_REG_029_SCENARIOS,
  Swift: SWIFT_REG_029_SCENARIOS,
  'Swords Dance': SWORDS_DANCE_REG_029_SCENARIOS,
})
