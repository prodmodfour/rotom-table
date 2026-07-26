import { normalizeRevision } from '#shared/sessionRevisions'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { MoveResolutionTraceAncestryEntry } from '#shared/moveAutomation/trace'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { createEmptyEncounterTurnResources } from '#shared/moveAutomation/encounterResources'
import {
  MOVE_RULESET_PROVENANCE,
  type MoveRulesetProvenance,
} from '#shared/moveAutomation/ruleset'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import { AA070_FLUTTER_NO_FLANK_CAPABILITY } from '#shared/abilityAutomation/aa070'
import { aa079HasMimitreeRearm } from '#shared/abilityAutomation/aa079'
import {
  aa080EntityIsActive,
  aa080IsDefensiveAbility,
  aa080IsDreepyEntity,
  aa080IsMiniNoseEntity,
} from '#shared/abilityAutomation/aa080'
import {
  AA071_FOREST_LORD_ORIGIN_CAPABILITY,
  isAa071FullyGrownTreeCell,
} from '#shared/abilityAutomation/aa071'
import { aa071ForecastTypeResolution } from '../abilityAutomation/mechanics/aa071StaticIntegration'
import { aa074AdjustedToken } from '../abilityAutomation/mechanics/aa074StaticIntegration'
import { aa075IceFaceFormToken } from '../abilityAutomation/mechanics/aa075StaticIntegration'
import { aa077AdjustedToken } from '../abilityAutomation/mechanics/aa077StaticIntegration'
import { aa078MovePresentationScript } from '../abilityAutomation/mechanics/aa078StaticIntegration'
import type { GridAnchor, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
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
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { moveAutomationScriptForTargetBranch } from '~/utils/moveAutomationTargetBranches'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import type { RegisteredMoveHandlerRegistry } from './handlers/registry'
import {
  createMoveAutomationBarriersAndSmokeResolver,
  type MoveAutomationBarriersAndSmokeResolver,
} from './barriersAndSmoke'
import {
  createMoveAutomationGravityResolver,
  type MoveAutomationGravityResolver,
} from './gravity'
import {
  createMoveAutomationFlankingResolver,
  type MoveAutomationFlankingResolver,
} from './flanking'
import {
  createMoveAutomationCreatureRuleResolver,
  type MoveAutomationCreatureRuleResolver,
} from './creatureRules'
import {
  createMoveAutomationHistoryResolver,
  type MoveAutomationHistoryResolver,
} from './history'
import {
  createMoveAutomationItemEffectResolver,
  type MoveAutomationItemEffectResolver,
} from './itemEffects'
import {
  createMoveAutomationItemRuleResolver,
  type MoveAutomationItemRuleResolver,
} from './itemRules'
import {
  createAuthoritativeMoveItemResourceQueries,
  emptyAuthoritativeMoveItemResources,
  type AuthoritativeMoveItemResourceQueries,
  type AuthoritativeMoveItemResources,
} from './itemResources'
import {
  createMoveAutomationLineOfSightResolver,
  type MoveAutomationLineOfSightResolver,
} from './lineOfSight'
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
  createMoveAutomationRelationshipResolver,
  type MoveAutomationRelationshipResolver,
} from './relationships'
import {
  createMoveAutomationRemainingGlobalFieldResolver,
  type MoveAutomationRemainingGlobalFieldResolver,
} from './remainingGlobalFields'
import {
  createMoveAutomationResourceResolver,
  type MoveAutomationResourceResolver,
} from './resources'
import {
  createMoveAutomationRoomResolver,
  type MoveAutomationRoomResolver,
} from './rooms'
import {
  createMoveSemiInvulnerableTargetabilityResolver,
  type MoveSemiInvulnerableTargetabilityResolver,
} from './semiInvulnerableTargetability'
import {
  createMoveAutomationStatResolver,
  type MoveAutomationStatResolver,
} from './stats'
import {
  createSideDamageResistanceResolver,
  type SideDamageResistanceResolver,
} from './sideDamageResistance'
import {
  createMoveAutomationTargetStateResolver,
  type MoveAutomationTargetStateResolver,
} from './targetState'
import {
  createMoveAutomationTerrainResolver,
  type MoveAutomationTerrainResolver,
} from './terrain'
import {
  createMoveAutomationWeatherResolver,
  suppressMoveAutomationWeatherResolver,
  type MoveAutomationWeatherResolver,
} from './weather'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  type AbilityAutomationRuntimeRegistry,
  type AbilitySpecV1Runtime,
} from '../abilityAutomation/registry'
import { projectAuthoritativeEffectiveAbilities } from '../abilityAutomation/effectiveAbilities'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { aa060MoveMarkId } from '../abilityAutomation/mechanics/aa060MoveIntegration'
import { aa062BoneLordEmpowersMoveState } from '../abilityAutomation/mechanics/aa062MoveIntegration'
import { aa067DiamondDefenseMoveFrequency } from '../abilityAutomation/mechanics/aa067StaticIntegration'
import {
  AA068_DUST_CLOUD_BURST_BRANCH_ID,
  aa068DustCloudPresentationScript,
  aa068DustCloudSelectedScript,
} from '../abilityAutomation/mechanics/aa068StaticIntegration'
import { AA063_CLAY_CANNONS_CAPABILITY_ID } from '../abilityAutomation/mechanics/aa063MoveIntegration'
import { resolveSheetAbilityInstances } from '../abilityAutomation/instanceParameters'
import { aa080MoldBreakerSuppressesAbility } from '../abilityAutomation/mechanics/aa080StaticIntegration'

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

