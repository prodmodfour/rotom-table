import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'

export type SheetItemCommandTemplateOffer = SheetItemActionOfferV1 & {
  readonly itemCommand?: UseItemCommandV1
}

/** Attach private source/read-set authority only after the owner-safe sheet offer is re-authorized. */
export const attachSheetItemCommandTemplate = (input: {
  readonly offer: SheetItemCommandTemplateOffer
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly campaignClock: { readonly revision: number }
}): SheetItemCommandTemplateOffer => {
  const { itemCommand: _discarded, ...offer } = input.offer
  if (!offer.availability.enabled || offer.source.canonicalId === null) return offer
  const use = offer.actions.find(action => action.kind === 'use')
  if (!use?.enabled) return offer
  const sourceRow = input.trainerSheet.inventory?.[offer.source.section]?.[offer.source.rowIndex]
  const rowId = sourceRow?.id?.trim()
  if (!sourceRow || !rowId) return offer
  let sourceInstanceId: string
  try {
    sourceInstanceId = itemInventoryInstanceId({
      containerKind: 'trainer', containerSlug: input.trainerSheet.slug,
      section: offer.source.section, rowId,
    })
  }
  catch { return offer }
  const matchingRows = (input.trainerSheet.inventory?.[offer.source.section] ?? []).filter(row => row.id === rowId)
  const definition = matchingRows.length === 1 ? ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(sourceRow.name) : null
  if (!definition || definition.canonicalId !== offer.source.canonicalId || !definition.spec.contexts.includes('sheet')) return offer
  const actorRevision = Number(input.trainerSheet.revision ?? -1)
  if (!Number.isSafeInteger(actorRevision) || actorRevision < 0
    || offer.actor.sheetSlug !== input.trainerSheet.slug || offer.actor.revision !== actorRevision) return offer

  const sheets = new Map<string, CharacterSheet | TrainerSheet>([
    ...input.trainerSheets.map(sheet => [`trainer:${sheet.slug}`, sheet] as const),
    ...input.pokemonSheets.map(sheet => [`pokemon:${sheet.slug}`, sheet] as const),
  ])
  sheets.set(`trainer:${input.trainerSheet.slug}`, input.trainerSheet)
  const readRefs = new Map<string, Extract<UseItemCommandV1['readSet'][number], { readonly kind: 'sheet' }>>()
  for (const option of offer.targeting?.options ?? []) {
    const sheet = sheets.get(`${option.sheetKind}:${option.sheetSlug}`)
    const revision = Number(sheet?.revision ?? -1)
    if (!sheet || !Number.isSafeInteger(revision) || revision < 0) return offer
    readRefs.set(`${option.sheetKind}:${option.sheetSlug}`, {
      kind: 'sheet', sheetKind: option.sheetKind, id: option.sheetSlug, revision,
    })
  }
  readRefs.set(`trainer:${input.trainerSheet.slug}`, {
    kind: 'sheet', sheetKind: 'trainer', id: input.trainerSheet.slug, revision: actorRevision,
  })
  if (!Number.isSafeInteger(input.campaignClock.revision) || input.campaignClock.revision < 0) return offer
  const readSet: UseItemCommandV1['readSet'] = [
    {
      kind: 'campaign-clock' as const,
      id: 'campaign' as const,
      revision: input.campaignClock.revision,
    },
    ...[...readRefs.values()].sort((left, right) => (
      `${left.sheetKind}:${left.id}`.localeCompare(`${right.sheetKind}:${right.id}`)
    )),
  ]
  const itemCommand: UseItemCommandV1 = Object.freeze({
    schemaVersion: 1,
    operationId: 'template:item-operation',
    context: 'sheet',
    offerId: offer.offerId,
    sourceInstanceId,
    actorParticipantId: null,
    actorSheet: { kind: 'trainer' as const, slug: input.trainerSheet.slug, expectedRevision: actorRevision },
    source: {
      kind: 'trainer' as const,
      slug: input.trainerSheet.slug,
      section: offer.source.section,
      rowId,
      expectedRevision: actorRevision,
    },
    targetIds: [],
    choices: [],
    readSet,
  })
  return Object.freeze({ ...offer, itemCommand })
}

