import {
  parseAbilityMoveProviders,
  parseAbilityMoveRuntimeSnapshot,
  resolveAbilityMoveProviders,
  type AbilityMoveProviderResolution,
  type AbilityMoveRuntimeSnapshot,
  type AbilityNestedMoveUse,
} from '#shared/abilityAutomation/moveProviders'
import { POKEMON_TYPES } from '#shared/pokemonTypes'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { TrainerMove } from '~/types/trainerSheet'
import type { AuthoritativeAbilityContext } from './context'
import { registeredMoveAutomationRuntimeFor } from '../moveAutomation/registry'
import type { AbilityExecutionBudget } from './executionBudget'

export class AuthoritativeAbilityMoveProviderError extends Error {
  constructor(readonly code:
    | 'owner-missing' | 'owner-sheet-missing' | 'source-placement-missing'
    | 'source-ability-inactive' | 'move-runtime-missing' | 'move-runtime-mismatch'
    | 'nested-depth-exceeded', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityMoveProviderError'
  }
}
const fail = (code: AuthoritativeAbilityMoveProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityMoveProviderError(code, detail)
}
const slug = (value: string | null | undefined): string | null => {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return normalized || null
}
const typeId = (value: string | null | undefined) => {
  const canonical = POKEMON_TYPES.find(type => type.toLowerCase() === value?.trim().toLowerCase())
  return canonical ? canonical.toLowerCase() as Lowercase<typeof canonical> : null
}
const validateRuntimeSnapshot = (snapshotValue: unknown): AbilityMoveRuntimeSnapshot => {
  const snapshot = parseAbilityMoveRuntimeSnapshot(snapshotValue)
  const runtime = registeredMoveAutomationRuntimeFor(snapshot.canonicalMoveId)
    ?? fail('move-runtime-missing', `Move ${snapshot.canonicalMoveId} has no selected production runtime.`)
  if (runtime.kind !== 'movespec-v2'
    || runtime.version !== snapshot.runtimeVersion
    || runtime.definitionHash !== snapshot.definitionHash
    || runtime.sourceModule !== snapshot.sourceModule) {
    fail('move-runtime-mismatch', `Move ${snapshot.canonicalMoveId} runtime reference changed.`)
  }
  return snapshot
}
const snapshotForSheetMove = (
  ownerPlacementId: string,
  move: CharacterSheetMove | TrainerMove,
  index: number,
): AbilityMoveRuntimeSnapshot => {
  const runtime = registeredMoveAutomationRuntimeFor(move.name)
    ?? fail('move-runtime-missing', `Sheet move ${move.name} has no selected production runtime.`)
  if (runtime.kind !== 'movespec-v2') return fail('move-runtime-mismatch', `Sheet move ${move.name} is not MoveSpec v2.`)
  return parseAbilityMoveRuntimeSnapshot({
    moveInstanceId: `sheet:${ownerPlacementId}:${index}`,
    canonicalMoveId: move.name,
    runtimeKind: 'movespec-v2',
    runtimeVersion: runtime.version,
    definitionHash: runtime.definitionHash,
    sourceModule: runtime.sourceModule,
    sourceKind: 'sheet',
    mechanics: {
      typeId: typeId(move.type),
      damageBase: Number.isSafeInteger(move.db) && Number(move.db) >= 0 ? Number(move.db) : null,
      accuracyCheck: Number.isSafeInteger(Number(move.ac)) && Number(move.ac) >= 0 ? Number(move.ac) : null,
      damageClass: move.category?.toLowerCase() ?? null,
      frequencyId: slug(move.frequency),
      rangeId: slug(move.range),
      keywords: [...runtime.definition.spec.presentation.tags].sort(),
    },
  })
}
const providerSnapshots = (providers: ReturnType<typeof parseAbilityMoveProviders>): readonly AbilityMoveRuntimeSnapshot[] => providers.flatMap((provider) => {
  const effect = provider.effect
  if (effect.kind === 'grant' || effect.kind === 'replacement') return effect.moves
  if (effect.kind === 'nested-use') return [effect.move]
  return []
})

/** Resolve a sheet movelist plus reviewed ability projections against exact MoveSpec runtimes. */
export const resolveAuthoritativeAbilityMoveProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly ownerPlacementId: string
  readonly parentOperationId: string
  readonly providers: unknown
}): AbilityMoveProviderResolution => {
  const owner = input.context.queries.placements.get(input.ownerPlacementId)
    ?? fail('owner-missing', `Move owner ${input.ownerPlacementId} is missing.`)
  const sheet = input.context.queries.sheets.forPlacement(owner)
    ?? fail('owner-sheet-missing', `Move owner ${input.ownerPlacementId} sheet is missing.`)
  const providers = parseAbilityMoveProviders(input.providers)
  for (const provider of providers) {
    if (!input.context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Move provider ${provider.providerId} source is missing.`)
    }
    if (!input.context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `Move provider ${provider.providerId} source ability is inactive.`)
    }
  }
  providerSnapshots(providers).forEach(validateRuntimeSnapshot)
  const movelist = (sheet.sheet.movelist ?? []) as readonly (CharacterSheetMove | TrainerMove)[]
  const baseMoves = movelist.map((move, index) => snapshotForSheetMove(input.ownerPlacementId, move, index))
  return resolveAbilityMoveProviders({
    ownerPlacementId: input.ownerPlacementId,
    parentOperationId: input.parentOperationId,
    baseMoves,
    providers,
  })
}

/** Consume both global and provider-local depth before handing a nested move to move orchestration. */
export const authorizeAbilityNestedMoveUse = (input: {
  readonly nestedUse: AbilityNestedMoveUse
  readonly budget: AbilityExecutionBudget
}): { readonly runtime: NonNullable<ReturnType<typeof registeredMoveAutomationRuntimeFor>>; readonly budget: AbilityExecutionBudget } => {
  if (input.budget.depth + 1 > input.nestedUse.maximumDepth) {
    fail('nested-depth-exceeded', `Nested move ${input.nestedUse.move.canonicalMoveId} exceeded provider depth.`)
  }
  const snapshot = validateRuntimeSnapshot(input.nestedUse.move)
  const runtime = registeredMoveAutomationRuntimeFor(snapshot.canonicalMoveId)!
  return Object.freeze({ runtime, budget: input.budget.child() })
}
