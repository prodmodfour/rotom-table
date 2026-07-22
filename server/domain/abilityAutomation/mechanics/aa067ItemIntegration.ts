import { createHash } from 'node:crypto'
import type {
  MoveChoiceRequestEffectOperation,
  MoveEffectOperation,
  MoveItemEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveItemChoiceDestinationKind } from '#shared/moveAutomation/itemChoices'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'

/** Delivery Bird expands the physical held-item destination only while effective. */
export const aa067PokemonHeldItemCapacity = (input: {
  readonly map: TabletopMap
  readonly sheet: CharacterSheet
}): 1 | 2 => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Delivery Bird')
  if (!runtime) return 1
  const effective = input.map.placements.some(placement => {
    if (placement.sheetKind !== 'pokemon' || placement.sheetSlug !== input.sheet.slug) return false
    return projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
      effects: input.map.encounterState?.effects ?? [],
      transformationSnapshots: input.map.encounterState?.abilityTransformations,
    }).some(ability => ability.effective && ability.canonicalId === 'Delivery Bird'
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
  })
  return effective ? 2 : 1
}

interface Aa067ExecutableOperationEntry {
  readonly operation: MoveEffectOperation
  readonly path: string
}

const destinationKind = (
  action: MoveItemEffectOperation['payload']['action'],
): MoveItemChoiceDestinationKind => {
  if (action === 'throw' || action === 'knock-to-ground') return 'map-ground'
  if (action === 'give') return 'target-held'
  if (action === 'pickup' || action === 'steal') return 'actor-held'
  return 'none'
}

/**
 * Turn an otherwise ambiguous single-item Move operation into a durable,
 * owner-authorized Delivery Bird choice. One-item operations remain unchanged.
 */
export const applyAa067DeliveryBirdItemChoiceEntries = (
  context: AuthoritativeMoveRulesContext,
  entries: readonly Aa067ExecutableOperationEntry[],
): readonly Aa067ExecutableOperationEntry[] => entries.flatMap((entry) => {
  const operation = entry.operation
  if (operation.kind !== 'item'
    || !('item' in operation.payload)
    || operation.payload.item?.kind !== 'requirement'
    || operation.payload.item.cardinality !== 'one') return [entry]
  const requirementId = operation.payload.item.requirementId
  const references = context.queries.items.forRequirement(requirementId)
  if (references.length !== 2
    || references.some(reference => reference.kind !== 'pokemon-held' || reference.owner.kind !== 'sheet')) {
    return [entry]
  }
  const owner = references[0]!.owner
  if (owner.kind !== 'sheet' || owner.sheetKind !== 'pokemon'
    || references.some(reference => reference.owner.kind !== 'sheet'
      || reference.owner.sheetKind !== owner.sheetKind
      || reference.owner.slug !== owner.slug)) return [entry]
  const ownerPlacement = context.queries.placements.all().find(placement => (
    placement.sheetKind === 'pokemon' && placement.sheetSlug === owner.slug
  ))
  if (!ownerPlacement || !context.queries.abilities.has(ownerPlacement.id, 'Delivery Bird')) return [entry]

  const suffix = createHash('sha256')
    .update(`${context.resolutionId ?? context.intent.moveName}\u0000${operation.id}\u0000${requirementId}\u0000${ownerPlacement.id}`)
    .digest('hex').slice(0, 24)
  const requestOperationId = `ability.delivery-bird.item-choice.${suffix}`
  const requestId = `${requestOperationId}.response`
  const destinationId = `${requestOperationId}.affected`
  const request: MoveChoiceRequestEffectOperation = {
    id: requestOperationId,
    kind: 'choice-request',
    source: operation.source,
    recipients: ownerPlacement.id === context.actor.placement.id
      ? { kind: 'actor' }
      : operation.recipients,
    phase: operation.phase,
    reasonCode: 'ability.delivery-bird.choose-affected-item',
    payload: {
      requestId,
      promptKey: 'ability.delivery-bird.choose-affected-item',
      options: [],
      allowPass: false,
      itemChoice: {
        setId: `ability.delivery-bird.item-set.${suffix}`,
        requirementId,
        owner: ownerPlacement.id === context.actor.placement.id ? 'actor' : 'recipients',
        emptyPolicy: operation.payload.onUnavailable === 'reject' ? 'reject' : 'no-op',
        filter: {
          referenceKinds: ['pokemon-held'], canonicalItemIds: null,
          trainerEquipmentSlots: null, minimumQuantity: 1,
        },
        destinations: [{
          id: destinationId,
          kind: destinationKind(operation.payload.action),
          labelKey: 'ability.delivery-bird.item-affected',
        }],
        noneOption: null,
      },
    },
  }
  const transformed: MoveItemEffectOperation = {
    ...operation,
    source: { kind: 'operation', id: requestOperationId },
    payload: {
      ...operation.payload,
      item: { kind: 'choice', requestId, destinationId },
    },
  } as MoveItemEffectOperation
  return [
    { operation: request, path: `${entry.path}.deliveryBirdChoice` },
    { operation: transformed, path: entry.path },
  ]
})
