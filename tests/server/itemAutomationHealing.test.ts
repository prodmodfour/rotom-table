import { describe, expect, it } from 'vitest'
import { parseItemSpec, type ItemHpRestorationSpec, type ItemSpecV1 } from '#shared/itemAutomation/spec'
import { previewItemHpRestoration, resolveItemHpRestoration } from '../../server/domain/itemAutomation/healing'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const fixed = (amount: number): ItemHpRestorationSpec => ({
  amount: { kind: 'fixed', amount },
  cap: 'injury-adjusted-effective-maximum-hp',
  faintedState: 'preserve',
})

const pokemon = (input: { readonly currentHp: number, readonly injuries?: number }): CharacterSheet => ({
  slug: 'healing-target', nickname: 'Target', species: 'Fixture Species', level: 10,
  stats: { hp: { base: 10, added: 0 } },
  combat: { currentHp: input.currentHp, injuries: input.injuries ?? 0 },
})

const spec = (restoration: ItemHpRestorationSpec): ItemSpecV1 => ({
  schemaVersion: 1,
  canonicalId: 'Healing Fixture',
  aliases: [],
  implementationState: 'native',
  contexts: ['encounter'],
  roles: ['usable'],
  timing: 'standard',
  costs: [{ kind: 'action', resourceId: 'standard', amount: 1, label: '1 Standard Action' }],
  prerequisites: [],
  targets: [{ targetId: 'target', kind: 'participant', minimum: 1, maximum: 1, relationship: 'any', rangeMeters: null, requiresLineOfSight: false }],
  choices: [],
  consumption: { phase: 'accepted-use', quantity: 1, reserveWhilePending: true, refundableOnCancel: true, reusable: false },
  effects: [{ effectId: 'healing', operation: 'heal-hp', restoration }],
  duration: { kind: 'instant', amount: null },
  privacy: { sourceInventory: 'actor-owner', choices: 'actor-owner', outcome: 'public' },
  presentation: { label: 'Healing Fixture', description: 'Fixture.', unavailableReason: null },
  evidence: {
    canonicalCatalogSha256: 'a'.repeat(64), canonicalRecordSha256: 'b'.repeat(64),
    canonicalEffectSha256: 'c'.repeat(64), reviewId: 'fixture:healing:v1', status: 'reviewed',
  },
  registeredHandlerId: 'item.native.v1',
})

