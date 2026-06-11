export interface UsefulChartDamageEntry {
  db: number
  rolledDamage: string
  setDamage: {
    minimum: number
    average: number
    maximum: number
  }
}

export interface UsefulChartPowerEntry {
  powerValue: number
  heavyLifting: string
  staggeringWeightLimit: string
  dragWeightLimit: string
}

export interface UsefulChartWeightClassEntry {
  weightClass: number
  range: string
}

export const USEFUL_CHART_SOURCE = 'books/pdf/Useful Charts.pdf'

export const USEFUL_CHART_DAMAGE_ROWS = [
  { db: 1, rolledDamage: '1d6+1', setDamage: { minimum: 2, average: 5, maximum: 7 } },
  { db: 2, rolledDamage: '1d6+3', setDamage: { minimum: 4, average: 7, maximum: 9 } },
  { db: 3, rolledDamage: '1d6+5', setDamage: { minimum: 6, average: 9, maximum: 11 } },
  { db: 4, rolledDamage: '1d8+6', setDamage: { minimum: 7, average: 11, maximum: 14 } },
  { db: 5, rolledDamage: '1d8+8', setDamage: { minimum: 9, average: 13, maximum: 16 } },
  { db: 6, rolledDamage: '2d6+8', setDamage: { minimum: 10, average: 15, maximum: 20 } },
  { db: 7, rolledDamage: '2d6+10', setDamage: { minimum: 12, average: 17, maximum: 22 } },
  { db: 8, rolledDamage: '2d8+10', setDamage: { minimum: 12, average: 19, maximum: 26 } },
  { db: 9, rolledDamage: '2d10+10', setDamage: { minimum: 12, average: 21, maximum: 30 } },
  { db: 10, rolledDamage: '3d8+10', setDamage: { minimum: 13, average: 24, maximum: 34 } },
  { db: 11, rolledDamage: '3d10+10', setDamage: { minimum: 13, average: 27, maximum: 40 } },
  { db: 12, rolledDamage: '3d12+10', setDamage: { minimum: 13, average: 30, maximum: 46 } },
  { db: 13, rolledDamage: '4d10+10', setDamage: { minimum: 14, average: 35, maximum: 50 } },
  { db: 14, rolledDamage: '4d10+15', setDamage: { minimum: 19, average: 40, maximum: 55 } },
  { db: 15, rolledDamage: '4d10+20', setDamage: { minimum: 24, average: 45, maximum: 60 } },
  { db: 16, rolledDamage: '5d10+20', setDamage: { minimum: 25, average: 50, maximum: 70 } },
  { db: 17, rolledDamage: '5d12+25', setDamage: { minimum: 30, average: 60, maximum: 85 } },
  { db: 18, rolledDamage: '6d12+25', setDamage: { minimum: 31, average: 65, maximum: 97 } },
  { db: 19, rolledDamage: '6d12+30', setDamage: { minimum: 36, average: 70, maximum: 102 } },
  { db: 20, rolledDamage: '6d12+35', setDamage: { minimum: 41, average: 75, maximum: 107 } },
  { db: 21, rolledDamage: '6d12+40', setDamage: { minimum: 46, average: 80, maximum: 112 } },
  { db: 22, rolledDamage: '6d12+45', setDamage: { minimum: 51, average: 85, maximum: 117 } },
  { db: 23, rolledDamage: '6d12+50', setDamage: { minimum: 56, average: 90, maximum: 122 } },
  { db: 24, rolledDamage: '6d12+55', setDamage: { minimum: 61, average: 95, maximum: 127 } },
  { db: 25, rolledDamage: '6d12+60', setDamage: { minimum: 66, average: 100, maximum: 132 } },
  { db: 26, rolledDamage: '7d12+65', setDamage: { minimum: 72, average: 110, maximum: 149 } },
  { db: 27, rolledDamage: '8d12+70', setDamage: { minimum: 78, average: 120, maximum: 166 } },
  { db: 28, rolledDamage: '8d12+80', setDamage: { minimum: 88, average: 130, maximum: 176 } },
] as const satisfies readonly UsefulChartDamageEntry[]

export const USEFUL_CHART_POWER_ROWS = [
  { powerValue: 1, heavyLifting: '2–5 lb.', staggeringWeightLimit: '10 lb.', dragWeightLimit: '20 lb.' },
  { powerValue: 2, heavyLifting: '20–30 lb.', staggeringWeightLimit: '60 lb.', dragWeightLimit: '120 lb.' },
  { powerValue: 3, heavyLifting: '35–50 lb.', staggeringWeightLimit: '100 lb.', dragWeightLimit: '200 lb.' },
  { powerValue: 4, heavyLifting: '45–70 lb.', staggeringWeightLimit: '140 lb.', dragWeightLimit: '280 lb.' },
  { powerValue: 5, heavyLifting: '60–90 lb.', staggeringWeightLimit: '180 lb.', dragWeightLimit: '360 lb.' },
  { powerValue: 6, heavyLifting: '75–115 lb.', staggeringWeightLimit: '230 lb.', dragWeightLimit: '460 lb.' },
  { powerValue: 7, heavyLifting: '100–140 lb.', staggeringWeightLimit: '300 lb.', dragWeightLimit: '600 lb.' },
  { powerValue: 8, heavyLifting: '120–190 lb.', staggeringWeightLimit: '380 lb.', dragWeightLimit: '760 lb.' },
  { powerValue: 9, heavyLifting: '150–240 lb.', staggeringWeightLimit: '480 lb.', dragWeightLimit: '960 lb.' },
  { powerValue: 10, heavyLifting: '200–300 lb.', staggeringWeightLimit: '600 lb.', dragWeightLimit: '1200 lb.' },
  { powerValue: 11, heavyLifting: '250–375 lb.', staggeringWeightLimit: '750 lb.', dragWeightLimit: '1500 lb.' },
  { powerValue: 12, heavyLifting: '350–450 lb.', staggeringWeightLimit: '900 lb.', dragWeightLimit: '1800 lb.' },
  { powerValue: 13, heavyLifting: '450–525 lb.', staggeringWeightLimit: '1050 lb.', dragWeightLimit: '2100 lb.' },
  { powerValue: 14, heavyLifting: '500–600 lb.', staggeringWeightLimit: '1200 lb.', dragWeightLimit: '2400 lb.' },
  { powerValue: 15, heavyLifting: '550–675 lb.', staggeringWeightLimit: '1350 lb.', dragWeightLimit: '2700 lb.' },
  { powerValue: 16, heavyLifting: '600–750 lb.', staggeringWeightLimit: '1500 lb.', dragWeightLimit: '3000 lb.' },
] as const satisfies readonly UsefulChartPowerEntry[]

