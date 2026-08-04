import type { EncounterChoiceKind, EncounterTargetingKind } from '../encounterPresentation/catalog'
import type {
  EncounterActionOffer,
  EncounterChoiceOffer,
  EncounterChoiceOption,
  EncounterChoiceSelection,
  EncounterPendingInteractionAuthorizedView,
} from '../encounterPresentation/contracts'
import type { EncounterWorkspaceParticipant, EncounterWorkspaceSide } from './model'

export interface EncounterActionDecision {
  readonly kind: 'action'
  readonly interactionId: string
  readonly title: string
  readonly prompt: string
  readonly offer: EncounterActionOffer
  readonly choices: readonly EncounterChoiceOffer[]
  readonly allowPass: false
  readonly allowCancel: true
}

export interface EncounterPendingDecision {
  readonly kind: 'pending'
  readonly interactionId: string
  readonly title: string
  readonly prompt: string
  readonly interaction: EncounterPendingInteractionAuthorizedView
  readonly choices: readonly EncounterChoiceOffer[]
  readonly allowPass: boolean
  readonly allowCancel: boolean
}

export type EncounterDecisionModel = EncounterActionDecision | EncounterPendingDecision

const choiceKindForTarget = (kind: EncounterTargetingKind): EncounterChoiceKind | null => {
  if (kind === 'none' || kind === 'self') return kind === 'self' ? 'participant' : null
  if (kind === 'participant' || kind === 'side' || kind === 'item' || kind === 'move'
    || kind === 'cell' || kind === 'area' || kind === 'direction' || kind === 'destination' || kind === 'path') return kind
  return null
}

const participantOption = (participant: EncounterWorkspaceParticipant): EncounterChoiceOption => ({
  optionId: participant.participantId,
  label: participant.displayName,
  description: [participant.side?.label, participant.roleLabel, participant.hp
    ? `${participant.hp.current}/${participant.hp.maximum} HP`
    : null].filter(Boolean).join(' · '),
  disabled: false,
  unavailableReason: null,
  preview: {
    kind: 'participant',
    participant: {
      participantId: participant.participantId,
      displayName: participant.displayName,
      portraitUrl: participant.portraitUrl,
      sideId: participant.side?.id ?? null,
      sideLabel: participant.side?.label ?? null,
      sideAccent: participant.side?.color ?? null,
      sheetKind: participant.kind === 'pokemon' || participant.kind === 'trainer' ? participant.kind : null,
      statusLabels: [...participant.conditions],
    },
  },
})

const sideOption = (side: EncounterWorkspaceSide): EncounterChoiceOption => ({
  optionId: side.sideId,
  label: side.label,
  description: `${side.participantIds.length} visible participants`,
  disabled: side.status !== 'active',
  unavailableReason: null,
  preview: { kind: 'side', sideId: side.sideId, label: side.label, accent: side.accent },
})

const optionsForTarget = (input: {
  readonly kind: EncounterTargetingKind
  readonly offer: EncounterActionOffer
  readonly participants: readonly EncounterWorkspaceParticipant[]
  readonly sides: readonly EncounterWorkspaceSide[]
}): EncounterChoiceOption[] => {
  if (input.kind === 'self') {
    const actor = input.participants.find(participant => participant.participantId === input.offer.actor.participantId)
    return actor ? [participantOption(actor)] : []
  }
  if (input.kind === 'participant') return input.participants.map(participantOption)
  if (input.kind === 'side') return input.sides.map(sideOption)
  if (input.kind === 'item' || input.kind === 'move') return (input.offer.selectionOptions ?? []).map(option => ({
    optionId: option.value,
    label: option.label,
    description: null,
    disabled: false,
    unavailableReason: null,
    preview: { kind: 'none' },
  }))
  return []
}

