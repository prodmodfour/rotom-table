export const ENCOUNTER_GENERATOR_PATH = '/generate'
export const ENCOUNTER_TABLES_PATH = '/encounter-tables'

export const encounterGeneratorPath = (): typeof ENCOUNTER_GENERATOR_PATH => ENCOUNTER_GENERATOR_PATH

export const encounterGeneratorTablePath = (region: string, table: string): string => {
  const query = new URLSearchParams({ region, table })
  return `${ENCOUNTER_GENERATOR_PATH}?${query.toString()}`
}

export const encounterTablesPath = (): typeof ENCOUNTER_TABLES_PATH => ENCOUNTER_TABLES_PATH

export const ENCOUNTER_GM_ONLY_PATH_PREFIXES = [
  ENCOUNTER_GENERATOR_PATH,
  ENCOUNTER_TABLES_PATH,
] as const