/** Attach private shared-row authority only after the selected actor offer is re-authorized. */
export const attachGroupInventoryItemCommandTemplate = (input: {
  readonly offer: SheetItemCommandTemplateOffer
  readonly groupInventory: GroupInventoryDocument
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly campaignClock: { readonly revision: number }
}): SheetItemCommandTemplateOffer => {
  const { itemCommand: _discarded, ...offer } = input.offer
  if (!offer.availability.enabled || offer.source.containerKind !== 'group'
    || offer.source.canonicalId === null) return offer
  const use = offer.actions.find(action => action.kind === 'use')
  if (!use?.enabled) return offer
  const sourceRows = input.groupInventory.inventory[offer.source.section] ?? []
  const sourceRow = sourceRows[offer.source.rowIndex]
  const rowId = sourceRow?.id?.trim()
  if (!sourceRow || !rowId || sourceRows.filter(row => row.id === rowId).length !== 1) return offer
  let sourceInstanceId: string
  try {
    sourceInstanceId = itemInventoryInstanceId({
      containerKind: 'group',
      containerSlug: input.groupInventory.slug,
      section: offer.source.section,
      rowId,
    })
  }
  catch { return offer }
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(sourceRow.name)
  if (!definition || definition.canonicalId !== offer.source.canonicalId
    || !definition.spec.contexts.includes('sheet') || definition.spec.timing === 'extended') return offer
  const actorRevision = Number(input.trainerSheet.revision ?? -1)
  const groupRevision = Number(input.groupInventory.revision ?? -1)
  if (!Number.isSafeInteger(actorRevision) || actorRevision < 0
    || !Number.isSafeInteger(groupRevision) || groupRevision < 0
    || offer.actor.sheetSlug !== input.trainerSheet.slug || offer.actor.revision !== actorRevision) return offer

  const sheets = new Map<string, CharacterSheet | TrainerSheet>([
    ...input.trainerSheets.map(sheet => [`trainer:${sheet.slug}`, sheet] as const),
    ...input.pokemonSheets.map(sheet => [`pokemon:${sheet.slug}`, sheet] as const),
  ])
  sheets.set(`trainer:${input.trainerSheet.slug}`, input.trainerSheet)
  const readRefs = new Map<string, Extract<UseItemCommandV1['readSet'][number], { readonly kind: 'sheet' }>>()
  for (const option of offer.targeting?.options ?? []) {
    const sheet = sheets.get(`${option.sheetKind}:${option.sheetSlug}`)
    const revision = Number(sheet?.revision ?? -1)
    if (!sheet || !Number.isSafeInteger(revision) || revision < 0) return offer
    readRefs.set(`${option.sheetKind}:${option.sheetSlug}`, {
      kind: 'sheet', sheetKind: option.sheetKind, id: option.sheetSlug, revision,
    })
  }
  readRefs.set(`trainer:${input.trainerSheet.slug}`, {
    kind: 'sheet', sheetKind: 'trainer', id: input.trainerSheet.slug, revision: actorRevision,
  })
  if (!Number.isSafeInteger(input.campaignClock.revision) || input.campaignClock.revision < 0) return offer
  const readSet: UseItemCommandV1['readSet'] = [
    { kind: 'campaign-clock', id: 'campaign', revision: input.campaignClock.revision },
    { kind: 'group-inventory', id: input.groupInventory.slug, revision: groupRevision },
    ...[...readRefs.values()].sort((left, right) => (
      `${left.sheetKind}:${left.id}`.localeCompare(`${right.sheetKind}:${right.id}`)
    )),
  ]
  const itemCommand: UseItemCommandV1 = Object.freeze({
    schemaVersion: 1,
    operationId: 'template:item-operation',
    context: 'sheet',
    offerId: offer.offerId,
    sourceInstanceId,
    actorParticipantId: null,
    actorSheet: { kind: 'trainer' as const, slug: input.trainerSheet.slug, expectedRevision: actorRevision },
    source: {
      kind: 'group' as const,
      slug: input.groupInventory.slug,
      section: offer.source.section,
      rowId,
      expectedRevision: groupRevision,
    },
    targetIds: [],
    choices: [],
    readSet,
  })
  return Object.freeze({ ...offer, itemCommand })
}
