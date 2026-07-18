/** Reviewed semantic evidence IDs for Helping Hand's apply/use/expiry flow. */
export const HELPING_HAND_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'helping-hand.v2-duplicate-replay',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'helping-hand.v2-nonqualifying-retain',
    evidenceClasses: ['threshold-fail'] as const,
  },
  {
    scenarioId: 'helping-hand.v2-qualifying-consume',
    evidenceClasses: ['lifecycle-trigger', 'threshold-pass'] as const,
  },
  {
    scenarioId: 'helping-hand.v2-round-expiry',
    evidenceClasses: ['lifecycle-cleanup'] as const,
  },
] as const)
