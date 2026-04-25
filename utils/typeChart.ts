/**
 * Standard Pokémon (Gen 6+) type effectiveness chart, used by the character
 * sheet's "Type Effectiveness" panel.
 *
 * The chart is keyed as ``effectiveness[attackingType][defendingType]``.
 * Anything not listed is the default ``1`` (neutral). PTU follows the
 * mainline games for all single-type matchups.
 */

export const POKEMON_TYPES = [
  'Normal',
  'Fighting',
  'Flying',
  'Poison',
  'Ground',
  'Rock',
  'Bug',
  'Ghost',
  'Steel',
  'Fire',
  'Water',
  'Grass',
  'Electric',
  'Psychic',
  'Ice',
  'Dragon',
  'Dark',
  'Fairy',
] as const

export type PokemonType = (typeof POKEMON_TYPES)[number]

const SUPER: Record<PokemonType, Partial<Record<PokemonType, number>>> = {
  Normal:    { Rock: 0.5, Ghost: 0,   Steel: 0.5 },
  Fighting:  { Normal: 2, Flying: 0.5, Poison: 0.5, Rock: 2,   Bug: 0.5,
               Ghost: 0,  Steel: 2,    Psychic: 0.5, Ice: 2,    Dark: 2, Fairy: 0.5 },
  Flying:    { Fighting: 2, Rock: 0.5, Bug: 2, Steel: 0.5, Grass: 2, Electric: 0.5 },
  Poison:    { Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5,
               Steel: 0,    Grass: 2,    Fairy: 2 },
  Ground:    { Flying: 0,  Poison: 2, Rock: 2, Bug: 0.5, Steel: 2,
               Fire: 2,    Grass: 0.5, Electric: 2 },
  Rock:      { Fighting: 0.5, Flying: 2, Ground: 0.5, Bug: 2,
               Steel: 0.5,    Fire: 2,   Ice: 2 },
  Bug:       { Fighting: 0.5, Flying: 0.5, Poison: 0.5, Ghost: 0.5,
               Steel: 0.5,    Fire: 0.5,   Grass: 2,    Psychic: 2,
               Dark: 2,       Fairy: 0.5 },
  Ghost:     { Normal: 0, Ghost: 2, Psychic: 2, Dark: 0.5 },
  Steel:     { Rock: 2, Steel: 0.5, Fire: 0.5, Water: 0.5,
               Electric: 0.5, Ice: 2, Fairy: 2 },
  Fire:      { Rock: 0.5, Bug: 2, Steel: 2, Fire: 0.5, Water: 0.5,
               Grass: 2, Ice: 2, Dragon: 0.5 },
  Water:     { Ground: 2, Rock: 2, Fire: 2, Water: 0.5, Grass: 0.5, Dragon: 0.5 },
  Grass:     { Flying: 0.5, Poison: 0.5, Ground: 2, Rock: 2, Bug: 0.5,
               Steel: 0.5,  Fire: 0.5,   Water: 2,  Grass: 0.5, Dragon: 0.5 },
  Electric:  { Flying: 2, Ground: 0, Water: 2, Grass: 0.5,
               Electric: 0.5, Dragon: 0.5 },
  Psychic:   { Fighting: 2, Poison: 2, Steel: 0.5, Psychic: 0.5, Dark: 0 },
  Ice:       { Flying: 2, Ground: 2, Steel: 0.5, Fire: 0.5,
               Water: 0.5, Grass: 2, Ice: 0.5, Dragon: 2 },
  Dragon:    { Steel: 0.5, Dragon: 2, Fairy: 0 },
  Dark:      { Fighting: 0.5, Ghost: 2, Psychic: 2, Dark: 0.5, Fairy: 0.5 },
  Fairy:     { Fighting: 2, Poison: 0.5, Steel: 0.5, Fire: 0.5,
               Dragon: 2, Dark: 2 },
}

export const isPokemonType = (value: string): value is PokemonType =>
  (POKEMON_TYPES as readonly string[]).includes(value)

/** Effectiveness of a single attacking type against a single defending type. */
export const singleTypeMultiplier = (attacker: PokemonType, defender: PokemonType): number =>
  SUPER[attacker][defender] ?? 1

/**
 * Effectiveness of an attacking type against a Pokémon with up to two
 * defending types. Unknown types are treated as neutral (``1``).
 */
export const computeMultiplier = (
  attacker: string,
  defenders: ReadonlyArray<string | undefined>,
): number => {
  if (!isPokemonType(attacker)) return 1

  let total = 1
  for (const defender of defenders) {
    if (!defender || !isPokemonType(defender)) continue
    total *= singleTypeMultiplier(attacker, defender)
  }
  return total
}

/** Format a multiplier for display: ``0`` → ``"0"``, ``0.5`` → ``"½"`` etc. */
export const formatMultiplier = (mult: number): string => {
  if (mult === 0) return '0'
  if (mult === 0.25) return '¼'
  if (mult === 0.5) return '½'
  if (mult === 1) return '1'
  if (mult === 2) return '2'
  if (mult === 4) return '4'
  return mult.toString()
}