export const buildEncounterActionDecision = (input: {
  readonly offer: EncounterActionOffer
  readonly participants: readonly EncounterWorkspaceParticipant[]
  readonly sides: readonly EncounterWorkspaceSide[]
  readonly defaultParticipantIds?: readonly string[]
}): EncounterActionDecision => {
  const interactionId = `action-decision:${input.offer.offerId}`
  const choices = input.offer.targeting.flatMap((target): EncounterChoiceOffer[] => {
    const kind = choiceKindForTarget(target.kind)
    if (!kind) return []
    const options = optionsForTarget({ kind: target.kind, ...input })
    const self = target.kind === 'self'
    return [{
      schemaVersion: 1,
      choiceOfferId: `${interactionId}:${target.requirementId}`,
      interactionId,
      mapSlug: input.offer.mapSlug,
      mapRevision: input.offer.mapRevision,
      choiceId: target.requirementId,
      kind,
      prompt: target.relationshipLabel ?? `Choose ${target.kind}`,
      helpText: [target.rangeLabel, target.requiresLineOfSight ? 'Requires line of sight' : null,
        target.requiresSpatialInput ? 'Exact geometry required' : null].filter(Boolean).join(' · ') || null,
      cardinality: { minimum: self ? 1 : target.minSelections, maximum: self ? 1 : target.maxSelections },
      ordering: kind === 'participant' ? 'initiative' : kind === 'side' ? 'server' : ['cell', 'area', 'direction', 'destination', 'path'].includes(kind) ? 'spatial' : 'server',
      options,
      defaultOptionIds: self && options[0]
        ? [options[0].optionId]
        : kind === 'participant'
          ? (input.defaultParticipantIds ?? [])
              .filter(id => options.some(option => option.optionId === id))
              .slice(0, target.maxSelections)
          : [],
      requiresConfirmation: true,
      allowPass: target.minSelections === 0,
      allowCancel: true,
      expiresAt: null,
    }]
  })
  if (choices.length === 0 && input.offer.selectionOptions?.length) choices.push({
    schemaVersion: 1,
    choiceOfferId: `${interactionId}:resource`,
    interactionId,
    mapSlug: input.offer.mapSlug,
    mapRevision: input.offer.mapRevision,
    choiceId: 'resource',
    kind: input.offer.selectionOptions.every(option => option.kind === 'trainer') ? 'participant' : 'item',
    prompt: 'Choose an authorized option',
    helpText: null,
    cardinality: { minimum: 1, maximum: 1 },
    ordering: 'server',
    options: input.offer.selectionOptions.map(option => ({
      optionId: option.value,
      label: option.label,
      description: option.kind,
      disabled: false,
      unavailableReason: null,
      preview: { kind: 'none' },
    })),
    defaultOptionIds: [],
    requiresConfirmation: true,
    allowPass: false,
    allowCancel: true,
    expiresAt: null,
  })
  return {
    kind: 'action',
    interactionId,
    title: input.offer.presentation.label,
    prompt: input.offer.presentation.description ?? 'Review this action and choose its required inputs.',
    offer: input.offer,
    choices,
    allowPass: false,
    allowCancel: true,
  }
}

export const buildEncounterPendingDecision = (
  interaction: EncounterPendingInteractionAuthorizedView,
): EncounterPendingDecision => ({
  kind: 'pending',
  interactionId: interaction.interactionId,
  title: interaction.source?.displayName ?? 'Decision required',
  prompt: interaction.prompt,
  interaction,
  choices: interaction.choices,
  allowPass: interaction.allowPass,
  allowCancel: interaction.allowCancel,
})

export type EncounterDecisionSelections = Readonly<Record<string, readonly string[]>>

export const initialEncounterDecisionSelections = (
  decision: EncounterDecisionModel,
): EncounterDecisionSelections => Object.fromEntries(
  decision.choices.map(choice => [choice.choiceId, [...choice.defaultOptionIds]]),
)

export const toggleEncounterDecisionOption = (input: {
  readonly selections: EncounterDecisionSelections
  readonly choice: EncounterChoiceOffer
  readonly optionId: string
}): EncounterDecisionSelections => {
  const option = input.choice.options.find(value => value.optionId === input.optionId)
  if (!option || option.disabled) return input.selections
  const current = [...(input.selections[input.choice.choiceId] ?? [])]
  const existing = current.indexOf(input.optionId)
  if (existing >= 0) current.splice(existing, 1)
  else if (input.choice.cardinality.maximum === 1) current.splice(0, current.length, input.optionId)
  else if (current.length < input.choice.cardinality.maximum) current.push(input.optionId)
  if (input.choice.ordering === 'alphabetical') current.sort((left, right) => left.localeCompare(right))
  return { ...input.selections, [input.choice.choiceId]: current }
}

export const encounterDecisionSelectionsValid = (
  decision: EncounterDecisionModel,
  selections: EncounterDecisionSelections,
): boolean => decision.choices.every((choice) => {
  const values = selections[choice.choiceId] ?? []
  const validOptions = new Set(choice.options.filter(option => !option.disabled).map(option => option.optionId))
  const spatialChoice = choice.ordering === 'spatial' && choice.options.length === 0
  return spatialChoice
    ? false
    : values.length >= choice.cardinality.minimum
      && values.length <= choice.cardinality.maximum
      && new Set(values).size === values.length
      && values.every(value => validOptions.has(value))
})

export const encounterDecisionChoiceSelections = (
  decision: EncounterDecisionModel,
  selections: EncounterDecisionSelections,
): EncounterChoiceSelection[] => decision.choices.map(choice => ({
  choiceId: choice.choiceId,
  optionIds: [...(selections[choice.choiceId] ?? [])],
}))
