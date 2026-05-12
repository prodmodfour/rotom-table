import type { PokedexRecord } from '~/types/pokemon'
import type { SearchBucketValue } from '~/utils/pokedex/searchBuckets'

export type PokedexMoveSearchEntry = Pick<
  PokedexRecord,
  'level_up_moves' | 'tm_hm_moves' | 'egg_moves' | 'tutor_moves'
>

export type PokedexMoveSearchValue = SearchBucketValue

const buildMoveNameAliases = (moveName: string): PokedexMoveSearchValue[] => [
  moveName,
  `move ${moveName}`,
  `moves ${moveName}`,
  `${moveName} move`,
]

export const buildMoveSearchValues = (entry: PokedexMoveSearchEntry): PokedexMoveSearchValue[] => {
  const values: PokedexMoveSearchValue[] = []

  for (const move of entry.level_up_moves ?? []) {
    values.push(
      ...buildMoveNameAliases(move.name),
      `level up ${move.name}`,
      `level ${move.level} ${move.name}`,
    )
  }

  for (const move of entry.tm_hm_moves ?? []) {
    const machine = `${move.kind}${move.number}`
    values.push(
      ...buildMoveNameAliases(move.name),
      `${move.kind} ${move.number}`,
      machine,
      `${move.kind} ${move.number} ${move.name}`,
      `${machine} ${move.name}`,
    )
  }

  for (const moveName of entry.egg_moves ?? []) {
    values.push(...buildMoveNameAliases(moveName), `egg move ${moveName}`)
  }

  for (const move of entry.tutor_moves ?? []) {
    values.push(...buildMoveNameAliases(move.name), `tutor move ${move.name}`)
    if (move.heart_scale) {
      values.push(`heart scale move ${move.name}`)
    }
  }

  return values
}
