import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '~/utils/errorMessages'

describe('getErrorMessage', () => {
  it('prefers top-level HTTP status messages', () => {
    expect(getErrorMessage({ statusMessage: 'Forbidden', message: 'Boom' })).toBe('Forbidden')
  })

  it('uses Nuxt fetch data messages when present', () => {
    expect(getErrorMessage({ data: { statusMessage: 'Bad request' }, message: 'Fallback' })).toBe('Bad request')
    expect(getErrorMessage({ data: { message: 'Payload failed' } })).toBe('Payload failed')
  })

  it('falls back to Error.message and primitive string errors', () => {
    expect(getErrorMessage(new Error('Exploded'))).toBe('Exploded')
    expect(getErrorMessage('Nope')).toBe('Nope')
  })

  it('uses a configurable fallback for nullish errors', () => {
    expect(getErrorMessage(null, { fallback: 'Nothing happened' })).toBe('Nothing happened')
  })
})
