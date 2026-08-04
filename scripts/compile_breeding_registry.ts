import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pokedexJson from '../data/reference/pokedex.json'
import familyResolutionsJson from '../data/breeding-automation/family-resolutions.json'
import { compileBreedingRegistry } from '../server/domain/breeding/compiler'

const ROOT = resolve(import.meta.dirname, '..')
const REGISTRY_PATH = resolve(ROOT, 'data/breeding-automation/compiled-registry.json')
const REPORT_PATH = resolve(ROOT, 'data/breeding-automation/compiler-validation-report.json')
const mode = process.argv[2] ?? '--check'
if (!['--check', '--write'].includes(mode) || process.argv.length > 3) {
  console.error('Usage: compile_breeding_registry.ts [--check|--write]')
  process.exit(2)
}

const result = compileBreedingRegistry(pokedexJson, familyResolutionsJson)
const registryBytes = `${JSON.stringify(result.registry, null, 2)}\n`
const reportBytes = `${JSON.stringify(result.report, null, 2)}\n`

if (mode === '--write') {
  writeFileSync(REGISTRY_PATH, registryBytes)
  writeFileSync(REPORT_PATH, reportBytes)
  console.log(`Wrote breeding registry (${result.report.summary.compiledSpeciesCount} Species, ${result.report.summary.compiledFamilyCount} Families) and ${result.report.diagnostics.length} diagnostics.`)
}
else {
  const failures: string[] = []
  try { if (readFileSync(REGISTRY_PATH, 'utf8') !== registryBytes) failures.push('compiled-registry.json drifted') }
  catch { failures.push('compiled-registry.json is missing') }
  try { if (readFileSync(REPORT_PATH, 'utf8') !== reportBytes) failures.push('compiler-validation-report.json drifted') }
  catch { failures.push('compiler-validation-report.json is missing') }
  if (failures.length > 0) {
    failures.forEach(failure => console.error(failure))
    process.exit(1)
  }
  console.log(`Breeding compiler check passed: ${result.report.summary.compiledSpeciesCount} Species, ${result.report.summary.compiledFamilyCount} Families, ${result.report.summary.errorCount} errors, ${result.report.summary.warningCount} warnings.`)
}
