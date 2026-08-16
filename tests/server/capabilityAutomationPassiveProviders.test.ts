import { describe, expect, it } from 'vitest'
import { computeFullMaxHp, computeMaxHp, pokemonHasResolvedCapability, resolveStats } from '~/utils/sheets/pokemonDerived'
import { applyHpToSheet } from '~/utils/sheetMutations'
import { applyPokemonExtendedRest, setPokemonInjuries } from '~/utils/sheets/healing'
import type { CharacterSheet } from '~/types/characterSheet'
import { resolveWielderWeaponProfile } from '~~/server/domain/capabilityAutomation/wielder'
import { equipmentGrantDefinitionFor } from '~~/server/domain/itemAutomation/equipmentGrantRegistry'
import { createBreedingBabyTemplateAuthorityV1, createBreedingMarsupialProviderTraitV1, resolveBreedingMarsupialBabyTemplateV1 } from '../../server/domain/breeding/babyTemplate'

const shedinja = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'shedinja', name: 'Shedinja', species: 'Shedinja', level: 20,
  stats: { hp: { added: 99 } }, combat: { currentHp: 0, injuries: 7 }, ...overrides,
})

describe('Capability passive providers', () => {
  it('enforces Soulless Max HP and injury invariants through shared sheet mutation paths', () => {
    const sheet = shedinja()
    expect(pokemonHasResolvedCapability(sheet, 'Soulless')).toBe(true)
    expect(computeFullMaxHp(sheet, 100)).toBe(1)
    expect(computeMaxHp(sheet, 100)).toBe(1)
    expect(setPokemonInjuries(sheet, 9)).toBe(0)
    expect(sheet.combat?.injuries).toBe(0)
    const updated = applyHpToSheet('pokemon', sheet, 50, 4) as CharacterSheet
    expect(updated.combat).toMatchObject({ currentHp: 1, injuries: 0 })
  })

  it('applies and removes the Marsupial Baby Template Base Stat reduction', () => {
    const adult: CharacterSheet = { slug: 'adult', nickname: 'Adult', species: 'Kangaskhan', level: 25 }
    const template = resolveBreedingMarsupialBabyTemplateV1()
    const authority = createBreedingBabyTemplateAuthorityV1({ sourceEggId: 'pokemon-egg:v1:93939393939393939393939393939393', babyTemplate: template, marsupial: createBreedingMarsupialProviderTraitV1() })
    const baby: CharacterSheet = { ...adult, slug: 'baby', nickname: 'Baby', level: 1, babyTemplate: true,
      babyTemplateMechanics: { schemaVersion: 1, applicationKind: authority.applicationKind, effects: authority.effects }, serverPrivate: { breedingBabyTemplate: authority } }
    const adultStats = new Map(resolveStats(adult).map(stat => [stat.key, stat.base]))
    for (const stat of resolveStats(baby)) expect(stat.base).toBe(Math.max(1, adultStats.get(stat.key)! - 5))
  })

  it('rejects descriptive held-item authority and reviews Wielder grants explicitly', () => {
    expect(resolveWielderWeaponProfile({ heldItemName: 'Honed Claws', size: 'Small' })).toBeNull()
    expect(resolveWielderWeaponProfile({ heldItemName: 'Meteor Masher', size: 'Medium' })).toBeNull()
    expect(equipmentGrantDefinitionFor('Honed Claws')?.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'weapon-profile', weaponClass: 'small-melee',
        damageBaseBonus: 1, accuracyCheckPenalty: 0,
      }),
      expect.objectContaining({
        kind: 'move', canonicalId: 'Wounding Strike', minimumCombatRank: 4,
        pokemonWielderEligible: true, executionStatus: 'native',
      }),
      expect.objectContaining({
        kind: 'move', canonicalId: 'Gouge', minimumCombatRank: 6,
        pokemonWielderEligible: false, executionStatus: 'definition-missing',
      }),
    ]))
  })

  it('restores a Soulless user to exactly one HP after Extended Rest', () => {
    const sheet = shedinja({ combat: { currentHp: 0, injuries: 0 } })
    applyPokemonExtendedRest(sheet)
    expect(sheet.combat?.currentHp).toBe(1)
    expect(sheet.combat?.injuries ?? 0).toBe(0)
  })
})
