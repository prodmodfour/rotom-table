export const CONTEST_UX_METRIC_IDS = Object.freeze([
  'time-to-contest-start', 'appeal-decision-time', 'round-duration',
  'scoreboard-comprehension', 'illegal-choice-recovery',
  'settlement-completion', 'spectator-clarity',
] as const)
export type ContestUxMetricId = typeof CONTEST_UX_METRIC_IDS[number]
export const isContestUxMetricId = (value: unknown): value is ContestUxMetricId => typeof value === 'string' && CONTEST_UX_METRIC_IDS.includes(value as ContestUxMetricId)
