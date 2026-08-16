import type { EncounterActionOffer } from '#shared/encounterPresentation'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { ItemRuntimeRegistry } from '#shared/itemAutomation/spec'
import { parseItemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { createEncounterEquipmentGrantQueries } from '../moveAutomation/equipmentGrantQueries'
import { wonderLauncherDeliveryBindingId } from './equipmentDelivery'

export type ItemCommandTemplateOffer = EncounterActionOffer & {
  readonly itemCommand?: UseItemCommandV1
}

/** Attach private revision/source authority only after the role-specific offer itself was authorized. */
export const attachEncounterItemCommandTemplate = (input: {
  readonly offer: ItemCommandTemplateOffer
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly visibleParticipantIds?: readonly string[]
  /** Required only when the reviewed ItemSpec uses campaign-day duration. */
  readonly campaignClock?: { readonly revision: number }
  /** Narrow deterministic test seam; production always uses the reviewed registry. */
  readonly registry?: ItemRuntimeRegistry
}): ItemCommandTemplateOffer => {
  // A caller cannot smuggle stale authority through a presentation offer.
  const { itemCommand: _discardedTemplate, ...offer } = input.offer
  if (offer.source.sourceKind !== 'item' || !offer.source.instanceId) return offer
  const source = parseItemInventoryInstanceId(offer.source.instanceId)
  if (!source || source.containerKind !== 'trainer') return offer
  const actorPlacement = input.map.placements.find(placement => placement.id === offer.actor.participantId)
  if (!actorPlacement) return offer
  const actorSheet = actorPlacement.sheetKind === 'trainer'
    ? input.trainerSheets.find(sheet => sheet.slug === actorPlacement.sheetSlug)
    : input.pokemonSheets.find(sheet => sheet.slug === actorPlacement.sheetSlug)
  const sourceSheet = input.trainerSheets.find(sheet => sheet.slug === source.containerSlug)
  if (!actorSheet || !sourceSheet) return offer
  const wonderLauncherRequested = offer.intent.actionId === `item.use.wonder-launcher:${offer.source.instanceId}`
  const launcherSources = wonderLauncherRequested
    ? createEncounterEquipmentGrantQueries({
        map: input.map,
        sheets: [
          ...input.pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug, sheet })),
          ...input.trainerSheets.map(sheet => ({ kind: 'trainer' as const, slug: sheet.slug, sheet })),
        ],
      }).resolve(actorPlacement.id)?.active.filter(entry => entry.grant.kind === 'action'
        && entry.grant.actionId === 'equipment.wonder-launcher.apply'
        && entry.grant.executionStatus === 'native') ?? []
    : []
  if (wonderLauncherRequested && launcherSources.length !== 1) return offer
  const rows = sourceSheet.inventory?.[source.section] ?? []
  const sourceRows = rows.filter(row => row.id === source.rowId)
  const registry = input.registry ?? ITEM_AUTOMATION_RUNTIME_REGISTRY
  const sourceDefinition = sourceRows.length === 1 ? registry.resolve(sourceRows[0]!.name) : null
  if (!sourceDefinition || sourceDefinition.canonicalId !== offer.source.canonicalId) return offer
  const actorRevision = Number(actorSheet.revision ?? 0)
  const sourceRevision = Number(sourceSheet.revision ?? 0)
  if (![actorRevision, sourceRevision, input.mapRevision].every(value => Number.isSafeInteger(value) && value >= 0)) return offer
  const consultedSheetRefs = new Map<string, UseItemCommandV1['readSet'][number]>()
  const visibleParticipantIds = input.visibleParticipantIds ? new Set(input.visibleParticipantIds) : null
  for (const placement of input.map.placements) {
    if (visibleParticipantIds && !visibleParticipantIds.has(placement.id)) continue
    const sheet = placement.sheetKind === 'trainer'
      ? input.trainerSheets.find(value => value.slug === placement.sheetSlug)
      : input.pokemonSheets.find(value => value.slug === placement.sheetSlug)
    const revision = Number(sheet?.revision ?? -1)
    if (!sheet || !Number.isSafeInteger(revision) || revision < 0) return offer
    consultedSheetRefs.set(`${placement.sheetKind}:${placement.sheetSlug}`, {
      kind: 'sheet', sheetKind: placement.sheetKind, id: placement.sheetSlug, revision,
    })
  }
  consultedSheetRefs.set(`trainer:${source.containerSlug}`, {
    kind: 'sheet', sheetKind: 'trainer', id: source.containerSlug, revision: sourceRevision,
  })
  const requiresCampaignClock = sourceDefinition.spec.duration.kind === 'daily'
  if (requiresCampaignClock && (!input.campaignClock
    || !Number.isSafeInteger(input.campaignClock.revision)
    || input.campaignClock.revision < 0)) return offer
  const readSet: UseItemCommandV1['readSet'] = [
    { kind: 'map', id: input.map.slug, revision: input.mapRevision },
    { kind: 'encounter', id: input.map.slug, revision: input.mapRevision },
    ...(requiresCampaignClock ? [{
      kind: 'campaign-clock' as const,
      id: 'campaign' as const,
      revision: input.campaignClock!.revision,
    }] : []),
    ...[...consultedSheetRefs.values()].sort((left, right) => {
      if (left.kind !== 'sheet' || right.kind !== 'sheet') return 0
      return `${left.sheetKind}:${left.id}`.localeCompare(`${right.sheetKind}:${right.id}`)
    }),
  ]
  const itemCommand: UseItemCommandV1 = Object.freeze({
      schemaVersion: 1,
      operationId: 'template:item-operation',
      context: 'encounter',
      offerId: offer.offerId,
      sourceInstanceId: offer.source.instanceId,
      actorParticipantId: offer.actor.participantId,
      actorSheet: { kind: actorPlacement.sheetKind, slug: actorPlacement.sheetSlug, expectedRevision: actorRevision },
      source: {
        kind: 'trainer' as const,
        slug: source.containerSlug,
        section: source.section,
        rowId: source.rowId,
        expectedRevision: sourceRevision,
      },
      targetIds: [],
      choices: [],
      readSet,
      ...(wonderLauncherRequested ? {
        delivery: {
          kind: 'wonder-launcher' as const,
          equipmentBindingId: wonderLauncherDeliveryBindingId({
            instanceId: launcherSources[0]!.instanceId,
            instanceRevision: launcherSources[0]!.instanceRevision,
            actorKind: 'trainer',
            actorSlug: actorPlacement.sheetSlug,
            actorRevision,
            mapSlug: input.map.slug,
            mapRevision: input.mapRevision,
          }),
        },
      } : {}),
  })
  return Object.freeze({ ...offer, itemCommand })
}
