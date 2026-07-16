export type MoveMapOperationReductionErrorCode =
  | 'unsupported-operation'
  | 'duplicate-operation-id'
  | 'invalid-recipient-set'
  | 'recipient-set-mismatch'
  | 'recipient-not-found'
  | 'field-placeholder-unsupported'
  | 'field-placeholder-invalid'
  | 'hazard-geometry-missing'
  | 'hazard-geometry-invalid'
  | 'hazard-ownership-invalid'
  | 'hazard-zone-invalid'
  | 'hazard-zone-conflict'
  | 'duplicate-usage-resource'
  | 'usage-resource-missing'
  | 'usage-owner-mismatch'
  | 'usage-owner-sheet-missing'
  | 'usage-transition-failed'
  | 'trace-operation-missing'
  | 'trace-operation-mismatch'

export class MoveMapOperationReductionError extends Error {
  readonly code: MoveMapOperationReductionErrorCode
  override readonly cause?: unknown

  constructor(
    code: MoveMapOperationReductionErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'MoveMapOperationReductionError'
    this.code = code
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export const failMoveMapOperationReduction = (
  code: MoveMapOperationReductionErrorCode,
  message: string,
  cause?: unknown,
): never => {
  throw new MoveMapOperationReductionError(code, message, { cause })
}
