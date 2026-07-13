import type { MoveEffectRequestOption } from '#shared/moveAutomation/effects'

export type MoveSpecResolvedResponseErrorCode =
  | 'duplicate-response'
  | 'unknown-response-option'
  | 'response-pass-not-allowed'
  | 'unused-response'

export class MoveSpecResolvedResponseError extends Error {
  readonly code: MoveSpecResolvedResponseErrorCode

  constructor(code: MoveSpecResolvedResponseErrorCode, message: string) {
    super(message)
    this.name = 'MoveSpecResolvedResponseError'
    this.code = code
  }
}

export interface MoveSpecResolvedResponse {
  readonly requestId: string
  readonly optionId: string | null
}

export interface MoveSpecResponseResolver {
  resolve(input: {
    readonly requestId: string
    readonly options: readonly MoveEffectRequestOption[]
    readonly allowPass: boolean
  }): MoveSpecResolvedResponse | null
  assertAllConsumed(): void
}

const fail = (
  code: MoveSpecResolvedResponseErrorCode,
  message: string,
): never => {
  throw new MoveSpecResolvedResponseError(code, message)
}

/**
 * Bind durable response IDs to reviewed server options. Labels and mechanics
 * never participate in this lookup, and every supplied response must be used.
 */
export const createMoveSpecResponseResolver = (
  responses: readonly MoveSpecResolvedResponse[] = [],
): MoveSpecResponseResolver => {
  const byRequestId = new Map<string, MoveSpecResolvedResponse>()
  for (const response of responses) {
    if (byRequestId.has(response.requestId)) {
      fail('duplicate-response', `Response request ${response.requestId} was supplied more than once.`)
    }
    byRequestId.set(response.requestId, Object.freeze({ ...response }))
  }
  const consumed = new Set<string>()

  return Object.freeze({
    resolve: (input: {
      readonly requestId: string
      readonly options: readonly MoveEffectRequestOption[]
      readonly allowPass: boolean
    }): MoveSpecResolvedResponse | null => {
      const { requestId, options, allowPass } = input
      const response = byRequestId.get(requestId) ?? null
      if (!response) return null
      if (response.optionId === null) {
        if (!allowPass) {
          return fail(
            'response-pass-not-allowed',
            `Response request ${requestId} does not allow pass.`,
          )
        }
      }
      else if (!options.some(option => option.id === response.optionId)) {
        return fail(
          'unknown-response-option',
          `Response option ${response.optionId} is not reviewed for request ${requestId}.`,
        )
      }
      consumed.add(requestId)
      return response
    },
    assertAllConsumed: () => {
      const unused = [...byRequestId.keys()].find(requestId => !consumed.has(requestId))
      if (unused) {
        fail('unused-response', `Response request ${unused} was not reached by the reviewed MoveSpec.`)
      }
    },
  })
}
