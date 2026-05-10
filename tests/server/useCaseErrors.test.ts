import { describe, expect, it } from 'vitest'
import { isUseCaseHttpErrorLike, UseCaseHttpError } from '~/server/utils/useCaseErrors'

class ExampleUseCaseError extends UseCaseHttpError<400 | 409> {}

describe('use-case HTTP errors', () => {
  it('preserves status codes, messages, and subclass names', () => {
    const error = new ExampleUseCaseError(409, 'Already exists')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(UseCaseHttpError)
    expect(error.statusCode).toBe(409)
    expect(error.message).toBe('Already exists')
    expect(error.name).toBe('ExampleUseCaseError')
  })

  it('recognizes only Error instances with HTTP status codes', () => {
    expect(isUseCaseHttpErrorLike(new ExampleUseCaseError(400, 'Bad request'))).toBe(true)
    expect(isUseCaseHttpErrorLike(new UseCaseHttpError(500, 'Server error'))).toBe(true)
    expect(isUseCaseHttpErrorLike(new UseCaseHttpError(399, 'Not an HTTP error'))).toBe(false)
    expect(isUseCaseHttpErrorLike(new Error('plain'))).toBe(false)
    expect(isUseCaseHttpErrorLike({ statusCode: 400, message: 'structural only' })).toBe(false)
  })
})
