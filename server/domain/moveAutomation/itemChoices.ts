import {
  MOVE_ITEM_CHOICE_LIMITS,
  moveItemChoicePresentationForSelection,
  moveItemChoiceSelectionKey,
  moveItemChoiceSelectionOptionId,
  parseMoveItemChoiceDeclaration,
  type MoveItemChoiceDeclaration,
  type MoveItemResponseSelection,
} from '#shared/moveAutomation/itemChoices'
import { MOVE_RESPONSE_OPTION_LIMITS, type PendingMoveResponseOption } from '#shared/moveAutomation/responseOptions'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import type { AuthoritativeMoveItemResourceQueries } from './itemResources'

export type AuthoritativeMoveItemChoiceErrorCode =
  | 'item-choice-invalid'
  | 'item-choice-option-limit'
  | 'item-choice-option-collision'
  | 'item-choice-option-unknown'

export class AuthoritativeMoveItemChoiceError extends Error {
  readonly code: AuthoritativeMoveItemChoiceErrorCode

  constructor(code: AuthoritativeMoveItemChoiceErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeMoveItemChoiceError'
    this.code = code
  }
}

export interface AuthoritativeMoveItemChoice {
  readonly option: PendingMoveResponseOption & {
    readonly itemChoice: NonNullable<PendingMoveResponseOption['itemChoice']>
    readonly itemSelection: MoveItemResponseSelection
  }
  /** Null is the reviewed explicit-none branch, not a passed response. */
  readonly reference: MoveItemReference | null
  readonly destination: MoveItemChoiceDeclaration['destinations'][number] | null
}

export interface AuthoritativeMoveItemChoiceSet {
  readonly setId: string
  readonly requirementId: string
  readonly owner: MoveItemChoiceDeclaration['owner']
  readonly emptyPolicy: MoveItemChoiceDeclaration['emptyPolicy']
  readonly choices: readonly AuthoritativeMoveItemChoice[]
}

export interface EnumerateAuthoritativeMoveItemChoicesInput {
  readonly declaration: unknown
  readonly items: AuthoritativeMoveItemResourceQueries
}

export interface RevalidateAuthoritativeMoveItemChoiceInput
  extends EnumerateAuthoritativeMoveItemChoicesInput {
  readonly optionId: string
}

