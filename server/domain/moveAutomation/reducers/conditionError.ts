export type MoveCoreConditionReductionErrorCode =
  | 'unknown-condition'
  | 'invalid-condition-random-choice'
  | 'invalid-condition-stack-policy'
  | 'invalid-condition-effect-scope'

export class MoveCoreConditionReductionError extends Error {
  readonly code: MoveCoreConditionReductionErrorCode

  constructor(code: MoveCoreConditionReductionErrorCode, message: string) {
    super(message)
    this.name = 'MoveCoreConditionReductionError'
    this.code = code
  }
}

export const failMoveCoreConditionReduction = (
  code: MoveCoreConditionReductionErrorCode,
  message: string,
): never => {
  throw new MoveCoreConditionReductionError(code, message)
}
