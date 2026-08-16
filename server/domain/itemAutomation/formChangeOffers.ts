import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  encounterAvailable,
  encounterPresentationStableId,
  type EncounterActionOffer,
  type EncounterContextualAffordance,
  type EncounterParticipantPresentationRef,
} from '#shared/encounterPresentation'
import {
  ITEM_FORM_CHANGE_ABILITY_CHOICE_ID,
  ITEM_FORM_CHANGE_ACTION_ID,
  ITEM_FORM_CHANGE_TARGET_CHOICE_ID,
} from '#shared/itemAutomation/formChanges'
import type { TabletopMap } from '~/types/map'
import {
  resolveItemFormChangeCandidate,
  type ItemFormChangeCandidate,
  type ItemFormChangeSheetDirectory,
} from './formChanges'
import { canonicalItemFormChangeSpeciesRecord } from './formChangeRegistry'

export interface EncounterItemFormChangeProjection {
  readonly offers: readonly EncounterActionOffer[]
  readonly affordances: readonly EncounterContextualAffordance[]
}

const statLabels = Object.freeze({
  atk: 'Attack', def: 'Defense', satk: 'Special Attack', sdef: 'Special Defense', spd: 'Speed',
})

const offerFor = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly target: EncounterParticipantPresentationRef
  readonly candidate: ItemFormChangeCandidate
  readonly offerOrder: number
}): EncounterActionOffer => {
  const actorUsesRing = input.candidate.actorPlacement.sheetKind === 'trainer'
  const sourceItemId = actorUsesRing || !input.candidate.stoneSource ? 'Mega Ring' : 'Mega Stone'
  const sourceInstanceId = encounterPresentationStableId(
    'form-source', input.map.slug, input.actor.participantId, input.target.participantId, sourceItemId,
  )
  const source = {
    sourceKind: 'item' as const,
    canonicalId: sourceItemId,
    instanceId: sourceInstanceId,
    displayName: sourceItemId,
    referenceHref: `/items/${encodeURIComponent(sourceItemId)}`,
  }
  const baseRecord = canonicalItemFormChangeSpeciesRecord(input.candidate.form.baseSpeciesId)
  if (!baseRecord?.types?.length) throw new Error('Canonical Mega Evolution base Type authority is unavailable.')
  const abilityRequiresChoice = input.candidate.abilityOptions.length > 0
  const targeting: EncounterActionOffer['targeting'] = [{
    requirementId: ITEM_FORM_CHANGE_TARGET_CHOICE_ID,
    kind: 'participant',
    minSelections: 1,
    maxSelections: 1,
    rangeLabel: null,
    relationshipLabel: actorUsesRing ? 'owned' : 'self',
    requiresLineOfSight: false,
    requiresSpatialInput: false,
  }, ...(abilityRequiresChoice ? [{
    requirementId: ITEM_FORM_CHANGE_ABILITY_CHOICE_ID,
    kind: 'item' as const,
    minSelections: 1,
    maxSelections: 1,
    rangeLabel: null,
    relationshipLabel: 'distinct natural Ability',
    requiresLineOfSight: false,
    requiresSpatialInput: false,
  }] : [])]
  const selectionOptions: NonNullable<EncounterActionOffer['selectionOptions']> = [
    {
      kind: 'participant' as const,
      requirementId: ITEM_FORM_CHANGE_TARGET_CHOICE_ID,
      value: input.target.participantId,
      label: input.target.displayName,
      description: `${input.candidate.pokemonSheet.species} → ${input.candidate.form.displayName} · ${input.candidate.form.types?.join(' / ') ?? baseRecord.types.join(' / ')} · Scene`,
    },
    ...input.candidate.abilityOptions.map(option => ({
      kind: 'object' as const,
      requirementId: ITEM_FORM_CHANGE_ABILITY_CHOICE_ID,
      value: option.optionId,
      label: option.abilityId,
      description: 'Distinct natural Ability gained for this Mega Evolution Scene.',
    })),
  ]
  const offerId = encounterPresentationStableId(
    'offer', input.map.slug, String(input.mapRevision), input.actor.participantId,
    input.target.participantId, input.candidate.form.formId, ITEM_FORM_CHANGE_ACTION_ID,
  )
  return {
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    offerId,
    mapSlug: input.map.slug,
    mapRevision: input.mapRevision,
    actor: input.actor,
    source,
    roles: ['activated-action', 'contextual-affordance', 'choice-only'],
    group: 'inventory',
    groupOrder: 43,
    offerOrder: input.offerOrder,
    timing: { kind: 'swift', label: 'Swift Action', triggerLabel: null, priority: null },
    costs: [{ kind: 'swift-action', resourceId: 'swift', amount: 1, label: '1 Swift Action' }],
    targeting,
    usage: {
      frequencyLabel: '1 Mega Evolution this Scene',
      remaining: 1,
      maximum: 1,
      cooldownLabel: null,
      resetLabel: 'Next Scene',
    },
    availability: encounterAvailable(),
    presentation: {
      label: 'Mega Evolve',
      description: `${input.target.displayName} becomes ${input.candidate.form.displayName} for the rest of this Scene.`,
      iconKey: 'source.item',
      tone: 'positive',
    },
    intent: { actionId: ITEM_FORM_CHANGE_ACTION_ID, input: 'choices' },
    sourceContextLabel: `${input.candidate.trainerSheet.name || 'Trainer'} · Mega Ring${input.candidate.stoneSource ? ' + Mega Stone' : ' + Delta Evolution'}`,
    selectionOptions,
    formChangePreview: {
      kind: 'item-form-change',
      fromFormLabel: input.candidate.pokemonSheet.species,
      toFormLabel: input.candidate.form.displayName,
      fromTypes: baseRecord.types,
      toTypes: input.candidate.form.types ?? baseRecord.types,
      abilityLabel: abilityRequiresChoice ? 'Choose a distinct natural Ability' : input.candidate.form.abilityId,
      abilityRequiresChoice,
      statDeltas: (['atk', 'def', 'satk', 'sdef', 'spd'] as const).map(statId => ({
        statId,
        label: statLabels[statId],
        delta: input.candidate.form.statDeltas[statId],
      })),
      durationLabel: 'Scene',
      reversalLabel: 'Reverts automatically when the Scene ends.',
      acceptanceBoundaryLabel: 'No change until accepted.',
    },
  }
}

