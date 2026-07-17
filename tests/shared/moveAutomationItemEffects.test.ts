import { describe, expect, it } from 'vitest'
import {
  MOVE_ITEM_EFFECT_ACTIONS,
  MoveItemEffectValidationError,
  moveItemEffectBindingId,
  parseMoveItemEffectPayload,
  type MoveItemEffectAction,
} from '#shared/moveAutomation/itemEffects'
import type { MoveItemReference } from '#shared/moveAutomation/items'

const requirement = (cardinality: 'one' | 'all' = 'one') => ({
  kind: 'requirement' as const,
  requirementId: 'items.reviewed',
  cardinality,
})

const choice = () => ({
  kind: 'choice' as const,
  requestId: 'choice.item',
  destinationId: 'destination.reviewed',
})

const commonSelected = (action: MoveItemEffectAction) => ({
  action,
  item: requirement(),
  quantity: 1,
  onUnavailable: 'reject',
})

const payloads: Record<MoveItemEffectAction, unknown> = {
  give: commonSelected('give'),
  steal: commonSelected('steal'),
  swap: {
    action: 'swap',
    participants: 'actor-and-first-recipient',
    leftItem: requirement(),
    rightItem: choice(),
    onUnavailable: 'no-op',
  },
  'knock-to-ground': commonSelected('knock-to-ground'),
  throw: commonSelected('throw'),
  consume: {
    ...commonSelected('consume'),
    consumptionId: 'consumption.berry',
  },
  restore: {
    action: 'restore',
    consumptionId: 'consumption.berry',
    mode: 'effect',
    destination: null,
    onUnavailable: 'reject',
  },
  destroy: commonSelected('destroy'),
  suppress: {
    action: 'suppress',
    item: requirement('all'),
    scope: 'selected-items',
    blocksUse: true,
    blocksBenefit: false,
    effectId: 'corrosive-gas.items',
    duration: { kind: 'scene', remaining: null },
    replacement: 'independent',
    onUnavailable: 'no-op',
  },
  'store-buff': {
    ...commonSelected('store-buff'),
    consumptionId: 'consumption.snack',
  },
  'digest-buff': {
    action: 'digest-buff',
    canonicalItemIds: ['oran-berry', 'sitrus-berry'],
    onUnavailable: 'no-op',
  },
}

const heldReference = (revision = 3, slug = 'actor-sheet'): MoveItemReference => ({
  schemaVersion: 1,
  kind: 'pokemon-held',
  itemId: 'held:1',
  canonicalItemId: 'leftovers',
  owner: { kind: 'sheet', sheetKind: 'pokemon', slug, revision },
  quantity: 1,
  stack: 'singleton',
  equip: 'pokemon-held',
})

describe('shared MoveSpec item effects', () => {
  it('strictly parses and freezes every common item behavior', () => {
    const parsed = MOVE_ITEM_EFFECT_ACTIONS.map(action => (
      parseMoveItemEffectPayload(structuredClone(payloads[action]))
    ))

    expect(parsed.map(payload => payload.action)).toEqual(MOVE_ITEM_EFFECT_ACTIONS)
    expect(parsed).toEqual(MOVE_ITEM_EFFECT_ACTIONS.map(action => payloads[action]))
    parsed.forEach((payload) => {
      expect(Object.isFrozen(payload)).toBe(true)
      if ('item' in payload && payload.item) expect(Object.isFrozen(payload.item)).toBe(true)
    })
  })

  it('accepts only server-resolved possession selections and singleton transfer quantities', () => {
    expect(() => parseMoveItemEffectPayload({
      ...payloads.give as object,
      item: heldReference(),
    })).toThrowError(expect.objectContaining({
      name: 'MoveItemEffectValidationError',
      code: 'invalid-item-effect',
    } satisfies Partial<MoveItemEffectValidationError>))

    for (const action of ['give', 'steal', 'knock-to-ground', 'throw'] as const) {
      expect(() => parseMoveItemEffectPayload({
        ...commonSelected(action),
        quantity: 2,
      })).toThrowError(expect.objectContaining({
        code: 'inconsistent-item-effect',
      }))
    }
  })

  it('rejects unknown mechanics and inconsistent restore/suppression shapes', () => {
    expect(() => parseMoveItemEffectPayload({
      ...payloads.give as object,
      arbitraryPatch: { held: 'anything' },
    })).toThrowError(expect.objectContaining({
      name: 'MoveItemEffectValidationError',
      code: 'invalid-item-effect',
    } satisfies Partial<MoveItemEffectValidationError>))

    expect(() => parseMoveItemEffectPayload({
      ...payloads.restore as object,
      mode: 'item',
      destination: null,
    })).toThrowError(expect.objectContaining({ code: 'inconsistent-item-effect' }))
    expect(() => parseMoveItemEffectPayload({
      ...payloads.suppress as object,
      scope: 'all-equipped',
    })).toThrowError(expect.objectContaining({ code: 'inconsistent-item-effect' }))
    expect(() => parseMoveItemEffectPayload({
      ...payloads.suppress as object,
      blocksUse: false,
      blocksBenefit: false,
    })).toThrowError(expect.objectContaining({ code: 'inconsistent-item-effect' }))
    expect(() => parseMoveItemEffectPayload({
      ...payloads['digest-buff'] as object,
      canonicalItemIds: ['oran-berry', 'oran-berry'],
    })).toThrowError(expect.objectContaining({ code: 'duplicate-id' }))
  })

  it('derives opaque bindings from logical item identity rather than mutable revision', () => {
    const first = moveItemEffectBindingId(heldReference(3))
    const sameAfterRevision = moveItemEffectBindingId(heldReference(4))
    const otherOwner = moveItemEffectBindingId(heldReference(3, 'other-sheet'))

    expect(first).toMatch(/^item\.binding\.[0-9a-f]{16}$/)
    expect(sameAfterRevision).toBe(first)
    expect(otherOwner).not.toBe(first)
    expect(first).not.toContain('actor-sheet')
    expect(first).not.toContain('leftovers')
  })
})
