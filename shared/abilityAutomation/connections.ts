/** Reviewed Ability Connection clauses currently selected by production AbilitySpec runtimes. */
const REVIEWED_CONNECTIONS = [
  ['Aqua Bullet', 'Aqua Jet'],
  ['Big Swallow', 'Stockpile'],
  ['Blow Away', 'Whirlwind'],
  ['Bone Lord', 'Bonemerang'],
  ['Chemical Romance', 'Sweet Scent'],
  ['Copy Master', 'Copycat'],
  ['Corrosive Toxins', 'Toxic'],
  ['Crush Trap', 'Wrap'],
  ['Danger Syrup', 'Sweet Scent'],
  ['Dust Cloud', 'Poison Powder'],
  ['Eggscellence', 'Barrage'],
  ['Enfeebling Lips', 'Lovely Kiss'],
  ['Flame Tongue', 'Lick'],
  ['Flavorful Aroma', 'Aromatic Mist'],
  ['Fluffy Charge', 'Charge'],
] as const

export const REVIEWED_ABILITY_CONNECTION_MOVES = Object.freeze(
  REVIEWED_CONNECTIONS.map(([abilityName, moveName]) => Object.freeze([abilityName, moveName] as const)),
)

const normalized = (value: string): string => value.trim().toLocaleLowerCase('en-US')

export const reviewedAbilityConnectionMoveNames = (
  abilityNames: readonly string[],
  existingMoveNames: readonly string[] = [],
): readonly string[] => {
  const abilities = new Set(abilityNames.map(normalized))
  const existing = new Set(existingMoveNames.map(normalized))
  const moves: string[] = []
  for (const [abilityName, moveName] of REVIEWED_ABILITY_CONNECTION_MOVES) {
    const key = normalized(moveName)
    if (!abilities.has(normalized(abilityName)) || existing.has(key)) continue
    existing.add(key)
    moves.push(moveName)
  }
  return Object.freeze(moves)
}
