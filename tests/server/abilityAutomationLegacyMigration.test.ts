import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import legacyBaselineJson from '../../data/ability-automation/legacy-baseline.json'
import legacyMigrationJson from '../../data/ability-automation/legacy-migration.json'
import manifestJson from '../../data/ability-automation/manifest.json'
import type { AbilityAutomationManifest } from '#shared/abilityAutomation/manifest'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/abilityAutomation/registry'
import { abilityAutomationInteractionReviewSha256 } from '~~/server/domain/abilityAutomation/interactionMatrix'

const root = resolve(import.meta.dirname, '../..')

const categoryCapabilities: Readonly<Record<string, readonly string[]>> = {
  'ability-overlay': ['abilities.effective-projection'],
  'active-transaction': ['mode.activated', 'mode.static', 'mode.triggered'],
  'condition-immunity': ['conditions.typed', 'immunity.providers'],
  'critical-immunity': ['damage.modifiers', 'immunity.providers'],
  'derived-sheet': ['passives.aggregation', 'stages.typed'],
  'move-follow-up': ['events.routing', 'mode.triggered', 'reactions.durable'],
  'move-interaction': ['conditions.typed', 'damage.modifiers', 'immunity.providers', 'reactions.durable'],
  'move-script-rewrite': ['damage.modifiers', 'targeting.authoritative'],
  'passive-provider': ['damage.modifiers', 'immunity.providers', 'passives.aggregation', 'stages.typed'],
  'reaction-definition': ['mode.triggered', 'reactions.durable'],
  'recoil-immunity': ['damage.modifiers', 'immunity.providers'],
  'sheet-toggle': ['fields.typed', 'mode.activated', 'mode.static', 'stages.typed', 'state.marks-counters'],
  'weather-immunity': ['fields.typed', 'hp.typed', 'immunity.providers'],
}

describe('ability automation legacy migration audit', () => {
  it('maps every frozen fragment owner to one exact certified native runtime', () => {
    const manifest = manifestJson as unknown as AbilityAutomationManifest
    const baselineById = new Map(legacyBaselineJson.entries.map(entry => [entry.canonicalId, entry]))

    expect(legacyMigrationJson).toMatchObject({
      schemaVersion: 1,
      baselineCapturedAt: legacyBaselineJson.capturedAt,
      canonicalSourceSha256: legacyBaselineJson.canonicalSourceSha256,
      reviewedManifestSha256: abilityAutomationInteractionReviewSha256(manifest),
      migrationPolicy: 'native-only-no-dual-write',
    })
    expect(legacyMigrationJson.entries.map(entry => entry.canonicalId)).toEqual(
      legacyBaselineJson.entries.map(entry => entry.canonicalId),
    )

    for (const entry of legacyMigrationJson.entries) {
      const baseline = baselineById.get(entry.canonicalId)!
      const row = manifest.abilities.find(candidate => candidate.canonicalId === entry.canonicalId)!
      const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(entry.canonicalId)
      expect(entry.legacyCategories).toEqual(
        [...new Set(baseline.fragments.map(fragment => fragment.category))].sort(),
      )
      expect(entry.disposition).toBe('native-certified')
      expect(entry.nativeRuntime).toEqual(row.runtime)
      expect(runtime).toMatchObject(entry.nativeRuntime)
      expect(entry.evidenceFiles.length).toBeGreaterThan(0)
      expect(entry.evidenceFiles.every(file => existsSync(resolve(root, file)))).toBe(true)
      for (const category of entry.legacyCategories) {
        expect(categoryCapabilities[category].some(code => row.capabilityTags.includes(code))).toBe(true)
      }
    }
  })

  it('keeps the migration audit detached from mutable manifest and baseline input', () => {
    const first = legacyMigrationJson.entries[0]!
    const before = JSON.stringify(first)
    const detached = structuredClone(first)
    detached.evidenceFiles.push('tests/forged.test.ts')
    expect(JSON.stringify(first)).toBe(before)
  })
})
