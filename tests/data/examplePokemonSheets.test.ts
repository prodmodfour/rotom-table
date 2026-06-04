import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import { computeFullMaxHp, resolveStats, validateBaseRelations } from '~/utils/sheets/pokemonDerived'

const examplesDir = join(process.cwd(), 'data/sheets/examples')
const exampleFiles = readdirSync(examplesDir)
  .filter((file) => file.endsWith('.json'))
  .sort()

const readExampleSheet = (file: string): CharacterSheet => JSON.parse(
  readFileSync(join(examplesDir, file), 'utf-8'),
) as CharacterSheet

const statByKey = (sheet: CharacterSheet, key: StatKey) => {
  const stat = resolveStats(sheet).find((row) => row.key === key)
  if (!stat) throw new Error(`Missing ${key} stat for ${sheet.slug}`)
  return stat
}

describe('example Pokémon sheets', () => {
  it('uses representative levels for common evolution milestones', () => {
    expect(readExampleSheet('pichu.json').level).toBe(5)
    expect(readExampleSheet('pikachu.json').level).toBe(15)
    expect(readExampleSheet('raichu.json').level).toBe(40)
    expect(readExampleSheet('charizard.json').level).toBe(40)
    expect(readExampleSheet('salamence.json').level).toBe(55)
    expect(readExampleSheet('arceus.json').level).toBe(60)
  })

  it('keeps level-derived stats, HP, evasion, and tutor points coherent', () => {
    const failures: string[] = []

    for (const file of exampleFiles) {
      const sheet = readExampleSheet(file)
      const stats = resolveStats(sheet)
      const addedTotal = stats.reduce((sum, row) => sum + row.added, 0)
      if (addedTotal !== sheet.level + 10) {
        failures.push(`${file}: added stat points ${addedTotal}, expected ${sheet.level + 10}`)
      }

      const violations = validateBaseRelations(stats)
      if (violations.length > 0) {
        failures.push(`${file}: Base Stat Relation violation ${violations[0]!.higher.key} <= ${violations[0]!.lower.key}`)
      }

      const hp = statByKey(sheet, 'hp')
      const expectedMaxHp = computeFullMaxHp(sheet, hp.total)
      if (sheet.combat?.maxHp !== expectedMaxHp) {
        failures.push(`${file}: maxHp ${sheet.combat?.maxHp}, expected ${expectedMaxHp}`)
      }

      const expectedEvasion = {
        vsAtk: Math.floor(statByKey(sheet, 'def').total / 5),
        vsSatk: Math.floor(statByKey(sheet, 'sdef').total / 5),
        vsAny: Math.floor(statByKey(sheet, 'spd').total / 5),
      }
      if (
        sheet.combat?.evasion?.vsAtk !== expectedEvasion.vsAtk
        || sheet.combat?.evasion?.vsSatk !== expectedEvasion.vsSatk
        || sheet.combat?.evasion?.vsAny !== expectedEvasion.vsAny
      ) {
        failures.push(`${file}: evasion ${JSON.stringify(sheet.combat?.evasion)}, expected ${JSON.stringify(expectedEvasion)}`)
      }

      const expectedTutorPoints = Math.floor(sheet.level / 5) + 1
      if (sheet.tutorPoints?.earned !== expectedTutorPoints) {
        failures.push(`${file}: tutor points ${sheet.tutorPoints?.earned}, expected ${expectedTutorPoints}`)
      }
    }

    expect(failures).toEqual([])
  })
})
