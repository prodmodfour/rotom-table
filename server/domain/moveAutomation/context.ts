import { normalizeRevision } from '#shared/sessionRevisions'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  MOVE_RULESET_PROVENANCE,
  type MoveRulesetProvenance,
} from '#shared/moveAutomation/ruleset'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  resolveCanonicalMoveEntryForPlacement,
  type CanonicalMoveEntryResult,
} from '~/utils/authoritativeMoveEntries'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
} from '~/utils/move-automation/registry'
import {
  findMoveAutomationSemanticStatus,
  type MoveAutomationSemanticStatus,
} from '~/utils/moveAutomationSemanticStatus'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  type MoveAutomationRuntimeRegistry,
  type RegisteredMoveAutomationRuntime,
} from './registry'
import {
  createAuthoritativeMoveRandom,
  type AuthoritativeMoveRandom,
  type AuthoritativeMoveRandomSource,
} from './random'
import {
  ally,
  enemy,
  sameSide,
  self,
  type MoveAutomationRelationshipParticipant,
} from './relationships'

export interface AuthoritativeMoveSheetRead {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface AuthoritativeMoveResolvedSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly sheet: CharacterSheet | TrainerSheet
}

export interface AuthoritativeMoveRulesActor {
  readonly placement: SheetPlacement
  readonly token: SpawnedPokemon
  readonly sheet: AuthoritativeMoveResolvedSheet
}

export interface AuthoritativeMovePlacementQueries {
  get(placementId: string): SheetPlacement | null
  all(): readonly SheetPlacement[]
  candidates(): readonly SheetPlacement[]
  selected(): readonly SheetPlacement[]
}

export interface AuthoritativeMoveTokenQueries {
  get(placementId: string): SpawnedPokemon | null
  all(): readonly SpawnedPokemon[]
}

export interface AuthoritativeMoveSheetQueries {
  get(kind: SheetKind, slug: string): AuthoritativeMoveResolvedSheet | null
  forPlacement(
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ): AuthoritativeMoveResolvedSheet | null
}

export interface AuthoritativeMoveRelationshipQueries {
  self(
    participant: MoveAutomationRelationshipParticipant,
    other: MoveAutomationRelationshipParticipant,
  ): boolean
  sameSide(
    participant: MoveAutomationRelationshipParticipant,
    other: MoveAutomationRelationshipParticipant,
  ): boolean
  ally(
    participant: MoveAutomationRelationshipParticipant,
    other: MoveAutomationRelationshipParticipant,
  ): boolean
  enemy(
    participant: MoveAutomationRelationshipParticipant,
    other: MoveAutomationRelationshipParticipant,
  ): boolean
}

export interface AuthoritativeMoveRuleQueries {
  runtimeFor(canonicalId: string): RegisteredMoveAutomationRuntime | null
  legacyScriptFor(moveName: string): MoveAutomationScript | null
  semanticStatusFor(moveName: string): MoveAutomationSemanticStatus | null
}

export interface AuthoritativeMoveContextQueries {
  readonly placements: AuthoritativeMovePlacementQueries
  readonly tokens: AuthoritativeMoveTokenQueries
  readonly sheets: AuthoritativeMoveSheetQueries
  readonly relationships: AuthoritativeMoveRelationshipQueries
  readonly rules: AuthoritativeMoveRuleQueries
  resolveActorMoveEntry(moveName: string): CanonicalMoveEntryResult
}

export interface AuthoritativeMoveReadSet {
  recordSheet(read: AuthoritativeMoveSheetRead): void
  recordPlacement(placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>): void
  recordToken(token: Pick<SpawnedPokemon, 'id'>): void
  snapshot(): readonly AuthoritativeMoveSheetRead[]
}

/**
 * One detached, server-owned snapshot consumed by pure move rules.
 *
 * Every JSON value reachable from this object is recursively frozen. Maps used
 * for lookup and the mutable read-set accumulator remain private behind frozen
 * query interfaces, so rule code cannot alter the authoritative snapshot.
 */
