export type MoveCoreTokenEffectReductionErrorCode =
  | 'unsupported-operation'
  | 'duplicate-operation-id'
  | 'damage-resolution-missing'
  | 'invalid-damage-resolution'
  | 'invalid-hp-calculation'
  | 'invalid-hp-source'
  | 'invalid-hp-recipient-count'
  | 'invalid-stage-source'
  | 'invalid-stage-recipient-count'
  | 'invalid-condition-source'
  | 'invalid-condition-recipient-count'
  | 'hp-precondition-failed'
  | 'invalid-recipient-set'
  | 'recipient-set-mismatch'
  | 'recipient-not-found'
  | 'recipient-sheet-missing'
  | 'conflicting-shared-sheet-effects'
  | 'trace-operation-missing'
  | 'trace-operation-mismatch'

export class MoveCoreTokenEffectReductionError extends Error {
  readonly code: MoveCoreTokenEffectReductionErrorCode

  constructor(code: MoveCoreTokenEffectReductionErrorCode, message: string) {
    super(message)
    this.name = 'MoveCoreTokenEffectReductionError'
    this.code = code
  }
}

export const failMoveCoreTokenEffectReduction = (
  code: MoveCoreTokenEffectReductionErrorCode,
  message: string,
): never => {
  throw new MoveCoreTokenEffectReductionError(code, message)
}
