import { createHash } from 'node:crypto'
import { parseAbilityItemProviders } from '#shared/abilityAutomation/itemProviders'
import { isLivePlayOpId } from '#shared/livePlayCommands'
import type { MoveItemEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveSpecResolvedItemChoice } from '../moveAutomation/executeSpec'
import type { AuthoritativeMoveRulesContext } from '../moveAutomation/context'
import type { AuthoritativeMoveItemResourceRequirement } from '../moveAutomation/itemResources'
import {
  interpretMoveItemEffects,
  type InterpretedMoveItemEffects,
  type MoveResolvedItemEffectOperation,
} from '../moveAutomation/itemEffectInterpreter'
import { planMoveItemMutations } from '../moveAutomation/planItemMutations'
import type { PlannedMoveItemMutations } from '../moveAutomation/itemMutationTypes'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { AuthoritativeAbilityContext, AuthoritativeAbilityParticipant } from './context'

export const AA094_SYMBIOSIS_ITEM_REQUIREMENT_ID = 'ability.symbiosis.actor-held' as const

/** Minimal private item scopes required by direct ability declarations. */
export const authoritativeAbilityItemResourceRequirementsFor = (
  canonicalId: string,
): readonly AuthoritativeMoveItemResourceRequirement[] => canonicalId === 'Symbiosis'
  ? Object.freeze([Object.freeze({
      id: AA094_SYMBIOSIS_ITEM_REQUIREMENT_ID,
      source: Object.freeze({ kind: 'actor-equipped' as const }),
    })])
  : Object.freeze([])

export class AuthoritativeAbilityItemProviderError extends Error {
  constructor(readonly code:
    | 'source-placement-missing' | 'source-ability-inactive' | 'owner-unavailable'
    | 'recipient-unavailable' | 'item-resource-unavailable', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityItemProviderError'
  }
}
const fail = (code: AuthoritativeAbilityItemProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityItemProviderError(code, detail)
}
const participantFor = (
  context: AuthoritativeAbilityContext,
  placementId: string,
): AuthoritativeAbilityParticipant => {
  const participant = [context.actor, context.source, ...context.targets]
    .find(entry => entry.placement.id === placementId)
  if (participant) return participant
  return fail('owner-unavailable', `Item provider owner ${placementId} is not a selected participant.`)
}
const moveContextFor = (
  context: AuthoritativeAbilityContext,
  ownerPlacementId: string,
): AuthoritativeMoveRulesContext => {
  const actor = participantFor(context, ownerPlacementId)
  return {
    ...context,
    actor,
    queries: {
      ...context.queries,
      items: {
        forRequirement: (requirementId: string) => context.queries.items.referencesForRequirement(requirementId),
        consumedById: (consumptionId: string) => context.queries.items.consumedById(consumptionId),
      },
    },
  } as unknown as AuthoritativeMoveRulesContext
}

export interface AuthoritativeAbilityItemProviderPlan {
  readonly interpretation: InterpretedMoveItemEffects
  readonly mutations: PlannedMoveItemMutations
}
/** Compile ability item providers through the shared item interpreter and transactional reducer. */
export const planAuthoritativeAbilityItemProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly parentOperationId: string
  readonly resolvedItemChoices?: readonly MoveSpecResolvedItemChoice[]
}): AuthoritativeAbilityItemProviderPlan => {
  const providers = parseAbilityItemProviders(input.providers)
  const allowedParticipants = new Set([
    input.context.actor.placement.id,
    input.context.source.placement.id,
    ...input.context.targets.map(target => target.placement.id),
  ])
  for (const provider of providers) {
    if (!input.context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Item provider ${provider.providerId} source is missing.`)
    }
    if (!input.context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `Item provider ${provider.providerId} source ability is inactive.`)
    }
    if (!allowedParticipants.has(provider.ownerPlacementId)) {
      fail('owner-unavailable', `Item provider ${provider.providerId} owner was not selected.`)
    }
    if (provider.recipientPlacementIds.some(id => !allowedParticipants.has(id))) {
      fail('recipient-unavailable', `Item provider ${provider.providerId} has an unselected recipient.`)
    }
  }
  const operationToProvider = new Map<string, typeof providers[number]>()
  const operations: MoveResolvedItemEffectOperation[] = providers.map((provider): MoveResolvedItemEffectOperation => {
    const candidateId = `${input.parentOperationId}.${provider.providerId}`
    const operationId = candidateId.length <= 160
      ? candidateId
      : `ability.item.${createHash('sha256').update(candidateId).digest('hex')}`
    const operation: MoveItemEffectOperation = {
      id: operationId,
      kind: 'item',
      source: { kind: 'operation', id: input.parentOperationId },
      recipients: { kind: 'selected-targets' },
      phase: 'cleanup',
      reasonCode: provider.reasonCode,
      payload: provider.payload,
    }
    operationToProvider.set(operation.id, provider)
    return Object.freeze({ operation, recipientIds: provider.recipientPlacementIds })
  })
  const fallbackContext = providers[0]
    ? moveContextFor(input.context, providers[0].ownerPlacementId)
    : moveContextFor(input.context, input.context.actor.placement.id)
  const interpretation = interpretMoveItemEffects({
    context: fallbackContext,
    operations,
    resolvedItemChoices: input.resolvedItemChoices ?? [],
    contextForOperation: operation => moveContextFor(
      input.context,
      operationToProvider.get(operation.id)?.ownerPlacementId
        ?? fail('owner-unavailable', `Item operation ${operation.id} lost provider ownership.`),
    ),
  })
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  input.context.resolvedSheets.forEach((sheet) => {
    if (sheet.kind === 'pokemon') pokemonSheets.set(sheet.slug, sheet.sheet as CharacterSheet)
    else trainerSheets.set(sheet.slug, sheet.sheet as TrainerSheet)
  })
  const groupInventories = new Map<string, GroupInventoryDocument>()
  for (const requirement of input.context.queries.items.requirements()) {
    if (requirement.source.kind !== 'group-inventory') continue
    const inventory = input.context.queries.items.groupInventory(requirement.source.slug)
    if (!inventory) fail('item-resource-unavailable', `Group inventory ${requirement.source.slug} is missing.`)
    groupInventories.set(requirement.source.slug, inventory as GroupInventoryDocument)
  }
  const originOperationId = isLivePlayOpId(input.parentOperationId)
    ? input.parentOperationId
    : `op_ability_${createHash('sha256').update(input.parentOperationId).digest('hex').slice(0, 24)}`
  const mutations = planMoveItemMutations({
    map: input.context.map,
    pokemonSheets,
    trainerSheets,
    groupInventories,
    operations: interpretation.mutations,
    consumedItems: input.context.queries.items.consumedItems(),
    originOperationId,
    plannedAt: input.context.time,
  })
  return Object.freeze({ interpretation, mutations })
}
