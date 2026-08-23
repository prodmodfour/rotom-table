import type {
  EncounterActionDeclarationIntent,
  EncounterActionOffer,
} from '#shared/encounterPresentation'
import {
  EQUIPMENT_ACTION_IDS,
  parseExecuteEquipmentActionCommand,
  type ExecuteEquipmentActionCommandV1,
} from '#shared/itemAutomation/equipmentActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEncounterEquipmentGrantQueries } from '../moveAutomation/equipmentGrantQueries'
import {
  resolveShockCollarPairCandidates,
  shockCollarImplicitRemoteAuthority,
} from './shockCollar'
import type { ResolvedEquipmentGrant } from './equipmentGrants'
import {
  largeSnagMachineInventorySources,
  resolveSnagBallInventoryChoice,
} from './snagMachine'

export type EquipmentActionCommandTemplateOffer = EncounterActionOffer & {
  readonly equipmentActionCommand?: ExecuteEquipmentActionCommandV1
}

const parseCell = (value: string): { x: number, y: number, z: number } | null => {
  const match = /^cell:(\d+):(\d+):(\d+)$/u.exec(value)
  return match ? { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) } : null
}

/** Rebind a public offer to exact private equipment custody after declaration. */
export const attachEncounterEquipmentActionCommandTemplate = (input: {
  readonly offer: EncounterActionOffer
  readonly intent: EncounterActionDeclarationIntent
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}): EquipmentActionCommandTemplateOffer => {
  if (input.offer.source.sourceKind !== 'item'
    || !EQUIPMENT_ACTION_IDS.includes(input.offer.intent.actionId as never)
    || input.intent.actionId !== input.offer.intent.actionId
    || input.intent.offerId !== input.offer.offerId
    || input.intent.actorParticipantId !== input.offer.actor.participantId) return input.offer
  const placement = input.map.placements.find(candidate => candidate.id === input.offer.actor.participantId)
  if (!placement) return input.offer
  const sheets = [
    ...input.pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug, sheet })),
    ...input.trainerSheets.map(sheet => ({ kind: 'trainer' as const, slug: sheet.slug, sheet })),
  ]
  const grantQueries = createEncounterEquipmentGrantQueries({ map: input.map, sheets })
  const optionIds = input.intent.selections.flatMap(selection => selection.optionIds)
  const targetPlacementIds = [...new Set(optionIds.filter(optionId => (
    input.map.placements.some(candidate => candidate.id === optionId)
  )))]
  const cells = optionIds.map(parseCell).filter((cell): cell is NonNullable<typeof cell> => cell !== null)
  const actorSheet = placement.sheetKind === 'pokemon'
    ? input.pokemonSheets.find(sheet => sheet.slug === placement.sheetSlug)
    : input.trainerSheets.find(sheet => sheet.slug === placement.sheetSlug)
  if (!actorSheet) return input.offer
  let source: ResolvedEquipmentGrant | undefined = grantQueries.resolve(placement.id)?.active.find(entry => (
    entry.canonicalItemId === input.offer.source.canonicalId
    && entry.grant.kind === 'action'
    && entry.grant.executionStatus === 'native'
    && entry.grant.actionId === input.offer.intent.actionId
  ))
  let commandSourceInstanceId = source?.instanceId ?? null
  let commandSourceRevision = source?.instanceRevision ?? null
  let targetSource: ResolvedEquipmentGrant | null = null
  let largeSnagSource = false
  if (!source && input.offer.intent.actionId === 'equipment.snag-machine.convert'
    && placement.sheetKind === 'trainer') {
    const machine = largeSnagMachineInventorySources(actorSheet as TrainerSheet)
      .find(candidate => candidate.publicSourceId === input.offer.source.instanceId)
    if (machine) {
      commandSourceInstanceId = machine.sourceInstanceId
      commandSourceRevision = Number(actorSheet.revision ?? 0)
      largeSnagSource = true
    }
  }
  if (input.offer.intent.actionId === 'equipment.shock-collar.activate') {
    if (targetPlacementIds.length !== 1) return input.offer
    if (source) {
      targetSource = resolveShockCollarPairCandidates({
        map: input.map,
        actorPlacement: placement,
        actorSheet,
        remoteSource: source,
        pokemonSheets: new Map(input.pokemonSheets.map(sheet => [sheet.slug, sheet])),
        trainerSheets: new Map(input.trainerSheets.map(sheet => [sheet.slug, sheet])),
        grantsForPlacement: placementId => grantQueries.resolve(placementId),
      }).find(candidate => candidate.placement.id === targetPlacementIds[0])?.source ?? null
    }
    else {
      const targetPlacement = input.map.placements.find(candidate => candidate.id === targetPlacementIds[0])
      const targetSheet = targetPlacement?.sheetKind === 'pokemon'
        ? input.pokemonSheets.find(sheet => sheet.slug === targetPlacement.sheetSlug)
        : input.trainerSheets.find(sheet => sheet.slug === targetPlacement?.sheetSlug)
      targetSource = targetPlacement ? grantQueries.resolve(targetPlacement.id)?.active.find(entry => (
        entry.canonicalItemId === 'Shock Collar'
        && entry.grant.kind === 'action'
        && entry.grant.actionId === 'equipment.shock-collar.activate'
        && entry.grant.executionStatus === 'native'
      )) ?? null : null
      const authority = targetPlacement && targetSheet && targetSource
        ? shockCollarImplicitRemoteAuthority({ placement: targetPlacement, sheet: targetSheet, collarSource: targetSource })
        : null
      if (!authority || placement.sheetKind !== 'trainer'
        || placement.sheetSlug !== authority.holderTrainerSlug) return input.offer
      source = targetSource ?? undefined
      commandSourceInstanceId = authority.remoteInstanceId
      commandSourceRevision = authority.remoteInstanceRevision
    }
    if (!targetSource) return input.offer
  }
  if ((!source && !largeSnagSource) || !commandSourceInstanceId || commandSourceRevision === null) return input.offer
  const snagBallSource = input.offer.intent.actionId === 'equipment.snag-machine.convert'
    && placement.sheetKind === 'trainer'
    ? resolveSnagBallInventoryChoice({
        sheet: actorSheet as TrainerSheet,
        publicOptionId: optionIds.length === 1 ? optionIds[0] : null,
      })
    : null
  if (input.offer.intent.actionId === 'equipment.snag-machine.convert' && !snagBallSource) return input.offer
  return Object.freeze({
    ...input.offer,
    equipmentActionCommand: parseExecuteEquipmentActionCommand({
      schemaVersion: 1,
      operationId: 'equipment-action-template',
      offerId: input.offer.offerId,
      mapSlug: input.map.slug,
      baseRevision: input.mapRevision,
      actorPlacementId: placement.id,
      actionId: input.offer.intent.actionId,
      equipmentInstanceId: commandSourceInstanceId,
      equipmentInstanceRevision: commandSourceRevision,
      targetEquipmentInstanceId: targetSource?.instanceId ?? null,
      targetEquipmentInstanceRevision: targetSource?.instanceRevision ?? null,
      targetPlacementIds,
      cells,
      inventorySourceInstanceId: snagBallSource?.option.sourceInstanceId
        ?? optionIds.find(optionId => optionId.startsWith('item-instance:')) ?? null,
      skillCheckId: optionIds.find(optionId => optionId.startsWith('skill-check:v1:')) ?? null,
      gmAdjudication: null,
    }),
  })
}
