import { normalizeRevision } from '#shared/sessionRevisions'
import {
  createEmptyEncounterHistory,
  type EncounterHistory,
} from '#shared/moveAutomation/encounterHistory'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import type { MoveConsumedItemRecord } from '../moveAutomation/itemMutationTypes'
import type { EncounterSideDirectory } from '#shared/moveAutomation/encounterState'
import {
  ABILITY_RULESET_PROVENANCE,
  type AbilityRulesetProvenance,
} from '#shared/abilityAutomation/ruleset'
import {
  parseAbilityInstanceData,
  type AbilityInstanceData,
  type AbilityInstanceParameterStatus,
} from '#shared/abilityAutomation/parameters'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
  type AbilityTransformationSnapshot,
  type AbilityTransformationState,
} from '#shared/abilityAutomation/transformations'
import {
  createEmptyAbilityEntityState,
  parseAbilityEntityState,
  type AbilityEntityEntry,
  type AbilityEntityState,
} from '#shared/abilityAutomation/entities'
import type { AbilityResolutionTraceAncestryEntry } from '#shared/abilityAutomation/trace'
import {
  createEmptyAbilityOwnedState,
  parseAbilityOwnedState,
  type AbilityOwnedState,
  type AbilityOwnedStateEntry,
  type AbilityOwnedStateKind,
} from '#shared/abilityAutomation/ownedState'
import type {
  AbilityAutomationRandomRollRequest,
  AbilityAutomationRandomTableRollRequest,
} from '#shared/abilityAutomation/random'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import {
  createMoveAutomationHistoryResolver,
  type MoveAutomationHistoryResolver,
} from '../moveAutomation/history'
import { createMoveAutomationRoomResolver } from '../moveAutomation/rooms'
import {
  createMoveAutomationStatResolver,
  type MoveAutomationStatResolver,
} from '../moveAutomation/stats'
import {
  emptyAuthoritativeMoveItemResources,
  type AuthoritativeMoveItemCandidate,
  type AuthoritativeMoveItemResourceRequirement,
  type AuthoritativeMoveItemResources,
} from '../moveAutomation/itemResources'
import type { AbilitySpecV1Runtime } from './registry'
import type { AuthoritativeAbilityHandlerContext } from './handlers/registry'
import {
  createAuthoritativeAbilityRandom,
  type AuthoritativeAbilityRandom,
  type AuthoritativeAbilityRandomSource,
} from './random'
import {
  isCanonicalAutomationAbility,
  projectAuthoritativeEffectiveAbilities,
} from './effectiveAbilities'
import {
  RUNTIME_ABILITY_PARAMETER_DEFINITIONS,
  abilityRequiresInstanceParameters,
  resolveSheetAbilityInstances,
} from './instanceParameters'
import {
  createAbilityExecutionBudget,
  type AbilityExecutionBudget,
} from './executionBudget'
import { projectAa081NeutralizingGasAbilities } from './mechanics/aa081NeutralizingGasIntegration'
import { authoritativeAbilityOwnerIsConscious } from './effectiveRuntimeAbilities'
import { projectAbilityCapabilityHpToken } from './capabilityHpInvariants'
import { resolveEffectiveCapabilities } from '../capabilityAutomation/effectiveCapabilities'
import {
  physicalPowerSourceValues,
  projectPhysicalPowerLoadToken,
} from '../capabilityAutomation/physicalPower'

export const AUTHORITATIVE_ABILITY_CONTEXT_LIMITS = Object.freeze({
  targets: 64,
  effectiveAbilitiesPerPlacement: 64,
  capabilities: 64,
  reads: 1_024,
})

export interface ResolveAbilityContextRequest {
  readonly canonicalId: string
  readonly modeId: string
  readonly actorPlacementId: string
  readonly sourcePlacementId?: string
  readonly targetPlacementIds: readonly string[]
  readonly triggeringEvent: AbilitySpecJsonObject | null
}

export const ABILITY_EFFECTIVE_SOURCE_KINDS = [
  'base',
  'granted',
  'copied',
  'replaced',
  'transformed',
] as const
export type AbilityEffectiveSourceKind = (typeof ABILITY_EFFECTIVE_SOURCE_KINDS)[number]

export interface AuthoritativeEffectiveAbility {
  readonly instanceId: string
  readonly canonicalId: string
  readonly sourceKind: AbilityEffectiveSourceKind
  readonly sourcePlacementId: string | null
  readonly definitionHash: string | null
  readonly effective: boolean
  readonly suppressionReasonCode: string | null
  readonly parameterStatus: AbilityInstanceParameterStatus
  readonly parameterData: AbilityInstanceData | null
}

export interface AuthoritativeAbilityResolvedSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly sheet: CharacterSheet | TrainerSheet
}

export interface AuthoritativeAbilityParticipant {
  readonly placement: SheetPlacement
  readonly token: SpawnedPokemon
  readonly sheet: AuthoritativeAbilityResolvedSheet
  readonly effectiveAbilities: readonly AuthoritativeEffectiveAbility[]
}

export type AuthoritativeAbilityRead =
  | {
      readonly kind: 'map'
      readonly slug: string
      readonly revision: number
    }
  | {
      readonly kind: 'sheet'
      readonly sheetKind: SheetKind
      readonly slug: string
      readonly revision: number
    }
  | {
      readonly kind: 'group-inventory'
      readonly slug: string
      readonly revision: number
    }

