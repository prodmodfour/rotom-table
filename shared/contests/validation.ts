export const CONTEST_VALIDATION_CODES = Object.freeze([
  'contest.not-found',
  'contest.revision-conflict',
  'contest.operation-conflict',
  'contest.stage-mismatch',
  'contest.paused',
  'contest.controller-required',
  'contest.gm-required',
  'contest.wrong-turn',
  'contest.option-not-offered',
  'contest.move-unavailable',
  'contest.move-repeat-forbidden',
  'contest.move-blocked-by-intervention',
  'contest.dice-overspend',
  'contest.resource-exhausted',
  'contest.intervention-window-closed',
  'contest.intervention-conflict',
  'contest.intervention-decision-required',
  'contest.contestant-count',
  'contest.duplicate-contestant',
  'contest.duplicate-pokemon',
  'contest.rotation-performer-required',
  'contest.rotation-team-size',
  'contest.battle-team-size',
  'contest.trainer-participant-stage-unavailable',
  'contest.method-required',
  'contest.method-unavailable',
  'contest.prize-target-invalid',
  'contest.prize-undecided',
  'contest.settlement-not-ready',
  'contest.settlement-failed',
  'contest.correction-out-of-bounds',
] as const)
export type ContestValidationCode = typeof CONTEST_VALIDATION_CODES[number]

export interface ContestValidationIssueV1 {
  readonly code: ContestValidationCode
  readonly contestantId: string | null
  readonly decisionId: string | null
  readonly reason: string
  readonly legalAlternatives: readonly string[]
  readonly field: string | null
}

export class ContestRuleError extends Error {
  readonly issue: ContestValidationIssueV1
  readonly statusCode: 400 | 403 | 404 | 409
  constructor(issue: ContestValidationIssueV1, statusCode: 400 | 403 | 404 | 409 = 400) {
    super(issue.reason)
    this.name = 'ContestRuleError'
    this.issue = Object.freeze({ ...issue, legalAlternatives: Object.freeze([...issue.legalAlternatives]) })
    this.statusCode = statusCode
  }
}

export const contestIssue = (
  code: ContestValidationCode,
  reason: string,
  options: Partial<Omit<ContestValidationIssueV1, 'code' | 'reason'>> = {},
): ContestValidationIssueV1 => Object.freeze({
  code,
  contestantId: options.contestantId ?? null,
  decisionId: options.decisionId ?? null,
  reason,
  legalAlternatives: Object.freeze([...(options.legalAlternatives ?? [])]),
  field: options.field ?? null,
})

export const rejectContest = (
  code: ContestValidationCode,
  reason: string,
  options: Partial<Omit<ContestValidationIssueV1, 'code' | 'reason'>> & { readonly statusCode?: 400 | 403 | 404 | 409 } = {},
): never => {
  throw new ContestRuleError(contestIssue(code, reason, options), options.statusCode ?? 400)
}
