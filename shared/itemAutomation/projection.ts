import type { EncounterActionOffer } from '../encounterPresentation/contracts'
import { parseEncounterActionOffer } from '../encounterPresentation/validation'
import { parseItemInventoryInstanceId } from './inventory'
import { parseUseItemCommand, type UseItemCommandV1 } from './operations'
import {
  parseExecuteItemFormChangeCommand,
  type ExecuteItemFormChangeCommandV1,
} from './formChanges'

/** Declaration-only receipt shape; `itemCommand` is absent from workspace offers. */
export type AuthorizedItemActionOffer = EncounterActionOffer & {
  readonly itemCommand?: UseItemCommandV1
  readonly itemFormChangeCommand?: ExecuteItemFormChangeCommandV1
}

export const parseAuthorizedItemActionOffer = (value: unknown): AuthorizedItemActionOffer => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ItemActionProjectionError('The item declaration receipt must be an object.')
  }
  const {
    itemCommand: rawItemCommand,
    itemFormChangeCommand: rawItemFormChangeCommand,
    ...rawOffer
  } = value as Record<string, unknown>
  const offer = parseEncounterActionOffer(rawOffer)
  const authorityCount = Number(rawItemCommand !== undefined) + Number(rawItemFormChangeCommand !== undefined)
  if (offer.source.sourceKind === 'item' && authorityCount !== 1) {
    throw new ItemActionProjectionError('The item declaration receipt must include exactly one private command authority.')
  }
  if (offer.source.sourceKind !== 'item' && authorityCount !== 0) {
    throw new ItemActionProjectionError('A non-item declaration included unexpected item command authority.')
  }
  if (rawItemCommand !== undefined) {
    return Object.freeze({ ...offer, itemCommand: parseUseItemCommand(rawItemCommand) })
  }
  if (rawItemFormChangeCommand !== undefined) {
    return Object.freeze({
      ...offer,
      itemFormChangeCommand: parseExecuteItemFormChangeCommand(rawItemFormChangeCommand),
    })
  }
  return offer
}

export class ItemActionProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItemActionProjectionError'
  }
}

/** Bind client choices to a server-issued private command template without accepting client mechanics. */
export const itemFormChangeCommandFromAuthorizedOffer = (input: {
  readonly offer: AuthorizedItemActionOffer
  readonly operationId: string
}): ExecuteItemFormChangeCommandV1 => {
  const template = input.offer.itemFormChangeCommand
  if (input.offer.source.sourceKind !== 'item' || !template
    || input.offer.intent.actionId !== 'item.form-change.mega-evolve') {
    throw new ItemActionProjectionError('The form-change declaration did not include authoritative command authority.')
  }
  if (!input.operationId.trim()) throw new ItemActionProjectionError('An item form-change operation ID is required.')
  return parseExecuteItemFormChangeCommand({ ...template, operationId: input.operationId })
}

export const itemCommandFromAuthorizedOffer = (input: {
  readonly offer: AuthorizedItemActionOffer
  readonly operationId: string
  readonly choices: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
}): UseItemCommandV1 => {
  const template = input.offer.itemCommand
  const sourceInstanceId = input.offer.source.instanceId
  if (input.offer.source.sourceKind !== 'item' || !template || !sourceInstanceId) {
    throw new ItemActionProjectionError('The item declaration did not include an authoritative command template.')
  }
  if (!parseItemInventoryInstanceId(sourceInstanceId) || template.offerId !== input.offer.offerId
    || template.sourceInstanceId !== sourceInstanceId) {
    throw new ItemActionProjectionError('The item declaration template does not match its authoritative offer.')
  }
  if (!input.operationId.trim()) throw new ItemActionProjectionError('An item operation ID is required.')
  const participantTargetChoiceIds = new Set(input.offer.targeting
    .filter(target => target.kind === 'participant' || target.kind === 'self')
    .map(target => target.requirementId))
  const targetIds = [...new Set(input.choices
    .filter(choice => participantTargetChoiceIds.has(choice.choiceId))
    .flatMap(choice => choice.optionIds))]
  return {
    ...template,
    operationId: input.operationId,
    offerId: input.offer.offerId,
    sourceInstanceId,
    targetIds,
    choices: input.choices.map(choice => ({ choiceId: choice.choiceId, optionIds: [...choice.optionIds] })),
  }
}
