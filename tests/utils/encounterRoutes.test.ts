import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_GENERATOR_PATH,
  ENCOUNTER_GM_ONLY_PATH_PREFIXES,
  ENCOUNTER_TABLES_PATH,
  encounterGeneratorPath,
  encounterTablesPath,
} from '~/utils/encounterRoutes'

describe('encounter route helpers', () => {
  it('exposes canonical encounter page paths', () => {
    expect(ENCOUNTER_GENERATOR_PATH).toBe('/generate')
    expect(encounterGeneratorPath()).toBe('/generate')
    expect(ENCOUNTER_TABLES_PATH).toBe('/encounter-tables')
    expect(encounterTablesPath()).toBe('/encounter-tables')
  })

  it('groups GM-only encounter prefixes in navigation order', () => {
    expect(ENCOUNTER_GM_ONLY_PATH_PREFIXES).toEqual([
      ENCOUNTER_GENERATOR_PATH,
      ENCOUNTER_TABLES_PATH,
    ])
  })
})