export type AuthoritativeMoveRelationshipQueries = MoveAutomationRelationshipResolver
export type AuthoritativeMoveBarriersAndSmokeQueries = MoveAutomationBarriersAndSmokeResolver
export type AuthoritativeMoveGlobalFieldQueries = MoveAutomationRemainingGlobalFieldResolver
export type AuthoritativeMoveGravityQueries = MoveAutomationGravityResolver
export type AuthoritativeMoveFlankingQueries = MoveAutomationFlankingResolver
export type AuthoritativeMoveCreatureRuleQueries = MoveAutomationCreatureRuleResolver
export type AuthoritativeMoveHistoryQueries = MoveAutomationHistoryResolver
export type AuthoritativeMoveItemEffectQueries = MoveAutomationItemEffectResolver
export type AuthoritativeMoveItemRuleQueries = MoveAutomationItemRuleResolver
export type AuthoritativeMoveResourceQueries = MoveAutomationResourceResolver
export type AuthoritativeMoveRoomQueries = MoveAutomationRoomResolver
export type AuthoritativeMoveStatQueries = MoveAutomationStatResolver
export type AuthoritativeMoveTargetStateQueries = MoveAutomationTargetStateResolver
export type AuthoritativeMoveTargetabilityQueries = MoveSemiInvulnerableTargetabilityResolver
export type AuthoritativeMoveLineOfSightQueries = MoveAutomationLineOfSightResolver
export type AuthoritativeMoveTerrainQueries = MoveAutomationTerrainResolver
export type AuthoritativeMoveWeatherQueries = MoveAutomationWeatherResolver
export interface AuthoritativeMoveEffectiveAbility {
  readonly instanceId: string
  readonly canonicalId: string
  readonly runtime: AbilitySpecV1Runtime
}
export interface AuthoritativeMoveAbilityQueries {
  activeForPlacement(placementId: string): readonly AuthoritativeMoveEffectiveAbility[]
  has(placementId: string, canonicalId: string): boolean
}

export interface AuthoritativeMoveRuleQueries {
  runtimeFor(canonicalId: string): RegisteredMoveAutomationRuntime | null
  legacyScriptFor(moveName: string): MoveAutomationScript | null
  /** Canonical mechanics for a server-selected reviewed v2 child, independent of the actor's move list. */
  reviewedScriptFor(canonicalId: string): MoveAutomationScript | null
  semanticStatusFor(moveName: string): MoveAutomationSemanticStatus | null
}

