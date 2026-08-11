import { getRequestHeader, readRawBody, type H3Event } from 'h3'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export const BREEDING_COMMAND_JSON_MAXIMUM_BYTES = securityPolicyJson.definition.abuseLimits.commandJsonBytes

export class BreedingRequestBodyError extends UseCaseHttpError<400 | 413> {}

const declaredLength = (event: H3Event): number | null => {
  const header = getRequestHeader(event, 'content-length')
  if (header === undefined) return null
  if (!/^(?:0|[1-9][0-9]*)$/u.test(header)) {
    throw new BreedingRequestBodyError(400, 'Breeding request Content-Length is malformed')
  }
  const value = Number(header)
  if (!Number.isSafeInteger(value)) {
    throw new BreedingRequestBodyError(400, 'Breeding request Content-Length is malformed')
  }
  return value
}

/** Strict JSON ingress for every Breeding POST surface. */
export const readBreedingJsonRequestBody = async (event: H3Event): Promise<unknown> => {
  const length = declaredLength(event)
  if (length !== null && length > BREEDING_COMMAND_JSON_MAXIMUM_BYTES) {
    throw new BreedingRequestBodyError(413, 'Breeding request body exceeds the bounded JSON limit')
  }

  const bytes = await readRawBody(event, false)
  if (bytes === undefined || bytes.length === 0) return undefined
  if (bytes.length > BREEDING_COMMAND_JSON_MAXIMUM_BYTES) {
    throw new BreedingRequestBodyError(413, 'Breeding request body exceeds the bounded JSON limit')
  }
  if (length !== null && length !== bytes.length) {
    throw new BreedingRequestBodyError(400, 'Breeding request Content-Length does not match the body')
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch {
    throw new BreedingRequestBodyError(400, 'Breeding request body must be valid UTF-8 JSON')
  }
  try {
    return JSON.parse(text) as unknown
  }
  catch {
    throw new BreedingRequestBodyError(400, 'Breeding request body must be valid JSON')
  }
}