export interface AuthoritativeAbilityReadSet {
  readonly recordMap: () => void
  readonly recordSheet: (sheet: AuthoritativeAbilityResolvedSheet) => void
  readonly recordPlacement: (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>) => void
  readonly recordGroupInventory: (slug: string, revision: number) => void
  readonly snapshot: () => readonly AuthoritativeAbilityRead[]
}

export interface AuthoritativeAbilityPlacementQueries {
  readonly get: (placementId: string) => SheetPlacement | null
  readonly all: () => readonly SheetPlacement[]
  readonly selected: () => readonly SheetPlacement[]
}

export interface AuthoritativeAbilityTokenQueries {
  readonly get: (placementId: string) => SpawnedPokemon | null
  readonly all: () => readonly SpawnedPokemon[]
}

export interface AuthoritativeAbilitySheetQueries {
  readonly get: (kind: SheetKind, slug: string) => AuthoritativeAbilityResolvedSheet | null
  readonly forPlacement: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => AuthoritativeAbilityResolvedSheet | null
}

export interface AuthoritativeAbilityEffectiveAbilityQueries {
  readonly allForPlacement: (placementId: string) => readonly AuthoritativeEffectiveAbility[]
  readonly activeForPlacement: (placementId: string) => readonly AuthoritativeEffectiveAbility[]
  readonly has: (placementId: string, canonicalId: string) => boolean
}

export type AuthoritativeAbilityRelationship = 'self' | 'ally' | 'enemy' | 'unknown'

export interface AuthoritativeAbilityRelationshipQueries {
  readonly sideId: (placementId: string) => string | null
  readonly relation: (leftPlacementId: string, rightPlacementId: string) => AuthoritativeAbilityRelationship
}

export interface AuthoritativeAbilityEncounterEffectQueries {
  readonly all: () => readonly EncounterEffect[]
  readonly byKind: (kind: EncounterEffect['kind']) => readonly EncounterEffect[]
}

export interface AuthoritativeAbilityItemQueries {
  readonly requirements: () => readonly AuthoritativeMoveItemResourceRequirement[]
  readonly candidates: (requirementId?: string) => readonly AuthoritativeMoveItemCandidate[]
  readonly referencesForRequirement: (requirementId: string) => readonly MoveItemReference[]
  readonly consumedById: (consumptionId: string) => MoveConsumedItemRecord | null
  readonly consumedItems: () => readonly MoveConsumedItemRecord[]
  readonly groupInventory: (slug: string) => unknown | null
}

export interface AuthoritativeAbilityCapabilityQueries {
  readonly all: () => readonly string[]
  readonly has: (capabilityId: string) => boolean
}

export interface AuthoritativeAbilityOwnedStateQueries {
  readonly get: (stateId: string) => AbilityOwnedStateEntry | null
  readonly forAbility: (
    ownerPlacementId: string,
    sourceAbilityInstanceId: string,
  ) => readonly AbilityOwnedStateEntry[]
  readonly byKind: (kind: AbilityOwnedStateKind) => readonly AbilityOwnedStateEntry[]
}

export interface AuthoritativeAbilityEntityQueries {
  readonly get: (entityId: string) => AbilityEntityEntry | null
  readonly targetable: (entityId: string) => AbilityEntityEntry | null
  readonly all: () => readonly AbilityEntityEntry[]
  readonly forAbility: (
    ownerPlacementId: string,
    sourceAbilityInstanceId: string,
  ) => readonly AbilityEntityEntry[]
}

export interface AuthoritativeAbilityTransformationQueries {
  readonly get: (snapshotId: string) => AbilityTransformationSnapshot | null
  readonly all: () => readonly AbilityTransformationSnapshot[]
  readonly forPlacement: (placementId: string) => readonly AbilityTransformationSnapshot[]
}

export interface AuthoritativeAbilityContextQueries {
  readonly placements: AuthoritativeAbilityPlacementQueries
  readonly tokens: AuthoritativeAbilityTokenQueries
  readonly sheets: AuthoritativeAbilitySheetQueries
  readonly effectiveAbilities: AuthoritativeAbilityEffectiveAbilityQueries
  readonly relationships: AuthoritativeAbilityRelationshipQueries
  readonly encounterEffects: AuthoritativeAbilityEncounterEffectQueries
  readonly items: AuthoritativeAbilityItemQueries
  readonly capabilities: AuthoritativeAbilityCapabilityQueries
  readonly ownedState: AuthoritativeAbilityOwnedStateQueries
  readonly entities: AuthoritativeAbilityEntityQueries
  readonly transformations: AuthoritativeAbilityTransformationQueries
  readonly history: MoveAutomationHistoryResolver
  readonly stats: MoveAutomationStatResolver
}

