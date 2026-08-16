import { createHash } from 'node:crypto'
import {
  INVENTORY_ACTION_SCHEMA_VERSION,
  type InventoryActionDestinationOptionV1,
  type InventoryActionOfferV1,
  type InventoryActionReasonV1,
  type InventoryActionRevisionRequirementV1,
  type InventoryActionSourceLocationKind,
  type InventoryActionSourceV1,
} from '#shared/itemAutomation/inventoryActions'
import type { ItemInventorySection, ItemSourceContainerKind } from '#shared/itemAutomation/inventory'
import type { InventoryEntry } from '~/types/trainerSheet'
import { inventoryTransferEntriesCanMerge } from '~/utils/groupInventoryTransfers'
import {
  INVENTORY_STACK_MAX_ROWS_PER_SECTION,
  inventoryStackRowQuantity,
  inventoryStackRowUsesQuantity,
} from './inventoryStackOperations'

const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)
const offerIdentity = (...parts: readonly string[]): string => `inventory-action-offer:v1:${digest32(...parts)}`
const destinationIdentity = (...parts: readonly string[]): string => `inventory-destination:v1:${digest32(...parts)}`
const confirmationIdentity = (...parts: readonly string[]): string => `inventory-confirmation:v1:${digest32(...parts)}`
const reason = (code: string, label: string): InventoryActionReasonV1 => Object.freeze({ code, label })

export interface InventoryStackDestinationBinding {
  readonly destinationId: string
  readonly destinationRow: InventoryEntry
}

export interface InventoryStackOfferBinding {
  readonly offer: InventoryActionOfferV1
  readonly sourceRow: InventoryEntry
  readonly destinationBindings: ReadonlyMap<string, InventoryStackDestinationBinding>
}

export interface ProjectInventoryStackActionOffersInput {
  readonly containerKind: ItemSourceContainerKind
  readonly containerSlug: string
  readonly containerRevision: number
  readonly locationKind: InventoryActionSourceLocationKind
  readonly containerLabel: string
  readonly section: ItemInventorySection
  readonly sectionLabel: string
  readonly rows: readonly InventoryEntry[]
  readonly row: InventoryEntry
  readonly rowIndex: number
  readonly sourceSelectionId: string
  readonly canonicalItemId: string | null
  readonly stableSource: boolean
  readonly reservedQuantity: number
  readonly canManage: boolean
  readonly requiredRole: 'player-or-gm' | 'gm'
  readonly sourceRevisionRequirement: InventoryActionRevisionRequirementV1
}

const source = (input: ProjectInventoryStackActionOffersInput, quantity: number): InventoryActionSourceV1 => Object.freeze({
  sourceSelectionId: input.sourceSelectionId,
  locationKind: input.locationKind,
  containerLabel: input.containerLabel,
  section: input.section,
  sectionLabel: input.sectionLabel,
  rowLabel: `Row ${input.rowIndex + 1}`,
  itemLabel: input.row.name?.trim() || 'Unnamed item',
  canonicalItemId: input.canonicalItemId,
  availableQuantity: quantity,
  itemForm: inventoryStackRowUsesQuantity(input.section, input.row) ? 'stack' as const : 'whole-item' as const,
})
const authority = (input: ProjectInventoryStackActionOffersInput, eligible: boolean) => Object.freeze({
  requiredRole: input.requiredRole,
  checks: Object.freeze([
    Object.freeze({ kind: 'authenticated-session' as const, label: 'Authenticated campaign session', satisfied: true }),
    Object.freeze({ kind: 'source-control' as const, label: `${input.containerLabel} control`, satisfied: input.canManage }),
    ...(input.requiredRole === 'gm'
      ? [Object.freeze({ kind: 'gm-role' as const, label: 'GM shared-inventory authority', satisfied: input.canManage })]
      : []),
    Object.freeze({ kind: 'current-custody' as const, label: 'Exact current stack custody', satisfied: input.stableSource }),
    Object.freeze({ kind: 'mechanics-eligibility' as const, label: 'Current stack action eligibility', satisfied: eligible }),
  ]),
})
const unavailableBase = (input: ProjectInventoryStackActionOffersInput): InventoryActionReasonV1 | null => {
  if (!input.canManage) return reason('authority.unavailable', input.requiredRole === 'gm'
    ? 'Only a GM can reorganize or discard shared inventory stacks.'
    : 'This inventory is not controlled by the selected profile.')
  if (!input.stableSource) return reason('source.identity-required', 'Save this inventory row before changing its stack shape.')
  return null
}
const sameContainerDestination = (
  input: ProjectInventoryStackActionOffersInput,
  target: InventoryEntry,
  targetIndex: number,
  sourceQuantity: number,
): { readonly projected: InventoryActionDestinationOptionV1, readonly binding: InventoryStackDestinationBinding } => {
  const targetQuantity = inventoryStackRowQuantity(input.section, target)
  const stableTarget = Boolean(target.id?.trim())
    && input.rows.filter(candidate => candidate.id === target.id).length === 1
  const safeTotal = Number.isSafeInteger(targetQuantity + sourceQuantity)
  const unavailableReason = !stableTarget
    ? reason('destination.identity-required', 'Save this destination row before merging into it.')
    : !safeTotal
      ? reason('destination.quantity-overflow', 'The merged quantity would exceed the safe integer range.')
      : null
  const id = destinationIdentity(
    'merge', input.containerKind, input.containerSlug, String(input.containerRevision),
    input.section, input.row.id?.trim() ?? `unstable-${input.rowIndex}`,
    target.id?.trim() ?? `unstable-${targetIndex}`,
  )
  return Object.freeze({
    projected: Object.freeze({
      destinationId: id,
      kind: 'same-container' as const,
      label: `${input.sectionLabel} · Row ${targetIndex + 1} · ${target.name?.trim() || 'Unnamed item'}`,
      description: unavailableReason?.label ?? `Keeps Row ${targetIndex + 1} and combines ${targetQuantity + sourceQuantity} total items there.`,
      enabled: unavailableReason === null,
      unavailableReason,
      revisionRequirements: Object.freeze([]),
    }),
    binding: Object.freeze({ destinationId: id, destinationRow: target }),
  })
}

