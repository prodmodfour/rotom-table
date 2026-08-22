import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import trainerJson from '../../data/onboarding/trainer-creation-rules-inventory.json'
import pokemonJson from '../../data/onboarding/pokemon-creation-rules-inventory.json'
import rulesJson from '../../data/reference/rules.json'

const ROOT = resolve(import.meta.dirname, '../..')

type Inventory = typeof trainerJson

const REQUIRED_TRAINER_DECISIONS = [
  'trainer-starting-level',
  'trainer-base-stats',
  'trainer-stat-budget',
  'trainer-skill-rank-caps',
  'trainer-background-structure',
  'trainer-training-feature',
  'trainer-feature-entitlements',
  'trainer-edge-entitlements',
  'trainer-feature-identities',
  'trainer-edge-identities',
  'trainer-classes',
  'trainer-starting-money',
  'trainer-starting-inventory',
  'trainer-milestone-choices',
] as const

const REQUIRED_POKEMON_DECISIONS = [
  'pokemon-species-eligibility',
  'pokemon-starting-level',
  'pokemon-forms',
  'pokemon-base-stats',
  'pokemon-added-stat-budget',
  'pokemon-base-relations',
  'pokemon-nature',
  'pokemon-abilities',
  'pokemon-moves',
  'pokemon-gender',
  'pokemon-loyalty',
  'pokemon-held-items',
  'pokemon-team-placement',
] as const

const checkInventory = (inventory: Inventory, requiredIds: readonly string[]) => {
  const kinds = new Set(inventory.authorityKinds)
  expect(new Set(inventory.decisions.map(d => d.id)).size).toBe(inventory.decisions.length)
  const ids = new Set(inventory.decisions.map(d => d.id))
  for (const id of requiredIds) expect(ids, id).toContain(id)

  for (const decision of inventory.decisions) {
    expect(kinds.has(decision.authorityKind), `${decision.id} kind`).toBe(true)
    expect(decision.notes.trim(), decision.id).not.toBe('')
    if (decision.authorityKind === 'absent') {
      expect(decision.dataDefect, `${decision.id} must record a data defect`).not.toBeNull()
    }
    if (decision.dataDefect) {
      expect(decision.dataDefect.id).toMatch(/^DATA-ONB-\d{3}$/)
      expect(decision.dataDefect.requiredAction.trim()).not.toBe('')
      expect(decision.dataDefect.documentaryProvenance.trim()).not.toBe('')
    }
    if (decision.authorityKind !== 'absent') {
      expect(decision.authoritySources.length, decision.id).toBeGreaterThan(0)
    }
    for (const source of decision.authoritySources) {
      const filePath = source.split('#')[0]!
      expect(existsSync(resolve(ROOT, filePath)), `${decision.id} source ${filePath}`).toBe(true)
    }
  }
}

describe('trainer creation rules inventory', () => {
  it('classifies every starting Trainer decision with real authority sources', () => {
    expect(trainerJson.inventoryId).toBe('onboarding-trainer-creation-rules-v1')
    checkInventory(trainerJson, REQUIRED_TRAINER_DECISIONS)
  })

  it('matches the structured rules.json mechanics it cites', () => {
    const rules = Object.values(rulesJson as Record<string, { name?: string } & Record<string, unknown>>)
    const advancement = rules.find(rule => rule.name === 'Trainer Advancement Choices') as
      | { trainerAdvancementChoiceMechanics?: { featureEntitlements?: { paidAtLevelOne?: number, freeTrainingAtLevelOne?: number, freeTrainingFeatureIds?: string[] }, edgeEntitlements?: { atLevelOne?: number } } }
      | undefined
    expect(advancement?.trainerAdvancementChoiceMechanics?.featureEntitlements?.paidAtLevelOne).toBe(4)
    expect(advancement?.trainerAdvancementChoiceMechanics?.featureEntitlements?.freeTrainingAtLevelOne).toBe(1)
    expect(advancement?.trainerAdvancementChoiceMechanics?.featureEntitlements?.freeTrainingFeatureIds).toHaveLength(4)
    expect(advancement?.trainerAdvancementChoiceMechanics?.edgeEntitlements?.atLevelOne).toBe(4)

    const statPoints = rules.find(rule => rule.name === 'Stat Point Advancement') as
      | { statPointFormulas?: { trainerLevelUp?: { offset?: number }, pokemonAdded?: { offset?: number } } }
      | undefined
    expect(statPoints?.statPointFormulas?.trainerLevelUp?.offset).toBe(9)
    expect(statPoints?.statPointFormulas?.pokemonAdded?.offset).toBe(10)
  })
})

describe('pokemon creation rules inventory', () => {
  it('classifies every starter Pokémon decision with real authority sources', () => {
    expect(pokemonJson.inventoryId).toBe('onboarding-pokemon-creation-rules-v1')
    checkInventory(pokemonJson as unknown as Inventory, REQUIRED_POKEMON_DECISIONS)
  })

  it('records the absent-authority defects that gate later tickets', () => {
    const defects = [...trainerJson.decisions, ...pokemonJson.decisions]
      .flatMap(decision => (decision.dataDefect ? [decision.dataDefect.id] : []))
    expect(defects).toContain('DATA-ONB-001')
    expect(defects).toContain('DATA-ONB-002')
    expect(defects).toContain('DATA-ONB-004')
    expect(new Set(defects).size).toBe(defects.length)
  })
})