export interface AuthoritativeMoveRulesContext {
  readonly map: TabletopMap
  readonly intent: ResolveMoveIntent
  readonly actor: AuthoritativeMoveRulesActor
  readonly candidatePlacements: readonly SheetPlacement[]
  readonly selectedPlacements: readonly SheetPlacement[]
  readonly resolvedSheets: readonly AuthoritativeMoveResolvedSheet[]
  readonly ruleset: MoveRulesetProvenance
  /** Server-owned bounded random requests and their immutable resolution ledger. */
  readonly random: AuthoritativeMoveRandom
  /** One captured server time for the whole pure resolution. */
  readonly time: number
  /** Server-injected ID source; the default derives IDs from snapshot identity, captured time, and sequence. */
  readonly idFactory: () => string
  readonly queries: AuthoritativeMoveContextQueries
  readonly reads: AuthoritativeMoveReadSet
}

export type AuthoritativeMoveRulesContextErrorCode =
  | 'duplicate-placement-id'
  | 'actor-placement-missing'
  | 'actor-sheet-missing'
  | 'actor-token-unresolved'
  | 'duplicate-candidate-id'
  | 'duplicate-selected-id'
  | 'sheet-read-revision-conflict'

export class AuthoritativeMoveRulesContextError extends Error {
  readonly code: AuthoritativeMoveRulesContextErrorCode

  constructor(code: AuthoritativeMoveRulesContextErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeMoveRulesContextError'
    this.code = code
  }
}

export interface BuildAuthoritativeMoveRulesContextInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  /** Defaults to every authoritative placement, in map order. */
  readonly candidatePlacementIds?: readonly string[]
  /** Requested placement identities; final legal recipients remain server-derived. */
  readonly selectedPlacementIds?: readonly string[]
  readonly random: AuthoritativeMoveRandomSource
  readonly time: number
  readonly idFactory?: () => string
  readonly ruleset?: MoveRulesetProvenance
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  /** Test/migration seam. Values are snapshotted before any rule executes. */
  readonly legacyScripts?: ReadonlyMap<string, MoveAutomationScript>
}

const fail = (
  code: AuthoritativeMoveRulesContextErrorCode,
  message: string,
): never => {
  throw new AuthoritativeMoveRulesContextError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const detachedFrozenJson = <Value>(value: Value): Value => deepFreeze(deepCloneJson(value))

const normalizedMoveName = (value: string): string => value.trim().toLowerCase()

const sheetReadKey = (read: Pick<AuthoritativeMoveSheetRead, 'kind' | 'slug'>): string =>
  `${read.kind}:${read.slug}`

export const deduplicateAuthoritativeMoveSheetReads = (
  reads: readonly AuthoritativeMoveSheetRead[],
): AuthoritativeMoveSheetRead[] => {
  const deduplicated: AuthoritativeMoveSheetRead[] = []
  const byRef = new Map<string, AuthoritativeMoveSheetRead>()
  for (const read of reads) {
    const normalized = {
      kind: read.kind,
      slug: read.slug,
      revision: normalizeRevision(read.revision),
    }
    const key = sheetReadKey(normalized)
    const existing = byRef.get(key)
    if (existing) {
      if (existing.revision !== normalized.revision) {
        fail(
          'sheet-read-revision-conflict',
          `Sheet ${normalized.kind}/${normalized.slug} was observed at conflicting revisions ${existing.revision} and ${normalized.revision}.`,
        )
      }
      continue
    }
    byRef.set(key, normalized)
    deduplicated.push(normalized)
  }
  return deduplicated
}

const uniquePlacementIds = (
  ids: readonly string[],
  duplicateCode: Extract<
    AuthoritativeMoveRulesContextErrorCode,
    'duplicate-candidate-id' | 'duplicate-selected-id'
  >,
  label: string,
): readonly string[] => {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) fail(duplicateCode, `${label} placement ${id} was listed more than once.`)
    seen.add(id)
  }
  return ids
}

