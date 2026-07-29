import type { CapabilityActionPublicResult } from './clientCommands'

export const CAPABILITY_ADJUDICATION_SCHEMA_VERSION = 1 as const
export const CAPABILITY_ADJUDICATION_DECISIONS = ['accept', 'reject'] as const
export type CapabilityAdjudicationDecision = typeof CAPABILITY_ADJUDICATION_DECISIONS[number]

export interface ResolveCapabilityAdjudicationCommand {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly requestId: string
  readonly decision: CapabilityAdjudicationDecision
  readonly optionId: string | null
  readonly description: string | null
}

export interface CapabilityAdjudicationResult {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly requestId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly decision: CapabilityAdjudicationDecision
  readonly resolution: CapabilityActionPublicResult | null
}

export class CapabilityAdjudicationValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'CapabilityAdjudicationValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new CapabilityAdjudicationValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, 'has invalid fields.')
}
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/%-]{0,239}$/.test(value)) fail(path, 'must be a stable identifier.')
  return value as string
}
const nullableText = (value: unknown, path: string): string | null => {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be null or bounded trimmed text.')
  return value as string
}

export const parseResolveCapabilityAdjudicationCommand = (value: unknown): ResolveCapabilityAdjudicationCommand => {
  const root = record(value, 'command')
  exact(root, ['schemaVersion', 'operationId', 'mapSlug', 'baseRevision', 'requestId', 'decision', 'optionId', 'description'], 'command')
  if (root.schemaVersion !== 1) fail('command.schemaVersion', 'must be 1.')
  if (!Number.isSafeInteger(root.baseRevision) || (root.baseRevision as number) < 0) fail('command.baseRevision', 'must be a non-negative revision.')
  if (root.decision !== 'accept' && root.decision !== 'reject') fail('command.decision', 'must be accept or reject.')
  const optionId = nullableText(root.optionId, 'command.optionId')
  const description = nullableText(root.description, 'command.description')
  if (root.decision === 'accept' && optionId === null && description === null) fail('command', 'an accepted adjudication requires a retained choice or description.')
  return Object.freeze({
    schemaVersion: 1,
    operationId: id(root.operationId, 'command.operationId'),
    mapSlug: id(root.mapSlug, 'command.mapSlug'),
    baseRevision: root.baseRevision as number,
    requestId: id(root.requestId, 'command.requestId'),
    decision: root.decision as CapabilityAdjudicationDecision,
    optionId,
    description,
  })
}
