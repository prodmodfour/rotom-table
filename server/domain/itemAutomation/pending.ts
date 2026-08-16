import type {
  ItemPendingChoiceV1,
  ItemPendingDecisionV1,
  UseItemCommandV1,
} from '#shared/itemAutomation/operations'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { AuthoritativeItemInventoryInstance } from '#shared/itemAutomation/inventory'
import type { ItemLegalTarget } from './eligibility'

const choicePrivacy = (
  definition: ItemRuntimeDefinition,
  value?: 'public' | 'actor-owner' | 'responder-owner' | 'gm',
): 'public' | 'actor-owner' | 'responder-owner' | 'gm' => value ?? (definition.spec.privacy.choices === 'gm'
  ? 'gm'
  : definition.spec.privacy.choices === 'responder-owner'
    ? 'responder-owner'
    : definition.spec.privacy.choices === 'public'
      ? 'public' : 'actor-owner')

const targetChoice = (
  definition: ItemRuntimeDefinition,
  legalTargets: readonly ItemLegalTarget[],
): ItemPendingChoiceV1 | null => {
  const target = definition.spec.targets[0]
  if (!target || target.kind !== 'participant') return null
  return Object.freeze({
    choiceId: target.targetId,
    kind: target.kind,
    minimum: target.minimum,
    maximum: target.maximum,
    options: Object.freeze(legalTargets.map(value => Object.freeze({
      optionId: value.participantId,
      label: value.description ? `${value.label} — ${value.description}` : value.label,
    }))),
    privateTo: 'actor-owner',
  })
}

/** Build the exact bounded decision snapshot persisted with a reservation. */
export const buildItemPendingDecision = (input: {
  readonly command: UseItemCommandV1
  readonly definition: ItemRuntimeDefinition
  readonly source: AuthoritativeItemInventoryInstance
  readonly legalTargets: readonly ItemLegalTarget[]
}): ItemPendingDecisionV1 => {
  const spec = input.definition.spec
  const choices: ItemPendingChoiceV1[] = []
  const target = targetChoice(input.definition, input.legalTargets)
  if (target) choices.push(target)
  for (const choice of spec.choices) {
    let options = choice.options
    if (choice.kind === 'gm-adjudication' && choice.choiceId === 'gm-loyalty-outcome') {
      const selectedTarget = input.command.targetIds.length === 1
        ? input.legalTargets.find(candidate => candidate.participantId === input.command.targetIds[0])
        : null
      if (selectedTarget?.sheetKind === 'trainer') {
        options = options.filter(option => option.optionId === 'record-no-loyalty-change')
      }
    }
    if (choice.optionSource === 'authority') {
      const effectId = choice.kind === 'condition' && choice.choiceId.startsWith('condition:')
        ? choice.choiceId.slice('condition:'.length)
        : null
      const removal = effectId
        ? spec.effects.find(effect => effect.operation === 'remove-conditions'
          && effect.effectId === effectId && effect.selection === 'choose-one')
        : null
      const selectedTargetId = input.command.targetIds.length === 1 ? input.command.targetIds[0] : null
      const selectedTarget = selectedTargetId
        ? input.legalTargets.find(candidate => candidate.participantId === selectedTargetId)
        : null
      const advancementChoice = selectedTarget?.permanentAdvancementPreview?.choices
        .find(candidate => candidate.choiceId === choice.choiceId)
      const machineChoice = selectedTarget?.machineMoveLearningPreview?.choices
        .find(candidate => candidate.choiceId === choice.choiceId)
      const evolutionChoice = selectedTarget?.itemEvolutionPreview?.choices
        .find(candidate => candidate.choiceId === choice.choiceId)
      const explorationChoice = selectedTarget?.explorationChoices
        ?.find(candidate => candidate.choiceId === choice.choiceId)
      const authorityChoice = advancementChoice ?? machineChoice ?? evolutionChoice
      if (removal && selectedTarget?.conditionRemovalPreview) {
        options = selectedTarget.conditionRemovalPreview.options.map(option => ({
          optionId: option.conditionId,
          label: option.matchingCount > 1 ? `${option.label} ×${option.matchingCount}` : option.label,
        }))
      }
      else if (explorationChoice) {
        options = explorationChoice.options.map(option => ({
          optionId: option.optionId,
          label: option.description ? `${option.label} — ${option.description}` : option.label,
        }))
      }
      else if (authorityChoice) {
        options = authorityChoice.options.map(option => ({
          optionId: option.optionId,
          label: option.description ? `${option.label} — ${option.description}` : option.label,
        }))
      }
      else {
        throw new Error(`Item choice ${choice.choiceId} requires an eligible target before authority can derive options.`)
      }
    }
    choices.push(Object.freeze({
      choiceId: choice.choiceId,
      kind: choice.kind,
      minimum: choice.minimum,
      maximum: choice.maximum,
      options: Object.freeze(options.map(option => Object.freeze({ ...option }))),
      privateTo: choicePrivacy(input.definition, choice.privateTo),
    }))
  }
  if (choices.length === 0) throw new Error('An item pending decision requires at least one unresolved choice.')
  return Object.freeze({
    schemaVersion: 1,
    operationId: input.command.operationId,
    decisionId: `item-decision:${input.command.operationId.toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-')}`,
    canonicalItemId: input.definition.canonicalId,
    sourceInstanceId: input.source.instanceId,
    reservation: spec.consumption.reserveWhilePending ? Object.freeze({
      reservationId: `item-reservation:${input.command.operationId.toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-')}`,
      quantity: spec.consumption.quantity,
    }) : null,
    choices: Object.freeze(choices),
  })
}

