import abilitiesJson from '~~/data/reference/abilities.json'
import pokedexJson from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { sheetEdgeChoiceValues } from '#shared/edgeAutomation/sheetEdges'

interface AbilityRow { readonly name: string; readonly effect?: string }
const abilities = Object.values(abilitiesJson as Record<string, AbilityRow>)
const pokedexBySpecies = new Map((pokedexJson as PokedexRecord[]).map(row => [row.species, row] as const))
const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

const finalEvolutionRows = (sheet: CharacterSheet): readonly PokedexRecord[] => {
  const selected = new Set(sheetEdgeChoiceValues({
    sheet,
    family: 'poke',
    canonicalId: 'Underdog’s Lessons',
    choiceId: 'choice-1',
  }).map(normalized))
  return [...selected].flatMap(name => {
    const row = [...pokedexBySpecies.values()].find(candidate => normalized(candidate.species) === name)
    return row ? [row] : []
  })
}

export interface PokemonEdgeMoveEligibility {
  readonly eligible: boolean
  readonly sourceSpecies: string | null
  readonly sourceKind: 'tm' | 'hm' | 'tutor' | null
}

/** TM/HM/Tutor eligibility overlay granted by Underdog’s Lessons. */
export const pokemonEdgeMoveEligibility = (
  sheet: CharacterSheet,
  moveName: string,
  sourceKind: 'tm' | 'hm' | 'tutor',
): PokemonEdgeMoveEligibility => {
  const requested = normalized(moveName)
  for (const row of finalEvolutionRows(sheet)) {
    const eligible = sourceKind === 'tutor'
      ? row.tutor_moves.some(move => normalized(move.name) === requested)
      : row.tm_hm_moves.some(move => normalized(move.name) === requested
        && normalized(move.kind) === sourceKind)
    if (eligible) return Object.freeze({ eligible: true, sourceSpecies: row.species, sourceKind })
  }
  return Object.freeze({ eligible: false, sourceSpecies: null, sourceKind: null })
}

const connectionMove = (abilityName: string): string | null => {
  const ability = abilities.find(row => normalized(row.name) === normalized(abilityName))
  const effect = ability?.effect ?? ''
  const match = /\[?Connection\s*[-–—:]\s*([^\]\n.]+)\]?/i.exec(effect)
  return match?.[1]?.trim() || null
}

/** Connected Moves for selected Advanced Connection instances consume no slot. */
export const pokemonEdgeSlotExemptMoveNames = (sheet: CharacterSheet): readonly string[] => Object.freeze([
  ...new Set(sheetEdgeChoiceValues({
    sheet,
    family: 'poke',
    canonicalId: 'Advanced Connection',
    choiceId: 'choice-1',
  }).flatMap(ability => connectionMove(ability) ?? [])),
].sort((left, right) => left.localeCompare(right, 'en-US')))

export const pokemonEffectiveMoveSlotCount = (sheet: CharacterSheet): number => {
  const exempt = new Set(pokemonEdgeSlotExemptMoveNames(sheet).map(normalized))
  return (sheet.movelist ?? []).filter(move => !exempt.has(normalized(move.name))).length
}
