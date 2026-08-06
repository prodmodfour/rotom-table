import { describe, expect, it } from 'vitest'
import {
  applyCapabilityEvolutionTransition,
  deltaEvolutionNeedsMegaStone,
  splitEvolutionTarget,
} from '../../server/domain/capabilityAutomation/evolutionProviders'
import type { CharacterSheet } from '~/types/characterSheet'
import { createBreedingBabyTemplateAuthorityV1, createBreedingMarsupialProviderTraitV1, resolveBreedingMarsupialBabyTemplateV1 } from '../../server/domain/breeding/babyTemplate'

const pokemon = (species: string, overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: species.toLowerCase(), name: species, species, level: 20, ...overrides,
})

describe('Capability evolution providers', () => {
  it('routes Split Evolution from the Nature-raised stat and rejects the other branch', () => {
    const attackNature = pokemon('Wurmple', { nature: 'Adamant' })
    const defenseNature = pokemon('Wurmple', { nature: 'Bold' })
    expect(splitEvolutionTarget(attackNature)).toBe('Silcoon')
    expect(splitEvolutionTarget(defenseNature)).toBe('Cascoon')
    expect(applyCapabilityEvolutionTransition(attackNature, { ...attackNature, species: 'Silcoon' }).reasonCodes)
      .toContain('capability.split-evolution.applied')
    expect(() => applyCapabilityEvolutionTransition(attackNature, { ...attackNature, species: 'Cascoon' }))
      .toThrow(/requires evolution into Silcoon/i)
  })

  it('creates and equips Pearl Creation output without deleting an occupied Held Item', () => {
    const previous = pokemon('Clamperl', { items: { held: 'Deep Sea Tooth' } })
    const result = applyCapabilityEvolutionTransition(previous, { ...previous, species: 'Huntail' })
    expect(result.producedHeldItem).toBe('Pink Pearl')
    expect(result.sheet.items).toMatchObject({ held: 'Pink Pearl', extraItems: ['Deep Sea Tooth'] })
  })

  it('waives Rayquaza’s Mega Stone only while Dragon Ascent and Delta Evolution are effective', () => {
    expect(deltaEvolutionNeedsMegaStone(pokemon('Rayquaza', { movelist: [{ name: 'Dragon Ascent' }] }))).toBe(false)
    expect(deltaEvolutionNeedsMegaStone(pokemon('Rayquaza'))).toBe(true)
    expect(deltaEvolutionNeedsMegaStone(pokemon('Dragonite', { movelist: [{ name: 'Dragon Ascent' }] }))).toBe(true)
  })

  it('ends the Marsupial Baby Template at level 25', () => {
    const template = resolveBreedingMarsupialBabyTemplateV1()
    const authority = createBreedingBabyTemplateAuthorityV1({ sourceEggId: 'pokemon-egg:v1:92929292929292929292929292929292', babyTemplate: template, marsupial: createBreedingMarsupialProviderTraitV1() })
    const previous = pokemon('Kangaskhan', { level: 24, babyTemplate: true,
      babyTemplateMechanics: { schemaVersion: 1, applicationKind: authority.applicationKind, effects: authority.effects },
      serverPrivate: { breedingBabyTemplate: authority } })
    const result = applyCapabilityEvolutionTransition(previous, { ...previous, level: 25 })
    expect(result.sheet.babyTemplate).toBe(false)
    expect(result.reasonCodes).toContain('capability.marsupial.baby-template-ended')
  })
})