const resolvedSheetSnapshots = (
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): {
  readonly sheets: readonly AuthoritativeMoveResolvedSheet[]
  readonly lookup: SheetLookup
  readonly byRef: ReadonlyMap<string, AuthoritativeMoveResolvedSheet>
} => {
  const sheets: AuthoritativeMoveResolvedSheet[] = []
  const lookup: SheetLookup = { pokemon: new Map(), trainer: new Map() }
  const byRef = new Map<string, AuthoritativeMoveResolvedSheet>()

  const add = (
    kind: SheetKind,
    slug: string,
    source: CharacterSheet | TrainerSheet,
  ): void => {
    const sheet = detachedFrozenJson(source)
    const resolved = deepFreeze({
      kind,
      slug,
      revision: normalizeRevision(sheet.revision),
      sheet,
    }) as AuthoritativeMoveResolvedSheet
    sheets.push(resolved)
    byRef.set(sheetReadKey(resolved), resolved)
    if (kind === 'pokemon') lookup.pokemon.set(slug, sheet as CharacterSheet)
    else lookup.trainer.set(slug, sheet as TrainerSheet)
  }

  for (const [slug, sheet] of pokemonSheets) add('pokemon', slug, sheet)
  for (const [slug, sheet] of trainerSheets) add('trainer', slug, sheet)

  return {
    sheets: deepFreeze(sheets),
    lookup,
    byRef,
  }
}

const placementSnapshots = (map: TabletopMap): {
  readonly placements: readonly SheetPlacement[]
  readonly byId: ReadonlyMap<string, SheetPlacement>
} => {
  const placements = map.placements
  const byId = new Map<string, SheetPlacement>()
  for (const placement of placements) {
    if (byId.has(placement.id)) {
      fail(
        'duplicate-placement-id',
        `Duplicate placement id ${placement.id} exists on the authoritative map.`,
      )
    }
    byId.set(placement.id, placement)
  }
  return { placements, byId }
}

const placementList = (
  ids: readonly string[],
  placementById: ReadonlyMap<string, SheetPlacement>,
): readonly SheetPlacement[] => deepFreeze(
  ids.flatMap((id) => {
    const placement = placementById.get(id)
    return placement ? [placement] : []
  }),
)

const tokenSnapshots = (
  map: TabletopMap,
  placements: readonly SheetPlacement[],
  sheets: SheetLookup,
): {
  readonly tokens: readonly SpawnedPokemon[]
  readonly byId: ReadonlyMap<string, SpawnedPokemon>
} => {
  const tokens: SpawnedPokemon[] = []
  const byId = new Map<string, SpawnedPokemon>()
  for (const placement of placements) {
    const token = placementToSpawned(placement, sheets, map)
    if (!token) continue
    const snapshot = detachedFrozenJson(token)
    tokens.push(snapshot)
    byId.set(snapshot.id, snapshot)
  }
  return { tokens: deepFreeze(tokens), byId }
}

const runtimeSnapshots = (
  registry: MoveAutomationRuntimeRegistry,
  legacyScripts: ReadonlyMap<string, MoveAutomationScript>,
): ReadonlyMap<string, RegisteredMoveAutomationRuntime> => {
  const runtimes = new Map<string, RegisteredMoveAutomationRuntime>()
  for (const source of registry.entries()) {
    const runtime = detachedFrozenJson(source)
    if (runtime.kind === 'legacy-v1') {
      const snapshottedScript = legacyScripts.get(runtime.canonicalId)
      runtimes.set(runtime.canonicalId, detachedFrozenJson({
        ...runtime,
        script: snapshottedScript ?? runtime.script,
      }))
    }
    else {
      runtimes.set(runtime.canonicalId, runtime)
    }
  }
  return runtimes
}

const legacyScriptSnapshots = (
  scripts: ReadonlyMap<string, MoveAutomationScript>,
): ReadonlyMap<string, MoveAutomationScript> => {
  const snapshots = new Map<string, MoveAutomationScript>()
  for (const [canonicalId, script] of scripts) {
    const snapshot = detachedFrozenJson(script)
    snapshots.set(canonicalId, snapshot)
    snapshots.set(normalizedMoveName(canonicalId), snapshot)
  }
  return snapshots
}