export const projectInventoryStackActionOffers = (
  input: ProjectInventoryStackActionOffersInput,
): readonly InventoryStackOfferBinding[] => {
  const quantity = inventoryStackRowQuantity(input.section, input.row)
  if (!Number.isSafeInteger(input.reservedQuantity) || input.reservedQuantity < 0 || input.reservedQuantity > quantity) {
    throw new Error('Inventory stack projection received invalid reservation authority.')
  }
  const baseUnavailable = unavailableBase(input)
  const sourceProjection = source(input, quantity)
  const identity = [
    input.containerKind, input.containerSlug, String(input.containerRevision), input.section,
    input.row.id?.trim() ?? `unstable-${input.rowIndex}`,
  ] as const
  const offers: InventoryStackOfferBinding[] = []
  const stackable = inventoryStackRowUsesQuantity(input.section, input.row)

  if (stackable) {
    const splitMaximum = quantity - Math.max(1, input.reservedQuantity)
    const splitUnavailable = baseUnavailable
      ?? (quantity < 2 ? reason('stack.quantity-required', 'At least 2 items are required to split this stack.') : null)
      ?? (splitMaximum < 1 ? reason('stack.reserved', 'Pending item decisions leave no quantity available to split.') : null)
      ?? (input.rows.length >= INVENTORY_STACK_MAX_ROWS_PER_SECTION
        ? reason('stack.row-limit', `This section already has ${INVENTORY_STACK_MAX_ROWS_PER_SECTION} rows.`)
        : null)
    const splitId = offerIdentity('split', ...identity, String(input.reservedQuantity))
    const splitOffer: InventoryActionOfferV1 = Object.freeze({
      schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
      offerId: splitId,
      action: 'split',
      label: 'Split',
      source: sourceProjection,
      authority: authority(input, splitUnavailable === null),
      revisionRequirements: Object.freeze([input.sourceRevisionRequirement]),
      quantity: Object.freeze({
        mode: 'bounded' as const,
        minimum: 1,
        maximum: Math.max(1, splitMaximum),
        defaultValue: 1,
        unitLabel: 'items',
      }),
      destination: Object.freeze({
        mode: 'server-determined' as const,
        allowedKinds: Object.freeze(['same-container' as const]),
        rules: Object.freeze([
          'The source row keeps its current identity.',
          'The server creates one new stable row with identical item metadata.',
        ]),
        options: Object.freeze([]),
      }),
      consequences: Object.freeze([Object.freeze({
        kind: 'stack-shape' as const,
        label: 'The selected quantity becomes one separate stack in the same section.',
        reversibility: 'reversible' as const,
      })]),
      confirmation: Object.freeze({ mode: 'action-submit' as const, label: 'Create one separate stack with this quantity.', optionId: null }),
      execution: Object.freeze({ mode: 'command' as const, handoff: 'inventory-stack-operation' as const, href: null }),
      enabled: splitUnavailable === null,
      unavailableReason: splitUnavailable,
    })
    offers.push(Object.freeze({ offer: splitOffer, sourceRow: input.row, destinationBindings: new Map() }))

    const destinations = input.rows.flatMap((target, targetIndex) => (
      targetIndex !== input.rowIndex && inventoryTransferEntriesCanMerge(input.section, input.row, target)
        ? [sameContainerDestination(input, target, targetIndex, quantity)]
        : []
    )).slice(0, 128)
    const mergeUnavailable = baseUnavailable
      ?? (input.reservedQuantity > 0 ? reason('stack.reserved', 'This whole stack is reserved by a pending item decision.') : null)
      ?? (destinations.some(destination => destination.projected.enabled)
        ? null
        : reason('destination.unavailable', 'No other current row has the same canonical identity and stack metadata.'))
    const mergeId = offerIdentity('merge', ...identity, ...destinations.map(row => row.projected.destinationId))
    const mergeOffer: InventoryActionOfferV1 = Object.freeze({
      schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
      offerId: mergeId,
      action: 'merge',
      label: 'Merge',
      source: sourceProjection,
      authority: authority(input, mergeUnavailable === null),
      revisionRequirements: Object.freeze([input.sourceRevisionRequirement]),
      quantity: Object.freeze({ mode: 'whole-stack' as const, minimum: quantity, maximum: quantity, defaultValue: quantity, unitLabel: 'items' }),
      destination: Object.freeze({
        mode: 'required' as const,
        allowedKinds: Object.freeze(['same-container' as const]),
        rules: Object.freeze([
          'Only exact canonical identity and equal stack metadata can merge.',
          'The selected destination row keeps its current stable identity.',
        ]),
        options: Object.freeze(destinations.map(row => row.projected)),
      }),
      consequences: Object.freeze([Object.freeze({
        kind: 'stack-shape' as const,
        label: 'This whole stack is removed and its quantity is added to the selected current row.',
        reversibility: 'reversible' as const,
      })]),
      confirmation: Object.freeze({ mode: 'action-submit' as const, label: 'Merge this whole stack into the selected row.', optionId: null }),
      execution: Object.freeze({ mode: 'command' as const, handoff: 'inventory-stack-operation' as const, href: null }),
      enabled: mergeUnavailable === null,
      unavailableReason: mergeUnavailable,
    })
    offers.push(Object.freeze({
      offer: mergeOffer,
      sourceRow: input.row,
      destinationBindings: new Map(destinations.map(row => [row.binding.destinationId, row.binding])),
    }))
  }

  const discardMaximum = quantity - input.reservedQuantity
  const discardUnavailable = baseUnavailable
    ?? (discardMaximum < 1 ? reason('stack.reserved', 'This item is fully reserved by a pending item decision.') : null)
  const discardId = offerIdentity('discard', ...identity, String(input.reservedQuantity))
  const confirmationOptionId = confirmationIdentity('discard', discardId, String(Math.max(1, discardMaximum)))
  const discardOffer: InventoryActionOfferV1 = Object.freeze({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    offerId: discardId,
    action: 'discard',
    label: 'Discard',
    source: sourceProjection,
    authority: authority(input, discardUnavailable === null),
    revisionRequirements: Object.freeze([input.sourceRevisionRequirement]),
    quantity: Object.freeze({
      mode: 'bounded' as const,
      minimum: 1,
      maximum: Math.max(1, discardMaximum),
      defaultValue: 1,
      unitLabel: stackable ? 'items' : 'whole item',
    }),
    destination: Object.freeze({ mode: 'none' as const, allowedKinds: Object.freeze([]), rules: Object.freeze([]), options: Object.freeze([]) }),
    consequences: Object.freeze([Object.freeze({
      kind: 'discard' as const,
      label: 'The selected quantity is permanently removed from this inventory.',
      reversibility: 'irreversible' as const,
    })]),
    confirmation: Object.freeze({
      mode: 'explicit-choice' as const,
      label: 'I understand these items cannot be recovered through ordinary inventory actions.',
      optionId: confirmationOptionId,
    }),
    execution: Object.freeze({ mode: 'command' as const, handoff: 'inventory-stack-operation' as const, href: null }),
    enabled: discardUnavailable === null,
    unavailableReason: discardUnavailable,
  })
  offers.push(Object.freeze({ offer: discardOffer, sourceRow: input.row, destinationBindings: new Map() }))

  return Object.freeze(offers)
}
