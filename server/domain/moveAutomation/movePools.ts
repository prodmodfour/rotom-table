import {
  parseMoveRandomMovePoolDefinition,
  type MoveRandomMovePoolDefinition,
  type MoveRandomMovePoolOwnerKind,
} from '#shared/moveAutomation/randomTables'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  pokemonMoveEntriesForSheet,
  trainerMoveEntriesForSheet,
} from '~/utils/mapTokenMoves'
import type { AuthoritativeMoveRulesContext } from './context'
import type { NestedMoveExecutionBudget } from './nestedExecution'
import {
  resolveMoveRandomCandidates,
  type MoveRandomCandidateResolution,
} from './randomOperations'

export type MovePoolResolutionErrorCode =
  | 'move-pool-owner-missing'
  | 'move-pool-sheet-missing'
  | 'move-pool-empty'

export class MovePoolResolutionError extends Error {
  readonly code: MovePoolResolutionErrorCode

  constructor(code: MovePoolResolutionErrorCode, message: string) {
    super(message)
    this.name = 'MovePoolResolutionError'
    this.code = code
  }
}

export interface AuthoritativeMovePoolList {
  readonly ownerPlacementId: string
  readonly canonicalIds: readonly string[]
}

export interface MaterializeMovePoolCandidatesInput {
  readonly definition: MoveRandomMovePoolDefinition
  readonly authoritativeMoveLists?: readonly AuthoritativeMovePoolList[]
  /** Server canonicalization seam; identity is useful in isolated contract tests. */
  readonly canonicalize?: (canonicalId: string) => string | null
}

export interface ResolveReviewedMovePoolInput extends MaterializeMovePoolCandidatesInput {
  readonly parentEffectId: string
  readonly reasonCode: string
  readonly random: AuthoritativeMoveRulesContext['random']
  readonly isCandidateValid?: (canonicalId: string) => boolean
  readonly budget?: NestedMoveExecutionBudget
}

export interface ResolveAuthoritativeMovePoolInput {
  readonly definition: MoveRandomMovePoolDefinition
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly parentEffectId: string
  readonly reasonCode: string
  readonly budget: NestedMoveExecutionBudget
  readonly isCandidateValid?: (canonicalId: string) => boolean
}

const fail = (code: MovePoolResolutionErrorCode, message: string): never => {
  throw new MovePoolResolutionError(code, message)
}

const canonicalMoveId = (value: string): string | null => {
  const move = findMove(value)
  return move?.name ?? (value.trim() ? value.trim() : null)
}

const unique = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return Object.freeze(result)
}

const canonicalized = (
  values: readonly string[],
  canonicalize: (canonicalId: string) => string | null,
): readonly string[] => unique(values.flatMap((value) => {
  const canonical = canonicalize(value)
  return canonical ? [canonical] : []
}))

/**
 * Materialize the private candidate identities in source order. Allow/deny
 * sets filter the source but never become client-authored mechanics.
 */
export const materializeMovePoolCandidates = (
  input: MaterializeMovePoolCandidatesInput,
): readonly string[] => {
  const definition = parseMoveRandomMovePoolDefinition(input.definition)
  const canonicalize = input.canonicalize ?? (value => value)
  const source = definition.source.kind === 'explicit'
    ? definition.source.canonicalIds
    : (input.authoritativeMoveLists ?? []).flatMap(list => list.canonicalIds)
  const candidates = canonicalized(source, canonicalize)
  const allow = new Set(canonicalized(definition.allowCanonicalIds, canonicalize))
  const deny = new Set(canonicalized(definition.denyCanonicalIds, canonicalize))
  const filtered = candidates.filter(canonicalId => (
    (allow.size === 0 || allow.has(canonicalId)) && !deny.has(canonicalId)
  ))
  return Object.freeze(filtered)
}

const ownerIds = (
  kind: MoveRandomMovePoolOwnerKind,
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
): readonly string[] => {
  const actorId = context.actor.placement.id
  if (kind === 'actor') return Object.freeze([actorId])
  if (kind === 'operation-recipients') return unique(recipientIds)
  return unique([actorId, ...recipientIds])
}

const canonicalMoveListForOwner = (
  context: AuthoritativeMoveRulesContext,
  ownerPlacementId: string,
): AuthoritativeMovePoolList => {
  const placement = context.queries.placements.get(ownerPlacementId)
    ?? fail(
      'move-pool-owner-missing',
      `Authoritative move-pool owner ${ownerPlacementId} is not placed on the map.`,
    )
  const resolved = context.queries.sheets.forPlacement(placement)
    ?? fail(
      'move-pool-sheet-missing',
      `Authoritative move-pool owner ${ownerPlacementId} has no resolved sheet.`,
    )
  context.reads.recordPlacement(placement)
  const entries = resolved.kind === 'pokemon'
    ? pokemonMoveEntriesForSheet(resolved.sheet as CharacterSheet)
    : trainerMoveEntriesForSheet(resolved.sheet as TrainerSheet)
  return Object.freeze({
    ownerPlacementId,
    canonicalIds: Object.freeze(entries.map(entry => (
      canonicalMoveId(entry.move.name) ?? entry.move.name
    ))),
  })
}

/** Load only the reviewed owner set and record every consulted sheet revision. */
export const authoritativeMovePoolLists = (input: {
  readonly definition: MoveRandomMovePoolDefinition
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
}): readonly AuthoritativeMovePoolList[] => {
  const definition = parseMoveRandomMovePoolDefinition(input.definition)
  if (definition.source.kind !== 'authoritative-move-lists') return Object.freeze([])
  return Object.freeze(ownerIds(
    definition.source.owners,
    input.context,
    input.recipientIds,
  ).map(ownerPlacementId => canonicalMoveListForOwner(input.context, ownerPlacementId)))
}

/** Resolve one reviewed explicit or already-loaded authoritative move pool. */
export const resolveReviewedMovePool = (
  input: ResolveReviewedMovePoolInput,
): MoveRandomCandidateResolution<string> => {
  const definition = parseMoveRandomMovePoolDefinition(input.definition)
  const candidates = materializeMovePoolCandidates({
    definition,
    authoritativeMoveLists: input.authoritativeMoveLists,
    canonicalize: input.canonicalize,
  })
  if (candidates.length === 0) {
    return fail('move-pool-empty', `Reviewed move pool ${definition.poolId} has no candidates.`)
  }
  return resolveMoveRandomCandidates({
    selectionId: definition.poolId,
    rollId: definition.rollId,
    parentEffectId: input.parentEffectId,
    reasonCode: input.reasonCode,
    candidates: candidates.map(canonicalId => ({
      id: canonicalId,
      weight: 1,
      value: canonicalId,
    })),
    maximumRerolls: definition.maximumRerolls,
    random: input.random,
    isCandidateValid: input.isCandidateValid
      ? candidate => input.isCandidateValid!(candidate.value)
      : undefined,
    reserveRetry: input.budget
      ? () => input.budget!.reserveRandomRetries(
          1,
          `Random move pool ${definition.poolId}`,
        )
      : undefined,
  })
}

/** Resolve a pool directly from the immutable rules context and private sheets. */
export const resolveAuthoritativeMovePool = (
  input: ResolveAuthoritativeMovePoolInput,
): MoveRandomCandidateResolution<string> => resolveReviewedMovePool({
  definition: input.definition,
  authoritativeMoveLists: authoritativeMovePoolLists(input),
  canonicalize: canonicalMoveId,
  parentEffectId: input.parentEffectId,
  reasonCode: input.reasonCode,
  random: input.context.random,
  isCandidateValid: input.isCandidateValid,
  budget: input.budget,
})