const semanticStatusSnapshots = (
  moveNames: Iterable<string>,
): ReadonlyMap<string, MoveAutomationSemanticStatus> => {
  const snapshots = new Map<string, MoveAutomationSemanticStatus>()
  for (const moveName of moveNames) {
    const normalized = normalizedMoveName(moveName)
    if (!normalized || snapshots.has(normalized)) continue
    const status = findMoveAutomationSemanticStatus(moveName)
    if (!status) continue
    const snapshot = detachedFrozenJson(status)
    snapshots.set(normalized, snapshot)
    if (snapshot.canonicalId) snapshots.set(normalizedMoveName(snapshot.canonicalId), snapshot)
  }
  return snapshots
}

const stableIdNamespaceHash = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const createDefaultIdFactory = (time: number, namespace: string): (() => string) => {
  let sequence = 0
  const namespaceHash = stableIdNamespaceHash(namespace)
  return () => {
    sequence += 1
    return `move-resolution-${Math.floor(time)}-${namespaceHash}-${sequence}`
  }
}

/** Build and recursively freeze the complete rules snapshot before mechanics run. */
export const buildAuthoritativeMoveRulesContext = (
  input: BuildAuthoritativeMoveRulesContextInput,
): AuthoritativeMoveRulesContext => {
  const map = detachedFrozenJson(input.map)
  const intent = detachedFrozenJson(input.intent)
  const { sheets: resolvedSheets, lookup: sheetLookup, byRef: sheetByRef } = resolvedSheetSnapshots(
    input.pokemonSheets,
    input.trainerSheets,
  )
  const { placements, byId: placementById } = placementSnapshots(map)
  const { tokens, byId: tokenById } = tokenSnapshots(map, placements, sheetLookup)

  const actorPlacement = placementById.get(intent.placementId)
    ?? fail('actor-placement-missing', `Actor placement ${intent.placementId} was not found.`)
  const actorSheet = sheetByRef.get(sheetReadKey({
    kind: actorPlacement.sheetKind,
    slug: actorPlacement.sheetSlug,
  })) ?? fail(
    'actor-sheet-missing',
    `Actor sheet ${actorPlacement.sheetKind}/${actorPlacement.sheetSlug} for placement ${actorPlacement.id} was not found.`,
  )
  const actorToken = tokenById.get(actorPlacement.id)
    ?? fail(
      'actor-token-unresolved',
      `Actor placement ${actorPlacement.id} could not resolve to a spawned token.`,
    )

  const candidateIds = uniquePlacementIds(
    input.candidatePlacementIds ?? placements.map(({ id }) => id),
    'duplicate-candidate-id',
    'Candidate',
  )
  const selectedIds = uniquePlacementIds(
    input.selectedPlacementIds ?? [],
    'duplicate-selected-id',
    'Selected',
  )
  const candidatePlacements = placementList(candidateIds, placementById)
  const selectedPlacements = placementList(selectedIds, placementById)

  const legacyScripts = legacyScriptSnapshots(input.legacyScripts ?? EXPLICIT_MOVE_AUTOMATION_SCRIPTS)
  const runtimes = runtimeSnapshots(
    input.runtimeRegistry ?? MOVE_AUTOMATION_RUNTIME_REGISTRY,
    legacyScripts,
  )
  const semanticStatuses = semanticStatusSnapshots([
    intent.moveName,
    ...legacyScripts.keys(),
    ...runtimes.keys(),
  ])
  const ruleset = detachedFrozenJson(input.ruleset ?? MOVE_RULESET_PROVENANCE)
  const random = createAuthoritativeMoveRandom(input.random)
  const reads: AuthoritativeMoveSheetRead[] = []

  const sheetForPlacement = (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ): AuthoritativeMoveResolvedSheet | null => sheetByRef.get(sheetReadKey({
    kind: placement.sheetKind,
    slug: placement.sheetSlug,
  })) ?? null

  const readSet: AuthoritativeMoveReadSet = Object.freeze({
    recordSheet: (read: AuthoritativeMoveSheetRead): void => {
      reads.push({
        kind: read.kind,
        slug: read.slug,
        revision: normalizeRevision(read.revision),
      })
    },
    recordPlacement: (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>): void => {
      const sheet = sheetForPlacement(placement)
      if (sheet) reads.push({ kind: sheet.kind, slug: sheet.slug, revision: sheet.revision })
    },
    recordToken: (token: Pick<SpawnedPokemon, 'id'>): void => {
      const placement = placementById.get(token.id)
      if (!placement) return
      const sheet = sheetForPlacement(placement)
      if (sheet) reads.push({ kind: sheet.kind, slug: sheet.slug, revision: sheet.revision })
    },
    snapshot: (): readonly AuthoritativeMoveSheetRead[] => detachedFrozenJson(
      deduplicateAuthoritativeMoveSheetReads(reads),
    ),
  })

  const legacyScriptFor = (moveName: string): MoveAutomationScript | null => {
    const script = legacyScripts.get(moveName)
      ?? legacyScripts.get(normalizedMoveName(moveName))
      ?? null
    if (!script) return null

    const selectedRuntime = runtimes.get(script.moveName)
    if (!selectedRuntime) return script
    return selectedRuntime.kind === 'legacy-v1' ? selectedRuntime.script : null
  }

  /**
   * Move-entry projection is separate from runtime selection. Native specs still
   * need structured canonical range, frequency, accuracy, and damage data, but
   * must not execute the retained v1 implementation selected only for rollback.
   */
  const actorMoveScriptFor = (moveName: string): MoveAutomationScript | null => {
    const canonicalMove = findMove(moveName)
    const selectedRuntime = canonicalMove ? runtimes.get(canonicalMove.name) : null
    if (canonicalMove && selectedRuntime?.kind === 'movespec-v2') {
      return detachedFrozenJson(createMoveAutomationScriptFromMoveData(canonicalMove))
    }
    return legacyScriptFor(moveName)
  }

  const queries: AuthoritativeMoveContextQueries = Object.freeze({
    placements: Object.freeze({
      get: (placementId: string) => placementById.get(placementId) ?? null,
      all: () => placements,
      candidates: () => candidatePlacements,
      selected: () => selectedPlacements,
    }),
    tokens: Object.freeze({
      get: (placementId: string) => tokenById.get(placementId) ?? null,
      all: () => tokens,
    }),
    sheets: Object.freeze({
      get: (kind: SheetKind, slug: string) => sheetByRef.get(sheetReadKey({ kind, slug })) ?? null,
      forPlacement: sheetForPlacement,
    }),
    relationships: Object.freeze({ self, sameSide, ally, enemy }),
    rules: Object.freeze({
      runtimeFor: (canonicalId: string) => runtimes.get(canonicalId) ?? null,
      legacyScriptFor,
      semanticStatusFor: (moveName: string) => semanticStatuses.get(normalizedMoveName(moveName)) ?? null,
    }),
    resolveActorMoveEntry: (moveName: string): CanonicalMoveEntryResult => detachedFrozenJson(
      resolveCanonicalMoveEntryForPlacement({
        placement: actorPlacement,
        token: actorToken,
        sheets: sheetLookup,
        moveName,
        scriptForMove: actorMoveScriptFor,
        usageContext: {
          mapMoveUsage: map.moveUsage,
          sheetMoveUsage: actorSheet.sheet.moveUsage,
          activeScene: map.activeScene ?? null,
          currentRound: map.initiative?.round ?? null,
        },
      }),
    ),
  })

  const context: AuthoritativeMoveRulesContext = {
    map,
    intent,
    actor: deepFreeze({ placement: actorPlacement, token: actorToken, sheet: actorSheet }),
    candidatePlacements,
    selectedPlacements,
    resolvedSheets,
    ruleset,
    random,
    time: input.time,
    idFactory: input.idFactory ?? createDefaultIdFactory(
      input.time,
      `${map.slug}:${map.revision ?? 0}:${intent.placementId}:${intent.moveName}`,
    ),
    queries,
    reads: readSet,
  }
  return Object.freeze(context)
}
