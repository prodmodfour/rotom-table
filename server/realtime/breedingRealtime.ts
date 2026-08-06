import { createHash } from 'node:crypto'
import {
  parseBreedingProjectIdSyntax,
  parsePokemonEggIdSyntax,
} from '#shared/breeding/ids'
import {
  BREEDING_OPERATION_COMMAND_KINDS,
  type BreedingOperationCommandKind,
} from '#shared/breeding/operations'
import type {
  BreedingPresentationProjectionV1,
  BreedingProjectionAggregateKind,
} from '#shared/breeding/projections'
import {
  BREEDING_REALTIME_EVENT_TYPE,
  BREEDING_REALTIME_SCHEMA_VERSION,
  BREEDING_REALTIME_SNAPSHOT_ENTRY_MAXIMUM,
  breedingRealtimeChannel,
  parseBreedingRealtimeRefreshDataV1,
  parseBreedingRealtimeRefreshEventV1,
  parseBreedingRealtimeSnapshotV1,
  type BreedingRealtimeSnapshotEntryV1,
  type BreedingRealtimeSnapshotV1,
} from '#shared/breeding/realtime'
import {
  parseBreedingRealtimeEventAccess,
  type BreedingRealtimeAudienceScope,
  type BreedingRealtimeEventAccess,
} from '#shared/breeding/realtimeAccess'
import {
  createRealtimeEventMaterial,
  parseRealtimeEventTimestamp,
  stringifyCanonicalRealtimeJson,
} from '#shared/realtimeEventLog'
import {
  breedingProjectionAggregateIdentitySha256,
  parseAuthoritativeBreedingPresentationProjectionV1,
} from '../domain/breeding/projections'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'

export type BreedingRealtimeAudienceTarget =
  | {
      readonly audience: 'diagnostic' | 'gm' | 'public'
      readonly trainerSheetSlug: null
    }
  | {
      readonly audience: 'owner' | 'participating-owner'
      readonly trainerSheetSlug: string
    }

export interface BreedingRealtimeRefreshAppendInput {
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly aggregateId: string
  readonly revision: number
  readonly operationKind: BreedingOperationCommandKind
  readonly audienceTargets: readonly BreedingRealtimeAudienceTarget[]
  readonly campaignProjectionKey: Buffer | string
  readonly timestamp: number
}

export interface BreedingRealtimeSnapshotSourceEntry {
  readonly aggregateId: string
  readonly revision: number
  readonly projection: BreedingPresentationProjectionV1
}

export interface BuildBreedingRealtimeSnapshotInput {
  readonly audience: BreedingRealtimeAudienceScope
  readonly throughSequence: number
  readonly entries: readonly BreedingRealtimeSnapshotSourceEntry[]
  readonly campaignProjectionKey: Buffer | string
}

const OPERATION_KIND_SET = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)

const parseAggregateId = (
  kind: BreedingProjectionAggregateKind,
  value: unknown,
  label: string,
): string => {
  const parsed = kind === 'breeding-project'
    ? parseBreedingProjectIdSyntax(value)
    : parsePokemonEggIdSyntax(value)
  if (!parsed) throw new Error(`${label} must match ${kind} canonical identity syntax.`)
  return parsed
}

const parseRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647) {
    throw new Error(`${label} must be a revision from 0 through 2147483647.`)
  }
  return Number(value)
}

const parseOperationKind = (value: unknown): BreedingOperationCommandKind => {
  if (typeof value !== 'string' || !OPERATION_KIND_SET.has(value)) {
    throw new Error('operationKind must be a closed breeding operation kind.')
  }
  return value as BreedingOperationCommandKind
}

const accessForTarget = (target: BreedingRealtimeAudienceTarget): BreedingRealtimeEventAccess => (
  parseBreedingRealtimeEventAccess({
    kind: 'breeding-access',
    audience: target.audience,
    trainerSheetSlug: target.trainerSheetSlug,
  })
)

const targetDigest = (access: BreedingRealtimeEventAccess): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(access, 'breeding realtime target'))
  .digest('hex')

const dedupeKey = (input: {
  readonly aggregateIdentitySha256: string
  readonly revision: number
  readonly access: BreedingRealtimeEventAccess
}): string => [
  'breeding-refresh',
  'v1',
  input.aggregateIdentitySha256,
  String(input.revision),
  input.access.audience,
  targetDigest(input.access),
].join(':')

/**
 * Produces strict refresh-only rows for insertion in the caller's aggregate
 * transaction. No event is published here; BR-037's coordinator owns commit,
 * and persisted publication occurs only after that commit returns.
 */
