import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import items from '~~/data/reference/items.json'
import contributionJson from '~~/data/complete-play-loop/equipment-contributions.v1.json'
import {
  EquipmentContributionValidationError,
  parseEquipmentContributionDocument,
} from '#shared/itemAutomation/equipmentContributions'

const EQUIPMENT_CATEGORIES = new Set([
  'Held Item', 'Weapon', 'Hand Equipment', 'Head Equipment',
  'Body Equipment', 'Feet Equipment', 'Accessory Item',
])

const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-046 reviewed equipment contribution data', () => {
  it('classifies the exact canonical equipment catalog and binds compatibility authority', () => {
    const document = parseEquipmentContributionDocument(contributionJson)
    const expected = Object.entries(items)
      .filter(([, item]) => item.categories.some(category => EQUIPMENT_CATEGORIES.has(category)))
      .map(([canonicalItemId]) => canonicalItemId)
    expect(document.definitionCount).toBe(expected.length)
    expect(document.definitions.map(row => row.canonicalItemId)).toEqual(expected)
    expect(document.equipmentDefinitionsSha256)
      .toBe(sha256File('data/complete-play-loop/equipment-definitions.v1.json'))
    expect(document.equipmentGrantsSha256)
      .toBe(sha256File('data/complete-play-loop/equipment-grants.v1.json'))
    expect(document.definitions.every(row => (
      row.contributions.length > 0 || row.grantFinalStates.length > 0 || row.deferredMechanics.length > 0
    ))).toBe(true)
    expect(document.definitions.flatMap(row => row.contributions).every(row => (
      row.contributionId.startsWith('equipment.') && row.predicates.every(predicate => predicate.kind !== ('' as string))
    ))).toBe(true)
    const audited = new Set([
      'equipment.light-shield.ready', 'equipment.heavy-shield.ready', 'equipment.shock-collar.activate',
      'equipment.glue-cannon.attack', 'equipment.hand-net.attack', 'equipment.weighted-nets.throw',
      'equipment.weighted-nets.pull', 'equipment.old-rod.fish', 'equipment.good-rod.fish',
      'equipment.super-rod.fish', 'equipment.snag-machine.convert',
    ])
    const final = document.definitions.flatMap(row => row.grantFinalStates).filter(row => audited.has(row.grantId))
    expect(final).toHaveLength(11)
    expect(final.filter(row => row.finalState === 'guided').map(row => row.grantId).sort()).toEqual([
      'equipment.good-rod.fish', 'equipment.old-rod.fish',
      'equipment.snag-machine.convert', 'equipment.super-rod.fish',
    ])
    expect(document.definitions.filter(row => row.grantFinalStates.some(grant => audited.has(grant.grantId)))
      .every(row => row.deferredMechanics.length === 0)).toBe(true)
  })

  it('rejects unknown shape, duplicate IDs, unsafe operations, and prose-enabled policy', () => {
    expect(() => parseEquipmentContributionDocument({ ...contributionJson, unexpected: true }))
      .toThrow(EquipmentContributionValidationError)
    expect(() => parseEquipmentContributionDocument({
      ...contributionJson,
      classificationPolicy: { ...contributionJson.classificationPolicy, runtimeProseParsing: true },
    })).toThrow('reviewed fail-closed semantics')
    const first = contributionJson.definitions.find(row => row.contributions.length > 0)!
    expect(() => parseEquipmentContributionDocument({
      ...contributionJson,
      definitions: contributionJson.definitions.map(row => row === first ? {
        ...row,
        contributions: [first.contributions[0]!, first.contributions[0]!],
      } : row),
    })).toThrow('must contain unique values')
    expect(() => parseEquipmentContributionDocument({
      ...contributionJson,
      definitions: contributionJson.definitions.map(row => row === first ? {
        ...row,
        contributions: [{ ...first.contributions[0]!, operation: 'set' }],
      } : row),
    })).toThrow('set is supported only')
  })
})
