export interface MoveDamageBaseDef {
  db: number
  count: number
  sides: number
  mod: number
}

export interface MoveDamageRollResult {
  formula: string
  count: number
  sides: number
  mod: number
  rolls: number[]
  total: number
}

// PTU 1.05 damage-base table used by move automation and sheet move lookup.
// Keep this distinct from the manual damage-dialog table in utils/ptuDamage.ts,
// which intentionally preserves that dialog's previous values.
export const MOVE_DAMAGE_BASE_TABLE: readonly MoveDamageBaseDef[] = [
  { db: 1, count: 1, sides: 6, mod: 1 },
  { db: 2, count: 1, sides: 6, mod: 3 },
  { db: 3, count: 1, sides: 6, mod: 5 },
  { db: 4, count: 1, sides: 8, mod: 6 },
  { db: 5, count: 1, sides: 8, mod: 8 },
  { db: 6, count: 2, sides: 6, mod: 8 },
  { db: 7, count: 2, sides: 6, mod: 10 },
  { db: 8, count: 2, sides: 8, mod: 10 },
  { db: 9, count: 2, sides: 10, mod: 10 },
  { db: 10, count: 3, sides: 8, mod: 10 },
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

export const findMoveDamageBase = (db: number): MoveDamageBaseDef | null =>
  MOVE_DAMAGE_BASE_TABLE.find((entry) => entry.db === db) ?? null

export const formatMoveDamageBase = (db: number): string => {
  const def = findMoveDamageBase(db)
  return def ? formatMoveDamageBaseFormula(def) : `DB ${db}`
}

export const formatMoveDamageBaseFormula = (def: MoveDamageBaseDef): string =>
  `${def.count}d${def.sides}+${def.mod}`

export const rollMoveDamageFormula = (
  formula: string,
  random: () => number = Math.random,
): MoveDamageRollResult | null => {
  const match = formula.trim().match(/^(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i)
  if (!match) return null
  const count = Number(match[1])
  const sides = Number(match[2])
  const mod = match[3] ? Number(match[3].replace(/\s+/g, '')) : 0
  if (!Number.isInteger(count) || !Number.isInteger(sides) || count <= 0 || sides <= 0) return null
  const rolls: number[] = []
  for (let i = 0; i < count; i += 1) rolls.push(1 + Math.floor(random() * sides))
  return {
    formula: `${count}d${sides}${mod >= 0 ? '+' : ''}${mod}`,
    count,
    sides,
    mod,
    rolls,
    total: rolls.reduce((sum, roll) => sum + roll, 0) + mod,
  }
}
