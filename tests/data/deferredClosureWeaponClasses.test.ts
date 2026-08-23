import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import { parseEquipmentGrantDocument } from '../../shared/itemAutomation/equipmentGrants'

const sourceSha = createHash('sha256')
  .update(readFileSync('books/markdown/core/09-gear-and-items.md'))
  .digest('hex')
const document = parseEquipmentGrantDocument(grants)
const profileFor = (item: string) => document.definitions
  .find(definition => definition.canonicalItemId === item)?.grants
  .find(grant => grant.kind === 'weapon-profile')

const RANGED = {
  'Weighted Rope': 'short-range',
  'Slingshot': 'long-range',
  'Throwing Hammers': 'short-range',
  'Hunting Bow': 'long-range',
  'Super Lucky Throwing Stars': 'short-range',
  'Twin-Needled Bow': 'long-range',
} as const

describe('P11-004 reviewed ranged weapon class authority', () => {
  it('binds all weapon profiles to the reviewed source and native class semantics', () => {
    const profiles = document.definitions.flatMap(definition => definition.grants)
      .filter(grant => grant.kind === 'weapon-profile')
    expect(profiles).toHaveLength(12)
    for (const profile of profiles) {
      expect(profile.executionStatus).toBe('native')
      expect(profile.sourceSha256).toBe(sourceSha)
      expect(profile.sourcePath).toBe('books/markdown/core/09-gear-and-items.md')
      expect(profile.allowsStab).toBe(false)
      expect(profile.ammunitionPolicy).toBe('abstracted-no-tracked-consumption')
      expect(profile.recoveryPolicy).toBe('no-canonical-projectile-recovery')
    }
  })

  it('encodes short-range as one-handed 0-4m with no AC or DB modifier', () => {
    for (const [item, weaponClass] of Object.entries(RANGED).filter(([, value]) => value === 'short-range')) {
      expect(profileFor(item)).toMatchObject({
        weaponClass,
        pokemonWielderSizePolicy: 'trainer-only',
        damageBaseBonus: 0,
        accuracyCheckPenalty: 0,
        rangeMinimumMeters: 0,
        rangeMaximumMeters: 4,
        handsRequired: 1,
        targetingPolicy: 'ranged-line-of-sight',
        weaponRangeReplacesSingleTargetMoveRange: true,
        executionStatus: 'native',
      })
    }
  })

  it('encodes long-range as two-handed 4-12m with +1 AC and +1 DB', () => {
    for (const [item, weaponClass] of Object.entries(RANGED).filter(([, value]) => value === 'long-range')) {
      expect(profileFor(item)).toMatchObject({
        weaponClass,
        pokemonWielderSizePolicy: 'trainer-only',
        damageBaseBonus: 1,
        accuracyCheckPenalty: 1,
        rangeMinimumMeters: 4,
        rangeMaximumMeters: 12,
        handsRequired: 2,
        targetingPolicy: 'ranged-line-of-sight',
        weaponRangeReplacesSingleTargetMoveRange: true,
        executionStatus: 'native',
      })
    }
  })

  it('fails closed on class-policy, ammunition, source, or execution drift', () => {
    const owner = grants.definitions.find(definition => definition.canonicalItemId === 'Hunting Bow')!
    const mutate = (patch: Record<string, unknown>) => ({
      ...grants,
      definitions: grants.definitions.map(definition => definition === owner
        ? { ...definition, grants: definition.grants.map(grant => grant.kind === 'weapon-profile' ? { ...grant, ...patch } : grant) }
        : definition),
    })
    expect(() => parseEquipmentGrantDocument(mutate({ rangeMaximumMeters: 13 }))).toThrow()
    expect(() => parseEquipmentGrantDocument(mutate({ ammunitionPolicy: 'invented-arrows' }))).toThrow()
    expect(() => parseEquipmentGrantDocument(mutate({ sourceSha256: '0'.repeat(64) }))).toThrow()
    expect(() => parseEquipmentGrantDocument(mutate({ executionStatus: 'definition-missing' }))).toThrow()
  })
})
