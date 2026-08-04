import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_BUILDER_PATH,
  ENCOUNTER_GENERATOR_PATH,
  ENCOUNTER_GM_ONLY_PATH_PREFIXES,
  ENCOUNTER_TABLES_PATH,
  encounterBuilderPath,
  encounterBuilderTablePath,
  encounterGeneratorPath,
  encounterGeneratorTablePath,
  encounterTablesPath,
} from '~/utils/encounterRoutes'

describe('encounter route helpers', () => {
  it('exposes canonical encounter page paths', () => {
    expect(ENCOUNTER_GENERATOR_PATH).toBe('/generate')
    expect(encounterGeneratorPath()).toBe('/generate')
    expect(ENCOUNTER_BUILDER_PATH).toBe('/encounters/new')
    expect(encounterBuilderPath()).toBe('/encounters/new')
    expect(ENCOUNTER_TABLES_PATH).toBe('/encounter-tables')
    expect(encounterTablesPath()).toBe('/encounter-tables')
  })

  it('builds encoded generator links for selected tables', () => {
    expect(encounterGeneratorTablePath('thickerby_vale', 'forest')).toBe('/generate?region=thickerby_vale&table=forest')
    expect(encounterGeneratorTablePath('space port', 'rare/spawns')).toBe('/generate?region=space+port&table=rare%2Fspawns')
    expect(encounterBuilderTablePath('space port', 'rare/spawns')).toBe('/encounters/new?region=space+port&table=rare%2Fspawns')
  })

  it('groups GM-only encounter prefixes in navigation order', () => {
    expect(ENCOUNTER_GM_ONLY_PATH_PREFIXES).toEqual([
      ENCOUNTER_GENERATOR_PATH,
      ENCOUNTER_BUILDER_PATH,
      ENCOUNTER_TABLES_PATH,
    ])
  })
})
