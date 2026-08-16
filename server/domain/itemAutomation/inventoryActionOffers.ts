import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  INVENTORY_ACTION_SCHEMA_VERSION,
  parseInventoryActionProjection,
  type InventoryActionConsequenceV1,
  type InventoryActionDestinationOptionV1,
  type InventoryActionOfferV1,
  type InventoryActionProjectionV1,
  type InventoryActionReasonV1,
  type InventoryActionRevisionRequirementV1,
} from '#shared/itemAutomation/inventoryActions'
import {
  parseSheetEquipmentStateForOwner,
  type EquipmentSlotId,
  type SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'
import type { EquipmentOperationConfigurationChoiceV1 } from '#shared/itemAutomation/equipmentOperations'
import type { SheetItemActionOfferV1, SheetItemTargetOption } from '#shared/itemAutomation/sheetActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import type { TrainerSheetItemActionAuthority } from '../../useCases/loadSheetItemActions'
import {
  equipmentConfigurationCandidatesForOwner,
  evaluateEquipmentCompatibility,
} from './equipmentCompatibility'
import { equipmentDefinitionFor } from './equipmentDefinitionRegistry'
import { projectInventoryStackActionOffers } from './inventoryStackActionOffers'

const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)
const opaque = (prefix: string, ...parts: readonly string[]): string => `${prefix}${digest32(...parts)}`
const offerId = (...parts: readonly string[]): string => opaque('inventory-action-offer:v1:', ...parts)
const destinationId = (...parts: readonly string[]): string => opaque('inventory-destination:v1:', ...parts)
const revisionId = (...parts: readonly string[]): string => opaque('inventory-revision:v1:', ...parts)

const safeRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} has an invalid inventory-action revision.`)
  return Number(value)
}
const reason = (code: string, label: string): InventoryActionReasonV1 => Object.freeze({ code, label })
const unavailable = (value: { readonly code: string, readonly label: string } | null | undefined): InventoryActionReasonV1 | null => (
  value ? reason(value.code, value.label) : null
)
const revision = (
  resourceKind: InventoryActionRevisionRequirementV1['resourceKind'],
  label: string,
  expectedRevision: number,
  ...identity: readonly string[]
): InventoryActionRevisionRequirementV1 => Object.freeze({
  requirementId: revisionId(resourceKind, ...identity),
  resourceKind,
  label,
  expectedRevision,
})
const authorityChecks = (eligible: boolean) => Object.freeze([
  Object.freeze({ kind: 'authenticated-session' as const, label: 'Authenticated campaign session', satisfied: true }),
  Object.freeze({ kind: 'source-control' as const, label: 'Current Trainer inventory control', satisfied: true }),
  Object.freeze({ kind: 'current-custody' as const, label: 'Exact current item custody', satisfied: eligible }),
  Object.freeze({ kind: 'mechanics-eligibility' as const, label: 'Current action eligibility', satisfied: eligible }),
])
const fixedQuantity = Object.freeze({ mode: 'fixed' as const, minimum: 1, maximum: 1, defaultValue: 1, unitLabel: 'whole item' })
const noQuantity = Object.freeze({ mode: 'none' as const, minimum: null, maximum: null, defaultValue: null, unitLabel: null })
const confirmation = (label: string | null) => Object.freeze({
  mode: label === null ? 'none' as const : 'action-submit' as const,
  label,
  optionId: null,
})
const execution = (handoff: InventoryActionOfferV1['execution']['handoff'], href: string | null = null) => Object.freeze({
  mode: handoff === 'inspect-navigation' ? 'navigation' as const : 'command' as const,
  handoff,
  href,
})
const consequence = (
  kind: InventoryActionConsequenceV1['kind'],
  label: string,
  reversibility: InventoryActionConsequenceV1['reversibility'],
): InventoryActionConsequenceV1 => Object.freeze({ kind, label, reversibility })

export interface TrainerInventoryActionDestinationBinding {
  readonly destinationId: string
  readonly kind: 'item-target' | 'trainer-equipment' | 'pokemon-equipment' | 'group-inventory' | 'same-container'
  readonly targetOption?: SheetItemTargetOption
  readonly pokemonSheet?: CharacterSheet
  readonly groupInventory?: GroupInventoryDocument
  readonly slotIds?: readonly EquipmentSlotId[]
  readonly equipmentState?: SheetEquipmentStateV1
  readonly configuration?: EquipmentOperationConfigurationChoiceV1 | null
  readonly inventoryRow?: InventoryEntry
}

export interface TrainerInventoryActionBinding {
  readonly offer: InventoryActionOfferV1
  readonly itemOffer: SheetItemActionOfferV1
  readonly sourceEntry: InventoryEntry
  readonly destinationBindings: ReadonlyMap<string, TrainerInventoryActionDestinationBinding>
}

export interface TrainerInventoryActionAuthorityV1 {
  readonly projection: InventoryActionProjectionV1
  readonly bindings: ReadonlyMap<string, TrainerInventoryActionBinding>
}

export interface ProjectTrainerInventoryActionsInput {
  readonly authority: TrainerSheetItemActionAuthority
  readonly groupInventory: GroupInventoryDocument | null
  readonly reservedQuantity?: (input: {
    readonly containerKind: 'trainer'
    readonly containerSlug: string
    readonly section: SheetItemActionOfferV1['source']['section']
    readonly rowId: string
  }) => number
  readonly generatedAt: number
}

const pokemonLabel = (sheet: CharacterSheet): string => sheet.nickname?.trim() || sheet.species?.trim() || 'Linked Pokémon'
const trainerLabel = (sheet: TrainerSheet): string => sheet.name?.trim() || 'Trainer'
const sourceEntryFor = (trainer: TrainerSheet, itemOffer: SheetItemActionOfferV1): InventoryEntry | null => (
  trainer.inventory?.[itemOffer.source.section]?.[itemOffer.source.rowIndex] ?? null
)
const stableSourceIdentity = (trainer: TrainerSheet, itemOffer: SheetItemActionOfferV1, entry: InventoryEntry | null): boolean => {
  const id = entry?.id?.trim()
  if (!id) return false
  return (trainer.inventory?.[itemOffer.source.section] ?? []).filter(row => row.id === id).length === 1
}

const sourceRevision = (trainer: TrainerSheet): InventoryActionRevisionRequirementV1 => revision(
  'source-container', 'Trainer inventory revision', safeRevision(trainer.revision ?? 0, 'Trainer sheet'),
  'trainer', trainer.slug,
)
const targetRevision = (kind: 'trainer' | 'pokemon', slug: string, value: number): InventoryActionRevisionRequirementV1 => revision(
  'target-sheet', `${kind === 'trainer' ? 'Trainer' : 'Pokémon'} target revision`, value,
  kind, slug,
)
const destinationSheetRevision = (kind: 'trainer' | 'pokemon', slug: string, value: number): InventoryActionRevisionRequirementV1 => revision(
  'destination-sheet', `${kind === 'trainer' ? 'Trainer' : 'Pokémon'} destination revision`, value,
  kind, slug,
)
const destinationEquipmentRevision = (kind: 'trainer' | 'pokemon', slug: string, value: number): InventoryActionRevisionRequirementV1 => revision(
  'destination-equipment', `${kind === 'trainer' ? 'Trainer' : 'Pokémon'} equipment revision`, value,
  kind, slug,
)
const destinationGroupRevision = (slug: string, value: number): InventoryActionRevisionRequirementV1 => revision(
  'destination-container', 'Group inventory revision', value, 'group', slug,
)

const actionSource = (itemOffer: SheetItemActionOfferV1, wholeItem: boolean) => Object.freeze({
  sourceSelectionId: itemOffer.source.sourceSelectionId,
  locationKind: 'trainer-inventory' as const,
  containerLabel: itemOffer.source.containerLabel,
  section: itemOffer.source.section,
  sectionLabel: itemOffer.source.sectionLabel,
  rowLabel: itemOffer.source.rowLabel,
  itemLabel: itemOffer.source.displayName,
  canonicalItemId: itemOffer.source.canonicalId,
  availableQuantity: itemOffer.source.quantity,
  itemForm: wholeItem ? 'whole-item' as const : 'stack' as const,
})

const targetDestination = (
  itemOffer: SheetItemActionOfferV1,
  option: SheetItemTargetOption,
  targetSheet: CharacterSheet | TrainerSheet,
): { readonly projected: InventoryActionDestinationOptionV1, readonly binding: TrainerInventoryActionDestinationBinding } => {
  const expected = safeRevision(targetSheet.revision ?? 0, `${option.kindLabel} target`)
  const id = destinationId(itemOffer.offerId, 'use', option.targetId, String(expected))
  const projected = Object.freeze({
    destinationId: id,
    kind: 'item-target' as const,
    label: `${option.kindLabel} · ${option.label}`,
    description: option.summary ?? option.description,
    enabled: option.enabled,
    unavailableReason: unavailable(option.unavailableReason),
    revisionRequirements: Object.freeze([targetRevision(option.sheetKind, option.sheetSlug, expected)]),
  })
  return Object.freeze({
    projected,
    binding: Object.freeze({ destinationId: id, kind: 'item-target' as const, targetOption: option }),
  })
}

const equipmentSlotLabels: Readonly<Record<EquipmentSlotId, string>> = Object.freeze({
  mainHand: 'Main Hand',
  offHand: 'Off Hand',
  head: 'Head',
  body: 'Body',
  feet: 'Feet',
  accessory: 'Accessory',
  held: 'Held Item',
  'held-secondary': 'Second Held Item',
})

const equipmentDestinations = (input: {
  readonly itemOffer: SheetItemActionOfferV1
  readonly action: 'equip' | 'give'
  readonly ownerKind: 'trainer' | 'pokemon'
  readonly owner: TrainerSheet | CharacterSheet
  readonly sourceStable: boolean
}): readonly { readonly projected: InventoryActionDestinationOptionV1, readonly binding: TrainerInventoryActionDestinationBinding }[] => {
  const canonicalItemId = input.itemOffer.source.canonicalId
  const definition = canonicalItemId ? equipmentDefinitionFor(canonicalItemId) : null
  const ownerRule = definition?.ownerRules.find(rule => rule.ownerKind === input.ownerKind)
  const sheetRevision = safeRevision(input.owner.revision ?? 0, `${input.ownerKind} destination`)
  const compatibilityOwner = input.ownerKind === 'trainer'
    ? { kind: 'trainer' as const, slug: input.owner.slug, sheet: input.owner as TrainerSheet }
    : { kind: 'pokemon' as const, slug: input.owner.slug, sheet: input.owner as CharacterSheet }
  let state: SheetEquipmentStateV1 | null = null
  let baseUnavailableReason: InventoryActionReasonV1 | null = null
  try {
    state = parseSheetEquipmentStateForOwner(input.owner.equipmentState, {
      kind: input.ownerKind,
      slug: input.owner.slug,
    })
  }
  catch {
    baseUnavailableReason = reason('equipment.state-invalid', 'Current equipment authority is unavailable. Refresh before continuing.')
  }
  if (!canonicalItemId || !definition || !ownerRule) {
    baseUnavailableReason ??= reason('equipment.owner-incompatible', `This item cannot be equipped by a ${input.ownerKind === 'trainer' ? 'Trainer' : 'Pokémon'}.`)
  }
  if (!input.sourceStable) {
    baseUnavailableReason = reason('source.identity-required', 'Save this inventory row before moving the whole item.')
  }

  const reviewedConfigurations = definition
    ? equipmentConfigurationCandidatesForOwner({ owner: compatibilityOwner, definition })
    : []
  const configurationUnavailable = Boolean(definition?.configuration) && reviewedConfigurations.length === 0
  const configurations = reviewedConfigurations.length
    ? reviewedConfigurations
    : [Object.freeze({ configuration: null, label: null })]
  const slots = ownerRule?.slotOptions.length ? ownerRule.slotOptions : [Object.freeze([] as EquipmentSlotId[])]
  const equipmentRevision = state?.revision ?? 0
  const ownerName = input.ownerKind === 'trainer'
    ? trainerLabel(input.owner as TrainerSheet)
    : pokemonLabel(input.owner as CharacterSheet)

  return Object.freeze(configurations.flatMap(configuration => slots.map((slotIds) => {
    let unavailableReason = baseUnavailableReason
    if (!unavailableReason && configurationUnavailable) {
      unavailableReason = reason('equipment.configuration-unavailable', 'Current reviewed configuration choices are unavailable for this owner.')
    }
    if (!unavailableReason && state && definition && canonicalItemId) {
      const compatibility = evaluateEquipmentCompatibility({
        owner: compatibilityOwner,
        equipmentState: state,
        canonicalItemId,
        canonicalRecordSha256: definition.canonicalRecordSha256,
        requestedSlots: slotIds,
        configuration: configuration.configuration,
      })
      if (!compatibility.eligible) {
        unavailableReason = compatibility.unavailableReason
          ? reason(compatibility.unavailableReason.code, compatibility.unavailableReason.message)
          : reason('equipment.unavailable', 'This equipment destination is unavailable.')
      }
    }
    const configurationChoice: EquipmentOperationConfigurationChoiceV1 | null = configuration.configuration
      ? Object.freeze({
          schemaVersion: 1,
          configurationId: configuration.configuration.configurationId,
          values: configuration.configuration.values,
        })
      : null
    const id = destinationId(
      input.itemOffer.offerId,
      input.action,
      input.ownerKind,
      input.owner.slug,
      String(sheetRevision),
      String(equipmentRevision),
      ...slotIds,
      stableJsonStringify(configurationChoice),
    )
    const slotLabel = slotIds.length
      ? slotIds.map(slot => equipmentSlotLabels[slot]).join(' + ')
      : input.ownerKind === 'pokemon' ? 'Held Item' : 'Compatible gear slot'
    const label = `${ownerName} · ${slotLabel}${configuration.label ? ` · ${configuration.label}` : ''}`
    const projected = Object.freeze({
      destinationId: id,
      kind: input.ownerKind === 'trainer' ? 'trainer-equipment' as const : 'pokemon-equipment' as const,
      label,
      description: unavailableReason?.label ?? (input.ownerKind === 'trainer'
        ? 'Moves one whole item into this exact configured Trainer equipment destination.'
        : 'Moves one whole item into this exact configured Pokémon held-item destination.'),
      enabled: unavailableReason === null,
      unavailableReason,
      revisionRequirements: Object.freeze([
        destinationSheetRevision(input.ownerKind, input.owner.slug, sheetRevision),
        destinationEquipmentRevision(input.ownerKind, input.owner.slug, equipmentRevision),
      ]),
    })
    return Object.freeze({
      projected,
      binding: Object.freeze({
        destinationId: id,
        kind: input.ownerKind === 'trainer' ? 'trainer-equipment' as const : 'pokemon-equipment' as const,
        ...(input.ownerKind === 'pokemon' ? { pokemonSheet: input.owner as CharacterSheet } : {}),
        ...(slotIds.length ? { slotIds: Object.freeze([...slotIds]) } : {}),
        ...(state ? { equipmentState: state } : {}),
        configuration: configurationChoice,
      }),
    })
  })))
}

const baseOffer = (input: {
  readonly id: string
  readonly action: InventoryActionOfferV1['action']
  readonly label: string
  readonly itemOffer: SheetItemActionOfferV1
  readonly sourceStable: boolean
  readonly wholeItem: boolean
  readonly revisions: readonly InventoryActionRevisionRequirementV1[]
  readonly destination: InventoryActionOfferV1['destination']
  readonly quantity: InventoryActionOfferV1['quantity']
  readonly consequences: readonly InventoryActionConsequenceV1[]
  readonly confirmation: InventoryActionOfferV1['confirmation']
  readonly execution: InventoryActionOfferV1['execution']
  readonly enabled: boolean
  readonly unavailableReason: InventoryActionReasonV1 | null
}): InventoryActionOfferV1 => Object.freeze({
  schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
  offerId: input.id,
  action: input.action,
  label: input.label,
  source: actionSource(input.itemOffer, input.wholeItem),
  authority: Object.freeze({ requiredRole: 'player-or-gm' as const, checks: authorityChecks(input.enabled && input.sourceStable) }),
  revisionRequirements: Object.freeze([...input.revisions]),
  quantity: input.quantity,
  destination: input.destination,
  consequences: Object.freeze([...input.consequences]),
  confirmation: input.confirmation,
  execution: input.execution,
  enabled: input.enabled,
  unavailableReason: input.unavailableReason,
})

export const projectTrainerInventoryActionAuthority = (
  input: ProjectTrainerInventoryActionsInput,
): TrainerInventoryActionAuthorityV1 => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error('Inventory action projection requires a valid server timestamp.')
  const trainer = input.authority.trainerSheet
  const sheets = new Map<string, CharacterSheet | TrainerSheet>([
    [`trainer:${trainer.slug}`, trainer],
    ...input.authority.pokemonSheets.map(sheet => [`pokemon:${sheet.slug}`, sheet] as const),
  ])
  const sourceRequirement = sourceRevision(trainer)
  const projectedOffers: InventoryActionOfferV1[] = []
  const bindings = new Map<string, TrainerInventoryActionBinding>()

  const add = (
    projected: InventoryActionOfferV1,
    itemOffer: SheetItemActionOfferV1,
    entry: InventoryEntry,
    destinations: readonly TrainerInventoryActionDestinationBinding[],
  ): void => {
    projectedOffers.push(projected)
    bindings.set(projected.offerId, Object.freeze({
      offer: projected,
      itemOffer,
      sourceEntry: entry,
      destinationBindings: new Map(destinations.map(binding => [binding.destinationId, binding])),
    }))
  }

  for (const itemOffer of input.authority.projection.offers) {
    const entry = sourceEntryFor(trainer, itemOffer)
    if (!entry) throw new Error('Inventory action source moved during projection.')
    const sourceStable = stableSourceIdentity(trainer, itemOffer, entry)
    const wholeItem = itemOffer.source.section === 'equipment' || entry.serializedEquipment !== undefined
    const useControl = itemOffer.actions.find(action => action.kind === 'use')
    const inspectControl = itemOffer.actions.find(action => action.kind === 'inspect')
    const equipControl = itemOffer.actions.find(action => action.kind === 'equip')

    if (useControl) {
      const targets = (itemOffer.targeting?.options ?? []).flatMap((option) => {
        const targetSheet = sheets.get(`${option.sheetKind}:${option.sheetSlug}`)
        return targetSheet ? [targetDestination(itemOffer, option, targetSheet)] : []
      })
      const enabled = sourceStable && useControl.enabled && targets.some(row => row.projected.enabled)
      const unavailableReason = enabled
        ? null
        : !sourceStable
          ? reason('source.identity-required', 'Save this inventory row before using it.')
          : unavailable(useControl.unavailableReason ?? itemOffer.availability.unavailableReason)
            ?? reason('destination.unavailable', 'No current eligible item target is available.')
      const id = offerId(itemOffer.offerId, 'use', ...targets.map(row => row.projected.destinationId))
      const projected = baseOffer({
        id, action: 'use', label: 'Use', itemOffer, sourceStable, wholeItem,
        revisions: [sourceRequirement],
        destination: Object.freeze({
          mode: 'required' as const,
          allowedKinds: Object.freeze(['item-target' as const]),
          rules: Object.freeze(['Choose only a current server-issued eligible target.']),
          options: Object.freeze(targets.map(row => row.projected)),
        }),
        quantity: fixedQuantity,
        consequences: Object.freeze([
          consequence('mechanical-effect', 'Only the owning item use case may apply reviewed mechanics.', 'correctable'),
          ...(itemOffer.acceptanceNotice.startsWith('Consumes ')
            ? [consequence('inventory-consumption', itemOffer.acceptanceNotice, 'correctable')] : []),
        ]),
        confirmation: confirmation('Review target, choices, and consequences before confirming use.'),
        execution: execution('item-operation'),
        enabled,
        unavailableReason,
      })
      add(projected, itemOffer, entry, targets.map(row => row.binding))
    }

    if (equipControl) {
      const destinations = equipmentDestinations({ itemOffer, action: 'equip', ownerKind: 'trainer', owner: trainer, sourceStable })
      const enabled = sourceStable && equipControl.enabled && destinations.some(row => row.projected.enabled)
      const unavailableReason = enabled
        ? null
        : !sourceStable
          ? reason('source.identity-required', 'Save this inventory row before equipping it.')
          : unavailable(equipControl.unavailableReason ?? destinations.find(row => row.projected.unavailableReason)?.projected.unavailableReason)
            ?? reason('equipment.unavailable', 'No current compatible Trainer equipment slot is available.')
      const id = offerId(itemOffer.offerId, 'equip', ...destinations.map(row => row.projected.destinationId))
      const projected = baseOffer({
        id, action: 'equip', label: 'Equip', itemOffer, sourceStable, wholeItem,
        revisions: [sourceRequirement],
        destination: Object.freeze({
          mode: 'required' as const,
          allowedKinds: Object.freeze(['trainer-equipment' as const]),
          rules: Object.freeze(['Choose one exact current slot and reviewed configuration for this whole item.']),
          options: Object.freeze(destinations.map(row => row.projected)),
        }),
        quantity: fixedQuantity,
        consequences: Object.freeze([
          consequence('inventory-move', 'One whole item leaves Trainer inventory.', 'reversible'),
          consequence('equipment-custody', 'The same whole item enters Trainer equipment custody.', 'reversible'),
        ]),
        confirmation: confirmation('Equip this whole item in the selected current slot and configuration.'),
        execution: execution('equipment-operation'),
        enabled,
        unavailableReason,
      })
      add(projected, itemOffer, entry, destinations.map(row => row.binding))
    }

    const definition = itemOffer.source.canonicalId ? equipmentDefinitionFor(itemOffer.source.canonicalId) : null
    if (definition?.ownerRules.some(rule => rule.ownerKind === 'pokemon')) {
      const destinations = input.authority.pokemonSheets.flatMap(owner => equipmentDestinations({
        itemOffer, action: 'give', ownerKind: 'pokemon', owner, sourceStable,
      }))
      const enabled = sourceStable && destinations.some(row => row.projected.enabled)
      const unavailableReason = enabled
        ? null
        : !sourceStable
          ? reason('source.identity-required', 'Save this inventory row before giving it.')
          : reason('destination.unavailable', 'No linked Pokémon has a current compatible Held Item destination.')
      const id = offerId(itemOffer.offerId, 'give', ...destinations.map(row => row.projected.destinationId))
      const projected = baseOffer({
        id, action: 'give', label: 'Give', itemOffer, sourceStable, wholeItem,
        revisions: [sourceRequirement],
        destination: Object.freeze({
          mode: 'required' as const,
          allowedKinds: Object.freeze(['pokemon-equipment' as const]),
          rules: Object.freeze(['Choose one linked Pokémon with a current compatible empty Held Item destination.']),
          options: Object.freeze(destinations.map(row => row.projected)),
        }),
        quantity: fixedQuantity,
        consequences: Object.freeze([
          consequence('inventory-move', 'One whole item leaves Trainer inventory.', 'reversible'),
          consequence('equipment-custody', 'The same whole item enters the selected Pokémon’s held-item custody.', 'reversible'),
        ]),
        confirmation: confirmation('Give this whole item to the selected Pokémon.'),
        execution: execution('equipment-operation'),
        enabled,
        unavailableReason,
      })
      add(projected, itemOffer, entry, destinations.map(row => row.binding))
    }

    {
      const group = input.groupInventory
      const groupRevision = group ? safeRevision(group.revision, 'Group inventory') : 0
      const id = destinationId(itemOffer.offerId, 'transfer', group?.slug ?? 'missing', String(groupRevision))
      const destination: InventoryActionDestinationOptionV1 = Object.freeze({
        destinationId: id,
        kind: 'group-inventory' as const,
        label: 'Group inventory',
        description: group ? 'Moves the selected quantity into shared group custody.' : 'Group inventory is unavailable.',
        enabled: Boolean(group),
        unavailableReason: group ? null : reason('destination.unavailable', 'Group inventory is unavailable.'),
        revisionRequirements: Object.freeze(group ? [destinationGroupRevision(group.slug, groupRevision)] : []),
      })
      const enabled = sourceStable && Boolean(group)
      const unavailableReason = enabled
        ? null
        : !sourceStable
          ? reason('source.identity-required', 'Save this inventory row before transferring it.')
          : reason('destination.unavailable', 'Group inventory is unavailable.')
      const transferOfferId = offerId(itemOffer.offerId, 'transfer', destination.destinationId)
      const projected = baseOffer({
        id: transferOfferId, action: 'transfer', label: 'Transfer', itemOffer, sourceStable, wholeItem,
        revisions: [sourceRequirement],
        destination: Object.freeze({
          mode: 'required' as const,
          allowedKinds: Object.freeze(['group-inventory' as const, 'trainer-inventory' as const]),
          rules: Object.freeze(['Quantity cannot exceed the current unreserved source quantity.']),
          options: Object.freeze([destination]),
        }),
        quantity: Object.freeze({
          mode: 'bounded' as const,
          minimum: 1,
          maximum: itemOffer.source.quantity,
          defaultValue: 1,
          unitLabel: wholeItem ? 'whole item' : 'items',
        }),
        consequences: Object.freeze([
          consequence('inventory-move', 'The selected quantity moves from Trainer inventory to group inventory.', 'reversible'),
        ]),
        confirmation: confirmation('Transfer the selected quantity to group inventory.'),
        execution: execution('inventory-transfer'),
        enabled,
        unavailableReason,
      })
      add(projected, itemOffer, entry, [Object.freeze({
        destinationId: id,
        kind: 'group-inventory' as const,
        ...(group ? { groupInventory: group } : {}),
      })])
    }

    for (const stackBinding of projectInventoryStackActionOffers({
      containerKind: 'trainer',
      containerSlug: trainer.slug,
      containerRevision: itemOffer.actor.revision,
      locationKind: 'trainer-inventory',
      containerLabel: itemOffer.source.containerLabel,
      section: itemOffer.source.section,
      sectionLabel: itemOffer.source.sectionLabel,
      rows: trainer.inventory?.[itemOffer.source.section] ?? [],
      row: entry,
      rowIndex: itemOffer.source.rowIndex,
      sourceSelectionId: itemOffer.source.sourceSelectionId,
      canonicalItemId: itemOffer.source.canonicalId,
      stableSource: sourceStable,
      reservedQuantity: entry.id?.trim() ? input.reservedQuantity?.({
        containerKind: 'trainer',
        containerSlug: trainer.slug,
        section: itemOffer.source.section,
        rowId: entry.id.trim(),
      }) ?? 0 : 0,
      canManage: true,
      requiredRole: 'player-or-gm',
      sourceRevisionRequirement: sourceRequirement,
    })) {
      add(stackBinding.offer, itemOffer, entry, [...stackBinding.destinationBindings.values()].map(binding => Object.freeze({
        destinationId: binding.destinationId,
        kind: 'same-container' as const,
        inventoryRow: binding.destinationRow,
      })))
    }

    if (inspectControl) {
      const href = inspectControl.enabled ? inspectControl.href : null
      const enabled = href !== null
      const id = offerId(itemOffer.offerId, 'inspect')
      const projected = baseOffer({
        id, action: 'inspect', label: 'Inspect', itemOffer, sourceStable: true, wholeItem,
        revisions: [sourceRequirement],
        destination: Object.freeze({ mode: 'none' as const, allowedKinds: Object.freeze([]), rules: Object.freeze([]), options: Object.freeze([]) }),
        quantity: noQuantity,
        consequences: Object.freeze([consequence('none', 'Opening reference information changes no campaign state.', 'reversible')]),
        confirmation: confirmation(null),
        execution: execution('inspect-navigation', href),
        enabled,
        unavailableReason: enabled ? null : unavailable(inspectControl.unavailableReason)
          ?? reason('reference.unavailable', 'No canonical item reference is available.'),
      })
      add(projected, itemOffer, entry, [])
    }
  }

  const projection = parseInventoryActionProjection({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    offers: projectedOffers,
  })
  return Object.freeze({ projection, bindings })
}
