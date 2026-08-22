import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import coverageJson from '../../data/onboarding/creation-rule-coverage.json'
import completionRubric from '../../data/onboarding/completion-rubric.json'
import trainerInventory from '../../data/onboarding/trainer-creation-rules-inventory.json'
import pokemonInventory from '../../data/onboarding/pokemon-creation-rules-inventory.json'
import rulesJson from '../../data/reference/rules.json'

const ROOT = resolve(import.meta.dirname, '../..')

describe('canonical creation-rule coverage closure (P9-091)', () => {
  const rubricStates = new Set(completionRubric.ruleStates.map(state => state.id))
  const coverageById = new Map(coverageJson.rows.map(row => [row.decisionId, row]))

  it('covers every inventoried Trainer and Pokémon creation decision with a rubric state', () => {
    const allDecisions = [...trainerInventory.decisions, ...pokemonInventory.decisions]
    expect(allDecisions.length).toBeGreaterThanOrEqual(36)
    for (const decision of allDecisions) {
      const row = coverageById.get(decision.id)
      expect(row, `coverage row for ${decision.id}`).toBeDefined()
      expect(rubricStates.has(row!.state), `${decision.id} state ${row!.state}`).toBe(true)
    }
    // No orphan coverage rows either.
    const decisionIds = new Set(allDecisions.map(decision => decision.id))
    for (const row of coverageJson.rows) {
      expect(decisionIds.has(row.decisionId), `orphan coverage row ${row.decisionId}`).toBe(true)
    }
  })

  it('permits zero blocked rows and requires evidence plus tests per row', () => {
    for (const row of coverageJson.rows) {
      expect(row.state, row.decisionId).not.toBe('blocked')
      expect(row.evidence.length, row.decisionId).toBeGreaterThan(0)
      expect(row.tests.length, row.decisionId).toBeGreaterThan(0)
      for (const path of [...row.evidence, ...row.tests]) {
        expect(existsSync(resolve(ROOT, path)), `${row.decisionId} path ${path}`).toBe(true)
      }
    }
  })

  it('confirms every recorded data defect is resolved by reviewed structured authority', () => {
    const inventoryDefects = [...trainerInventory.decisions, ...pokemonInventory.decisions]
      .flatMap(decision => (decision.dataDefect ? [decision.dataDefect.id] : []))
    for (const defect of inventoryDefects) {
      expect(coverageJson.resolvedDataDefects, defect).toContain(defect)
    }

    const creationRule = (rulesJson as Record<string, Record<string, unknown>>)['Character Creation']
    expect(creationRule).toBeDefined()
    const mechanics = creationRule.characterCreationMechanics as Record<string, Record<string, unknown>>
    expect(mechanics.background).toMatchObject({ adeptPicks: 1, novicePicks: 1, patheticPicks: 3, resolvesDataDefect: 'DATA-ONB-001' })
    expect(mechanics.startingMoney).toMatchObject({ recommendedDefault: 5000, resolvesDataDefect: 'DATA-ONB-002' })
    expect(mechanics.startingLoyalty).toMatchObject({ defaultValue: 2, resolvesDataDefect: 'DATA-ONB-004' })
  })
})
