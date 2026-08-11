import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import {
  BREEDING_COMMAND_JSON_MAXIMUM_BYTES,
  BreedingRequestBodyError,
  readBreedingJsonRequestBody,
} from '../../server/security/breedingRequestBody'

const event = (body: string | Buffer | undefined, headers: Record<string, string> = {}): H3Event => ({
  method: 'POST',
  path: '/api/breeding/test',
  node: {
    req: {
      url: '/api/breeding/test',
      headers,
      body,
    },
  },
  context: {},
} as unknown as H3Event)

const expectBodyError = async (
  promise: Promise<unknown>,
  statusCode: 400 | 413,
  message: string,
): Promise<void> => {
  let error: unknown
  try { await promise }
  catch (caught) { error = caught }
  expect(error).toBeInstanceOf(BreedingRequestBodyError)
  expect(error).toMatchObject({ statusCode, message })
}

describe('breeding bounded JSON request ingress', () => {
  it('accepts strict UTF-8 JSON through the exact policy byte limit', async () => {
    expect(BREEDING_COMMAND_JSON_MAXIMUM_BYTES).toBe(32_768)
    await expect(readBreedingJsonRequestBody(event('{"value":1}'))).resolves.toEqual({ value: 1 })

    const exact = `{"x":"${'a'.repeat(BREEDING_COMMAND_JSON_MAXIMUM_BYTES - 8)}"}`
    expect(Buffer.byteLength(exact)).toBe(BREEDING_COMMAND_JSON_MAXIMUM_BYTES)
    await expect(readBreedingJsonRequestBody(event(exact, {
      'content-length': String(BREEDING_COMMAND_JSON_MAXIMUM_BYTES),
    }))).resolves.toEqual({ x: 'a'.repeat(BREEDING_COMMAND_JSON_MAXIMUM_BYTES - 8) })
  })

  it('rejects an oversized declared body before reading its body value', async () => {
    const request = event(undefined, {
      'content-length': String(BREEDING_COMMAND_JSON_MAXIMUM_BYTES + 1),
    })
    await expectBodyError(
      readBreedingJsonRequestBody(request),
      413,
      'Breeding request body exceeds the bounded JSON limit',
    )
  })

  it('rejects oversized undeclared bytes, malformed lengths, and length mismatch', async () => {
    await expectBodyError(
      readBreedingJsonRequestBody(event(`"${'a'.repeat(BREEDING_COMMAND_JSON_MAXIMUM_BYTES)}"`)),
      413,
      'Breeding request body exceeds the bounded JSON limit',
    )
    await expectBodyError(
      readBreedingJsonRequestBody(event('{}', { 'content-length': '-1' })),
      400,
      'Breeding request Content-Length is malformed',
    )
    await expectBodyError(
      readBreedingJsonRequestBody(event('{}', { 'content-length': '3' })),
      400,
      'Breeding request Content-Length does not match the body',
    )
  })

  it('rejects invalid UTF-8 and malformed JSON without echoing payloads', async () => {
    await expectBodyError(
      readBreedingJsonRequestBody(event(Buffer.from([0xff]))),
      400,
      'Breeding request body must be valid UTF-8 JSON',
    )
    await expectBodyError(
      readBreedingJsonRequestBody(event('{"private":"DO-NOT-ECHO"')),
      400,
      'Breeding request body must be valid JSON',
    )
  })

  it('returns no value for an absent body so the closed route parser owns shape rejection', async () => {
    await expect(readBreedingJsonRequestBody(event(undefined))).resolves.toBeUndefined()
  })
})