/** Complete detached server-owned facts consumed by ability planning. */
export interface AuthoritativeAbilityContext {
  readonly map: TabletopMap
  readonly request: ResolveAbilityContextRequest
  readonly runtime: AbilitySpecV1Runtime
  readonly resolutionId: string
  readonly ancestry: readonly AbilityResolutionTraceAncestryEntry[]
  readonly random: AuthoritativeAbilityRandom
  readonly budget: AbilityExecutionBudget
  readonly actor: AuthoritativeAbilityParticipant
  readonly source: AuthoritativeAbilityParticipant
  readonly targets: readonly AuthoritativeAbilityParticipant[]
  readonly placements: readonly SheetPlacement[]
  readonly tokens: readonly SpawnedPokemon[]
  readonly resolvedSheets: readonly AuthoritativeAbilityResolvedSheet[]
  readonly sides: EncounterSideDirectory
  readonly encounterEffects: readonly EncounterEffect[]
  readonly encounterHistory: EncounterHistory
  readonly abilityOwnedState: AbilityOwnedState
  readonly abilityEntities: AbilityEntityState
  readonly abilityTransformations: AbilityTransformationState
  readonly ruleset: AbilityRulesetProvenance
  /** One server-captured time for deterministic state-document timestamps. */
  readonly time: number
  readonly queries: AuthoritativeAbilityContextQueries
  readonly reads: AuthoritativeAbilityReadSet
}

export type AuthoritativeAbilityContextErrorCode =
  | 'runtime-identity-mismatch'
  | 'duplicate-placement-id'
  | 'actor-placement-missing'
  | 'source-placement-missing'
  | 'target-placement-missing'
  | 'duplicate-target-id'
  | 'participant-sheet-missing'
  | 'participant-token-unresolved'
  | 'duplicate-effective-ability-instance'
  | 'invalid-effective-ability'
  | 'effective-ability-limit-exceeded'
  | 'capability-limit-exceeded'
  | 'invalid-resolution-identity'
  | 'invalid-time'
  | 'read-revision-conflict'
  | 'read-limit-exceeded'

export class AuthoritativeAbilityContextError extends Error {
  readonly code: AuthoritativeAbilityContextErrorCode

  constructor(code: AuthoritativeAbilityContextErrorCode, detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityContextError'
    this.code = code
  }
}

export interface BuildAuthoritativeAbilityContextInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly request: ResolveAbilityContextRequest
  readonly runtime: AbilitySpecV1Runtime
  readonly resolutionId: string
  readonly ancestry?: readonly AbilityResolutionTraceAncestryEntry[]
  readonly random: AuthoritativeAbilityRandomSource
  readonly randomRoller?: AuthoritativeAbilityRandom
  readonly executionBudget?: AbilityExecutionBudget
  readonly time: number
  /** Optional server-derived replay/recovery projection; normal resolution derives from map effects. */
  readonly effectiveAbilities?: ReadonlyMap<string, readonly AuthoritativeEffectiveAbility[]>
  readonly itemResources?: AuthoritativeMoveItemResources
  readonly ruleset?: AbilityRulesetProvenance
}

const fail = (code: AuthoritativeAbilityContextErrorCode, detail: string): never => {
  throw new AuthoritativeAbilityContextError(code, detail)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const detachedFrozen = <Value>(value: Value): Value => deepFreeze(deepCloneJson(value))

const sheetKey = (value: { readonly kind: SheetKind; readonly slug: string }): string => (
  `${value.kind}:${value.slug}`
)

const readKey = (read: AuthoritativeAbilityRead): string => read.kind === 'sheet'
  ? `sheet:${read.sheetKind}:${read.slug}`
  : `${read.kind}:${read.slug}`

export const deduplicateAuthoritativeAbilityReads = (
  reads: readonly AuthoritativeAbilityRead[],
): readonly AuthoritativeAbilityRead[] => {
  const result: AuthoritativeAbilityRead[] = []
  const byKey = new Map<string, AuthoritativeAbilityRead>()
  for (const input of reads) {
    const read = {
      ...input,
      revision: normalizeRevision(input.revision),
    } as AuthoritativeAbilityRead
    const key = readKey(read)
    const existing = byKey.get(key)
    if (existing) {
      if (existing.revision !== read.revision) {
        fail(
          'read-revision-conflict',
          `${key} was consulted at revisions ${existing.revision} and ${read.revision}.`,
        )
      }
      continue
    }
    if (result.length >= AUTHORITATIVE_ABILITY_CONTEXT_LIMITS.reads) {
      fail('read-limit-exceeded', 'Ability context read set exceeds its bounded limit.')
    }
    byKey.set(key, read)
    result.push(read)
  }
  return detachedFrozen(result)
}

const resolveSheets = (
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): {
  readonly sheets: readonly AuthoritativeAbilityResolvedSheet[]
  readonly byKey: ReadonlyMap<string, AuthoritativeAbilityResolvedSheet>
  readonly lookup: SheetLookup
} => {
  const sheets: AuthoritativeAbilityResolvedSheet[] = []
  const byKey = new Map<string, AuthoritativeAbilityResolvedSheet>()
  const lookup: SheetLookup = { pokemon: new Map(), trainer: new Map() }
  const add = (kind: SheetKind, slug: string, value: CharacterSheet | TrainerSheet): void => {
    const sheet = detachedFrozen(value)
    const resolved = deepFreeze({
      kind,
      slug,
      revision: normalizeRevision(sheet.revision),
      sheet,
    }) as AuthoritativeAbilityResolvedSheet
    sheets.push(resolved)
    byKey.set(sheetKey(resolved), resolved)
    if (kind === 'pokemon') lookup.pokemon.set(slug, sheet as CharacterSheet)
    else lookup.trainer.set(slug, sheet as TrainerSheet)
  }
  pokemonSheets.forEach((sheet, slug) => add('pokemon', slug, sheet))
  trainerSheets.forEach((sheet, slug) => add('trainer', slug, sheet))
  return { sheets: deepFreeze(sheets), byKey, lookup }
}

const resolvePlacements = (map: TabletopMap): {
  readonly placements: readonly SheetPlacement[]
  readonly byId: ReadonlyMap<string, SheetPlacement>
} => {
  const byId = new Map<string, SheetPlacement>()
  for (const placement of map.placements) {
    if (byId.has(placement.id)) {
      fail('duplicate-placement-id', `Placement ${placement.id} appears more than once.`)
    }
    byId.set(placement.id, placement)
  }
  return { placements: map.placements, byId }
}

const resolveTokens = (
  map: TabletopMap,
  placements: readonly SheetPlacement[],
  lookup: SheetLookup,
): ReadonlyMap<string, SpawnedPokemon> => {
  const byId = new Map<string, SpawnedPokemon>()
  for (const placement of placements) {
    const token = placementToSpawned(placement, lookup, map)
    const sheet = placement.sheetKind === 'pokemon'
      ? lookup.pokemon.get(placement.sheetSlug)
      : lookup.trainer.get(placement.sheetSlug)
    if (token && sheet) {
      const effective = resolveEffectiveCapabilities({
        map,
        placement,
        sheet,
        sheets: { pokemon: lookup.pokemon, trainer: lookup.trainer },
      }).instances.filter(instance => instance.effective)
      byId.set(placement.id, detachedFrozen(projectPhysicalPowerLoadToken({
        token: projectAbilityCapabilityHpToken({ map, placement, sheet, token }),
        map,
        placementId: placement.id,
        powerByCapabilityInstanceId: physicalPowerSourceValues(effective),
      })))
    }
  }
  return byId
}

const defaultEffectiveAbilities = (
  placements: readonly SheetPlacement[],
  sheetsByKey: ReadonlyMap<string, AuthoritativeAbilityResolvedSheet>,
  effects: readonly EncounterEffect[],
  transformationSnapshots: AbilityTransformationState | null | undefined,
): ReadonlyMap<string, readonly AuthoritativeEffectiveAbility[]> => {
  const result = new Map<string, readonly AuthoritativeEffectiveAbility[]>()
  for (const placement of placements) {
    const sheet = sheetsByKey.get(sheetKey({ kind: placement.sheetKind, slug: placement.sheetSlug }))
    result.set(placement.id, projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(sheet?.sheet.abilities),
      species: sheet?.kind === 'pokemon' ? (sheet.sheet as CharacterSheet).species : null,
      effects,
      transformationSnapshots,
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
    }))
  }
  return result
}

