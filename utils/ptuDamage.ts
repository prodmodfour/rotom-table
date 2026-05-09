export interface DamageBaseDef {
  db: number
  count: number
  sides: number
  mod: number
}

export interface PtuDamageRollResult {
  db: number
  formula: string
  rolls: number[]
  mod: number
  total: number
}

export interface PtuDamageLossInput {
  rawDamage: number
  attackBonus: number
  defense: number
  multiplier: number
}

// PTU PHB Damage Base table. Mods are always positive in this table; the
// formatter assumes that and skips a +0 suffix only because no entry has it.
export const MANUAL_DAMAGE_BASE_TABLE: readonly DamageBaseDef[] = [
  { db: 1,  count: 1, sides: 6,  mod: 1 },
  { db: 2,  count: 1, sides: 6,  mod: 3 },
  { db: 3,  count: 1, sides: 6,  mod: 5 },
  { db: 4,  count: 1, sides: 6,  mod: 7 },
  { db: 5,  count: 1, sides: 8,  mod: 8 },
  { db: 6,  count: 2, sides: 6,  mod: 8 },
  { db: 7,  count: 2, sides: 6,  mod: 10 },
  { db: 8,  count: 2, sides: 8,  mod: 10 },
  { db: 9,  count: 2, sides: 10, mod: 10 },
  { db: 10, count: 3, sides: 8,  mod: 10 },
  { db: 11, count: 3, sides: 10, mod: 10 },
  { db: 12, count: 3, sides: 12, mod: 10 },
  { db: 13, count: 4, sides: 10, mod: 10 },
  { db: 14, count: 4, sides: 10, mod: 15 },
  { db: 15, count: 4, sides: 10, mod: 20 },
  { db: 16, count: 5, sides: 10, mod: 20 },
  { db: 17, count: 5, sides: 12, mod: 25 },
  { db: 18, count: 6, sides: 12, mod: 25 },
  { db: 19, count: 6, sides: 12, mod: 30 },
  { db: 20, count: 6, sides: 12, mod: 35 },
  { db: 21, count: 6, sides: 12, mod: 40 },
  { db: 22, count: 6, sides: 12, mod: 45 },
  { db: 23, count: 6, sides: 12, mod: 50 },
  { db: 24, count: 7, sides: 12, mod: 50 },
  { db: 25, count: 8, sides: 12, mod: 50 },
  { db: 26, count: 8, sides: 12, mod: 55 },
  { db: 27, count: 8, sides: 12, mod: 60 },
  { db: 28, count: 8, sides: 12, mod: 65 },
]

export const findManualDamageBase = (db: number): DamageBaseDef | null =>
  MANUAL_DAMAGE_BASE_TABLE.find((entry) => entry.db === db) ?? null

export const formatDamageBaseFormula = (def: DamageBaseDef): string =>
  `${def.count}d${def.sides}+${def.mod}`

export const rollDamageBase = (
  def: DamageBaseDef,
  random: () => number = Math.random,
): PtuDamageRollResult => {
  const rolls: number[] = []
  for (let i = 0; i < def.count; i += 1) {
    rolls.push(1 + Math.floor(random() * def.sides))
  }
  const total = rolls.reduce((sum, n) => sum + n, 0) + def.mod
  return {
    db: def.db,
    formula: formatDamageBaseFormula(def),
    rolls,
    mod: def.mod,
    total,
  }
}

export const calculatePtuDamageLoss = (input: PtuDamageLossInput): number => {
  if (input.rawDamage <= 0) return 0
  // Immunity short-circuits before the 1-floor — a 0× hit deals 0.
  if (input.multiplier === 0) return 0

  const beforeDefense = input.rawDamage + input.attackBonus
  const afterDefense = beforeDefense - input.defense
  const scaled = Math.floor(afterDefense * input.multiplier)

  // PTU floor: any successful hit deals at least 1 HP regardless of defense.
  return Math.max(1, scaled)
}
