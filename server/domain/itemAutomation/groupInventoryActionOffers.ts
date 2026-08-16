import { createHash } from 'node:crypto'
import {
  INVENTORY_ACTION_SCHEMA_VERSION,
  parseInventoryActionProjection,
  type InventoryActionDestinationOptionV1,
  type InventoryActionOfferV1,
  type InventoryActionProjectionV1,
  type InventoryActionRevisionRequirementV1,
} from '#shared/itemAutomation/inventoryActions'
import type {
  GroupInventoryDocument,
  GroupInventoryEntry,
  GroupInventorySectionKey,
} from '~/types/groupInventory'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { resolveCanonicalItemId } from './registry'
import { projectInventoryStackActionOffers } from './inventoryStackActionOffers'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'

const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)
const opaque = (prefix: string, ...parts: readonly string[]): string => `${prefix}${digest32(...parts)}`
const offerIdentity = (...parts: readonly string[]): string => opaque('inventory-action-offer:v1:', ...parts)
const sourceIdentity = (...parts: readonly string[]): string => opaque('inventory-source:v1:', ...parts)
const destinationIdentity = (...parts: readonly string[]): string => opaque('inventory-destination:v1:', ...parts)
const revisionIdentity = (...parts: readonly string[]): string => opaque('inventory-revision:v1:', ...parts)

const safeRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} has an invalid inventory-action revision.`)
  return Number(value)
}
const sectionLabel = (section: GroupInventorySectionKey): string => (
  TRAINER_INVENTORY_SECTIONS.find(candidate => candidate.key === section)?.title ?? section
)
const trainerLabel = (trainer: TrainerSheet): string => trainer.name?.trim() || 'Trainer'
const rowQuantity = (section: GroupInventorySectionKey, row: InventoryEntry): number => {
  if (section === 'equipment' || row.serializedEquipment !== undefined) return 1
  const value = row.qty
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}
const rowName = (row: InventoryEntry): string => row.name?.trim() || 'Unnamed item'
const stableRow = (rows: readonly InventoryEntry[], row: InventoryEntry): boolean => {
  const id = row.id?.trim()
  return Boolean(id) && rows.filter(candidate => candidate.id === id).length === 1
}
const requirement = (
  resourceKind: InventoryActionRevisionRequirementV1['resourceKind'],
  label: string,
  expectedRevision: number,
  ...identity: readonly string[]
): InventoryActionRevisionRequirementV1 => Object.freeze({
  requirementId: revisionIdentity(resourceKind, ...identity),
  resourceKind,
  label,
  expectedRevision,
})
const sourceRequirement = (
  kind: 'group' | 'trainer',
  slug: string,
  expectedRevision: number,
): InventoryActionRevisionRequirementV1 => requirement(
  'source-container',
  kind === 'group' ? 'Group inventory revision' : 'Trainer inventory revision',
  expectedRevision,
  kind,
  slug,
)
const destinationRequirement = (
  kind: 'group' | 'trainer',
  slug: string,
  expectedRevision: number,
): InventoryActionRevisionRequirementV1 => requirement(
  'destination-container',
  kind === 'group' ? 'Group inventory revision' : 'Trainer inventory revision',
  expectedRevision,
  kind,
  slug,
)
const authorityChecks = (eligible: boolean, sourceLabel: string) => Object.freeze([
  Object.freeze({ kind: 'authenticated-session' as const, label: 'Authenticated campaign session', satisfied: true }),
  Object.freeze({ kind: 'source-control' as const, label: `${sourceLabel} control`, satisfied: eligible }),
  Object.freeze({ kind: 'destination-control' as const, label: 'Current destination control', satisfied: eligible }),
  Object.freeze({ kind: 'current-custody' as const, label: 'Exact current item custody', satisfied: eligible }),
])

export interface GroupInventoryTransferDestinationBinding {
  readonly destinationId: string
  readonly trainerSheet?: TrainerSheet
  readonly groupInventory?: GroupInventoryDocument
  readonly inventoryRow?: InventoryEntry
}

export interface GroupInventoryTransferActionBinding {
  readonly offer: InventoryActionOfferV1
  readonly direction: 'group-to-trainer' | 'trainer-to-group' | 'group-stack'
  readonly section: GroupInventorySectionKey
  readonly sourceRow: GroupInventoryEntry | InventoryEntry
  readonly trainerSheet?: TrainerSheet
  readonly groupInventory: GroupInventoryDocument
  readonly destinationBindings: ReadonlyMap<string, GroupInventoryTransferDestinationBinding>
}

export interface GroupInventoryTransferActionAuthorityV1 {
  readonly projection: InventoryActionProjectionV1
  readonly bindings: ReadonlyMap<string, GroupInventoryTransferActionBinding>
}

const transferOffer = (input: {
  readonly identityParts: readonly string[]
  readonly sourceKind: 'group-inventory' | 'trainer-inventory'
  readonly sourceContainerLabel: string
  readonly sourceContainerKind: 'group' | 'trainer'
  readonly sourceContainerSlug: string
  readonly sourceRevision: number
  readonly section: GroupInventorySectionKey
  readonly row: InventoryEntry
  readonly rowIndex: number
  readonly quantity: number
  readonly reservedQuantity?: number
  readonly stable: boolean
  readonly destinations: readonly InventoryActionDestinationOptionV1[]
  readonly sourceLabel: string
  readonly directionLabel: string
}): InventoryActionOfferV1 => {
  const enabled = input.stable && input.quantity > 0 && input.destinations.some(destination => destination.enabled)
  const wholeItem = input.section === 'equipment' || input.row.serializedEquipment !== undefined
  const unavailableReason = enabled
    ? null
    : !input.stable
      ? Object.freeze({ code: 'source.identity-required', label: 'Save this inventory row before transferring it.' })
      : input.quantity <= 0
        ? input.reservedQuantity && input.reservedQuantity > 0
          ? Object.freeze({ code: 'source.quantity-reserved', label: 'Every unit in this source row is reserved by pending item use.' })
          : Object.freeze({ code: 'source.quantity-unavailable', label: 'This source row has no transferable quantity.' })
        : Object.freeze({ code: 'destination.unavailable', label: 'No current eligible transfer destination is available.' })
  return Object.freeze({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    offerId: offerIdentity(...input.identityParts),
    action: 'transfer' as const,
    label: 'Transfer',
    source: Object.freeze({
      sourceSelectionId: sourceIdentity(
        input.sourceContainerKind,
        input.sourceContainerSlug,
        String(input.sourceRevision),
        input.section,
        input.row.id?.trim() ?? `unstable-${input.rowIndex}`,
      ),
      locationKind: input.sourceKind,
      containerLabel: input.sourceContainerLabel,
      section: input.section,
      sectionLabel: sectionLabel(input.section),
      rowLabel: `Row ${input.rowIndex + 1}`,
      itemLabel: rowName(input.row),
      canonicalItemId: input.row.name?.trim() || null,
      availableQuantity: input.quantity,
      itemForm: wholeItem ? 'whole-item' as const : 'stack' as const,
    }),
    authority: Object.freeze({ requiredRole: 'player-or-gm' as const, checks: authorityChecks(enabled, input.sourceLabel) }),
    revisionRequirements: Object.freeze([
      sourceRequirement(input.sourceContainerKind, input.sourceContainerSlug, input.sourceRevision),
    ]),
    quantity: Object.freeze({
      mode: 'bounded' as const,
      minimum: 1,
      maximum: Math.max(1, input.quantity),
      defaultValue: 1,
      unitLabel: wholeItem ? 'whole item' : 'items',
    }),
    destination: Object.freeze({
      mode: 'required' as const,
      allowedKinds: Object.freeze(['trainer-inventory' as const, 'group-inventory' as const]),
      rules: Object.freeze([
        'Choose one current server-issued destination.',
        'Quantity cannot exceed the exact current source quantity.',
      ]),
      options: Object.freeze([...input.destinations]),
    }),
    consequences: Object.freeze([Object.freeze({
      kind: 'inventory-move' as const,
      label: `The selected quantity moves ${input.directionLabel}.`,
      reversibility: 'reversible' as const,
    })]),
    confirmation: Object.freeze({
      mode: 'action-submit' as const,
      label: `Transfer the selected quantity ${input.directionLabel}.`,
      optionId: null,
    }),
    execution: Object.freeze({ mode: 'command' as const, handoff: 'inventory-transfer' as const, href: null }),
    enabled,
    unavailableReason,
  })
}

export const projectGroupInventoryTransferActionAuthority = (input: {
  readonly groupInventory: GroupInventoryDocument
  readonly trainerSheets: readonly TrainerSheet[]
  readonly canManageGroupStacks: boolean
  readonly reservedQuantity?: (input: {
    readonly containerKind: 'group'
    readonly containerSlug: string
    readonly section: GroupInventorySectionKey
    readonly rowId: string
  }) => number
  readonly generatedAt: number
}): GroupInventoryTransferActionAuthorityV1 => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('Group inventory action projection requires a valid server timestamp.')
  }
  const groupRevision = safeRevision(input.groupInventory.revision, 'Group inventory')
  const trainers = [...input.trainerSheets].sort((left, right) => {
    const labelOrder = trainerLabel(left).localeCompare(trainerLabel(right))
    return labelOrder || left.slug.localeCompare(right.slug)
  })
  const projected: InventoryActionOfferV1[] = []
  const bindings = new Map<string, GroupInventoryTransferActionBinding>()

  for (const section of TRAINER_INVENTORY_SECTIONS.map(candidate => candidate.key)) {
    const groupRows = input.groupInventory.inventory[section] ?? []
    for (const [rowIndex, row] of groupRows.entries()) {
      const quantity = rowQuantity(section, row)
      if (quantity < 1) continue
      const reservedQuantity = row.id?.trim() ? input.reservedQuantity?.({
        containerKind: 'group',
        containerSlug: input.groupInventory.slug,
        section,
        rowId: row.id.trim(),
      }) ?? 0 : 0
      if (!Number.isSafeInteger(reservedQuantity) || reservedQuantity < 0 || reservedQuantity > quantity) {
        throw new Error('Group inventory transfer reservation authority is inconsistent with current custody.')
      }
      const availableQuantity = quantity - reservedQuantity
      const destinations = trainers.map((trainer): {
        readonly projected: InventoryActionDestinationOptionV1
        readonly binding: GroupInventoryTransferDestinationBinding
      } => {
        const trainerRevision = safeRevision(trainer.revision ?? 0, 'Trainer inventory')
        const id = destinationIdentity(
          'group-to-trainer', input.groupInventory.slug, String(groupRevision),
          section, row.id, trainer.slug, String(trainerRevision),
        )
        return Object.freeze({
          projected: Object.freeze({
            destinationId: id,
            kind: 'trainer-inventory' as const,
            label: `${trainerLabel(trainer)} · ${sectionLabel(section)}`,
            description: 'Moves the selected quantity into this Trainer’s inventory.',
            enabled: true,
            unavailableReason: null,
            revisionRequirements: Object.freeze([
              destinationRequirement('trainer', trainer.slug, trainerRevision),
            ]),
          }),
          binding: Object.freeze({ destinationId: id, trainerSheet: trainer }),
        })
      })
      const offer = transferOffer({
        identityParts: ['group-to-trainer', input.groupInventory.slug, String(groupRevision), section, row.id,
          String(reservedQuantity), ...destinations.map(destination => destination.projected.destinationId)],
        sourceKind: 'group-inventory',
        sourceContainerLabel: 'Group inventory',
        sourceContainerKind: 'group',
        sourceContainerSlug: input.groupInventory.slug,
        sourceRevision: groupRevision,
        section,
        row,
        rowIndex,
        quantity: availableQuantity,
        reservedQuantity,
        stable: stableRow(groupRows, row),
        destinations: destinations.map(destination => destination.projected),
        sourceLabel: 'Group inventory source',
        directionLabel: 'from group inventory to the selected Trainer',
      })
      projected.push(offer)
      bindings.set(offer.offerId, Object.freeze({
        offer,
        direction: 'group-to-trainer',
        section,
        sourceRow: row,
        groupInventory: input.groupInventory,
        destinationBindings: new Map(destinations.map(destination => [destination.binding.destinationId, destination.binding])),
      }))

      for (const stackBinding of projectInventoryStackActionOffers({
        containerKind: 'group',
        containerSlug: input.groupInventory.slug,
        containerRevision: groupRevision,
        locationKind: 'group-inventory',
        containerLabel: 'Group inventory',
        section,
        sectionLabel: sectionLabel(section),
        rows: groupRows,
        row,
        rowIndex,
        sourceSelectionId: offer.source.sourceSelectionId,
        canonicalItemId: resolveCanonicalItemId(row.name),
        stableSource: stableRow(groupRows, row),
        reservedQuantity,
        canManage: input.canManageGroupStacks === true,
        requiredRole: 'gm',
        sourceRevisionRequirement: sourceRequirement('group', input.groupInventory.slug, groupRevision),
      })) {
        projected.push(stackBinding.offer)
        bindings.set(stackBinding.offer.offerId, Object.freeze({
          offer: stackBinding.offer,
          direction: 'group-stack',
          section,
          sourceRow: row,
          groupInventory: input.groupInventory,
          destinationBindings: new Map([...stackBinding.destinationBindings].map(([id, binding]) => [id, Object.freeze({
            destinationId: id,
            inventoryRow: binding.destinationRow,
          })])),
        }))
      }
    }

    for (const trainer of trainers) {
      const trainerRevision = safeRevision(trainer.revision ?? 0, 'Trainer inventory')
      const trainerRows = trainer.inventory?.[section] ?? []
      for (const [rowIndex, row] of trainerRows.entries()) {
        const quantity = rowQuantity(section, row)
        if (quantity < 1) continue
        const destinationId = destinationIdentity(
          'trainer-to-group', trainer.slug, String(trainerRevision), section,
          row.id?.trim() ?? `unstable-${rowIndex}`, input.groupInventory.slug, String(groupRevision),
        )
        const destination: InventoryActionDestinationOptionV1 = Object.freeze({
          destinationId,
          kind: 'group-inventory' as const,
          label: `Group inventory · ${sectionLabel(section)}`,
          description: 'Moves the selected quantity into shared group custody.',
          enabled: true,
          unavailableReason: null,
          revisionRequirements: Object.freeze([
            destinationRequirement('group', input.groupInventory.slug, groupRevision),
          ]),
        })
        const offer = transferOffer({
          identityParts: ['trainer-to-group', trainer.slug, String(trainerRevision), section,
            row.id?.trim() ?? `unstable-${rowIndex}`, destinationId],
          sourceKind: 'trainer-inventory',
          sourceContainerLabel: `${trainerLabel(trainer)} inventory`,
          sourceContainerKind: 'trainer',
          sourceContainerSlug: trainer.slug,
          sourceRevision: trainerRevision,
          section,
          row,
          rowIndex,
          quantity,
          stable: stableRow(trainerRows, row),
          destinations: [destination],
          sourceLabel: 'Trainer inventory source',
          directionLabel: 'from Trainer inventory to group inventory',
        })
        projected.push(offer)
        bindings.set(offer.offerId, Object.freeze({
          offer,
          direction: 'trainer-to-group',
          section,
          sourceRow: row,
          trainerSheet: trainer,
          groupInventory: input.groupInventory,
          destinationBindings: new Map([[destinationId, Object.freeze({
            destinationId,
            groupInventory: input.groupInventory,
          })]]),
        }))
      }
    }
  }

  const projection = parseInventoryActionProjection({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    offers: projected,
  })
  return Object.freeze({ projection, bindings })
}
