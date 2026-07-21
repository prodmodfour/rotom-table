import type {
  AbilityAutomationRandomRoller,
  AbilityAutomationRandomRollRequest,
  AbilityAutomationRandomTableRollRequest,
  AbilityAutomationRollLedgerEntry,
} from '#shared/abilityAutomation/random'
import {
  AuthoritativeMoveRandomError,
  createAuthoritativeMoveRandom,
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '../moveAutomation/random'

export type AuthoritativeAbilityRandomSource = AuthoritativeMoveRandomSource

export interface AuthoritativeAbilityRandom extends AbilityAutomationRandomRoller {
  readonly snapshot: () => readonly AbilityAutomationRollLedgerEntry[]
  readonly complete: () => readonly AbilityAutomationRollLedgerEntry[]
}

export type AuthoritativeAbilityRandomErrorCode =
  | 'invalid-random-source-value'
  | 'missing-random-draw'
  | 'excess-random-draws'
  | 'duplicate-roll-id'
  | 'roll-ledger-limit-exceeded'
  | 'invalid-roll-request'
  | 'table-result-missing'
  | 'random-already-completed'

export class AuthoritativeAbilityRandomError extends Error {
  readonly code: AuthoritativeAbilityRandomErrorCode

  constructor(code: AuthoritativeAbilityRandomErrorCode, detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityRandomError'
    this.code = code
  }
}

const translate = <Value>(callback: () => Value): Value => {
  try {
    return callback()
  }
  catch (error) {
    if (!(error instanceof AuthoritativeMoveRandomError)) throw error
    throw new AuthoritativeAbilityRandomError(error.code, error.message.replace(/^A move /, 'An ability '))
  }
}

export const createFiniteAuthoritativeAbilityRandomStream = (
  values: readonly number[],
): AuthoritativeAbilityRandomSource => translate(() => createFiniteAuthoritativeMoveRandomStream(values))

/** Ability facade over the shared deterministic entropy and ledger kernel. */
export const createAuthoritativeAbilityRandom = (
  source?: AuthoritativeAbilityRandomSource,
): AuthoritativeAbilityRandom => {
  const random = createAuthoritativeMoveRandom(source)
  return Object.freeze({
    roll: (request: AbilityAutomationRandomRollRequest) => translate(() => random.roll(request)),
    rollTable: (request: AbilityAutomationRandomTableRollRequest) => translate(() => random.rollTable(request)),
    snapshot: () => translate(() => random.snapshot()),
    complete: () => translate(() => random.complete()),
  })
}
