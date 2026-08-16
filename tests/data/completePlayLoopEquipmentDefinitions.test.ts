import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import definitionsJson from '../../data/complete-play-loop/equipment-definitions.v1.json'
import itemsJson from '../../data/reference/items.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseEquipmentDefinitionDocument } from '#shared/itemAutomation/equipmentDefinitions'

const EQUIPMENT_CATEGORIES = new Set([
  'Held Item', 'Weapon', 'Hand Equipment', 'Head Equipment',
  'Body Equipment', 'Feet Equipment', 'Accessory Item',
])
const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-043 equipment definition evidence', () => {
  it('is generated, current, exhaustive, and record-hash-bound', () => {
    expect(sha(readFileSync('data/reference/items.json'))).toBe(definitionsJson.catalogSha256)
    const document = parseEquipmentDefinitionDocument(definitionsJson)
    const items = itemsJson as Record<string, { readonly categories: readonly string[] }>
    const equipmentIds = Object.entries(items)
      .filter(([, item]) => item.categories.some(category => EQUIPMENT_CATEGORIES.has(category)))
      .map(([id]) => id)
    expect(document.definitionCount).toBe(108)
    expect(document.definitions.map(row => row.canonicalItemId)).toEqual(equipmentIds)
    for (const definition of document.definitions) {
      expect(definition.canonicalRecordSha256).toBe(sha(stableJsonStringify(items[definition.canonicalItemId])))
      expect(definition.ownerRules.length).toBeGreaterThan(0)
    }
    expect(document.classificationPolicy).toMatchObject({
      status: 'reviewed', runtimeProseParsing: false, unknownOrStalePolicy: 'fail-closed-no-equip',
    })
  })

  it('records reviewed handedness, owner, configuration, prerequisite, and exclusivity adjudications', () => {
    const rows = new Map(parseEquipmentDefinitionDocument(definitionsJson).definitions.map(row => [row.canonicalItemId, row]))
    expect(rows.get('Baseball Bat')?.ownerRules).toEqual([
      { ownerKind: 'trainer', slotOptions: [['mainHand', 'offHand']] },
      { ownerKind: 'pokemon', slotOptions: [['held']] },
    ])
    expect(rows.get('Baseball Bat')?.prerequisites).toContainEqual({
      kind: 'capability', ownerKind: 'pokemon', canonicalId: 'Wielder',
    })
    expect(rows.get('Big Root')?.ownerRules).toEqual([{ ownerKind: 'pokemon', slotOptions: [['held']] }])
    expect(rows.get('Safety Goggles')?.ownerRules).toEqual(expect.arrayContaining([
      { ownerKind: 'trainer', slotOptions: [['head'], ['accessory']] },
      { ownerKind: 'pokemon', slotOptions: [['held']] },
    ]))
    expect(rows.get('Wonder Launcher')?.prerequisites).toEqual([{
      kind: 'trainer-skill-any', ownerKind: 'trainer',
      skillIds: ['medicineEd', 'techEd'], minimumRankValue: 5,
    }])
    expect(rows.get('Thick Club')?.prerequisites).toEqual([{
      kind: 'pokemon-species', ownerKind: 'pokemon', speciesIds: ['Cubone', 'Marowak'],
    }])
    expect(rows.get('Focus')).toMatchObject({
      exclusivityFamilies: ['focus'],
      configuration: { configurationId: 'equipment.focus.v1' },
    })
    expect(rows.get('Hand Net')?.configuration).toMatchObject({
      fields: [{ key: 'durabilityMaximum', kind: 'integer-enum', values: [50, 100, 200] }],
    })
  })
})
