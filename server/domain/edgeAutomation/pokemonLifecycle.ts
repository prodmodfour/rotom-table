import pokedexJson from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { edgeChoiceValues, resolveEdgeInstance } from '#shared/edgeAutomation/instances'
import { CANONICAL_POKE_EDGE_REFERENCE } from '#shared/edgeAutomation/catalog'
import { parseSkillDiceRankValue } from '~/utils/skillRanks'

const pokedexBySpecies = new Map((pokedexJson as PokedexRecord[]).map(row => [row.species, row] as const))
const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export interface PokemonEvolutionEdgeLifecycleResult {
  readonly ok: boolean
  readonly sheet: CharacterSheet
  readonly removedEdgeInstanceIds: readonly string[]
  readonly refundedTutorPoints: number
  readonly reasonCode: string | null
  readonly message: string
}

const speciesBaseStatTotal = (row: PokedexRecord): number => (
  row.base_stats.hp + row.base_stats.atk + row.base_stats.def
  + row.base_stats.spatk + row.base_stats.spdef + row.base_stats.spd
)

const speciesSkillRank = (row: PokedexRecord, skillId: string): number => {
  const compact = normalized(skillId).replace(/(?:education|ed)|[^a-z0-9]/g, '')
  const value = Object.entries(row.skills).find(([label]) => (
    normalized(label).replace(/(?:education|ed)|[^a-z0-9]/g, '') === compact
  ))?.[1]
  return parseSkillDiceRankValue(value)
}

/**
 * Applies Edge-owned evolution restrictions/refunds. The caller owns the
 * species evolution transaction and commits this returned sheet atomically.
 */
export const planPokemonEvolutionEdgeLifecycle = (
  sheet: CharacterSheet,
  targetSpecies: string,
): PokemonEvolutionEdgeLifecycleResult => {
  const source = pokedexBySpecies.get(sheet.species)
  const target = pokedexBySpecies.get(targetSpecies)
  if (!source || !target) return Object.freeze({
    ok: false,
    sheet: clone(sheet),
    removedEdgeInstanceIds: Object.freeze([]),
    refundedTutorPoints: 0,
    reasonCode: 'edge.evolution.species-unresolved',
    message: 'The app-owned Pokédex cannot resolve the requested evolution.',
  })
  const legalTarget = source.evolutions.some(evolution => normalized(evolution.species) === normalized(targetSpecies)
    && evolution.stage > source.evolution_stage)
  if (!legalTarget) return Object.freeze({
    ok: false,
    sheet: clone(sheet),
    removedEdgeInstanceIds: Object.freeze([]),
    refundedTutorPoints: 0,
    reasonCode: 'edge.evolution.target-invalid',
    message: `${targetSpecies} is not a later stage in ${sheet.species}’s app-owned evolution chain.`,
  })

  const resolved = (sheet.edges ?? []).map((entry, index) => ({
    entry,
    resolved: resolveEdgeInstance({ family: 'poke', entry, ownerId: sheet.slug, index }),
  }))
  if (resolved.some(row => row.resolved.status === 'ready'
    && row.resolved.data?.canonicalId === 'Underdog’s Strength')) {
    return Object.freeze({
      ok: false,
      sheet: clone(sheet),
      removedEdgeInstanceIds: Object.freeze([]),
      refundedTutorPoints: 0,
      reasonCode: 'edge.underdog-strength.prevents-evolution',
      message: 'Underdog’s Strength prevents this Pokémon from evolving.',
    })
  }

  const remove = new Set<string>()
  if (speciesBaseStatTotal(target) >= 45) {
    resolved.forEach(row => {
      if (row.resolved.data?.canonicalId === 'Realized Potential') remove.add(row.resolved.data.instanceId)
    })
  }
  resolved.forEach(row => {
    const instance = row.resolved.data
    if (!instance || instance.canonicalId !== 'Skill Improvement') return
    const skillId = edgeChoiceValues(instance, 'choice-1')[0]
    if (skillId && speciesSkillRank(target, skillId) + 1 > 6) remove.add(instance.instanceId)
  })

  const next = clone(sheet)
  next.species = target.species
  next.edges = (next.edges ?? []).filter((entry, index) => {
    const instance = resolveEdgeInstance({ family: 'poke', entry, ownerId: next.slug, index }).data
    return !instance || !remove.has(instance.instanceId)
  })
  const refund = resolved.reduce((total, row) => {
    const instance = row.resolved.data
    return instance && remove.has(instance.instanceId)
      ? total + (CANONICAL_POKE_EDGE_REFERENCE[instance.canonicalId]?.cost ?? 0)
      : total
  }, 0)
  if (refund > 0) {
    next.tutorPoints ??= {}
    next.tutorPoints.spent = Math.max(0, (next.tutorPoints.spent ?? 0) - refund)
  }
  return Object.freeze({
    ok: true,
    sheet: next,
    removedEdgeInstanceIds: Object.freeze([...remove].sort()),
    refundedTutorPoints: refund,
    reasonCode: null,
    message: refund > 0
      ? `Evolution applied; ${remove.size} ineligible Poké Edge${remove.size === 1 ? '' : 's'} removed and ${refund} Tutor Point${refund === 1 ? '' : 's'} refunded.`
      : 'Evolution applied with no Edge refund required.',
  })
}
