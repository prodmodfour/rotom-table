import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  breedingConflictScopeKey,
  breedingScopesConflict,
  parseBreedingOperationCommandV1,
  parseBreedingOperationResultV1,
  type BreedingConflictScopeV1,
  type BreedingOperationAcceptedV1,
  type BreedingOperationAggregateRefV1,
  type BreedingOperationCommandKind,
  type BreedingOperationCommandV1,
  type BreedingOperationOutcomeKind,
  type BreedingOperationRejectedV1,
  type BreedingOperationRejectionReasonId,
  type BreedingOperationResultV1,
} from '#shared/breeding/operations'
import type { BreedingOperationId } from '#shared/breeding/ids'

export type BreedingOperationCommandHash = string & { readonly __brand: 'BreedingOperationCommandHash' }
export interface BreedingAcceptedOperationMetadataV1 {
  readonly operationId: BreedingOperationId
  readonly commandHash: BreedingOperationCommandHash
  readonly commandKind: BreedingOperationCommandKind
  readonly changedScopes: readonly BreedingConflictScopeV1[]
  readonly result: BreedingOperationAcceptedV1
}
export interface BreedingScopeConflictV1 {
  readonly attemptedScope: BreedingConflictScopeV1
  readonly conflictingScope: BreedingConflictScopeV1
  readonly conflictingOperationId: BreedingOperationId
}
export type BreedingOperationReplayDecisionV1 =
  | { readonly kind: 'execute', readonly command: BreedingOperationCommandV1, readonly commandHash: BreedingOperationCommandHash }
  | { readonly kind: 'exact-retry', readonly command: BreedingOperationCommandV1, readonly commandHash: BreedingOperationCommandHash, readonly result: BreedingOperationResultV1 }

export class BreedingOperationIdCollisionError extends Error {
  readonly operationId: BreedingOperationId
  readonly existingCommandHash: BreedingOperationCommandHash
  readonly attemptedCommandHash: BreedingOperationCommandHash
  constructor(input: { readonly operationId: BreedingOperationId, readonly existingCommandHash: BreedingOperationCommandHash, readonly attemptedCommandHash: BreedingOperationCommandHash }) {
    super(`Breeding operation ${input.operationId} is already bound to a different command hash.`)
    this.name = 'BreedingOperationIdCollisionError'
    this.operationId = input.operationId
    this.existingCommandHash = input.existingCommandHash
    this.attemptedCommandHash = input.attemptedCommandHash
  }
}
export class BreedingOperationResultConflictError extends Error {
  readonly operationId: BreedingOperationId
  constructor(operationId: BreedingOperationId) {
    super(`Breeding operation ${operationId} already has a different terminal result.`)
    this.name = 'BreedingOperationResultConflictError'
    this.operationId = operationId
  }
}

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const resultDefinition = (result: BreedingOperationResultV1): Omit<BreedingOperationResultV1, 'resultDefinitionSha256'> => {
  const { resultDefinitionSha256: _hash, ...definition } = result
  return definition
}
const receiptDefinition = (value: Pick<BreedingOperationAcceptedV1, 'operationId' | 'commandHash' | 'commandKind' | 'outcomeKind' | 'aggregateRefs' | 'changedScopes' | 'committedAtCampaignMinute'>) => ({
  operationId: value.operationId,
  commandHash: value.commandHash,
  commandKind: value.commandKind,
  outcomeKind: value.outcomeKind,
  aggregateRefs: value.aggregateRefs,
  changedScopes: value.changedScopes,
  committedAtCampaignMinute: value.committedAtCampaignMinute,
})
export const createBreedingOperationCommandHash = (value: unknown): BreedingOperationCommandHash => (
  sha256(parseBreedingOperationCommandV1(value)) as BreedingOperationCommandHash
)
export const areBreedingOperationCommandsSemanticallyEqual = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(parseBreedingOperationCommandV1(left)) === stableJsonStringify(parseBreedingOperationCommandV1(right))
)
export const parseAuthoritativeBreedingOperationResultV1 = (value: unknown, path = 'result'): BreedingOperationResultV1 => {
  const result = parseBreedingOperationResultV1(value, path)
  if (sha256(resultDefinition(result)) !== result.resultDefinitionSha256) throw new BreedingOperationResultConflictError(result.operationId)
  if (result.ok && sha256(receiptDefinition(result)) !== result.receiptDefinitionSha256) throw new BreedingOperationResultConflictError(result.operationId)
  return result
}