export const USEFUL_CHART_WEIGHT_CLASS_ROWS = [
  { weightClass: 1, range: '0–25 lbs; 0–11 kg' },
  { weightClass: 2, range: '25–55 lbs; 11–25 kg' },
  { weightClass: 3, range: '55–110 lbs; 25–50 kg' },
  { weightClass: 4, range: '110–220 lbs; 50–100 kg' },
  { weightClass: 5, range: '220–440 lbs; 100–200 kg' },
  { weightClass: 6, range: 'Any Pokémon heavier than 440 lbs; 200 kg' },
  { weightClass: 7, range: 'Any Pokémon heavier than 450 lbs with the Heavy Metal Ability.' },
] as const satisfies readonly UsefulChartWeightClassEntry[]

export const USEFUL_CHART_TYPE_ORDER = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
] as const

export type UsefulChartPokemonType = (typeof USEFUL_CHART_TYPE_ORDER)[number]
export type UsefulChartRawTypeMultiplier = 0 | 0.5 | 1 | 2
export type UsefulChartDamageMultiplier = 0 | 0.5 | 1 | 1.5
export type UsefulChartTypeRelation = 'immune' | 'resisted' | 'neutral' | 'super-effective'

export interface UsefulChartTypeCell {
  attacker: UsefulChartPokemonType
  defender: UsefulChartPokemonType
  rawMultiplier: UsefulChartRawTypeMultiplier
  damageMultiplier: UsefulChartDamageMultiplier
  relation: UsefulChartTypeRelation
}

export interface UsefulChartTypeRow {
  attacker: UsefulChartPokemonType
  cells: UsefulChartTypeCell[]
}

const USEFUL_CHART_SINGLE_TYPE_MATCHUPS: Record<UsefulChartPokemonType, Partial<Record<UsefulChartPokemonType, UsefulChartRawTypeMultiplier>>> = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
}

export const USEFUL_CHART_EFFECTIVENESS_LADDER = [
  { label: 'Immune', multiplier: '×0 damage' },
  { label: 'Triply Resisted', multiplier: '×0.125 (⅛) damage' },
  { label: 'Doubly Resisted', multiplier: '×0.25 (¼) damage' },
  { label: 'Resisted', multiplier: '×0.5 damage' },
  { label: 'Neutral', multiplier: '×1 damage' },
  { label: 'Super-Effective', multiplier: '×1.5 damage' },
  { label: 'Doubly Super-Effective', multiplier: '×2 damage' },
  { label: 'Triply Super-Effective', multiplier: '×3 damage' },
] as const

export const USEFUL_CHART_TYPE_QUIRKS = [
  'Electric Types are immune to Paralysis.',
  'Fire Types are immune to Burn.',
  'Ghost Types cannot be Stuck or Trapped.',
  'Grass Types are immune to the effects of all Moves with the Powder Keyword.',
  'Ice Types are immune to being Frozen.',
  'Poison and Steel Types are immune to Poison.',
] as const

export const usefulChartRawTypeMultiplier = (
  attacker: UsefulChartPokemonType,
  defender: UsefulChartPokemonType,
): UsefulChartRawTypeMultiplier => USEFUL_CHART_SINGLE_TYPE_MATCHUPS[attacker][defender] ?? 1

export const usefulChartDamageMultiplier = (
  rawMultiplier: UsefulChartRawTypeMultiplier,
): UsefulChartDamageMultiplier => (rawMultiplier === 2 ? 1.5 : rawMultiplier)

export const usefulChartTypeRelation = (
  rawMultiplier: UsefulChartRawTypeMultiplier,
): UsefulChartTypeRelation => {
  if (rawMultiplier === 0) return 'immune'
  if (rawMultiplier < 1) return 'resisted'
  if (rawMultiplier > 1) return 'super-effective'
  return 'neutral'
}

export const USEFUL_CHART_TYPE_ROWS: readonly UsefulChartTypeRow[] = USEFUL_CHART_TYPE_ORDER.map((attacker) => ({
  attacker,
  cells: USEFUL_CHART_TYPE_ORDER.map((defender) => {
    const rawMultiplier = usefulChartRawTypeMultiplier(attacker, defender)
    return {
      attacker,
      defender,
      rawMultiplier,
      damageMultiplier: usefulChartDamageMultiplier(rawMultiplier),
      relation: usefulChartTypeRelation(rawMultiplier),
    }
  }),
}))
