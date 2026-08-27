#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
const ROOT = resolve(import.meta.dirname, '../..')
const read = path => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'))
const certification = read('data/release-readiness/mechanics-registry-finality.v1.json')
const fail = message => { throw new Error(message) }
try {
  const rows = new Map(certification.registries.map(row => [row.id, row]))
  const expected = {
    abilities: read('data/ability-automation/manifest.json').abilities.length,
    capabilities: read('data/capability-automation/inventory.json').records.length,
    'trainer-and-poke-edges': read('data/edge-automation/inventory.json').records.length,
    features: read('data/feature-automation/inventory.json').records.length,
    moves: read('data/move-automation/manifest.json').moves.length,
    'breeding-ledger': 90,
    'onboarding-decisions': read('data/onboarding/creation-rule-coverage.json').rows.length,
    'canonical-items': Object.keys(read('data/reference/items.json')).length,
    'contest-integration': read('data/reference/contests.json').integrationRows.length,
    'deferred-mechanics-closure': read('data/deferred-closure/closure-inventory.v1.json').rows.length,
    'gm-campaign-toolkit-footprint': read('data/gm-campaign-toolkit/generation-preparation-footprint.v1.json').rows.length,
  }
  for (const [id, count] of Object.entries(expected)) {
    const row = rows.get(id)
    if (!row || row.rows !== count || row.finalRows !== count || typeof row.command !== 'string') fail(`${id} finality count or command drifted`)
  }
  const abilities = read('data/ability-automation/manifest.json').abilities
  if (abilities.some(row => row.baseStatus !== 'complete' || row.interactionStatus !== 'complete' || row.blockerCodes.length || row.manualSteps.length)) fail('Ability finality regressed')
  const moves = read('data/move-automation/manifest.json').moves
  if (moves.some(row => row.baseStatus !== 'complete' || row.blockerCodes.length || row.manualSteps.length)) fail('Move finality regressed')
  const onboarding = read('data/onboarding/creation-rule-coverage.json').rows
  const onboardingFinal = new Set(['complete', 'guided', 'campaign-policy'])
  if (onboarding.some(row => !onboardingFinal.has(row.state))) fail('Onboarding decision finality regressed')
  const deferred = read('data/deferred-closure/closure-inventory.v1.json').rows
  if (deferred.some(row => row.currentState !== row.targetState || ['blocked', 'deferred', 'definition-missing', 'visible-with-reason'].includes(row.currentState))) fail('Deferred closure finality regressed')
  const toolkit = read('data/gm-campaign-toolkit/footprint-finality.v1.json').rows
  const toolkitFinal = new Set(['Native', 'Migrated', 'Preserved', 'Retired', 'Documentary'])
  if (toolkit.some(row => row.implementationState !== row.targetState || !toolkitFinal.has(row.implementationState))) fail('GM Toolkit footprint finality regressed')
  const total = Object.values(expected).reduce((sum, count) => sum + count, 0)
  if (certification.totals.registeredRows !== total || certification.totals.finalRows !== total) fail('Finality aggregate total drifted')
  for (const key of ['blockedRows', 'deferredRows', 'definitionMissingRows', 'visibleWithReasonCoreRows']) if (certification.totals[key] !== 0) fail(`${key} must be zero`)
  process.stdout.write(`Mechanics registry finality passed: ${total}/${total} rows final across ${rows.size} registries.\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
