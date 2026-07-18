import { describe, expect, it } from 'vitest'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'

const operation = () => ({
  id: 'item-choice.request',
  kind: 'choice-request',
  source: { kind: 'move', id: 'move.item-test' },
  recipients: { kind: 'actor' },
  phase: 'after-damage',
  reasonCode: 'move.item-test.choose',
  payload: {
    requestId: 'item-choice.window',
    promptKey: 'move.item-test.choose',
    options: [],
    allowPass: true,
    itemChoice: {
      setId: 'item-choice.items',
      requirementId: 'item-choice.actor-bag',
      owner: 'recipients',
      emptyPolicy: 'reject',
      filter: {
        referenceKinds: ['trainer-inventory-row'],
        canonicalItemIds: null,
        trainerEquipmentSlots: null,
        minimumQuantity: 1,
      },
      destinations: [{
        id: 'consume',
        kind: 'none',
        labelKey: 'move.item.destination.consume',
      }],
      noneOption: { id: 'item.none.explicit', labelKey: 'move.item.none' },
    },
  },
})

describe('MoveSpec durable item-choice operation contract', () => {
  it('accepts a bounded reviewed dynamic item declaration with no static mechanics', () => {
    const parsed = parseMoveEffectOperation(operation())
    expect(parsed).toMatchObject({
      kind: 'choice-request',
      payload: {
        options: [],
        allowPass: true,
        itemChoice: {
          setId: 'item-choice.items',
          requirementId: 'item-choice.actor-bag',
        },
      },
    })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('rejects mixed static options and client-shaped destination mechanics', () => {
    const mixed = operation()
    mixed.payload.options.push({ id: 'forged', labelKey: 'move.item.forged' } as never)
    expect(() => parseMoveEffectOperation(mixed)).toThrowError(
      /cannot mix server-derived items with static options/,
    )

    const forged = operation() as ReturnType<typeof operation> & {
      payload: { itemChoice: { destinations: unknown[] } }
    }
    forged.payload.itemChoice.destinations = [{
      id: 'ground',
      kind: 'map-ground',
      labelKey: 'move.item.destination.ground',
      coordinates: { x: 1, y: 0, z: 2 },
    }]
    expect(() => parseMoveEffectOperation(forged)).toThrowError(/invalid shape/)
  })
})
