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

export const isUseCaseHttpErrorLike = (error: unknown): error is HttpUseCaseErrorLike => (
  error instanceof Error
  && typeof (error as { statusCode?: unknown }).statusCode === 'number'
  && Number.isInteger((error as { statusCode: number }).statusCode)
  && (error as { statusCode: number }).statusCode >= 400
)