const fail = (
  code: AuthoritativeMoveItemChoiceErrorCode,
  message: string,
): never => {
  throw new AuthoritativeMoveItemChoiceError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const referenceKey = (reference: MoveItemReference): string => {
  const owner = reference.owner
  const ownerKey = owner.kind === 'sheet'
    ? `${owner.kind}:${owner.sheetKind}:${owner.slug}`
    : `${owner.kind}:${owner.slug}`
  return `${reference.kind}:${ownerKey}:${reference.itemId}`
}

const eligibleReferences = (
  declaration: MoveItemChoiceDeclaration,
  items: AuthoritativeMoveItemResourceQueries,
): readonly MoveItemReference[] => {
  const allowedKinds = new Set(declaration.filter.referenceKinds)
  const allowedCanonicalIds = declaration.filter.canonicalItemIds === null
    ? null
    : new Set(declaration.filter.canonicalItemIds)
  const allowedTrainerSlots = declaration.filter.trainerEquipmentSlots === null
    ? null
    : new Set(declaration.filter.trainerEquipmentSlots)
  const seen = new Set<string>()
  const result: MoveItemReference[] = []

  for (const reference of items.forRequirement(declaration.requirementId)) {
    if (
      !allowedKinds.has(reference.kind)
      || reference.quantity < declaration.filter.minimumQuantity
      || (allowedCanonicalIds !== null && !allowedCanonicalIds.has(reference.canonicalItemId))
      || (
        reference.kind === 'trainer-equipment-slot'
        && allowedTrainerSlots !== null
        && !allowedTrainerSlots.has(reference.slot)
      )
    ) continue
    const key = referenceKey(reference)
    if (seen.has(key)) {
      return fail(
        'item-choice-invalid',
        `Item choice ${declaration.setId} resolved duplicate physical reference ${key}.`,
      )
    }
    seen.add(key)
    result.push(reference)
  }
  return result
}

const optionForSelection = (input: {
  readonly selection: MoveItemResponseSelection
  readonly labelKey: string
}): AuthoritativeMoveItemChoice['option'] => ({
  id: moveItemChoiceSelectionOptionId(input.selection),
  labelKey: input.labelKey,
  itemChoice: moveItemChoicePresentationForSelection(input.selection),
  itemSelection: input.selection,
})

/**
 * Materialize the deterministic cross-product of legal authoritative item
 * references and reviewed destination branches. No inventory is mutated here.
 */
export const enumerateAuthoritativeMoveItemChoices = (
  input: EnumerateAuthoritativeMoveItemChoicesInput,
): AuthoritativeMoveItemChoiceSet => {
  let declaration: MoveItemChoiceDeclaration
  try {
    declaration = parseMoveItemChoiceDeclaration(input.declaration)
  }
  catch (error) {
    return fail(
      'item-choice-invalid',
      error instanceof Error ? error.message : 'Item choice declaration is invalid.',
    )
  }

  const choices: AuthoritativeMoveItemChoice[] = []
  for (const reference of eligibleReferences(declaration, input.items)) {
    for (const destination of declaration.destinations) {
      const selection: MoveItemResponseSelection = {
        kind: 'move-item',
        setId: declaration.setId,
        requirementId: declaration.requirementId,
        reference,
        destination,
      }
      choices.push({
        option: optionForSelection({ selection, labelKey: 'move.item.choice' }),
        reference,
        destination,
      })
    }
  }

  if (declaration.noneOption) {
    const selection: MoveItemResponseSelection = {
      kind: 'move-item-none',
      setId: declaration.setId,
      optionId: declaration.noneOption.id,
    }
    choices.push({
      option: optionForSelection({
        selection,
        labelKey: declaration.noneOption.labelKey,
      }),
      reference: null,
      destination: null,
    })
  }

  if (choices.length > MOVE_RESPONSE_OPTION_LIMITS.optionsPerWindow) {
    return fail(
      'item-choice-option-limit',
      `Item choice ${declaration.setId} produced ${choices.length} options; at most ${MOVE_RESPONSE_OPTION_LIMITS.optionsPerWindow} are allowed.`,
    )
  }
  if (
    declaration.destinations.length > MOVE_ITEM_CHOICE_LIMITS.destinations
    || choices.length > MOVE_RESPONSE_OPTION_LIMITS.optionsPerWindow
  ) {
    return fail('item-choice-option-limit', 'Item choice declaration exceeds bounded option limits.')
  }

  const optionIds = new Set<string>()
  const selectionKeys = new Set<string>()
  for (const choice of choices) {
    const optionId = choice.option.id
    const selectionKey = moveItemChoiceSelectionKey(choice.option.itemSelection)
    if (optionIds.has(optionId) || selectionKeys.has(selectionKey)) {
      return fail(
        'item-choice-option-collision',
        `Item choice ${declaration.setId} produced an ambiguous durable option identity.`,
      )
    }
    optionIds.add(optionId)
    selectionKeys.add(selectionKey)
  }

  return deepFreeze({
    setId: declaration.setId,
    requirementId: declaration.requirementId,
    owner: declaration.owner,
    emptyPolicy: declaration.emptyPolicy,
    choices,
  })
}

/** Re-enumerate against the fresh authoritative item snapshot on resume. */
export const revalidateAuthoritativeMoveItemChoice = (
  input: RevalidateAuthoritativeMoveItemChoiceInput,
): AuthoritativeMoveItemChoice => {
  const set = enumerateAuthoritativeMoveItemChoices(input)
  return set.choices.find(choice => choice.option.id === input.optionId)
    ?? fail(
      'item-choice-option-unknown',
      `Item option ${input.optionId} is no longer legal for choice ${set.setId}.`,
    )
}