export const itemPendingDecisionNeedsInput = (
  command: UseItemCommandV1,
  decision: ItemPendingDecisionV1,
): boolean => decision.choices.some((choice) => {
  const selected = choice.kind === 'participant' && command.targetIds.length > 0
    ? command.targetIds
    : command.choices.find(value => value.choiceId === choice.choiceId)?.optionIds ?? []
  const legal = new Set(choice.options.map(option => option.optionId))
  return selected.length < choice.minimum || selected.length > choice.maximum
    || selected.some(optionId => !legal.has(optionId))
})

/** Bind an exact resume to the original operation and persisted option set. */
export const commandFromItemPendingDecision = (input: {
  readonly command: UseItemCommandV1
  readonly decision: ItemPendingDecisionV1
  readonly choices: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
}): UseItemCommandV1 => {
  if (input.command.operationId !== input.decision.operationId
    || input.command.sourceInstanceId !== input.decision.sourceInstanceId) {
    throw new Error('Item pending decision no longer matches its original command.')
  }
  const selected = new Map(input.choices.map(choice => [choice.choiceId, [...choice.optionIds]]))
  if (selected.size !== input.choices.length) throw new Error('Item pending resume contains duplicate choice identities.')
  for (const choice of input.decision.choices) {
    const optionIds = selected.get(choice.choiceId) ?? []
    const legal = new Set(choice.options.map(option => option.optionId))
    if (optionIds.length < choice.minimum || optionIds.length > choice.maximum
      || new Set(optionIds).size !== optionIds.length || optionIds.some(id => !legal.has(id))) {
      throw new Error(`Item pending choice ${choice.choiceId} is incomplete or unauthorized.`)
    }
  }
  if ([...selected.keys()].some(id => !input.decision.choices.some(choice => choice.choiceId === id))) {
    throw new Error('Item pending resume contains an unknown choice identity.')
  }
  const targetChoiceId = input.decision.choices.find(choice => choice.kind === 'participant')?.choiceId ?? null
  const targetIds = targetChoiceId ? selected.get(targetChoiceId) ?? [] : input.command.targetIds
  return Object.freeze({
    ...input.command,
    targetIds: Object.freeze([...targetIds]),
    choices: Object.freeze(input.decision.choices.map(choice => Object.freeze({
      choiceId: choice.choiceId,
      optionIds: Object.freeze([...(selected.get(choice.choiceId) ?? [])]),
    }))),
  })
}
