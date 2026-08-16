import type {
  EncounterActionDeclarationIntent,
  EncounterActionOffer,
} from '#shared/encounterPresentation'
import {
  ITEM_FORM_CHANGE_ABILITY_CHOICE_ID,
  ITEM_FORM_CHANGE_ACTION_ID,
  ITEM_FORM_CHANGE_TARGET_CHOICE_ID,
  parseExecuteItemFormChangeCommand,
  type ExecuteItemFormChangeCommandV1,
} from '#shared/itemAutomation/formChanges'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveItemFormChangeCandidate } from './formChanges'

export type ItemFormChangeCommandTemplateOffer = EncounterActionOffer & {
  readonly itemFormChangeCommand?: ExecuteItemFormChangeCommandV1
}

const exactSelection = (
  intent: EncounterActionDeclarationIntent,
  choiceId: string,
  required: boolean,
): string | null => {
  const rows = intent.selections.filter(selection => selection.choiceId === choiceId)
  if (rows.length === 0 && !required) return null
  if (rows.length !== 1 || rows[0]!.optionIds.length !== 1
    || new Set(rows[0]!.optionIds).size !== 1) return null
  return rows[0]!.optionIds[0] ?? null
}

/** Bind exact target, choice, and revision authority after the role-specific offer is authorized. */
export const attachEncounterItemFormChangeCommandTemplate = (input: {
  readonly offer: EncounterActionOffer
  readonly intent: EncounterActionDeclarationIntent
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}): ItemFormChangeCommandTemplateOffer => {
  if (input.offer.source.sourceKind !== 'item'
    || input.offer.intent.actionId !== ITEM_FORM_CHANGE_ACTION_ID
    || input.intent.actionId !== ITEM_FORM_CHANGE_ACTION_ID) return input.offer
  const targetPlacementId = exactSelection(input.intent, ITEM_FORM_CHANGE_TARGET_CHOICE_ID, true)
  if (!targetPlacementId) return input.offer
  const sheets = {
    pokemon: new Map(input.pokemonSheets.map(sheet => [sheet.slug, sheet])),
    trainer: new Map(input.trainerSheets.map(sheet => [sheet.slug, sheet])),
  }
  let candidate
  try {
    candidate = resolveItemFormChangeCandidate({
      map: input.map,
      actorPlacementId: input.offer.actor.participantId,
      targetPlacementId,
      sheets,
    })
  }
  catch { return input.offer }
  const abilityOptionId = exactSelection(
    input.intent,
    ITEM_FORM_CHANGE_ABILITY_CHOICE_ID,
    candidate.abilityOptions.length > 0,
  )
  if ((candidate.abilityOptions.length > 0) !== (abilityOptionId !== null)) return input.offer
  try {
    candidate = resolveItemFormChangeCandidate({
      map: input.map,
      actorPlacementId: input.offer.actor.participantId,
      targetPlacementId,
      sheets,
      abilityOptionId,
    })
  }
  catch { return input.offer }
  if (!candidate.selectedAbilityId) return input.offer
  const readSet = [
    { kind: 'map' as const, sheetKind: null, id: input.map.slug, revision: input.mapRevision },
    { kind: 'sheet' as const, sheetKind: 'pokemon' as const, id: candidate.pokemonSheet.slug, revision: normalizeRevision(candidate.pokemonSheet.revision) },
    { kind: 'sheet' as const, sheetKind: 'trainer' as const, id: candidate.trainerSheet.slug, revision: normalizeRevision(candidate.trainerSheet.revision) },
  ].sort((left, right) => `${left.kind}:${left.sheetKind ?? ''}:${left.id}`
    .localeCompare(`${right.kind}:${right.sheetKind ?? ''}:${right.id}`))
  return Object.freeze({
    ...input.offer,
    itemFormChangeCommand: parseExecuteItemFormChangeCommand({
      schemaVersion: 1,
      operationId: 'template:item-form-change',
      offerId: input.offer.offerId,
      mapSlug: input.map.slug,
      baseRevision: input.mapRevision,
      actorPlacementId: input.offer.actor.participantId,
      targetPlacementId,
      abilityOptionId,
      readSet,
    }),
  })
}
