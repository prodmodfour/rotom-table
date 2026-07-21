import {
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRandomDrawFormula,
  type MoveAutomationRandomRollRequest,
  type MoveAutomationRandomRollResult,
  type MoveAutomationRandomRoller,
  type MoveAutomationRandomTableEntry,
  type MoveAutomationRandomTableRollRequest,
  type MoveAutomationRollLedgerEntry,
  type MoveAutomationRollModifier,
} from '../moveAutomation/random'

export type AbilityAutomationRandomDrawFormula = MoveAutomationRandomDrawFormula
export type AbilityAutomationRandomRollRequest = MoveAutomationRandomRollRequest
export type AbilityAutomationRandomRollResult = MoveAutomationRandomRollResult
export type AbilityAutomationRandomRoller = MoveAutomationRandomRoller
export type AbilityAutomationRandomTableEntry = MoveAutomationRandomTableEntry
export type AbilityAutomationRandomTableRollRequest = MoveAutomationRandomTableRollRequest
export type AbilityAutomationRollModifier = MoveAutomationRollModifier
export type AbilityAutomationRollLedgerEntry = MoveAutomationRollLedgerEntry

export type AbilityAutomationRollLedgerValidationCode =
  | 'invalid-roll-ledger'
  | 'limit-exceeded'
  | 'duplicate-roll-id'
  | 'not-json'

export class AbilityAutomationRollLedgerValidationError extends Error {
  readonly code: AbilityAutomationRollLedgerValidationCode
  readonly path: string

  constructor(code: AbilityAutomationRollLedgerValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityAutomationRollLedgerValidationError'
    this.code = code
    this.path = path
  }
}

/** Reuse the domain-neutral bounded roll grammar behind an ability-owned name. */
export const parseAbilityAutomationRollLedger = (
  value: unknown,
  path = 'abilityRollLedger',
): readonly AbilityAutomationRollLedgerEntry[] => {
  try {
    return parseMoveAutomationRollLedger(value, path)
  }
  catch (error) {
    if (!(error instanceof MoveAutomationRollLedgerValidationError)) throw error
    const prefix = `${error.path}: `
    throw new AbilityAutomationRollLedgerValidationError(
      error.code === 'invalid-roll-ledger'
        ? 'invalid-roll-ledger'
        : error.code,
      error.path,
      error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message,
    )
  }
}
