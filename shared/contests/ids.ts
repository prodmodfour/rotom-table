export const CONTEST_STAT_IDS = Object.freeze(['beauty', 'cool', 'cute', 'smart', 'tough'] as const)
export type ContestStatId = typeof CONTEST_STAT_IDS[number]

export const CONTEST_VARIANT_IDS = Object.freeze(['standard', 'supercontest', 'festival', 'rotation'] as const)
export type ContestVariantId = typeof CONTEST_VARIANT_IDS[number]

/** Reviewed additive Contest formats that layer onto one canonical base variant. */
export const CONTEST_PARTICIPANT_VARIANT_IDS = Object.freeze(['trainer-participant'] as const)
export type ContestParticipantVariantId = typeof CONTEST_PARTICIPANT_VARIANT_IDS[number]

export const CONTEST_PARTICIPANT_METHOD_IDS = Object.freeze(['simultaneous', 'alternating'] as const)
export type ContestParticipantMethodId = typeof CONTEST_PARTICIPANT_METHOD_IDS[number]

export const CONTEST_STAGES = Object.freeze(['setup', 'introduction', 'performance', 'settling', 'completed', 'cancelled'] as const)
export type ContestStage = typeof CONTEST_STAGES[number]

export const CONTEST_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E'] as const)
export type ContestLetter = typeof CONTEST_LETTERS[number]

export const CONTEST_INTRODUCTION_SKILL_IDS = Object.freeze(['charm', 'command', 'guile', 'intimidate', 'intuition'] as const)
export type ContestIntroductionSkillId = typeof CONTEST_INTRODUCTION_SKILL_IDS[number]

export const CONTEST_EFFECT_IDS = Object.freeze([
  'attention-grabber', 'big-show', 'catching-up', 'desperation', 'double-time',
  'excitement', 'exhausting-act', 'gamble', 'get-ready', 'good-show', 'incentives',
  'inversed-appeal', 'reflective-appeal', 'reliable', 'sabotage', 'safe-option',
  'saving-grace', 'seen-nothing-yet', 'special-attention', 'steady-performance',
  'tease', 'unsettling',
] as const)
export type ContestEffectId = typeof CONTEST_EFFECT_IDS[number]

const boundedId = (value: unknown, label: string, pattern: RegExp, maximum: number): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    throw new Error(`${label} must be a stable bounded identifier`)
  }
  return value
}

export const parseContestId = (value: unknown, label = 'contestId'): string =>
  boundedId(value, label, /^contest:v1:[a-z0-9][a-z0-9-]{0,79}$/u, 91)

export const parseContestantId = (value: unknown, label = 'contestantId'): string =>
  boundedId(value, label, /^contestant:[a-z0-9][a-z0-9-]{0,79}$/u, 91)

export const parseContestOperationId = (value: unknown, label = 'operationId'): string =>
  boundedId(value, label, /^contest-op:v1:[A-Za-z0-9_-]{8,96}$/u, 110)

export const parseContestAppealId = (value: unknown, label = 'appealId'): string =>
  boundedId(value, label, /^appeal:[a-z0-9][a-z0-9-]{0,95}$/u, 103)

export const isContestStatId = (value: unknown): value is ContestStatId =>
  typeof value === 'string' && CONTEST_STAT_IDS.includes(value as ContestStatId)

export const isContestEffectId = (value: unknown): value is ContestEffectId =>
  typeof value === 'string' && CONTEST_EFFECT_IDS.includes(value as ContestEffectId)

export const isContestVariantId = (value: unknown): value is ContestVariantId =>
  typeof value === 'string' && CONTEST_VARIANT_IDS.includes(value as ContestVariantId)

export const isContestParticipantVariantId = (value: unknown): value is ContestParticipantVariantId =>
  typeof value === 'string' && CONTEST_PARTICIPANT_VARIANT_IDS.includes(value as ContestParticipantVariantId)

export const isContestParticipantMethodId = (value: unknown): value is ContestParticipantMethodId =>
  typeof value === 'string' && CONTEST_PARTICIPANT_METHOD_IDS.includes(value as ContestParticipantMethodId)

export const emptyContestStatRecord = <T>(factory: (id: ContestStatId) => T): Record<ContestStatId, T> => ({
  beauty: factory('beauty'),
  cool: factory('cool'),
  cute: factory('cute'),
  smart: factory('smart'),
  tough: factory('tough'),
})
