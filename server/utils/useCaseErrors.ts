export interface HttpUseCaseErrorLike extends Error {
  readonly statusCode: number
}

export class UseCaseHttpError<TStatusCode extends number = number>
  extends Error
  implements HttpUseCaseErrorLike {
  readonly statusCode: TStatusCode

  constructor(statusCode: TStatusCode, message: string) {
    super(message)
    this.statusCode = statusCode
    this.name = new.target.name
  }
}

export const isUseCaseHttpErrorLike = (error: unknown): error is HttpUseCaseErrorLike => {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { statusCode?: unknown }
  return typeof candidate.statusCode === 'number'
    && Number.isInteger(candidate.statusCode)
    && candidate.statusCode >= 400
}
