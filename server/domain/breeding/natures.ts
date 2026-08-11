import naturesJson from '../../../data/breeding-automation/natures.json'

export const BREEDING_NATURE_CATALOG_SCHEMA_VERSION = 1 as const
export const BREEDING_NATURE_COUNT = 36 as const
export const BREEDING_NATURE_DEFINITION_SHA256 = naturesJson.definitionSha256
export type BreedingNatureStatId = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
declare const natureIdBrand: unique symbol
export type BreedingNatureId = string & { readonly [natureIdBrand]: true }
export interface BreedingNature {
  readonly id: BreedingNatureId
  readonly value: number
  readonly label: string
  readonly raisesStatId: BreedingNatureStatId
  readonly lowersStatId: BreedingNatureStatId
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const STATS = new Set<string>(['hp', 'atk', 'def', 'satk', 'sdef', 'spd'])
const rows: BreedingNature[] = naturesJson.definition.entries.map((row, index) => {
  if (!ID.test(row.id)
    || row.value !== index + 1
    || typeof row.label !== 'string'
    || !STATS.has(row.raisesStatId)
    || !STATS.has(row.lowersStatId)) {
    throw new Error(`Breeding Nature row ${index} is invalid.`)
  }
  return Object.freeze({
    ...row,
    id: row.id as BreedingNatureId,
    raisesStatId: row.raisesStatId as BreedingNatureStatId,
    lowersStatId: row.lowersStatId as BreedingNatureStatId,
  })
})
if (rows.length !== BREEDING_NATURE_COUNT || new Set(rows.map(row => row.id)).size !== rows.length) {
  throw new Error('Breeding Nature catalog must contain 36 unique entries.')
}
export const BREEDING_NATURES: readonly BreedingNature[] = Object.freeze(rows)
const byId = new Map(BREEDING_NATURES.map(row => [row.id, row]))
const byValue = new Map(BREEDING_NATURES.map(row => [row.value, row]))

export const breedingNature = (value: unknown): BreedingNature | null => (
  typeof value === 'string' && ID.test(value) ? byId.get(value as BreedingNatureId) ?? null : null
)
export const breedingNatureForOrderedDice = (firstDie: unknown, secondDie: unknown): BreedingNature | null => {
  if (!Number.isSafeInteger(firstDie) || !Number.isSafeInteger(secondDie)
    || (firstDie as number) < 1 || (firstDie as number) > 6
    || (secondDie as number) < 1 || (secondDie as number) > 6) return null
  return byValue.get(((firstDie as number) - 1) * 6 + (secondDie as number)) ?? null
}
