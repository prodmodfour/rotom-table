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

const participantOption = (
  participant: EncounterWorkspaceParticipant,
  projected?: {
    readonly label: string
    readonly description?: string | null
    readonly disabled?: boolean
    readonly unavailableReason?: EncounterChoiceOption['unavailableReason']
  },
): EncounterChoiceOption => ({
  optionId: participant.participantId,
  label: projected?.label ?? participant.displayName,
  description: projected?.description ?? [participant.side?.label, participant.roleLabel, participant.hp
    ? `${participant.hp.current}/${participant.hp.maximum} HP`
    : null].filter(Boolean).join(' · '),
  disabled: projected?.disabled ?? false,
  unavailableReason: projected?.unavailableReason ?? null,
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

const projectedCell = (value: string): { readonly x: number, readonly y: number, readonly z: number } | null => {
  const match = /^cell:(\d+):(\d+):(\d+)$/u.exec(value)
  return match ? Object.freeze({ x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }) : null
}

const optionsForTarget = (input: {
  readonly target: EncounterActionOffer['targeting'][number]
  readonly offer: EncounterActionOffer
  readonly participants: readonly EncounterWorkspaceParticipant[]
  readonly sides: readonly EncounterWorkspaceSide[]
}): EncounterChoiceOption[] => {
  const kind = input.target.kind
  const requirementOptions = (input.offer.selectionOptions ?? []).filter(option => (
    option.requirementId === undefined || option.requirementId === input.target.requirementId
  ))
  if (kind === 'self') {
    const actor = input.participants.find(participant => participant.participantId === input.offer.actor.participantId)
    return actor ? [participantOption(actor)] : []
  }
  if (kind === 'participant') {
    const relationship = input.target.relationshipLabel?.toLowerCase() ?? ''
    const projected = requirementOptions.filter(option => option.kind === 'participant')
    // Item eligibility is source-owned. An empty server set is empty, never a
    // signal for the browser to manufacture candidates from visible HP/state.
    if (input.offer.source.sourceKind === 'item' && projected.length === 0) return []
    const projectedById = new Map(projected.map(option => [option.value, option]))
    return input.participants
      .filter((participant) => {
        if (projected.length > 0 && !projectedById.has(participant.participantId)) return false
        if (relationship === 'self') return participant.participantId === input.offer.actor.participantId
        if (relationship === 'controlled') return participant.controlled
        if (relationship === 'owned') return participant.controlled
        if (relationship === 'ally') return participant.side?.id !== null && participant.side?.id === input.offer.actor.sideId
        if (relationship === 'foe') return participant.side?.id !== null && input.offer.actor.sideId !== null && participant.side?.id !== input.offer.actor.sideId
        return true
      })
      .map(participant => participantOption(participant, projectedById.get(participant.participantId)))
  }
  if (kind === 'side') return input.sides.map(sideOption)
  if (kind === 'item' || kind === 'move') return requirementOptions
    .filter(option => option.kind !== 'participant' && option.kind !== 'cell')
    .map(option => ({
    optionId: option.value,
    label: option.label,
    description: option.description ?? null,
    disabled: option.disabled ?? false,
    unavailableReason: option.unavailableReason ?? null,
    preview: { kind: 'none' },
  }))
  if (kind === 'cell' || kind === 'area' || kind === 'destination' || kind === 'path') {
    return requirementOptions.flatMap((option): EncounterChoiceOption[] => {
      if (option.kind !== 'cell') return []
      const cell = projectedCell(option.value)
      if (!cell) return []
      return [{
        optionId: option.value,
        label: option.label,
        description: option.description ?? null,
        disabled: option.disabled ?? false,
        unavailableReason: option.unavailableReason ?? null,
        preview: {
          kind: 'spatial',
          cells: kind === 'cell' || kind === 'area' ? [cell] : [],
          destination: kind === 'destination' ? cell : null,
          path: kind === 'path' ? [cell] : [],
          direction: null,
        },
      }]
    })
  }
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
    const options = optionsForTarget({ target, ...input })
    const self = target.kind === 'self'
    return [{
      schemaVersion: 1,
      choiceOfferId: `${interactionId}:${target.requirementId}`,
      interactionId,
      mapSlug: input.offer.mapSlug,
      mapRevision: input.offer.mapRevision,
      choiceId: target.requirementId,
      kind,
      prompt: target.relationshipLabel ?? `Choose ${target.kind === 'participant' ? 'target' : target.kind}`,
      helpText: [target.rangeLabel, target.requiresLineOfSight ? 'Requires line of sight' : null,
        target.requiresSpatialInput ? 'Exact geometry required' : null].filter(Boolean).join(' · ') || null,
      cardinality: { minimum: self ? 1 : target.minSelections, maximum: self ? 1 : target.maxSelections },
      ordering: kind === 'participant' ? 'initiative' : kind === 'side' ? 'server' : ['cell', 'area', 'direction', 'destination', 'path'].includes(kind) ? 'spatial' : 'server',
      options,
      defaultOptionIds: self && options[0]
        ? [options[0].optionId]
        : kind === 'participant'
          ? (input.offer.formChangePreview && options.length === 1
              ? [options[0]!.optionId]
              : (input.defaultParticipantIds ?? [])
                  .filter(id => options.some(option => option.optionId === id))
                  .slice(0, target.maxSelections))
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
    kind: input.offer.selectionOptions.every(option => option.kind === 'trainer' || option.kind === 'participant') ? 'participant' : 'item',
    prompt: 'Choose an authorized option',
    helpText: null,
    cardinality: { minimum: 1, maximum: 1 },
    ordering: 'server',
    options: input.offer.selectionOptions.map(option => ({
      optionId: option.value,
      label: option.label,
      description: option.description ?? option.kind,
      disabled: option.disabled ?? false,
      unavailableReason: option.unavailableReason ?? null,
      preview: { kind: 'none' },
    })),
    defaultOptionIds: [],
    requiresConfirmation: true,
    allowPass: false,
    allowCancel: true,
    expiresAt: null,
  })
  const primaryTarget = input.offer.targeting.find(target => target.kind !== 'none')
  const itemPrompt = input.offer.source.sourceKind === 'item' && primaryTarget
    ? `Choose ${primaryTarget.minSelections === primaryTarget.maxSelections
      ? primaryTarget.minSelections
      : `${primaryTarget.minSelections}–${primaryTarget.maxSelections}`} ${primaryTarget.kind === 'participant' ? 'target' : primaryTarget.kind}${primaryTarget.maxSelections === 1 ? '' : 's'}`
    : null
  return {
    kind: 'action',
    interactionId,
    title: input.offer.presentation.label,
    prompt: itemPrompt ?? input.offer.presentation.description ?? 'Review this action and choose its required inputs.',
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