export interface AuthoritativeMoveContextQueries {
  readonly placements: AuthoritativeMovePlacementQueries
  readonly tokens: AuthoritativeMoveTokenQueries
  readonly sheets: AuthoritativeMoveSheetQueries
  readonly relationships: AuthoritativeMoveRelationshipQueries
  readonly barriersAndSmoke: AuthoritativeMoveBarriersAndSmokeQueries
  readonly globalFields: AuthoritativeMoveGlobalFieldQueries
  readonly gravity: AuthoritativeMoveGravityQueries
  readonly flanking: AuthoritativeMoveFlankingQueries
  readonly creatureRules: AuthoritativeMoveCreatureRuleQueries
  readonly history: AuthoritativeMoveHistoryQueries
  readonly itemEffects: AuthoritativeMoveItemEffectQueries
  /** Bounded item-dependent expression values after authoritative suppression overlays. */
  readonly itemRules: AuthoritativeMoveItemRuleQueries
  /** Private normalized item identities; never projected to accepted wire results. */
  readonly items: AuthoritativeMoveItemResourceQueries
  readonly resources: AuthoritativeMoveResourceQueries
  readonly rooms: AuthoritativeMoveRoomQueries
  readonly stats: AuthoritativeMoveStatQueries
  /** Resolution-local reservations for typed side-owned damage resistance. */
  readonly sideDamageResistance: SideDamageResistanceResolver
  readonly targetStates: AuthoritativeMoveTargetStateQueries
  readonly targetability: AuthoritativeMoveTargetabilityQueries
  readonly lineOfSight: AuthoritativeMoveLineOfSightQueries
  readonly terrain: AuthoritativeMoveTerrainQueries
  readonly weather: AuthoritativeMoveWeatherQueries
  /** Exact effective, manifest-selected ability runtimes; sheet text alone never grants mechanics. */
  readonly abilities: AuthoritativeMoveAbilityQueries
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
  /** Server-owned resolution identity required before a reviewed child can be invoked. */
  readonly resolutionId: string | null
  readonly actor: AuthoritativeMoveRulesActor
  readonly candidatePlacements: readonly SheetPlacement[]
  readonly selectedPlacements: readonly SheetPlacement[]
  readonly resolvedSheets: readonly AuthoritativeMoveResolvedSheet[]
  readonly ruleset: MoveRulesetProvenance
  readonly ancestry: readonly MoveResolutionTraceAncestryEntry[]
  /** Audited lookup used by the interpreter; never exposed to a handler callback. */
  readonly handlerRegistry: RegisteredMoveHandlerRegistry
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
  | 'invalid-virtual-origin'

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
  /** Server-only continuation seam for a validated durable random prefix. */
  readonly randomRoller?: AuthoritativeMoveRandom
  readonly time: number
  readonly resolutionId?: string
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
  /** Server-owned historical positions used by post-action reaction compatibility. */
  readonly tokenPositionOverrides?: ReadonlyMap<string, GridAnchor>
  readonly idFactory?: () => string
  readonly ruleset?: MoveRulesetProvenance
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  readonly abilityRuntimeRegistry?: AbilityAutomationRuntimeRegistry
  /** Test/migration seam. Values are snapshotted before any rule executes. */
  readonly legacyScripts?: ReadonlyMap<string, MoveAutomationScript>
  /** Server-loaded item documents selected by reviewed requirements. */
  readonly itemResources?: AuthoritativeMoveItemResources
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
  positionOverrides: ReadonlyMap<string, GridAnchor> = new Map(),
): {
  readonly tokens: readonly SpawnedPokemon[]
  readonly byId: ReadonlyMap<string, SpawnedPokemon>
} => {
  const tokens: SpawnedPokemon[] = []
  const byId = new Map<string, SpawnedPokemon>()
  for (const placement of placements) {
    const position = positionOverrides.get(placement.id)
    const token = placementToSpawned(
      position ? { ...placement, position: { ...position } } : placement,
      sheets,
      map,
      { skipAa077NativeProjection: true },
    )
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
  const abilityRuntimeRegistry = input.abilityRuntimeRegistry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY
  const { sheets: resolvedSheets, lookup: sheetLookup, byRef: sheetByRef } = resolvedSheetSnapshots(
    input.pokemonSheets,
    input.trainerSheets,
  )
  const basePlacementSnapshot = placementSnapshots(map)
  const effectiveAbilitiesByPlacement = new Map<string, readonly AuthoritativeMoveEffectiveAbility[]>()
  for (const placement of basePlacementSnapshot.placements) {
    const sheet = sheetByRef.get(sheetReadKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
    const projected = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(sheet?.sheet.abilities),
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
      effects: map.encounterState?.effects ?? [],
      transformationSnapshots: map.encounterState?.abilityTransformations,
    })
    effectiveAbilitiesByPlacement.set(placement.id, Object.freeze(projected.flatMap((ability) => {
      if (!ability.effective) return []
      const runtime = abilityRuntimeRegistry.resolve(ability.canonicalId)
      if (!runtime || (ability.definitionHash !== null && ability.definitionHash !== runtime.definitionHash)) return []
      return [Object.freeze({ instanceId: ability.instanceId, canonicalId: ability.canonicalId, runtime })]
    })))
  }
  const baseTokenById = tokenSnapshots(
    map,
    basePlacementSnapshot.placements,
    sheetLookup,
  ).byId
  const abilityEntityById = new Map((map.encounterState?.abilityEntities?.entries ?? []).flatMap((entity) => {
    const ownerPlacement = basePlacementSnapshot.byId.get(entity.ownerPlacementId)
    const ownerToken = baseTokenById.get(entity.ownerPlacementId)
    const sourceEffective = effectiveAbilitiesByPlacement.get(entity.ownerPlacementId)?.some(ability => (
      ability.instanceId === entity.sourceAbilityInstanceId
      && ability.canonicalId === entity.canonicalId
    )) === true
    const reviewedEntity = aa080IsMiniNoseEntity(entity) || aa080IsDreepyEntity(entity)
    const miniNoseActive = !aa080IsMiniNoseEntity(entity) || Boolean(ownerToken && ownerToken.currentHp > 0)
    return ownerPlacement && sourceEffective && reviewedEntity && miniNoseActive
      && entity.targetability === 'targetable' && aa080EntityIsActive(entity)
      ? [[entity.entityId, entity] as const]
      : []
  }))
  const entityPlacements = [...abilityEntityById.values()]
    .sort((left, right) => left.entityId.localeCompare(right.entityId))
    .map((entity): SheetPlacement => {
      if (basePlacementSnapshot.byId.has(entity.entityId)) {
        fail('duplicate-placement-id', `Ability entity ${entity.entityId} collides with an authoritative placement ID.`)
      }
      const owner = basePlacementSnapshot.byId.get(entity.ownerPlacementId)!
      return detachedFrozenJson({
        id: entity.entityId,
        sheetKind: owner.sheetKind,
        sheetSlug: owner.sheetSlug,
        position: entity.position,
        ...(owner.sideId ? { sideId: owner.sideId } : {}),
      })
    })
  const placements = deepFreeze([...basePlacementSnapshot.placements, ...entityPlacements])
  const placementById = new Map(placements.map(placement => [placement.id, placement]))
  for (const entityId of abilityEntityById.keys()) effectiveAbilitiesByPlacement.set(entityId, Object.freeze([]))
  const relationships = createMoveAutomationRelationshipResolver({
    placements,
    sides: map.encounterState?.sides ?? {},
  })
  const targetability = createMoveSemiInvulnerableTargetabilityResolver({
    effects: map.encounterState?.effects ?? [],
  })
  const history = createMoveAutomationHistoryResolver(
    map.encounterState?.history ?? createEmptyEncounterHistory(),
  )
  const resources = createMoveAutomationResourceResolver(
    map.encounterState?.turnResources ?? createEmptyEncounterTurnResources(),
  )
  const rooms = createMoveAutomationRoomResolver(map)
  const globalFields = createMoveAutomationRemainingGlobalFieldResolver(map, rooms)
  const gravity = createMoveAutomationGravityResolver({ placements, globalFields })
  const baseWeather = createMoveAutomationWeatherResolver(map, {
    subjectPlacementId: intent.placementId,
  })
  const actorHasMoldBreaker = (effectiveAbilitiesByPlacement.get(intent.placementId) ?? [])
    .some(ability => ability.canonicalId === 'Mold Breaker')
  const abilitiesVisibleToMove = (placementId: string): readonly AuthoritativeMoveEffectiveAbility[] => (
    effectiveAbilitiesByPlacement.get(placementId) ?? Object.freeze([])
  ).filter(ability => !aa080MoldBreakerSuppressesAbility({
    actorPlacementId: intent.placementId,
    targetPlacementId: placementId,
    canonicalId: ability.canonicalId,
    actorHasMoldBreaker,
    relationship: relationships.resolve(intent.placementId, placementId).relationship,
  }))
  const abilityQueries: AuthoritativeMoveAbilityQueries = Object.freeze({
    activeForPlacement: abilitiesVisibleToMove,
    has: (placementId: string, canonicalId: string) => abilitiesVisibleToMove(placementId)
      .some(ability => ability.canonicalId === canonicalId),
  })
  const infiltratorBlocksBlessings = abilityQueries.has(intent.placementId, 'Infiltrator')
  const sideDamageResistance = createSideDamageResistanceResolver({
    placements,
    sides: map.encounterState?.sides ?? {},
    effects: map.encounterState?.effects ?? [],
    ...(infiltratorBlocksBlessings ? {
      responsiveActivationBlockedEffectIds: new Set(
        (map.encounterState?.effects ?? [])
          .filter(effect => effect.tags.includes('blessing'))
          .map(effect => effect.id),
      ),
    } : {}),
  })
  const effectivePositionOverrides = new Map(input.tokenPositionOverrides ?? [])
  const anchoredAbility = effectiveAbilitiesByPlacement.get(intent.placementId)
    ?.find(ability => ability.canonicalId === 'Anchored')
  const anchoredMark = anchoredAbility
    ? map.encounterState?.abilityOwnedState?.entries.find(entry => (
        entry.ownerPlacementId === intent.placementId
        && entry.sourceAbilityInstanceId === anchoredAbility.instanceId
        && entry.canonicalId === 'Anchored'
        && entry.payload.kind === 'mark'
        && entry.payload.markId === aa060MoveMarkId('Anchored', intent.moveName)
      ))
    : null
  const anchoredEntity = anchoredMark && anchoredAbility
    ? map.encounterState?.abilityEntities?.entries.find(entry => (
        entry.ownerPlacementId === intent.placementId
        && entry.sourceAbilityInstanceId === anchoredAbility.instanceId
        && entry.payload.kind === 'anchor'
        && entry.payload.anchorKind === 'aa060.anchored'
      ))
    : null
  if (anchoredEntity) effectivePositionOverrides.set(intent.placementId, anchoredEntity.position)
  if (intent.originCell) {
    const activeEffects = map.encounterState?.effects ?? []
    const effectIsActive = (effect: (typeof activeEffects)[number]): boolean => (
      effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    )
    const clayCannonsActive = effectiveAbilitiesByPlacement.get(intent.placementId)
      ?.some(ability => ability.canonicalId === 'Clay Cannons') === true
      && activeEffects.some(effect => (
        effect.kind === 'capability'
        && effectIsActive(effect)
        && effect.payload.action === 'grant'
        && effect.payload.capabilityId === AA063_CLAY_CANNONS_CAPABILITY_ID
        && effect.affected.placementIds.includes(intent.placementId)
      ))
    const origin = intent.originCell
    const source = tokenSnapshots(map, placements, sheetLookup, new Map()).tokens
      .find(token => token.id === intent.placementId)
    const inBounds = origin.x >= 0 && origin.x < map.dimensions.x
      && origin.y >= 0 && origin.y < map.dimensions.y
      && origin.z >= 0 && origin.z < map.dimensions.z
    const clayCannonsInRange = source
      ? ptuGridDistanceBetweenFootprints(source, { position: origin, base: 1, clearance: 1 }) <= 2
      : false
    const forestLordEffect = activeEffects.find(effect => (
      effect.kind === 'capability'
      && effectIsActive(effect)
      && effect.payload.action === 'grant'
      && effect.payload.capabilityId === AA071_FOREST_LORD_ORIGIN_CAPABILITY
      && effect.affected.placementIds.includes(intent.placementId)
      && effect.affected.cells.some(cell => (
        cell.x === origin.x && cell.y === origin.y && cell.z === origin.z
      ))
    ))
    const canonicalMove = findMove(intent.moveName)
    const canonicalMoveType = canonicalMove?.type.trim().toLowerCase()
    const sourceOrigin = source !== undefined
      && source.position.x === origin.x
      && source.position.y === origin.y
      && source.position.z === origin.z
    const miniNoseOrigin = [...abilityEntityById.values()].find(entity => (
      entity.ownerPlacementId === intent.placementId
      && aa080IsMiniNoseEntity(entity)
      && entity.position.x === origin.x
      && entity.position.y === origin.y
      && entity.position.z === origin.z
    ))
    const canonicalMoveRange = canonicalMove?.range?.trim().toLowerCase() ?? ''
    const miniNosesActive = source !== undefined
      && source.currentHp > 0
      && effectiveAbilitiesByPlacement.get(intent.placementId)
        ?.some(ability => ability.canonicalId === 'Mini-Noses') === true
      && miniNoseOrigin !== undefined
      && canonicalMoveRange.length > 0
      && !canonicalMoveRange.includes('melee')
      && !['self', 'field'].includes(canonicalMoveRange)
    const forestLordActive = effectiveAbilitiesByPlacement.get(intent.placementId)
      ?.some(ability => ability.canonicalId === 'Forest Lord') === true
      && forestLordEffect !== undefined
      && ['grass', 'ghost'].includes(canonicalMoveType ?? '')
      && isAa071FullyGrownTreeCell(map, origin)
      && Boolean(source && ptuGridDistanceBetweenFootprints(
        source, { position: origin, base: 1, clearance: 1 },
      ) <= 10)
    if (!inBounds || (!sourceOrigin && !forestLordActive && !miniNosesActive
      && (!clayCannonsActive || !clayCannonsInRange))) {
      fail('invalid-virtual-origin', 'The requested Move origin is not authorized by an active reviewed ability.')
    }
    effectivePositionOverrides.set(intent.placementId, origin)
  }
  const baseTokens = tokenSnapshots(
    map,
    placements,
    sheetLookup,
    effectivePositionOverrides,
  ).tokens.map((token): SpawnedPokemon => {
    const entity = abilityEntityById.get(token.id)
    if (!entity) return token
    const maximumHp = entity.maximumHp ?? token.maxHp
    return detachedFrozenJson({
      ...token,
      species: aa080IsMiniNoseEntity(entity) ? 'Mini-Nose' : 'Dreepy',
      currentHp: entity.currentHp ?? maximumHp,
      maxHp: maximumHp,
      fullMaxHp: maximumHp,
      temporaryHp: 0,
      injuries: 0,
      abilityNames: [],
      conditions: [],
      sheetConditions: [],
      tokenItems: [],
      base: entity.base,
      clearance: entity.clearance,
      movementCapabilities: aa080IsMiniNoseEntity(entity)
        ? { ...token.movementCapabilities, levitate: entity.movementSpeed }
        : token.movementCapabilities,
    })
  })
  const arenaTrapMarks = (map.encounterState?.abilityOwnedState?.entries ?? []).filter(entry => (
    entry.canonicalId === 'Arena Trap'
    && entry.payload.kind === 'mark'
    && entry.payload.markId === 'aa061.arena-trap.active'
    && effectiveAbilitiesByPlacement.get(entry.ownerPlacementId)?.some(ability => (
      ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Arena Trap'
    ))
  ))
  const tokens = deepFreeze(baseTokens.map((token) => {
    const placement = placementById.get(token.id)
    const resolvedSheet = placement
      ? sheetByRef.get(sheetReadKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
      : null
    const adjustedToken = aa074AdjustedToken({
      token,
      sheet: placement?.sheetKind === 'pokemon'
        ? resolvedSheet?.sheet as CharacterSheet ?? null
        : null,
      effectiveAbilityIds: (effectiveAbilitiesByPlacement.get(token.id) ?? [])
        .map(ability => ability.canonicalId),
    })
    const aa077Token = aa077AdjustedToken({
      token: adjustedToken,
      effectiveAbilityIds: (effectiveAbilitiesByPlacement.get(token.id) ?? [])
        .map(ability => ability.canonicalId),
    })
    const forecast = aa071ForecastTypeResolution({
      contextMap: map,
      placementId: token.id,
      hasForecast: effectiveAbilitiesByPlacement.get(token.id)
        ?.some(ability => ability.canonicalId === 'Forecast') === true,
    })
    const forecastToken = forecast.typeId
      ? detachedFrozenJson({ ...aa077Token, defenderTypes: [forecast.typeId] })
      : aa077Token
    const iceFaceToken = aa075IceFaceFormToken({
      token: forecastToken,
      hasIceFace: effectiveAbilitiesByPlacement.get(token.id)
        ?.some(ability => ability.canonicalId === 'Ice Face') === true,
      effects: map.encounterState?.effects,
    })
    // Illusion is renderer-only. Server mechanics retain the user's own token
    // identity, species, statistics, footprint, capabilities, and abilities.
    // Mold Breaker additionally strips only reviewed enemy Defensive ability
    // names from compatibility helpers so raw sheet text cannot reintroduce a
    // bypassed mechanic after the exact runtime query has rejected it.
    const suppressDefensiveNames = actorHasMoldBreaker
      && relationships.resolve(intent.placementId, token.id).relationship === 'enemy'
    const effectiveToken = suppressDefensiveNames
      ? detachedFrozenJson({
          ...iceFaceToken,
          abilityNames: iceFaceToken.abilityNames?.filter(name => !aa080IsDefensiveAbility(name.trim())),
        })
      : iceFaceToken
    const trapped = arenaTrapMarks.some((mark) => {
      const source = baseTokens.find(candidate => candidate.id === mark.ownerPlacementId)
      if (!source
        || relationships.resolve(source.id, effectiveToken.id).relationship !== 'enemy'
        || ptuGridDistanceBetweenFootprints(source, effectiveToken) > 5) return false
      const flying = effectiveToken.defenderTypes.some(type => type.trim().toLowerCase() === 'flying')
      const speeds = effectiveToken.movementCapabilities ?? {}
      return !flying
        && (speeds.levitate ?? 0) < 4
        && (speeds.sky ?? 0) < 4
        && (speeds.burrow ?? 0) < 4
    })
    return trapped
      ? detachedFrozenJson({ ...effectiveToken, conditions: [...new Set([...effectiveToken.conditions, 'Slowed', 'Trapped'])] })
      : effectiveToken
  }))
  const tokenById = new Map(tokens.map(token => [token.id, token]))

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
  const runtimeRegistry = input.runtimeRegistry ?? MOVE_AUTOMATION_RUNTIME_REGISTRY
  const runtimes = runtimeSnapshots(runtimeRegistry, legacyScripts)
  const semanticStatuses = semanticStatusSnapshots([
    intent.moveName,
    ...legacyScripts.keys(),
    ...runtimes.keys(),
  ])
  const ruleset = detachedFrozenJson(input.ruleset ?? MOVE_RULESET_PROVENANCE)
  const random = input.randomRoller ?? createAuthoritativeMoveRandom(input.random)
  const itemResources = input.itemResources ?? emptyAuthoritativeMoveItemResources()
  const reads: AuthoritativeMoveSheetRead[] = itemResources.sheetReads.map(read => ({
    kind: read.kind,
    slug: read.slug,
    revision: normalizeRevision(read.revision),
  }))

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

  const itemEffects = createMoveAutomationItemEffectResolver({
    placements,
    globalFields,
    effects: map.encounterState?.effects ?? [],
    recordSheetRead: readSet.recordPlacement,
    suppressAllForPlacement: placementId => (
      effectiveAbilitiesByPlacement.get(placementId)
        ?.some(ability => ability.canonicalId === 'Klutz') === true
    ),
  })
  const itemResourceQueries = createAuthoritativeMoveItemResourceQueries(itemResources)
  const itemRules = createMoveAutomationItemRuleResolver({
    placements,
    sheets: resolvedSheets,
    items: itemResourceQueries,
    itemEffects,
    recordSheetRead: readSet.recordPlacement,
    rareBenefitEligibleForPlacement: (placementId, canonicalItemId) => (
      canonicalItemId === 'rare-leek'
      && effectiveAbilitiesByPlacement.get(placementId)
        ?.some(ability => ability.canonicalId === 'Leek Mastery') === true
    ),
  })
  const creatureRules = createMoveAutomationCreatureRuleResolver({
    placements,
    tokens,
    effects: map.encounterState?.effects ?? [],
    resolveGrounding: ({ placement, base }) => gravity.grounding({
      placementId: placement.id,
      base,
    }).grounding,
    recordSheetRead: readSet.recordPlacement,
  })
  const stats = createMoveAutomationStatResolver({
    placements,
    tokens,
    hasEffectiveAbility: abilityQueries.has,
    resolveStatOverlay: (placement, stat) => rooms.statOverlay({ placement, stat }),
    recordSheetRead: readSet.recordPlacement,
  })
  const targetStates = createMoveAutomationTargetStateResolver({
    placements,
    tokens,
    sheets: resolvedSheets,
    history,
    effects: map.encounterState?.effects ?? [],
    resolveGrounding: ({ placement, base }) => gravity.grounding({
      placementId: placement.id,
      base,
    }).grounding,
    recordSheetRead: readSet.recordPlacement,
  })
  const cannotBeFlankedPlacementIds = new Set((map.encounterState?.effects ?? []).flatMap(effect => (
    effect.kind === 'capability'
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === AA070_FLUTTER_NO_FLANK_CAPABILITY
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
      ? effect.affected.placementIds
      : []
  )))
  const flanking = createMoveAutomationFlankingResolver({
    placements,
    tokens,
    relationships,
    cannotBeFlankedPlacementIds,
    recordSheetRead: readSet.recordPlacement,
  })
  const obscurationPlacements = tokens.map((token) => {
    const placement = placementById.get(token.id)
    return {
      id: token.id,
      position: token.position,
      base: token.base,
      clearance: token.clearance,
      ...(placement?.sideId ? { sideId: placement.sideId } : {}),
    }
  })
  const barriersAndSmoke = createMoveAutomationBarriersAndSmokeResolver({
    map,
    placements: obscurationPlacements,
  })
  const lineOfSight = createMoveAutomationLineOfSightResolver({
    voxels: map.voxels,
    placements: obscurationPlacements,
    barrierCells: barriersAndSmoke.barrierSightCells(),
    recordPlacementRead: (placementId) => {
      const placement = placementById.get(placementId)
      if (placement) readSet.recordPlacement(placement)
    },
  })
  const terrain = createMoveAutomationTerrainResolver({
    map,
    placements,
    tokens,
    targetStates,
  })
  const airLockActive = (map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
    entry.canonicalId === 'Air Lock'
    && entry.payload.kind === 'mark'
    && entry.payload.markId === `aa060.air-lock.active:${map.initiative?.round ?? 0}`
    && abilityQueries.activeForPlacement(entry.ownerPlacementId)
      .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Air Lock')
  ))
  const weather = airLockActive
    ? suppressMoveAutomationWeatherResolver(baseWeather, 'ability.air-lock.weather-suppressed')
    : baseWeather

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
      const isRetiredLegacyPresentation = selectedRuntime.definition.spec.presentation.tags
        .includes('legacy-retirement')
      const retainedPresentation = isRetiredLegacyPresentation
        ? legacyScripts.get(canonicalMove.name) ?? null
        : null
      const presentation = retainedPresentation
        ?? nativeMoveAutomationPresentationScriptForMove(canonicalMove.name)
      const baseScript = presentation ?? createMoveAutomationScriptFromMoveData(canonicalMove)
      const dustCloudActive = abilityQueries.has(actorPlacement.id, 'Dust Cloud')
      const script = aa078MovePresentationScript({
        context: { actor: { placement: actorPlacement }, queries: { abilities: abilityQueries }, map },
        script: aa068DustCloudPresentationScript({
          script: baseScript,
          active: dustCloudActive,
        }),
      })
      const selectedBranch = intent.targetBranchId === AA068_DUST_CLOUD_BURST_BRANCH_ID
        ? aa068DustCloudSelectedScript({
            script,
            active: dustCloudActive,
            targetBranchId: intent.targetBranchId,
          })
        : intent.targetBranchId
          ? moveAutomationScriptForTargetBranch(script, intent.targetBranchId)
          : null
      const selectedScript = aa078MovePresentationScript({
        context: { actor: { placement: actorPlacement }, queries: { abilities: abilityQueries }, map },
        script: selectedBranch ?? script,
        qualificationScript: baseScript,
      })
      // The reviewed spec is authoritative for intent shape. Canonical range
      // prose such as Blessing does not itself imply the self declaration that
      // a native runtime has explicitly reviewed.
      return detachedFrozenJson(selectedRuntime.definition.spec.targeting.kind === 'self'
        ? { ...selectedScript, targetMode: 'self', targetCount: 1 }
        : selectedScript)
    }
    return legacyScriptFor(moveName)
  }

  const reviewedScriptFor = (canonicalId: string): MoveAutomationScript | null => {
    const runtime = runtimes.get(canonicalId)
    const canonicalMove = findMove(canonicalId)
    if (!canonicalMove || runtime?.kind !== 'movespec-v2') return null
    return detachedFrozenJson(createMoveAutomationScriptFromMoveData(canonicalMove))
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
    relationships,
    barriersAndSmoke,
    globalFields,
    gravity,
    flanking,
    creatureRules,
    history,
    itemEffects,
    itemRules,
    items: itemResourceQueries,
    resources,
    rooms,
    stats,
    sideDamageResistance,
    targetStates,
    targetability,
    lineOfSight,
    terrain,
    weather,
    abilities: abilityQueries,
    rules: Object.freeze({
      runtimeFor: (canonicalId: string) => runtimes.get(canonicalId) ?? null,
      legacyScriptFor,
      reviewedScriptFor,
      semanticStatusFor: (moveName: string) => semanticStatuses.get(normalizedMoveName(moveName)) ?? null,
    }),
    resolveActorMoveEntry: (moveName: string): CanonicalMoveEntryResult => {
      const resolved = resolveCanonicalMoveEntryForPlacement({
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
        encounterEffects: map.encounterState?.effects ?? [],
        abilityConnectionNames: abilityQueries.activeForPlacement(actorPlacement.id)
          .map(ability => ability.canonicalId),
        definitionHashForMove: (moveName: string): string | null => {
          const canonicalMove = findMove(moveName)
          return canonicalMove ? runtimes.get(canonicalMove.name)?.definitionHash ?? null : null
        },
        frequencyForMove: (canonicalMoveName, frequency) => canonicalMoveName === 'Mimic'
          && abilityQueries.has(actorPlacement.id, 'Mimitree')
          && aa079HasMimitreeRearm({
            effects: map.encounterState?.effects,
            placementId: actorPlacement.id,
          })
          ? 'At-Will'
          : aa067DiamondDefenseMoveFrequency({
              context: {
                actor: { placement: { id: actorPlacement.id } },
                queries: { abilities: abilityQueries },
              },
              script: { moveName: canonicalMoveName },
              frequency,
            }),
      })
      if (!resolved.ok || resolved.entry.canonicalMoveName !== 'Bonemerang'
        || !aa062BoneLordEmpowersMoveState({
          map,
          actorPlacementId: actorPlacement.id,
          activeAbilityInstanceIds: abilityQueries.activeForPlacement(actorPlacement.id)
            .filter(ability => ability.canonicalId === 'Bone Lord').map(ability => ability.instanceId),
          moveName: 'Bonemerang',
        })) return detachedFrozenJson(resolved)
      return detachedFrozenJson({
        ...resolved,
        entry: {
          ...resolved.entry,
          script: {
            ...resolved.entry.script,
            targetMode: 'multi-target', targetCount: null, range: 'Line 6',
            keywords: resolved.entry.script.keywords.filter(keyword => keyword !== 'Double Strike'),
            areaTemplates: [{ kind: 'line', size: 6, label: 'Line 6' }],
          },
        },
      })
    },
  })

  const context: AuthoritativeMoveRulesContext = {
    map,
    intent,
    resolutionId: input.resolutionId ?? null,
    actor: deepFreeze({ placement: actorPlacement, token: actorToken, sheet: actorSheet }),
    candidatePlacements,
    selectedPlacements,
    resolvedSheets,
    ruleset,
    ancestry: detachedFrozenJson(input.ancestry ?? []),
    handlerRegistry: runtimeRegistry.handlerRegistry,
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
