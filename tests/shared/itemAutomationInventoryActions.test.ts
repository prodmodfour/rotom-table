import { describe, expect, it } from 'vitest'
import {
  INVENTORY_ACTION_CONTRACT,
  INVENTORY_ACTION_KINDS,
  InventoryActionValidationError,
  parseInventoryActionDeclaration,
  parseInventoryActionExecutionResult,
  parseInventoryActionOffer,
  parseInventoryActionProjection,
  validateInventoryActionDeclarationAgainstOffer,
  type InventoryActionKind,
  type InventoryActionOfferV1,
} from '#shared/itemAutomation/inventoryActions'

const hex = (character: string): string => character.repeat(32)
const revision = (character: string, resourceKind: string, expectedRevision = 4) => ({
  requirementId: `inventory-revision:v1:${hex(character)}`,
  resourceKind,
  label: `${resourceKind} revision`,
  expectedRevision,
})

const offerFor = (action: InventoryActionKind): InventoryActionOfferV1 => {
  const contract = INVENTORY_ACTION_CONTRACT[action]
  const sourceKind = contract.sourceKinds[0]!
  const inventorySource = sourceKind === 'trainer-inventory' || sourceKind === 'group-inventory'
  const availableQuantity = contract.quantityMode === 'none' ? 5 : sourceKind.endsWith('-equipment') ? 1 : 5
  const quantity = contract.quantityMode === 'none'
    ? { mode: 'none', minimum: null, maximum: null, defaultValue: null, unitLabel: null }
    : contract.quantityMode === 'fixed'
      ? { mode: 'fixed', minimum: 1, maximum: 1, defaultValue: 1, unitLabel: 'item' }
      : contract.quantityMode === 'whole-stack'
        ? { mode: 'whole-stack', minimum: availableQuantity, maximum: availableQuantity, defaultValue: availableQuantity, unitLabel: 'items' }
        : { mode: 'bounded', minimum: 1, maximum: availableQuantity, defaultValue: 1, unitLabel: 'items' }
  const sourceRevisions = inventorySource
    ? [revision('1', 'source-container')]
    : [revision('1', 'source-sheet'), revision('2', 'source-equipment')]
  const destinationRevision = revision('3', 'destination-container', 8)
  const destinationOptions = contract.destinationMode === 'required'
    ? [{
        destinationId: `inventory-destination:v1:${hex('4')}`,
        kind: contract.destinationKinds[0]!,
        label: 'Current destination',
        description: 'One current eligible destination.',
        enabled: true,
        unavailableReason: null,
        revisionRequirements: [destinationRevision],
      }]
    : []
  const confirmation = contract.confirmationMode === 'none'
    ? { mode: 'none', label: null, optionId: null }
    : contract.confirmationMode === 'explicit-choice'
      ? {
          mode: 'explicit-choice',
          label: 'I understand this item will be permanently discarded.',
          optionId: `inventory-confirmation:v1:${hex('5')}`,
        }
      : { mode: contract.confirmationMode, label: 'Review this action before continuing.', optionId: null }
  const consequenceKind = contract.allowedConsequences[0]!
  return {
    schemaVersion: 1,
    offerId: `inventory-action-offer:v1:${hex('a')}`,
    action,
    label: action === 'guided-adjudication' ? 'Request GM adjudication' : action[0]!.toUpperCase() + action.slice(1),
    source: {
      sourceSelectionId: `inventory-source:v1:${hex('b')}`,
      locationKind: sourceKind,
      containerLabel: inventorySource ? 'Mira’s Pack' : 'Mira’s Equipment',
      section: inventorySource ? 'medicalKit' : null,
      sectionLabel: inventorySource ? 'Medical Kit' : null,
      rowLabel: inventorySource ? 'Row 1' : 'Equipped item',
      itemLabel: action === 'inspect' ? 'Bandages' : 'Energy Powder',
      canonicalItemId: action === 'inspect' ? 'Bandages' : 'Energy Powder',
      availableQuantity,
      itemForm: sourceKind.endsWith('-equipment') ? 'whole-item' : 'stack',
    },
    authority: {
      requiredRole: 'player-or-gm',
      checks: [
        { kind: 'authenticated-session', label: 'Signed in', satisfied: true },
        { kind: 'source-control', label: 'Controls this source', satisfied: true },
      ],
    },
    revisionRequirements: sourceRevisions,
    quantity,
    destination: {
      mode: contract.destinationMode,
      allowedKinds: [...contract.destinationKinds],
      rules: contract.destinationMode === 'none' ? [] : ['Destination authority is revalidated on commit.'],
      options: destinationOptions,
    },
    consequences: [{
      kind: consequenceKind,
      label: consequenceKind === 'none' ? 'No inventory or mechanical change.' : `Applies ${consequenceKind}.`,
      reversibility: action === 'discard' ? 'irreversible' : consequenceKind === 'none' ? 'reversible' : 'correctable',
    }],
    confirmation,
    execution: {
      mode: contract.executionMode,
      handoff: contract.handoff,
      href: action === 'inspect' ? '/items/Bandages' : null,
    },
    enabled: true,
    unavailableReason: null,
  } as InventoryActionOfferV1
}

const declarationFor = (offer: InventoryActionOfferV1) => {
  const destination = offer.destination.options[0] ?? null
  return {
    schemaVersion: 1,
    operationId: `inventory-action:v1:${hex('c')}`,
    offerId: offer.offerId,
    action: offer.action,
    sourceSelectionId: offer.source.sourceSelectionId,
    quantity: offer.quantity.defaultValue ?? 1,
    destinationId: destination?.destinationId ?? null,
    confirmationOptionId: offer.confirmation.optionId,
    expectedRevisions: [...offer.revisionRequirements, ...(destination?.revisionRequirements ?? [])]
      .map(row => ({ requirementId: row.requirementId, expectedRevision: row.expectedRevision })),
  }
}

