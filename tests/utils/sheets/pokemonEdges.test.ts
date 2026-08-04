import { describe, expect, it } from 'vitest'
import type { CharacterSheet, CharacterSheetEdge } from '~/types/characterSheet'
import {
  pokemonEdgeChoiceDefinitions,
  pokemonEdgeChoiceOptions,
  pokemonEdgeInspectorStatus,
  setPokemonEdgeChoice,
  setPokemonEdgeName,
} from '~/utils/sheets/pokemonEdges'

const sheet = (): CharacterSheet => ({
  slug: 'abra-edge-editor',
  species: 'Abra',
  level: 30,
  abilities: [{ name: 'Synchronize' }],
  movelist: [{ name: 'Fire Blast' }],
  edges: [{ name: '', choices: {} }],
}) as CharacterSheet

describe('Poké Edge setup editor authority', () => {
  it('selects only canonical identities and fills app-owned source fields', () => {
    const current = sheet()
    const edge = current.edges![0]!
    setPokemonEdgeName(current, edge, 0, 'Accuracy Training')
    expect(edge).toMatchObject({ name: 'Accuracy Training', cost: 1 })
    expect(edge.effect).toContain('AC of 3 or higher')
    expect(edge.automation).toBeUndefined()
    expect(pokemonEdgeInspectorStatus(current, edge, 0).status).toBe('missing-required-data')

    setPokemonEdgeChoice(current, edge, 0, 'choice-1', 'Fire Blast')
    expect(edge.automation).toMatchObject({
      family: 'poke',
      canonicalId: 'Accuracy Training',
      choices: [{ choiceId: 'choice-1', values: ['Fire Blast'] }],
    })
    expect(pokemonEdgeInspectorStatus(current, edge, 0).label).toBe('Automated')
  })

  it('rejects unknown names and bounds dependent final-evolution Move options', () => {
    const current = sheet()
    const edge = current.edges![0]!
    setPokemonEdgeName(current, edge, 0, 'Web Edge')
    expect(edge).toEqual({ name: '', choices: {} })

    setPokemonEdgeName(current, edge, 0, 'Underdog’s Lessons')
    const definitions = pokemonEdgeChoiceDefinitions(edge)
    const finalDefinition = definitions.find(definition => definition.kind === 'final-evolution')!
    expect(pokemonEdgeChoiceOptions(current, edge, finalDefinition).map(option => option.value)).toEqual(['Alakazam'])
    setPokemonEdgeChoice(current, edge, 0, 'choice-1', 'Alakazam')
    const moveDefinition = definitions.find(definition => definition.kind === 'move')!
    expect(pokemonEdgeChoiceOptions(current, edge, moveDefinition).some(option => option.value === 'Psycho Cut')).toBe(true)
    setPokemonEdgeChoice(current, edge, 0, 'choice-2', 'Psycho Cut')
    expect(edge.automation?.canonicalId).toBe('Underdog’s Lessons')
  })

  it('uses canonical multi-point Tutor costs', () => {
    const current = sheet()
    const edge = current.edges![0] as CharacterSheetEdge
    setPokemonEdgeName(current, edge, 0, 'Ability Mastery')
    expect(edge.cost).toBe(3)
  })
})
