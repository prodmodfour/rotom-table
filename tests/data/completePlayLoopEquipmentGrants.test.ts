import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import items from '~~/data/reference/items.json'
import grantJson from '~~/data/complete-play-loop/equipment-grants.v1.json'
import {
  EquipmentGrantValidationError,
  parseEquipmentGrantDocument,
} from '#shared/itemAutomation/equipmentGrants'
import {
  equipmentGrantDefinitionFor,
  equipmentGrantDocument,
} from '~~/server/domain/itemAutomation/equipmentGrantRegistry'
import { EQUIPMENT_ACTION_PRESENTATIONS } from '#shared/itemAutomation/equipmentActionPresentation'

const EQUIPMENT_CATEGORIES = new Set([
  'Held Item', 'Weapon', 'Hand Equipment', 'Head Equipment',
  'Body Equipment', 'Feet Equipment', 'Accessory Item',
])
const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-047 reviewed equipment grant data', () => {
  it('classifies every canonical equipment identity and binds exact compatibility authority', () => {
    const document = equipmentGrantDocument()
    const expected = Object.entries(items)
      .filter(([, item]) => item.categories.some(category => EQUIPMENT_CATEGORIES.has(category)))
      .map(([canonicalItemId]) => canonicalItemId)
    expect(document.definitionCount).toBe(108)
    expect(document.grantingItemCount).toBe(31)
    expect(document.grantCount).toBe(45)
    expect(document.definitions.map(row => row.canonicalItemId)).toEqual(expected)
    expect(document.equipmentDefinitionsSha256)
      .toBe(sha256File('data/complete-play-loop/equipment-definitions.v1.json'))
    expect(document.classificationPolicy).toMatchObject({
      finalStateAuthorityPath: 'data/deferred-closure/item-action-matrix.v1.json',
      finalStateAuthoritySha256: sha256File('data/deferred-closure/item-action-matrix.v1.json'),
    })
  })

  it('records explicit weapon, Move, Ability, Capability, and contextual-action sources', () => {
    expect(equipmentGrantDefinitionFor('Survival Knife')?.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'weapon-profile', weaponClass: 'small-melee' }),
      expect.objectContaining({ kind: 'move', canonicalId: 'Cheap Shot', executionStatus: 'native' }),
    ]))
    expect(equipmentGrantDefinitionFor('Honed Claws')?.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'move', canonicalId: 'Gouge', executionStatus: 'native' }),
    ]))
    expect(equipmentGrantDefinitionFor('Full Incense')?.grants).toContainEqual(expect.objectContaining({
      kind: 'ability', canonicalId: 'Stall',
    }))
    expect(equipmentGrantDefinitionFor('Dark Vision Goggles')?.grants).toContainEqual(expect.objectContaining({
      kind: 'capability', canonicalId: 'Darkvision',
    }))
    expect(equipmentGrantDefinitionFor('Old Rod')?.grants).toContainEqual(expect.objectContaining({
      kind: 'action', interactionRole: 'contextual-affordance', executionStatus: 'native',
      finalState: 'guided', actionId: 'equipment.fishing.old-rod', deferredTicket: null,
    }))
    expect(equipmentGrantDefinitionFor('Wonder Launcher')?.grants).toContainEqual(expect.objectContaining({
      kind: 'action', actionId: 'equipment.wonder-launcher.apply',
      executionStatus: 'native', deferredTicket: null,
    }))
    expect(equipmentGrantDefinitionFor('Re-Breather')?.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability', canonicalId: 'Gilled', activation: 'while-re-breather-active',
      }),
      expect.objectContaining({
        kind: 'action', actionId: 'equipment.re-breather.activate', executionStatus: 'native', finalState: 'guided', deferredTicket: null,
      }),
    ]))
  })

  it('keeps item-action labels, timing, ownership, and final state synchronized with the reviewed grant registry', () => {
    const guided = new Set([
      'equipment.fishing.old-rod', 'equipment.fishing.good-rod',
      'equipment.fishing.super-rod', 'equipment.snag-machine.convert',
    ])
    for (const presentation of EQUIPMENT_ACTION_PRESENTATIONS) {
      const grant = equipmentGrantDefinitionFor(presentation.canonicalItemId)?.grants.find(candidate => (
        candidate.kind === 'action' && candidate.actionId === presentation.actionId
      ))
      expect(grant, presentation.actionId).toMatchObject({
        kind: 'action', label: presentation.label, executionStatus: 'native',
        finalState: guided.has(presentation.actionId) ? 'guided' : 'native', deferredTicket: null,
      })
      expect(presentation.timingLabel.toLocaleLowerCase('en-US')).toContain(grant!.kind === 'action'
        ? grant!.timing === 'extended' ? 'extended action' : `${grant!.timing} action`
        : '')
    }
  })

  it('rejects shape drift, duplicate grants, prose-enabled policy, and unsafe Move status', () => {
    expect(() => parseEquipmentGrantDocument({ ...grantJson, unexpected: true }))
      .toThrow(EquipmentGrantValidationError)
    expect(() => parseEquipmentGrantDocument({
      ...grantJson,
      classificationPolicy: { ...grantJson.classificationPolicy, runtimeProseParsing: true },
    })).toThrow('reviewed source-loss and fail-closed semantics')
    const first = grantJson.definitions.find(row => row.grants.length > 0)!
    expect(() => parseEquipmentGrantDocument({
      ...grantJson,
      definitions: grantJson.definitions.map(row => row === first ? {
        ...row, grants: [first.grants[0]!, first.grants[0]!],
      } : row),
    })).toThrow('must contain unique values')
    const launcherOwner = grantJson.definitions.find(row => row.canonicalItemId === 'Wonder Launcher')!
    expect(() => parseEquipmentGrantDocument({
      ...grantJson,
      definitions: grantJson.definitions.map(row => row === launcherOwner ? {
        ...row,
        grants: row.grants.map(grant => ({ ...grant, actionId: 'equipment.fake.native' })),
      } : row),
    })).toThrow('native executors require a reviewed final state')
    const moveOwner = grantJson.definitions.find(row => row.grants.some(grant => grant.kind === 'move'))!
    expect(() => parseEquipmentGrantDocument({
      ...grantJson,
      definitions: grantJson.definitions.map(row => row === moveOwner ? {
        ...row,
        grants: row.grants.map(grant => grant.kind === 'move'
          ? { ...grant, executionStatus: 'deferred' }
          : grant),
      } : row),
    })).toThrow('executionStatus')
  })
})