describe('unified inventory action contract', () => {
  it('parses all eleven action anatomies and keeps routing mechanically inert', () => {
    expect(INVENTORY_ACTION_KINDS).toEqual([
      'use', 'equip', 'unequip', 'give', 'take', 'transfer',
      'split', 'merge', 'discard', 'inspect', 'guided-adjudication',
    ])
    for (const action of INVENTORY_ACTION_KINDS) {
      const parsed = parseInventoryActionOffer(offerFor(action))
      expect(parsed.action).toBe(action)
      expect(parsed.execution).toMatchObject({
        mode: INVENTORY_ACTION_CONTRACT[action].executionMode,
        handoff: INVENTORY_ACTION_CONTRACT[action].handoff,
      })
      expect(Object.isFrozen(parsed)).toBe(true)
      expect(JSON.stringify(parsed)).not.toMatch(/profileId|rowId|sourceInstanceId|serializedInstanceId|privateNotes|provenance/u)
    }
  })

  it('matches one transfer declaration to exact source, destination, quantity, confirmation, and revisions', () => {
    const offer = offerFor('transfer')
    const declaration = declarationFor(offer)
    expect(validateInventoryActionDeclarationAgainstOffer(offer, declaration)).toEqual(declaration)

    expect(() => validateInventoryActionDeclarationAgainstOffer(offer, {
      ...declaration,
      expectedRevisions: declaration.expectedRevisions.slice(0, 1),
    })).toThrow('does not match every exact source and destination revision')
    expect(() => validateInventoryActionDeclarationAgainstOffer(offer, {
      ...declaration,
      sourceSelectionId: `inventory-source:v1:${hex('d')}`,
    })).toThrow('does not match its exact source action offer')
    expect(() => validateInventoryActionDeclarationAgainstOffer(offer, {
      ...declaration,
      quantity: offer.source.availableQuantity + 1,
    })).toThrow('does not match the current quantity offer')
  })

  it('requires exact irreversible discard confirmation and whole-stack merge quantity', () => {
    const discard = offerFor('discard')
    const discardDeclaration = declarationFor(discard)
    expect(validateInventoryActionDeclarationAgainstOffer(discard, discardDeclaration)).toEqual(discardDeclaration)
    expect(() => validateInventoryActionDeclarationAgainstOffer(discard, {
      ...discardDeclaration,
      confirmationOptionId: `inventory-confirmation:v1:${hex('d')}`,
    })).toThrow('does not match the exact irreversible-action confirmation')

    const merge = offerFor('merge')
    const mergeDeclaration = declarationFor(merge)
    expect(validateInventoryActionDeclarationAgainstOffer(merge, mergeDeclaration)).toEqual(mergeDeclaration)
    expect(() => validateInventoryActionDeclarationAgainstOffer(merge, {
      ...mergeDeclaration,
      quantity: merge.source.availableQuantity - 1,
    })).toThrow('does not match the current quantity offer')
  })

  it('keeps inspect navigation-only and rejects private or unknown projection fields', () => {
    const inspect = offerFor('inspect')
    expect(parseInventoryActionOffer(inspect).execution.href).toBe('/items/Bandages')
    expect(() => parseInventoryActionDeclaration(declarationFor(inspect))).toThrow('inspect is navigation-only')
    expect(() => parseInventoryActionOffer({
      ...offerFor('use'),
      source: { ...offerFor('use').source, rowId: 'private-row' },
    })).toThrow('has an invalid shape')
    expect(() => parseInventoryActionOffer({
      ...offerFor('use'),
      execution: { mode: 'command', handoff: 'inventory-transfer', href: null },
    })).toThrow('does not match the use handoff contract')
  })

  it('strictly parses replay results without accepting navigation or payload drift', () => {
    const result = parseInventoryActionExecutionResult({
      schemaVersion: 1,
      operationId: `inventory-action:v1:${hex('f')}`,
      action: 'give',
      exactReplay: true,
      message: 'The original accepted action was recovered without moving the item twice.',
    })
    expect(result).toMatchObject({ action: 'give', exactReplay: true })
    expect(Object.isFrozen(result)).toBe(true)
    expect(() => parseInventoryActionExecutionResult({ ...result, action: 'inspect' }))
      .toThrow('inspect cannot produce a mutation result')
    expect(() => parseInventoryActionExecutionResult({ ...result, downstreamOperationId: 'private' }))
      .toThrow('invalid shape')
  })

  it('fails closed for disabled authority, duplicate identities, and bounded JSON abuse', () => {
    const use = offerFor('use')
    expect(() => parseInventoryActionOffer({
      ...use,
      authority: {
        ...use.authority,
        checks: use.authority.checks.map(check => check.kind === 'source-control' ? { ...check, satisfied: false } : check),
      },
    })).toThrow('enabled actions require every authority check to pass')
    expect(() => parseInventoryActionProjection({
      schemaVersion: 1,
      generatedAt: 10,
      offers: [use, use],
    })).toThrow('must have unique offer identities')
    expect(() => parseInventoryActionOffer({
      ...use,
      destination: { ...use.destination, rules: Array.from({ length: 13 }, (_, index) => `rule-${index}`) },
    })).toThrow(InventoryActionValidationError)
  })
})