const EFFECTIVE_ABILITY_FIELDS = [
  'instanceId',
  'canonicalId',
  'sourceKind',
  'sourcePlacementId',
  'definitionHash',
  'effective',
  'suppressionReasonCode',
  'parameterStatus',
  'parameterData',
] as const
const EFFECTIVE_SOURCE_KIND_SET = new Set<string>(ABILITY_EFFECTIVE_SOURCE_KINDS)
const STABLE_EFFECTIVE_ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const DEFINITION_HASH = /^[a-f0-9]{64}$/

const snapshotEffectiveAbilities = (
  source: ReadonlyMap<string, readonly AuthoritativeEffectiveAbility[]>,
  placementIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly AuthoritativeEffectiveAbility[]> => {
  const result = new Map<string, readonly AuthoritativeEffectiveAbility[]>()
  for (const [placementId, values] of source) {
    if (!placementIds.has(placementId) || !Array.isArray(values)) {
      fail('invalid-effective-ability', `Projection key ${placementId} is not an active placement.`)
    }
    if (values.length > AUTHORITATIVE_ABILITY_CONTEXT_LIMITS.effectiveAbilitiesPerPlacement) {
      fail('effective-ability-limit-exceeded', `${placementId} has too many projected abilities.`)
    }
    for (const [index, instance] of values.entries()) {
      const path = `${placementId}[${index}]`
      if (
        typeof instance !== 'object'
        || instance === null
        || Array.isArray(instance)
        || Object.keys(instance).length !== EFFECTIVE_ABILITY_FIELDS.length
        || EFFECTIVE_ABILITY_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(instance, field))
      ) fail('invalid-effective-ability', `${path} has an invalid shape.`)
      if (
        typeof instance.instanceId !== 'string'
        || instance.instanceId.length > 200
        || !STABLE_EFFECTIVE_ID.test(instance.instanceId)
        || typeof instance.canonicalId !== 'string'
        || !isCanonicalAutomationAbility(instance.canonicalId)
        || !EFFECTIVE_SOURCE_KIND_SET.has(instance.sourceKind)
        || (instance.sourcePlacementId !== null && (
          typeof instance.sourcePlacementId !== 'string'
          || instance.sourcePlacementId.length === 0
          || instance.sourcePlacementId.length > 200
        ))
        || (instance.definitionHash !== null && (
          typeof instance.definitionHash !== 'string' || !DEFINITION_HASH.test(instance.definitionHash)
        ))
        || typeof instance.effective !== 'boolean'
        || (instance.effective
          ? instance.suppressionReasonCode !== null
          : typeof instance.suppressionReasonCode !== 'string'
            || !STABLE_EFFECTIVE_ID.test(instance.suppressionReasonCode))
        || !['ready', 'missing-required-data', 'not-parameterized'].includes(instance.parameterStatus)
      ) fail('invalid-effective-ability', `${path} contains invalid authoritative fields.`)
      const requiresParameters = abilityRequiresInstanceParameters(instance.canonicalId)
      if (
        (requiresParameters && instance.parameterStatus === 'not-parameterized')
        || (!requiresParameters && instance.parameterStatus !== 'not-parameterized')
        || (instance.parameterStatus === 'ready' && instance.parameterData === null)
        || (instance.parameterStatus === 'missing-required-data' && (
          instance.parameterData !== null
          || instance.effective
          || instance.suppressionReasonCode !== 'ability.parameters.missing'
        ))
      ) fail('invalid-effective-ability', `${path} has inconsistent parameter status.`)
      if (instance.parameterData !== null) {
        const parameters = parseAbilityInstanceData(
          instance.parameterData,
          instance.canonicalId,
          RUNTIME_ABILITY_PARAMETER_DEFINITIONS,
        )
        if (parameters.instanceId !== instance.instanceId) {
          fail('invalid-effective-ability', `${path} parameter identity does not match.`)
        }
      }
    }
    const instances = detachedFrozen(values)
    const ids = instances.map(instance => instance.instanceId)
    if (new Set(ids).size !== ids.length) {
      fail('duplicate-effective-ability-instance', `${placementId} repeats an ability instance ID.`)
    }
    result.set(placementId, instances)
  }
  return result
}