/** Project only exact currently legal combinations; authority is recomputed again on declaration and commit. */
export const projectEncounterItemFormChangeOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly sheets: ItemFormChangeSheetDirectory
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  /** Player-owned Trainer sources permitted to support the projected action. */
  readonly permittedTrainerSourceSlugs?: ReadonlySet<string>
  readonly offerOrderBase?: number
}): EncounterItemFormChangeProjection => {
  const actorPlacement = input.map.placements.find(placement => placement.id === input.actor.participantId)
  if (!actorPlacement || !input.map.activeScene) return { offers: [], affordances: [] }
  const candidateTargetIds = actorPlacement.sheetKind === 'trainer'
    ? input.map.placements.filter(placement => placement.sheetKind === 'pokemon').map(placement => placement.id)
    : [actorPlacement.id]
  const candidates = candidateTargetIds.flatMap((targetPlacementId) => {
    try {
      const candidate = resolveItemFormChangeCandidate({
        map: input.map,
        actorPlacementId: actorPlacement.id,
        targetPlacementId,
        sheets: input.sheets,
      })
      if (input.permittedTrainerSourceSlugs
        && !input.permittedTrainerSourceSlugs.has(candidate.trainerSheet.slug)) return []
      // Delta Evolution uses this same item-form pathway on either the linked
      // Trainer’s or Rayquaza’s turn; the legacy Capability action is no longer
      // projected, so there is exactly one authoritative decision surface.
      return [candidate]
    }
    catch {
      return []
    }
  })
  const offers = candidates.flatMap((candidate, index) => {
    const target = input.participants.get(candidate.targetPlacement.id)
    if (!target) return []
    return [offerFor({
      ...input,
      target,
      candidate,
      offerOrder: (input.offerOrderBase ?? 0) + index,
    })]
  })
  const affordances = offers.map((offer): EncounterContextualAffordance => ({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    affordanceId: encounterPresentationStableId('affordance', offer.offerId),
    contextKind: 'participant',
    contextId: offer.selectionOptions?.find(option => option.kind === 'participant')?.value
      ?? offer.actor.participantId,
    source: offer.source,
    actor: offer.actor,
    linkedOfferId: offer.offerId,
    availability: offer.availability,
    presentation: offer.presentation,
  }))
  return { offers, affordances }
}
