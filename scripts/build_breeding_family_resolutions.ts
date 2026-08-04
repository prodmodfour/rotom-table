import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pokedexJson from '../data/reference/pokedex.json'
import { buildBreedingFamilyResolutions } from '../server/domain/breeding/familyResolutionBuilder'

const ROOT = resolve(import.meta.dirname, '..')
const RESOLUTIONS_PATH = resolve(ROOT, 'data/breeding-automation/family-resolutions.json')
const INVENTORY_PATH = resolve(ROOT, 'data/breeding-automation/family-resolution-inventory.json')
const mode = process.argv[2] ?? '--check'
if (!['--check', '--write'].includes(mode) || process.argv.length > 3) {
  console.error('Usage: build_breeding_family_resolutions.ts [--check|--write]')
  process.exit(2)
}

const result = buildBreedingFamilyResolutions(pokedexJson)
const resolutionBytes = `${JSON.stringify(result.resolutionSet, null, 2)}\n`
const inventoryBytes = `${JSON.stringify(result.inventory, null, 2)}\n`
if (mode === '--write') {
  writeFileSync(RESOLUTIONS_PATH, resolutionBytes)
  writeFileSync(INVENTORY_PATH, inventoryBytes)
  console.log(`Wrote ${result.resolutionSet.definition.familySpecs.length} reviewed Families covering ${result.inventory.definition.summary.resolvedSpeciesCount} Species; ${result.inventory.definition.summary.excludedSpeciesCount} remain fail-closed.`)
}
else {
  const failures: string[] = []
  try { if (readFileSync(RESOLUTIONS_PATH, 'utf8') !== resolutionBytes) failures.push('family-resolutions.json drifted') }
  catch { failures.push('family-resolutions.json is missing') }
  try { if (readFileSync(INVENTORY_PATH, 'utf8') !== inventoryBytes) failures.push('family-resolution-inventory.json drifted') }
  catch { failures.push('family-resolution-inventory.json is missing') }
  if (failures.length > 0) {
    failures.forEach(failure => console.error(failure))
    process.exit(1)
  }
  console.log(`Breeding Family resolution check passed: ${result.resolutionSet.definition.familySpecs.length} Families, ${result.inventory.definition.summary.resolvedSpeciesCount}/1149 Species resolved.`)
}