export const breedingRealtimeRefreshAppendInputs = (
  input: BreedingRealtimeRefreshAppendInput,
): readonly AppendRealtimeEventInput[] => {
  if (input.aggregateKind !== 'breeding-project' && input.aggregateKind !== 'pokemon-egg') {
    throw new Error('aggregateKind must be breeding-project or pokemon-egg.')
  }
  const aggregateId = parseAggregateId(input.aggregateKind, input.aggregateId, 'aggregateId')
  const revision = parseRevision(input.revision, 'revision')
  const operationKind = parseOperationKind(input.operationKind)
  const timestamp = parseRealtimeEventTimestamp(input.timestamp, 'breeding realtime timestamp')
  if (!Array.isArray(input.audienceTargets)
    || input.audienceTargets.length < 1
    || input.audienceTargets.length > 7) {
    throw new Error('audienceTargets must contain from 1 through 7 bounded targets.')
  }

  const aggregateIdentitySha256 = breedingProjectionAggregateIdentitySha256(
    input.campaignProjectionKey,
    input.aggregateKind,
    aggregateId,
  )
  const accesses = input.audienceTargets.map(accessForTarget)
  if (input.aggregateKind === 'pokemon-egg'
    && accesses.some(access => access.audience === 'participating-owner')) {
    throw new Error('Pokémon Eggs have no participating-owner realtime audience.')
  }
  const accessKeys = accesses.map(access => stringifyCanonicalRealtimeJson(access))
  if (new Set(accessKeys).size !== accessKeys.length) {
    throw new Error('audienceTargets must not contain duplicate access descriptors.')
  }

  const rows = accesses.map((access): AppendRealtimeEventInput => {
    const data = parseBreedingRealtimeRefreshDataV1({
      schemaVersion: BREEDING_REALTIME_SCHEMA_VERSION,
      aggregateKind: input.aggregateKind,
      aggregateIdentitySha256,
      revision,
      operationKind,
      audienceRefreshScope: access.audience,
    })
    const event = {
      channel: breedingRealtimeChannel(access.audience),
      type: BREEDING_REALTIME_EVENT_TYPE,
      data,
    } as const
    // Validate the complete sequenced shape and the breeding-specific 4 KiB
    // bound before the generic repository assigns its real global sequence.
    parseBreedingRealtimeRefreshEventV1({ ...event, sequence: 0, timestamp })
    const key = dedupeKey({ aggregateIdentitySha256, revision, access })
    const material = createRealtimeEventMaterial({ event, access, dedupeKey: key })
    return Object.freeze({
      event: material.event,
      access: material.access,
      dedupeKey: material.dedupeKey,
      timestamp,
    })
  })
  return Object.freeze(rows)
}

const projectionAggregateIdentity = (
  projection: BreedingPresentationProjectionV1,
): { readonly aggregateKind: BreedingProjectionAggregateKind, readonly aggregateId: string | null, readonly revision: number | null } => {
  if (projection.audience === 'public') {
    return { aggregateKind: projection.aggregateKind, aggregateId: null, revision: null }
  }
  if (projection.audience === 'diagnostic') {
    return { aggregateKind: projection.aggregateKind, aggregateId: null, revision: projection.revision }
  }
  if (projection.audience === 'gm') {
    return {
      aggregateKind: projection.aggregateKind,
      aggregateId: projection.aggregateKind === 'breeding-project'
        ? projection.document.projectId
        : projection.document.eggId,
      revision: projection.document.revision,
    }
  }
  return {
    aggregateKind: projection.aggregateKind,
    aggregateId: projection.aggregateKind === 'breeding-project'
      ? projection.projectId
      : projection.eggId,
    revision: projection.revision,
  }
}

/** Builds one complete, audience-homogeneous replacement snapshot. */
export const buildBreedingRealtimeSnapshotV1 = (
  input: BuildBreedingRealtimeSnapshotInput,
): BreedingRealtimeSnapshotV1 => {
  if (!Array.isArray(input.entries) || input.entries.length > BREEDING_REALTIME_SNAPSHOT_ENTRY_MAXIMUM) {
    throw new Error(`entries must contain at most ${BREEDING_REALTIME_SNAPSHOT_ENTRY_MAXIMUM} projections.`)
  }
  const entries = input.entries.map((source, index): BreedingRealtimeSnapshotEntryV1 => {
    const projection = parseAuthoritativeBreedingPresentationProjectionV1(
      source.projection,
      `entries[${index}].projection`,
    )
    if (projection.audience !== input.audience) {
      throw new Error(`entries[${index}].projection audience must match snapshot audience.`)
    }
    const metadata = projectionAggregateIdentity(projection)
    const aggregateId = parseAggregateId(
      metadata.aggregateKind,
      source.aggregateId,
      `entries[${index}].aggregateId`,
    )
    if (metadata.aggregateId !== null && metadata.aggregateId !== aggregateId) {
      throw new Error(`entries[${index}].aggregateId must match its private projection identity.`)
    }
    const aggregateIdentitySha256 = breedingProjectionAggregateIdentitySha256(
      input.campaignProjectionKey,
      metadata.aggregateKind,
      aggregateId,
    )
    if ((projection.audience === 'public' || projection.audience === 'diagnostic')
      && projection.aggregateIdentitySha256 !== aggregateIdentitySha256) {
      throw new Error(`entries[${index}] aggregate identity hash must match its keyed projection identity.`)
    }
    const revision = parseRevision(source.revision, `entries[${index}].revision`)
    if (metadata.revision !== null && metadata.revision !== revision) {
      throw new Error(`entries[${index}].revision must match its private projection revision.`)
    }
    return Object.freeze({
      aggregateKind: metadata.aggregateKind,
      aggregateIdentitySha256,
      revision,
      projection,
    })
  }).sort((left, right) => left.aggregateIdentitySha256.localeCompare(right.aggregateIdentitySha256))

  return parseBreedingRealtimeSnapshotV1({
    schemaVersion: BREEDING_REALTIME_SCHEMA_VERSION,
    audience: input.audience,
    throughSequence: input.throughSequence,
    entries,
  })
}
