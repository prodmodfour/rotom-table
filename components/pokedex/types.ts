import type { PokedexEvolution } from '~/types/pokemon'

export interface DisplayedPokedexEvolution extends PokedexEvolution {
  href: string | null
}