/** Build and freeze all authoritative ability facts before eligibility or effects execute. */
export const buildAuthoritativeAbilityContext = (
  input: BuildAuthoritativeAbilityContextInput,
): AuthoritativeAbilityContext => {
  if (
    typeof input.resolutionId !== 'string'
    || input.resolutionId.length === 0
    || input.resolutionId.length > 200
    || !/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(input.resolutionId)
  ) {
    fail('invalid-resolution-identity', 'Ability resolution ID must be a bounded stable identifier.')
  }
  if (!Number.isSafeInteger(input.time) || input.time < 0) {
    fail('invalid-time', 'Ability context time must be a non-negative safe integer.')
  }
  if (input.runtime.canonicalId !== input.request.canonicalId) {
    fail(
      'runtime-identity-mismatch',
      `Runtime ${input.runtime.canonicalId} cannot resolve ${input.request.canonicalId}.`,
    )
  }
  if (input.runtime.definition.spec.modes.every(mode => mode.id !== input.request.modeId)) {
    fail('runtime-identity-mismatch', `Runtime has no mode ${input.request.modeId}.`)
  }
  if (input.runtime.definition.capabilityIds.length > AUTHORITATIVE_ABILITY_CONTEXT_LIMITS.capabilities) {
    fail('capability-limit-exceeded', 'Runtime capability set exceeds its bounded limit.')
  }

  const map = detachedFrozen(input.map)
  const request = detachedFrozen(input.request)
  const runtime = detachedFrozen(input.runtime)
  const ancestry = detachedFrozen(input.ancestry ?? [])
  const budget = input.executionBudget ?? createAbilityExecutionBudget({
    initialDepth: ancestry.length,
  })
  if (budget.depth !== ancestry.length) {
    fail('invalid-resolution-identity', 'Execution budget depth must match causal ancestry depth.')
  }
  const unbudgetedRandom = input.randomRoller ?? createAuthoritativeAbilityRandom(input.random)
  const random: AuthoritativeAbilityRandom = Object.freeze({
    roll: (request: AbilityAutomationRandomRollRequest) => {
      budget.consumeRolls(1)
      return unbudgetedRandom.roll(request)
    },
    rollTable: (request: AbilityAutomationRandomTableRollRequest) => {
      budget.consumeRolls(1)
      return unbudgetedRandom.rollTable(request)
    },
    snapshot: () => unbudgetedRandom.snapshot(),
    complete: () => unbudgetedRandom.complete(),
  })
  const ruleset = detachedFrozen(input.ruleset ?? ABILITY_RULESET_PROVENANCE)
  const { sheets: resolvedSheets, byKey: sheetsByKey, lookup } = resolveSheets(
    input.pokemonSheets,
    input.trainerSheets,
  )
  const { placements, byId: placementsById } = resolvePlacements(map)
  const rawTokensById = resolveTokens(map, placements, lookup)
  let effectiveByPlacement = snapshotEffectiveAbilities(
    input.effectiveAbilities ?? defaultEffectiveAbilities(
      placements,
      sheetsByKey,
      map.encounterState?.effects ?? [],
      map.encounterState?.abilityTransformations ?? null,
    ),
    new Set(placements.map(placement => placement.id)),
  )
  effectiveByPlacement = projectAa081NeutralizingGasAbilities({
    abilitiesByPlacement: effectiveByPlacement,
    tokensById: rawTokensById,
    effects: map.encounterState?.effects ?? [],
    preserveSuppressedEntries: true,
  }) as ReadonlyMap<string, readonly AuthoritativeEffectiveAbility[]>
  effectiveByPlacement = new Map([...effectiveByPlacement].map(([placementId, abilities]) => {
    const placement = placementsById.get(placementId)
    const sheet = placement ? sheetsByKey.get(sheetKey({
      kind: placement.sheetKind,
      slug: placement.sheetSlug,
    }))?.sheet : null
    if (sheet && authoritativeAbilityOwnerIsConscious(sheet)) return [placementId, abilities] as const
    return [placementId, Object.freeze(abilities.map(ability => Object.freeze({
      ...ability,
      effective: false,
      suppressionReasonCode: 'ability.suppressed.owner-fainted',
    })))] as const
  }))
  const tokensById = new Map<string, SpawnedPokemon>()
  for (const [placementId, token] of rawTokensById) {
    const effectiveAbilityNames = (effectiveByPlacement.get(placementId) ?? [])
      .filter(ability => ability.effective)
      .map(ability => ability.canonicalId)
    const typeSnapshot = [...(map.encounterState?.abilityTransformations?.entries ?? [])]
      .reverse()
      .find(snapshot => snapshot.placementId === placementId
        && snapshot.mechanics.typeIds.length > 0
        && (effectiveByPlacement.get(snapshot.ownerPlacementId) ?? []).some(ability => (
          ability.effective
          && ability.instanceId === snapshot.sourceAbilityInstanceId
          && ability.canonicalId === snapshot.canonicalId
        )))
    tokensById.set(placementId, detachedFrozen({
      ...token,
      abilityNames: effectiveAbilityNames,
      ...(typeSnapshot ? { defenderTypes: [...typeSnapshot.mechanics.typeIds] } : {}),
    }))
  }
  const tokens = deepFreeze(placements.flatMap(placement => {
    const token = tokensById.get(placement.id)
    return token ? [token] : []
  }))
  const sourcePlacementId = request.sourcePlacementId ?? request.actorPlacementId
  const actorPlacement = placementsById.get(request.actorPlacementId)
    ?? fail('actor-placement-missing', `Actor ${request.actorPlacementId} does not exist.`)
  const sourcePlacement = placementsById.get(sourcePlacementId)
    ?? fail('source-placement-missing', `Source ${sourcePlacementId} does not exist.`)
  if (request.targetPlacementIds.length > AUTHORITATIVE_ABILITY_CONTEXT_LIMITS.targets) {
    fail('target-placement-missing', 'Target count exceeds its bounded limit.')
  }
  if (new Set(request.targetPlacementIds).size !== request.targetPlacementIds.length) {
    fail('duplicate-target-id', 'Target placement IDs must be unique.')
  }
  const targetPlacements = request.targetPlacementIds.map(placementId => (
    placementsById.get(placementId)
      ?? fail('target-placement-missing', `Target ${placementId} does not exist.`)
  ))

  const reads: AuthoritativeAbilityRead[] = [{
    kind: 'map',
    slug: map.slug,
    revision: normalizeRevision(map.revision),
  }]
  const sheetForPlacement = (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ): AuthoritativeAbilityResolvedSheet | null => sheetsByKey.get(sheetKey({
    kind: placement.sheetKind,
    slug: placement.sheetSlug,
  })) ?? null
  const readSet: AuthoritativeAbilityReadSet = Object.freeze({
    recordMap: () => {
      reads.push({ kind: 'map', slug: map.slug, revision: normalizeRevision(map.revision) })
    },
    recordSheet: (sheet: AuthoritativeAbilityResolvedSheet) => {
      reads.push({
        kind: 'sheet',
        sheetKind: sheet.kind,
        slug: sheet.slug,
        revision: sheet.revision,
      })
    },
    recordPlacement: (
      placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
    ) => {
      const sheet = sheetForPlacement(placement)
      if (sheet) reads.push({
        kind: 'sheet',
        sheetKind: sheet.kind,
        slug: sheet.slug,
        revision: sheet.revision,
      })
    },
    recordGroupInventory: (slug: string, revision: number) => {
      reads.push({ kind: 'group-inventory', slug, revision: normalizeRevision(revision) })
    },
    snapshot: () => deduplicateAuthoritativeAbilityReads(reads),
  })

  const participant = (
    placement: SheetPlacement,
  ): AuthoritativeAbilityParticipant => {
    const sheet = sheetForPlacement(placement)
      ?? fail(
        'participant-sheet-missing',
        `Sheet ${placement.sheetKind}/${placement.sheetSlug} is missing for ${placement.id}.`,
      )
    const token = tokensById.get(placement.id)
      ?? fail('participant-token-unresolved', `Placement ${placement.id} cannot resolve a token.`)
    readSet.recordSheet(sheet)
    return deepFreeze({
      placement,
      token,
      sheet,
      effectiveAbilities: effectiveByPlacement.get(placement.id) ?? Object.freeze([]),
    })
  }

  const actor = participant(actorPlacement)
  const source = sourcePlacement.id === actorPlacement.id ? actor : participant(sourcePlacement)
  const targets = deepFreeze(targetPlacements.map(placement => (
    placement.id === actorPlacement.id
      ? actor
      : placement.id === sourcePlacement.id
        ? source
        : participant(placement)
  )))

  const itemResources = input.itemResources ?? emptyAuthoritativeMoveItemResources()
  itemResources.sheetReads.forEach((read) => {
    const sheet = sheetsByKey.get(sheetKey({ kind: read.kind, slug: read.slug }))
    if (sheet) readSet.recordSheet(sheet)
  })
  itemResources.groupInventoryReads.forEach(read => readSet.recordGroupInventory(read.slug, read.revision))
  const itemRequirements = detachedFrozen(itemResources.requirements)
  const itemCandidates = detachedFrozen(itemResources.candidates)
  const groupInventories = new Map(
    [...itemResources.groupInventories].map(([slug, inventory]) => [slug, detachedFrozen(inventory)]),
  )
  const groupInventoryRevisions = new Map(
    itemResources.groupInventoryReads.map(read => [read.slug, normalizeRevision(read.revision)]),
  )

  const encounterEffects = detachedFrozen(map.encounterState?.effects ?? [])
  const encounterHistory = detachedFrozen(
    map.encounterState?.history ?? createEmptyEncounterHistory(),
  )
  const history = createMoveAutomationHistoryResolver(encounterHistory)
  const effectiveAbilityIsActive = (placementId: string, canonicalId: string): boolean => (
    (effectiveByPlacement.get(placementId) ?? []).some(ability => (
      ability.effective && ability.canonicalId === canonicalId
    ))
  )
  const hasEffectiveAbility = (placementId: string, canonicalId: string): boolean => {
    const placement = placementsById.get(placementId)
    if (placement) readSet.recordPlacement(placement)
    return effectiveAbilityIsActive(placementId, canonicalId)
  }
  const rooms = createMoveAutomationRoomResolver(map)
  const stats = createMoveAutomationStatResolver({
    placements,
    tokens,
    hasEffectiveAbility: effectiveAbilityIsActive,
    resolveStatOverlay: (placement, stat) => rooms.statOverlay({ placement, stat }),
    recordSheetRead: (placement) => {
      const sheet = sheetForPlacement(placement)
      if (sheet) readSet.recordSheet(sheet)
    },
  })
  const sides = detachedFrozen(map.encounterState?.sides ?? {})
  const capabilityIds = Object.freeze([...runtime.definition.capabilityIds])
  const capabilitySet = new Set(capabilityIds)
  const abilityOwnedState = parseAbilityOwnedState(
    map.encounterState?.abilityOwnedState ?? createEmptyAbilityOwnedState(),
  )
  const abilityEntities = parseAbilityEntityState(
    map.encounterState?.abilityEntities ?? createEmptyAbilityEntityState(),
  )
  const abilityTransformations = parseAbilityTransformationState(
    map.encounterState?.abilityTransformations ?? createEmptyAbilityTransformationState(),
  )

  const queries: AuthoritativeAbilityContextQueries = Object.freeze({
    placements: Object.freeze({
      get: (placementId: string) => placementsById.get(placementId) ?? null,
      all: () => placements,
      selected: () => targetPlacements,
    }),
    tokens: Object.freeze({
      get: (placementId: string) => tokensById.get(placementId) ?? null,
      all: () => tokens,
    }),
    sheets: Object.freeze({
      get: (kind: SheetKind, slug: string) => {
        const sheet = sheetsByKey.get(sheetKey({ kind, slug })) ?? null
        if (sheet) readSet.recordSheet(sheet)
        return sheet
      },
      forPlacement: (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>) => {
        const sheet = sheetForPlacement(placement)
        if (sheet) readSet.recordSheet(sheet)
        return sheet
      },
    }),
    effectiveAbilities: Object.freeze({
      allForPlacement: (placementId: string) => {
        const placement = placementsById.get(placementId)
        if (placement) readSet.recordPlacement(placement)
        return effectiveByPlacement.get(placementId) ?? Object.freeze([])
      },
      activeForPlacement: (placementId: string) => {
        const placement = placementsById.get(placementId)
        if (placement) readSet.recordPlacement(placement)
        return deepFreeze(
          (effectiveByPlacement.get(placementId) ?? []).filter(ability => ability.effective),
        )
      },
      has: hasEffectiveAbility,
    }),
    relationships: Object.freeze({
      sideId: (placementId: string) => placementsById.get(placementId)?.sideId ?? null,
      relation: (leftPlacementId: string, rightPlacementId: string): AuthoritativeAbilityRelationship => {
        if (leftPlacementId === rightPlacementId) return 'self'
        const left = placementsById.get(leftPlacementId)?.sideId
        const right = placementsById.get(rightPlacementId)?.sideId
        if (!left || !right) return 'unknown'
        return left === right ? 'ally' : 'enemy'
      },
    }),
    encounterEffects: Object.freeze({
      all: () => encounterEffects,
      byKind: (kind: EncounterEffect['kind']) => (
        deepFreeze(encounterEffects.filter(effect => effect.kind === kind))
      ),
    }),
    items: Object.freeze({
      requirements: () => itemRequirements,
      candidates: (requirementId?: string) => requirementId
        ? deepFreeze(itemCandidates.filter(candidate => candidate.requirementId === requirementId))
        : itemCandidates,
      referencesForRequirement: (requirementId: string) => deepFreeze(
        itemCandidates.filter(candidate => candidate.requirementId === requirementId)
          .map(candidate => candidate.reference),
      ),
      consumedById: (consumptionId: string) => itemResources.consumedItems
        .find(item => item.consumptionId === consumptionId) ?? null,
      consumedItems: () => detachedFrozen(itemResources.consumedItems),
      groupInventory: (slug: string) => {
        const revision = groupInventoryRevisions.get(slug)
        if (revision !== undefined) readSet.recordGroupInventory(slug, revision)
        return groupInventories.get(slug) ?? null
      },
    }),
    capabilities: Object.freeze({
      all: () => capabilityIds,
      has: (capabilityId: string) => capabilitySet.has(capabilityId),
    }),
    ownedState: Object.freeze({
      get: (stateId: string) => {
        readSet.recordMap()
        return abilityOwnedState.entries.find(entry => entry.stateId === stateId) ?? null
      },
      forAbility: (ownerPlacementId: string, sourceAbilityInstanceId: string) => {
        readSet.recordMap()
        return Object.freeze(abilityOwnedState.entries.filter(entry => (
          entry.ownerPlacementId === ownerPlacementId
          && entry.sourceAbilityInstanceId === sourceAbilityInstanceId
        )))
      },
      byKind: (kind: AbilityOwnedStateKind) => {
        readSet.recordMap()
        return Object.freeze(abilityOwnedState.entries.filter(entry => entry.payload.kind === kind))
      },
    }),
    entities: Object.freeze({
      get: (entityId: string) => {
        readSet.recordMap()
        return abilityEntities.entries.find(entry => entry.entityId === entityId) ?? null
      },
      targetable: (entityId: string) => {
        readSet.recordMap()
        return abilityEntities.entries.find(entry => (
          entry.entityId === entityId && entry.targetability === 'targetable'
        )) ?? null
      },
      all: () => {
        readSet.recordMap()
        return abilityEntities.entries
      },
      forAbility: (ownerPlacementId: string, sourceAbilityInstanceId: string) => {
        readSet.recordMap()
        return Object.freeze(abilityEntities.entries.filter(entry => (
          entry.ownerPlacementId === ownerPlacementId
          && entry.sourceAbilityInstanceId === sourceAbilityInstanceId
        )))
      },
    }),
    transformations: Object.freeze({
      get: (snapshotId: string) => {
        readSet.recordMap()
        return abilityTransformations.entries.find(entry => entry.snapshotId === snapshotId) ?? null
      },
      all: () => {
        readSet.recordMap()
        return abilityTransformations.entries
      },
      forPlacement: (placementId: string) => {
        readSet.recordMap()
        return Object.freeze(abilityTransformations.entries.filter(entry => entry.placementId === placementId))
      },
    }),
    history,
    stats,
  })

  return Object.freeze({
    map,
    request,
    runtime,
    resolutionId: input.resolutionId,
    ancestry,
    random,
    budget,
    actor,
    source,
    targets,
    placements,
    tokens,
    resolvedSheets,
    sides,
    encounterEffects,
    encounterHistory,
    abilityOwnedState,
    abilityEntities,
    abilityTransformations,
    ruleset,
    time: input.time,
    queries,
    reads: readSet,
  })
}