export const createBreedingOperationAcceptedV1 = (value: Omit<BreedingOperationAcceptedV1, 'schemaVersion' | 'ok' | 'receiptDefinitionSha256' | 'resultDefinitionSha256'>): BreedingOperationAcceptedV1 => {
  const receiptDefinitionSha256 = sha256(receiptDefinition(value as BreedingOperationAcceptedV1))
  const definition = { schemaVersion: 1 as const, ...value, ok: true as const, receiptDefinitionSha256 }
  return parseAuthoritativeBreedingOperationResultV1({ ...definition, resultDefinitionSha256: sha256(definition) }) as BreedingOperationAcceptedV1
}
const RETRYABLE_REJECTIONS = new Set<BreedingOperationRejectionReasonId>([
  'breeding.operation.stale-revision', 'breeding.operation.conflict', 'breeding.operation.unavailable',
  'breeding.operation.choice-required', 'breeding.operation.adjudication-required', 'breeding.operation.internal-failure',
])
export const createBreedingOperationRejectedV1 = (value: Omit<BreedingOperationRejectedV1, 'schemaVersion' | 'ok' | 'retryable' | 'resultDefinitionSha256'>): BreedingOperationRejectedV1 => {
  const definition = { schemaVersion: 1 as const, ...value, ok: false as const, retryable: RETRYABLE_REJECTIONS.has(value.reasonId) }
  return parseAuthoritativeBreedingOperationResultV1({ ...definition, resultDefinitionSha256: sha256(definition) }) as BreedingOperationRejectedV1
}

export const assertBreedingOperationResultMatchesCommand = (commandValue: unknown, resultValue: unknown): BreedingOperationResultV1 => {
  const command = parseBreedingOperationCommandV1(commandValue)
  const result = parseAuthoritativeBreedingOperationResultV1(resultValue)
  const commandHash = createBreedingOperationCommandHash(command)
  if (result.operationId !== command.operationId || result.commandKind !== command.commandKind || result.commandHash !== commandHash) throw new BreedingOperationResultConflictError(command.operationId)
  const declaredScopes = new Set(command.scopes.map(scope => stableJsonStringify(scope)))
  const resultScopes = result.ok ? result.changedScopes : result.conflictingScopes
  if (resultScopes.some(scope => !declaredScopes.has(stableJsonStringify(scope)))) throw new BreedingOperationResultConflictError(command.operationId)
  return result
}
export const assertBreedingOperationTerminalResultsCompatible = (existingValue: unknown, attemptedValue: unknown): BreedingOperationResultV1 => {
  const existing = parseAuthoritativeBreedingOperationResultV1(existingValue, 'existingResult')
  const attempted = parseAuthoritativeBreedingOperationResultV1(attemptedValue, 'attemptedResult')
  if (stableJsonStringify(existing) !== stableJsonStringify(attempted)) throw new BreedingOperationResultConflictError(existing.operationId)
  return existing
}

/** Decide exact retry versus operation-ID collision before any mechanics or randomness. */
export const decideBreedingOperationReplay = (input: {
  readonly command: unknown
  readonly existing: null | {
    readonly operationId: BreedingOperationId
    readonly commandHash: BreedingOperationCommandHash
    readonly result: unknown
  }
}): BreedingOperationReplayDecisionV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  const commandHash = createBreedingOperationCommandHash(command)
  if (!input.existing) return Object.freeze({ kind: 'execute', command, commandHash })
  if (input.existing.operationId !== command.operationId || input.existing.commandHash !== commandHash) throw new BreedingOperationIdCollisionError({ operationId: command.operationId, existingCommandHash: input.existing.commandHash, attemptedCommandHash: commandHash })
  const result = assertBreedingOperationResultMatchesCommand(command, input.existing.result)
  return Object.freeze({ kind: 'exact-retry', command, commandHash, result })
}

/** Return deterministic overlap evidence for recently accepted campaign operations. */
export const findBreedingScopeConflicts = (input: {
  readonly attemptedScopes: readonly BreedingConflictScopeV1[]
  readonly recentAcceptedOperations: readonly BreedingAcceptedOperationMetadataV1[]
}): readonly BreedingScopeConflictV1[] => {
  const conflicts: BreedingScopeConflictV1[] = []
  for (const attemptedScope of input.attemptedScopes) {
    for (const operation of input.recentAcceptedOperations) {
      for (const conflictingScope of operation.changedScopes) {
        if (breedingScopesConflict(attemptedScope, conflictingScope)) conflicts.push(Object.freeze({ attemptedScope, conflictingScope, conflictingOperationId: operation.operationId }))
      }
    }
  }
  return Object.freeze(conflicts.sort((left, right) => {
    const leftKey = `${breedingConflictScopeKey(left.attemptedScope)}:${left.conflictingOperationId}`
    const rightKey = `${breedingConflictScopeKey(right.attemptedScope)}:${right.conflictingOperationId}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  }))
}

export const breedingOperationResultDefinitionSha256 = (result: BreedingOperationResultV1): string => sha256(resultDefinition(result))
export const breedingOperationReceiptDefinitionSha256 = (value: {
  readonly operationId: BreedingOperationId
  readonly commandHash: BreedingOperationCommandHash
  readonly commandKind: BreedingOperationCommandKind
  readonly outcomeKind: BreedingOperationOutcomeKind
  readonly aggregateRefs: readonly BreedingOperationAggregateRefV1[]
  readonly changedScopes: readonly BreedingConflictScopeV1[]
  readonly committedAtCampaignMinute: number | null
}): string => sha256(receiptDefinition(value))
