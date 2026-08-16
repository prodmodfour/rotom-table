import type { EncounterActionOffer, EncounterAvailabilityReasonCode, EncounterContextualAffordance, EncounterParticipantPresentationRef, EncounterTargetingSummary } from '#shared/encounterPresentation'
import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  encounterAvailabilityReason,
  encounterAvailable,
  encounterPresentationStableId,
  encounterUnavailable,
} from '#shared/encounterPresentation'
import { parseSerializedEquipmentInventoryState } from '#shared/itemAutomation/equipment'
import { itemInventoryInstanceId, type ItemInventorySection } from '#shared/itemAutomation/inventory'
import type { TabletopMap } from '~/types/map'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { projectEncounterItemEligibility } from './eligibility'
import type { ResolveEquipmentGrantsResult } from './equipmentGrants'

export interface EncounterItemOfferProjection {
  readonly offers: readonly EncounterActionOffer[]
  readonly affordances: readonly EncounterContextualAffordance[]
}

const sections = ['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment'] as const
const sectionLabels: Readonly<Record<ItemInventorySection, string>> = Object.freeze({
  keyItems: 'Key Items',
  pokemonItems: 'Pokémon Items',
  medicalKit: 'Medical Kit',
  pokeBalls: 'Poké Balls',
  foodStuff: 'Food',
  equipment: 'Equipment',
})
const quantity = (entry: InventoryEntry, section: ItemInventorySection): number => {
  if (entry.serializedEquipment !== undefined) {
    parseSerializedEquipmentInventoryState(entry.serializedEquipment)
    return 1
  }
  return section === 'equipment'
    ? 1
    : Number.isSafeInteger(entry.qty ?? 1) && Number(entry.qty ?? 1) > 0 ? Number(entry.qty ?? 1) : 0
}

const inventoryRows = (sheet: TrainerSheet): readonly { readonly section: ItemInventorySection, readonly entry: InventoryEntry }[] => sections
  .flatMap(section => (sheet.inventory?.[section] ?? []).map(entry => ({ section, entry })))
  .filter(({ section, entry }) => entry.name.trim().length > 0 && quantity(entry, section) > 0)

const timingLabel = (value: string): string => value === 'standard' ? 'Standard Action'
  : value === 'shift' ? 'Shift Action'
    : value === 'swift' ? 'Swift Action'
      : value === 'full' ? 'Full Action'
        : value === 'free' ? 'Free Action' : value

const targetingFor = (
  definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>,
  rangeOverrideMeters?: number,
): readonly EncounterTargetingSummary[] => definition.spec.targets.map(target => ({
  requirementId: target.targetId,
  kind: target.kind === 'self' ? 'self'
    : target.kind === 'participant' ? 'participant'
      : target.kind === 'side' ? 'side'
        : target.kind === 'move' ? 'move'
          : target.kind === 'inventory-row' || target.kind === 'equipment-slot' ? 'item' : 'none',
  minSelections: target.minimum,
  maxSelections: target.maximum,
  rangeLabel: rangeOverrideMeters !== undefined
    ? `${rangeOverrideMeters} m`
    : target.rangeMeters === null ? null : `${target.rangeMeters} m`,
  relationshipLabel: target.relationship === 'any' ? null : target.relationship,
  requiresLineOfSight: target.requiresLineOfSight,
  requiresSpatialInput: false,
}))

const restorativeDefinition = (definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>): boolean => (
  definition.spec.effects.some(effect => effect.operation === 'heal-hp'
    || effect.operation === 'revive' || effect.operation === 'remove-conditions')
)

const xItemDefinition = (definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>): boolean => (
  definition.spec.effects.some(effect => effect.operation === 'modify-stage'
    || effect.operation === 'temporary-combat-effect')
)

const itemUseTimingConsequencesApply = (
  definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>,
): boolean => restorativeDefinition(definition) || xItemDefinition(definition)

const itemCosts = (
  definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>,
  sourceLabel: string,
): EncounterActionOffer['costs'] => [
  ...definition.spec.costs.map((cost): EncounterActionOffer['costs'][number] => ({
    kind: cost.kind === 'action'
      ? cost.resourceId === 'shift' ? 'shift-action'
        : cost.resourceId === 'swift' ? 'swift-action'
          : cost.resourceId === 'full' ? 'full-action' : 'standard-action'
      : cost.kind === 'ap' ? 'action-points'
        : cost.kind === 'item' ? 'item' : 'resource',
    resourceId: cost.resourceId,
    amount: cost.amount,
    label: cost.label,
  })),
  ...(!definition.spec.consumption.reusable && definition.spec.consumption.quantity > 0 ? [{
    kind: 'item' as const,
    resourceId: null,
    amount: definition.spec.consumption.quantity,
    label: `Consume ${definition.spec.consumption.quantity} ${sourceLabel}`,
  }] : []),
]