/** Restrict the complete rules context to the pure registered-handler port. */
export const abilityHandlerContextFromAuthoritativeContext = (
  context: AuthoritativeAbilityContext,
): AuthoritativeAbilityHandlerContext => Object.freeze({
  snapshot: Object.freeze({
    canonicalId: context.request.canonicalId,
    modeId: context.request.modeId,
    actorPlacementId: context.actor.placement.id,
    sourcePlacementId: context.source.placement.id,
    selectedPlacementIds: Object.freeze(context.targets.map(target => target.placement.id)),
    triggeringEvent: context.request.triggeringEvent,
    ruleset: Object.freeze({
      rulesetId: context.ruleset.rulesetId,
      sourceDataSha256: context.ruleset.sourceData.sha256,
    }),
  }),
  queries: Object.freeze({
    placementById: (placementId: string): AbilitySpecJsonObject | null => {
      const placement = context.queries.placements.get(placementId)
      if (!placement) return null
      context.reads.recordPlacement(placement)
      return placement as unknown as AbilitySpecJsonObject
    },
    distanceMeters: (leftPlacementId: string, rightPlacementId: string): number | null => {
      const left = context.queries.placements.get(leftPlacementId)
      const right = context.queries.placements.get(rightPlacementId)
      if (!left || !right) return null
      context.reads.recordPlacement(left)
      context.reads.recordPlacement(right)
      return Math.hypot(
        left.position.x - right.position.x,
        left.position.y - right.position.y,
        left.position.z - right.position.z,
      )
    },
    relation: (leftPlacementId: string, rightPlacementId: string) => (
      context.queries.relationships.relation(leftPlacementId, rightPlacementId)
    ),
    effectiveAbilityIds: (placementId: string) => Object.freeze(
      context.queries.effectiveAbilities.activeForPlacement(placementId)
        .map(ability => ability.canonicalId),
    ),
    ownedStateById: (stateId: string): AbilitySpecJsonObject | null => (
      context.queries.ownedState.get(stateId) as unknown as AbilitySpecJsonObject | null
    ),
    ownedStatesForAbility: (
      ownerPlacementId: string,
      sourceAbilityInstanceId: string,
    ): readonly AbilitySpecJsonObject[] => Object.freeze(
      context.queries.ownedState.forAbility(ownerPlacementId, sourceAbilityInstanceId)
        .map(entry => entry as unknown as AbilitySpecJsonObject),
    ),
    historyCount: (placementId: string, eventKind: string): number => {
      if (eventKind === 'move.completed') {
        return context.queries.history.completedMovesThisScene(placementId).length
      }
      if (eventKind === 'creature.fainted') {
        return context.queries.history.faintedThisScene(placementId) ? 1 : 0
      }
      if (eventKind === 'creature.switched') {
        return context.queries.history.switchedThisScene(placementId) ? 1 : 0
      }
      return 0
    },
  }),
})
