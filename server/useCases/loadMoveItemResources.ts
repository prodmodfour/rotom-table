import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { AA077_KLUTZ_ITEM_REQUIREMENT_ID } from '#shared/abilityAutomation/aa077'
import { findMove } from '~~/data/ptuReference'
import { explicitScriptForMove, moveAutomationScriptForTargetBranch } from '~/utils/moveAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  parseAuthoritativeMoveItemResourceRequirements,
  requiredMoveGroupInventorySlugs,
  resolveAuthoritativeMoveItemResources,
  reviewedMoveItemResourceRequirementsFor,
  type AuthoritativeMoveItemResourceRequirement,
  type AuthoritativeMoveItemResources,
} from '../domain/moveAutomation/itemResources'
import type {
  GroupInventoryRepository,
  StoredGroupInventoryDocument,
} from '../storage/groupInventoryRepository'
import { aa077EffectiveAbilityIds } from '../domain/abilityAutomation/mechanics/aa077StaticIntegration'

export interface ResolveMoveItemResourceRequirementInput {
  readonly canonicalMoveId: string
  readonly actorPlacement: SheetPlacement
  readonly intent: ResolveMoveIntent
}

/** Server injection seam for reviewed runtime metadata; never populated from intent data. */
export type ResolveMoveItemResourceRequirementProvider = (
  input: ResolveMoveItemResourceRequirementInput,
) => unknown

export interface LoadMoveItemResourcesInput {
  readonly map: TabletopMap
  readonly intent: ResolveMoveIntent
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly groupInventoryRepository: Pick<GroupInventoryRepository, 'get'>
  readonly requirementProvider?: ResolveMoveItemResourceRequirementProvider
}

const selectedTargetPlacementIds = (intent: ResolveMoveIntent): readonly string[] => {
  if (intent.selection.kind === 'single-target') return [intent.selection.targetPlacementId]
  if (intent.selection.kind === 'target-count') return intent.selection.targetPlacementIds
  return []
}

export const defaultResolveMoveItemResourceRequirementProvider:
ResolveMoveItemResourceRequirementProvider = ({ canonicalMoveId }) => (
  reviewedMoveItemResourceRequirementsFor(canonicalMoveId)
)

const canonicalMoveIdForIntent = (intent: ResolveMoveIntent): string => (
  findMove(intent.moveName)?.name ?? intent.moveName.trim()
)

const loadGroupInventories = (
  requirements: readonly AuthoritativeMoveItemResourceRequirement[],
  repository: Pick<GroupInventoryRepository, 'get'>,
): ReadonlyMap<string, StoredGroupInventoryDocument['document']> => {
  const documents = new Map<string, StoredGroupInventoryDocument['document']>()
  for (const slug of requiredMoveGroupInventorySlugs(requirements)) {
    const stored = repository.get(slug)
    if (stored) documents.set(slug, stored.document)
  }
  return documents
}

/**
 * Read exactly the server-reviewed item documents for one authorized move
 * declaration and return a private normalized candidate snapshot.
 */
export const loadMoveItemResources = (
  input: LoadMoveItemResourcesInput,
): AuthoritativeMoveItemResources => {
  const actorPlacement = input.map.placements.find(
    placement => placement.id === input.intent.placementId,
  )
  if (!actorPlacement) {
    return resolveAuthoritativeMoveItemResources({
      map: input.map,
      actorPlacementId: input.intent.placementId,
      selectedTargetPlacementIds: selectedTargetPlacementIds(input.intent),
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      groupInventories: new Map(),
      requirements: [],
    })
  }

  const canonicalMoveId = canonicalMoveIdForIntent(input.intent)
  const reviewedRequirements = parseAuthoritativeMoveItemResourceRequirements(
    (input.requirementProvider ?? defaultResolveMoveItemResourceRequirementProvider)({
      canonicalMoveId,
      actorPlacement,
      intent: input.intent,
    }),
  )
  const actorSheet = actorPlacement.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(actorPlacement.sheetSlug)
    : input.trainerSheets.get(actorPlacement.sheetSlug)
  const move = findMove(canonicalMoveId)
  const baseScript = explicitScriptForMove(canonicalMoveId)
  const selectedScript = input.intent.targetBranchId && baseScript
    ? moveAutomationScriptForTargetBranch(baseScript, input.intent.targetBranchId)
    : baseScript
  const klutzRequirement = actorSheet
    && move
    && selectedScript?.damaging === true
    && selectedScript.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
    && aa077EffectiveAbilityIds({
      map: input.map,
      placement: actorPlacement,
      sheet: actorSheet,
    }).includes('Klutz')
    ? [{
        id: AA077_KLUTZ_ITEM_REQUIREMENT_ID,
        source: { kind: 'selected-target-equipped' as const },
      }]
    : []
  const requirements = parseAuthoritativeMoveItemResourceRequirements([
    ...reviewedRequirements,
    ...klutzRequirement,
  ])
  const groupInventories = loadGroupInventories(
    requirements,
    input.groupInventoryRepository,
  )
  return resolveAuthoritativeMoveItemResources({
    map: input.map,
    actorPlacementId: actorPlacement.id,
    selectedTargetPlacementIds: selectedTargetPlacementIds(input.intent),
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    groupInventories,
    requirements,
  })
}