const itemTargetCosts = (input: {
  readonly definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>
  readonly sourceLabel: string
  readonly actorId: string
  readonly targetId: string
  readonly medicTraining: boolean
  readonly wonderLauncherDelivery?: boolean
}): EncounterActionOffer['costs'] => {
  const base = [
    ...itemCosts(input.definition, input.sourceLabel),
    ...(input.wonderLauncherDelivery ? [{
      kind: 'action-points' as const,
      resourceId: 'drain',
      amount: 1,
      label: '1 AP to activate Wonder Launcher',
    }] : []),
  ]
  if (input.wonderLauncherDelivery) return base
  if (!itemUseTimingConsequencesApply(input.definition)) return base
  if (input.targetId === input.actorId) return base.map(cost => (
    ['standard-action', 'shift-action', 'full-action'].includes(cost.kind)
      ? { kind: 'full-action' as const, resourceId: 'full', amount: 1, label: '1 Full Action' }
      : cost
  ))
  return [
    ...base,
    ...(!input.medicTraining ? [{
      kind: 'resource' as const,
      resourceId: 'item.restorative.target-next-turn-forfeit',
      amount: 1,
      label: 'Target forfeits next Standard + Shift',
    }] : []),
  ]
}

const economyReason = (map: TabletopMap, actorId: string, timing: string): EncounterAvailabilityReasonCode | null => {
  const ledger = map.encounterState?.turnResources[actorId]
  if (!ledger || !['standard', 'shift', 'swift', 'full'].includes(timing)) return null
  const action = ledger.actions[timing as 'standard' | 'shift' | 'swift' | 'full']
  const effectiveSpent = timing === 'standard' || timing === 'shift'
    ? action.spent + ledger.actions.full.spent
    : action.spent
  const fullBlocked = timing === 'full' && (ledger.actions.standard.spent > 0 || ledger.actions.shift.spent > 0)
  if (!fullBlocked && (action.budget === null || effectiveSpent < action.budget)) return null
  if (timing === 'standard') return 'economy.standard-spent'
  if (timing === 'shift') return 'economy.shift-spent'
  if (timing === 'swift') return 'economy.swift-spent'
  return 'economy.full-action-unavailable'
}

