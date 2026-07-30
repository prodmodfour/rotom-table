import { normalizeRevision } from '#shared/sessionRevisions'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { AbilityInstanceData } from '#shared/abilityAutomation/parameters'
import type { MoveResolutionTraceAncestryEntry } from '#shared/moveAutomation/trace'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { createEmptyEncounterTurnResources } from '#shared/moveAutomation/encounterResources'
import { moveItemEffectBindingId } from '#shared/moveAutomation/itemEffects'
import {
  MOVE_RULESET_PROVENANCE,
  type MoveRulesetProvenance,
} from '#shared/moveAutomation/ruleset'
import { findMove, letterPressHiddenPowerSourceSlug } from '~~/data/ptuReference'
import pokedexData from '~~/data/reference/pokedex.json'
import type { PokedexRecord } from '~/types/pokemon'
import {
  hasPokemonCapabilityEdge,
  selectedPokemonCapabilityEdges,
} from '#shared/capabilityAutomation/pokemonEdges'
import {
  capabilityWeaponMove,
  capabilityWeaponMoveName,
} from '#shared/capabilityAutomation/weaponMoves'
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
import {
  aa085to100AdjustedToken,
  aa085to100MovePresentationScript,
  formProjectedToken,
} from '../abilityAutomation/mechanics/aa085to100StaticIntegration'
import { aa078MovePresentationScript } from '../abilityAutomation/mechanics/aa078StaticIntegration'
import type { GridAnchor, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MovementCapabilityTraits } from '~/types/movement'
import { resolveEffectiveCapabilities } from '../capabilityAutomation/effectiveCapabilities'
import { resolveWielderWeaponProfile } from '../capabilityAutomation/wielder'
import { resolveCapabilityWeaponMoveGrants } from '../capabilityAutomation/weaponMoveGrants'
import { CAPABILITY_WEAPON_MOVE_RUNTIMES } from '../capabilityAutomation/weaponMoveRuntime'
import { reconcileCapabilityRuntimeSourceLoss } from '../capabilityAutomation/sourceLoss'
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
import { sheetMoveToMoveLike } from '~/utils/move-automation/moveData'
import { actionTypeFromMoveRange } from './planMoveResources'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { moveAutomationScriptForTargetBranch } from '~/utils/moveAutomationTargetBranches'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import { gridFootprintCells } from '~/utils/gridGeometry'
import {
  isStruggleAttackMoveName,
  requiredStruggleCapabilityForMoveName,
  struggleAccuracyForCombatRank,
  struggleDamageBaseForCombatRank,
} from '~/utils/struggleMoves'
import { pokemonHasResolvedCapability, resolveStats } from '~/utils/sheets/pokemonDerived'
import { computeInjuryAdjustedMaxHp, computePokemonFormulaMaxHp } from '~/utils/ptuHp'
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
  type MoveAutomationEffectiveCapabilityIdentity,
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
  authoritativeEquippedItemReferences,
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
import {
  authoritativeAbilityOwnerIsConscious,
  hasEffectiveSoullessCapability,
} from '../abilityAutomation/effectiveRuntimeAbilities'
import type { AuthoritativeEffectiveAbility } from '../abilityAutomation/context'
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
import { projectAa081NeutralizingGasAbilities } from '../abilityAutomation/mechanics/aa081NeutralizingGasIntegration'
import {
  AA083_POLTERGEIST_FORMS,
  aa083PoltergeistFormForSpecies,
} from '#shared/abilityAutomation/aa083'
import { aa083PoisonHealActive } from '../abilityAutomation/mechanics/aa083LifecycleIntegration'

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
  readonly parameterData: AbilityInstanceData | null
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
  const intent = detachedFrozenJson(input.intent)
  const abilityRuntimeRegistry = input.abilityRuntimeRegistry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY
  const { sheets: resolvedSheets, lookup: sheetLookup, byRef: sheetByRef } = resolvedSheetSnapshots(
    input.pokemonSheets,
    input.trainerSheets,
  )
  const map = detachedFrozenJson(reconcileCapabilityRuntimeSourceLoss({
    map: detachedFrozenJson(input.map),
    sheets: { pokemon: sheetLookup.pokemon, trainer: sheetLookup.trainer },
  }))
  const basePlacementSnapshot = placementSnapshots(map)
  const basicAbilitiesBySpecies = new Map((pokedexData as readonly PokedexRecord[]).map(record => [
    record.species.trim().toLowerCase(),
    new Set(record.abilities?.basic ?? []),
  ]))
  const activeCapabilityLinks = (map.encounterState?.capabilityRuntime?.links ?? []).filter((link) => {
    const owner = basePlacementSnapshot.byId.get(link.ownerPlacementId)
    const ownerSheet = owner
      ? sheetByRef.get(sheetReadKey({ kind: owner.sheetKind, slug: owner.sheetSlug }))?.sheet
      : null
    return Boolean(owner && ownerSheet && resolveEffectiveCapabilities({
      map,
      placement: owner,
      sheet: ownerSheet,
      sheets: { pokemon: sheetLookup.pokemon, trainer: sheetLookup.trainer },
    }).instances.some(instance => (
      instance.instanceId === link.capabilityInstanceId
      && instance.canonicalId === link.canonicalId
      && instance.effective
    )))
  })
  const projectedAbilitiesByPlacement = new Map<string, readonly AuthoritativeEffectiveAbility[]>()
  for (const placement of basePlacementSnapshot.placements) {
    const sheet = sheetByRef.get(sheetReadKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
    const sheetAbilityInstances = resolveSheetAbilityInstances(sheet?.sheet.abilities)
    const soullessWonderGuard = sheet?.kind === 'pokemon'
      && hasEffectiveSoullessCapability({ map, placementId: placement.id, sheet: sheet.sheet as CharacterSheet })
      && !sheetAbilityInstances.some(ability => ability.canonicalId === 'Wonder Guard')
      ? [{
          instanceId: `capability:${placement.id}:Soulless:Wonder_Guard`,
          canonicalId: 'Wonder Guard',
          parameterStatus: 'not-parameterized' as const,
          parameterData: null,
        }]
      : []
    const asOneAbilities = activeCapabilityLinks.flatMap((link) => {
      if (link.kind !== 'as-one-mount' || link.ownerPlacementId !== placement.id
        || link.participantPlacementIds.length !== 1 || link.configurationId === 'Wonder Guard') return []
      const participant = basePlacementSnapshot.byId.get(link.participantPlacementIds[0]!)
      const participantSheet = participant
        ? sheetByRef.get(sheetReadKey({ kind: participant.sheetKind, slug: participant.sheetSlug }))
        : null
      if (!participant || participantSheet?.kind !== 'pokemon') return []
      const species = (participantSheet.sheet as CharacterSheet).species.trim().toLowerCase()
      const participantAbilities = resolveSheetAbilityInstances(participantSheet.sheet.abilities)
      const selected = link.configurationId
      const selectedBasic = selected && basicAbilitiesBySpecies.get(species)?.has(selected) === true
        ? selected
        : participantAbilities.find(ability => (
            ability.canonicalId !== 'Wonder Guard'
            && basicAbilitiesBySpecies.get(species)?.has(ability.canonicalId) === true
          ))?.canonicalId ?? null
      if (!selectedBasic) return []
      const selectedInstance = participantAbilities.find(ability => ability.canonicalId === selectedBasic)
      return [{
        instanceId: `capability-as-one:${link.id}:${selectedBasic}`,
        canonicalId: selectedBasic,
        parameterStatus: selectedInstance?.parameterStatus ?? 'not-parameterized' as const,
        parameterData: selectedInstance?.parameterData ?? null,
      }]
    })
    const projected = projectAuthoritativeEffectiveAbilities({
      baseAbilities: [...sheetAbilityInstances, ...soullessWonderGuard, ...asOneAbilities],
      species: sheet?.kind === 'pokemon' ? (sheet.sheet as CharacterSheet).species : null,
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
      effects: map.encounterState?.effects ?? [],
      transformationSnapshots: map.encounterState?.abilityTransformations,
    })
    projectedAbilitiesByPlacement.set(placement.id, projected)
  }
  // Delta Evolution grants Mega Rayquaza's Ability for the active Scene. Add
  // the reviewed grant before Neutralizing Gas projection so ordinary Ability
  // suppression and all downstream Ability mechanics apply to it normally.
  for (const mode of map.encounterState?.capabilityRuntime?.modes ?? []) {
    if (mode.mode !== 'mega-evolved' || mode.canonicalId !== 'Delta Evolution' || !map.activeScene) continue
    const placement = basePlacementSnapshot.byId.get(mode.actorPlacementId)
    const resolved = placement
      ? sheetByRef.get(sheetReadKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
      : null
    if (!placement || resolved?.kind !== 'pokemon') continue
    const sheet = resolved.sheet as CharacterSheet
    if (!sheet.species.trim().toLocaleLowerCase('en-US').includes('rayquaza')) continue
    const sourceEffective = resolveEffectiveCapabilities({
      map,
      placement,
      sheet,
      sheets: { pokemon: sheetLookup.pokemon, trainer: sheetLookup.trainer },
    }).instances.some(instance => (
      instance.instanceId === mode.capabilityInstanceId
      && instance.canonicalId === mode.canonicalId
      && instance.effective
    ))
    if (!sourceEffective) continue
    const config = /^trainer:([^;]{1,160});ability:(.{1,80})$/.exec(mode.configurationId ?? '')
    const trainerSlug = config?.[1]
    const selectedAbility = config?.[2]
    const usageIsCurrent = trainerSlug && selectedAbility
      && Array.isArray(map.metadata?.capabilityMegaEvolutionUses)
      && map.metadata.capabilityMegaEvolutionUses.some(raw => {
        const use = raw as Record<string, unknown>
        return use?.actorPlacementId === placement.id
          && use.trainerSlug === trainerSlug
          && use.sceneStartedAt === (map.activeScene?.startedAt ?? -1)
      })
    if (!usageIsCurrent || !selectedAbility) continue
    const existing = projectedAbilitiesByPlacement.get(placement.id) ?? []
    const existingIds = new Set(existing.filter(ability => ability.effective).map(ability => ability.canonicalId))
    const rayquaza = (pokedexData as PokedexRecord[]).find(record => record.species === 'Rayquaza')
    const natural = new Set([
      ...(rayquaza?.abilities?.basic ?? []),
      ...(rayquaza?.abilities?.advanced ?? []),
      ...(rayquaza?.abilities?.high ?? []),
    ])
    const validSelection = existingIds.has('Run Away')
      ? natural.has(selectedAbility) && !existingIds.has(selectedAbility)
      : selectedAbility === 'Run Away'
    const runtime = validSelection ? abilityRuntimeRegistry.resolve(selectedAbility) : null
    if (!runtime) continue
    projectedAbilitiesByPlacement.set(placement.id, Object.freeze([...existing, Object.freeze({
      instanceId: `capability-delta-evolution:${mode.id}:${selectedAbility.toLocaleLowerCase('en-US').replaceAll(' ', '-')}`,
      canonicalId: selectedAbility,
      sourceKind: 'granted' as const,
      sourcePlacementId: placement.id,
      definitionHash: runtime.definitionHash,
      effective: true,
      suppressionReasonCode: null,
      parameterStatus: 'not-parameterized' as const,
      parameterData: null,
    })]))
  }
  const baseTokenById = tokenSnapshots(
    map,
    basePlacementSnapshot.placements,
    sheetLookup,
  ).byId
  // Physically carried As One/Viral Fusion participants do not retain an
  // independent Ability field. Remove them before Neutralizing Gas projection
  // so a carried participant cannot suppress its owner or nearby creatures.
  const inactiveCapabilityParticipantIds = new Set(activeCapabilityLinks
    .filter(link => link.kind === 'as-one-mount' || link.kind === 'viral-fusion')
    .flatMap(link => link.participantPlacementIds))
  const abilitiesSubjectToNeutralizingGas = new Map([...projectedAbilitiesByPlacement].map(([placementId, abilities]) => [
    placementId,
    inactiveCapabilityParticipantIds.has(placementId) ? Object.freeze([]) : abilities,
  ] as const))
  const activeProjectedAbilities = projectAa081NeutralizingGasAbilities({
    abilitiesByPlacement: abilitiesSubjectToNeutralizingGas,
    tokensById: baseTokenById,
    effects: map.encounterState?.effects ?? [],
    preserveSuppressedEntries: false,
  })
  const effectiveAbilitiesByPlacement = new Map<string, readonly AuthoritativeMoveEffectiveAbility[]>()
  for (const [placementId, abilities] of activeProjectedAbilities) {
    const placement = basePlacementSnapshot.byId.get(placementId)
    const resolvedSheet = placement
      ? sheetByRef.get(sheetReadKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
      : null
    if (!resolvedSheet || !authoritativeAbilityOwnerIsConscious(resolvedSheet.sheet)) {
      effectiveAbilitiesByPlacement.set(placementId, Object.freeze([]))
      continue
    }
    effectiveAbilitiesByPlacement.set(placementId, Object.freeze(abilities.flatMap((ability) => {
      if (!ability.effective) return []
      const runtime = abilityRuntimeRegistry.resolve(ability.canonicalId)
      if (!runtime || (ability.definitionHash !== null && ability.definitionHash !== runtime.definitionHash)) return []
      return [Object.freeze({
        instanceId: ability.instanceId,
        canonicalId: ability.canonicalId,
        runtime,
        parameterData: ability.parameterData,
      })]
    })))
  }
  const carriedParticipantAbilitySnapshots = new Map<string, readonly AuthoritativeMoveEffectiveAbility[]>()
  for (const link of activeCapabilityLinks) {
    if ((link.kind === 'as-one-mount' || link.kind === 'viral-fusion') && link.participantPlacementIds.length === 1) {
      const participantId = link.participantPlacementIds[0]!
      carriedParticipantAbilitySnapshots.set(participantId, effectiveAbilitiesByPlacement.get(participantId) ?? [])
    }
    if (link.kind === 'living-weapon') {
      effectiveAbilitiesByPlacement.set(
        link.ownerPlacementId,
        Object.freeze((effectiveAbilitiesByPlacement.get(link.ownerPlacementId) ?? [])
          .filter(ability => ability.canonicalId !== 'No Guard')),
      )
    }
    if (link.kind === 'as-one-mount' || link.kind === 'viral-fusion') {
      for (const participantId of link.participantPlacementIds) {
        effectiveAbilitiesByPlacement.set(participantId, Object.freeze([]))
      }
    }
  }
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
  const capabilityModesByPlacement = new Map<string, Set<string>>()
  const capabilityReservedStandardActionPlacementIds = new Set<string>()
  const capabilityReservedSwiftActionPlacementIds = new Set<string>()
  const capabilityAllowedMoveByPlacement = new Map<string, string>()
  for (const mode of map.encounterState?.capabilityRuntime?.modes ?? []) {
    const modePlacement = basePlacementSnapshot.byId.get(mode.actorPlacementId)
    const modeSheet = modePlacement
      ? sheetByRef.get(sheetReadKey({ kind: modePlacement.sheetKind, slug: modePlacement.sheetSlug }))?.sheet
      : null
    const effective = Boolean(modePlacement && modeSheet && resolveEffectiveCapabilities({
      map,
      placement: modePlacement,
      sheet: modeSheet,
      sheets: { pokemon: sheetLookup.pokemon, trainer: sheetLookup.trainer },
    }).instances.some(instance => (
      instance.instanceId === mode.capabilityInstanceId
      && instance.canonicalId === mode.canonicalId
      && instance.effective
    )))
    if (!effective || (mode.expiresAt !== null && mode.expiresAt <= input.time)) continue
    const modes = capabilityModesByPlacement.get(mode.actorPlacementId) ?? new Set<string>()
    modes.add(mode.mode)
    capabilityModesByPlacement.set(mode.actorPlacementId, modes)
    if (mode.mode === 'illusion' && /(?:^|;)motion:major$/.test(mode.configurationId ?? '')) {
      capabilityReservedStandardActionPlacementIds.add(mode.actorPlacementId)
    }
    if (mode.mode === 'illusion' && /(?:^|;)motion:minor$/.test(mode.configurationId ?? '')) {
      capabilityReservedSwiftActionPlacementIds.add(mode.actorPlacementId)
    }
    if (mode.mode === 'inside-machine' && mode.description?.trim()) {
      capabilityAllowedMoveByPlacement.set(mode.actorPlacementId, mode.description.trim())
    }
  }
  const capabilityCarriedPlacementIds = new Set(activeCapabilityLinks
    .filter(link => link.kind === 'as-one-mount' || link.kind === 'viral-fusion' || link.kind === 'marsupial-pouch')
    .flatMap(link => link.participantPlacementIds))
  const capabilityActionBlockedPlacementIds = new Set(activeCapabilityLinks
    .filter(link => link.kind === 'marsupial-pouch')
    .flatMap(link => link.participantPlacementIds))
  for (const placement of basePlacementSnapshot.placements) {
    if (placement.sheetKind !== 'pokemon') continue
    const sheet = sheetByRef.get(sheetReadKey({ kind: 'pokemon', slug: placement.sheetSlug }))?.sheet as CharacterSheet | undefined
    if (sheet?.babyTemplate === true || sheet?.letterPressCombinedInto || sheet?.zygardeDisassembledIntoCells) {
      capabilityActionBlockedPlacementIds.add(placement.id)
      if (sheet?.letterPressCombinedInto || sheet?.zygardeDisassembledIntoCells) capabilityCarriedPlacementIds.add(placement.id)
    }
  }
  if (Array.isArray(map.metadata?.capabilityMarsupialPouches)) {
    for (const raw of map.metadata.capabilityMarsupialPouches) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const pouch = raw as Record<string, unknown>
      if (typeof pouch.motherPlacementId !== 'string' || typeof pouch.babyPlacementId !== 'string') continue
      const sourceLink = activeCapabilityLinks.find(link => (
        link.kind === 'marsupial-pouch'
        && link.ownerPlacementId === pouch.motherPlacementId
        && link.participantPlacementIds.includes(pouch.babyPlacementId as string)
        && (typeof pouch.capabilityInstanceId !== 'string' || link.capabilityInstanceId === pouch.capabilityInstanceId)
      ))
      const mother = sourceLink ? baseTokenById.get(pouch.motherPlacementId) : null
      if (mother && mother.currentHp > 0 && capabilityActionBlockedPlacementIds.has(pouch.babyPlacementId)) {
        capabilityCarriedPlacementIds.add(pouch.babyPlacementId)
      }
    }
  }
  const targetability = createMoveSemiInvulnerableTargetabilityResolver({
    effects: map.encounterState?.effects ?? [],
    capabilityModesByPlacement,
    capabilityCarriedPlacementIds,
    capabilityActionBlockedPlacementIds,
    capabilityReservedStandardActionPlacementIds,
    capabilityReservedSwiftActionPlacementIds,
    capabilityAllowedMoveByPlacement,
    actionTypeForMove: moveCanonicalId => actionTypeFromMoveRange(
      findMove(moveCanonicalId)?.range ?? capabilityWeaponMove(moveCanonicalId)?.range ?? '',
    ),
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
  const actorAbilities = effectiveAbilitiesByPlacement.get(intent.placementId) ?? []
  const waterBubbleAbility = actorAbilities.find(ability => ability.canonicalId === 'Water Bubble')
  const actorHasMoldBreaker = actorAbilities.some(ability => ability.canonicalId === 'Mold Breaker')
  const declaredMoveType = findMove(intent.moveName)?.type.trim().toLowerCase() ?? null
  const actorHasTypedDefensiveBypass = (declaredMoveType === 'electric'
    && actorAbilities.some(ability => ability.canonicalId === 'Teravolt'))
    || (declaredMoveType === 'fire'
      && actorAbilities.some(ability => ability.canonicalId === 'Turboblaze'))
  const actorBypassesDefensiveAbilities = actorHasMoldBreaker || actorHasTypedDefensiveBypass
  const abilitiesVisibleToMove = (placementId: string): readonly AuthoritativeMoveEffectiveAbility[] => (
    effectiveAbilitiesByPlacement.get(placementId) ?? Object.freeze([])
  ).filter(ability => !aa080MoldBreakerSuppressesAbility({
    actorPlacementId: intent.placementId,
    targetPlacementId: placementId,
    canonicalId: ability.canonicalId,
    actorHasMoldBreaker: actorBypassesDefensiveAbilities,
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
  const validSymbiosisItemBindingIds = new Set(basePlacementSnapshot.placements.flatMap((placement) => {
    const resolved = sheetByRef.get(sheetReadKey({
      kind: placement.sheetKind,
      slug: placement.sheetSlug,
    }))
    return resolved
      ? authoritativeEquippedItemReferences(placement, resolved.sheet)
          .map(reference => moveItemEffectBindingId(reference))
      : []
  }))
  const capabilityFormWeather = createMoveAutomationWeatherResolver(map).active()[0]?.kind ?? null
  const effectiveCapabilityIdentitiesByPlacement = new Map<
    string,
    readonly MoveAutomationEffectiveCapabilityIdentity[]
  >()
  const staticallyAdjustedTokens = baseTokens.map((token) => {
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
    const remainingToken = aa085to100AdjustedToken({
      token: aa077Token,
      sheet: placement?.sheetKind === 'pokemon'
        ? resolvedSheet?.sheet as CharacterSheet ?? null
        : null,
      effectiveAbilityIds: (effectiveAbilitiesByPlacement.get(token.id) ?? [])
        .map(ability => ability.canonicalId),
      contextMap: map,
      validSymbiosisItemBindingIds,
    })
    const forecast = aa071ForecastTypeResolution({
      contextMap: map,
      placementId: token.id,
      hasForecast: effectiveAbilitiesByPlacement.get(token.id)
        ?.some(ability => ability.canonicalId === 'Forecast') === true,
    })
    const forecastToken = forecast.typeId
      ? detachedFrozenJson({ ...remainingToken, defenderTypes: [forecast.typeId] })
      : remainingToken
    const iceFaceToken = aa075IceFaceFormToken({
      token: forecastToken,
      hasIceFace: effectiveAbilitiesByPlacement.get(token.id)
        ?.some(ability => ability.canonicalId === 'Ice Face') === true,
      effects: map.encounterState?.effects,
    })
    const effectiveCapabilitySet = placement && resolvedSheet ? resolveEffectiveCapabilities({
      map,
      placement,
      sheet: resolvedSheet.sheet,
      sheets: { pokemon: sheetLookup.pokemon, trainer: sheetLookup.trainer },
    }) : null
    const effectiveCapabilityIdentities = effectiveCapabilitySet?.instances
      .filter(instance => instance.effective)
      .map(instance => ({ instanceId: instance.instanceId, canonicalId: instance.canonicalId })) ?? []
    const effectiveCapabilityIds = new Set(effectiveCapabilityIdentities
      .map(instance => instance.canonicalId))
    const effectiveCapabilityInstanceIds = new Set(effectiveCapabilityIdentities
      .map(instance => instance.instanceId))
    effectiveCapabilityIdentitiesByPlacement.set(token.id, effectiveCapabilityIdentities)
    const sourceSpecies = placement?.sheetKind === 'pokemon'
      ? (resolvedSheet?.sheet as CharacterSheet | undefined)?.species ?? token.species
      : token.species
    const effectiveSoulless = effectiveCapabilityIds.has('Soulless')
    const sheetPokemon = placement?.sheetKind === 'pokemon'
      ? resolvedSheet?.sheet as CharacterSheet | undefined : undefined
    const rawSoulless = sheetPokemon ? pokemonHasResolvedCapability(sheetPokemon, 'Soulless') : false
    const capabilityHpToken = effectiveSoulless
      ? detachedFrozenJson({
          ...iceFaceToken,
          currentHp: Math.min(iceFaceToken.currentHp, 1),
          maxHp: 1,
          fullMaxHp: 1,
          temporaryHp: 0,
          injuries: 0,
        })
      : rawSoulless && sheetPokemon
        ? (() => {
            const hpTotal = resolveStats(sheetPokemon).find(stat => stat.key === 'hp')?.total ?? 0
            const fullMaxHp = computePokemonFormulaMaxHp(sheetPokemon.level ?? 1, hpTotal)
            const maxHp = computeInjuryAdjustedMaxHp(fullMaxHp, sheetPokemon.combat?.injuries)
            return detachedFrozenJson({
              ...iceFaceToken,
              currentHp: Math.min(maxHp, Math.max(0, sheetPokemon.combat?.currentHp ?? iceFaceToken.currentHp)),
              maxHp,
              fullMaxHp,
              temporaryHp: Math.max(0, iceFaceToken.temporaryHp ?? 0),
              injuries: Math.max(0, sheetPokemon.combat?.injuries ?? 0),
            })
          })()
        : iceFaceToken
    let capabilityFormToken = capabilityHpToken
    const activeCapabilityModes = map.encounterState?.capabilityRuntime?.modes.filter(mode => (
      mode.actorPlacementId === token.id
      && effectiveCapabilityInstanceIds.has(mode.capabilityInstanceId)
      && effectiveCapabilityIds.has(mode.canonicalId)
      && (mode.expiresAt === null || mode.expiresAt > input.time)
      && (mode.mode !== 'mega-evolved' || Boolean(map.activeScene
        && Array.isArray(map.metadata?.capabilityMegaEvolutionUses)
        && map.metadata.capabilityMegaEvolutionUses.some(raw => {
          const use = raw as Record<string, unknown>
          return use?.actorPlacementId === token.id
            && typeof use.trainerSlug === 'string'
            && mode.configurationId?.startsWith(`trainer:${use.trainerSlug};ability:`) === true
            && use.sceneStartedAt === (map.activeScene?.startedAt ?? 0)
        })))
    )) ?? []
    if (effectiveCapabilityIds.has('Weapon Bond') && token.currentHp > 0 && activeCapabilityModes.some(mode => mode.mode === 'crowned')) {
      const species = sourceSpecies.trim().toLowerCase()
      if (species.includes('zacian')) capabilityFormToken = formProjectedToken({
        token: capabilityFormToken,
        sheet: placement?.sheetKind === 'pokemon' ? resolvedSheet?.sheet as CharacterSheet ?? null : null,
        targetSpecies: 'Zacian Crowned Sword Forme', formId: 'crowned-sword',
      })
      else if (species.includes('zamazenta')) capabilityFormToken = formProjectedToken({
        token: capabilityFormToken,
        sheet: placement?.sheetKind === 'pokemon' ? resolvedSheet?.sheet as CharacterSheet ?? null : null,
        targetSpecies: 'Zamazenta Crowned Shield Forme', formId: 'crowned-shield',
      })
    }
    const viralLink = activeCapabilityLinks.find(link => (
      link.ownerPlacementId === token.id && link.kind === 'viral-fusion'
    ))
    const viralPartner = viralLink?.participantPlacementIds.length === 1
      ? baseTokens.find(candidate => candidate.id === viralLink.participantPlacementIds[0])
      : null
    if (effectiveCapabilityIds.has('Viral Fusion') && viralPartner) {
      const partnerPlacement = placementById.get(viralPartner.id)
      const partnerResolvedSheet = partnerPlacement
        ? sheetByRef.get(sheetReadKey({ kind: partnerPlacement.sheetKind, slug: partnerPlacement.sheetSlug })) ?? null
        : null
      const partnerSpecies = partnerPlacement?.sheetKind === 'pokemon'
        ? (partnerResolvedSheet?.sheet as CharacterSheet | undefined)?.species.trim().toLowerCase() ?? viralPartner.species.trim().toLowerCase()
        : viralPartner.species.trim().toLowerCase()
      const targetSpecies = partnerSpecies.includes('solgaleo') ? 'Necrozma Dusk Mane'
        : partnerSpecies.includes('lunala') ? 'Necrozma Dawn Wings' : null
      if (targetSpecies) capabilityFormToken = formProjectedToken({
        token: capabilityFormToken,
        sheet: placement?.sheetKind === 'pokemon' ? resolvedSheet?.sheet as CharacterSheet ?? null : null,
        targetSpecies, formId: partnerSpecies.includes('solgaleo') ? 'dusk-mane' : 'dawn-wings',
      })
    }
    const zygardeMode = activeCapabilityModes.find(mode => mode.mode === 'zygarde-form')
    if (effectiveCapabilityIds.has('Zygarde Cells') && zygardeMode?.description
      && !sourceSpecies.trim().toLocaleLowerCase('en-US').includes('complete')
      && !capabilityFormToken.creatureRules?.formId.includes('complete')) {
      capabilityFormToken = formProjectedToken({
        token: capabilityFormToken,
        sheet: placement?.sheetKind === 'pokemon' ? resolvedSheet?.sheet as CharacterSheet ?? null : null,
        targetSpecies: zygardeMode.description === '10-percent' ? 'Zygarde 10% Forme' : 'Zygarde 50% Forme',
        formId: zygardeMode.description,
      })
    }
    const megaMode = activeCapabilityModes.find(mode => mode.mode === 'mega-evolved')
    if (effectiveCapabilityIds.has('Delta Evolution')
      && megaMode
      && sourceSpecies.trim().toLocaleLowerCase('en-US').includes('rayquaza')) {
      const megaBaseToken = formProjectedToken({
        token: capabilityFormToken,
        sheet: placement?.sheetKind === 'pokemon' ? resolvedSheet?.sheet as CharacterSheet ?? null : null,
        targetSpecies: 'Rayquaza',
        formId: 'mega-rayquaza',
      })
      capabilityFormToken = detachedFrozenJson({
        ...megaBaseToken,
        atk: megaBaseToken.atk + 3,
        def: megaBaseToken.def + 1,
        satk: megaBaseToken.satk + 3,
        sdef: megaBaseToken.sdef + 1,
        spd: (megaBaseToken.spd ?? 0) + 2,
      })
    }
    if (effectiveCapabilityIds.has('Living Weapon')
      && activeCapabilityLinks.some(link => link.kind === 'living-weapon' && link.ownerPlacementId === token.id)
      && capabilityFormToken.creatureRules) {
      const forceAegislashBlade = sourceSpecies.trim().toLocaleLowerCase('en-US') === 'aegislash'
        && !(map.encounterState?.effects ?? []).some(effect => (
          effect.tags.includes('aa092-stance-change-sword')
          && effect.affected.placementIds.includes(token.id)
          && effect.suppression.sources.length === 0
        ))
      capabilityFormToken = detachedFrozenJson({
        ...capabilityFormToken,
        ...(forceAegislashBlade ? {
          atk: capabilityFormToken.def,
          def: capabilityFormToken.atk,
          satk: capabilityFormToken.sdef,
          sdef: capabilityFormToken.satk,
        } : {}),
        creatureRules: { ...capabilityFormToken.creatureRules, formId: 'blade' },
      })
    }
    if (effectiveCapabilityIds.has('Bloom') && capabilityFormToken.creatureRules) {
      capabilityFormToken = detachedFrozenJson({
        ...capabilityFormToken,
        creatureRules: { ...capabilityFormToken.creatureRules, formId: capabilityFormWeather === 'sunny' ? 'sunshine' : 'overcast' },
      })
    }
    if (effectiveCapabilityIds.has('Weathershape') && capabilityFormToken.creatureRules) {
      const formId = capabilityFormWeather === 'sunny' ? 'sunny'
        : capabilityFormWeather === 'rainy' ? 'rainy'
          : capabilityFormWeather === 'hail' ? 'hail'
            : capabilityFormWeather === 'sandstorm' ? 'sandstorm' : 'normal'
      capabilityFormToken = detachedFrozenJson({
        ...capabilityFormToken,
        creatureRules: { ...capabilityFormToken.creatureRules, formId },
      })
    }
    if (effectiveCapabilitySet) {
      const movementCapabilities = { ...(capabilityFormToken.movementCapabilities ?? {}) }
      const movementKeys = [
        ['Overland', 'overland'], ['Sky', 'sky'], ['Swim', 'swim'], ['Levitate', 'levitate'],
        ['Burrow', 'burrow'], ['Teleporter', 'teleporter'],
      ] as const
      for (const [canonicalId, key] of movementKeys) {
        const instance = effectiveCapabilitySet.instances.find(candidate => (
          candidate.effective && candidate.canonicalId === canonicalId
        ))
        if (!instance || instance.value === null) delete movementCapabilities[key]
        else movementCapabilities[key] = instance.value
      }
      const wallclimber = effectiveCapabilitySet.instances.find(instance => (
        instance.effective && instance.canonicalId === 'Wallclimber'
      ))
      if (!wallclimber) delete movementCapabilities.climb
      else movementCapabilities.climb = Math.floor((movementCapabilities.overland ?? 0) / 2)
      const effectiveJump = effectiveCapabilitySet.instances.find(instance => (
        instance.effective && instance.canonicalId === 'Jump'
      ))
      const movementTraits = {
        ...(capabilityFormToken.movementTraits ?? capabilityFormToken.movementProfile?.traits ?? { phasing: false, jump: { long: 0, high: 0 } }),
        jump: effectiveJump?.parameters.kind === 'jump'
          ? { long: effectiveJump.parameters.long, high: effectiveJump.parameters.high }
          : { long: 0, high: 0 },
      }
      const phasing = effectiveCapabilitySet.instances.find(instance => (
        instance.effective && instance.canonicalId === 'Phasing'
      ))
      movementTraits.phasing = Boolean(phasing)
      const naturewalkTerrains = effectiveCapabilitySet.instances.flatMap(instance => (
        instance.effective && instance.canonicalId === 'Naturewalk' && instance.parameters.kind === 'terrains'
          ? [...instance.parameters.terrains] : []
      ))
      const numericCapabilityIds = new Set([
        'Overland', 'Sky', 'Swim', 'Levitate', 'Burrow', 'Teleporter', 'Power',
        'Jump', 'High Jump', 'Long Jump', 'Throwing Range', 'Naturewalk',
      ])
      const effectiveOtherCapabilityLabels = effectiveCapabilitySet.instances
        .filter(instance => instance.effective && !numericCapabilityIds.has(instance.canonicalId))
        .map((instance) => {
          const parameters = instance.parameters
          if (parameters.kind === 'rider-capacity') return `Mountable ${parameters.riders}`
          if (parameters.kind === 'categories') return `${instance.canonicalId} (${parameters.categories.join(', ')})`
          if (parameters.kind === 'qualifiers') return `${instance.canonicalId} (${parameters.qualifiers.join(', ')})`
          return instance.canonicalId
        })
      const movementRuleIds: Readonly<Partial<Record<string, string>>> = {
        Overland: 'movement.overland', Sky: 'movement.sky', Swim: 'movement.swim',
        Levitate: 'movement.levitate', Burrow: 'movement.burrow', Teleporter: 'movement.teleport',
        Jump: 'movement.jump', Wallclimber: 'movement.climb',
      }
      const effectiveCapabilityIds = effectiveCapabilitySet.instances.filter(instance => instance.effective)
        .flatMap(instance => [
          instance.canonicalId,
          `capability.${instance.canonicalId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}`,
          ...(movementRuleIds[instance.canonicalId] ? [movementRuleIds[instance.canonicalId]!] : []),
        ])
      capabilityFormToken = detachedFrozenJson({
        ...capabilityFormToken,
        movementCapabilities,
        movementTraits,
        defenderCapabilities: {
          ...((movementCapabilities.sky ?? 0) > 0 ? { sky: movementCapabilities.sky } : {}),
          ...((movementCapabilities.levitate ?? 0) > 0 ? { levitate: movementCapabilities.levitate } : {}),
        },
        ...(capabilityFormToken.ruleCapabilities ? {
          ruleCapabilities: {
            ...capabilityFormToken.ruleCapabilities,
            movementSpeeds: movementCapabilities,
            movementTraits,
            power: effectiveCapabilitySet.instances.find(instance => (
              instance.effective && instance.canonicalId === 'Power'
            ))?.value ?? null,
            naturewalk: naturewalkTerrains.length > 0 ? [...new Set(naturewalkTerrains)].join(', ') : null,
            other: effectiveOtherCapabilityLabels,
          },
        } : {}),
        ...(capabilityFormToken.movementProfile ? {
          movementProfile: { ...capabilityFormToken.movementProfile, speeds: movementCapabilities, traits: movementTraits },
        } : {}),
        ...(capabilityFormToken.creatureRules ? {
          creatureRules: {
            ...capabilityFormToken.creatureRules,
            capabilityIds: [...new Set(effectiveCapabilityIds)],
          },
        } : {}),
      })
    }
    const activeProjection = activeProjectedAbilities.get(token.id) ?? []
    const legacyIncompleteBaseNames = resolveSheetAbilityInstances(
      resolvedSheet?.sheet.abilities,
    ).flatMap((entry) => {
      if (abilityRuntimeRegistry.resolve(entry.canonicalId)) return []
      const projected = activeProjection.find(ability => (
        ability.instanceId === entry.instanceId && ability.canonicalId === entry.canonicalId
      ))
      return projected && (projected.effective
        || projected.suppressionReasonCode === 'ability.parameters.missing')
        ? [entry.canonicalId]
        : []
    })
    const effectiveAbilityNames = [...new Set([
      ...activeProjection.filter(ability => ability.effective).map(ability => ability.canonicalId),
      ...legacyIncompleteBaseNames,
    ])]
    const typeSnapshot = [...(map.encounterState?.abilityTransformations?.entries ?? [])]
      .reverse()
      .find(snapshot => snapshot.placementId === token.id
        && snapshot.mechanics.typeIds.length > 0
        && (effectiveAbilitiesByPlacement.get(snapshot.ownerPlacementId) ?? []).some(ability => (
          ability.instanceId === snapshot.sourceAbilityInstanceId
          && ability.canonicalId === snapshot.canonicalId
        )))
    const unscaledRuntimeToken = detachedFrozenJson({
      ...capabilityFormToken,
      abilityNames: effectiveAbilityNames,
      ...(capabilityFormToken.creatureRules ? {
        creatureRules: { ...capabilityFormToken.creatureRules, abilityNames: effectiveAbilityNames },
      } : {}),
      ...(typeSnapshot ? { defenderTypes: [...typeSnapshot.mechanics.typeIds] } : {}),
    })
    const tokenModes = capabilityModesByPlacement.get(token.id)
    const runtimeToken = tokenModes?.has('inflated')
      ? detachedFrozenJson({
          ...unscaledRuntimeToken,
          base: Math.max(1, Math.ceil(unscaledRuntimeToken.base * 1.25)),
          clearance: Math.max(1, Math.ceil(unscaledRuntimeToken.clearance * 1.25)),
        })
      : tokenModes?.has('shrunken')
        ? detachedFrozenJson({
            ...unscaledRuntimeToken,
            base: Math.max(1, Math.ceil(unscaledRuntimeToken.base * 0.25)),
            clearance: Math.max(1, Math.ceil(unscaledRuntimeToken.clearance * 0.25)),
          })
        : tokenModes?.has('shadow-melded')
          ? detachedFrozenJson({ ...unscaledRuntimeToken, clearance: 1 })
          : unscaledRuntimeToken
    // Illusion is renderer-only. Server mechanics retain the user's own token
    // identity, species, statistics, footprint, capabilities, and abilities.
    // Mold Breaker additionally strips only reviewed enemy Defensive ability
    // names from compatibility helpers so raw sheet text cannot reintroduce a
    // bypassed mechanic after the exact runtime query has rejected it.
    const suppressDefensiveNames = actorBypassesDefensiveAbilities
      && relationships.resolve(intent.placementId, token.id).relationship === 'enemy'
    const effectiveToken = suppressDefensiveNames
      ? detachedFrozenJson({
          ...runtimeToken,
          abilityNames: runtimeToken.abilityNames?.filter(name => !aa080IsDefensiveAbility(name.trim())),
        })
      : runtimeToken
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
  })
  const staticallyAdjustedTokenById = new Map(staticallyAdjustedTokens.map(token => [token.id, token]))
  const tokens = deepFreeze(staticallyAdjustedTokens.map((token) => {
    const link = activeCapabilityLinks.find(candidate => (
      candidate.ownerPlacementId === token.id
      && candidate.participantPlacementIds.length === 1
      && (candidate.kind === 'as-one-mount' || candidate.kind === 'viral-fusion')
    ))
    const linked = link ? staticallyAdjustedTokenById.get(link.participantPlacementIds[0]!) : null
    if (!link || !linked) return token
    const movementCapabilities = { ...linked.movementCapabilities }
    const sourceMovementTraits = linked.movementTraits ?? linked.movementProfile?.traits
    const movementTraits: MovementCapabilityTraits = {
      phasing: sourceMovementTraits?.phasing === true,
      ...(sourceMovementTraits?.intangible === true ? { intangible: true } : {}),
      jump: {
        long: sourceMovementTraits?.jump.long ?? 0,
        high: sourceMovementTraits?.jump.high ?? 0,
      },
    }
    if (link.kind === 'as-one-mount') {
      const secondary = linked.defenderTypes[0]
      const defenderTypes = [...token.defenderTypes]
      if (secondary) {
        if (defenderTypes.length > 1) defenderTypes[1] = secondary
        else defenderTypes.push(secondary)
      }
      const mountAbilities = carriedParticipantAbilitySnapshots.get(linked.id) ?? []
      const linkedPlacement = placementById.get(linked.id)
      const linkedResolvedSheet = linkedPlacement
        ? sheetByRef.get(sheetReadKey({ kind: linkedPlacement.sheetKind, slug: linkedPlacement.sheetSlug })) ?? null
        : null
      const linkedSpecies = linkedPlacement?.sheetKind === 'pokemon'
        ? (linkedResolvedSheet?.sheet as CharacterSheet | undefined)?.species ?? linked.species
        : linked.species
      const basicAbilities = basicAbilitiesBySpecies.get(linkedSpecies.trim().toLowerCase()) ?? new Set<string>()
      const configuredAbility = link.configurationId !== 'Wonder Guard'
        && link.configurationId && basicAbilities.has(link.configurationId)
        ? link.configurationId : null
      const gainedAbility = configuredAbility ?? mountAbilities.find(ability => (
        ability.canonicalId !== 'Wonder Guard' && basicAbilities.has(ability.canonicalId)
      ))?.canonicalId ?? null
      const effectiveGainedAbility = gainedAbility
        && (effectiveAbilitiesByPlacement.get(token.id) ?? []).some(ability => ability.canonicalId === gainedAbility)
        ? gainedAbility : null
      return detachedFrozenJson({
        ...token,
        base: linked.base,
        clearance: linked.clearance,
        size: linked.size,
        weightClass: Math.max(token.weightClass ?? 0, linked.weightClass ?? 0),
        ...(token.ruleCapabilities ? {
          ruleCapabilities: { ...token.ruleCapabilities, size: linked.size ?? token.ruleCapabilities.size },
        } : {}),
        ...(token.creatureRules ? {
          creatureRules: {
            ...token.creatureRules,
            size: linked.creatureRules?.size ?? token.creatureRules.size,
          },
        } : {}),
        defenderTypes: [...new Set(defenderTypes)],
        movementCapabilities,
        movementTraits,
        ...(token.movementProfile ? {
          movementProfile: {
            ...token.movementProfile,
            speeds: movementCapabilities,
            traits: movementTraits,
          },
        } : {}),
        abilityNames: [...new Set([...(token.abilityNames ?? []), ...(effectiveGainedAbility ? [effectiveGainedAbility] : [])])],
      })
    }
    const secondary = linked.defenderTypes[0]?.trim().toLocaleLowerCase('en-US') === 'psychic'
      ? linked.defenderTypes[1]
      : linked.defenderTypes[0]
    const defenderTypes = [...token.defenderTypes]
    if (secondary) {
      if (defenderTypes.length > 1) defenderTypes[1] = secondary
      else defenderTypes.push(secondary)
    }
    return detachedFrozenJson({
      ...token,
      defenderTypes: [...new Set(defenderTypes)],
      combatSkillRankValue: Math.min(6, (linked.combatSkillRankValue ?? 1) + 1),
      movementCapabilities,
      movementTraits,
      ...(token.movementProfile ? {
        movementProfile: {
          ...token.movementProfile,
          speeds: movementCapabilities,
          traits: movementTraits,
        },
      } : {}),
    })
  }))
  const tokenById = new Map(tokens.map(token => [token.id, token]))
  const canonicalSpeciesForPlacementId = (placementId: string): string | null => {
    const placement = placementById.get(placementId)
    if (!placement) return null
    const resolved = sheetByRef.get(sheetReadKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
    return placement.sheetKind === 'pokemon'
      ? (resolved?.sheet as CharacterSheet | undefined)?.species ?? null
      : null
  }

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
  const baseWeather = createMoveAutomationWeatherResolver(map, {
    subjectPlacementId: intent.placementId,
    subjectOccupiedCells: gridFootprintCells(actorToken.position, actorToken),
    ...(waterBubbleAbility ? {
      virtualWeatherKind: 'rainy' as const,
      virtualWeatherSourceId: `ability.water-bubble.${waterBubbleAbility.instanceId}`,
    } : {}),
  })

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
  const runtimes = new Map(runtimeSnapshots(runtimeRegistry, legacyScripts))
  for (const [canonicalId, runtime] of CAPABILITY_WEAPON_MOVE_RUNTIMES) {
    runtimes.set(canonicalId, runtime)
  }
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
    digestionNumericBenefitMultiplier: placementId => (
      effectiveAbilitiesByPlacement.get(placementId)
        ?.some(ability => ability.canonicalId === 'Ripen') === true ? 2 : 1
    ),
    sharedEquippedReferences: placementId => (
      (map.encounterState?.effects ?? []).flatMap(effect => {
        if (!effect.tags.includes('aa094-symbiosis-shared-item')
          || !effect.affected.placementIds.includes(placementId)
          || effect.suppression.sources.length > 0
          || (effect.duration.remaining !== null && effect.duration.remaining <= 0)) return []
        const bindingIds = new Set(effect.tags.flatMap(tag => (
          tag.startsWith('aa094-symbiosis-binding:')
            ? [tag.slice('aa094-symbiosis-binding:'.length)] : []
        )))
        const sourceId = effect.source.placementId
        const sourcePlacement = sourceId ? placementById.get(sourceId) ?? null : null
        const sourceSheet = sourcePlacement
          ? resolvedSheets.find(sheet => sheet.kind === sourcePlacement.sheetKind
            && sheet.slug === sourcePlacement.sheetSlug)?.sheet ?? null
          : null
        return sourcePlacement && sourceSheet
          ? authoritativeEquippedItemReferences(sourcePlacement, sourceSheet)
              .filter(reference => bindingIds.has(moveItemEffectBindingId(reference)))
          : []
      })
    ),
  })
  const creatureRules = createMoveAutomationCreatureRuleResolver({
    placements,
    tokens,
    effects: map.encounterState?.effects ?? [],
    effectiveCapabilityIdentitiesByPlacement,
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
    hasActivePoisonHeal: placementId => abilityQueries.has(placementId, 'Poison Heal')
      && aa083PoisonHealActive(map, placementId),
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
      blocksSight: capabilityModesByPlacement.get(token.id)?.has('inflated') === true,
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
  const contextualActorMoveScript = (
    canonicalId: string,
    script: MoveAutomationScript,
  ): MoveAutomationScript => canonicalId === 'Curse'
    && actorToken.defenderTypes.some(type => type.trim().toLowerCase() === 'ghost')
    ? {
        ...script,
        range: '8, 1 Target',
        targetMode: 'one-target',
        targetCount: 1,
        areaTemplates: [],
      }
    : script

  const actorMoveScriptFor = (moveName: string): MoveAutomationScript | null => {
    const weaponMove = capabilityWeaponMove(moveName)
    const weaponRuntime = weaponMove ? runtimes.get(weaponMove.name) : null
    if (weaponMove && weaponRuntime?.kind === 'movespec-v2') {
      return detachedFrozenJson(createMoveAutomationScriptFromMoveData(sheetMoveToMoveLike(weaponMove)))
    }
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
      const script = contextualActorMoveScript(canonicalMove.name, aa085to100MovePresentationScript({
        context: { actor: { placement: actorPlacement }, queries: { abilities: abilityQueries } } as AuthoritativeMoveRulesContext,
        script: aa078MovePresentationScript({
          context: { actor: { placement: actorPlacement }, queries: { abilities: abilityQueries }, map },
          script: aa068DustCloudPresentationScript({
            script: baseScript,
            active: dustCloudActive,
          }),
        }),
      }))
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
    const weaponMove = capabilityWeaponMove(canonicalId)
    if (weaponMove && runtime?.kind === 'movespec-v2') {
      return detachedFrozenJson(createMoveAutomationScriptFromMoveData(sheetMoveToMoveLike(weaponMove)))
    }
    const canonicalMove = findMove(canonicalId)
    if (!canonicalMove || runtime?.kind !== 'movespec-v2') return null
    return detachedFrozenJson(contextualActorMoveScript(canonicalMove.name, aa085to100MovePresentationScript({
      context: { actor: { placement: actorPlacement }, queries: { abilities: abilityQueries } } as AuthoritativeMoveRulesContext,
      script: createMoveAutomationScriptFromMoveData(canonicalMove),
    })))
  }

  const grantedMoveNamesForActor = (): readonly string[] => {
    const granted: string[] = []
    if (abilityQueries.has(actorPlacement.id, 'Poltergeist') && actorSheet.kind === 'pokemon') {
      const sheet = actorSheet.sheet as CharacterSheet
      const form = aa083PoltergeistFormForSpecies(sheet.species)
      const moveId = form ? AA083_POLTERGEIST_FORMS[form].moveId : null
      if (moveId && (sheet.level ?? 0) >= 40) granted.push(moveId)
    }
    for (const link of activeCapabilityLinks) {
      const participantId = link.participantPlacementIds[0]
      if (link.ownerPlacementId === actorPlacement.id && link.kind === 'as-one-mount') {
        const participantSpecies = participantId
          ? canonicalSpeciesForPlacementId(participantId)?.trim().toLowerCase() : null
        if (participantSpecies === 'spectrier') granted.push('Astral Barrage')
        if (participantSpecies === 'glastrier') granted.push('Glacial Lance')
      }
      if (link.ownerPlacementId === actorPlacement.id && link.kind === 'viral-fusion'
        && link.configurationId && findMove(link.configurationId) && actorSheet.kind === 'pokemon') {
        const actorPokemon = actorSheet.sheet as CharacterSheet
        const learnedNames = new Set([...(actorPokemon.movelist ?? []), ...(actorPokemon.appliedMoves ?? [])].map(move => move.name))
        const participantPlacement = link.participantPlacementIds.length === 1
          ? placementById.get(link.participantPlacementIds[0]!) : null
        const participantSheet = participantPlacement?.sheetKind === 'pokemon'
          ? sheetByRef.get(sheetReadKey({ kind: 'pokemon', slug: participantPlacement.sheetSlug }))?.sheet as CharacterSheet | undefined
          : undefined
        const species = participantSheet
          ? (pokedexData as readonly PokedexRecord[]).find(record => record.species === participantSheet.species)
          : null
        const fixedSignature = participantSheet?.species.toLowerCase().includes('solgaleo')
          || participantSheet?.species.toLowerCase().includes('lunala')
        const requiredLevel = fixedSignature ? 1
          : species?.level_up_moves?.find(move => move.name === link.configurationId)?.level ?? Number.POSITIVE_INFINITY
        if ((learnedNames.has(link.configurationId) || learnedNames.size < 6)
          && (actorPokemon.level ?? 0) >= requiredLevel) granted.push(link.configurationId)
      }
    }
    const actorEffectiveCapabilityIdentities = effectiveCapabilityIdentitiesByPlacement.get(actorPlacement.id) ?? []
    const actorEffectiveCapabilityIds = new Set(actorEffectiveCapabilityIdentities
      .map(instance => instance.canonicalId))
    const actorEffectiveCapabilityInstanceIds = new Set(actorEffectiveCapabilityIdentities
      .map(instance => instance.instanceId))
    const modes = (map.encounterState?.capabilityRuntime?.modes ?? []).filter(mode => (
      mode.actorPlacementId === actorPlacement.id
      && actorEffectiveCapabilityInstanceIds.has(mode.capabilityInstanceId)
      && actorEffectiveCapabilityIds.has(mode.canonicalId)
      && (mode.expiresAt === null || mode.expiresAt > input.time)
    ))
    if (modes.some(mode => mode.mode === 'crowned')) {
      const species = canonicalSpeciesForPlacementId(actorPlacement.id)?.trim().toLowerCase() ?? ''
      if (species.includes('zacian')) granted.push('Behemoth Blade')
      if (species.includes('zamazenta')) granted.push('Behemoth Bash')
    }
    const wiredMode = modes.find(mode => mode.actorPlacementId === actorPlacement.id && mode.mode === 'inside-machine')
    if ((canonicalSpeciesForPlacementId(actorPlacement.id)?.trim().toLowerCase().includes('rotom') ?? false)
      && wiredMode?.description && findMove(wiredMode.description)) granted.push(wiredMode.description)
    return [...new Set(granted)]
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
      const effectiveActorCapabilities = resolveEffectiveCapabilities({
        map,
        placement: actorPlacement,
        sheet: actorSheet.sheet,
        sheets: { pokemon: sheetLookup.pokemon, trainer: sheetLookup.trainer },
      }).instances.filter(instance => instance.effective)
      const requiredCapability = requiredStruggleCapabilityForMoveName(moveName)
      if (requiredCapability && !effectiveActorCapabilities.some(instance => instance.canonicalId === requiredCapability)) {
        return {
          ok: false,
          reason: 'creature-rule-blocked',
          message: `${moveName} requires effective ${requiredCapability}.`,
        }
      }
      const wielderWeapon = actorSheet.kind === 'pokemon'
        && effectiveActorCapabilities.some(instance => instance.canonicalId === 'Wielder')
        ? resolveWielderWeaponProfile({
            heldItemName: (actorSheet.sheet as CharacterSheet).items?.held,
            size: actorToken.size,
          })
        : null
      const capabilityWeaponGrants = resolveCapabilityWeaponMoveGrants({
        map,
        placement: actorPlacement,
        sheet: actorSheet.sheet,
        token: actorToken,
        pokemonSheets: sheetLookup.pokemon,
        trainerSheets: sheetLookup.trainer,
        tokenForPlacement: placementId => tokenById.get(placementId) ?? null,
      })
      const grantedMoveNames = [
        ...grantedMoveNamesForActor(),
        ...capabilityWeaponGrants.map(grant => grant.canonicalId),
      ]
      const requestedWeaponMove = capabilityWeaponMoveName(moveName)
      if (requestedWeaponMove && !grantedMoveNames.includes(requestedWeaponMove)) {
        return {
          ok: false,
          reason: 'creature-rule-blocked',
          message: `${requestedWeaponMove} requires an exact effective weapon source and qualifying Combat rank.`,
        }
      }
      let resolved = resolveCanonicalMoveEntryForPlacement({
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
        additionalMoveNames: grantedMoveNames
          .filter(name => capabilityWeaponMoveName(name) === null),
        additionalMoveEntries: grantedMoveNames.flatMap((name) => {
          const move = capabilityWeaponMove(name)
          return move ? [{ move, automatic: true, suppressStab: true as const }] : []
        }),
        definitionHashForMove: (moveName: string): string | null => {
          const canonicalId = capabilityWeaponMoveName(moveName) ?? findMove(moveName)?.name ?? null
          return canonicalId ? runtimes.get(canonicalId)?.definitionHash ?? null : null
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
      if (resolved.ok && wielderWeapon && isStruggleAttackMoveName(moveName)) {
        const rankedDamageBase = struggleDamageBaseForCombatRank(
          moveName, resolved.entry.script.damageBase, actorToken.combatSkillRankValue,
        )
        const rankedAc = struggleAccuracyForCombatRank(
          moveName, resolved.entry.script.ac, actorToken.combatSkillRankValue,
        )
        const damageBase = rankedDamageBase === null
          ? null : rankedDamageBase + wielderWeapon.damageBaseBonus
        const ac = rankedAc === null
          ? null : Number(rankedAc) + wielderWeapon.accuracyCheckPenalty
        const range = wielderWeapon.grantsReach && /\bmelee\b/i.test(resolved.entry.script.range)
          ? `${['large', 'huge', 'gigantic'].includes(actorToken.size.trim().toLocaleLowerCase('en-US')) ? 3 : 2}, 1 Target`
          : resolved.entry.script.range
        resolved = {
          ...resolved,
          entry: {
            ...resolved.entry,
            script: { ...resolved.entry.script, damageBase, ac, range },
          },
        }
      }
      if (resolved.ok) {
        const resolvedCanonicalMoveName = resolved.entry.canonicalMoveName
        const weaponGrant = capabilityWeaponGrants.find(grant => (
          grant.canonicalId === resolvedCanonicalMoveName
        ))
        if (weaponGrant) {
          const damageBase = resolved.entry.script.damageBase === null
            ? null : resolved.entry.script.damageBase + weaponGrant.damageBaseBonus
          const ac = resolved.entry.script.ac === null
            ? null : Number(resolved.entry.script.ac) + weaponGrant.accuracyCheckPenalty
          const range = weaponGrant.grantsReach && /\bmelee\b/i.test(resolved.entry.script.range)
            ? `${['large', 'huge', 'gigantic'].includes(actorToken.size.trim().toLocaleLowerCase('en-US')) ? 3 : 2}, ${resolved.entry.script.targetCount === 2 ? '2 Targets' : '1 Target'}`
            : resolved.entry.script.range
          resolved = {
            ...resolved,
            entry: {
              ...resolved.entry,
              script: { ...resolved.entry.script, damageBase, ac, range },
            },
          }
        }
      }
      if (resolved.ok && actorSheet.kind === 'pokemon' && requiredCapability) {
        const pokemon = actorSheet.sheet as CharacterSheet
        const basicRanged = selectedPokemonCapabilityEdges(pokemon, 'Basic Ranged Attacks')
          .some(capability => capability.trim().toLocaleLowerCase('en-US')
            === requiredCapability.toLocaleLowerCase('en-US'))
        const telekinetic = requiredCapability === 'Telekinetic'
        const tkMastery = telekinetic && hasPokemonCapabilityEdge(pokemon, 'TK Mastery')
        if (basicRanged || telekinetic) {
          const range = basicRanged
            ? 6
            : Math.max(1, actorToken.focusSkillRankValue ?? 1) + (tkMastery ? 2 : 0)
          resolved = {
            ...resolved,
            entry: {
              ...resolved.entry,
              script: {
                ...resolved.entry.script,
                range: `${range}, 1 Target`,
              },
            },
          }
        }
      }
      if (resolved.ok) {
        const livingWeaponLink = activeCapabilityLinks.find(link => (
          link.kind === 'living-weapon'
          && (link.ownerPlacementId === actorPlacement.id || link.participantPlacementIds.includes(actorPlacement.id))
        ))
        const wieldedStruggle = livingWeaponLink?.participantPlacementIds.includes(actorPlacement.id) === true
          && isStruggleAttackMoveName(moveName)
        if (wieldedStruggle && resolved.entry.script.damageBase !== null) {
          resolved = {
            ...resolved,
            entry: {
              ...resolved.entry,
              script: { ...resolved.entry.script, damageBase: resolved.entry.script.damageBase + 1 },
            },
          }
        }
      }
      if (resolved.ok && resolved.entry.canonicalMoveName === 'Hidden Power' && actorSheet.kind === 'pokemon') {
        const sourceSlug = letterPressHiddenPowerSourceSlug(moveName)
        const retained = sourceSlug
          ? (actorSheet.sheet as CharacterSheet).capabilityCampaignState?.letterPress?.hiddenPowers
              .find(entry => entry.sourceSheetSlug === sourceSlug)
          : null
        if (retained) {
          const damageClass = retained.attackStat === 'attack' ? 'Physical' as const : 'Special' as const
          resolved = {
            ...resolved,
            entry: {
              ...resolved.entry,
              move: { ...resolved.entry.move, damage_class: damageClass },
              script: { ...resolved.entry.script, damageClass },
            },
          }
        }
      }
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
