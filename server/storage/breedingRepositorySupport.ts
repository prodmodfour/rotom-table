import { stableJsonStringify } from '#shared/automation/stableJson'

export const BREEDING_REPOSITORY_PAGE_SIZE_MAXIMUM = 100 as const

export class BreedingRepositoryCorruptionError extends Error {
  readonly table: string
  readonly identity: string
  readonly field: string
  constructor(table: string, identity: string, field: string) {
    super(`Stored ${table} row ${identity} has invalid ${field}.`)
    this.name = 'BreedingRepositoryCorruptionError'
    this.table = table
    this.identity = identity
    this.field = field
  }
}

export class BreedingRepositoryIdentityCollisionError extends Error {
  readonly aggregateKind: string
  readonly identity: string
  constructor(aggregateKind: string, identity: string) {
    super(`${aggregateKind} identity ${identity} is already bound to a different durable record.`)
    this.name = 'BreedingRepositoryIdentityCollisionError'
    this.aggregateKind = aggregateKind
    this.identity = identity
  }
}

export type BreedingRepositoryReplaceResult<Document> =
  | { readonly kind: 'applied', readonly document: Document }
  | { readonly kind: 'missing', readonly expectedRevision: number, readonly currentRevision: null }
  | { readonly kind: 'stale', readonly expectedRevision: number, readonly currentRevision: number }

export const parseBreedingRepositoryRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647) {
    throw new Error(`${label} must be a safe revision from 0 through 2147483647.`)
  }
  return Number(value)
}

export const parseBreedingRepositoryCampaignMinute = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a nonnegative safe campaign minute.`)
  return Number(value)
}

export const parseBreedingRepositoryLimit = (value: unknown = BREEDING_REPOSITORY_PAGE_SIZE_MAXIMUM): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > BREEDING_REPOSITORY_PAGE_SIZE_MAXIMUM) {
    throw new Error(`Breeding repository limit must be a safe integer from 1 through ${BREEDING_REPOSITORY_PAGE_SIZE_MAXIMUM}.`)
  }
  return Number(value)
}

export const parseStrictStoredBreedingJson = <Document>(input: {
  readonly table: string
  readonly identity: string
  readonly json: unknown
  readonly parse: (value: unknown, path?: string) => Document
}): Document => {
  if (typeof input.json !== 'string') throw new BreedingRepositoryCorruptionError(input.table, input.identity, 'JSON text')
  let decoded: unknown
  try { decoded = JSON.parse(input.json) }
  catch { throw new BreedingRepositoryCorruptionError(input.table, input.identity, 'JSON syntax') }
  let document: Document
  try { document = input.parse(decoded, `${input.table}.${input.identity}`) }
  catch { throw new BreedingRepositoryCorruptionError(input.table, input.identity, 'strict document contract') }
  if (stableJsonStringify(document) !== input.json) throw new BreedingRepositoryCorruptionError(input.table, input.identity, 'canonical stable JSON')
  return document
}

export const assertBreedingStoredColumn = (
  condition: boolean,
  table: string,
  identity: string,
  field: string,
): void => {
  if (!condition) throw new BreedingRepositoryCorruptionError(table, identity, field)
}

export const exactBreedingDocumentReplay = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(left) === stableJsonStringify(right)
)