/** Project only controlled trainer rows; stable row IDs and reviewed executable specs are mandatory. */
export const projectEncounterItemOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheets: readonly import('~/types/characterSheet').CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly equipmentGrants?: ResolveEquipmentGrantsResult | null
  readonly offerOrderBase?: number
}): EncounterItemOfferProjection => {
  const offers: EncounterActionOffer[] = []
  const affordances: EncounterContextualAffordance[] = []
  const wonderLauncher = input.equipmentGrants?.active.find(entry => entry.grant.kind === 'action'
    && entry.grant.actionId === 'equipment.wonder-launcher.apply'
    && entry.grant.executionStatus === 'native') ?? null
  for (const [index, row] of inventoryRows(input.trainerSheet).entries()) {
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(row.entry.name)
    const rowId = row.entry.id?.trim() || null
    const sourceInstanceId = rowId ? itemInventoryInstanceId({
      containerKind: 'trainer', containerSlug: input.trainerSheet.slug, section: row.section, rowId,
    }) : null
    const source = {
      sourceKind: 'item' as const,
      canonicalId: definition?.canonicalId ?? row.entry.name,
      instanceId: sourceInstanceId,
      displayName: row.entry.name,
      referenceHref: definition ? `/items/${encodeURIComponent(definition.canonicalId)}` : null,
    }
    const baseId = encounterPresentationStableId('item', input.map.slug, input.actor.participantId, row.section, rowId ?? `legacy-${index}`)
    const supported = (definition?.spec.implementationState === 'native'
      || definition?.spec.implementationState === 'guided')
      && definition.spec.contexts.includes('encounter')
    const actorPlacement = input.map.placements.find(placement => placement.id === input.actor.participantId)
    const eligibility = supported && definition && actorPlacement
      ? projectEncounterItemEligibility({
          definition,
          map: input.map,
          actorPlacement,
          actor: input.actor,
          actorSheet: input.trainerSheet,
          sourceQuantity: quantity(row.entry, row.section),
          pokemonSheets: input.pokemonSheets,
          trainerSheets: input.trainerSheets,
        })
      : null
    const launcherEligibility = wonderLauncher && supported && definition && actorPlacement
      && xItemDefinition(definition)
      ? projectEncounterItemEligibility({
          definition,
          map: input.map,
          actorPlacement,
          actor: input.actor,
          actorSheet: input.trainerSheet,
          sourceQuantity: quantity(row.entry, row.section),
          pokemonSheets: input.pokemonSheets,
          trainerSheets: input.trainerSheets,
          wonderLauncherDelivery: true,
        })
      : null
    const medicTraining = sheetHasCanonicalEdge(input.trainerSheet, 'trainer', 'Medic Training')
    const selectionOptions = definition && eligibility ? eligibility.targetOptions.map((target) => {
      const costs = itemTargetCosts({
        definition,
        sourceLabel: row.entry.name,
        actorId: input.actor.participantId,
        targetId: target.participantId,
        medicTraining,
      })
      const actionTiming = costs.some(cost => cost.kind === 'full-action') ? 'full' : definition.spec.timing
      const unavailableCode = economyReason(input.map, input.actor.participantId, actionTiming)
      const unavailableReason = target.unavailableReason
        ? encounterAvailabilityReason(target.unavailableReason.code)
        : unavailableCode ? encounterAvailabilityReason(unavailableCode) : null
      return {
        kind: 'participant' as const,
        value: target.participantId,
        label: target.label,
        description: [
          target.description,
          target.unavailableReason?.label ?? null,
          ...(itemUseTimingConsequencesApply(definition) && target.participantId === input.actor.participantId
            ? ['Self-use costs 1 Full Action']
            : []),
          ...(itemUseTimingConsequencesApply(definition) && target.participantId !== input.actor.participantId
            && !medicTraining
            ? ['Target forfeits next Standard + Shift']
            : []),
        ].filter(Boolean).join(' · ') || null,
        costs,
        disabled: unavailableReason !== null,
        unavailableReason,
      }
    }) : []
    const selectionEconomyReason = selectionOptions.length > 0 && selectionOptions.every(option => option.disabled)
      ? selectionOptions[0]?.unavailableReason?.code ?? null
      : null
    const reason = !rowId ? 'action.parameters-required' as const
      : !definition || !supported ? 'action.unsupported' as const
        : eligibility?.reasons[0]?.code
          ?? selectionEconomyReason
          ?? economyReason(input.map, input.actor.participantId, definition.spec.timing)
    const offerId = supported && rowId ? encounterPresentationStableId('offer', baseId, String(input.mapRevision), definition.definitionSha256) : null
    affordances.push({
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      affordanceId: encounterPresentationStableId('affordance', baseId),
      contextKind: 'inventory',
      contextId: sourceInstanceId ?? encounterPresentationStableId('inventory', input.trainerSheet.slug, row.section, String(index)),
      source,
      actor: input.actor,
      linkedOfferId: offerId,
      availability: reason ? encounterUnavailable(encounterAvailabilityReason(reason, {
        diagnosticDetail: eligibility?.reasons[0]?.diagnosticDetail ?? null,
      })) : encounterAvailable(),
      presentation: {
        label: row.entry.name,
        description: reason ? (reason === 'action.parameters-required' ? 'Assign a stable row identity before use.' : 'No reviewed encounter action is available.') : `${quantity(row.entry, row.section)} available`,
        iconKey: 'source.item',
        tone: reason ? 'warning' : 'neutral',
      },
    })
    if (!supported || !rowId || !definition || !offerId) continue
    offers.push({
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      offerId,
      mapSlug: input.map.slug,
      mapRevision: input.mapRevision,
      actor: input.actor,
      source,
      roles: ['activated-action', 'contextual-affordance', ...(definition.spec.choices.length ? ['choice-only' as const] : [])],
      group: 'inventory',
      groupOrder: 45,
      offerOrder: (input.offerOrderBase ?? 0) + index,
      timing: { kind: definition.spec.timing, label: timingLabel(definition.spec.timing), triggerLabel: null, priority: null },
      // Target-specific action and forfeiture consequences are projected on
      // each option; this base remains truthful before a target is selected.
      costs: itemCosts(definition, row.entry.name),
      targeting: targetingFor(definition),
      usage: { frequencyLabel: null, remaining: quantity(row.entry, row.section), maximum: quantity(row.entry, row.section), cooldownLabel: null, resetLabel: null },
      availability: reason ? encounterUnavailable(encounterAvailabilityReason(reason, {
        diagnosticDetail: eligibility?.reasons[0]?.diagnosticDetail ?? null,
      })) : encounterAvailable(),
      presentation: {
        label: `Use ${row.entry.name}`,
        description: definition.spec.presentation.description,
        iconKey: 'source.item',
        tone: 'positive',
      },
      sourceContextLabel: `${input.actor.displayName} · ${sectionLabels[row.section]}`,
      intent: { actionId: `item.use:${sourceInstanceId}`, input: definition.spec.targets.length || definition.spec.choices.length ? 'choices' : 'immediate' },
      selectionOptions,
    })
    if (!wonderLauncher || !launcherEligibility || !sourceInstanceId || !xItemDefinition(definition)) continue
    const launcherSelectionOptions = launcherEligibility.targetOptions.map((target) => {
      const costs = itemTargetCosts({
        definition,
        sourceLabel: row.entry.name,
        actorId: input.actor.participantId,
        targetId: target.participantId,
        medicTraining,
        wonderLauncherDelivery: true,
      })
      const unavailableCode = economyReason(input.map, input.actor.participantId, 'standard')
      const unavailableReason = target.unavailableReason
        ? encounterAvailabilityReason(target.unavailableReason.code)
        : unavailableCode ? encounterAvailabilityReason(unavailableCode) : null
      return {
        kind: 'participant' as const,
        value: target.participantId,
        label: target.label,
        description: [
          target.description,
          target.unavailableReason?.label ?? null,
          'Wonder Launcher · within 8 m · target keeps its actions',
        ].filter(Boolean).join(' · '),
        costs,
        disabled: unavailableReason !== null,
        unavailableReason,
      }
    })
    const launcherSelectionReason = launcherSelectionOptions.length > 0
      && launcherSelectionOptions.every(option => option.disabled)
      ? launcherSelectionOptions[0]?.unavailableReason?.code ?? null
      : null
    const launcherReason = launcherEligibility.reasons[0]?.code
      ?? launcherSelectionReason
      ?? economyReason(input.map, input.actor.participantId, 'standard')
    const launcherOfferId = encounterPresentationStableId(
      'offer', baseId, 'wonder-launcher', String(input.mapRevision), definition.definitionSha256,
    )
    offers.push({
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      offerId: launcherOfferId,
      mapSlug: input.map.slug,
      mapRevision: input.mapRevision,
      actor: input.actor,
      source,
      roles: ['activated-action', 'contextual-affordance', ...(definition.spec.choices.length ? ['choice-only' as const] : [])],
      group: 'inventory',
      groupOrder: 44,
      offerOrder: (input.offerOrderBase ?? 0) + index,
      timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
      costs: [
        ...itemCosts(definition, row.entry.name),
        { kind: 'action-points', resourceId: 'drain', amount: 1, label: '1 AP to activate Wonder Launcher' },
      ],
      targeting: targetingFor(definition, 8),
      usage: {
        frequencyLabel: null,
        remaining: quantity(row.entry, row.section),
        maximum: quantity(row.entry, row.section),
        cooldownLabel: null,
        resetLabel: null,
      },
      availability: launcherReason ? encounterUnavailable(encounterAvailabilityReason(launcherReason, {
        diagnosticDetail: launcherEligibility.reasons[0]?.diagnosticDetail ?? null,
      })) : encounterAvailable(),
      presentation: {
        label: `Launch ${row.entry.name}`,
        description: `Apply ${row.entry.name} to a Pokémon within 8 m without making the target forfeit actions.`,
        iconKey: 'source.item',
        tone: 'positive',
      },
      sourceContextLabel: `${input.actor.displayName} · Wonder Launcher · ${sectionLabels[row.section]}`,
      intent: {
        actionId: `item.use.wonder-launcher:${sourceInstanceId}`,
        input: definition.spec.targets.length || definition.spec.choices.length ? 'choices' : 'immediate',
      },
      selectionOptions: launcherSelectionOptions,
    })
  }
  return { offers, affordances }
}