describe('authoritative item HP restoration', () => {
  it('resolves fixed healing, the effective cap, and overheal from authoritative vitals', () => {
    const result = resolveItemHpRestoration({
      restoration: fixed(20), sheetKind: 'pokemon', sheet: pokemon({ currentHp: 35 }),
      rollDie: () => { throw new Error('fixed healing must not roll') },
    })
    expect(result).toMatchObject({
      calculationKind: 'fixed', currentHp: 35, fullFormulaMaximumHp: 50,
      effectiveMaximumHp: 50, requestedHealing: 20, effectiveHealing: 15,
      overheal: 5, resultingHp: 50, roll: null,
    })
  })

  it('uses full formula maximum for fractions but caps final HP at the injury-adjusted maximum', () => {
    const restoration: ItemHpRestorationSpec = {
      amount: { kind: 'maximum-relative', basis: 'full-formula-maximum-hp', numerator: 1, denominator: 2, rounding: 'down', minimum: 1 },
      cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
    }
    const result = resolveItemHpRestoration({
      restoration, sheetKind: 'pokemon', sheet: pokemon({ currentHp: 20, injuries: 2 }), rollDie: () => 1,
    })
    expect(result).toMatchObject({
      calculationKind: 'maximum-relative', fullFormulaMaximumHp: 50,
      effectiveMaximumHp: 40, requestedHealing: 25, effectiveHealing: 20,
      overheal: 5, resultingHp: 40,
    })
  })

  it('projects rolled ranges without consuming entropy and retains exact server roll evidence', () => {
    const restoration: ItemHpRestorationSpec = {
      amount: { kind: 'rolled', diceCount: 2, dieSides: 6, modifier: 3 },
      cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
    }
    expect(previewItemHpRestoration({ restoration, sheetKind: 'pokemon', sheet: pokemon({ currentHp: 10 }) }))
      .toMatchObject({
        calculationKind: 'rolled', minimumRequestedHealing: 5,
        maximumRequestedHealing: 15, expectedRequestedHealing: 10,
      })
    const draws = [4, 6]
    const result = resolveItemHpRestoration({
      restoration, sheetKind: 'pokemon', sheet: pokemon({ currentHp: 10 }),
      rollDie: sides => { expect(sides).toBe(6); return draws.shift()! },
    })
    expect(result).toMatchObject({
      requestedHealing: 13, effectiveHealing: 13, resultingHp: 23,
      roll: { expression: '2d6+3', rolls: [4, 6], modifier: 3, total: 13 },
    })
  })

  it('resolves item-driven Trainer skill checks from authoritative rank and modifier data only', () => {
    const actor: TrainerSheet = {
      slug: 'medic', name: 'Medic', level: 10,
      skillBackground: { adept: 'medicineEd' },
      skills: { medicineEd: { modifier: 2 } },
    }
    const restoration: ItemHpRestorationSpec = {
      amount: { kind: 'skill-check', skillId: 'medicineEd', dieSides: 6 },
      cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
    }
    expect(previewItemHpRestoration({
      restoration, sheetKind: 'pokemon', sheet: pokemon({ currentHp: 10 }),
      actorSheetKind: 'trainer', actorSheet: actor,
    })).toMatchObject({
      calculationKind: 'skill-check', minimumRequestedHealing: 6,
      maximumRequestedHealing: 26, expectedRequestedHealing: 16,
    })
    const draws = [1, 2, 3, 4]
    expect(resolveItemHpRestoration({
      restoration, sheetKind: 'pokemon', sheet: pokemon({ currentHp: 10 }),
      actorSheetKind: 'trainer', actorSheet: actor,
      rollDie: sides => { expect(sides).toBe(6); return draws.shift()! },
    })).toMatchObject({
      requestedHealing: 12, effectiveHealing: 12, resultingHp: 22,
      roll: {
        expression: '4d6+2', rolls: [1, 2, 3, 4], modifier: 2, total: 12,
        skillId: 'medicineEd', rankValue: 4, dieSides: 6,
      },
    })
    expect(() => previewItemHpRestoration({
      restoration, sheetKind: 'pokemon', sheet: pokemon({ currentHp: 10 }),
      actorSheetKind: 'pokemon', actorSheet: pokemon({ currentHp: 10 }),
    })).toThrow('requires an authoritative Trainer actor')
  })

  it('uses trainer formula maximum and injury cap from the authoritative trainer sheet', () => {
    const trainer: TrainerSheet = {
      slug: 'trainer-target', name: 'Trainer Target', level: 10,
      stats: { hp: { base: 5, added: 0 } }, currentHp: 25, currentInjuries: 1,
    }
    const result = resolveItemHpRestoration({
      restoration: fixed(20), sheetKind: 'trainer', sheet: trainer, rollDie: () => 1,
    })
    expect(result).toMatchObject({
      currentHp: 25, fullFormulaMaximumHp: 45, effectiveMaximumHp: 40,
      requestedHealing: 20, effectiveHealing: 15, overheal: 5, resultingHp: 40,
    })
  })

  it('strictly rejects ambiguous healing caps, basis, non-positive roll ranges, and legacy numeric shapes', () => {
    const wrongCap = structuredClone(spec(fixed(20))) as any
    wrongCap.effects[0].restoration.cap = 'formula-maximum-hp'
    expect(() => parseItemSpec(wrongCap)).toThrow('injury-adjusted effective maximum HP cap')

    const wrongBasis = structuredClone(spec(fixed(20))) as any
    wrongBasis.effects[0].restoration.amount = {
      kind: 'maximum-relative', basis: 'effective-maximum-hp', numerator: 1, denominator: 2, rounding: 'down', minimum: 1,
    }
    expect(() => parseItemSpec(wrongBasis)).toThrow('full formula maximum HP basis')

    const nonPositive = structuredClone(spec(fixed(20))) as any
    nonPositive.effects[0].restoration.amount = { kind: 'rolled', diceCount: 1, dieSides: 6, modifier: -1 }
    expect(() => parseItemSpec(nonPositive)).toThrow('always resolve to a positive')

    const legacy = structuredClone(spec(fixed(20))) as any
    legacy.effects[0] = { effectId: 'healing', operation: 'heal-hp', amount: 20 }
    expect(() => parseItemSpec(legacy)).toThrow('invalid shape')
  })
})
